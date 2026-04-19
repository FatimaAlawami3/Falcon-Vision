from datetime import timedelta
from io import BytesIO
from typing import Any

import cv2
import numpy as np
from bson import ObjectId

from app.core.constants import AlertStatus, RuleCategory, Severity
from app.models.alert_model import AlertEvidence, AlertModel, AlertSnapshot
from app.repositories.alert_repository import AlertRepository
from app.schemas.alert_schema import AlertListResponse, AlertResponse
from app.utils.datetime import utc_now


class AlertService:
    DUPLICATE_WINDOW_SECONDS = 10

    def __init__(self, alert_repository: AlertRepository, storage_client) -> None:
        self.alert_repository = alert_repository
        self.storage_client = storage_client

    async def list_alerts(self, organization_id: str | ObjectId, *, limit: int = 100) -> AlertListResponse:
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
            title=title,
            message=message,
            category=category,
            severity=severity,
            status=AlertStatus.OPEN,
            snapshot=AlertSnapshot(employee_name=employee_name),
            evidence=AlertEvidence(frame_storage_path=evidence_path),
            detected_at=detected_at,
        )
        saved = await self.alert_repository.create(alert)
        return self._to_response(saved)

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
            zone_name=(alert_doc.get("snapshot") or {}).get("zone_name"),
            employee_name=(alert_doc.get("snapshot") or {}).get("employee_name"),
            evidence_image_path=(alert_doc.get("evidence") or {}).get("frame_storage_path"),
        )

    def _ensure_object_id(self, value: str | ObjectId) -> ObjectId:
        return value if isinstance(value, ObjectId) else ObjectId(value)
