"""Application settings via Pydantic."""

import os
import secrets
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


# Placeholder default for the JWT signing secret. The first time the process
# boots we replace this with a randomly generated 64-byte hex string and
# persist it to disk so subsequent restarts keep signing with the same key.
# Production should set JWT_SECRET explicitly via the environment — the
# auto-generation is a hackathon-grade convenience so the dev demo works
# out of the box without manual setup.
_GENERATED_SECRET_FILE = Path(__file__).resolve().parent / ".jwt_secret"


def _load_or_generate_jwt_secret() -> str:
    """Return a stable JWT_SECRET across restarts.

    Order:
      1. Process env `JWT_SECRET` (preferred — Render/prod sets this).
      2. A file at `apps/sync-api/app/.jwt_secret` we wrote on first boot.
      3. Newly generated secrets.token_hex(32), persisted to that file.
    """
    env_val = os.environ.get("JWT_SECRET")
    if env_val:
        return env_val
    if _GENERATED_SECRET_FILE.exists():
        stored = _GENERATED_SECRET_FILE.read_text(encoding="utf-8").strip()
        if stored:
            return stored
    fresh = secrets.token_hex(32)
    try:
        _GENERATED_SECRET_FILE.write_text(fresh, encoding="utf-8")
    except OSError:
        # Filesystem not writable (e.g. read-only deploy) — fall back to the
        # in-memory value for this process. Tokens won't survive restart,
        # but the server still boots.
        pass
    return fresh


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
    jwt_access_ttl_seconds: int = 900       # 15 min
    jwt_refresh_ttl_seconds: int = 604_800  # 7 days
    rate_limit_per_minute: int = 60

    # enrichment (forwarded from mobile for enrichment triggers)

    # Redis (JWT revocation list + upload idempotency cache)
    redis_url: str = "redis://localhost:6379/0"
    redis_enabled: bool = True  # tests can flip this off to skip Redis entirely

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
_BOOL_KEYS = {"redis_enabled"}
_INT_KEYS = {"jwt_access_ttl_seconds", "jwt_refresh_ttl_seconds", "port"}
for _key in (
    "qdrant_url",
    "qdrant_api_key",
    "qdrant_collection",
    "jwt_secret",
    "jwt_access_ttl_seconds",
    "jwt_refresh_ttl_seconds",
    "port",
    "redis_url",
    "redis_enabled",
):
    _env_val = os.environ.get(_key.upper())
    if _env_val is None:
        continue
    if _key in _BOOL_KEYS:
        setattr(settings, _key, _env_val.strip().lower() in {"1", "true", "yes", "on"})
    elif _key in _INT_KEYS:
        try:
            setattr(settings, _key, int(_env_val))
        except ValueError:
            pass
    else:
        setattr(settings, _key, _env_val)

# If process env never set jwt_secret and the placeholder is still in place,
# swap it for a stable random one (persisted on disk). This MUST run after
# the env-loop above so explicit JWT_SECRET wins.
if settings.jwt_secret == "change-me-in-production":
    settings.jwt_secret = _load_or_generate_jwt_secret()
