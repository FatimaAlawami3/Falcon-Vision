import asyncio
import sys
from pathlib import Path

from pymongo import ASCENDING, DESCENDING, IndexModel

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.core.database import close_mongo_connection, connect_to_mongo, get_database


INDEXES: dict[str, list[IndexModel]] = {
    "organizations": [
        IndexModel([("name", ASCENDING)]),
        IndexModel([("status", ASCENDING)]),
        IndexModel([("is_deleted", ASCENDING)]),
    ],
    "users": [
        IndexModel([("email", ASCENDING)], unique=True),
        IndexModel([("organization_id", ASCENDING), ("role", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("is_deleted", ASCENDING)]),
    ],
    "regulations": [
        IndexModel([("organization_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("extraction.status", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("uploaded_by", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("file.sha256", ASCENDING)]),
    ],
    "extracted_rules": [
        IndexModel([("organization_id", ASCENDING), ("regulation_id", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("category", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("severity", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("vision_mapping.module", ASCENDING)]),
    ],
    "extraction_jobs": [
        IndexModel([("organization_id", ASCENDING), ("regulation_id", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("queued_at", ASCENDING)]),
    ],
    "employees": [
        IndexModel([("organization_id", ASCENDING), ("employee_number", ASCENDING)], unique=True),
        IndexModel([("organization_id", ASCENDING), ("linked_user_id", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("full_name", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("department", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("is_deleted", ASCENDING)]),
    ],
    "employee_faces": [
        IndexModel([("organization_id", ASCENDING), ("employee_id", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("image.sha256", ASCENDING)]),
    ],
    "zones": [
        IndexModel([("organization_id", ASCENDING), ("code", ASCENDING)], unique=True),
        IndexModel([("organization_id", ASCENDING), ("type", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("risk_level", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("status", ASCENDING)]),
    ],
    "employee_zone_permissions": [
        IndexModel([("organization_id", ASCENDING), ("employee_id", ASCENDING), ("zone_id", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("zone_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("employee_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("valid_until", ASCENDING)]),
    ],
    "cameras": [
        IndexModel([("organization_id", ASCENDING), ("code", ASCENDING)], unique=True),
        IndexModel([("organization_id", ASCENDING), ("zone_id", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("enabled_modules", ASCENDING)]),
    ],
    "monitoring_sessions": [
        IndexModel([("organization_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("started_at", DESCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("camera_ids", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("zone_ids", ASCENDING)]),
    ],
    "detections": [
        IndexModel([("organization_id", ASCENDING), ("detected_at", DESCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("camera_id", ASCENDING), ("detected_at", DESCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("zone_id", ASCENDING), ("detected_at", DESCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("module", ASCENDING), ("detected_at", DESCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("event_type", ASCENDING), ("detected_at", DESCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("alert_created", ASCENDING)]),
        IndexModel([("subject.employee_id", ASCENDING), ("detected_at", DESCENDING)]),
    ],
    "alerts": [
        IndexModel([("organization_id", ASCENDING), ("status", ASCENDING), ("severity", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("detected_at", DESCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("snapshot.zone_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("snapshot.employee_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("category", ASCENDING), ("created_at", DESCENDING)]),
    ],
    "notifications": [
        IndexModel([("recipient_user_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("recipient_user_id", ASCENDING), ("status", ASCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("type", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("related_entity.type", ASCENDING), ("related_entity.id", ASCENDING)]),
    ],
    "audit_logs": [
        IndexModel([("organization_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("actor_user_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("organization_id", ASCENDING), ("action", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("entity.type", ASCENDING), ("entity.id", ASCENDING)]),
    ],
}


async def create_indexes() -> None:
    await connect_to_mongo()
    db = get_database()

    for collection_name, indexes in INDEXES.items():
        if indexes:
            await db[collection_name].create_indexes(indexes)
            print(f"Created indexes for {collection_name}")

    await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(create_indexes())
