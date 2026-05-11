from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from urllib.request import urlopen
from zipfile import ZipFile

import cv2
import numpy as np
import onnxruntime


BASE_REPO_URL = "https://github.com/deepinsight/insightface/releases/download/v0.7"
ARCFACE_DST = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)


@dataclass(slots=True)
class ExtractedFaceEmbedding:
    vector: list[float]
    model_name: str
    dimension: int
    detection_score: float | None
    frontal: bool | None
    bbox: list[float]
    image_width: int
    image_height: int


@dataclass(slots=True)
class DetectedFace:
    bbox: np.ndarray
    kps: np.ndarray | None
    det_score: float
    embedding: np.ndarray | None = None


class ArcFaceRecognizer:
    def __init__(self, model_file: Path, session: onnxruntime.InferenceSession) -> None:
        self.model_file = model_file
        self.session = session
        input_cfg = self.session.get_inputs()[0]
        self.input_name = input_cfg.name
        self.input_shape = input_cfg.shape
        self.input_size = tuple(input_cfg.shape[2:4][::-1])
        self.output_names = [output.name for output in self.session.get_outputs()]
        self.input_mean = 127.5
        self.input_std = 127.5

    def prepare(self, ctx_id: int) -> None:
        if ctx_id < 0:
            self.session.set_providers(["CPUExecutionProvider"])

    def get(self, img: np.ndarray, face: DetectedFace) -> np.ndarray:
        if face.kps is None:
            raise ValueError("Face keypoints are required for recognition alignment")

        aligned = norm_crop(img, landmark=face.kps, image_size=self.input_size[0])
        blob = cv2.dnn.blobFromImage(
            aligned,
            1.0 / self.input_std,
            self.input_size,
            (self.input_mean, self.input_mean, self.input_mean),
            swapRB=True,
        )
        face.embedding = self.session.run(self.output_names, {self.input_name: blob})[0].flatten()
        return face.embedding


