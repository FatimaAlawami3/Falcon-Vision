from datetime import datetime

from pydantic import BaseModel, Field

from app.core.constants import AlertStatus, RuleCategory, Severity
from app.models.base import PyObjectId, TenantModel
from app.utils.datetime import utc_now


class AlertSnapshot(BaseModel):
    camera_id: PyObjectId | None = None
    camera_name: str | None = None
    zone_id: PyObjectId | None = None
    zone_name: str | None = None
    employee_id: PyObjectId | None = None
    employee_name: str | None = None
    rule_id: PyObjectId | None = None
    rule_code: str | None = None


class AlertEvidence(BaseModel):
    frame_storage_path: str | None = None
    clip_storage_path: str | None = None


class AlertAction(BaseModel):
    by: PyObjectId | None = None
    at: datetime | None = None
    note: str | None = None


class AlertModel(TenantModel):
    detection_id: PyObjectId | None = None
    monitoring_session_id: PyObjectId | None = None
    regulation_id: PyObjectId | None = None
    title: str
    message: str
    category: RuleCategory
    severity: Severity
    status: AlertStatus = AlertStatus.OPEN
    snapshot: AlertSnapshot = Field(default_factory=AlertSnapshot)
    evidence: AlertEvidence = Field(default_factory=AlertEvidence)
    detected_at: datetime = Field(default_factory=utc_now)
    acknowledged: AlertAction = Field(default_factory=AlertAction)
    resolved: AlertAction = Field(default_factory=AlertAction)
