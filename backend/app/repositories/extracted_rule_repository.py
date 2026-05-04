from typing import List

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.constants import EntityStatus, RuleCategory, VisionModule
from app.models.extracted_rule_model import ExtractedRuleModel
from app.repositories.base_repository import BaseRepository
from app.utils.datetime import utc_now
from app.utils.object_id import validate_object_id


class ExtractedRuleRepository(BaseRepository):
    """Repository for managing extracted rules from regulations."""

    collection_name = "extracted_rules"

    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        super().__init__(db)

    @staticmethod
    def _organization_query_value(organization_id: str | ObjectId) -> ObjectId:
        return organization_id if isinstance(organization_id, ObjectId) else validate_object_id(organization_id)

    async def get_active_rules_by_category_and_zone(
        self, organization_id: str | ObjectId, category: RuleCategory, zone_type: str
    ) -> List[ExtractedRuleModel]:
        """Get active rules for a specific category and zone type.

        Args:
            organization_id: Organization ID
            category: Rule category (e.g., PPE)
            zone_type: Zone type to filter rules

        Returns:
            List of active rules
        """
        query = {
            "organization_id": self._organization_query_value(organization_id),
            "category": category,
            "status": EntityStatus.ACTIVE,
            "applies_to.zone_types": zone_type,
            "is_deleted": {"$ne": True},
        }

        cursor = self.collection.find(query)
        rules = []
        async for doc in cursor:
            rules.append(ExtractedRuleModel(**doc))

        return rules

    async def get_active_rules_by_category(
        self, organization_id: str | ObjectId, category: RuleCategory
    ) -> List[ExtractedRuleModel]:
        """Get active rules for a specific category regardless of zone.

        Args:
            organization_id: Organization ID
            category: Rule category (e.g., PPE)

        Returns:
            List of active rules
        """
        query = {
            "organization_id": self._organization_query_value(organization_id),
            "category": category,
            "status": EntityStatus.ACTIVE,
            "is_deleted": {"$ne": True},
        }

        cursor = self.collection.find(query)
        rules = []
        async for doc in cursor:
            rules.append(ExtractedRuleModel(**doc))

        return rules

    async def get_rules_by_module(self, organization_id: str | ObjectId, module: VisionModule) -> List[ExtractedRuleModel]:
        """Get rules that use a specific vision module.

        Args:
            organization_id: Organization ID
            module: Vision module to filter by

        Returns:
            List of rules using the specified module
        """
        query = {
            "organization_id": self._organization_query_value(organization_id),
            "vision_mapping.module": module,
            "status": EntityStatus.ACTIVE,
            "is_deleted": {"$ne": True},
        }

        cursor = self.collection.find(query)
        rules = []
        async for doc in cursor:
            rules.append(ExtractedRuleModel(**doc))

        return rules

    async def deactivate_rules_by_module(self, organization_id: str, module: VisionModule, *, updated_by) -> int:
        result = await self.collection.update_many(
            {
                "organization_id": organization_id,
                "vision_mapping.module": module,
                "status": EntityStatus.ACTIVE,
                "is_deleted": {"$ne": True},
            },
            {
                "$set": {
                    "status": EntityStatus.INACTIVE,
                    "updated_at": utc_now(),
                    "updated_by": updated_by,
                }
            },
        )
        return int(result.modified_count)

    async def get_rules_by_regulation(self, regulation_id: str | ObjectId) -> List[ExtractedRuleModel]:
        """Get all rules extracted from a specific regulation.

        Args:
            regulation_id: Regulation ID

        Returns:
            List of rules from the regulation
        """
        query = {
            "regulation_id": regulation_id if isinstance(regulation_id, ObjectId) else validate_object_id(regulation_id),
            "is_deleted": {"$ne": True},
        }

        cursor = self.collection.find(query)
        rules = []
        async for doc in cursor:
            rules.append(ExtractedRuleModel(**doc))

        return rules

    async def soft_delete_by_regulation(self, regulation_id: str | ObjectId, *, updated_by) -> int:
        regulation_object_id = regulation_id if isinstance(regulation_id, ObjectId) else validate_object_id(regulation_id)
        result = await self.collection.update_many(
            {
                "regulation_id": regulation_object_id,
                "is_deleted": {"$ne": True},
            },
            {
                "$set": {
                    "is_deleted": True,
                    "updated_at": utc_now(),
                    "updated_by": updated_by,
                }
            },
        )
        return int(result.modified_count)

    async def soft_delete_by_organization(self, organization_id: str | ObjectId, *, updated_by) -> int:
        result = await self.collection.update_many(
            {
                "organization_id": organization_id if isinstance(organization_id, ObjectId) else validate_object_id(organization_id),
                "is_deleted": {"$ne": True},
            },
            {
                "$set": {
                    "is_deleted": True,
                    "updated_at": utc_now(),
                    "updated_by": updated_by,
                }
            },
        )
        return int(result.modified_count)
