from datetime import datetime

from pydantic import BaseModel

from app.models.regulation_model import StoredFile
from app.schemas.alert_schema import AlertResponse


class FaceEmbeddingResponse(BaseModel):
    model_name: str
    dimension: int
    created_at: datetime


class FaceQualityResponse(BaseModel):
    score: float | None = None
    frontal: bool | None = None
    has_mask: bool | None = None
    lighting: str | None = None


class EmployeeFaceResponse(BaseModel):
    id: str
    employee_id: str
    organization_id: str
    image: StoredFile
    embedding: FaceEmbeddingResponse | None = None
    quality: FaceQualityResponse
    status: str
    created_at: datetime
    updated_at: datetime


class EmployeeFaceUploadFailure(BaseModel):
    filename: str
    detail: str


class EmployeeFaceUploadResponse(BaseModel):
    uploaded_count: int
    failed_count: int
    items: list[EmployeeFaceResponse]
    failures: list[EmployeeFaceUploadFailure]


class FaceBoxResponse(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float
    image_width: int
    image_height: int


class FaceRecognitionResponse(BaseModel):
    status: str
    authorized: bool
    threshold: float
    score: float | None = None
    matched_face_id: str | None = None
    matched_employee_id: str | None = None
    matched_employee_name: str | None = None
    face_box: FaceBoxResponse | None = None
    alert: AlertResponse | None = None


class MultiFaceRecognitionResponse(BaseModel):
    status: str
    faces: list[FaceRecognitionResponse]


class FaceRecognitionStatusResponse(BaseModel):
    enabled: bool
