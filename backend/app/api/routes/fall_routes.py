"""Routes for fall detection monitoring."""
from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile

from app.api.deps import get_current_user, get_fall_service
from app.services.fall_service import FallDetectionService


router = APIRouter(prefix="/api/fall", tags=["fall-detection"])


@router.post("/detect")
async def detect_falls(
    file: Annotated[UploadFile, File(...)],
    fall_service: Annotated[FallDetectionService, Depends(get_fall_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    """Detect falls in an uploaded image.

    Returns detection results with people count, fallen count, and alert status.
    """
    return await fall_service.detect_falls(
        file,
        zone_type=None,
        organization_id=current_user.get("organization_id") if current_user else None
    )

