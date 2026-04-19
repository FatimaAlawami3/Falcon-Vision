from bson import ObjectId
from pymongo import ReturnDocument

from app.core.constants import ExtractionStatus
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
        elif status in {ExtractionStatus.COMPLETED, ExtractionStatus.FAILED}:
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
