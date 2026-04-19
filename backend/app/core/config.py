from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str
    ENVIRONMENT: str
    DEBUG: bool

    MONGO_URI: str
    MONGO_DB_NAME: str

    JWT_SECRET_KEY: str = Field(default="change-this-secret-before-production")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    UPLOAD_DIR: Path = Path("uploads")
    MAX_PDF_SIZE_MB: int = 25
    MAX_FACE_IMAGE_SIZE_MB: int = 10
    FIRE_DETECTION_ENABLED: bool = True

    # Hugging Face API token for rule extraction
    HF_TOKEN: str | None = None

    @field_validator("DEBUG", mode="before")
    @classmethod
    def normalize_debug(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "production", "prod"}:
                return False
            if normalized in {"debug", "development", "dev"}:
                return True
        return value

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
