from datetime import datetime
from typing import Any

from bson import ObjectId

from app.models.alert_model import AlertModel
from app.repositories.base_repository import BaseRepository


class AlertRepository(BaseRepository):
    collection_name = "alerts"

    async def create(self, alert: AlertModel) -> dict[str, Any]:
        return await self.insert_model(alert)

    async def list_by_organization(
        self,
        organization_id: ObjectId,
        *,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        cursor = self.collection.find(
            {
                "organization_id": organization_id,
                "is_deleted": {"$ne": True},
            }
        ).sort("detected_at", -1).limit(limit)
        return await cursor.to_list(length=limit)

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
