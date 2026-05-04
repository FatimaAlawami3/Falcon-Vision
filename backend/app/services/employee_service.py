from pymongo.errors import DuplicateKeyError

from app.core.constants import UserRole, normalize_user_role
from app.core.exceptions import ConflictError, NotFoundError, PermissionDeniedError
from app.models.employee_model import EmployeeContact, EmployeeModel, EmployeeSafetyProfile
from app.repositories.employee_repository import EmployeeRepository
from app.schemas.employee_schema import (
    EmployeeCreateRequest,
    EmployeeListResponse,
    EmployeeResponse,
    EmployeeUpdateRequest,
)
from app.utils.object_id import validate_object_id


class EmployeeService:
    def __init__(self, employee_repository: EmployeeRepository) -> None:
        self.employee_repository = employee_repository

    async def create_employee(
        self,
        request: EmployeeCreateRequest,
        current_user: dict,
    ) -> EmployeeResponse:
        self._ensure_admin(current_user)

        existing_employee = await self.employee_repository.find_by_employee_number(
            current_user["organization_id"],
            request.employee_number,
        )
        if existing_employee is not None:
            raise ConflictError("Employee number already exists")

        employee = EmployeeModel(
            organization_id=current_user["organization_id"],
            employee_number=request.employee_number,
            full_name=request.full_name,
            department=request.department,
            job_title=request.job_title,
            employment_type=request.employment_type,
            status=request.status,
            contact=EmployeeContact(
                phone=request.phone,
                email=request.email,
            ),
            safety_profile=EmployeeSafetyProfile(
                requires_ppe=request.requires_ppe,
                ppe_requirements=request.ppe_requirements,
                training_certifications=request.training_certifications,
            ),
            created_by=current_user["_id"],
            updated_by=current_user["_id"],
        )

        try:
            employee_doc = await self.employee_repository.create(employee)
        except DuplicateKeyError as exc:
            raise ConflictError("Employee number already exists") from exc

        return self._response(employee_doc)

    async def list_employees(self, current_user: dict) -> EmployeeListResponse:
        employee_docs = await self.employee_repository.list_by_organization(current_user["organization_id"])
        items = [self._response(employee_doc) for employee_doc in employee_docs]
        return EmployeeListResponse(items=items, total=len(items))

    async def get_employee(self, employee_id: str, current_user: dict) -> EmployeeResponse:
        employee_doc = await self._get_org_employee_or_raise(employee_id, current_user["organization_id"])
        return self._response(employee_doc)

    async def update_employee(
        self,
        employee_id: str,
        request: EmployeeUpdateRequest,
        current_user: dict,
    ) -> EmployeeResponse:
        self._ensure_admin(current_user)
        employee_doc = await self._get_org_employee_or_raise(employee_id, current_user["organization_id"])

        update_fields: dict[str, object] = {}

        if request.employee_number is not None and request.employee_number != employee_doc["employee_number"]:
            existing_employee = await self.employee_repository.find_by_employee_number(
                current_user["organization_id"],
                request.employee_number,
            )
            if existing_employee is not None and existing_employee["_id"] != employee_doc["_id"]:
                raise ConflictError("Employee number already exists")
            update_fields["employee_number"] = request.employee_number

        for field_name in ("full_name", "department", "job_title", "employment_type", "status"):
            value = getattr(request, field_name)
            if value is not None:
                update_fields[field_name] = value

        contact = dict(employee_doc.get("contact") or {})
        if request.phone is not None:
            contact["phone"] = request.phone
        if request.email is not None:
            contact["email"] = request.email
        if request.phone is not None or request.email is not None:
            update_fields["contact"] = contact

        safety_profile = dict(employee_doc.get("safety_profile") or {})
        for field_name in ("requires_ppe", "ppe_requirements", "training_certifications"):
            value = getattr(request, field_name)
            if value is not None:
                safety_profile[field_name] = value
        if any(getattr(request, field_name) is not None for field_name in ("requires_ppe", "ppe_requirements", "training_certifications")):
            update_fields["safety_profile"] = safety_profile

        if not update_fields:
            return self._response(employee_doc)

        update_fields["updated_by"] = current_user["_id"]

        try:
            updated_employee_doc = await self.employee_repository.update_employee(employee_doc["_id"], update_fields)
        except DuplicateKeyError as exc:
            raise ConflictError("Employee number already exists") from exc

        if updated_employee_doc is None:
            raise NotFoundError("Employee not found")

        return self._response(updated_employee_doc)

    async def delete_employee(self, employee_id: str, current_user: dict) -> None:
        self._ensure_admin(current_user)
        employee_doc = await self._get_org_employee_or_raise(employee_id, current_user["organization_id"])

        deleted = await self.employee_repository.soft_delete(employee_doc["_id"], updated_by=current_user["_id"])
        if not deleted:
            raise NotFoundError("Employee not found")

    async def _get_org_employee_or_raise(self, employee_id: str, organization_id) -> dict:
        employee_object_id = validate_object_id(employee_id)
        employee_doc = await self.employee_repository.find_by_id(employee_object_id)

        if employee_doc is None or employee_doc["organization_id"] != organization_id:
            raise NotFoundError("Employee not found")

        return employee_doc

    def _ensure_admin(self, current_user: dict) -> None:
        if normalize_user_role(current_user["role"]) != UserRole.ADMIN:
            raise PermissionDeniedError("Only admins can manage employees")

    def _response(self, employee_doc: dict) -> EmployeeResponse:
        contact = employee_doc.get("contact") or {}
        safety_profile = employee_doc.get("safety_profile") or {}
        return EmployeeResponse(
            id=str(employee_doc["_id"]),
            organization_id=str(employee_doc["organization_id"]),
            employee_number=employee_doc["employee_number"],
            linked_user_id=str(employee_doc["linked_user_id"]) if employee_doc.get("linked_user_id") else None,
            full_name=employee_doc["full_name"],
            department=employee_doc.get("department"),
            job_title=employee_doc.get("job_title"),
            employment_type=employee_doc["employment_type"],
            status=employee_doc["status"],
            phone=contact.get("phone"),
            email=contact.get("email"),
            requires_ppe=safety_profile.get("requires_ppe", True),
            ppe_requirements=safety_profile.get("ppe_requirements", []),
            training_certifications=safety_profile.get("training_certifications", []),
            created_at=employee_doc["created_at"],
            updated_at=employee_doc["updated_at"],
        )
