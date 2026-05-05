from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_monitoring_session_service
from app.schemas.monitoring_session_schema import (
    MonitoringSessionReportResponse,
    SaveMonitoringSessionReportRequest,
)
from app.services.monitoring_session_service import MonitoringSessionService


router = APIRouter(prefix="/api/monitoring-sessions", tags=["monitoring-sessions"])


@router.post("/report", response_model=MonitoringSessionReportResponse)
async def save_monitoring_session_report(
    body: SaveMonitoringSessionReportRequest,
    monitoring_session_service: Annotated[MonitoringSessionService, Depends(get_monitoring_session_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> MonitoringSessionReportResponse:
    return await monitoring_session_service.save_session_report(body, current_user)
