import re
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.constants import UserRole, UserStatus

# Supervisor ID: exactly 5 digits (matches the linked employee ID).
ID_PATTERN = re.compile(r"^\d{5}$")
# Saudi mobile format: 05 followed by 8 digits (10 digits total).
PHONE_PATTERN = re.compile(r"^05\d{8}$")


def _validate_employee_id(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if not ID_PATTERN.fullmatch(cleaned):
        raise ValueError("Supervisor ID must be exactly 5 digits.")
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
    if not cleaned:
        return None
    if not PHONE_PATTERN.fullmatch(cleaned):
        raise ValueError("Phone number must start with 05 and be 10 digits (e.g. 0512345678).")
    return cleaned


class UserCreateRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    role: UserRole = UserRole.SUPERVISOR
    employee_id: str | None = Field(default=None, min_length=1, max_length=50)
    phone: str | None = Field(default=None, max_length=30)
    job_title: str | None = Field(default=None, max_length=80)

    @field_validator("employee_id")
    @classmethod
    def _check_employee_id(cls, value: str | None) -> str | None:
        return _validate_employee_id(value)

    @field_validator("full_name")
    @classmethod
    def _check_full_name(cls, value: str | None) -> str | None:
        return _validate_full_name(value)

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, value: str | None) -> str | None:
        return _validate_phone(value)


class UserUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8, max_length=72)
    role: UserRole | None = None
    employee_id: str | None = Field(default=None, min_length=1, max_length=50)
    phone: str | None = Field(default=None, max_length=30)
    job_title: str | None = Field(default=None, max_length=80)

    @field_validator("employee_id")
    @classmethod
    def _check_employee_id(cls, value: str | None) -> str | None:
        return _validate_employee_id(value)

    @field_validator("full_name")
    @classmethod
    def _check_full_name(cls, value: str | None) -> str | None:
        return _validate_full_name(value)

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, value: str | None) -> str | None:
        return _validate_phone(value)


class UserStatusUpdateRequest(BaseModel):
    status: UserStatus


class UserResponse(BaseModel):
    id: str
    organization_id: str
    full_name: str
    email: EmailStr
    role: UserRole
    status: UserStatus
    employee_id: str | None = None
    last_login_at: datetime | None = None
    phone: str | None = None
    job_title: str | None = None
    created_at: datetime
    updated_at: datetime


class UserListResponse(BaseModel):
    items: list[UserResponse]
    total: int
