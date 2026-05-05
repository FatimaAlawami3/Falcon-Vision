from app.models.monitoring_session_model import MonitoringSessionModel
from app.repositories.base_repository import BaseRepository


class MonitoringSessionRepository(BaseRepository):
    collection_name = "monitoring_sessions"

    async def create(self, monitoring_session: MonitoringSessionModel) -> dict:
        return await self.insert_model(monitoring_session)
