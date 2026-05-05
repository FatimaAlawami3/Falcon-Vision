from datetime import datetime
from typing import Any

from bson import ObjectId

from app.models.alert_model import AlertModel
from app.repositories.base_repository import BaseRepository
from app.utils.datetime import utc_now


class AlertRepository(BaseRepository):
    collection_name = "alerts"

    async def create(self, alert: AlertModel) -> dict[str, Any]:
        return await self.insert_model(alert)

    async def list_by_organization(
        self,
        organization_id: ObjectId,
        *,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        cursor = self.collection.find(
            {
                "organization_id": organization_id,
                "is_deleted": {"$ne": True},
            }
        ).sort("detected_at", -1)
        if limit is not None:
            cursor = cursor.limit(limit)
        return await cursor.to_list(length=limit)

    async def list_all_by_organization(self, organization_id: ObjectId) -> list[dict[str, Any]]:
        cursor = self.collection.find(
            {
                "organization_id": organization_id,
            }
        ).sort("detected_at", -1)
        return await cursor.to_list(length=None)

    async def list_by_ids(
        self,
        organization_id: ObjectId,
        alert_ids: list[ObjectId],
    ) -> list[dict[str, Any]]:
        if not alert_ids:
            return []

        cursor = self.collection.find(
            {
                "_id": {"$in": alert_ids},
                "organization_id": organization_id,
            }
        )
        return await cursor.to_list(length=None)

    async def find_recent_duplicate(
        self,
        organization_id: ObjectId,
        *,
        title: str,
        message: str,
        category: str,
        detected_after: datetime,
    ) -> dict[str, Any] | None:
        return await self.collection.find_one(
            {
                "organization_id": organization_id,
                "title": title,
                "message": message,
                "category": category,
                "detected_at": {"$gte": detected_after},
                "is_deleted": {"$ne": True},
            }
        )

    async def list_by_regulation(
        self,
        organization_id: ObjectId,
        regulation_id: ObjectId,
    ) -> list[dict[str, Any]]:
        cursor = self.collection.find(
            {
                "organization_id": organization_id,
                "regulation_id": regulation_id,
                "is_deleted": {"$ne": True},
            }
        ).sort("detected_at", -1)
        return await cursor.to_list(length=None)

    async def soft_delete_by_ids(
        self,
        alert_ids: list[ObjectId],
        *,
        updated_by: ObjectId | None = None,
    ) -> int:
        if not alert_ids:
            return 0

        update = {
            "is_deleted": True,
            "updated_at": utc_now(),
        }
        if updated_by is not None:
            update["updated_by"] = updated_by

        result = await self.collection.update_many(
            {
                "_id": {"$in": alert_ids},
                "is_deleted": {"$ne": True},
            },
            {"$set": update},
        )
        return int(result.modified_count)

    async def hard_delete_by_ids(self, alert_ids: list[ObjectId]) -> int:
        if not alert_ids:
            return 0

        result = await self.collection.delete_many(
            {
                "_id": {"$in": alert_ids},
            },
        )
        return int(result.deleted_count)

    async def soft_delete_by_organization(
        self,
        organization_id: ObjectId,
        *,
        updated_by: ObjectId | None = None,
    ) -> int:
        update = {
            "is_deleted": True,
            "updated_at": utc_now(),
        }
        if updated_by is not None:
            update["updated_by"] = updated_by

        result = await self.collection.update_many(
            {
                "organization_id": organization_id,
                "is_deleted": {"$ne": True},
            },
            {"$set": update},
        )
        return int(result.modified_count)
