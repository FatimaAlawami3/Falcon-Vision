"""Service for fire/smoke detection with multimodal fusion and rule-based monitoring."""
from pathlib import Path
from typing import List

import cv2
import numpy as np
from fastapi import UploadFile

from app.core.config import get_settings
from app.integrations.ai.fire_detection_client import (
    FireSmokeDetector,
    MultimodalFireResult,
    AlertLevel
)
from app.repositories.extracted_rule_repository import ExtractedRuleRepository


class FireDetectionService:
    """Service for fire/smoke detection with multimodal fusion."""

    PROJECT_ROOT = Path(__file__).resolve().parents[3]

    def __init__(self, rule_repository: ExtractedRuleRepository):
        """Initialize fire detection service.

        Args:
            rule_repository: Repository for accessing extracted rules
        """
        self.rule_repository = rule_repository
        self.settings = get_settings()
        self.detector = None
        self._init_detector()

    def _init_detector(self) -> None:
        """Initialize fire detector with models."""
        if not self.settings.FIRE_DETECTION_ENABLED:
            self.detector = None
            return

        # Model paths live in the repo root /Fire Detection directory.
        yolo_model_path = self.PROJECT_ROOT / "Fire Detection" / "fire_smoke_model.pt"
        sensor_model_path = self.PROJECT_ROOT / "Fire Detection" / "ml_lr_classifier.pkl"
        scaler_path = self.PROJECT_ROOT / "Fire Detection" / "ml_scaler.pkl"
        label_encoder_path = self.PROJECT_ROOT / "Fire Detection" / "ml_label_encoder.pkl"

        # Check if models exist
        required_files = [sensor_model_path, scaler_path, label_encoder_path]
        missing = [f for f in required_files if not f.exists()]

        if missing:
            print(f"Warning: Fire detection models not found: {missing}")
            print("Fire detection service will operate in vision-only mode")
            self.detector = None
            return

        try:
            self.detector = FireSmokeDetector(
                yolo_model_path=yolo_model_path,
                sensor_model_path=sensor_model_path,
                scaler_path=scaler_path,
                label_encoder_path=label_encoder_path
            )
        except Exception as e:
            print(f"Error initializing fire detector: {e}")
            self.detector = None

    async def detect_fire_with_fusion(
        self,
        file: UploadFile,
        sensor_data: List[float] | None = None,
        zone_type: str | None = None,
        organization_id: str | None = None
    ) -> dict:
        """Detect fire/smoke with multimodal fusion of sensor and vision data.

        Args:
            file: Uploaded image file
            sensor_data: Optional list of 8 sensor features [temp, CO, smoke, etc.]
            zone_type: Zone type for rule checking
            organization_id: Organization ID for rule lookup

        Returns:
            Dictionary with detection results and alert level
        """
        if not self.settings.FIRE_DETECTION_ENABLED:
            return {
                "alert_level": AlertLevel.NO_ALERT.value,
                "sensor_prediction": "disabled",
                "image_decision": "disabled",
                "image_confidence": 0.0,
                "reason": "Fire detection is disabled by configuration.",
                "detections": [],
                "fire_detection_active": False,
                "zone_type": zone_type,
                "sensor_data_used": sensor_data is not None and len(sensor_data) > 0,
            }

        if not self.detector:
            return {
                "alert_level": AlertLevel.NO_ALERT.value,
                "sensor_prediction": "not_available",
                "image_decision": "unavailable",
                "image_confidence": 0.0,
                "reason": "Fire detector is unavailable because the required model files were not found.",
                "detections": [],
                "fire_detection_active": False,
                "zone_type": zone_type,
                "sensor_data_used": sensor_data is not None and len(sensor_data) > 0,
            }

        # Read image
        image_data = await file.read()
        image = cv2.imdecode(
            np.frombuffer(image_data, np.uint8),
            cv2.IMREAD_COLOR
        )

        if image is None:
            raise ValueError("Invalid image format")

        # Run multimodal detection
        result = self.detector.detect_with_fusion(image, sensor_data)

        # Check rules if zone type provided
        fire_detection_active = True
        if zone_type and organization_id:
            fire_detection_active = await self._check_fire_detection_rule(
                organization_id, zone_type
            )

        # If fire detection is disabled by rules, downgrade alert
        if not fire_detection_active:
            result.alert_level = AlertLevel.NO_ALERT
            result.reason += " (Fire detection disabled by rules for this zone)"

        # Prepare response
        return {
            "alert_level": result.alert_level.value,
            "sensor_prediction": result.sensor_prediction,
            "image_decision": result.image_decision,
            "image_confidence": round(result.image_confidence, 3),
            "reason": result.reason,
            "detections": [
                {
                    "class": d.class_name,
                    "confidence": round(d.confidence, 3),
                    "bbox": d.bbox
                }
                for d in result.image_detections
            ],
            "fire_detection_active": fire_detection_active,
            "zone_type": zone_type,
            "sensor_data_used": sensor_data is not None and len(sensor_data) > 0
        }

    async def detect_fire_image_only(
        self,
        file: UploadFile,
        zone_type: str | None = None,
        organization_id: str | None = None
    ) -> dict:
        """Detect fire/smoke from image only (no sensor data).

        Args:
            file: Uploaded image file
            zone_type: Zone type for rule checking
            organization_id: Organization ID for rule lookup

        Returns:
            Dictionary with detection results
        """
        return await self.detect_fire_with_fusion(
            file,
            sensor_data=None,
            zone_type=zone_type,
            organization_id=organization_id
        )

    async def detect_fire_with_sensor_data(
        self,
        file: UploadFile,
        sensor_data: List[float],
        zone_type: str | None = None,
        organization_id: str | None = None
    ) -> dict:
        """Detect fire/smoke with multimodal fusion.

        Args:
            file: Uploaded image file
            sensor_data: List of 8 sensor features
            zone_type: Zone type for rule checking
            organization_id: Organization ID for rule lookup

        Returns:
            Dictionary with detection results and fused alert level
        """
        if not sensor_data or len(sensor_data) != 8:
            raise ValueError("Sensor data must be a list of 8 features")

        return await self.detect_fire_with_fusion(
            file,
            sensor_data=sensor_data,
            zone_type=zone_type,
            organization_id=organization_id
        )

    async def _check_fire_detection_rule(
        self,
        organization_id: str,
        zone_type: str
    ) -> bool:
        """Check if fire detection rule applies to zone.

        Args:
            organization_id: Organization ID
            zone_type: Zone type

        Returns:
            True if fire detection should be active, False otherwise
        """
        try:
            from app.core.constants import RuleCategory

            # Get fire detection rules for zone
            rules = await self.rule_repository.get_active_rules_by_category_and_zone(
                organization_id,
                RuleCategory.FIRE_SMOKE,
                zone_type
            )

            # If any fire rule exists for this zone, detection is active
            return len(rules) > 0

        except Exception as e:
            print(f"Error checking fire detection rule: {e}")
            # Default to active if can't check rules
            return True

    def draw_detections_on_image(
        self,
        image: np.ndarray,
        detections: list
    ) -> np.ndarray:
        """Draw fire/smoke detections on image.

        Args:
            image: Original image
            detections: List of detections

        Returns:
            Image with annotations
        """
        return self.detector.draw_detections(image, detections)
