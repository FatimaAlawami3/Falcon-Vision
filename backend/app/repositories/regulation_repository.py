from bson import ObjectId
from pymongo import ReturnDocument

from app.core.constants import ExtractionStatus, RegulationStatus
from app.models.regulation_model import RegulationModel
from app.repositories.base_repository import BaseRepository
from app.utils.datetime import utc_now


class RegulationRepository(BaseRepository):
    collection_name = "regulations"

    async def create(self, regulation: RegulationModel) -> dict:
        return await self.insert_model(regulation)

    async def update_extraction_status(
        self,
        regulation_id: str | ObjectId,
        status: ExtractionStatus,
        *,
        error_message: str | None = None,
        rules_count: int | None = None,
        model_name: str | None = None,
    ) -> dict | None:
        regulation_object_id = regulation_id if isinstance(regulation_id, ObjectId) else ObjectId(regulation_id)
        now = utc_now()
        update_fields: dict[str, object] = {
            "extraction.status": status,
            "extraction.error_message": error_message,
            "updated_at": now,
        }

        if status == ExtractionStatus.PROCESSING:
            update_fields["extraction.started_at"] = now
            update_fields["extraction.completed_at"] = None
        elif status in {ExtractionStatus.COMPLETED, ExtractionStatus.FAILED, ExtractionStatus.CANCELLED}:
            update_fields["extraction.completed_at"] = now

        if rules_count is not None:
            update_fields["extraction.rules_count"] = rules_count
        if model_name is not None:
            update_fields["extraction.model_name"] = model_name

        return await self.collection.find_one_and_update(
            {"_id": regulation_object_id, "is_deleted": {"$ne": True}},
            {"$set": update_fields},
            return_document=ReturnDocument.AFTER,
        )

    async def get_latest_regulation(self, organization_id: str | ObjectId) -> RegulationModel | None:
        """Get the most recently uploaded regulation file for an organization.

        Args:
            organization_id: Organization ID

        Returns:
            Latest regulation or None if no regulations exist
        """
        query = {
            "organization_id": organization_id if isinstance(organization_id, ObjectId) else ObjectId(organization_id),
            "is_deleted": {"$ne": True},
        }

        doc = await self.collection.find_one(query, sort=[("version", -1), ("created_at", -1), ("updated_at", -1)])
        if doc:
            return RegulationModel(**doc)
        return None

    async def get_current_regulation(self, organization_id: str | ObjectId) -> RegulationModel | None:
        query = {
            "organization_id": organization_id if isinstance(organization_id, ObjectId) else ObjectId(organization_id),
            "status": RegulationStatus.ACTIVE,
            "is_deleted": {"$ne": True},
        }

        doc = await self.collection.find_one(query, sort=[("updated_at", -1), ("created_at", -1)])
        if doc:
            return RegulationModel(**doc)
        return None

    async def list_regulations(self, organization_id: str | ObjectId) -> list[RegulationModel]:
        query = {
            "organization_id": organization_id if isinstance(organization_id, ObjectId) else ObjectId(organization_id),
            "is_deleted": {"$ne": True},
        }

        cursor = self.collection.find(query).sort(
            [
                ("status", 1),
                ("version", -1),
                ("updated_at", -1),
                ("created_at", -1),
            ]
        )
        regulations: list[RegulationModel] = []
        async for doc in cursor:
            regulations.append(RegulationModel(**doc))
        return regulations

    async def set_current_regulation(self, organization_id: str | ObjectId, regulation_id: str | ObjectId, *, updated_by) -> dict | None:
        organization_object_id = organization_id if isinstance(organization_id, ObjectId) else ObjectId(organization_id)
        regulation_object_id = regulation_id if isinstance(regulation_id, ObjectId) else ObjectId(regulation_id)
        now = utc_now()

        await self.collection.update_many(
            {
                "organization_id": organization_object_id,
                "_id": {"$ne": regulation_object_id},
                "is_deleted": {"$ne": True},
            },
            {
                "$set": {
                    "status": RegulationStatus.SUPERSEDED,
                    "updated_at": now,
                    "updated_by": updated_by,
                }
            },
        )

        return await self.collection.find_one_and_update(
            {
                "_id": regulation_object_id,
                "organization_id": organization_object_id,
                "is_deleted": {"$ne": True},
            },
            {
                "$set": {
                    "status": RegulationStatus.ACTIVE,
                    "updated_at": now,
                    "updated_by": updated_by,
                }
            },
            return_document=ReturnDocument.AFTER,
        )

    async def update_regulation(
        self,
        regulation_id: str | ObjectId,
        update_fields: dict,
    ) -> dict | None:
        regulation_object_id = regulation_id if isinstance(regulation_id, ObjectId) else ObjectId(regulation_id)
        return await self.collection.find_one_and_update(
            {
                "_id": regulation_object_id,
                "is_deleted": {"$ne": True},
            },
            {"$set": {**update_fields, "updated_at": utc_now()}},
            return_document=ReturnDocument.AFTER,
        )
