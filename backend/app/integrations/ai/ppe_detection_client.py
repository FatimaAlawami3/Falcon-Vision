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
    track_id: int | None = None


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

    NORMALIZED_CLASS_MAP = {
        "coverall": "Coverall",
        "protective clothing": "Coverall",
        "protective suit": "Coverall",
        "protective wears": "Coverall",
        "body protection": "Coverall",
        "ear protector": "Ear Protectors",
        "ear protectors": "Ear Protectors",
        "ear muffs": "Ear Protectors",
        "ear plugs": "Ear Protectors",
        "face shield": "Face Shield",
        "face shields": "Face Shield",
        "glove": "Gloves",
        "gloves": "Gloves",
        "protective gloves": "Gloves",
        "helmet": "Helmet",
        "hard hat": "Helmet",
        "Safety helmet": "Helmet",
        "mask": "Mask",
        "breathing apparatus": "Mask",
        "respiratory protection": "Mask",
        "safety glasses": "Safety Glasses",
        "goggles": "Safety Glasses",
        "safety harness": "Safety Harness",
        "harness": "Safety Harness",
        "safety shoes": "Safety Shoes",
        "boots": "Safety Shoes",
        "safety vest": "Safety Vest",
        "vest": "Safety Vest",
        "high visibility vest": "Safety Vest",
        "hi vis vest": "Safety Vest",
        "reflective vest": "Safety Vest"
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

        if use_clip:
            try:
                self.clip_client = CLIPMappingClient()
            except ImportError:
                print("CLIP not available, falling back to simple text matching")
                self.use_clip = False
        else:
            self.clip_client = None

        # PPE classes that the model detect
        self.ppe_classes = ['Coverall', 'Ear Protectors', 
            'Face Shield', 'Gloves', 'Helmet', 'Mask', 'No Coverall',
            'No Ear Protectors', 'No Face Shield', 'No Gloves',
            'No Helmet', 'No Mask', 'No Safety Glasses', 
            'No Safety Harness', 'No Safety Shoes', 'No Safety Vest', 
            'Safety Glasses', 'Safety Harness', 'Safety Shoes', 'Safety Vest']
        self.positive_ppe_classes = list(self.POSITIVE_TO_NEGATIVE_CLASS.keys())


    def detect_ppe(
        self,
        image: np.ndarray,
        confidence_threshold: float = 0.4,
        image_size: int = 416,
    ) -> List[PPEDetection]:
        """Detect PPE items in an image.

        Args:
            image: Input image as numpy array (BGR format)
            confidence_threshold: Minimum confidence for detections

        Returns:
            List of detected PPE items
        """
        height, width = image.shape[:2]

        # Run persistent object tracking so the same object keeps a stable ID across frames.
        results = self.model.track(
            source=image,
            persist=True,
            tracker="bytetrack.yaml",
            imgsz=image_size,
            conf=confidence_threshold,
            verbose=False,
        )

        detections = []
        for result in results:
            if result.boxes is not None:
                track_ids = (
                    result.boxes.id.cpu().numpy().astype(int).tolist()
                    if getattr(result.boxes, "id", None) is not None
                    else []
                )

                for index, box in enumerate(result.boxes):
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
                        track_id=track_ids[index] if index < len(track_ids) else None,
                    )
                    detections.append(detection)

        return detections

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
        mapped_requirements: dict[str, str] = {}
        unmapped_items: list[str] = []

        for required in required_ppe:
            normalized = self._normalize_required_item(required)
            if normalized is not None:
                mapped_requirements[required] = normalized
            else:
                unmapped_items.append(required)

        if unmapped_items and self.use_clip and self.clip_client:
            try:
                clip_matches = self.clip_client.map_ppe_requirements(
                    unmapped_items,
                    self.ppe_classes,  # Use all 20 classes for better matching
                )
                for required, mapped_class in clip_matches.items():
                    normalized = self._normalize_required_item(mapped_class)
                    if normalized is not None:
                        mapped_requirements[required] = normalized
            except Exception as e:
                print(f"CLIP mapping failed: {e}, falling back to simple matching")

        return mapped_requirements

    def _normalize_required_item(self, item: str) -> str | None:
        normalized = item.strip().lower()
        if normalized in self.NORMALIZED_CLASS_MAP:
            return self.NORMALIZED_CLASS_MAP[normalized]

        for class_name in self.positive_ppe_classes:
            class_normalized = class_name.lower()
            if (
                normalized == class_normalized
                or normalized in class_normalized
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