class RetinaFaceDetector:
    def __init__(self, model_file: Path, session: onnxruntime.InferenceSession) -> None:
        self.model_file = model_file
        self.session = session
        self.taskname = "detection"
        self.center_cache: dict[tuple[int, int, int], np.ndarray] = {}
        self.nms_thresh = 0.4
        self.det_thresh = 0.5
        self.input_mean = 127.5
        self.input_std = 128.0
        self._init_vars()

    def _init_vars(self) -> None:
        input_cfg = self.session.get_inputs()[0]
        self.input_name = input_cfg.name
        self.input_shape = input_cfg.shape
        if isinstance(self.input_shape[2], str):
            self.input_size = None
        else:
            self.input_size = tuple(self.input_shape[2:4][::-1])
        self.output_names = [output.name for output in self.session.get_outputs()]
        self.use_kps = False
        self._num_anchors = 1

        outputs_len = len(self.output_names)
        if outputs_len == 6:
            self.fmc = 3
            self._feat_stride_fpn = [8, 16, 32]
            self._num_anchors = 2
        elif outputs_len == 9:
            self.fmc = 3
            self._feat_stride_fpn = [8, 16, 32]
            self._num_anchors = 2
            self.use_kps = True
        elif outputs_len == 10:
            self.fmc = 5
            self._feat_stride_fpn = [8, 16, 32, 64, 128]
        elif outputs_len == 15:
            self.fmc = 5
            self._feat_stride_fpn = [8, 16, 32, 64, 128]
            self.use_kps = True
        else:
            raise RuntimeError("Unsupported buffalo_l detection model output shape")

    def prepare(self, ctx_id: int, *, input_size: tuple[int, int], det_thresh: float) -> None:
        if ctx_id < 0:
            self.session.set_providers(["CPUExecutionProvider"])
        self.det_thresh = det_thresh
        if self.input_size is None:
            self.input_size = input_size

    def detect(
        self,
        img: np.ndarray,
        *,
        input_size: tuple[int, int],
        max_num: int = 0,
    ) -> tuple[np.ndarray, np.ndarray | None]:
        im_ratio = float(img.shape[0]) / float(img.shape[1])
        model_ratio = float(input_size[1]) / float(input_size[0])
        if im_ratio > model_ratio:
            new_height = input_size[1]
            new_width = int(new_height / im_ratio)
        else:
            new_width = input_size[0]
            new_height = int(new_width * im_ratio)

        det_scale = float(new_height) / float(img.shape[0])
        resized_img = cv2.resize(img, (new_width, new_height))
        det_img = np.zeros((input_size[1], input_size[0], 3), dtype=np.uint8)
        det_img[:new_height, :new_width, :] = resized_img

        scores_list, bboxes_list, kpss_list = self._forward(det_img)
        if not scores_list:
            return np.empty((0, 5), dtype=np.float32), None

        scores = np.vstack(scores_list)
        scores_ravel = scores.ravel()
        order = scores_ravel.argsort()[::-1]
        bboxes = np.vstack(bboxes_list) / det_scale
        kpss = np.vstack(kpss_list) / det_scale if self.use_kps and kpss_list else None

        pre_det = np.hstack((bboxes, scores)).astype(np.float32, copy=False)
        pre_det = pre_det[order, :]
        keep = self._nms(pre_det)
        det = pre_det[keep, :]

        if kpss is not None:
            kpss = kpss[order, :, :]
            kpss = kpss[keep, :, :]

        if max_num > 0 and det.shape[0] > max_num:
            area = (det[:, 2] - det[:, 0]) * (det[:, 3] - det[:, 1])
            img_center = img.shape[0] // 2, img.shape[1] // 2
            offsets = np.vstack(
                [
                    (det[:, 0] + det[:, 2]) / 2 - img_center[1],
                    (det[:, 1] + det[:, 3]) / 2 - img_center[0],
                ]
            )
            values = area - np.sum(np.power(offsets, 2.0), axis=0) * 2.0
            selected = np.argsort(values)[::-1][:max_num]
            det = det[selected, :]
            if kpss is not None:
                kpss = kpss[selected, :, :]

        return det, kpss

    def _forward(self, img: np.ndarray) -> tuple[list[np.ndarray], list[np.ndarray], list[np.ndarray]]:
        scores_list: list[np.ndarray] = []
        bboxes_list: list[np.ndarray] = []
        kpss_list: list[np.ndarray] = []

        input_size = tuple(img.shape[0:2][::-1])
        blob = cv2.dnn.blobFromImage(
            img,
            1.0 / self.input_std,
            input_size,
            (self.input_mean, self.input_mean, self.input_mean),
            swapRB=True,
        )
        net_outs = self.session.run(self.output_names, {self.input_name: blob})

        input_height = blob.shape[2]
        input_width = blob.shape[3]
        for index, stride in enumerate(self._feat_stride_fpn):
            scores = net_outs[index]
            bbox_preds = net_outs[index + self.fmc] * stride
            height = input_height // stride
            width = input_width // stride
            anchor_centers = self._get_anchor_centers(height, width, stride)

            scores = scores.reshape((-1, 1))
            pos_inds = np.where(scores.ravel() >= self.det_thresh)[0]
            if pos_inds.size == 0:
                continue

            bboxes = distance2bbox(anchor_centers, bbox_preds.reshape((-1, 4)))
            scores_list.append(scores[pos_inds])
            bboxes_list.append(bboxes[pos_inds])

            if self.use_kps:
                kps_preds = net_outs[index + self.fmc * 2] * stride
                kpss = distance2kps(anchor_centers, kps_preds.reshape((-1, 10))).reshape((-1, 5, 2))
                kpss_list.append(kpss[pos_inds])

        return scores_list, bboxes_list, kpss_list

    def _get_anchor_centers(self, height: int, width: int, stride: int) -> np.ndarray:
        key = (height, width, stride)
        if key in self.center_cache:
            return self.center_cache[key]

        anchor_centers = np.stack(np.mgrid[:height, :width][::-1], axis=-1).astype(np.float32)
        anchor_centers = (anchor_centers * stride).reshape((-1, 2))
        if self._num_anchors > 1:
            anchor_centers = np.stack([anchor_centers] * self._num_anchors, axis=1).reshape((-1, 2))
        if len(self.center_cache) < 100:
            self.center_cache[key] = anchor_centers
        return anchor_centers

    def _nms(self, dets: np.ndarray) -> list[int]:
        x1 = dets[:, 0]
        y1 = dets[:, 1]
        x2 = dets[:, 2]
        y2 = dets[:, 3]
        scores = dets[:, 4]

        areas = (x2 - x1 + 1) * (y2 - y1 + 1)
        order = scores.argsort()[::-1]
        keep: list[int] = []

        while order.size > 0:
            current = int(order[0])
            keep.append(current)
            xx1 = np.maximum(x1[current], x1[order[1:]])
            yy1 = np.maximum(y1[current], y1[order[1:]])
            xx2 = np.minimum(x2[current], x2[order[1:]])
            yy2 = np.minimum(y2[current], y2[order[1:]])

            w = np.maximum(0.0, xx2 - xx1 + 1)
            h = np.maximum(0.0, yy2 - yy1 + 1)
            inter = w * h
            overlap = inter / (areas[current] + areas[order[1:]] - inter)
            inds = np.where(overlap <= self.nms_thresh)[0]
            order = order[inds + 1]

        return keep


