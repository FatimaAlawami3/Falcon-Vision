from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.core.constants import UserRole, UserStatus


class UserCreateRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    role: UserRole = UserRole.SUPERVISOR
    employee_id: str | None = Field(default=None, min_length=1, max_length=50)
    phone: str | None = Field(default=None, max_length=30)
    job_title: str | None = Field(default=None, max_length=80)


class UserUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8, max_length=72)
    role: UserRole | None = None
    employee_id: str | None = Field(default=None, min_length=1, max_length=50)
    phone: str | None = Field(default=None, max_length=30)
    job_title: str | None = Field(default=None, max_length=80)


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
