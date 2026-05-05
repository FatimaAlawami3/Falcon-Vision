from pymongo.errors import DuplicateKeyError

from app.core.constants import UserRole, UserStatus, normalize_user_role
from app.core.exceptions import ConflictError, InactiveUserError, InvalidCredentialsError, NotFoundError
from app.core.security import create_access_token, hash_password, verify_password
from app.models.organization_model import OrganizationModel
from app.models.user_model import UserModel, UserProfile
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.user_repository import UserRepository
from app.schemas.auth_schema import (
    AuthOrganizationResponse,
    AuthUserResponse,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    OrganizationRegisterRequest,
    RegisterOrganizationResponse,
    TokenResponse,
)


class AuthService:
    def __init__(
        self,
        organization_repository: OrganizationRepository,
        user_repository: UserRepository,
    ) -> None:
        self.organization_repository = organization_repository
        self.user_repository = user_repository

    async def register_organization(
        self,
        request: OrganizationRegisterRequest,
    ) -> RegisterOrganizationResponse:
        existing_organization = await self.organization_repository.find_by_name(
            request.organization_name
        )
        if existing_organization is not None:
            raise ConflictError("Organization name already exists")

        existing_user = await self.user_repository.find_by_email(str(request.admin_email))
        if existing_user is not None:
            raise ConflictError("Email already exists")

        organization = OrganizationModel(
            name=request.organization_name,
            industry=request.industry,
            country=request.country,
            city=request.city,
            address=request.address,
        )

        organization_doc = await self.organization_repository.create(organization)
        organization_id = organization_doc["_id"]

        admin = UserModel(
            organization_id=organization_id,
            full_name=request.admin_full_name,
            email=str(request.admin_email).lower(),
            password_hash=hash_password(request.admin_password),
            role=UserRole.ADMIN,
            profile=UserProfile(phone=request.admin_phone, job_title="Admin"),
            created_by=None,
            updated_by=None,
        )

        try:
            user_doc = await self.user_repository.create(admin)
        except DuplicateKeyError as exc:
            raise ConflictError("Email already exists") from exc

        return RegisterOrganizationResponse(
            organization=AuthOrganizationResponse(
                id=str(organization_id),
                name=organization_doc["name"],
                status=organization_doc["status"],
            ),
            user=self._user_response(user_doc),
        )

    async def login(self, request: LoginRequest) -> TokenResponse:
        user_doc = await self.user_repository.find_by_email(str(request.email))
        if user_doc is None:
            raise InvalidCredentialsError()

        if not verify_password(request.password, user_doc["password_hash"]):
            raise InvalidCredentialsError()

        if user_doc["status"] != UserStatus.ACTIVE:
            raise InactiveUserError()

        await self.user_repository.update_last_login(user_doc["_id"])

        return TokenResponse(access_token=self._build_token(user_doc))

    async def reset_password_by_email(self, request: ForgotPasswordRequest) -> ForgotPasswordResponse:
        user_doc = await self.user_repository.find_by_email(str(request.email))
        if user_doc is None:
            raise NotFoundError("No account found with this email")

        await self.user_repository.update_user(
            user_doc["_id"],
            {
                "password_hash": hash_password(request.password),
            },
        )

        return ForgotPasswordResponse(
            message="Password reset successfully. You can log in with your new password.",
        )

    def _build_token(self, user_doc: dict) -> str:
        return create_access_token(
            subject=str(user_doc["_id"]),
            claims={
                "organization_id": str(user_doc["organization_id"]),
                "role": normalize_user_role(user_doc["role"]),
            },
        )

    def _user_response(self, user_doc: dict) -> AuthUserResponse:
        return AuthUserResponse(
            id=str(user_doc["_id"]),
            organization_id=str(user_doc["organization_id"]),
            full_name=user_doc["full_name"],
            email=user_doc["email"],
            role=normalize_user_role(user_doc["role"]),
            status=user_doc["status"],
        )
