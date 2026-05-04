from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.core.constants import EntityStatus, UserRole, UserStatus, normalize_user_role
from app.core.exceptions import ConflictError, NotFoundError, PermissionDeniedError
from app.core.security import hash_password
from app.models.employee_model import EmployeeContact, EmployeeModel, EmployeeSafetyProfile
from app.models.user_model import UserModel, UserProfile
from app.repositories.employee_repository import EmployeeRepository
from app.repositories.user_repository import UserRepository
from app.schemas.user_schema import (
    UserCreateRequest,
    UserListResponse,
    UserResponse,
    UserStatusUpdateRequest,
    UserUpdateRequest,
)
from app.utils.object_id import validate_object_id


ADMIN_USER_ROLES = {
    UserRole.ADMIN,
}


class UserService:
    def __init__(self, user_repository: UserRepository, employee_repository: EmployeeRepository) -> None:
        self.user_repository = user_repository
        self.employee_repository = employee_repository

    async def create_user(
        self,
        request: UserCreateRequest,
        current_user: dict,
    ) -> UserResponse:
        self._ensure_admin(current_user)

        if request.role == UserRole.SUPERVISOR:
            employee_id = (request.employee_id or "").strip()
            if not employee_id:
                raise ConflictError("Supervisor ID is required")

            existing_employee = await self.employee_repository.find_by_employee_number(
                current_user["organization_id"],
                employee_id,
            )
            if existing_employee is not None:
                raise ConflictError("ID already exists")

        existing_user = await self.user_repository.find_by_email(str(request.email))
        if existing_user is not None:
            raise ConflictError("Email already exists")

        user = UserModel(
            organization_id=current_user["organization_id"],
            full_name=request.full_name,
            email=str(request.email).lower(),
            password_hash=hash_password(request.password),
            role=request.role,
            profile=UserProfile(phone=request.phone, job_title=request.job_title),
            created_by=current_user["_id"],
            updated_by=current_user["_id"],
        )

        try:
            user_doc = await self.user_repository.create(user)
        except DuplicateKeyError as exc:
            raise ConflictError("Email already exists") from exc

        if normalize_user_role(user_doc["role"]) == UserRole.SUPERVISOR:
            employee_id = (request.employee_id or "").strip()
            try:
                await self._sync_linked_employee(user_doc, current_user=current_user, employee_id=employee_id)
            except Exception:
                await self.user_repository.soft_delete(user_doc["_id"], updated_by=current_user["_id"])
                raise

        return await self._response(user_doc)

    async def list_users(self, current_user: dict) -> UserListResponse:
        self._ensure_admin(current_user)
        user_docs = await self.user_repository.list_by_organization(current_user["organization_id"])
        items = [await self._response(user_doc) for user_doc in user_docs]
        return UserListResponse(items=items, total=len(items))

    async def get_user(self, user_id: str, current_user: dict) -> UserResponse:
        self._ensure_admin(current_user)
        user_doc = await self._get_org_user_or_raise(user_id, current_user["organization_id"])
        return await self._response(user_doc)

    async def update_user(
        self,
        user_id: str,
        request: UserUpdateRequest,
        current_user: dict,
    ) -> UserResponse:
        self._ensure_admin(current_user)

        user_doc = await self._get_org_user_or_raise(user_id, current_user["organization_id"])
        update_fields: dict[str, object] = {}
        employee_id = request.employee_id.strip() if request.employee_id is not None else None

        if request.email is not None:
            new_email = str(request.email).lower()
            existing_user = await self.user_repository.find_by_email(new_email)
            if existing_user is not None and existing_user["_id"] != user_doc["_id"]:
                raise ConflictError("Email already exists")
            update_fields["email"] = new_email

        if request.full_name is not None:
            update_fields["full_name"] = request.full_name

        if request.role is not None:
            update_fields["role"] = request.role

        if request.password is not None:
            update_fields["password_hash"] = hash_password(request.password)

        profile = dict(user_doc.get("profile") or {})
        if request.phone is not None:
            profile["phone"] = request.phone
        if request.job_title is not None:
            profile["job_title"] = request.job_title
        if request.phone is not None or request.job_title is not None:
            update_fields["profile"] = profile

        if not update_fields and employee_id is None:
            return await self._response(user_doc)

        update_fields["updated_by"] = current_user["_id"]

        try:
            updated_user_doc = await self.user_repository.update_user(user_doc["_id"], update_fields)
        except DuplicateKeyError as exc:
            raise ConflictError("Email already exists") from exc

        if updated_user_doc is None:
            raise NotFoundError("User not found")

        if normalize_user_role(updated_user_doc["role"]) == UserRole.SUPERVISOR:
            linked_employee_doc = await self.employee_repository.find_by_linked_user_id(
                current_user["organization_id"],
                updated_user_doc["_id"],
            )
            if employee_id is None and linked_employee_doc is not None:
                employee_id = linked_employee_doc["employee_number"]

            if employee_id:
                await self._sync_linked_employee(
                    updated_user_doc,
                    current_user=current_user,
                    employee_id=employee_id,
                    existing_employee_doc=linked_employee_doc,
                )

        return await self._response(updated_user_doc)

    async def update_user_status(
        self,
        user_id: str,
        request: UserStatusUpdateRequest,
        current_user: dict,
    ) -> UserResponse:
        self._ensure_admin(current_user)
        user_doc = await self._get_org_user_or_raise(user_id, current_user["organization_id"])

        updated_user_doc = await self.user_repository.update_user(
            user_doc["_id"],
            {
                "status": request.status,
                "updated_by": current_user["_id"],
            },
        )
        if updated_user_doc is None:
            raise NotFoundError("User not found")

        if normalize_user_role(updated_user_doc["role"]) == UserRole.SUPERVISOR:
            linked_employee_doc = await self.employee_repository.find_by_linked_user_id(
                current_user["organization_id"],
                updated_user_doc["_id"],
            )
            if linked_employee_doc is not None:
                employee_status = (
                    EntityStatus.ACTIVE if request.status == UserStatus.ACTIVE else EntityStatus.INACTIVE
                )
                await self.employee_repository.update_employee(
                    linked_employee_doc["_id"],
                    {
                        "status": employee_status,
                        "updated_by": current_user["_id"],
                    },
                )

        return await self._response(updated_user_doc)

    async def delete_user(self, user_id: str, current_user: dict) -> None:
        self._ensure_admin(current_user)
        user_doc = await self._get_org_user_or_raise(user_id, current_user["organization_id"])

        if user_doc["_id"] == current_user["_id"]:
            raise PermissionDeniedError("You cannot delete your own account")

        linked_employee_doc = await self.employee_repository.find_by_linked_user_id(
            current_user["organization_id"],
            user_doc["_id"],
        )
        deleted = await self.user_repository.soft_delete(user_doc["_id"], updated_by=current_user["_id"])
        if not deleted:
            raise NotFoundError("User not found")
        if linked_employee_doc is not None:
            await self.employee_repository.soft_delete(linked_employee_doc["_id"], updated_by=current_user["_id"])

    async def _get_org_user_or_raise(
        self,
        user_id: str,
        organization_id: ObjectId,
    ) -> dict:
        user_object_id = validate_object_id(user_id)
        user_doc = await self.user_repository.find_by_id(user_object_id)

        if user_doc is None or user_doc["organization_id"] != organization_id:
            raise NotFoundError("User not found")

        return user_doc

    def _ensure_admin(self, current_user: dict) -> None:
        if normalize_user_role(current_user["role"]) not in ADMIN_USER_ROLES:
            raise PermissionDeniedError("Only admins can manage users")

    async def update_current_user(
        self,
        current_user: dict,
        *,
        full_name: str | None = None,
        email: str | None = None,
        password: str | None = None,
        phone: str | None = None,
        job_title: str | None = None,
    ) -> UserResponse:
        update_fields: dict[str, object] = {}

        if email is not None:
            new_email = email.lower()
            existing_user = await self.user_repository.find_by_email(new_email)
            if existing_user is not None and existing_user["_id"] != current_user["_id"]:
                raise ConflictError("Email already exists")
            update_fields["email"] = new_email

        if full_name is not None:
            update_fields["full_name"] = full_name

        if password is not None:
            update_fields["password_hash"] = hash_password(password)

        profile = dict(current_user.get("profile") or {})
        profile_changed = False
        if phone is not None:
            profile["phone"] = phone
            profile_changed = True
        if job_title is not None:
            profile["job_title"] = job_title
            profile_changed = True
        if profile_changed:
            update_fields["profile"] = profile

        if not update_fields:
            return await self._response(current_user)

        update_fields["updated_by"] = current_user["_id"]

        try:
            updated_user_doc = await self.user_repository.update_user(current_user["_id"], update_fields)
        except DuplicateKeyError as exc:
            raise ConflictError("Email already exists") from exc

        if updated_user_doc is None:
            raise NotFoundError("User not found")

        if normalize_user_role(updated_user_doc["role"]) == UserRole.SUPERVISOR:
            linked_employee_doc = await self.employee_repository.find_by_linked_user_id(
                current_user["organization_id"],
                updated_user_doc["_id"],
            )
            if linked_employee_doc is not None:
                await self._sync_linked_employee(
                    updated_user_doc,
                    current_user=current_user,
                    employee_id=linked_employee_doc["employee_number"],
                    existing_employee_doc=linked_employee_doc,
                )

        return await self._response(updated_user_doc)

    async def _sync_linked_employee(
        self,
        user_doc: dict,
        *,
        current_user: dict,
        employee_id: str,
        existing_employee_doc: dict | None = None,
    ) -> None:
        normalized_employee_id = employee_id.strip()
        if not normalized_employee_id:
            raise ConflictError("Supervisor ID is required")

        linked_employee_doc = existing_employee_doc or await self.employee_repository.find_by_linked_user_id(
            current_user["organization_id"],
            user_doc["_id"],
        )
        conflicting_employee = await self.employee_repository.find_by_employee_number(
            current_user["organization_id"],
            normalized_employee_id,
        )
        if conflicting_employee is not None and (
            linked_employee_doc is None or conflicting_employee["_id"] != linked_employee_doc["_id"]
        ):
            raise ConflictError("ID already exists")

        employee_status = EntityStatus.ACTIVE if user_doc["status"] == UserStatus.ACTIVE else EntityStatus.INACTIVE
        profile = user_doc.get("profile") or {}

        if linked_employee_doc is None:
            employee = EmployeeModel(
                organization_id=current_user["organization_id"],
                employee_number=normalized_employee_id,
                linked_user_id=user_doc["_id"],
                full_name=user_doc["full_name"],
                job_title=profile.get("job_title"),
                employment_type="employee",
                status=employee_status,
                contact=EmployeeContact(
                    phone=profile.get("phone"),
                    email=user_doc["email"],
                ),
                safety_profile=EmployeeSafetyProfile(),
                created_by=current_user["_id"],
                updated_by=current_user["_id"],
            )
            try:
                await self.employee_repository.create(employee)
            except DuplicateKeyError as exc:
                raise ConflictError("ID already exists") from exc
            return

        try:
            await self.employee_repository.update_employee(
                linked_employee_doc["_id"],
                {
                    "employee_number": normalized_employee_id,
                    "linked_user_id": user_doc["_id"],
                    "full_name": user_doc["full_name"],
                    "job_title": profile.get("job_title"),
                    "contact": EmployeeContact(
                        phone=profile.get("phone"),
                        email=user_doc["email"],
                    ).model_dump(),
                    "status": employee_status,
                    "updated_by": current_user["_id"],
                },
            )
        except DuplicateKeyError as exc:
            raise ConflictError("ID already exists") from exc

    async def _response(self, user_doc: dict) -> UserResponse:
        profile = user_doc.get("profile") or {}
        linked_employee_doc = await self.employee_repository.find_by_linked_user_id(
            user_doc["organization_id"],
            user_doc["_id"],
        )
        return UserResponse(
            id=str(user_doc["_id"]),
            organization_id=str(user_doc["organization_id"]),
            full_name=user_doc["full_name"],
            email=user_doc["email"],
            role=normalize_user_role(user_doc["role"]),
            status=user_doc["status"],
            employee_id=linked_employee_doc["employee_number"] if linked_employee_doc is not None else None,
            last_login_at=user_doc.get("last_login_at"),
            phone=profile.get("phone"),
            job_title=profile.get("job_title"),
            created_at=user_doc["created_at"],
            updated_at=user_doc["updated_at"],
        )
