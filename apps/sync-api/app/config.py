"""Application settings via Pydantic."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve .env path from repo root
_REPO_ROOT = Path(__file__).resolve().parents[3]
_ENV_FILE = _REPO_ROOT / ".env"


class Settings(BaseSettings):
    """Configuration loaded from environment variables / .env file."""

    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # Qdrant
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str | None = None
    qdrant_collection: str = "field_edge_central"

    # Auth
    jwt_secret: str = "change-me-in-production"
    rate_limit_per_minute: int = 60

    # Cloudinary (forwarded from mobile for enrichment triggers)
    cloudinary_cloud_name: str | None = None
    cloudinary_api_key: str | None = None
    cloudinary_api_secret: str | None = None

    # Logging
    log_level: str = "INFO"


settings = Settings()
