from datetime import datetime

from pydantic import BaseModel, Field

from app.core.constants import MonitoringSessionStatus, VisionModule
from app.models.base import PyObjectId, TenantModel


class MonitoringSessionStats(BaseModel):
    detections_count: int = 0
    alerts_count: int = 0


class MonitoringSessionReportAlert(BaseModel):
    alert_id: str | None = None
    occurred_at: datetime
    image_label: str
    type_label: str
    detail: str
    group: str
    persisted: bool = False


class MonitoringSessionReportSummary(BaseModel):
    total_alerts: int = 0
    critical_alerts: int = 0
    compliance_alerts: int = 0
    other_alerts: int = 0
    persisted_alerts: int = 0
    live_only_alerts: int = 0


class MonitoringSessionReportSupervisor(BaseModel):
    id: str
    full_name: str | None = None
    email: str | None = None
    role: str | None = None


class MonitoringSessionReportRegulation(BaseModel):
    id: str | None = None
    title: str | None = None
    version: int | None = None
    status: str | None = None


class MonitoringSessionReport(BaseModel):
    zone: str
    head_count: int | None = None
    face_recognition_enabled: bool = True
    duration_seconds: int | None = None
    supervisor: MonitoringSessionReportSupervisor
    active_regulation: MonitoringSessionReportRegulation | None = None
    summary: MonitoringSessionReportSummary
    alerts: list[MonitoringSessionReportAlert] = Field(default_factory=list)


class MonitoringSessionModel(TenantModel):
    name: str
    camera_ids: list[PyObjectId] = Field(default_factory=list)
    zone_ids: list[PyObjectId] = Field(default_factory=list)
    modules: list[VisionModule] = Field(default_factory=list)
    status: MonitoringSessionStatus = MonitoringSessionStatus.SCHEDULED
    started_at: datetime | None = None
    ended_at: datetime | None = None
    started_by: PyObjectId | None = None
    stopped_by: PyObjectId | None = None
    stats: MonitoringSessionStats = Field(default_factory=MonitoringSessionStats)
    report: MonitoringSessionReport | None = None
