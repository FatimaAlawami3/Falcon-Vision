from datetime import datetime

from pydantic import BaseModel


class AlertResponse(BaseModel):
    id: str
    title: str
    message: str
    category: str
    severity: str
    status: str
    detected_at: datetime
    camera_name: str | None = None
    zone_name: str | None = None
    employee_name: str | None = None
    evidence_image_path: str | None = None


class AlertListResponse(BaseModel):
    items: list[AlertResponse]
    total: int


class AlertClearRequest(BaseModel):
    alert_ids: list[str]
