from typing import Any

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.employee_model import EmployeeModel
from app.repositories.base_repository import BaseRepository
from app.utils.datetime import utc_now


class EmployeeRepository(BaseRepository):
    collection_name = "employees"

    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        super().__init__(db)

    async def create(self, employee: EmployeeModel) -> dict[str, Any]:
        return await self.insert_model(employee)

    async def find_by_employee_number(
        self,
        organization_id: ObjectId,
        employee_number: str,
    ) -> dict[str, Any] | None:
        return await self.collection.find_one(
            {
                "organization_id": organization_id,
                "employee_number": employee_number,
                "is_deleted": {"$ne": True},
            }
        )

    async def find_by_linked_user_id(
        self,
        organization_id: ObjectId,
        linked_user_id: ObjectId,
    ) -> dict[str, Any] | None:
        return await self.collection.find_one(
            {
                "organization_id": organization_id,
                "linked_user_id": linked_user_id,
                "is_deleted": {"$ne": True},
            }
        )

    async def list_by_organization(self, organization_id: ObjectId) -> list[dict[str, Any]]:
        cursor = self.collection.find(
            {
                "organization_id": organization_id,
                "is_deleted": {"$ne": True},
            }
        ).sort("created_at", -1)
        return await cursor.to_list(length=None)

    async def update_employee(
        self,
        employee_id: ObjectId,
        update_fields: dict[str, Any],
    ) -> dict[str, Any] | None:
        await self.collection.update_one(
            {"_id": employee_id, "is_deleted": {"$ne": True}},
            {"$set": {**update_fields, "updated_at": utc_now()}},
        )
        return await self.find_by_id(employee_id)
