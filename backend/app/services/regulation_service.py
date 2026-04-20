from pathlib import Path
from typing import List

from fastapi import UploadFile

from app.core.config import get_settings
from app.core.constants import ExtractionStatus, RegulationStatus, RuleCategory, Severity, UserRole, VisionModule, normalize_user_role
from app.core.exceptions import AppError, PermissionDeniedError
from app.integrations.ai.rule_extraction_client import SafetyRulesExtractor
from app.integrations.ai.clip_mapping_client import CLIPMappingClient
from app.integrations.storage.storage_client import StorageClient
from app.models.extracted_rule_model import ExtractedRuleModel
from app.models.regulation_model import RegulationExtractionState, RegulationModel
from app.repositories.extracted_rule_repository import ExtractedRuleRepository
from app.repositories.regulation_repository import RegulationRepository
from app.schemas.regulation_schema import (
    ExtractedRuleResponse,
    FaceRecognitionSettingResponse,
    RegulationExtractionSummary,
    RegulationResponse,
    RegulationUploadResponse,
)
from app.utils.datetime import utc_now
from app.utils.file_validation import ensure_file_size, is_supported_pdf_upload
from app.utils.object_id import validate_object_id


ADMIN_UPLOAD_ROLES = {UserRole.ADMIN}
PPE_DETECTOR_CLASSES = [
    "Coverall",
    "Ear Protectors",
    "Face Shield",
    "Gloves",
    "Helmet",
    "Mask",
    "Safety Glasses",
    "Safety Harness",
    "Safety Shoes",
    "Safety Vest",
    "No Coverall",
    "No Ear Protectors",
    "No Face Shield",
    "No Gloves",
    "No Helmet",
    "No Mask",
    "No Safety Glasses",
    "No Safety Harness",
    "No Safety Shoes",
    "No Safety Vest",
]
FALL_DETECTOR_CLASSES = ["person_fallen"]
FIRE_SMOKE_DETECTOR_CLASSES = ["fire", "smoke"]


