from typing import List, Dict

from pydantic import BaseModel


class PPEDetectionItem(BaseModel):
    """Represents a single detected PPE item."""
    class_name: str
    confidence: float
    bbox: List[float]  # [x1, y1, x2, y2]


class PPEDetectionResponse(BaseModel):
    """Response for PPE detection in an image."""
    status: str
    detected_items: List[PPEDetectionItem]
    image_width: int
    image_height: int


class PPEComplianceResponse(BaseModel):
    """Response for PPE compliance check."""
    status: str  # "compliant" or "violation"
    employee_id: str | None = None
    employee_name: str | None = None
    required_ppe: List[str]
    detected_ppe: List[str]
    missing_ppe: List[str]
    confidence: float
    image_width: int
    image_height: int
    mapped_requirements: Dict[str, str] = {}  # CLIP mapping of text requirements to detected classes