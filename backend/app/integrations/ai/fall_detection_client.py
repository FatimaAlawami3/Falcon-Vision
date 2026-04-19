"""Fall detection using pose estimation and machine learning classifier."""
from dataclasses import dataclass
from pathlib import Path
from typing import List

import cv2
import numpy as np
from ultralytics import YOLO

try:
    import joblib
except ImportError:
    raise ImportError("joblib is required for fall detection. Install with: pip install joblib")


@dataclass
class PersonDetection:
    """Represents a detected person with pose keypoints."""
    person_id: int
    bbox: List[float]  # [x1, y1, x2, y2]
    keypoints: np.ndarray  # Array of (x, y) coordinates
    is_fallen: bool
    confidence: float


class FallDetector:
    """Fall detection using YOLO pose estimation and Random Forest classifier."""

    def __init__(self, pose_model_path: str | Path, classifier_path: str | Path):
        """Initialize fall detector with pose model and RF classifier.

        Args:
            pose_model_path: Path to YOLO pose model (.pt)
            classifier_path: Path to trained Random Forest classifier (.pkl)
        """
        self.pose_model = YOLO(str(pose_model_path))
        self.classifier = joblib.load(str(classifier_path))
        self.model_path = Path(pose_model_path)
        self.classifier_path = Path(classifier_path)

    def detect_falls(self, image: np.ndarray, confidence_threshold: float = 0.4) -> List[PersonDetection]:
        """Detect falls in an image using pose estimation and ML classifier.

        Args:
            image: Input image as numpy array (BGR format)
            confidence_threshold: Minimum confidence for pose detections

        Returns:
            List of person detections with fall status
        """
        # Run pose estimation
        results = self.pose_model.predict(
            source=image,
            conf=confidence_threshold,
            verbose=False
        )

        detections = []
        person_id = 0

        for result in results:
            if result.boxes is None or result.keypoints is None:
                continue

            boxes = result.boxes.xyxy.cpu().numpy()
            keypoints = result.keypoints.xy.cpu().numpy()
            keypoint_confidences = (
                result.keypoints.conf.cpu().numpy()
                if getattr(result.keypoints, "conf", None) is not None
                else None
            )

            num_people = min(len(boxes), len(keypoints))

            for i in range(num_people):
                kp = keypoints[i]
                bbox = boxes[i]
                kp_conf = keypoint_confidences[i] if keypoint_confidences is not None else None

                # Check if fall can be detected (keypoints available)
                is_fallen = self._classify_person(kp, bbox=bbox, keypoint_confidences=kp_conf)

                detection = PersonDetection(
                    person_id=person_id,
                    bbox=bbox.tolist(),
                    keypoints=kp,
                    is_fallen=is_fallen,
                    confidence=float(result.boxes.conf[i].cpu().numpy())
                )
                detections.append(detection)
                person_id += 1

        return detections

    def _classify_person(
        self,
        keypoints: np.ndarray,
        *,
        bbox: np.ndarray | None = None,
        keypoint_confidences: np.ndarray | None = None,
    ) -> bool:
        """Classify if a person has fallen based on keypoint features.

        Keypoint indices (COCO format):
        5=left_shoulder, 6=right_shoulder, 11=left_hip, 12=right_hip

        Args:
            keypoints: Array of keypoints (x, y coordinates)

        Returns:
            True if person is detected as fallen, False otherwise
        """
        required_ids = [5, 6, 11, 12]

        # Check if required keypoints are available
        if not all(keypoints[j][0] != 0 and keypoints[j][1] != 0 for j in required_ids):
            return False

        if keypoint_confidences is not None:
            if not all(float(keypoint_confidences[j]) >= 0.45 for j in required_ids):
                return False

        try:
            # Feature extraction (same as notebook)
            shoulder_mid = (keypoints[5] + keypoints[6]) / 2
            hip_mid = (keypoints[11] + keypoints[12]) / 2

            # Angle between shoulder and hip midpoints
            dx = hip_mid[0] - shoulder_mid[0]
            dy = hip_mid[1] - shoulder_mid[1]
            angle = abs(np.degrees(np.arctan2(dy, dx)))
            if angle > 90:
                angle = 180 - angle

            # Body aspect ratio
            body_h = keypoints[:, 1].max() - keypoints[:, 1].min()
            body_w = keypoints[:, 0].max() - keypoints[:, 0].min()
            ratio = body_w / (body_h + 1e-6)

            # Normalized center Y position
            center_y = np.mean(keypoints[:, 1])
            center_norm = center_y / (body_h + 1e-6)

            # Shoulder and hip slopes
            shoulder_slope = abs(keypoints[5][1] - keypoints[6][1])
            hip_slope = abs(keypoints[11][1] - keypoints[12][1])

            bbox_ratio = None
            if bbox is not None and len(bbox) >= 4:
                bbox_w = max(float(bbox[2]) - float(bbox[0]), 1e-6)
                bbox_h = max(float(bbox[3]) - float(bbox[1]), 1e-6)
                bbox_ratio = bbox_w / bbox_h

            # Prepare features for classifier
            features = np.array([[angle, ratio, center_norm, shoulder_slope, hip_slope]])

            # Predict using Random Forest classifier
            prediction = self.classifier.predict(features)[0]

            fall_probability = None
            if hasattr(self.classifier, "predict_proba"):
                probabilities = self.classifier.predict_proba(features)[0]
                if len(probabilities) >= 2:
                    fall_probability = float(probabilities[0])

            # Be conservative: only mark a fall when the classifier agrees
            # and multiple geometric cues indicate a horizontal body pose.
            is_horizontal_pose = angle < 40 and ratio > 1.1
            is_flat_bbox = bbox_ratio is None or bbox_ratio > 0.95
            shoulders_level = shoulder_slope < max(body_h * 0.12, 24)
            hips_level = hip_slope < max(body_h * 0.12, 24)
            is_confident_fall = fall_probability is None or fall_probability >= 0.8

            # Prediction: 0 = FALL, 1 = NOT_FALLEN
            return bool(
                prediction == 0
                and is_horizontal_pose
                and is_flat_bbox
                and shoulders_level
                and hips_level
                and is_confident_fall
            )

        except Exception as e:
            print(f"Error classifying person: {e}")
            return False

    def draw_detections(self, image: np.ndarray, detections: List[PersonDetection]) -> np.ndarray:
        """Draw fall detection results on image.

        Args:
            image: Input image
            detections: List of person detections

        Returns:
            Image with annotations
        """
        result_image = image.copy()

        for detection in detections:
            x1, y1, x2, y2 = map(int, detection.bbox)

            # Color: red for fallen, green for not fallen
            color = (0, 0, 255) if detection.is_fallen else (0, 255, 0)
            label = "FALL DETECTED" if detection.is_fallen else "Not Fallen"

            # Draw bounding box
            cv2.rectangle(result_image, (x1, y1), (x2, y2), color, 2)

            # Draw label
            cv2.putText(
                result_image,
                label,
                (x1, y1 - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                color,
                2
            )

            # Draw keypoints
            for x, y in detection.keypoints:
                if x != 0 and y != 0:
                    cv2.circle(result_image, (int(x), int(y)), 3, (255, 0, 0), -1)

        return result_image
