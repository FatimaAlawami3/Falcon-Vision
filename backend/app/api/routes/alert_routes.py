from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import get_alert_service, get_current_user
from app.schemas.alert_schema import AlertListResponse
from app.services.alert_service import AlertService


router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("", response_model=AlertListResponse)
async def list_alerts(
    alert_service: Annotated[AlertService, Depends(get_alert_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
    limit: Annotated[int | None, Query(ge=1)] = None,
) -> AlertListResponse:
    return await alert_service.list_alerts(current_user["organization_id"], limit=limit)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def clear_alert_history(
    alert_service: Annotated[AlertService, Depends(get_alert_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> None:
    await alert_service.clear_alert_history(current_user)


@router.post("/clear", status_code=status.HTTP_204_NO_CONTENT)
async def clear_selected_alert_history(
    alert_service: Annotated[AlertService, Depends(get_alert_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> None:
    await alert_service.clear_alert_history(current_user)


@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert(
    alert_id: str,
    alert_service: Annotated[AlertService, Depends(get_alert_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> None:
    await alert_service.delete_alert(alert_id, current_user)
