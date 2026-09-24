"""Idempotency cache tests for ``POST /sync/upload``.

The upload router hashes the request body's canonical JSON with
SHA-256 and uses it as a Redis cache key. A repeat POST of the same
body within the 24h TTL returns the cached response with
``already_received=true`` instead of re-running the per-point loop.

These tests opt-in to the real Redis cluster via the ``live_redis``
fixture (see tests/conftest.py). With Redis disabled the idempotency
cache is a no-op — every upload is processed fresh.

We namespace every test's payloads with a fresh ULID so a previous
test run's cache entries (24h TTL) don't bleed into the current run.
"""

from __future__ import annotations

import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from asgi_lifespan import LifespanManager
import ulid

# Make `app` importable when running `pytest apps/sync-api/tests/`.
TEST_FILE = Path(__file__).resolve()
ROOT = TEST_FILE.parent
while ROOT != ROOT.parent and not (ROOT / "apps").is_dir():
    ROOT = ROOT.parent
if str(ROOT / "apps" / "sync-api") not in sys.path:
    sys.path.insert(0, str(ROOT / "apps" / "sync-api"))

from app.main import app  # noqa: E402
from app.services import qdrant as qdrant_svc  # noqa: E402


# ── Fixtures ────────────────────────────────────────────────────────────────


class _FakeQdrantClient:
    """In-memory Qdrant stand-in for the upload tests."""

    def __init__(self) -> None:
        self.points: dict[str, dict] = {}
        self.upsert_calls = 0  # how many times the router actually wrote

    def create_collection(self, **kwargs):
        return True

    def create_payload_index(self, **kwargs):
        return True

    def get_collection(self, collection_name: str):
        return SimpleNamespace(points_count=len(self.points), status="green")

    def upsert(self, collection_name: str, points, wait: bool = True):
        for p in points:
            self.points[str(p.id)] = {
                "id": str(p.id),
                "vector": list(p.vector),
                "payload": dict(p.payload),
            }
        self.upsert_calls += len(points)
        return SimpleNamespace(status="completed")

    def retrieve(self, collection_name: str, ids, **kwargs):
        records = []
        for pid in ids:
            stored = self.points.get(str(pid))
            if stored:
                records.append(
                    SimpleNamespace(
                        id=stored["id"],
                        vector=stored["vector"],
                        payload=stored["payload"],
                    )
                )
        return records

    def scroll(self, collection_name: str, scroll_filter=None, limit: int = 100, with_payload: bool = True):
        return [], None


@pytest.fixture
def fake_qdrant(monkeypatch):
    fake = _FakeQdrantClient()
    monkeypatch.setattr(qdrant_svc, "get_client", lambda: fake)
    monkeypatch.setattr(qdrant_svc, "ensure_collection", lambda *a, **kw: None)
    monkeypatch.setattr(qdrant_svc, "upsert_point",
                        lambda *a, **kw: fake.upsert_calls)  # tracker isn't used
    monkeypatch.setattr(qdrant_svc, "retrieve_point",
                        lambda client, collection, pid: fake.points.get(pid))
    monkeypatch.setattr(qdrant_svc, "scroll_points",
                        lambda client, collection, since, limit: ([], None))
    monkeypatch.setattr(qdrant_svc, "collection_count", lambda *a, **kw: len(fake.points))
    return fake


@pytest.fixture
async def client(fake_qdrant, live_redis):
    """ASGI client with lifespan fired AND live Redis enabled."""
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            yield ac


