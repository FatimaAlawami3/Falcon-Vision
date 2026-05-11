import logging
from datetime import timedelta
from io import BytesIO
from typing import Any

import cv2
import numpy as np
from bson import ObjectId

from app.core.exceptions import AppError, PermissionDeniedError
from app.core.constants import AlertStatus, RuleCategory, Severity
from app.models.alert_model import AlertEvidence, AlertModel, AlertSnapshot
from app.repositories.alert_repository import AlertRepository
from app.repositories.regulation_repository import RegulationRepository
from app.schemas.alert_schema import AlertListResponse, AlertResponse
from app.utils.datetime import utc_now
from app.utils.object_id import validate_object_id


logger = logging.getLogger(__name__)

DEFAULT_ALERT_ZONE_NAME = "production"


class AlertService:
    DUPLICATE_WINDOW_SECONDS = 10

    def __init__(
        self,
        alert_repository: AlertRepository,
        storage_client,
        regulation_repository: RegulationRepository,
    ) -> None:
        self.alert_repository = alert_repository
        self.storage_client = storage_client
        self.regulation_repository = regulation_repository

    async def list_alerts(self, organization_id: str | ObjectId, *, limit: int | None = None) -> AlertListResponse:
        organization_object_id = self._ensure_object_id(organization_id)
        alerts = await self.alert_repository.list_by_organization(organization_object_id, limit=limit)
        return AlertListResponse(
            items=[self._to_response(alert) for alert in alerts],
            total=len(alerts),
        )

    async def create_alert(
        self,
        *,
        organization_id: str | ObjectId,
        title: str,
        message: str,
        category: RuleCategory,
        severity: Severity,
        detected_at=None,
        image_bytes: bytes | None = None,
        bbox: list[float] | None = None,
        employee_name: str | None = None,
        zone_name: str | None = DEFAULT_ALERT_ZONE_NAME,
        regulation_id: str | ObjectId | None = None,
    ) -> AlertResponse | None:
        organization_object_id = self._ensure_object_id(organization_id)
        detected_at = detected_at or utc_now()
        duplicate = await self.alert_repository.find_recent_duplicate(
            organization_object_id,
            title=title,
            message=message,
            category=str(category),
            detected_after=detected_at - timedelta(seconds=self.DUPLICATE_WINDOW_SECONDS),
        )
        if duplicate is not None:
            return None

        regulation_object_id = await self._resolve_regulation_id(
            organization_object_id,
            regulation_id=regulation_id,
        )

        evidence_path = None
        if image_bytes and bbox:
            cropped_bytes = self._crop_image_bytes(image_bytes, bbox)
            if cropped_bytes is not None:
                stored = await self.storage_client.save_bytes(
                    content=cropped_bytes,
                    original_filename="alert-evidence.jpg",
                    mime_type="image/jpeg",
                    subdirectory=f"alerts/{organization_object_id}",
                )
                evidence_path = stored.storage_path

        alert = AlertModel(
            organization_id=organization_object_id,
            regulation_id=regulation_object_id,
            title=title,
            message=message,
            category=category,
            severity=severity,
            status=AlertStatus.OPEN,
            snapshot=AlertSnapshot(employee_name=employee_name, zone_name=zone_name or DEFAULT_ALERT_ZONE_NAME),
            evidence=AlertEvidence(frame_storage_path=evidence_path),
            detected_at=detected_at,
        )
        saved = await self.alert_repository.create(alert)
        return self._to_response(saved)

    async def delete_alert(self, alert_id: str, current_user: dict) -> None:
        alert_object_id = validate_object_id(alert_id)
        alert = await self.alert_repository.find_by_id(alert_object_id)
        if alert is None:
            raise AppError("Alert not found")

        if str(alert["organization_id"]) != str(current_user["organization_id"]):
            raise PermissionDeniedError("Alert does not belong to your organization")

        await self._delete_alert_documents([alert], updated_by=current_user["_id"])

    async def clear_alert_history(self, current_user: dict) -> int:
        organization_object_id = self._ensure_object_id(current_user["organization_id"])
        alerts = await self.alert_repository.list_all_by_organization(organization_object_id)
        await self._delete_alert_documents(alerts, updated_by=current_user["_id"])
        return len(alerts)

    async def delete_alerts_for_regulation(
        self,
        regulation_id: str | ObjectId,
        *,
        organization_id: str | ObjectId,
        updated_by,
    ) -> int:
        organization_object_id = self._ensure_object_id(organization_id)
        regulation_object_id = self._ensure_object_id(regulation_id)
        alerts = await self.alert_repository.list_by_regulation(
            organization_object_id,
            regulation_object_id,
        )
        await self._delete_alert_documents(alerts, updated_by=updated_by)
        return len(alerts)

    def _crop_image_bytes(self, image_bytes: bytes, bbox: list[float]) -> bytes | None:
        image = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            return None

        height, width = image.shape[:2]
        x1, y1, x2, y2 = bbox[:4]
        pad_x = max(int((x2 - x1) * 0.15), 8)
        pad_y = max(int((y2 - y1) * 0.15), 8)

        left = max(int(x1) - pad_x, 0)
        top = max(int(y1) - pad_y, 0)
        right = min(int(x2) + pad_x, width)
        bottom = min(int(y2) + pad_y, height)

        if left >= right or top >= bottom:
            return None

        crop = image[top:bottom, left:right]
        success, encoded = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not success:
            return None
        return encoded.tobytes()

    def _to_response(self, alert_doc: dict[str, Any]) -> AlertResponse:
        return AlertResponse(
            id=str(alert_doc["_id"]),
            title=alert_doc["title"],
            message=alert_doc["message"],
            category=str(alert_doc["category"]),
            severity=str(alert_doc["severity"]),
            status=str(alert_doc["status"]),
            detected_at=alert_doc["detected_at"],
            camera_name=(alert_doc.get("snapshot") or {}).get("camera_name"),
            zone_name=(alert_doc.get("snapshot") or {}).get("zone_name") or DEFAULT_ALERT_ZONE_NAME,
            employee_name=(alert_doc.get("snapshot") or {}).get("employee_name"),
            evidence_image_path=self.storage_client.get_access_url(
                (alert_doc.get("evidence") or {}).get("frame_storage_path")
            ),
        )

    async def _resolve_regulation_id(
        self,
        organization_id: ObjectId,
        *,
        regulation_id: str | ObjectId | None,
    ) -> ObjectId | None:
        if regulation_id is not None:
            return self._ensure_object_id(regulation_id)

        current_regulation = await self.regulation_repository.get_current_regulation(organization_id)
        return current_regulation.id if current_regulation is not None else None

    async def _delete_alert_documents(
        self,
        alerts: list[dict[str, Any]],
        *,
        updated_by,
    ) -> None:
        if not alerts:
            return

        for alert in alerts:
            evidence = alert.get("evidence") or {}
            frame_storage_path = evidence.get("frame_storage_path")
            clip_storage_path = evidence.get("clip_storage_path")
            if frame_storage_path:
                await self._delete_storage_path(frame_storage_path)
            if clip_storage_path:
                await self._delete_storage_path(clip_storage_path)

        alert_ids = [alert["_id"] for alert in alerts if alert.get("_id") is not None]
        await self.alert_repository.hard_delete_by_ids(alert_ids)

    async def _delete_storage_path(self, storage_path: str) -> None:
        try:
            await self.storage_client.delete_bytes(storage_path)
        except Exception as exc:
            logger.warning("Failed to delete alert evidence from storage (%s): %s", storage_path, exc)

    def _ensure_object_id(self, value: str | ObjectId) -> ObjectId:
        return value if isinstance(value, ObjectId) else ObjectId(value)
