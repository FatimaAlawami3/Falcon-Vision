from dataclasses import dataclass
from pathlib import Path
from typing import List

import cv2
import numpy as np
from ultralytics import YOLO

from .clip_mapping_client import CLIPMappingClient


@dataclass
class PPEDetection:
    """Represents a detected PPE item in an image."""
    class_name: str
    confidence: float
    bbox: List[float]  # [x1, y1, x2, y2]
    image_width: int
    image_height: int


@dataclass
class PPEViolation:
    """Represents a PPE violation for an employee."""
    employee_id: str | None
    employee_name: str | None
    missing_ppe: List[str]  # List of required PPE items that are missing
    detected_ppe: List[str]  # List of PPE items that were detected
    required_ppe: List[str]  # List of PPE items required for this employee
    confidence: float
    image_width: int
    image_height: int
    mapped_requirements: dict[str, str]  # CLIP mapping of text to detected classes


class PPEDetector:
    """PPE detection client using YOLO model with CLIP mapping."""

    POSITIVE_TO_NEGATIVE_CLASS = {
        "Coverall": "No Coverall",
        "Ear Protectors": "No Ear Protectors",
        "Face Shield": "No Face Shield",
        "Gloves": "No Gloves",
        "Helmet": "No Helmet",
        "Mask": "No Mask",
        "Safety Glasses": "No Safety Glasses",
        "Safety Harness": "No Safety Harness",
        "Safety Shoes": "No Safety Shoes",
        "Safety Vest": "No Safety Vest",
    }

    def __init__(self, model_path: str | Path, use_clip: bool = True):
        """Initialize the PPE detector with a YOLO model.

        Args:
            model_path: Path to the YOLO model file (.pt)
            use_clip: Whether to use CLIP for text-to-image mapping
        """
        self.model = YOLO(str(model_path))
        self.model_path = Path(model_path)
        self.use_clip = use_clip
        self.clip_client: CLIPMappingClient | None = None

        self.positive_ppe_classes = list(self.POSITIVE_TO_NEGATIVE_CLASS.keys())
        # Resolved text-term -> canonical class, cached so each term hits CLIP once.
        self._mapping_cache: dict[str, str | None] = {}

        if use_clip:
            # Degrade gracefully to fuzzy matching on any failure (missing
            # package, failed weight download, CUDA error) rather than leaving
            # use_clip=True with a broken client.
            try:
                self.clip_client = CLIPMappingClient()
                # Pre-compute the positive-class embeddings once so the first
                # real mapping call doesn't pay the encoding cost.
                self.clip_client.encode_image_classes(self.positive_ppe_classes)
            except Exception as exc:
                print(f"CLIP unavailable ({exc}); falling back to fuzzy text matching")
                self.use_clip = False
                self.clip_client = None


    def detect_ppe(
        self,
        image: np.ndarray,
        confidence_threshold: float = 0.35,
        image_size: int | None = None,
    ) -> List[PPEDetection]:
        """Detect PPE items in an image.

        Args:
            image: Input image as numpy array (BGR format)
            confidence_threshold: Minimum confidence for detections
            image_size: YOLO inference size; when None, auto-matched to the frame
                width (multiple of 32) to avoid upscaling a downscaled frame.

        Returns:
            List of detected PPE items
        """
        height, width = image.shape[:2]
        inference_size = image_size or max(160, min(640, round(width / 32) * 32))

        results = self.model.predict(
            source=image,
            imgsz=inference_size,
            conf=confidence_threshold,
            verbose=False,
        )

        detections = []
        for result in results:
            if result.boxes is not None:
                for box in result.boxes:
                    # Get bounding box coordinates
                    bbox = box.xyxy[0].cpu().numpy()  # [x1, y1, x2, y2]

                    # Get class name and confidence
                    class_id = int(box.cls[0].cpu().numpy())
                    confidence = float(box.conf[0].cpu().numpy())

                    # Get class name from model
                    if hasattr(result, 'names') and result.names:
                        class_name = result.names[class_id]
                    else:
                        # Fallback to generic class name
                        class_name = f"class_{class_id}"

                    detection = PPEDetection(
                        class_name=class_name,
                        confidence=confidence,
                        bbox=bbox.tolist(),
                        image_width=width,
                        image_height=height,
                    )
                    detections.append(detection)

        return self._suppress_duplicate_detections(detections)

    @staticmethod
    def _bbox_overlap(a: List[float], b: List[float]) -> float:
        """Intersection over the SMALLER box's area.

        Used instead of plain IoU so a small box nested inside a larger one (a
        common duplicate pattern) still scores ~1.0 and gets suppressed.
        """
        ix1 = max(a[0], b[0])
        iy1 = max(a[1], b[1])
        ix2 = min(a[2], b[2])
        iy2 = min(a[3], b[3])
        inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
        area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
        area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
        smaller = min(area_a, area_b)
        return inter / smaller if smaller > 0 else 0.0

    @staticmethod
    def _bbox_center_gap(a: List[float], b: List[float], frame_diag: float = 0.0) -> float:
        """Center distance between two boxes as a fraction of their size (~1 = one
        box-width apart), with a frame-size floor so tiny far boxes still merge."""
        ca = ((a[0] + a[2]) / 2, (a[1] + a[3]) / 2)
        cb = ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
        dist = ((ca[0] - cb[0]) ** 2 + (ca[1] - cb[1]) ** 2) ** 0.5
        diag_a = ((a[2] - a[0]) ** 2 + (a[3] - a[1]) ** 2) ** 0.5
        diag_b = ((b[2] - b[0]) ** 2 + (b[3] - b[1]) ** 2) ** 0.5
        denom = max((diag_a + diag_b) / 2, 0.1 * frame_diag)
        return dist / denom if denom > 0 else float("inf")

    def _suppress_duplicate_detections(
        self,
        detections: List[PPEDetection],
        overlap_threshold: float = 0.45,
        proximity_threshold: float = 0.7,
    ) -> List[PPEDetection]:
        """Greedy per-class NMS: drop a same-class box that overlaps, or (for
        non-paired classes) sits within ~one box-width of, a higher-confidence one.
        Boxes farther apart are kept, so different people each keep their own."""
        # Paired PPE (two hands/feet): merge only on real overlap, never proximity.
        paired = {"gloves", "safety shoes", "ear protectors"}

        def _is_paired(name: str) -> bool:
            return name.lower().removeprefix("no ").strip() in paired

        frame_diag = 0.0
        if detections:
            frame_diag = (detections[0].image_width ** 2 + detections[0].image_height ** 2) ** 0.5

        kept: List[PPEDetection] = []
        for det in sorted(detections, key=lambda d: d.confidence, reverse=True):
            allow_proximity = not _is_paired(det.class_name)
            if any(
                k.class_name == det.class_name
                and (
                    self._bbox_overlap(k.bbox, det.bbox) > overlap_threshold
                    or (allow_proximity and self._bbox_center_gap(k.bbox, det.bbox, frame_diag) < proximity_threshold)
                )
                for k in kept
            ):
                continue
            kept.append(det)
        return kept

    def check_ppe_compliance(self, image: np.ndarray, required_ppe: List[str],
                           confidence_threshold: float = 0.4) -> PPEViolation:
        """Check if an image complies with PPE requirements using CLIP mapping.
        Only monitors and reports on required PPE items and their violations.

        Args:
            image: Input image as numpy array (BGR format)
            required_ppe: List of required PPE items (text descriptions)
            confidence_threshold: Minimum confidence for detections

        Returns:
            PPE violation assessment (filtered to required items only)
        """
        detections = self.detect_ppe(image, confidence_threshold)
        detected_classes = {det.class_name for det in detections}
        positive_detections = {
            det.class_name for det in detections if det.class_name in self.positive_ppe_classes
        }
        negative_detections = {
            det.class_name for det in detections if det.class_name in self.POSITIVE_TO_NEGATIVE_CLASS.values()
        }

        mapped_requirements = self._map_requirements_to_model_classes(required_ppe)

        # Build set of required classes (after mapping)
        required_classes = set()
        for required in required_ppe:
            mapped_class = mapped_requirements.get(required) or self._normalize_required_item(required)
            if mapped_class:
                required_classes.add(mapped_class)

        missing_ppe = []
        for required in required_ppe:
            mapped_class = mapped_requirements.get(required) or self._normalize_required_item(required)
            if not mapped_class:
                missing_ppe.append(required)
                continue

            negative_pair = self.POSITIVE_TO_NEGATIVE_CLASS.get(mapped_class)
            if negative_pair in negative_detections:
                missing_ppe.append(required)
                continue

            if mapped_class in positive_detections:
                continue

            if mapped_class in detected_classes:
                continue

            missing_ppe.append(required)

        # Filter detected_ppe to ONLY include required classes that were detected
        detected_required_ppe = sorted(positive_detections & required_classes)

        height, width = image.shape[:2]

        return PPEViolation(
            employee_id=None,  # Will be set by service
            employee_name=None,  # Will be set by service
            missing_ppe=missing_ppe,
            detected_ppe=detected_required_ppe,  # ← Only required PPE that was detected
            required_ppe=required_ppe,
            confidence=max([det.confidence for det in detections], default=0.0),
            image_width=width,
            image_height=height,
            mapped_requirements=mapped_requirements
        )

    def _map_requirements_to_model_classes(self, required_ppe: List[str]) -> dict[str, str]:
        # Every requirement term is resolved through the same CLIP-backed
        # normalizer, so this is just a thin wrapper that drops unmappable items.
        mapped_requirements: dict[str, str] = {}
        for required in required_ppe:
            resolved = self._normalize_required_item(required)
            if resolved is not None:
                mapped_requirements[required] = resolved
        return mapped_requirements

    def _normalize_required_item(self, item: str) -> str | None:
        """Resolve a free-text PPE term to one of the model's positive classes.

        CLIP does the semantic mapping; there is no hand-maintained synonym
        table. Results are cached per term, and a fuzzy word-overlap matcher is
        used only when CLIP is unavailable or scores below threshold.
        """
        normalized = item.strip().lower()
        if not normalized:
            return None

        # Identity: a term that is already a canonical class (including CLIP's
        # own output) resolves without a model round-trip. This is the model's
        # class list, not a synonym map.
        for class_name in self.positive_ppe_classes:
            if normalized == class_name.lower():
                return class_name

        if normalized in self._mapping_cache:
            return self._mapping_cache[normalized]

        resolved = self._resolve_with_clip(item)
        if resolved is None:
            resolved = self._resolve_with_fuzzy(normalized)

        self._mapping_cache[normalized] = resolved
        return resolved

    def _resolve_with_clip(self, item: str) -> str | None:
        """Map a single term to a positive PPE class via CLIP, or None."""
        if not (self.use_clip and self.clip_client):
            return None
        try:
            matches = self.clip_client.map_ppe_requirements([item], self.positive_ppe_classes)
        except Exception as exc:
            print(f"CLIP mapping failed for {item!r}: {exc}; falling back to fuzzy matching")
            return None

        mapped_class = matches.get(item)
        if mapped_class is None:
            return None
        # map_ppe_requirements returns one of the candidate classes verbatim, so
        # it is already canonical; guard anyway in case of casing drift.
        for class_name in self.positive_ppe_classes:
            if mapped_class.lower() == class_name.lower():
                return class_name
        return None

    def _resolve_with_fuzzy(self, normalized: str) -> str | None:
        """Fallback substring / word-overlap matcher used when CLIP can't map."""
        for class_name in self.positive_ppe_classes:
            class_normalized = class_name.lower()
            if (
                normalized in class_normalized
                or class_normalized in normalized
                or self._calculate_text_similarity(normalized, class_normalized) > 0.6
            ):
                return class_name
        return None

    def _calculate_text_similarity(self, text1: str, text2: str) -> float:
        """Calculate simple text similarity between two strings."""
        # Simple word overlap similarity
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())

        if not words1 or not words2:
            return 0.0

        intersection = words1.intersection(words2)
        union = words1.union(words2)

        return len(intersection) / len(union)

    def draw_detections(self, image: np.ndarray, detections: List[PPEDetection]) -> np.ndarray:
        """Draw PPE detection bounding boxes on an image.

        Args:
            image: Input image
            detections: List of PPE detections

        Returns:
            Image with bounding boxes drawn
        """
        result_image = image.copy()

        for detection in detections:
            x1, y1, x2, y2 = map(int, detection.bbox)

            # Choose color based on PPE type
            if 'helmet' in detection.class_name.lower() or 'hard-hat' in detection.class_name.lower():
                color = (0, 255, 0)  # Green for helmets
            elif 'vest' in detection.class_name.lower():
                color = (255, 0, 0)  # Blue for vests
            elif 'gloves' in detection.class_name.lower():
                color = (0, 0, 255)  # Red for gloves
            else:
                color = (255, 255, 0)  # Yellow for others

            # Draw bounding box
            cv2.rectangle(result_image, (x1, y1), (x2, y2), color, 2)

            # Draw label
            label = f"{detection.class_name}: {detection.confidence:.2f}"
            cv2.putText(result_image, label, (x1, y1 - 10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

        return result_image
