"""Application settings via Pydantic."""

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve .env path. Works both:
#   - local dev: file is at apps/sync-api/app/config.py → parents[2] = repo root
#   - Docker:    file is at /app/app/config.py           → parents[1] = /app (WORKDIR)
def _find_env_file() -> Path | None:
    here = Path(__file__).resolve().parent
    for ancestor in [here, *here.parents]:
        candidate = ancestor / ".env"
        if candidate.exists():
            return candidate
    return None


_ENV_FILE = _find_env_file()


class Settings(BaseSettings):
    """Configuration loaded from environment variables / .env file."""

    # If we found a .env, load it. Otherwise rely on process env (Render
    # injects secrets as env vars, so this works in production).
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE) if _ENV_FILE else None,
        extra="ignore",
    )

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
