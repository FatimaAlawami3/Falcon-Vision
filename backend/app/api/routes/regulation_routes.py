from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile, status

from app.api.deps import get_current_user, get_regulation_service
from app.schemas.regulation_schema import (
    FaceRecognitionSettingRequest,
    FaceRecognitionSettingResponse,
    RegulationUploadResponse,
)
from app.services.regulation_service import RegulationService


router = APIRouter()


@router.post("/upload", response_model=RegulationUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_regulation(
    file: Annotated[UploadFile, File(...)],
    regulation_service: Annotated[RegulationService, Depends(get_regulation_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
    title: Annotated[str | None, Form()] = None,
    description: Annotated[str | None, Form()] = None,
) -> RegulationUploadResponse:
    return await regulation_service.upload_and_extract_regulation(
        file=file,
        current_user=current_user,
        title=title,
        description=description,
    )


@router.post("/{regulation_id}/face-recognition", response_model=FaceRecognitionSettingResponse)
async def set_face_recognition_setting(
    regulation_id: str,
    body: FaceRecognitionSettingRequest,
    regulation_service: Annotated[RegulationService, Depends(get_regulation_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> FaceRecognitionSettingResponse:
    return await regulation_service.set_face_recognition_enabled(
        regulation_id,
        body.enabled,
        current_user,
    )
