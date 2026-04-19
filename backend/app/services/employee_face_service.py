from io import BytesIO
from pathlib import PurePosixPath
from zipfile import BadZipFile, ZipFile

from bson import ObjectId
from fastapi import UploadFile
import numpy as np

from app.core.constants import RuleCategory, Severity, UserRole, VisionModule, normalize_user_role
from app.core.exceptions import AppError, NotFoundError, PermissionDeniedError
from app.integrations.ai.face_recognition_client import FaceRecognitionClient
from app.integrations.storage.storage_client import StorageClient
from app.models.employee_face_model import EmployeeFaceModel, FaceQuality
from app.repositories.employee_face_repository import EmployeeFaceRepository
from app.repositories.extracted_rule_repository import ExtractedRuleRepository
from app.services.alert_service import AlertService
from app.schemas.employee_face_schema import (
    EmployeeFaceResponse,
    EmployeeFaceUploadFailure,
    EmployeeFaceUploadResponse,
    FaceEmbeddingResponse,
    FaceBoxResponse,
    FaceQualityResponse,
    FaceRecognitionResponse,
    FaceRecognitionStatusResponse,
)
from app.utils.datetime import utc_now
from app.utils.file_validation import (
    ensure_file_size,
    infer_image_mime_type,
    is_image_filename,
    is_supported_face_upload,
    is_zip_filename,
)
from app.utils.object_id import validate_object_id


ADMIN_UPLOAD_ROLES = {
    UserRole.ADMIN,
}


