from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_auth_service, get_current_user, get_user_service
from app.schemas.auth_schema import (
    AuthUserResponse,
    CurrentUserUpdateRequest,
    LoginRequest,
    OrganizationRegisterRequest,
    RegisterOrganizationResponse,
    TokenResponse,
)
from app.services.auth_service import AuthService
from app.services.user_service import UserService


router = APIRouter()


@router.post("/register-organization", response_model=RegisterOrganizationResponse, status_code=201)
async def register_organization(
    request: OrganizationRegisterRequest,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> RegisterOrganizationResponse:
    return await auth_service.register_organization(request)


@router.post("/login", response_model=TokenResponse)
async def login(
    request: LoginRequest,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> TokenResponse:
    return await auth_service.login(request)


@router.get("/me", response_model=AuthUserResponse)
async def get_me(
    current_user: Annotated[dict, Depends(get_current_user)],
) -> AuthUserResponse:
    profile = current_user.get("profile") or {}
    return AuthUserResponse(
        id=str(current_user["_id"]),
        organization_id=str(current_user["organization_id"]),
        full_name=current_user["full_name"],
        email=current_user["email"],
        role=current_user["role"],
        status=current_user["status"],
        phone=profile.get("phone"),
        job_title=profile.get("job_title"),
    )


@router.patch("/me", response_model=AuthUserResponse)
async def update_me(
    request: CurrentUserUpdateRequest,
    user_service: Annotated[UserService, Depends(get_user_service)],
    current_user: Annotated[dict, Depends(get_current_user)],
) -> AuthUserResponse:
    updated_user = await user_service.update_current_user(
        current_user,
        full_name=request.full_name,
        email=str(request.email).lower() if request.email is not None else None,
        password=request.password,
        phone=request.phone,
        job_title=request.job_title,
    )
    return AuthUserResponse(
        id=updated_user.id,
        organization_id=updated_user.organization_id,
        full_name=updated_user.full_name,
        email=updated_user.email,
        role=updated_user.role,
        status=updated_user.status,
        phone=updated_user.phone,
        job_title=updated_user.job_title,
    )
