import re

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.constants import UserRole

# Saudi mobile format: 05 followed by 8 digits (10 digits total).
PHONE_PATTERN = re.compile(r"^05\d{8}$")


class OrganizationRegisterRequest(BaseModel):
    organization_name: str = Field(min_length=2, max_length=120)
    industry: str = Field(min_length=1, max_length=100)
    country: str = Field(min_length=1, max_length=80)
    city: str = Field(min_length=1, max_length=80)
    address: str = Field(min_length=1, max_length=200)

    admin_full_name: str = Field(min_length=2, max_length=120)
    admin_email: EmailStr
    admin_password: str = Field(min_length=8, max_length=72)
    admin_phone: str = Field(min_length=1, max_length=30)

    @field_validator("admin_full_name")
    @classmethod
    def _check_admin_full_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned or not all(char.isalpha() or char.isspace() for char in cleaned):
            raise ValueError("Full name can only contain letters and spaces.")
        return cleaned

    @field_validator("admin_phone")
    @classmethod
    def _check_admin_phone(cls, value: str) -> str:
        cleaned = value.strip()
        if not PHONE_PATTERN.fullmatch(cleaned):
            raise ValueError("Phone number must start with 05 and be 10 digits (e.g. 0512345678).")
        return cleaned


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)


class ForgotPasswordResponse(BaseModel):
    message: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AuthUserResponse(BaseModel):
    id: str
    organization_id: str
    full_name: str
    email: EmailStr
    role: UserRole
    status: str
    phone: str | None = None
    job_title: str | None = None


class CurrentUserUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8, max_length=72)
    phone: str | None = Field(default=None, max_length=30)
    job_title: str | None = Field(default=None, max_length=80)

    @field_validator("full_name")
    @classmethod
    def _check_full_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned or not all(char.isalpha() or char.isspace() for char in cleaned):
            raise ValueError("Full name can only contain letters and spaces.")
        return cleaned

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if not PHONE_PATTERN.fullmatch(cleaned):
            raise ValueError("Phone number must start with 05 and be 10 digits (e.g. 0512345678).")
        return cleaned


class AuthOrganizationResponse(BaseModel):
    id: str
    name: str
    status: str


class RegisterOrganizationResponse(BaseModel):
    organization: AuthOrganizationResponse
    user: AuthUserResponse