class EmployeeFaceService:
    def __init__(
        self,
        employee_face_repository: EmployeeFaceRepository,
        extracted_rule_repository: ExtractedRuleRepository,
        alert_service: AlertService,
        storage_client: StorageClient,
        face_recognition_client: FaceRecognitionClient,
        *,
        max_face_image_size_mb: int,
    ) -> None:
        self.employee_face_repository = employee_face_repository
        self.extracted_rule_repository = extracted_rule_repository
        self.alert_service = alert_service
        self.storage_client = storage_client
        self.face_recognition_client = face_recognition_client
        self.max_face_image_size_mb = max_face_image_size_mb

    async def upload_faces(
        self,
        employee_id: str,
        files: list[UploadFile],
        current_user: dict,
    ) -> EmployeeFaceUploadResponse:
        self._ensure_upload_permission(current_user)

        if not files:
            raise AppError("At least one image or zip file is required")

        employee_object_id = validate_object_id(employee_id)
        organization_id = current_user["organization_id"]

        if not await self.employee_face_repository.employee_exists(organization_id, employee_object_id):
            raise NotFoundError("Employee not found")

        items: list[EmployeeFaceResponse] = []
        failures: list[EmployeeFaceUploadFailure] = []

        for upload_file in files:
            if not is_supported_face_upload(upload_file.filename or "", upload_file.content_type):
                failures.append(
                    EmployeeFaceUploadFailure(
                        filename=upload_file.filename or "unknown",
                        detail="Unsupported file type",
                    )
                )
                continue

            try:
                extracted_files = await self._extract_face_files(upload_file)
            except AppError as exc:
                failures.append(
                    EmployeeFaceUploadFailure(
                        filename=upload_file.filename or "unknown",
                        detail=exc.detail,
                    )
                )
                continue

            for face_file in extracted_files:
                duplicate = await self.employee_face_repository.find_by_sha256(
                    organization_id,
                    employee_object_id,
                    face_file["sha256"],
                )
                if duplicate is not None:
                    failures.append(
                        EmployeeFaceUploadFailure(
                            filename=face_file["filename"],
                            detail="This image was already uploaded for this employee",
                        )
                    )
                    continue

                stored_file = await self.storage_client.save_bytes(
                    content=face_file["content"],
                    original_filename=face_file["filename"],
                    mime_type=face_file["mime_type"],
                    subdirectory=f"employee_faces/{organization_id}/{employee_object_id}",
                )

                employee_face = EmployeeFaceModel(
                    organization_id=organization_id,
                    employee_id=employee_object_id,
                    image=stored_file,
                    quality=FaceQuality(),
                    created_by=current_user["_id"],
                    updated_by=current_user["_id"],
                )

                saved_face = await self.employee_face_repository.create(employee_face)
                items.append(self._to_employee_face_response(saved_face))

        return EmployeeFaceUploadResponse(
            uploaded_count=len(items),
            failed_count=len(failures),
            items=items,
            failures=failures,
        )

    async def recognize_face(
        self,
        file: UploadFile,
        current_user: dict,
    ) -> FaceRecognitionResponse:
        if not await self.is_face_recognition_enabled(current_user):
            raise AppError("Face recognition is disabled for this organization")

        extracted_files = await self._extract_face_files(file)
        if len(extracted_files) != 1:
            raise AppError("Recognition expects exactly one image file")

        face_file = extracted_files[0]
        probe_embedding = self.face_recognition_client.extract_embedding(face_file["content"])
        if probe_embedding is None:
            return FaceRecognitionResponse(
                status="no_face",
                authorized=False,
                threshold=self.face_recognition_client.match_threshold,
            )

        gallery = await self.employee_face_repository.list_active_faces(ObjectId(current_user["organization_id"]))
        if not gallery:
            created_alert = await self.alert_service.create_alert(
                organization_id=current_user["organization_id"],
                title="No face gallery uploaded",
                message="No face gallery uploaded",
                category=RuleCategory.ACCESS_CONTROL,
                severity=Severity.MEDIUM,
                image_bytes=face_file["content"],
                bbox=probe_embedding.bbox,
            )
            return FaceRecognitionResponse(
                status="no_gallery",
                authorized=False,
                threshold=self.face_recognition_client.match_threshold,
                face_box=FaceBoxResponse(
                    x1=probe_embedding.bbox[0],
                    y1=probe_embedding.bbox[1],
                    x2=probe_embedding.bbox[2],
                    y2=probe_embedding.bbox[3],
                    image_width=probe_embedding.image_width,
                    image_height=probe_embedding.image_height,
                ),
                alert=created_alert,
            )

        probe_vector = np.asarray(probe_embedding.vector, dtype=np.float32)
        employee_gallery = await self._build_employee_gallery(gallery)
        if not employee_gallery:
            raise NotFoundError("No valid employee face embeddings were found")

        best_face_doc: dict | None = None
        best_employee_id = None
        best_score = -1.0
        for employee_id, employee_data in employee_gallery.items():
            stacked_vectors = np.stack(employee_data["vectors"], axis=0).astype(np.float32)
            average_vector = np.mean(stacked_vectors, axis=0)
            average_vector /= np.linalg.norm(average_vector) + 1e-12

            score = float(np.dot(probe_vector, average_vector))
            if score > best_score:
                best_score = score
                best_employee_id = employee_id
                best_face_index = int(np.argmax(stacked_vectors @ probe_vector))
                best_face_doc = employee_data["face_docs"][best_face_index]

        if best_face_doc is None or best_employee_id is None:
            raise NotFoundError("No valid employee face embeddings were found")

        employee = await self.employee_face_repository.get_employee(
            current_user["organization_id"],
            best_employee_id,
        )
        employee_name = employee.get("full_name") if employee else None

        authorized = best_score >= self.face_recognition_client.match_threshold
        response = FaceRecognitionResponse(
            status="ok",
            authorized=authorized,
            threshold=self.face_recognition_client.match_threshold,
            score=best_score,
            matched_face_id=str(best_face_doc["_id"]),
            matched_employee_id=str(best_employee_id),
            matched_employee_name=employee_name,
            face_box=FaceBoxResponse(
                x1=probe_embedding.bbox[0],
                y1=probe_embedding.bbox[1],
                x2=probe_embedding.bbox[2],
                y2=probe_embedding.bbox[3],
                image_width=probe_embedding.image_width,
                image_height=probe_embedding.image_height,
            ),
        )
        if not authorized:
            alert_title = "Unauthorized face" if employee_name else "Unknown face"
            created_alert = await self.alert_service.create_alert(
                organization_id=current_user["organization_id"],
                title=alert_title,
                message=alert_title,
                category=RuleCategory.ACCESS_CONTROL,
                severity=Severity.MEDIUM,
                image_bytes=face_file["content"],
                bbox=probe_embedding.bbox,
                employee_name=employee_name,
            )
            response.alert = created_alert
        return response

    async def get_face_recognition_status(self, current_user: dict) -> FaceRecognitionStatusResponse:
        return FaceRecognitionStatusResponse(
            enabled=await self.is_face_recognition_enabled(current_user)
        )

    async def is_face_recognition_enabled(self, current_user: dict) -> bool:
        face_rules = await self.extracted_rule_repository.get_rules_by_module(
            current_user["organization_id"],
            VisionModule.FACE_ACCESS_CONTROL,
        )
        return len(face_rules) > 0

    def _ensure_upload_permission(self, current_user: dict) -> None:
        if normalize_user_role(current_user["role"]) not in ADMIN_UPLOAD_ROLES:
            raise PermissionDeniedError("Only admins can upload employee faces")

    async def _extract_face_files(self, upload_file: UploadFile) -> list[dict[str, str | bytes]]:
        filename = upload_file.filename or "upload"
        content = await upload_file.read()

        if is_zip_filename(filename):
            if not content:
                raise AppError(f"{filename} is empty")
            return self._extract_zip_images(content, archive_name=filename)

        if not is_image_filename(filename):
            raise AppError("Only .jpg, .jpeg, .png, or .zip face uploads are supported")

        ensure_file_size(content, max_size_mb=self.max_face_image_size_mb, label=filename)

        return [
            {
                "filename": filename,
                "content": content,
                "mime_type": infer_image_mime_type(filename, upload_file.content_type),
                "sha256": self._sha256(content),
            }
        ]

    def _extract_zip_images(self, archive_bytes: bytes, *, archive_name: str) -> list[dict[str, str | bytes]]:
        try:
            archive = ZipFile(BytesIO(archive_bytes))
        except BadZipFile as exc:
            raise AppError(f"{archive_name} is not a valid zip archive") from exc

        extracted_files: list[dict[str, str | bytes]] = []
        for member in archive.infolist():
            if member.is_dir():
                continue

            normalized_name = PurePosixPath(member.filename).name
            if not normalized_name or not is_image_filename(normalized_name):
                continue

            content = archive.read(member)
            ensure_file_size(
                content,
                max_size_mb=self.max_face_image_size_mb,
                label=normalized_name,
            )
            extracted_files.append(
                {
                    "filename": normalized_name,
                    "content": content,
                    "mime_type": infer_image_mime_type(normalized_name),
                    "sha256": self._sha256(content),
                }
            )

        if not extracted_files:
            raise AppError("Zip archive does not contain any supported image files")

        return extracted_files

    def _sha256(self, content: bytes) -> str:
        import hashlib

        return hashlib.sha256(content).hexdigest()

    async def _build_employee_gallery(self, gallery: list[dict]) -> dict:
        employee_gallery: dict = {}

        for face_doc in gallery:
            reference_vector = await self._get_or_create_embedding_vector(face_doc)
            if reference_vector is None:
                continue

            employee_id = face_doc["employee_id"]
            if employee_id not in employee_gallery:
                employee_gallery[employee_id] = {
                    "face_docs": [],
                    "vectors": [],
                }

            employee_gallery[employee_id]["face_docs"].append(face_doc)
            employee_gallery[employee_id]["vectors"].append(reference_vector)

        return employee_gallery

    async def _get_or_create_embedding_vector(self, face_doc: dict) -> np.ndarray | None:
        stored_embedding = face_doc.get("embedding") or {}
        stored_vector = stored_embedding.get("vector") or []
        if stored_vector:
            return np.asarray(stored_vector, dtype=np.float32)

        image = face_doc.get("image") or {}
        storage_path = image.get("storage_path")
        if not storage_path:
            return None

        try:
            reference_image = await self.storage_client.read_bytes(storage_path)
        except OSError:
            return None

        reference_embedding = self.face_recognition_client.extract_embedding(reference_image)
        if reference_embedding is None:
            return None

        refreshed_face_doc = await self.employee_face_repository.update_embedding(
            face_doc["organization_id"],
            self._ensure_object_id(face_doc["_id"]),
            model_name=reference_embedding.model_name,
            dimension=reference_embedding.dimension,
            vector=reference_embedding.vector,
            detection_score=reference_embedding.detection_score,
            frontal=reference_embedding.frontal,
        )
        if refreshed_face_doc is not None:
            face_doc.update(refreshed_face_doc)

        return np.asarray(reference_embedding.vector, dtype=np.float32)

    def _ensure_object_id(self, value: ObjectId | str) -> ObjectId:
        return value if isinstance(value, ObjectId) else ObjectId(value)

    def _to_employee_face_response(self, face_doc: dict) -> EmployeeFaceResponse:
        embedding = face_doc.get("embedding")
        quality = face_doc.get("quality") or {}

        return EmployeeFaceResponse(
            id=str(face_doc["_id"]),
            employee_id=str(face_doc["employee_id"]),
            organization_id=str(face_doc["organization_id"]),
            image=face_doc["image"],
            embedding=FaceEmbeddingResponse(
                model_name=embedding["model_name"],
                dimension=embedding["dimension"],
                created_at=embedding["created_at"],
            )
            if embedding
            else None,
            quality=FaceQualityResponse(
                score=quality.get("score"),
                frontal=quality.get("frontal"),
                has_mask=quality.get("has_mask"),
                lighting=quality.get("lighting"),
            ),
            status=face_doc["status"],
            created_at=face_doc["created_at"],
            updated_at=face_doc["updated_at"],
        )
