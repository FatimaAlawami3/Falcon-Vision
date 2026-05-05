import re
from datetime import datetime

from bson import ObjectId

from app.core.constants import MonitoringSessionStatus, VisionModule
from app.models.monitoring_session_model import (
    MonitoringSessionModel,
    MonitoringSessionReport,
    MonitoringSessionReportAlert,
    MonitoringSessionReportRegulation,
    MonitoringSessionReportSummary,
    MonitoringSessionReportSupervisor,
    MonitoringSessionStats,
)
from app.repositories.monitoring_session_repository import MonitoringSessionRepository
from app.repositories.regulation_repository import RegulationRepository
from app.schemas.monitoring_session_schema import (
    MonitoringSessionReportDocumentResponse,
    MonitoringSessionReportResponse,
    SaveMonitoringSessionReportRequest,
)
from app.utils.datetime import utc_now


class MonitoringSessionService:
    def __init__(
        self,
        monitoring_session_repository: MonitoringSessionRepository,
        regulation_repository: RegulationRepository,
    ) -> None:
        self.monitoring_session_repository = monitoring_session_repository
        self.regulation_repository = regulation_repository

    async def save_session_report(
        self,
        payload: SaveMonitoringSessionReportRequest,
        current_user: dict,
    ) -> MonitoringSessionReportResponse:
        organization_id = self._ensure_object_id(current_user["organization_id"])
        started_at = payload.started_at
        ended_at = payload.ended_at or utc_now()
        duration_seconds = self._calculate_duration_seconds(started_at, ended_at)

        summary = self._build_summary(payload)
        current_regulation = await self.regulation_repository.get_current_regulation(organization_id)
        modules = self._normalize_modules(payload.modules, payload.face_recognition_enabled)
        report_name = self._build_report_name(ended_at)

        monitoring_session = MonitoringSessionModel(
            organization_id=organization_id,
            created_by=current_user["_id"],
            updated_by=current_user["_id"],
            name=report_name,
            modules=modules,
            status=MonitoringSessionStatus.STOPPED,
            started_at=started_at,
            ended_at=ended_at,
            started_by=current_user["_id"],
            stopped_by=current_user["_id"],
            stats=MonitoringSessionStats(
                detections_count=payload.head_count or 0,
                alerts_count=summary.total_alerts,
            ),
            report=MonitoringSessionReport(
                zone=payload.zone,
                head_count=payload.head_count,
                face_recognition_enabled=payload.face_recognition_enabled,
                duration_seconds=duration_seconds,
                supervisor=MonitoringSessionReportSupervisor(
                    id=str(current_user["_id"]),
                    full_name=current_user.get("full_name"),
                    email=current_user.get("email"),
                    role=str(current_user.get("role")) if current_user.get("role") is not None else None,
                ),
                active_regulation=(
                    MonitoringSessionReportRegulation(
                        id=str(current_regulation.id),
                        title=current_regulation.title,
                        version=current_regulation.version,
                        status=str(current_regulation.status),
                    )
                    if current_regulation is not None
                    else None
                ),
                summary=summary,
                alerts=[
                    MonitoringSessionReportAlert(
                        alert_id=alert.alert_id,
                        occurred_at=alert.occurred_at,
                        image_label=alert.image_label,
                        type_label=alert.type_label,
                        detail=alert.detail,
                        group=alert.group,
                        persisted=alert.persisted,
                    )
                    for alert in payload.alerts
                ],
            ),
        )

        saved = await self.monitoring_session_repository.create(monitoring_session)
        report_id = str(saved["_id"])
        filename = self._build_filename(ended_at)
        report = self._to_report_document(saved, report_id)

        return MonitoringSessionReportResponse(
            report_id=report_id,
            filename=filename,
            report=report,
        )

    def _build_summary(self, payload: SaveMonitoringSessionReportRequest) -> MonitoringSessionReportSummary:
        critical_alerts = sum(1 for alert in payload.alerts if alert.group == "critical")
        compliance_alerts = sum(1 for alert in payload.alerts if alert.group == "compliance")
        other_alerts = sum(1 for alert in payload.alerts if alert.group == "other")
        persisted_alerts = sum(1 for alert in payload.alerts if alert.persisted)
        total_alerts = len(payload.alerts)
        return MonitoringSessionReportSummary(
            total_alerts=total_alerts,
            critical_alerts=critical_alerts,
            compliance_alerts=compliance_alerts,
            other_alerts=other_alerts,
            persisted_alerts=persisted_alerts,
            live_only_alerts=total_alerts - persisted_alerts,
        )

    def _normalize_modules(self, modules: list[str], face_recognition_enabled: bool) -> list[VisionModule]:
        normalized: list[VisionModule] = []
        for module in modules:
            try:
                parsed = VisionModule(module)
            except ValueError:
                continue
            if parsed not in normalized:
                normalized.append(parsed)

        if face_recognition_enabled and VisionModule.FACE_ACCESS_CONTROL not in normalized:
            normalized.append(VisionModule.FACE_ACCESS_CONTROL)

        return normalized

    def _to_report_document(self, saved: dict, report_id: str) -> MonitoringSessionReportDocumentResponse:
        report = saved.get("report") or {}
        supervisor = report.get("supervisor") or {}
        active_regulation = report.get("active_regulation")
        summary = report.get("summary") or {}
        alerts = report.get("alerts") or []

        return MonitoringSessionReportDocumentResponse(
            report_id=report_id,
            report_name=saved["name"],
            saved_at=saved["created_at"],
            organization_id=str(saved["organization_id"]),
            supervisor=supervisor,
            session={
                "started_at": saved.get("started_at"),
                "ended_at": saved.get("ended_at"),
                "duration_seconds": report.get("duration_seconds"),
                "zone": report.get("zone"),
                "head_count": report.get("head_count"),
                "modules": [str(module) for module in saved.get("modules", [])],
                "face_recognition_enabled": report.get("face_recognition_enabled", True),
            },
            active_regulation=active_regulation,
            summary=summary,
            alerts=alerts,
        )

    def _build_report_name(self, ended_at: datetime) -> str:
        return f"Monitoring Session Report {ended_at.strftime('%Y-%m-%d %H:%M:%S UTC')}"

    def _build_filename(self, ended_at: datetime) -> str:
        safe_timestamp = re.sub(r"[^0-9A-Za-z_-]+", "-", ended_at.strftime("%Y-%m-%d_%H-%M-%S"))
        return f"monitoring-session-report-{safe_timestamp}.json"

    def _calculate_duration_seconds(self, started_at: datetime | None, ended_at: datetime) -> int | None:
        if started_at is None:
            return None

        duration = int((ended_at - started_at).total_seconds())
        return max(duration, 0)

    def _ensure_object_id(self, value: str | ObjectId) -> ObjectId:
        return value if isinstance(value, ObjectId) else ObjectId(value)
