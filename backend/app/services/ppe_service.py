from pathlib import Path
from typing import List

import cv2
import numpy as np
from fastapi import UploadFile

from app.core.config import get_settings
from app.core.exceptions import AppError
from app.integrations.ai.ppe_detection_client import PPEDetector, PPEViolation
from app.repositories.employee_repository import EmployeeRepository
from app.repositories.extracted_rule_repository import ExtractedRuleRepository
from app.schemas.ppe_schema import PPEDetectionResponse, PPEComplianceResponse
from app.utils.file_validation import ensure_file_size, infer_image_mime_type, is_image_filename


class PPEService:
    """Service for PPE detection and compliance checking with rule-based monitoring."""

    PROJECT_ROOT = Path(__file__).resolve().parents[3]

    def __init__(
        self,
        ppe_detector: PPEDetector,
        employee_repository: EmployeeRepository,
        rule_repository: ExtractedRuleRepository,
        *,
        max_image_size_mb: int,
    ) -> None:
        self.ppe_detector = ppe_detector
        self.employee_repository = employee_repository
        self.rule_repository = rule_repository
        self.max_image_size_mb = max_image_size_mb

    @classmethod
    def create(cls, employee_repository: EmployeeRepository, rule_repository: ExtractedRuleRepository) -> "PPEService":
        """Factory method to create PPE service with default detector."""
        settings = get_settings()

        # PPE model lives in the repo root /PPE directory.
        model_path = cls.PROJECT_ROOT / "PPE" / "PPE_model.pt"

        if not model_path.exists():
            raise AppError(f"PPE model not found at {model_path}")

        ppe_detector = PPEDetector(model_path, use_clip=True)  # Enable CLIP mapping
        return cls(
            ppe_detector=ppe_detector,
            employee_repository=employee_repository,
            rule_repository=rule_repository,
            max_image_size_mb=settings.MAX_FACE_IMAGE_SIZE_MB,  # Reuse face image size limit
        )

    async def detect_ppe(self, file: UploadFile, current_user: dict) -> PPEDetectionResponse:
        """Detect PPE items in an uploaded image.

        Args:
            file: Uploaded image file
            current_user: Current authenticated user

        Returns:
            PPE detection results
        """
        # Validate file
        if not is_image_filename(file.filename or ""):
            raise AppError("Only image files are supported for PPE detection")

        # Read and validate image
        image_data = await file.read()
        ensure_file_size(
            image_data,
            max_size_mb=self.max_image_size_mb,
            label="PPE detection image",
        )

        # Decode image
        nparr = np.frombuffer(image_data, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image is None:
            raise AppError("Invalid image file")

        # Detect PPE
        detections = self.ppe_detector.detect_ppe(image)

        # Convert to response format
        detected_items = [
            {
                "class_name": det.class_name,
                "confidence": det.confidence,
                "bbox": det.bbox,
            }
            for det in detections
        ]

        return PPEDetectionResponse(
            status="success",
            detected_items=detected_items,
            image_width=detections[0].image_width if detections else image.shape[1],
            image_height=detections[0].image_height if detections else image.shape[0],
        )

    async def check_ppe_compliance(
        self,
        file: UploadFile,
        employee_id: str | None,
        required_ppe: List[str] | None,
        zone_type: str | None,
        current_user: dict
    ) -> PPEComplianceResponse:
        """Check PPE compliance for an employee in an image using rule-based monitoring.

        Args:
            file: Uploaded image file
            employee_id: Optional employee ID to check against
            required_ppe: Optional list of required PPE items (overrides employee defaults)
            zone_type: Zone type for rule-based PPE requirements
            current_user: Current authenticated user

        Returns:
            PPE compliance check results
        """
        # Validate file
        if not is_image_filename(file.filename or ""):
            raise AppError("Only image files are supported for PPE compliance check")

        # Read and validate image
        image_data = await file.read()
        ensure_file_size(
            image_data,
            max_size_mb=self.max_image_size_mb,
            label="PPE compliance image",
        )

        # Decode image
        nparr = np.frombuffer(image_data, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image is None:
            raise AppError("Invalid image file")

        # Get employee info and determine required PPE
        organization_id = current_user["organization_id"]
        employee_name = None
        actual_required_ppe = required_ppe or []

        if employee_id:
            employee = await self.employee_repository.get_by_id(organization_id, employee_id)
            if employee:
                employee_name = employee.full_name
                if not actual_required_ppe:  # Only use employee PPE if not explicitly provided
                    actual_required_ppe = employee.ppe_requirements

        # If still no required PPE, try to get from rules based on zone
        if not actual_required_ppe and zone_type:
            rule_based_ppe = await self._get_ppe_from_rules(organization_id, zone_type)
            actual_required_ppe = rule_based_ppe

        # Check compliance
        violation = self.ppe_detector.check_ppe_compliance(image, actual_required_ppe)

        # Update violation with employee info
        violation.employee_id = employee_id
        violation.employee_name = employee_name

        # Determine compliance status
        is_compliant = len(violation.missing_ppe) == 0

        return PPEComplianceResponse(
            status="compliant" if is_compliant else "violation",
            employee_id=violation.employee_id,
            employee_name=violation.employee_name,
            required_ppe=violation.required_ppe,
            detected_ppe=violation.detected_ppe,
            missing_ppe=violation.missing_ppe,
            confidence=violation.confidence,
            image_width=violation.image_width,
            image_height=violation.image_height,
            mapped_requirements=violation.mapped_requirements,
        )

    async def get_live_ppe_violations(
        self,
        detected_items: List[dict],
        organization_id,
        zone_type: str | None,
    ) -> List[str]:
        """Filter live PPE violations to only those required by extracted rules."""
        if not zone_type:
            return []

        required_ppe = await self._get_ppe_from_rules(organization_id, zone_type)
        if not required_ppe:
            return []

        allowed_violation_classes = set(self._get_violation_classes_for_requirements(required_ppe))
        return sorted(
            {
                item["class_name"]
                for item in detected_items
                if item["class_name"] in allowed_violation_classes
            }
        )

    async def get_live_ppe_monitoring_data(
        self,
        detected_items: List[dict],
        organization_id,
        zone_type: str | None,
    ) -> tuple[List[dict], List[str]]:
        """Return only rule-relevant live PPE detections and violations."""
        if not zone_type:
            return [], []

        required_ppe = await self._get_ppe_from_rules(organization_id, zone_type)
        if not required_ppe:
            return [], []

        normalized_required = {
            self.ppe_detector._normalize_required_item(requirement) or requirement
            for requirement in required_ppe
        }
        allowed_violation_classes = set(self._get_violation_classes_for_requirements(list(normalized_required)))
        monitored_classes = normalized_required | allowed_violation_classes

        filtered_detected_items = [
            item
            for item in detected_items
            if item["class_name"] in monitored_classes
        ]
        filtered_violations = sorted(
            {
                item["class_name"]
                for item in filtered_detected_items
                if item["class_name"] in allowed_violation_classes
            }
        )

        return filtered_detected_items, filtered_violations

    async def _get_ppe_from_rules(self, organization_id: str, zone_type: str) -> List[str]:
        """Get required PPE from extracted rules for a specific zone.

        Args:
            organization_id: Organization ID
            zone_type: Zone type to get PPE requirements for

        Returns:
            List of required PPE items
        """
        try:
            # Get active PPE rules for this organization and zone
            rules = await self.rule_repository.get_active_rules_by_category_and_zone(
                organization_id, "ppe", zone_type
            )

            required_ppe = []
            for rule in rules:
                # Extract PPE requirements from vision mapping
                if rule.vision_mapping.required_classes:
                    required_ppe.extend(rule.vision_mapping.required_classes)

            normalized_requirements = []
            for requirement in required_ppe:
                normalized = self.ppe_detector._normalize_required_item(requirement)
                normalized_requirements.append(normalized or requirement)

            return list(set(normalized_requirements))  # Remove duplicates

        except Exception as e:
            print(f"Error getting PPE from rules: {e}")
            return []

    def _get_violation_classes_for_requirements(self, required_ppe: List[str]) -> List[str]:
        violation_classes = []
        for requirement in required_ppe:
            normalized = self.ppe_detector._normalize_required_item(requirement) or requirement
            negative_class = self.ppe_detector.POSITIVE_TO_NEGATIVE_CLASS.get(normalized)
            if negative_class:
                violation_classes.append(negative_class)
        return violation_classes
