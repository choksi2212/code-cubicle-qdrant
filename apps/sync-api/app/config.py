"""Application settings via Pydantic."""

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _find_env_file() -> Path | None:
    """Walk up from this file looking for a `.env`. Returns None if not found."""
    here = Path(__file__).resolve().parent
    for ancestor in [here, *here.parents]:
        candidate = ancestor / ".env"
        if candidate.exists():
            return candidate
    return None


class Settings(BaseSettings):
    """Configuration loaded from environment variables / .env file."""

    model_config = SettingsConfigDict(
        # Load .env only when present (local dev). In Docker/Render we rely on
        # process env vars.
        env_file=_find_env_file(),
        case_sensitive=False,
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

    # enrichment (forwarded from mobile for enrichment triggers)

    # Logging
    log_level: str = "INFO"


# Build settings once at module import. This guarantees we read process env
# (Render injects secrets here) regardless of how pydantic-settings caches
# the env_file decision across reloads.
settings = Settings()


# ── Belt-and-suspenders: directly read process env for the most critical vars
# so we never depend on pydantic-settings cache behaviour. Settings()'s defaults
# are still the source of truth for type validation, but this guarantees
# the live value matches what Render injected.
for _key in ("qdrant_url", "qdrant_api_key", "qdrant_collection", "jwt_secret", "port"):
    _env_val = os.environ.get(_key.upper())
    if _env_val is not None:
        setattr(settings, _key, _env_val)
