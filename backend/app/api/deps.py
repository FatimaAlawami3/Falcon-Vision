from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.core.database import get_database
from app.core.config import get_settings
from app.core.constants import normalize_user_role
from app.core.security import decode_access_token
from app.integrations.ai.face_recognition_client import FaceRecognitionClient
from app.integrations.storage.local_storage import LocalStorageClient
from app.repositories.employee_face_repository import EmployeeFaceRepository
from app.repositories.employee_repository import EmployeeRepository
from app.repositories.extracted_rule_repository import ExtractedRuleRepository
from app.repositories.alert_repository import AlertRepository
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.regulation_repository import RegulationRepository
from app.repositories.user_repository import UserRepository
from app.services.auth_service import AuthService
from app.services.alert_service import AlertService
from app.services.employee_service import EmployeeService
from app.services.employee_face_service import EmployeeFaceService
from app.services.fall_service import FallDetectionService
from app.services.fire_service import FireDetectionService
from app.services.ppe_service import PPEService
from app.services.regulation_service import RegulationService
from app.services.user_service import UserService
from app.utils.object_id import validate_object_id


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_user_repository() -> UserRepository:
    return UserRepository(get_database())


def get_organization_repository() -> OrganizationRepository:
    return OrganizationRepository(get_database())


def get_employee_face_repository() -> EmployeeFaceRepository:
    return EmployeeFaceRepository(get_database())


def get_employee_repository() -> EmployeeRepository:
    return EmployeeRepository(get_database())


def get_regulation_repository() -> RegulationRepository:
    return RegulationRepository(get_database())


def get_extracted_rule_repository() -> ExtractedRuleRepository:
    return ExtractedRuleRepository(get_database())


def get_alert_repository() -> AlertRepository:
    return AlertRepository(get_database())


def get_auth_service(
    organization_repository: Annotated[OrganizationRepository, Depends(get_organization_repository)],
    user_repository: Annotated[UserRepository, Depends(get_user_repository)],
) -> AuthService:
    return AuthService(organization_repository, user_repository)


def get_user_service(
    user_repository: Annotated[UserRepository, Depends(get_user_repository)],
    employee_repository: Annotated[EmployeeRepository, Depends(get_employee_repository)],
) -> UserService:
    return UserService(user_repository, employee_repository)


def get_employee_service(
    employee_repository: Annotated[EmployeeRepository, Depends(get_employee_repository)],
) -> EmployeeService:
    return EmployeeService(employee_repository)


def get_face_recognition_client() -> FaceRecognitionClient:
    return FaceRecognitionClient()


def get_local_storage_client() -> LocalStorageClient:
    settings = get_settings()
    return LocalStorageClient(settings.UPLOAD_DIR)


def get_alert_service(
    alert_repository: Annotated[AlertRepository, Depends(get_alert_repository)],
    storage_client: Annotated[LocalStorageClient, Depends(get_local_storage_client)],
) -> AlertService:
    return AlertService(alert_repository, storage_client)


def get_employee_face_service(
    employee_face_repository: Annotated[EmployeeFaceRepository, Depends(get_employee_face_repository)],
    extracted_rule_repository: Annotated[ExtractedRuleRepository, Depends(get_extracted_rule_repository)],
    alert_service: Annotated[AlertService, Depends(get_alert_service)],
    storage_client: Annotated[LocalStorageClient, Depends(get_local_storage_client)],
    face_recognition_client: Annotated[FaceRecognitionClient, Depends(get_face_recognition_client)],
) -> EmployeeFaceService:
    settings = get_settings()
    return EmployeeFaceService(
        employee_face_repository,
        extracted_rule_repository,
        alert_service,
        storage_client,
        face_recognition_client,
        max_face_image_size_mb=settings.MAX_FACE_IMAGE_SIZE_MB,
    )


def get_ppe_service(
    employee_repository: Annotated[EmployeeRepository, Depends(get_employee_repository)],
    rule_repository: Annotated[ExtractedRuleRepository, Depends(get_extracted_rule_repository)],
    regulation_repository: Annotated[RegulationRepository, Depends(get_regulation_repository)],
) -> PPEService:
    return PPEService.create(employee_repository, rule_repository, regulation_repository)


def get_regulation_service(
    regulation_repository: Annotated[RegulationRepository, Depends(get_regulation_repository)],
    rule_repository: Annotated[ExtractedRuleRepository, Depends(get_extracted_rule_repository)],
    storage_client: Annotated[LocalStorageClient, Depends(get_local_storage_client)],
) -> RegulationService:
    return RegulationService.create(regulation_repository, rule_repository, storage_client)


def get_fall_service(
    db: Annotated[object, Depends(get_database)],
) -> FallDetectionService:
    """Dependency for fall detection service."""
    rule_repository = ExtractedRuleRepository(db)
    return FallDetectionService(rule_repository)


def get_fire_service(
    db: Annotated[object, Depends(get_database)],
) -> FireDetectionService:
    """Dependency for fire detection service."""
    rule_repository = ExtractedRuleRepository(db)
    return FireDetectionService(rule_repository)


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    user_repository: Annotated[UserRepository, Depends(get_user_repository)],
) -> dict:
    payload = decode_access_token(token)
    if payload is None or not payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_id = validate_object_id(payload["sub"])
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = await user_repository.find_by_id(user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user["role"] = normalize_user_role(user["role"])
    return user
