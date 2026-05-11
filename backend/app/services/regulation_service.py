import asyncio
import logging
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import Event
from typing import Callable, List

from bson import ObjectId
from fastapi import UploadFile

from app.core.config import get_settings
from app.core.constants import EntityStatus, ExtractionStatus, RegulationStatus, RuleCategory, Severity, UserRole, VisionModule, normalize_user_role
from app.core.exceptions import AppError, PermissionDeniedError
from app.integrations.ai.rule_extraction_client import ExtractionCancelledError, SafetyRulesExtractor
from app.integrations.ai.clip_mapping_client import CLIPMappingClient
from app.integrations.storage.storage_client import StorageClient
from app.models.extracted_rule_model import ExtractedRuleModel
from app.models.regulation_model import RegulationExtractionState, RegulationModel
from app.repositories.alert_repository import AlertRepository
from app.repositories.extracted_rule_repository import ExtractedRuleRepository
from app.repositories.regulation_repository import RegulationRepository
from app.repositories.user_repository import UserRepository
from app.schemas.regulation_schema import (
    RegulationCurrentResponse,
    ExtractedRuleResponse,
    FaceRecognitionSettingResponse,
    RegulationExtractionStateResponse,
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
logger = logging.getLogger(__name__)


class RegulationService:
    """Service for managing regulations and rule extraction."""

    _jobs: dict[str, asyncio.Task] = {}
    _cancel_events: dict[str, Event] = {}

    def __init__(
        self,
        regulation_repository: RegulationRepository,
        rule_repository: ExtractedRuleRepository,
        storage_client: StorageClient,
        alert_repository: AlertRepository,
        user_repository: UserRepository | None = None,
        safety_extractor: SafetyRulesExtractor | None = None,
        clip_mapping_client: CLIPMappingClient | None = None,
        clip_mapping_client_factory: Callable[[], CLIPMappingClient | None] | None = None,
    ) -> None:
        self.regulation_repository = regulation_repository
        self.rule_repository = rule_repository
        self.storage_client = storage_client
        self.alert_repository = alert_repository
        self.user_repository = user_repository
        self.safety_extractor = safety_extractor
        self.clip_mapping_client = clip_mapping_client
        self.clip_mapping_client_factory = clip_mapping_client_factory

    @classmethod
    def create(
        cls,
        regulation_repository: RegulationRepository,
        rule_repository: ExtractedRuleRepository,
        storage_client: StorageClient,
        alert_repository: AlertRepository,
        user_repository: UserRepository | None = None,
    ) -> "RegulationService":
        """Factory method to create regulation service."""
        settings = get_settings()

        return cls(
            regulation_repository=regulation_repository,
            rule_repository=rule_repository,
            storage_client=storage_client,
            alert_repository=alert_repository,
            user_repository=user_repository,
            safety_extractor=SafetyRulesExtractor(settings.HF_TOKEN),
            clip_mapping_client_factory=cls._build_clip_mapping_client,
        )

    async def upload_and_extract_regulation(
        self,
        *,
        file: UploadFile,
        current_user: dict,
        title: str | None = None,
        description: str | None = None,
    ) -> RegulationUploadResponse:
        payload = await self.upload_regulation_file(
            file=file,
            current_user=current_user,
            title=title,
            description=description,
        )
        if payload.regulation is None:
            raise AppError("Regulation upload succeeded but the saved record could not be found")
        extracted_payload = await self.extract_regulation(payload.regulation.id, current_user)
        return RegulationUploadResponse(
            regulation=extracted_payload.regulation,
            regulations=extracted_payload.regulations,
            extracted_rules=extracted_payload.extracted_rules,
            summary=extracted_payload.summary,
        )

    async def upload_regulation_file(
        self,
        *,
        file: UploadFile,
        current_user: dict,
        title: str | None = None,
        description: str | None = None,
    ) -> RegulationCurrentResponse:
        self._ensure_admin(current_user)

        filename = file.filename or "regulation.pdf"
        if not is_supported_pdf_upload(filename, file.content_type):
            raise AppError("Only PDF regulation files are supported")

        settings = get_settings()
        file_content = await file.read()
        ensure_file_size(file_content, max_size_mb=settings.MAX_PDF_SIZE_MB, label=filename)

        organization_id = current_user["organization_id"]
        current_regulation = await self.regulation_repository.get_current_regulation(organization_id)
        latest_uploaded_regulation = await self.regulation_repository.get_latest_regulation(organization_id)
        existing_regulations = await self.regulation_repository.list_regulations(organization_id)

        if current_regulation is not None and self._is_running_extraction_status(current_regulation.extraction.status):
            raise AppError("Stop the current extraction before uploading a new PDF.")

        next_version = (latest_uploaded_regulation.version + 1) if latest_uploaded_regulation is not None else 1
        regulation_id = ObjectId()
        stored_file = await self.storage_client.save_bytes(
            content=file_content,
            original_filename=filename,
            mime_type=file.content_type or "application/pdf",
            subdirectory=f"regulations/{organization_id}/{regulation_id}/v{next_version}",
        )
        regulation = RegulationModel(
            id=regulation_id,
            organization_id=organization_id,
            title=title or Path(filename).stem,
            description=description,
            document_type="safety_regulation",
            status=RegulationStatus.ACTIVE,
            file=stored_file,
            version=next_version,
            uploaded_by=current_user["_id"],
            created_by=current_user["_id"],
            updated_by=current_user["_id"],
            extraction=RegulationExtractionState(
                status=ExtractionStatus.NOT_STARTED,
                model_name=self.safety_extractor.model if self.safety_extractor else None,
            ),
        )
        saved_regulation = await self.regulation_repository.create(regulation)
        await self.regulation_repository.set_current_regulation(
            organization_id,
            regulation_id,
            updated_by=current_user["_id"],
        )
        await self.rule_repository.deactivate_rules_by_organization(
            organization_id,
            updated_by=current_user["_id"],
        )

        payload = await self._build_regulation_payload(saved_regulation)
        merged_regulations = {regulation.id: regulation for regulation in payload.regulations}

        for existing_regulation in existing_regulations:
            existing_data = existing_regulation.model_dump(by_alias=True)
            existing_data["status"] = RegulationStatus.SUPERSEDED
            existing_response = self._regulation_response(existing_data)
            merged_regulations.setdefault(existing_response.id, existing_response)

        return RegulationCurrentResponse(
            regulation=payload.regulation,
            regulations=sorted(
                merged_regulations.values(),
                key=lambda regulation_response: (
                    regulation_response.status != RegulationStatus.ACTIVE,
                    -regulation_response.version,
                ),
            ),
            extracted_rules=payload.extracted_rules,
            summary=payload.summary,
        )

    async def get_current_regulation(self, current_user: dict) -> RegulationCurrentResponse:
        current_regulation = await self.regulation_repository.get_current_regulation(current_user["organization_id"])
        if current_regulation is None:
            return await self._empty_regulation_payload(current_user["organization_id"])
        current_regulation = await self._reconcile_stale_extraction_state(current_regulation)
        return await self._build_regulation_payload(current_regulation)

    async def list_regulations(self, current_user: dict) -> list[RegulationResponse]:
        self._ensure_admin(current_user)
        regulations = await self.regulation_repository.list_regulations(current_user["organization_id"])
        return [
            self._regulation_response(regulation.model_dump(by_alias=True))
            for regulation in regulations
        ]

    async def extract_regulation(self, regulation_id: str, current_user: dict) -> RegulationCurrentResponse:
        self._ensure_admin(current_user)

        if not self.safety_extractor:
            raise AppError("Safety rules extractor is not configured. Please set HF_TOKEN in the backend environment.")

        regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if regulation is None:
            raise AppError("Regulation not found")

        if str(regulation["organization_id"]) != str(current_user["organization_id"]):
            raise PermissionDeniedError("Regulation does not belong to your organization")

        regulation = await self._reconcile_stale_extraction_state(regulation)
        current_status = str((regulation.get("extraction") or {}).get("status", ExtractionStatus.NOT_STARTED))
        if self._is_running_extraction_status(current_status):
            raise AppError("Extraction is already in progress for this PDF.")

        await self.rule_repository.soft_delete_by_regulation(regulation_id, updated_by=current_user["_id"])
        updated_regulation = await self.regulation_repository.update_extraction_status(
            regulation_id,
            ExtractionStatus.PENDING,
            error_message=None,
            rules_count=0,
            model_name=self.safety_extractor.model,
        )
        if updated_regulation is None:
            raise AppError("Failed to queue the regulation extraction")

        self._queue_extraction_job(
            regulation_id=regulation_id,
            organization_id=str(current_user["organization_id"]),
            updated_by=current_user["_id"],
        )

        return await self._build_regulation_payload(updated_regulation)

    async def cancel_extraction(self, regulation_id: str, current_user: dict) -> RegulationCurrentResponse:
        self._ensure_admin(current_user)

        regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if regulation is None:
            raise AppError("Regulation not found")

        if str(regulation["organization_id"]) != str(current_user["organization_id"]):
            raise PermissionDeniedError("Regulation does not belong to your organization")

        current_status = str((regulation.get("extraction") or {}).get("status", ExtractionStatus.NOT_STARTED))
        if not self._is_running_extraction_status(current_status):
            raise AppError("Extraction is not currently running for this PDF.")

        updated = await self.regulation_repository.update_extraction_status(
            regulation_id,
            ExtractionStatus.CANCELLING,
            error_message="Stopping extraction...",
            rules_count=0,
            model_name=self.safety_extractor.model if self.safety_extractor else None,
        )
        if updated is None:
            raise AppError("Failed to stop extraction.")

        self._request_job_stop(regulation_id)
        return await self._build_regulation_payload(updated)

    async def activate_regulation(self, regulation_id: str, current_user: dict) -> RegulationCurrentResponse:
        self._ensure_admin(current_user)

        regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if regulation is None:
            raise AppError("Regulation not found")

        if str(regulation["organization_id"]) != str(current_user["organization_id"]):
            raise PermissionDeniedError("Regulation does not belong to your organization")

        current_status = str((regulation.get("extraction") or {}).get("status", ExtractionStatus.NOT_STARTED))
        if self._is_running_extraction_status(current_status):
            raise AppError("Wait for the current extraction to finish before switching regulations.")

        updated_regulation = await self.regulation_repository.set_current_regulation(
            current_user["organization_id"],
            regulation_id,
            updated_by=current_user["_id"],
        )
        if updated_regulation is None:
            raise AppError("Failed to activate the selected regulation")

        await self.rule_repository.deactivate_rules_by_organization(
            current_user["organization_id"],
            updated_by=current_user["_id"],
        )
        await self.rule_repository.set_rule_status_by_regulation(
            regulation_id,
            EntityStatus.ACTIVE,
            updated_by=current_user["_id"],
        )

        return await self._build_regulation_payload(updated_regulation)

    async def get_regulation_file_download(self, regulation_id: str, current_user: dict) -> tuple[bytes, str, str]:
        self._ensure_admin(current_user)

        regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if regulation is None:
            raise AppError("Regulation not found")

        if str(regulation["organization_id"]) != str(current_user["organization_id"]):
            raise PermissionDeniedError("Regulation does not belong to your organization")

        file_data = regulation.get("file") or {}
        storage_path = file_data.get("storage_path")
        if not storage_path:
            raise AppError("Regulation file is missing from storage")

        content = await self.storage_client.read_bytes(storage_path)
        filename = file_data.get("original_filename") or f"{regulation.get('title', 'regulation')}.pdf"
        mime_type = file_data.get("mime_type") or "application/pdf"
        return content, filename, mime_type

    async def delete_regulation(self, regulation_id: str, current_user: dict) -> None:
        self._ensure_admin(current_user)

        regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if regulation is None:
            raise AppError("Regulation not found")

        if str(regulation["organization_id"]) != str(current_user["organization_id"]):
            raise PermissionDeniedError("Regulation does not belong to your organization")

        self._request_job_stop(regulation_id)
        await self._delete_stored_file((regulation.get("file") or {}).get("storage_path"))
        await self._delete_alerts_for_regulation(
            regulation_id=regulation_id,
            organization_id=current_user["organization_id"],
            updated_by=current_user["_id"],
        )
        await self.rule_repository.soft_delete_by_regulation(regulation_id, updated_by=current_user["_id"])
        deleted = await self.regulation_repository.soft_delete(validate_object_id(regulation_id), updated_by=current_user["_id"])
        if not deleted:
            raise AppError("Failed to delete the regulation")

        if str(regulation.get("status")) == RegulationStatus.ACTIVE:
            remaining_regulations = await self.regulation_repository.list_regulations(current_user["organization_id"])
            replacement = remaining_regulations[0] if remaining_regulations else None
            await self.rule_repository.deactivate_rules_by_organization(
                current_user["organization_id"],
                updated_by=current_user["_id"],
            )
            if replacement is not None:
                await self.regulation_repository.set_current_regulation(
                    current_user["organization_id"],
                    replacement.id,
                    updated_by=current_user["_id"],
                )
                await self.rule_repository.set_rule_status_by_regulation(
                    replacement.id,
                    EntityStatus.ACTIVE,
                    updated_by=current_user["_id"],
                )

    async def set_face_recognition_enabled(
        self,
        regulation_id: str,
        enabled: bool,
        current_user: dict,
    ) -> FaceRecognitionSettingResponse:
        await self.set_module_enabled(regulation_id, "face_recognition", enabled, current_user)
        return FaceRecognitionSettingResponse(enabled=enabled)

    async def set_module_enabled(
        self,
        regulation_id: str,
        module_name: str,
        enabled: bool,
        current_user: dict,
    ) -> RegulationCurrentResponse:
        self._ensure_admin(current_user)

        regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if regulation is None:
            raise AppError("Regulation not found")

        if str(regulation["organization_id"]) != str(current_user["organization_id"]):
            raise PermissionDeniedError("Regulation does not belong to your organization")

        category = self._module_name_to_category(module_name)
        organization_id = current_user["organization_id"]
        existing_rules = await self.rule_repository.get_rules_by_regulation(regulation_id)
        category_rules = [rule for rule in existing_rules if rule.category == category]

        if category == RuleCategory.ACCESS_CONTROL:
            if category_rules:
                await self.rule_repository.set_rule_status_by_regulation_and_category(
                    regulation_id,
                    category,
                    EntityStatus.ACTIVE if enabled else EntityStatus.INACTIVE,
                    updated_by=current_user["_id"],
                )
            elif enabled:
                await self._create_manual_module_rule(
                    regulation_id=regulation_id,
                    organization_id=organization_id,
                    category=category,
                    created_by=current_user["_id"],
                )
        elif enabled and not category_rules:
            await self._create_manual_module_rule(
                regulation_id=regulation_id,
                organization_id=organization_id,
                category=category,
                created_by=current_user["_id"],
            )
        else:
            await self.rule_repository.set_rule_status_by_regulation_and_category(
                regulation_id,
                category,
                EntityStatus.ACTIVE if enabled else EntityStatus.INACTIVE,
                updated_by=current_user["_id"],
            )

        updated_regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if updated_regulation is None:
            raise AppError("Regulation not found")

        return await self._build_regulation_payload(updated_regulation)

    async def set_rule_enabled(
        self,
        regulation_id: str,
        rule_id: str,
        enabled: bool,
        current_user: dict,
    ) -> RegulationCurrentResponse:
        self._ensure_admin(current_user)

        regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if regulation is None:
            raise AppError("Regulation not found")

        if str(regulation["organization_id"]) != str(current_user["organization_id"]):
            raise PermissionDeniedError("Regulation does not belong to your organization")

        rule = await self.rule_repository.find_by_id(validate_object_id(rule_id))
        if rule is None:
            raise AppError("Extracted rule not found")

        if str(rule["regulation_id"]) != str(regulation["_id"]):
            raise PermissionDeniedError("Extracted rule does not belong to this regulation")

        await self.rule_repository.set_rule_status_by_id(
            rule_id,
            EntityStatus.ACTIVE if enabled else EntityStatus.INACTIVE,
            updated_by=current_user["_id"],
        )

        updated_regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if updated_regulation is None:
            raise AppError("Regulation not found")

        return await self._build_regulation_payload(updated_regulation)

    async def deselect_all_rules(
        self,
        regulation_id: str,
        current_user: dict,
    ) -> RegulationCurrentResponse:
        self._ensure_admin(current_user)

        regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if regulation is None:
            raise AppError("Regulation not found")

        if str(regulation["organization_id"]) != str(current_user["organization_id"]):
            raise PermissionDeniedError("Regulation does not belong to your organization")

        await self.rule_repository.set_rule_status_by_regulation(
            regulation_id,
            EntityStatus.INACTIVE,
            updated_by=current_user["_id"],
        )

        updated_regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if updated_regulation is None:
            raise AppError("Regulation not found")

        return await self._build_regulation_payload(updated_regulation)

    async def select_all_rules(
        self,
        regulation_id: str,
        current_user: dict,
    ) -> RegulationCurrentResponse:
        self._ensure_admin(current_user)

        regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if regulation is None:
            raise AppError("Regulation not found")

        if str(regulation["organization_id"]) != str(current_user["organization_id"]):
            raise PermissionDeniedError("Regulation does not belong to your organization")

        await self.rule_repository.set_rule_status_by_regulation(
            regulation_id,
            EntityStatus.ACTIVE,
            updated_by=current_user["_id"],
        )

        rules = await self.rule_repository.get_rules_by_regulation(regulation_id)
        existing_categories = {rule.category for rule in rules}
        for category in (RuleCategory.FALL, RuleCategory.FIRE_SMOKE, RuleCategory.ACCESS_CONTROL):
            if category not in existing_categories:
                await self._create_manual_module_rule(
                    regulation_id=regulation_id,
                    organization_id=current_user["organization_id"],
                    category=category,
                    created_by=current_user["_id"],
                )

        updated_regulation = await self.regulation_repository.find_by_id(validate_object_id(regulation_id))
        if updated_regulation is None:
            raise AppError("Regulation not found")

        return await self._build_regulation_payload(updated_regulation)

    async def is_face_recognition_enabled(self, organization_id) -> bool:
        rules = await self.rule_repository.get_rules_by_module(
            organization_id,
            VisionModule.FACE_ACCESS_CONTROL,
        )
        return len(rules) > 0

    async def extract_rules_from_regulation(
        self,
        regulation_id: str,
        organization_id: str,
        *,
        cancel_event: Event | None = None,
    ) -> List[ExtractedRuleModel]:
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
        storage_path = regulation["file"]["storage_path"]
        file_content = await self.storage_client.read_bytes(storage_path)
        file_suffix = Path(regulation["file"]["original_filename"]).suffix or ".pdf"

        self._raise_if_cancelled(cancel_event)

        temp_file_path = None
        try:
            with NamedTemporaryFile(suffix=file_suffix, delete=False) as temp_file:
                temp_file.write(file_content)
                temp_file_path = Path(temp_file.name)

            extracted_data = await asyncio.to_thread(
                self.safety_extractor.extract_from_file,
                temp_file_path,
                should_cancel=cancel_event.is_set if cancel_event else None,
            )
        finally:
            if temp_file_path is not None:
                try:
                    temp_file_path.unlink(missing_ok=True)
                except OSError:
                    pass

        self._raise_if_cancelled(cancel_event)

        # Convert extracted data to rule models
        saved_rules = await self._convert_extraction_to_rules(
            extracted_data,
            regulation_id,
            organization_id,
            regulation_status=str(regulation["status"]),
        )

        self._raise_if_cancelled(cancel_event)
        
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
        organization_id: str,
        *,
        regulation_status: str,
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
        rule_status = EntityStatus.ACTIVE if regulation_status == RegulationStatus.ACTIVE else EntityStatus.INACTIVE

        # Process PPE items
        ppe_list = extracted_data.get("PPE_list", [])

        if ppe_list:
            grouped_ppe_items: dict[str, list[str]] = {}
            for ppe_item in ppe_list:
                mapped_class = self._map_single_requirement(
                    ppe_item,
                    PPE_DETECTOR_CLASSES,
                    fallback=self._fallback_ppe_mapping(ppe_item),
                )
                if mapped_class not in grouped_ppe_items:
                    grouped_ppe_items[mapped_class] = []
                if ppe_item not in grouped_ppe_items[mapped_class]:
                    grouped_ppe_items[mapped_class].append(ppe_item)

            for mapped_class, extracted_items in grouped_ppe_items.items():
                extracted_names = ", ".join(extracted_items)

                rule_data = {
                    "regulation_id": regulation_id,
                    "organization_id": organization_id,
                    "rule_code": f"PPE-{len(saved_rules) + 1:03d}",
                    "title": f"PPE Requirement: {mapped_class}",
                    "description": f"Required PPE item: {mapped_class}. Extracted names: {extracted_names}.",
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
                        "text_excerpt": extracted_names,
                    },
                    "status": rule_status,
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
                },
                "status": rule_status,
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
                },
                "status": rule_status,
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
        if not texts or not candidate_classes:
            return []

        clip_mapping_client = self._get_clip_mapping_client()
        if clip_mapping_client is None:
            return []

        try:
            return [
                match.image_class
                for match in clip_mapping_client.match_text_to_classes(texts, candidate_classes, threshold=0.15)
            ]
        except Exception:
            return []

    def _get_clip_mapping_client(self) -> CLIPMappingClient | None:
        if self.clip_mapping_client is not None:
            return self.clip_mapping_client

        if self.clip_mapping_client_factory is None:
            return None

        try:
            self.clip_mapping_client = self.clip_mapping_client_factory()
        except Exception as exc:
            logger.warning("CLIP mapping disabled due to initialization failure: %s", exc)
            self.clip_mapping_client = None
        finally:
            self.clip_mapping_client_factory = None

        return self.clip_mapping_client

    @staticmethod
    def _build_clip_mapping_client() -> CLIPMappingClient | None:
        try:
            return CLIPMappingClient()
        except Exception as exc:
            logger.warning("Unable to initialize CLIP mapping client: %s", exc)
            return None

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

    async def _create_manual_module_rule(
        self,
        *,
        regulation_id: str,
        organization_id,
        category: RuleCategory,
        created_by,
    ) -> ExtractedRuleModel:
        if category == RuleCategory.FALL:
            rule_data = {
                "rule_code": "FALL-MANUAL",
                "title": "Fall Detection Monitoring",
                "description": "Fall detection was manually enabled from regulation controls.",
                "category": RuleCategory.FALL,
                "severity": Severity.CRITICAL,
                "applies_to": {
                    "zone_types": ["production", "warehouse", "heights"],
                    "employee_roles": ["worker", "supervisor"],
                    "camera_tags": ["fall-check"],
                },
                "vision_mapping": {
                    "module": VisionModule.FALL_DETECTION,
                    "required_classes": ["person_fallen"],
                    "violation_when": "detected",
                    "confidence_threshold": 0.7,
                },
                "source": {
                    "text_excerpt": "Fall detection manually enabled from regulation controls.",
                },
            }
        elif category == RuleCategory.FIRE_SMOKE:
            rule_data = {
                "rule_code": "FIRE-MANUAL",
                "title": "Fire/Smoke Detection Monitoring",
                "description": "Fire and smoke detection was manually enabled from regulation controls.",
                "category": RuleCategory.FIRE_SMOKE,
                "severity": Severity.CRITICAL,
                "applies_to": {
                    "zone_types": ["production", "warehouse", "fire_risk"],
                    "employee_roles": ["worker", "supervisor"],
                    "camera_tags": ["fire-check"],
                },
                "vision_mapping": {
                    "module": VisionModule.FIRE_SMOKE_DETECTION,
                    "required_classes": ["fire", "smoke"],
                    "violation_when": "detected",
                    "confidence_threshold": 0.6,
                },
                "source": {
                    "text_excerpt": "Fire/smoke detection manually enabled from regulation controls.",
                },
            }
        elif category == RuleCategory.ACCESS_CONTROL:
            rule_data = {
                "rule_code": "FACE-MANUAL",
                "title": "Face Recognition Access Control",
                "description": "Face recognition is enabled for monitoring based on the uploaded regulation workflow.",
                "category": RuleCategory.ACCESS_CONTROL,
                "severity": Severity.MEDIUM,
                "applies_to": {
                    "zone_types": ["production", "warehouse", "maintenance", "entrance", "restricted"],
                    "employee_roles": ["worker", "supervisor"],
                    "camera_tags": ["face-recognition"],
                },
                "vision_mapping": {
                    "module": VisionModule.FACE_ACCESS_CONTROL,
                    "required_classes": [],
                    "violation_when": "detected",
                    "confidence_threshold": 0.5,
                },
                "source": {
                    "text_excerpt": "Face recognition manually enabled from regulation controls.",
                },
            }
        else:
            raise AppError("This module cannot be created manually")

        rule_model = ExtractedRuleModel(
            regulation_id=validate_object_id(regulation_id),
            organization_id=organization_id,
            status=EntityStatus.ACTIVE,
            created_by=created_by,
            updated_by=created_by,
            **rule_data,
        )
        saved_data = await self.rule_repository.insert_model(rule_model)
        return ExtractedRuleModel(**saved_data)

    @staticmethod
    def _module_name_to_category(module_name: str) -> RuleCategory:
        normalized = module_name.strip().lower().replace("-", "_")
        module_map = {
            "ppe": RuleCategory.PPE,
            "ppe_detection": RuleCategory.PPE,
            "fall": RuleCategory.FALL,
            "fall_detection": RuleCategory.FALL,
            "fire": RuleCategory.FIRE_SMOKE,
            "fire_smoke": RuleCategory.FIRE_SMOKE,
            "fire_detection": RuleCategory.FIRE_SMOKE,
            "fire_smoke_detection": RuleCategory.FIRE_SMOKE,
            "face": RuleCategory.ACCESS_CONTROL,
            "face_recognition": RuleCategory.ACCESS_CONTROL,
            "face_access_control": RuleCategory.ACCESS_CONTROL,
            "access_control": RuleCategory.ACCESS_CONTROL,
        }
        category = module_map.get(normalized)
        if category is None:
            raise AppError("Unsupported regulation module")
        return category

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
        file_data = dict(regulation_doc["file"])
        file_data["public_url"] = None

        return RegulationResponse(
            id=str(regulation_doc["_id"]),
            organization_id=str(regulation_doc["organization_id"]),
            title=regulation_doc["title"],
            description=regulation_doc.get("description"),
            document_type=regulation_doc["document_type"],
            status=str(regulation_doc["status"]),
            version=regulation_doc["version"],
            uploaded_by=str(regulation_doc["uploaded_by"]),
            file=file_data,
            extraction=RegulationExtractionStateResponse(
                status=str((regulation_doc.get("extraction") or {}).get("status", ExtractionStatus.NOT_STARTED)),
                started_at=(regulation_doc.get("extraction") or {}).get("started_at"),
                completed_at=(regulation_doc.get("extraction") or {}).get("completed_at"),
                model_name=(regulation_doc.get("extraction") or {}).get("model_name"),
                error_message=(regulation_doc.get("extraction") or {}).get("error_message"),
                rules_count=(regulation_doc.get("extraction") or {}).get("rules_count", 0),
            ),
            created_at=regulation_doc["created_at"],
            updated_at=regulation_doc["updated_at"],
        )

    def _rule_response(self, rule: ExtractedRuleModel) -> ExtractedRuleResponse:
        return ExtractedRuleResponse(
            id=str(rule.id),
            category=str(rule.category),
            status=str(rule.status),
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
        active_rules = [rule for rule in rules if rule.status == EntityStatus.ACTIVE.value]
        ppe_items = sorted(
            {
                required_class
                for rule in active_rules
                if rule.category == RuleCategory.PPE.value
                for required_class in rule.required_classes
            }
        )
        return RegulationExtractionSummary(
            total_rules=len(rules),
            ppe_items=ppe_items,
            fall_detection_active=any(rule.category == RuleCategory.FALL.value for rule in active_rules),
            fire_smoke_detection_active=any(rule.category == RuleCategory.FIRE_SMOKE.value for rule in active_rules),
            face_recognition_enabled=False,
        )

    async def _build_regulation_payload(self, regulation_doc: dict | RegulationModel) -> RegulationCurrentResponse:
        regulation_data = regulation_doc.model_dump(by_alias=True) if isinstance(regulation_doc, RegulationModel) else regulation_doc
        rules = await self.rule_repository.get_rules_by_regulation(regulation_data["_id"])
        regulations = await self.regulation_repository.list_regulations(regulation_data["organization_id"])
        rule_responses = [self._rule_response(rule) for rule in rules]
        summary = self._build_summary(rule_responses)
        summary.face_recognition_enabled = any(
            rule.category == RuleCategory.ACCESS_CONTROL.value and rule.status == EntityStatus.ACTIVE.value
            for rule in rule_responses
        )
        return RegulationCurrentResponse(
            regulation=self._regulation_response(regulation_data),
            regulations=[self._regulation_response(regulation.model_dump(by_alias=True)) for regulation in regulations],
            extracted_rules=rule_responses,
            summary=summary,
            admin_name=await self._get_admin_name(regulation_data["organization_id"]),
        )

    async def _empty_regulation_payload(self, organization_id) -> RegulationCurrentResponse:
        regulations = await self.regulation_repository.list_regulations(organization_id)
        return RegulationCurrentResponse(
            regulation=None,
            regulations=[self._regulation_response(regulation.model_dump(by_alias=True)) for regulation in regulations],
            extracted_rules=[],
            summary=RegulationExtractionSummary(
                total_rules=0,
                ppe_items=[],
                fall_detection_active=False,
                fire_smoke_detection_active=False,
                face_recognition_enabled=False,
            ),
            admin_name=await self._get_admin_name(organization_id),
        )

    async def _get_admin_name(self, organization_id) -> str | None:
        if self.user_repository is None:
            return None

        users = await self.user_repository.list_by_organization(organization_id)
        admin = next((user for user in users if str(user.get("role")) == "admin"), None)
        if admin is None:
            return None

        return admin.get("full_name") or admin.get("email")

    async def _delete_stored_file(self, storage_path: str | None) -> None:
        if not storage_path:
            return
        await self.storage_client.delete_bytes(storage_path)

    async def _delete_alerts_for_regulation(self, *, regulation_id: str, organization_id, updated_by) -> None:
        regulation_object_id = validate_object_id(regulation_id)
        organization_object_id = (
            organization_id if isinstance(organization_id, ObjectId) else validate_object_id(organization_id)
        )
        alerts = await self.alert_repository.list_by_regulation(
            organization_object_id,
            regulation_object_id,
        )
        if not alerts:
            return

        for alert in alerts:
            evidence = alert.get("evidence") or {}
            frame_storage_path = evidence.get("frame_storage_path")
            clip_storage_path = evidence.get("clip_storage_path")
            if frame_storage_path:
                await self.storage_client.delete_bytes(frame_storage_path)
            if clip_storage_path:
                await self.storage_client.delete_bytes(clip_storage_path)

        await self.alert_repository.hard_delete_by_ids(
            [alert["_id"] for alert in alerts if alert.get("_id") is not None],
        )

    def _queue_extraction_job(self, *, regulation_id: str, organization_id: str, updated_by) -> None:
        self._request_job_stop(regulation_id)
        task = asyncio.create_task(
            self._run_extraction_job(
                regulation_id=regulation_id,
                organization_id=organization_id,
                updated_by=updated_by,
            )
        )
        self._jobs[str(regulation_id)] = task

    async def _run_extraction_job(self, *, regulation_id: str, organization_id: str, updated_by) -> None:
        cancel_event = self._start_cancel_event(regulation_id)
        try:
            updated = await self.regulation_repository.update_extraction_status(
                regulation_id,
                ExtractionStatus.PROCESSING,
                error_message=None,
                rules_count=0,
                model_name=self.safety_extractor.model if self.safety_extractor else None,
            )
            if updated is None:
                return

            await self.extract_rules_from_regulation(
                regulation_id,
                organization_id,
                cancel_event=cancel_event,
            )
        except (ExtractionCancelledError, asyncio.CancelledError):
            await self.regulation_repository.update_extraction_status(
                regulation_id,
                ExtractionStatus.CANCELLED,
                error_message="Extraction stopped by admin.",
                rules_count=0,
                model_name=self.safety_extractor.model if self.safety_extractor else None,
            )
        except Exception as exc:
            await self.regulation_repository.update_extraction_status(
                regulation_id,
                ExtractionStatus.FAILED,
                error_message=str(exc),
                rules_count=0,
                model_name=self.safety_extractor.model if self.safety_extractor else None,
            )
        finally:
            self._clear_cancel_event(regulation_id)
            self._jobs.pop(str(regulation_id), None)

    async def _reconcile_stale_extraction_state(self, regulation_doc: dict | RegulationModel) -> dict | RegulationModel:
        regulation_data = regulation_doc.model_dump(by_alias=True) if isinstance(regulation_doc, RegulationModel) else regulation_doc
        regulation_id = str(regulation_data["_id"])
        current_status = str((regulation_data.get("extraction") or {}).get("status", ExtractionStatus.NOT_STARTED))

        if not self._is_running_extraction_status(current_status):
            return regulation_doc

        active_job = self._jobs.get(regulation_id)
        if active_job is not None and not active_job.done():
            return regulation_doc

        existing_rules = await self.rule_repository.get_rules_by_regulation(regulation_data["_id"])
        target_status = ExtractionStatus.COMPLETED if existing_rules else (
            ExtractionStatus.CANCELLED if current_status == ExtractionStatus.CANCELLING else ExtractionStatus.FAILED
        )
        error_message = None
        if not existing_rules:
            error_message = "Extraction was interrupted. Please start again." if target_status == ExtractionStatus.FAILED else "Extraction stopped by admin."

        updated = await self.regulation_repository.update_extraction_status(
            regulation_id,
            target_status,
            error_message=error_message,
            rules_count=len(existing_rules),
            model_name=(regulation_data.get("extraction") or {}).get("model_name"),
        )
        return updated or regulation_doc

    def _start_cancel_event(self, regulation_id: str) -> Event:
        cancel_event = Event()
        self._cancel_events[str(regulation_id)] = cancel_event
        return cancel_event

    def _request_job_stop(self, regulation_id: str) -> None:
        cancel_event = self._cancel_events.get(str(regulation_id))
        if cancel_event is not None:
            cancel_event.set()

        job = self._jobs.get(str(regulation_id))
        if job is not None and not job.done():
            job.cancel()

    def _clear_cancel_event(self, regulation_id: str) -> None:
        self._cancel_events.pop(str(regulation_id), None)

    @staticmethod
    def _raise_if_cancelled(cancel_event: Event | None) -> None:
        if cancel_event and cancel_event.is_set():
            raise ExtractionCancelledError("Extraction stopped by admin.")

    @staticmethod
    def _is_running_extraction_status(status: str | ExtractionStatus) -> bool:
        return str(status) in {
            ExtractionStatus.PENDING,
            ExtractionStatus.PROCESSING,
            ExtractionStatus.CANCELLING,
        }
