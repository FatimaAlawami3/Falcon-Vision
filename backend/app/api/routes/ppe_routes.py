from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile

from app.api.deps import get_current_user, get_ppe_service
from app.schemas.ppe_schema import PPEDetectionResponse, PPEComplianceResponse
from app.services.ppe_service import PPEService


router = APIRouter(prefix="/api/ppe", tags=["ppe-detection"])


@router.post("/detect", response_model=PPEDetectionResponse)
async def detect_ppe(
    file: Annotated[UploadFile, File(...)],
    ppe_service: Annotated[PPEService, Depends(get_ppe_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> PPEDetectionResponse:
    """Detect PPE items in an uploaded image."""
    return await ppe_service.detect_ppe(file, current_user)


@router.post("/check-compliance", response_model=PPEComplianceResponse)
async def check_ppe_compliance(
    file: Annotated[UploadFile, File(...)],
    ppe_service: Annotated[PPEService, Depends(get_ppe_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
    employee_id: Annotated[str | None, Form()] = None,
    required_ppe: Annotated[list[str] | None, Form()] = None,
    zone_type: Annotated[str | None, Form()] = None,
) -> PPEComplianceResponse:
    """Check PPE compliance for an employee in an uploaded image.

    If employee_id is provided, the system will automatically determine
    the required PPE from the employee's profile if no extracted company rules are found.
    Otherwise, the service uses extracted PPE rules from the company's regulation file.
    You can also specify required_ppe manually to override.
    """
    return await ppe_service.check_ppe_compliance(
        file, employee_id, required_ppe, zone_type, current_user
    )
