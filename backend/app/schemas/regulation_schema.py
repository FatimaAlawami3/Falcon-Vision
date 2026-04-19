from datetime import datetime

from pydantic import BaseModel


class RegulationFileResponse(BaseModel):
    original_filename: str
    storage_provider: str
    storage_path: str
    mime_type: str
    size_bytes: int
    sha256: str


class RegulationResponse(BaseModel):
    id: str
    organization_id: str
    title: str
    description: str | None = None
    document_type: str
    status: str
    version: int
    uploaded_by: str
    file: RegulationFileResponse
    created_at: datetime
    updated_at: datetime


class ExtractedRuleResponse(BaseModel):
    id: str
    category: str
    severity: str
    title: str
    description: str
    required_classes: list[str]
    violation_when: str
    confidence_threshold: float
    zone_types: list[str]
    source_excerpt: str | None = None


class RegulationExtractionSummary(BaseModel):
    total_rules: int
    ppe_items: list[str]
    fall_detection_active: bool
    fire_smoke_detection_active: bool
    face_recognition_enabled: bool = False


class RegulationUploadResponse(BaseModel):
    regulation: RegulationResponse
    extracted_rules: list[ExtractedRuleResponse]
    summary: RegulationExtractionSummary


class FaceRecognitionSettingRequest(BaseModel):
    enabled: bool


class FaceRecognitionSettingResponse(BaseModel):
    enabled: bool
