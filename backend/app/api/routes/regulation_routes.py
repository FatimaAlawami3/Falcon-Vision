from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile, status

from app.api.deps import get_current_user, get_regulation_service
from app.schemas.regulation_schema import (
    FaceRecognitionSettingRequest,
    FaceRecognitionSettingResponse,
    RegulationCurrentResponse,
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
    saved = await regulation_service.upload_regulation_file(
        file=file,
        current_user=current_user,
        title=title,
        description=description,
    )
    if saved.regulation is None:
        raise RuntimeError("Saved regulation payload did not include a regulation")
    return RegulationUploadResponse(
        regulation=saved.regulation,
        extracted_rules=saved.extracted_rules,
        summary=saved.summary,
    )


@router.get("/current", response_model=RegulationCurrentResponse)
async def get_current_regulation(
    regulation_service: Annotated[RegulationService, Depends(get_regulation_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> RegulationCurrentResponse:
    return await regulation_service.get_current_regulation(current_user)


@router.post("/{regulation_id}/extract", response_model=RegulationCurrentResponse)
async def extract_regulation(
    regulation_id: str,
    regulation_service: Annotated[RegulationService, Depends(get_regulation_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> RegulationCurrentResponse:
    return await regulation_service.extract_regulation(regulation_id, current_user)


@router.post("/{regulation_id}/cancel-extraction", response_model=RegulationCurrentResponse)
async def cancel_regulation_extraction(
    regulation_id: str,
    regulation_service: Annotated[RegulationService, Depends(get_regulation_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> RegulationCurrentResponse:
    return await regulation_service.cancel_extraction(regulation_id, current_user)


@router.delete("/{regulation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_regulation(
    regulation_id: str,
    regulation_service: Annotated[RegulationService, Depends(get_regulation_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> None:
    await regulation_service.delete_regulation(regulation_id, current_user)


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
