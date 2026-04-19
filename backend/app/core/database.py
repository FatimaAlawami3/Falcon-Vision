import certifi
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import get_settings


class MongoDatabase:
    client: AsyncIOMotorClient | None = None
    database: AsyncIOMotorDatabase | None = None


mongodb = MongoDatabase()


async def connect_to_mongo() -> None:
    settings = get_settings()
    mongodb.client = AsyncIOMotorClient(settings.MONGO_URI, tlsCAFile=certifi.where())
    mongodb.database = mongodb.client[settings.MONGO_DB_NAME]
    await mongodb.client.admin.command("ping")


async def close_mongo_connection() -> None:
    if mongodb.client is not None:
        mongodb.client.close()
    mongodb.client = None
    mongodb.database = None


def get_database() -> AsyncIOMotorDatabase:
    if mongodb.database is None:
        raise RuntimeError("MongoDB is not connected. Call connect_to_mongo first.")
    return mongodb.database
