from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_alert_service, get_current_user
from app.schemas.alert_schema import AlertListResponse
from app.services.alert_service import AlertService


router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("", response_model=AlertListResponse)
async def list_alerts(
    alert_service: Annotated[AlertService, Depends(get_alert_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> AlertListResponse:
    return await alert_service.list_alerts(current_user["organization_id"], limit=limit)
