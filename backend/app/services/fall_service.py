"""Service for fall detection with rule-based monitoring."""
from io import BytesIO
from pathlib import Path
from typing import List

import cv2
import numpy as np
from fastapi import UploadFile

from app.core.config import get_settings
from app.integrations.ai.fall_detection_client import FallDetector, PersonDetection
from app.repositories.extracted_rule_repository import ExtractedRuleRepository


class FallDetectionService:
    """Service for fall detection with rule-based monitoring."""

    PROJECT_ROOT = Path(__file__).resolve().parents[3]

    def __init__(self, rule_repository: ExtractedRuleRepository):
        """Initialize fall detection service.

        Args:
            rule_repository: Repository for accessing extracted rules
        """
        self.rule_repository = rule_repository
        self.detector = None
        self._init_detector()

    def _init_detector(self) -> None:
        """Initialize fall detector with models."""
        # Model paths live in the repo root /Fall model directory.
        pose_model_path = self.PROJECT_ROOT / "Fall model" / "fall_model.pt"
        classifier_path = self.PROJECT_ROOT / "Fall model" / "fall_classifier_RF.pkl"

        if not pose_model_path.exists() or not classifier_path.exists():
            raise FileNotFoundError(
                f"Fall detection models not found. "
                f"Expected: {pose_model_path} and {classifier_path}"
            )

        self.detector = FallDetector(
            pose_model_path=pose_model_path,
            classifier_path=classifier_path
        )

    async def detect_falls(
        self,
        file: UploadFile,
        zone_type: str | None = None,
        organization_id: str | None = None
    ) -> dict:
        """Detect falls in uploaded image with rule-based checking.

        Args:
            file: Uploaded image file
            zone_type: Zone type for rule checking
            organization_id: Organization ID for rule lookup

        Returns:
            Dictionary with detection results
        """
        if not self.detector:
            raise RuntimeError("Fall detector not initialized")

        # Read image
        image_data = await file.read()
        image = cv2.imdecode(
            np.frombuffer(image_data, np.uint8),
            cv2.IMREAD_COLOR
        )

        if image is None:
            raise ValueError("Invalid image format")

        # Detect falls
        detections = self.detector.detect_falls(image)

        # Check rules if zone type provided
        fall_detection_active = True
        if zone_type and organization_id:
            fall_detection_active = await self._check_fall_detection_rule(
                organization_id, zone_type
            )

        # Prepare response
        falls_detected = [d for d in detections if d.is_fallen]
        people_count = len(detections)
        fallen_count = len(falls_detected)

        return {
            "status": "danger" if (fall_detection_active and fallen_count > 0) else "safe",
            "people_count": int(people_count),
            "falls_detected": int(fallen_count),
            "detections": [
                {
                    "person_id": int(d.person_id),
                    "is_fallen": bool(d.is_fallen),
                    "confidence": float(d.confidence),
                    "bbox": [float(value) for value in d.bbox],
                }
                for d in detections
            ],
            "fall_detection_active": bool(fall_detection_active),
            "zone_type": zone_type
        }

    async def _check_fall_detection_rule(
        self,
        organization_id: str,
        zone_type: str
    ) -> bool:
        """Check if fall detection rule applies to zone.

        Args:
            organization_id: Organization ID
            zone_type: Zone type

        Returns:
            True if fall detection should be active, False otherwise
        """
        try:
            from app.core.constants import RuleCategory

            # Get fall detection rules for zone
            rules = await self.rule_repository.get_active_rules_by_category_and_zone(
                organization_id,
                RuleCategory.FALL,
                zone_type
            )

            # If any fall rule exists for this zone, detection is active
            return len(rules) > 0

        except Exception as e:
            print(f"Error checking fall detection rule: {e}")
            # Default to active if can't check rules
            return True

    def draw_detections_on_image(
        self,
        image: np.ndarray,
        detections: List[PersonDetection]
    ) -> np.ndarray:
        """Draw fall detection results on image.

        Args:
            image: Original image
            detections: List of person detections

        Returns:
            Image with annotations
        """
        return self.detector.draw_detections(image, detections)
