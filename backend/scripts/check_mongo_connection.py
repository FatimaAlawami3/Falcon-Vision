import asyncio
import ssl
import sys
from pathlib import Path

import certifi
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings


def mask_mongo_uri(uri: str) -> str:
    if "://" not in uri:
        return "<invalid uri>"

    scheme, rest = uri.split("://", 1)
    if "@" not in rest:
        return f"{scheme}://{rest.split('?')[0]}..."

    _, host_part = rest.split("@", 1)
    return f"{scheme}://<credentials>@{host_part.split('?')[0]}..."


async def main() -> None:
    settings = get_settings()
    print(f"Python SSL: {ssl.OPENSSL_VERSION}")
    print(f"Mongo URI: {mask_mongo_uri(settings.MONGO_URI)}")
    print(f"Database: {settings.MONGO_DB_NAME}")

    client = AsyncIOMotorClient(
        settings.MONGO_URI,
        tlsCAFile=certifi.where(),
        serverSelectionTimeoutMS=10000,
    )

    try:
        await client.admin.command("ping")
        db = client[settings.MONGO_DB_NAME]
        collections = await db.list_collection_names()
        print("MongoDB connection: OK")
        print(f"Collections found: {len(collections)}")
        if collections:
            print(", ".join(sorted(collections)))
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