class RegulationService:
    """Service for managing regulations and rule extraction."""

    def __init__(
        self,
        regulation_repository: RegulationRepository,
        rule_repository: ExtractedRuleRepository,
        storage_client: StorageClient,
        safety_extractor: SafetyRulesExtractor | None = None,
        clip_mapping_client: CLIPMappingClient | None = None,
    ) -> None:
        self.regulation_repository = regulation_repository
        self.rule_repository = rule_repository
        self.storage_client = storage_client
        self.safety_extractor = safety_extractor
        self.clip_mapping_client = clip_mapping_client

    @classmethod
    def create(
        cls,
        regulation_repository: RegulationRepository,
        rule_repository: ExtractedRuleRepository,
        storage_client: StorageClient,
    ) -> "RegulationService":
        """Factory method to create regulation service."""
        settings = get_settings()

        # Initialize safety rules extractor if HF token is available
        extractor = None
        if settings.HF_TOKEN:
            extractor = SafetyRulesExtractor(settings.HF_TOKEN)

        clip_mapping_client = None
        try:
            clip_mapping_client = CLIPMappingClient()
        except ImportError:
            clip_mapping_client = None

        return cls(
            regulation_repository=regulation_repository,
            rule_repository=rule_repository,
            storage_client=storage_client,
            safety_extractor=extractor,
            clip_mapping_client=clip_mapping_client,
        )

    async def upload_and_extract_regulation(
        self,
        *,
        file: UploadFile,
        current_user: dict,
        title: str | None = None,
        description: str | None = None,
    ) -> RegulationUploadResponse:
        self._ensure_admin(current_user)

        filename = file.filename or "regulation.pdf"
        if not is_supported_pdf_upload(filename, file.content_type):
            raise AppError("Only PDF regulation files are supported")

        if not self.safety_extractor:
            raise AppError("Safety rules extractor is not configured. Please set HF_TOKEN in the backend environment.")

        settings = get_settings()
        file_content = await file.read()
        ensure_file_size(file_content, max_size_mb=settings.MAX_PDF_SIZE_MB, label=filename)

        organization_id = current_user["organization_id"]
        stored_file = await self.storage_client.save_bytes(
            content=file_content,
            original_filename=filename,
            mime_type=file.content_type or "application/pdf",
            subdirectory=f"regulations/{organization_id}",
        )

        regulation = RegulationModel(
            organization_id=organization_id,
            title=title or Path(filename).stem,
            description=description,
            document_type="safety_regulation",
            status=RegulationStatus.ACTIVE,
            file=stored_file,
            uploaded_by=current_user["_id"],
            created_by=current_user["_id"],
            updated_by=current_user["_id"],
            extraction=RegulationExtractionState(
                status=ExtractionStatus.PENDING,
                model_name=self.safety_extractor.model,
            ),
        )
        saved_regulation = await self.regulation_repository.create(regulation)
        regulation_id = str(saved_regulation["_id"])

        await self.regulation_repository.update_extraction_status(
            regulation_id,
            ExtractionStatus.PROCESSING,
            model_name=self.safety_extractor.model,
        )

        try:
            extracted_rules = await self.extract_rules_from_regulation(regulation_id, str(organization_id))
        except Exception as exc:
            await self.regulation_repository.update_extraction_status(
                regulation_id,
                ExtractionStatus.FAILED,
                error_message=str(exc),
                model_name=self.safety_extractor.model,
            )
            raise

        updated_regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if updated_regulation is None:
            raise AppError("Regulation upload succeeded but the saved record could not be found")

        rule_responses = [self._rule_response(rule) for rule in extracted_rules]
        summary = self._build_summary(rule_responses)
        summary.face_recognition_enabled = await self.is_face_recognition_enabled(organization_id)
        return RegulationUploadResponse(
            regulation=self._regulation_response(updated_regulation),
            extracted_rules=rule_responses,
            summary=summary,
        )

    async def set_face_recognition_enabled(
        self,
        regulation_id: str,
        enabled: bool,
        current_user: dict,
    ) -> FaceRecognitionSettingResponse:
        self._ensure_admin(current_user)

        regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if regulation is None:
            raise AppError("Regulation not found")

        if str(regulation["organization_id"]) != str(current_user["organization_id"]):
            raise PermissionDeniedError("Regulation does not belong to your organization")

        organization_id = current_user["organization_id"]
        await self.rule_repository.deactivate_rules_by_module(
            organization_id,
            VisionModule.FACE_ACCESS_CONTROL,
            updated_by=current_user["_id"],
        )

        if enabled:
            face_rule = ExtractedRuleModel(
                regulation_id=validate_object_id(regulation_id),
                organization_id=organization_id,
                rule_code="FACE-001",
                title="Face Recognition Access Control",
                description="Face recognition is enabled for monitoring based on the uploaded regulation workflow.",
                category=RuleCategory.ACCESS_CONTROL,
                severity=Severity.MEDIUM,
                applies_to={
                    "zone_types": ["production", "warehouse", "maintenance", "entrance", "restricted"],
                    "employee_roles": ["worker", "supervisor"],
                    "camera_tags": ["face-recognition"],
                },
                vision_mapping={
                    "module": VisionModule.FACE_ACCESS_CONTROL,
                    "required_classes": [],
                    "violation_when": "detected",
                    "confidence_threshold": 0.5,
                },
                source={
                    "text_excerpt": "Face recognition manually enabled from regulation extraction results.",
                },
                created_by=current_user["_id"],
                updated_by=current_user["_id"],
            )
            await self.rule_repository.insert_model(face_rule)

        return FaceRecognitionSettingResponse(enabled=enabled)

    async def is_face_recognition_enabled(self, organization_id) -> bool:
        rules = await self.rule_repository.get_rules_by_module(
            organization_id,
            VisionModule.FACE_ACCESS_CONTROL,
        )
        return len(rules) > 0

    async def extract_rules_from_regulation(self, regulation_id: str, organization_id: str) -> List[ExtractedRuleModel]:
        """Extract rules from a regulation document using LLM.

        Uses the same model as the notebook (Hugging Face router with OpenAI-compatible API).

        Args:
            regulation_id: Regulation ID
            organization_id: Organization ID

        Returns:
            List of extracted rules
        """
        if not self.safety_extractor:
            raise ValueError("Safety rules extractor not configured. Please set HF_TOKEN environment variable.")

        # Get regulation
        regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if not regulation:
            raise ValueError(f"Regulation {regulation_id} not found")

        if str(regulation["organization_id"]) != organization_id:
            raise ValueError("Regulation does not belong to this organization")

        # Extract text from file
        file_path = Path(regulation["file"]["storage_path"])

        if not file_path.exists():
            raise ValueError(f"Regulation file not found: {file_path}")

        # Extract rules using the safety rules extractor
        extracted_data = self.safety_extractor.extract_from_file(file_path)

        # Convert extracted data to rule models
        saved_rules = await self._convert_extraction_to_rules(
            extracted_data, regulation_id, organization_id
        )
        
        # Update regulation extraction status
        await self.regulation_repository.update_extraction_status(
            regulation_id,
            ExtractionStatus.COMPLETED,
            rules_count=len(saved_rules)
        )

        return saved_rules

    async def _convert_extraction_to_rules(
        self,
        extracted_data: dict,
        regulation_id: str,
        organization_id: str
    ) -> List[ExtractedRuleModel]:
        """Convert extracted safety data to rule models.

        Args:
            extracted_data: Dictionary with PPE_list, Fall_list, Heat_list
            regulation_id: Regulation ID
            organization_id: Organization ID

        Returns:
            List of ExtractedRuleModel instances
        """
        saved_rules = []

        # Process PPE items
        ppe_list = extracted_data.get("PPE_list", [])

        if ppe_list:
            for ppe_item in ppe_list:
                mapped_class = self._map_single_requirement(
                    ppe_item,
                    PPE_DETECTOR_CLASSES,
                    fallback=self._fallback_ppe_mapping(ppe_item),
                )

                rule_data = {
                    "regulation_id": regulation_id,
                    "organization_id": organization_id,
                    "rule_code": f"PPE-{len(saved_rules) + 1:03d}",
                    "title": f"PPE Requirement: {ppe_item.title()}",
                    "description": f"Required PPE item: {ppe_item}. Mapped detector class: {mapped_class}.",
                    "category": RuleCategory.PPE,
                    "severity": Severity.HIGH,
                    "applies_to": {
                        "zone_types": ["production", "warehouse", "maintenance"],
                        "employee_roles": ["worker", "supervisor"],
                        "camera_tags": ["ppe-check"]
                    },
                    "vision_mapping": {
                        "module": VisionModule.PPE_DETECTION,
                        "required_classes": [mapped_class],
                        "violation_when": "not_detected",
                        "confidence_threshold": 0.5
                    },
                    "source": {
                        "text_excerpt": ppe_item,
                    }
                }
                rule_model = ExtractedRuleModel(**rule_data)
                saved_data = await self.rule_repository.insert_model(rule_model)
                saved_rules.append(ExtractedRuleModel(**saved_data))

        # Process Fall monitoring
        fall_data = extracted_data.get("Fall_list", {})
        if fall_data.get("active") == "Yes":
            fall_reason = fall_data.get("reason", "Safety requirement")
            mapped_fall_class = self._map_single_requirement(
                f"fall hazard {fall_reason}",
                FALL_DETECTOR_CLASSES,
                fallback="person_fallen",
            )
            rule_data = {
                "regulation_id": regulation_id,
                "organization_id": organization_id,
                "rule_code": f"FALL-{len(saved_rules) + 1:03d}",
                "title": "Fall Detection Monitoring",
                "description": f"Fall detection required. Reason: {fall_reason}. Mapped detector class: {mapped_fall_class}.",
                "category": RuleCategory.FALL,
                "severity": Severity.CRITICAL,
                "applies_to": {
                    "zone_types": ["production", "warehouse", "heights"],
                    "employee_roles": ["worker", "supervisor"],
                    "camera_tags": ["fall-check"]
                },
                "vision_mapping": {
                    "module": VisionModule.FALL_DETECTION,
                    "required_classes": [mapped_fall_class],
                    "violation_when": "detected",
                    "confidence_threshold": 0.7
                },
                "source": {
                    "text_excerpt": fall_reason,
                }
            }
            rule_model = ExtractedRuleModel(**rule_data)
            saved_data = await self.rule_repository.insert_model(rule_model)
            saved_rules.append(ExtractedRuleModel(**saved_data))

        # Process Heat/Fire monitoring
        heat_data = extracted_data.get("Heat_list", {})
        if heat_data.get("active") == "Yes":
            heat_reason = heat_data.get("reason", "Safety requirement")
            mapped_fire_classes = self._map_multiple_requirements(
                [f"fire hazard {heat_reason}", "smoke hazard"],
                FIRE_SMOKE_DETECTOR_CLASSES,
                fallback=["fire", "smoke"],
            )
            rule_data = {
                "regulation_id": regulation_id,
                "organization_id": organization_id,
                "rule_code": f"HEAT-{len(saved_rules) + 1:03d}",
                "title": "Fire/Smoke Detection Monitoring",
                "description": f"Fire/smoke detection required. Reason: {heat_reason}. Mapped detector classes: {', '.join(mapped_fire_classes)}.",
                "category": RuleCategory.FIRE_SMOKE,
                "severity": Severity.CRITICAL,
                "applies_to": {
                    "zone_types": ["production", "warehouse", "fire_risk"],
                    "employee_roles": ["worker", "supervisor"],
                    "camera_tags": ["fire-check"]
                },
                "vision_mapping": {
                    "module": VisionModule.FIRE_SMOKE_DETECTION,
                    "required_classes": mapped_fire_classes,
                    "violation_when": "detected",
                    "confidence_threshold": 0.6
                },
                "source": {
                    "text_excerpt": heat_reason,
                }
            }
            rule_model = ExtractedRuleModel(**rule_data)
            saved_data = await self.rule_repository.insert_model(rule_model)
            saved_rules.append(ExtractedRuleModel(**saved_data))

        return saved_rules

    async def get_rules_for_zone(self, organization_id: str, zone_type: str, category: str = "ppe") -> List[ExtractedRuleModel]:
        """Get active rules for a specific zone and category.

        Args:
            organization_id: Organization ID
            zone_type: Zone type
            category: Rule category (default: ppe)

        Returns:
            List of applicable rules
        """
        category_enum = RuleCategory(category)

        return await self.rule_repository.get_active_rules_by_category_and_zone(
            organization_id, category_enum, zone_type
        )

    def _ensure_admin(self, current_user: dict) -> None:
        if normalize_user_role(current_user["role"]) not in ADMIN_UPLOAD_ROLES:
            raise PermissionDeniedError("Only admins can upload regulations")

    def _map_single_requirement(
        self,
        text: str,
        candidate_classes: list[str],
        *,
        fallback: str,
    ) -> str:
        matches = self._clip_matches([text], candidate_classes)
        if matches:
            mapped_class = matches[0]
            # For PPE requirements, convert negative classes to positive
            # since requirements specify what should be worn
            return self._normalize_ppe_class_for_requirement(mapped_class)
        return fallback

    def _map_multiple_requirements(
        self,
        texts: list[str],
        candidate_classes: list[str],
        *,
        fallback: list[str],
    ) -> list[str]:
        matches = self._clip_matches(texts, candidate_classes)
        if matches:
            return sorted(set(matches))
        return fallback

    def _clip_matches(self, texts: list[str], candidate_classes: list[str]) -> list[str]:
        if not self.clip_mapping_client or not texts or not candidate_classes:
            return []

        try:
            return [
                match.image_class
                for match in self.clip_mapping_client.match_text_to_classes(texts, candidate_classes, threshold=0.15)
            ]
        except Exception:
            return []

    def _normalize_ppe_class_for_requirement(self, class_name: str) -> str:
        """Convert negative PPE classes to positive for requirements.
        
        Since PPE requirements specify what should be worn, negative classes
        like 'No Helmet' should be converted to 'Helmet'.
        """
        if class_name.startswith("No "):
            # Remove "No " prefix to get the positive class
            positive_class = class_name[3:]  # Remove "No "
            # Check if it's a valid positive class
            if positive_class in PPE_DETECTOR_CLASSES[:10]:  # First 10 are positive
                return positive_class
        return class_name

    def _fallback_ppe_mapping(self, ppe_item: str) -> str:
        normalized = ppe_item.strip().lower()
        fallback_map = {
            "hard hat": "Helmet",
            "helmet": "Helmet",
            "protective helmet": "Helmet",
            "safety helmet": "Helmet",
            "vest": "Safety Vest",
            "safety vest": "Safety Vest",
            "high visibility vest": "Safety Vest",
            "glove": "Gloves",
            "gloves": "Gloves",
            "protective gloves": "Gloves",
            "goggle": "Safety Glasses",
            "goggles": "Safety Glasses",
            "safety goggles": "Safety Glasses",
            "safety glasses": "Safety Glasses",
            "boots": "Safety Shoes",
            "safety boots": "Safety Shoes",
            "safety shoes": "Safety Shoes",
            "shoe": "Safety Shoes",
            "mask": "Mask",
            "face mask": "Mask",
            "face shield": "Face Shield",
            "coverall": "Coverall",
            "harness": "Safety Harness",
            "safety harness": "Safety Harness",
            "ear protection": "Ear Protectors",
            "ear protectors": "Ear Protectors",
        }
        return fallback_map.get(normalized, normalized.title())

    def _regulation_response(self, regulation_doc: dict) -> RegulationResponse:
        return RegulationResponse(
            id=str(regulation_doc["_id"]),
            organization_id=str(regulation_doc["organization_id"]),
            title=regulation_doc["title"],
            description=regulation_doc.get("description"),
            document_type=regulation_doc["document_type"],
            status=str(regulation_doc["status"]),
            version=regulation_doc["version"],
            uploaded_by=str(regulation_doc["uploaded_by"]),
            file=regulation_doc["file"],
            created_at=regulation_doc["created_at"],
            updated_at=regulation_doc["updated_at"],
        )

    def _rule_response(self, rule: ExtractedRuleModel) -> ExtractedRuleResponse:
        return ExtractedRuleResponse(
            id=str(rule.id),
            category=str(rule.category),
            severity=str(rule.severity),
            title=rule.title,
            description=rule.description,
            required_classes=rule.vision_mapping.required_classes,
            violation_when=rule.vision_mapping.violation_when,
            confidence_threshold=rule.vision_mapping.confidence_threshold,
            zone_types=rule.applies_to.zone_types,
            source_excerpt=rule.source.text_excerpt,
        )

    def _build_summary(self, rules: list[ExtractedRuleResponse]) -> RegulationExtractionSummary:
        ppe_items = sorted(
            {
                required_class
                for rule in rules
                if rule.category == RuleCategory.PPE.value
                for required_class in rule.required_classes
            }
        )
        return RegulationExtractionSummary(
            total_rules=len(rules),
            ppe_items=ppe_items,
            fall_detection_active=any(rule.category == RuleCategory.FALL.value for rule in rules),
            fire_smoke_detection_active=any(rule.category == RuleCategory.FIRE_SMOKE.value for rule in rules),
            face_recognition_enabled=False,
        )
