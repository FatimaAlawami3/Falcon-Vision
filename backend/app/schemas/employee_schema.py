from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.core.constants import EmploymentType, EntityStatus


class EmployeeCreateRequest(BaseModel):
    employee_number: str = Field(min_length=1, max_length=50)
    full_name: str = Field(min_length=2, max_length=120)
    department: str | None = Field(default=None, max_length=80)
    job_title: str | None = Field(default=None, max_length=80)
    employment_type: EmploymentType = EmploymentType.EMPLOYEE
    status: EntityStatus = EntityStatus.ACTIVE
    phone: str | None = Field(default=None, max_length=30)
    email: EmailStr | None = None
    requires_ppe: bool = True
    ppe_requirements: list[str] = Field(default_factory=list)
    training_certifications: list[str] = Field(default_factory=list)


class EmployeeUpdateRequest(BaseModel):
    employee_number: str | None = Field(default=None, min_length=1, max_length=50)
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    department: str | None = Field(default=None, max_length=80)
    job_title: str | None = Field(default=None, max_length=80)
    employment_type: EmploymentType | None = None
    status: EntityStatus | None = None
    phone: str | None = Field(default=None, max_length=30)
    email: EmailStr | None = None
    requires_ppe: bool | None = None
    ppe_requirements: list[str] | None = None
    training_certifications: list[str] | None = None


class EmployeeResponse(BaseModel):
    id: str
    organization_id: str
    employee_number: str
    linked_user_id: str | None = None
    full_name: str
    department: str | None = None
    job_title: str | None = None
    employment_type: EmploymentType
    status: EntityStatus
    phone: str | None = None
    email: EmailStr | None = None
    requires_ppe: bool
    ppe_requirements: list[str]
    training_certifications: list[str]
    created_at: datetime
    updated_at: datetime


class EmployeeListResponse(BaseModel):
    items: list[EmployeeResponse]
    total: int
