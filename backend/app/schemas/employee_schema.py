import re
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.constants import EmploymentType, EntityStatus

# Employee ID: exactly 5 digits.
ID_PATTERN = re.compile(r"^\d{5}$")
# Saudi mobile format: 05 followed by 8 digits (10 digits total).
PHONE_PATTERN = re.compile(r"^05\d{8}$")


def _validate_employee_number(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not ID_PATTERN.fullmatch(cleaned):
        raise ValueError("Employee ID must be exactly 5 digits.")
    return cleaned


def _validate_full_name(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned or not all(char.isalpha() or char.isspace() for char in cleaned):
        raise ValueError("Full name can only contain letters and spaces.")
    return cleaned


def _validate_phone(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not PHONE_PATTERN.fullmatch(cleaned):
        raise ValueError("Phone number must start with 05 and be 10 digits (e.g. 0512345678).")
    return cleaned


class EmployeeCreateRequest(BaseModel):
    employee_number: str = Field(min_length=1, max_length=50)
    full_name: str = Field(min_length=2, max_length=120)
    department: str = Field(min_length=1, max_length=80)
    job_title: str = Field(min_length=1, max_length=80)
    employment_type: EmploymentType = EmploymentType.EMPLOYEE
    status: EntityStatus = EntityStatus.ACTIVE
    phone: str = Field(min_length=1, max_length=30)
    email: EmailStr
    requires_ppe: bool = True
    ppe_requirements: list[str] = Field(default_factory=list)
    training_certifications: list[str] = Field(default_factory=list)

    @field_validator("employee_number")
    @classmethod
    def _check_employee_number(cls, value: str | None) -> str | None:
        return _validate_employee_number(value)

    @field_validator("full_name")
    @classmethod
    def _check_full_name(cls, value: str | None) -> str | None:
        return _validate_full_name(value)

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, value: str | None) -> str | None:
        return _validate_phone(value)


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

    @field_validator("employee_number")
    @classmethod
    def _check_employee_number(cls, value: str | None) -> str | None:
        return _validate_employee_number(value)

    @field_validator("full_name")
    @classmethod
    def _check_full_name(cls, value: str | None) -> str | None:
        return _validate_full_name(value)

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, value: str | None) -> str | None:
        return _validate_phone(value)


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