class FaceRecognitionClient:
    MODEL_NAME = "buffalo_l"
    DET_SIZE = (640, 640)
    MATCH_THRESHOLD = 0.5095477386934673

    def __init__(
        self,
        *,
        model_name: str = MODEL_NAME,
        det_size: tuple[int, int] = DET_SIZE,
        match_threshold: float = MATCH_THRESHOLD,
        root_dir: Path | None = None,
    ) -> None:
        self.model_name = model_name
        self.det_size = det_size
        self.match_threshold = match_threshold
        self.root_dir = Path(root_dir or Path.home() / ".insightface")
        self._lock = Lock()
        self._detector: RetinaFaceDetector | None = None
        self._recognizer: ArcFaceRecognizer | None = None

    def extract_embedding(self, image_bytes: bytes) -> ExtractedFaceEmbedding | None:
        embeddings = self.extract_embeddings(image_bytes, max_faces=0)
        if not embeddings:
            return None

        return max(
            embeddings,
            key=lambda embedding: (embedding.bbox[2] - embedding.bbox[0]) * (embedding.bbox[3] - embedding.bbox[1]),
        )

    def extract_embeddings(self, image_bytes: bytes, *, max_faces: int = 10) -> list[ExtractedFaceEmbedding]:
        image = self._decode_image(image_bytes)
        if image is None:
            return []

        detector, recognizer = self._ensure_models()
        detections, keypoints = detector.detect(image, input_size=self.det_size, max_num=max_faces)
        if detections.shape[0] == 0:
            return []

        embeddings: list[ExtractedFaceEmbedding] = []
        for index, detection in enumerate(detections):
            face = DetectedFace(
                bbox=detection[0:4],
                kps=keypoints[index] if keypoints is not None else None,
                det_score=float(detection[4]),
            )
            embedding = recognizer.get(image, face).astype(np.float32)
            embedding /= np.linalg.norm(embedding) + 1e-12

            frontal = None
            if face.kps is not None:
                left_eye, right_eye, nose, left_mouth, right_mouth = face.kps
                eye_width = max(float(np.linalg.norm(right_eye - left_eye)), 1e-6)
                nose_eye_balance = abs(float(nose[0] - ((left_eye[0] + right_eye[0]) / 2))) / eye_width
                mouth_tilt = abs(float(left_mouth[1] - right_mouth[1])) / eye_width
                frontal = nose_eye_balance <= 0.18 and mouth_tilt <= 0.12

            embeddings.append(
                ExtractedFaceEmbedding(
                    vector=embedding.tolist(),
                    model_name=self.model_name,
                    dimension=int(embedding.shape[0]),
                    detection_score=float(face.det_score),
                    frontal=frontal,
                    bbox=[float(value) for value in face.bbox.tolist()],
                    image_width=int(image.shape[1]),
                    image_height=int(image.shape[0]),
                )
            )

        return embeddings

    def cosine_similarity(self, probe_vector: list[float], reference_vector: list[float]) -> float:
        probe = np.asarray(probe_vector, dtype=np.float32)
        reference = np.asarray(reference_vector, dtype=np.float32)
        return float(np.dot(probe, reference))

    def _ensure_models(self) -> tuple[RetinaFaceDetector, ArcFaceRecognizer]:
        if self._detector is not None and self._recognizer is not None:
            return self._detector, self._recognizer

        with self._lock:
            if self._detector is None or self._recognizer is None:
                model_dir = self._ensure_model_dir()
                det_path = model_dir / "det_10g.onnx"
                rec_path = model_dir / "w600k_r50.onnx"

                detector_session = onnxruntime.InferenceSession(str(det_path), providers=["CPUExecutionProvider"])
                recognizer_session = onnxruntime.InferenceSession(str(rec_path), providers=["CPUExecutionProvider"])

                self._detector = RetinaFaceDetector(det_path, detector_session)
                self._detector.prepare(ctx_id=-1, input_size=self.det_size, det_thresh=0.5)

                self._recognizer = ArcFaceRecognizer(rec_path, recognizer_session)
                self._recognizer.prepare(ctx_id=-1)

        return self._detector, self._recognizer

    def _ensure_model_dir(self) -> Path:
        model_dir = self.root_dir / "models" / self.model_name
        det_path = model_dir / "det_10g.onnx"
        rec_path = model_dir / "w600k_r50.onnx"
        if det_path.exists() and rec_path.exists():
            return model_dir

        model_dir.mkdir(parents=True, exist_ok=True)
        zip_path = self.root_dir / "models" / f"{self.model_name}.zip"
        zip_path.parent.mkdir(parents=True, exist_ok=True)

        if not zip_path.exists():
            self._download_file(f"{BASE_REPO_URL}/{self.model_name}.zip", zip_path)

        with ZipFile(zip_path) as archive:
            archive.extractall(model_dir)

        return model_dir

    def _download_file(self, url: str, destination: Path) -> None:
        with urlopen(url) as response, destination.open("wb") as output:
            while True:
                chunk = response.read(1024 * 64)
                if not chunk:
                    break
                output.write(chunk)

    def _decode_image(self, image_bytes: bytes) -> np.ndarray | None:
        image_array = np.frombuffer(image_bytes, dtype=np.uint8)
        if image_array.size == 0:
            return None
        return cv2.imdecode(image_array, cv2.IMREAD_COLOR)

    def _get_largest_face(
        self,
        detections: np.ndarray,
        keypoints: np.ndarray | None,
    ) -> DetectedFace:
        areas = (detections[:, 2] - detections[:, 0]) * (detections[:, 3] - detections[:, 1])
        best_index = int(np.argmax(areas))
        return DetectedFace(
            bbox=detections[best_index, 0:4],
            kps=keypoints[best_index] if keypoints is not None else None,
            det_score=float(detections[best_index, 4]),
        )


