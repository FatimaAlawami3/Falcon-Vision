from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.api.deps import get_current_user, get_employee_face_service
from app.schemas.employee_face_schema import (
    EmployeeFaceUploadResponse,
    FaceRecognitionResponse,
    FaceRecognitionStatusResponse,
)
from app.services.employee_face_service import EmployeeFaceService


router = APIRouter()


@router.post("/upload", response_model=EmployeeFaceUploadResponse, status_code=201)
async def upload_employee_faces(
    employee_id: Annotated[str, Form(...)],
    files: Annotated[list[UploadFile], File(...)],
    employee_face_service: Annotated[EmployeeFaceService, Depends(get_employee_face_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> EmployeeFaceUploadResponse:
    return await employee_face_service.upload_faces(employee_id, files, current_user)


@router.post("/recognize", response_model=FaceRecognitionResponse)
async def recognize_employee_face(
    file: Annotated[UploadFile, File(...)],
    employee_face_service: Annotated[EmployeeFaceService, Depends(get_employee_face_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> FaceRecognitionResponse:
    return await employee_face_service.recognize_face(file, current_user)


@router.get("/status", response_model=FaceRecognitionStatusResponse)
async def get_face_recognition_status(
    employee_face_service: Annotated[EmployeeFaceService, Depends(get_employee_face_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> FaceRecognitionStatusResponse:
    return await employee_face_service.get_face_recognition_status(current_user)