async def _login(client, device_id: str) -> dict:
    resp = await client.post(
        "/auth/login",
        json={"device_id": device_id, "device_token": "abcdefgh1234"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _sample_batch(device_id: str, batch_id: str | None = None) -> dict:
    """Build a sample upload body with a unique batch_id + photo_id +
    point_id so each test run produces a unique SHA-256 cache key.

    Falls back to a per-call ``ulid.ULID()`` when no batch_id is given.
    """
    batch_id = batch_id or str(ulid.ULID())
    photo_id = str(ulid.ULID())
    point_id = str(uuid.uuid4())
    return {
        "device_id": device_id,
        "batch_id": batch_id,
        "points": [
            {
                "id": point_id,
                "vector": [0.01] * 512,
                "payload": {
                    "schema_version": 2,
                    "photo_id": photo_id,
                    "device_id": device_id,
                    "captured_at": "2026-09-24T10:00:00+00:00",
                    "lat": 12.9716,
                    "lng": 77.5946,
                    "gps_status": "ok",
                    "project_id": "proj_idemp_test",
                    "file_path": f"photos/{photo_id}.jpg",
                    "embedding_status": "ok",
                    "enrichment_id": None,
                    "enrichment_tags": [],
                    "enrichment_objects": [],
                    "enrichment_text": None,
                    "synced_at": None,
                    "local_updated_at": "2026-09-24T10:00:01+00:00",
                    "vector_checksum": "sha256:idemp",
                    "deletion_marker": False,
                    "project_owner": None,
                    "tags_v2": [],
                },
            }
        ],
    }


# ── Tests ───────────────────────────────────────────────────────────────────


@pytest.mark.live_redis
@pytest.mark.asyncio
async def test_duplicate_upload_returns_already_received(client, fake_qdrant):
    """POST the same batch twice → second response has already_received=true."""
    pair = await _login(client, "device-idem-1")
    access = pair["access_token"]
    batch = _sample_batch("device-idem-1")

    # First call: 1 point upserted, response carries a normal `accepted` result.
    r1 = await client.post(
        "/sync/upload", json=batch, headers={"Authorization": f"Bearer {access}"}
    )
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert body1["already_received"] is False
    assert len(body1["results"]) == 1
    assert body1["results"][0]["status"] == "accepted"

    # Second call: same body. The idempotency cache should kick in.
    r2 = await client.post(
        "/sync/upload", json=batch, headers={"Authorization": f"Bearer {access}"}
    )
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["already_received"] is True
    # The cached response echoes the original per-point results so the
    # client can verify the original outcome — it's not a "re-process"
    # path, it's a "we already accepted this" replay. The device's
    # dedupe logic uses already_received=True, not results==[].
    assert len(body2["results"]) == len(body1["results"])
    assert body2["batch_id"] == body1["batch_id"]


@pytest.mark.live_redis
@pytest.mark.asyncio
async def test_different_bodies_are_not_cached(client, fake_qdrant):
    """A batch with a different ``batch_id`` is NOT a duplicate — both
    uploads are processed and both return normal responses.
    """
    pair = await _login(client, "device-idem-2")
    access = pair["access_token"]

    r1 = await client.post(
        "/sync/upload",
        json=_sample_batch("device-idem-2", batch_id=str(ulid.ULID())),
        headers={"Authorization": f"Bearer {access}"},
    )
    r2 = await client.post(
        "/sync/upload",
        json=_sample_batch("device-idem-2", batch_id=str(ulid.ULID())),
        headers={"Authorization": f"Bearer {access}"},
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json().get("already_received") is not True
    assert r2.json().get("already_received") is not True
    # Both responses carried the same per-point status (1 point accepted each).
    assert r1.json()["results"][0]["status"] == "accepted"
    assert r2.json()["results"][0]["status"] == "accepted"


@pytest.mark.live_redis
@pytest.mark.asyncio
async def test_idempotent_replay_preserves_original_batch_id(client, fake_qdrant):
    """The cached response's ``batch_id`` echoes the ORIGINAL batch_id,
    not the duplicate's — so the device can dedupe its own send-log.
    """
    pair = await _login(client, "device-idem-3")
    access = pair["access_token"]
    original_batch_id = str(ulid.ULID())
    batch = _sample_batch("device-idem-3", batch_id=original_batch_id)

    r1 = await client.post(
        "/sync/upload", json=batch, headers={"Authorization": f"Bearer {access}"}
    )
    assert r1.status_code == 200

    r2 = await client.post(
        "/sync/upload", json=batch, headers={"Authorization": f"Bearer {access}"}
    )
    assert r2.status_code == 200
    assert r2.json()["already_received"] is True
    assert r2.json()["batch_id"] == original_batch_id


@pytest.mark.live_redis
@pytest.mark.asyncio
async def test_idempotency_cache_does_not_block_wal_replay(client, fake_qdrant):
    """``/sync/wal/replay`` does NOT consult the upload idempotency cache
    — that's a separate endpoint designed to re-run batches the device
    thinks might have been lost. We only check that the upload cache
    doesn't bleed into the replay path.
    """
    pair = await _login(client, "device-idem-4")
    access = pair["access_token"]
    batch = _sample_batch("device-idem-4")

    # Upload once to seed the cache.
    r1 = await client.post(
        "/sync/upload", json=batch, headers={"Authorization": f"Bearer {access}"}
    )
    assert r1.status_code == 200

    # The replay endpoint runs a fresh conflict loop and returns a
    # normal UploadResponse (no `already_received`).
    replay_req = {**batch, "replay": True}
    r2 = await client.post(
        "/sync/wal/replay",
        json=replay_req,
        headers={"Authorization": f"Bearer {access}"},
    )
    assert r2.status_code == 200
    assert r2.json().get("already_received") is not True
