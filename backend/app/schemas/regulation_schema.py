from datetime import datetime

from pydantic import BaseModel


class RegulationFileResponse(BaseModel):
    original_filename: str
    storage_provider: str
    storage_path: str
    public_url: str | None = None
    mime_type: str
    size_bytes: int
    sha256: str


class RegulationExtractionStateResponse(BaseModel):
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    model_name: str | None = None
    error_message: str | None = None
    rules_count: int


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
    extraction: RegulationExtractionStateResponse
    created_at: datetime
    updated_at: datetime


class ExtractedRuleResponse(BaseModel):
    id: str
    category: str
    status: str
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
    regulations: list[RegulationResponse]
    extracted_rules: list[ExtractedRuleResponse]
    summary: RegulationExtractionSummary


class RegulationCurrentResponse(BaseModel):
    regulation: RegulationResponse | None = None
    regulations: list[RegulationResponse]
    extracted_rules: list[ExtractedRuleResponse]
    summary: RegulationExtractionSummary


class FaceRecognitionSettingRequest(BaseModel):
    enabled: bool


class FaceRecognitionSettingResponse(BaseModel):
    enabled: bool


class RegulationModuleSettingRequest(BaseModel):
    enabled: bool


class RegulationRuleSettingRequest(BaseModel):
    enabled: bool
