import json
import re
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
    AZURE_STORAGE_CONNECTION_STRING: str | None = None
    AZURE_STORAGE_CONTAINER: str = "fv"
    AZURE_STORAGE_URL_EXPIRY_MINUTES: int = 60
    CORS_ORIGINS: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5174",
            "http://localhost:5175",
            "http://127.0.0.1:5175",
            "https://falcon-vision.site",
            "https://www.falcon-vision.site",
        ]
    )

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
            if normalized in {"warn", "warning", "info", "error", "off"}:
                return False
        return value

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def normalize_cors_origins(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return []

            if stripped.startswith("["):
                try:
                    parsed = json.loads(stripped)
                except json.JSONDecodeError:
                    parsed = None
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]

            return [item.strip() for item in stripped.split(",") if item.strip()]

        return value

    @field_validator("AZURE_STORAGE_CONTAINER")
    @classmethod
    def validate_azure_storage_container(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized:
            raise ValueError("AZURE_STORAGE_CONTAINER cannot be empty")

        if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?", normalized):
            raise ValueError(
                "AZURE_STORAGE_CONTAINER must be 3-63 characters and use only lowercase letters, numbers, and hyphens"
            )

        return normalized

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
