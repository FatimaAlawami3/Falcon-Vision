"""Routes for fire/smoke detection monitoring with multimodal fusion."""
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.api.deps import get_current_user, get_fire_service
from app.services.fire_service import FireDetectionService


router = APIRouter(prefix="/api/fire", tags=["fire-detection"])


@router.post("/detect-image-only")
async def detect_fire_image_only(
    file: Annotated[UploadFile, File(...)],
    fire_service: Annotated[FireDetectionService, Depends(get_fire_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
    zone_type: Annotated[str | None, Form()] = None,
) -> dict:
    """Detect fire/smoke using image only (no sensor data).

    Provides vision-based detection for immediate fire hazards.
    """
    return await fire_service.detect_fire_image_only(
        file,
        zone_type=zone_type,
        organization_id=current_user.get("organization_id") if current_user else None
    )


@router.post("/detect-multimodal")
async def detect_fire_multimodal(
    file: Annotated[UploadFile, File(...)],
    fire_service: Annotated[FireDetectionService, Depends(get_fire_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
    sensor_data: Annotated[str | None, Form()] = None,
    zone_type: Annotated[str | None, Form()] = None,
) -> dict:
    """Detect fire/smoke using multimodal fusion of sensor and vision data.

    Combines:
    - Sensor data: Temperature, CO, smoke sensor readings (8 features)
    - Vision data: YOLO fire/smoke detection
    - Fusion: Rule-based decision logic for alert level

    Sensor data format: JSON array of 8 features in order:
    [temperature, co_level, smoke_level, feature4, feature5, feature6, feature7, feature8]
    """
    # Parse sensor data if provided
    sensor_features = None
    if sensor_data:
        try:
            import json
            sensor_features = json.loads(sensor_data)
            if not isinstance(sensor_features, list) or len(sensor_features) != 8:
                raise ValueError("Sensor data must be a JSON array of 8 numbers")
        except (json.JSONDecodeError, ValueError) as e:
            return {
                "error": f"Invalid sensor data format: {str(e)}",
                "expected_format": "[temp, co, smoke, f4, f5, f6, f7, f8]"
            }

    return await fire_service.detect_fire_with_fusion(
        file,
        sensor_data=sensor_features,
        zone_type=zone_type,
        organization_id=current_user.get("organization_id") if current_user else None
    )