def distance2bbox(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
    x1 = points[:, 0] - distance[:, 0]
    y1 = points[:, 1] - distance[:, 1]
    x2 = points[:, 0] + distance[:, 2]
    y2 = points[:, 1] + distance[:, 3]
    return np.stack([x1, y1, x2, y2], axis=-1)


def distance2kps(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
    predictions: list[np.ndarray] = []
    for index in range(0, distance.shape[1], 2):
        predictions.append(points[:, index % 2] + distance[:, index])
        predictions.append(points[:, index % 2 + 1] + distance[:, index + 1])
    return np.stack(predictions, axis=-1)


def estimate_norm(landmark: np.ndarray, image_size: int = 112) -> np.ndarray:
    if landmark.shape != (5, 2):
        raise ValueError("ArcFace alignment expects exactly 5 keypoints")

    ratio = float(image_size) / 112.0
    dst = ARCFACE_DST * ratio
    matrix, _ = cv2.estimateAffinePartial2D(landmark.astype(np.float32), dst.astype(np.float32))
    if matrix is None:
        raise ValueError("Failed to estimate face alignment transform")
    return matrix


def norm_crop(img: np.ndarray, landmark: np.ndarray, image_size: int = 112) -> np.ndarray:
    matrix = estimate_norm(landmark, image_size=image_size)
    return cv2.warpAffine(img, matrix, (image_size, image_size), borderValue=0.0)
