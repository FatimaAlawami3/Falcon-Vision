from pydantic import BaseModel, EmailStr, Field

from app.core.constants import EmploymentType, EntityStatus
from app.models.base import PyObjectId, TenantModel


class EmployeeContact(BaseModel):
    phone: str | None = None
    email: EmailStr | None = None


class EmployeeSafetyProfile(BaseModel):
    requires_ppe: bool = True
    ppe_requirements: list[str] = Field(default_factory=list)
    training_certifications: list[str] = Field(default_factory=list)


class EmployeeModel(TenantModel):
    employee_number: str
    linked_user_id: PyObjectId | None = None
    full_name: str
    department: str | None = None
    job_title: str | None = None
    employment_type: EmploymentType = EmploymentType.EMPLOYEE
    status: EntityStatus = EntityStatus.ACTIVE
    contact: EmployeeContact = Field(default_factory=EmployeeContact)
    safety_profile: EmployeeSafetyProfile = Field(default_factory=EmployeeSafetyProfile)
