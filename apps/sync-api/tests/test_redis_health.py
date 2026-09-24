"""Health + readiness tests for the Redis integration.

Two contracts we verify:

1. ``/readyz`` exposes a ``redis`` boolean reflecting the live ping.
   - With Redis disabled in config (``REDIS_ENABLED=false``), ``redis``
     is always ``false`` regardless of whether Redis is actually up.
   - With Redis enabled AND reachable, ``redis`` is ``true``.
   - With Redis enabled BUT unreachable, ``redis`` is ``false``.

2. The app boots cleanly with ``REDIS_ENABLED=false`` — graceful
   degradation means no Redis connection is ever attempted, the
   startup ping is a no-op, and the existing test suite continues to
   behave under the v0 contract (old refresh tokens keep working
   after rotation).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from asgi_lifespan import LifespanManager

# Make `app` importable.
TEST_FILE = Path(__file__).resolve()
ROOT = TEST_FILE.parent
while ROOT != ROOT.parent and not (ROOT / "apps").is_dir():
    ROOT = ROOT.parent
if str(ROOT / "apps" / "sync-api") not in sys.path:
    sys.path.insert(0, str(ROOT / "apps" / "sync-api"))

# conftest already sets REDIS_ENABLED=false before import; this test
# module flips it on/off locally via its own fixtures.
from app.main import app  # noqa: E402
from app.services import qdrant as qdrant_svc  # noqa: E402


# ── Fixtures ────────────────────────────────────────────────────────────────


class _FakeQdrantClient:
    def __init__(self) -> None:
        self.points: dict[str, dict] = {}

    def create_collection(self, **kwargs):
        return True

    def create_payload_index(self, **kwargs):
        return True

    def get_collection(self, collection_name: str):
        return SimpleNamespace(points_count=0, status="green")

    def upsert(self, collection_name: str, points, wait: bool = True):
        return SimpleNamespace(status="completed")

    def retrieve(self, collection_name: str, ids, **kwargs):
        return []

    def scroll(self, collection_name: str, scroll_filter=None, limit: int = 100, with_payload: bool = True):
        return [], None


@pytest.fixture
def fake_qdrant(monkeypatch):
    fake = _FakeQdrantClient()
    monkeypatch.setattr(qdrant_svc, "get_client", lambda: fake)
    monkeypatch.setattr(qdrant_svc, "ensure_collection", lambda *a, **kw: None)
    monkeypatch.setattr(qdrant_svc, "upsert_point", lambda *a, **kw: None)
    monkeypatch.setattr(qdrant_svc, "retrieve_point", lambda *a, **kw: None)
    monkeypatch.setattr(qdrant_svc, "scroll_points", lambda *a, **kw: ([], None))
    monkeypatch.setattr(qdrant_svc, "collection_count", lambda *a, **kw: 0)
    return fake


@pytest.fixture
async def client_redis_disabled(fake_qdrant, monkeypatch):
    """Force REDIS_ENABLED=false for this client (overrides conftest default)."""
    monkeypatch.setenv("REDIS_ENABLED", "false")
    # Reload the settings module-level values + reset the redis pool.
    from app import config as _config
    from app import redis_client as _rc

    _config.settings.redis_enabled = False
    _rc._pool = None

    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            yield ac


@pytest.fixture
async def client_redis_enabled(fake_qdrant, live_redis):
    """Force REDIS_ENABLED=true against the real cluster."""
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            yield ac


# ── Tests ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_readyz_reports_redis_false_when_disabled(client_redis_disabled):
    """With ``REDIS_ENABLED=false``, ``/readyz`` reports ``redis: false``
    even though the Qdrant cluster IS reachable. The probe still returns
    200 — Redis is best-effort, not a hard readiness gate.
    """
    resp = await client_redis_disabled.get("/readyz")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "redis" in body, body
    assert body["redis"] is False
    assert body["status"] == "ready"


@pytest.mark.asyncio
async def test_app_starts_with_redis_disabled(client_redis_disabled):
    """Smoke: the app boots, ``/healthz`` returns 200, ``/readyz`` returns
    200 — all without ever touching Redis. This is the fallback path.
    """
    h = await client_redis_disabled.get("/healthz")
    assert h.status_code == 200
    assert h.json() == {"status": "alive"}

    r = await client_redis_disabled.get("/readyz")
    assert r.status_code == 200
    assert r.json()["redis"] is False


@pytest.mark.live_redis
@pytest.mark.asyncio
async def test_readyz_reports_redis_true_when_reachable(client_redis_enabled):
    """With the real cluster reachable, ``/readyz`` reports ``redis: true``."""
    resp = await client_redis_enabled.get("/readyz")
    assert resp.status_code == 200
    body = resp.json()
    assert "redis" in body
    assert body["redis"] is True


@pytest.mark.live_redis
@pytest.mark.asyncio
async def test_readyz_reports_redis_false_when_unreachable(fake_qdrant, monkeypatch):
    """With Redis enabled BUT pointed at an unreachable host, ``/readyz``
    still returns 200 (Qdrant is the hard dep) with ``redis: false``.
    """
    # Point Redis at a port nothing's listening on.
    monkeypatch.setenv("REDIS_ENABLED", "true")
    monkeypatch.setenv(
        "REDIS_URL", "redis://127.0.0.1:1/0"  # closed port on Windows + Linux
    )
    from app import config as _config
    from app import redis_client as _rc

    _config.settings.redis_enabled = True
    _config.settings.redis_url = "redis://127.0.0.1:1/0"
    _rc._pool = None

    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            resp = await ac.get("/readyz")
            assert resp.status_code == 200
            body = resp.json()
            assert body["redis"] is False


@pytest.mark.asyncio
async def test_refresh_old_token_still_works_when_redis_disabled(
    client_redis_disabled, monkeypatch
):
    """The v0 contract (old refresh token keeps working after rotation)
    is preserved when ``REDIS_ENABLED=false`` — no Redis call is made,
    so the revocation check is a no-op and the original behaviour
    holds. This is the explicit graceful-degradation promise.
    """
    login = await client_redis_disabled.post(
        "/auth/login",
        json={"device_id": "device-graceful", "device_token": "abcdefgh1234"},
    )
    assert login.status_code == 200
    old_refresh = login.json()["refresh_token"]

    r1 = await client_redis_disabled.post(
        "/auth/refresh", json={"refresh_token": old_refresh}
    )
    assert r1.status_code == 200

    # Second use of the SAME old refresh: should still 200 because
    # Redis is disabled and revocation isn't enforced.
    r2 = await client_redis_disabled.post(
        "/auth/refresh", json={"refresh_token": old_refresh}
    )
    assert r2.status_code == 200
