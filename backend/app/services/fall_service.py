"""Service for fall detection with rule-based monitoring."""
import asyncio
import time
from io import BytesIO
from pathlib import Path
from threading import Lock
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
    _detector_cache: FallDetector | None = None
    _detector_lock = Lock()
    # Cache zone rule-active checks so the live loop doesn't hit the DB every
    # frame. {(org_id, zone): (is_active, expiry_monotonic)}.
    _rule_cache: dict = {}
    _RULE_TTL_SECONDS = 20.0

    def __init__(self, rule_repository: ExtractedRuleRepository):
        """Initialize fall detection service.

        Args:
            rule_repository: Repository for accessing extracted rules
        """
        self.rule_repository = rule_repository
        self.detector = self._get_detector()

    @classmethod
    def _get_detector(cls) -> FallDetector:
        """Initialize fall detector with models."""
        with cls._detector_lock:
            if cls._detector_cache is not None:
                return cls._detector_cache

            # Model paths live in the repo root /Fall model directory.
            pose_model_path = cls.PROJECT_ROOT / "Fall model" / "fall_model.pt"
            classifier_path = cls.PROJECT_ROOT / "Fall model" / "fall_classifier_RF.pkl"

            if not pose_model_path.exists() or not classifier_path.exists():
                raise FileNotFoundError(
                    f"Fall detection models not found. "
                    f"Expected: {pose_model_path} and {classifier_path}"
                )

            cls._detector_cache = FallDetector(
                pose_model_path=pose_model_path,
                classifier_path=classifier_path,
            )
            return cls._detector_cache

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

        fall_detection_active = True
        if zone_type and organization_id:
            fall_detection_active = await self._check_fall_detection_rule(
                organization_id, zone_type
            )

        # Read image
        image_data = await file.read()
        image = cv2.imdecode(
            np.frombuffer(image_data, np.uint8),
            cv2.IMREAD_COLOR
        )

        if image is None:
            raise ValueError("Invalid image format")

        if not fall_detection_active:
            return {
                "status": "inactive",
                "people_count": 0,
                "falls_detected": 0,
                "detections": [],
                "fall_detection_active": False,
                "zone_type": zone_type,
            }

        # Detect falls off the event loop — YOLO inference is blocking CPU/GPU work.
        loop = asyncio.get_running_loop()
        detections = await loop.run_in_executor(None, self.detector.detect_falls, image)

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
                    "track_id": int(d.track_id) if d.track_id is not None else None,
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
        cache_key = (str(organization_id), zone_type)
        now = time.monotonic()
        cached = self._rule_cache.get(cache_key)
        if cached is not None and cached[1] > now:
            return cached[0]

        try:
            from app.core.constants import RuleCategory

            # Get fall detection rules for zone
            rules = await self.rule_repository.get_active_rules_by_category_and_zone(
                organization_id,
                RuleCategory.FALL,
                zone_type
            )

            # If any fall rule exists for this zone, detection is active
            is_active = len(rules) > 0
            self._rule_cache[cache_key] = (is_active, now + self._RULE_TTL_SECONDS)
            return is_active

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
