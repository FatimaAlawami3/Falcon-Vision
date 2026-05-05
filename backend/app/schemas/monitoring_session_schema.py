from datetime import datetime

from pydantic import BaseModel, Field


class MonitoringSessionReportAlertRequest(BaseModel):
    alert_id: str | None = None
    occurred_at: datetime
    image_label: str
    type_label: str
    detail: str
    group: str
    persisted: bool = False


class SaveMonitoringSessionReportRequest(BaseModel):
    started_at: datetime | None = None
    ended_at: datetime | None = None
    head_count: int | None = Field(default=None, ge=0)
    zone: str = "production"
    face_recognition_enabled: bool = True
    modules: list[str] = Field(default_factory=list)
    alerts: list[MonitoringSessionReportAlertRequest] = Field(default_factory=list)


class MonitoringSessionReportAlertResponse(BaseModel):
    alert_id: str | None = None
    occurred_at: datetime
    image_label: str
    type_label: str
    detail: str
    group: str
    persisted: bool


class MonitoringSessionReportSupervisorResponse(BaseModel):
    id: str
    full_name: str | None = None
    email: str | None = None
    role: str | None = None


class MonitoringSessionReportRegulationResponse(BaseModel):
    id: str | None = None
    title: str | None = None
    version: int | None = None
    status: str | None = None


class MonitoringSessionReportSummaryResponse(BaseModel):
    total_alerts: int
    critical_alerts: int
    compliance_alerts: int
    other_alerts: int
    persisted_alerts: int
    live_only_alerts: int


class MonitoringSessionReportSessionResponse(BaseModel):
    started_at: datetime | None = None
    ended_at: datetime | None = None
    duration_seconds: int | None = None
    zone: str
    head_count: int | None = None
    modules: list[str] = Field(default_factory=list)
    face_recognition_enabled: bool


class MonitoringSessionReportDocumentResponse(BaseModel):
    report_id: str
    report_name: str
    saved_at: datetime
    organization_id: str
    supervisor: MonitoringSessionReportSupervisorResponse
    session: MonitoringSessionReportSessionResponse
    active_regulation: MonitoringSessionReportRegulationResponse | None = None
    summary: MonitoringSessionReportSummaryResponse
    alerts: list[MonitoringSessionReportAlertResponse]


class MonitoringSessionReportResponse(BaseModel):
    report_id: str
    filename: str
    report: MonitoringSessionReportDocumentResponse
