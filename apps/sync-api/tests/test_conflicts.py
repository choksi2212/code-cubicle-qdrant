"""Tests for the /sync/conflicts/:photo_id audit endpoint.

Covers:
    - 401 when no Bearer token is supplied.
    - 404 when the photo_id is unknown to Qdrant.
    - 200 + correct winner when a known photo is fetched.

The `_local_snapshot` field is what the upload router writes on every
upload — we set it directly on the fake Qdrant store here to avoid
driving the full upload pipeline.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from asgi_lifespan import LifespanManager

# Make `app` importable when running pytest from the repo root.
TEST_FILE = Path(__file__).resolve()
ROOT = TEST_FILE.parent
while ROOT != ROOT.parent and not (ROOT / "apps").is_dir():
    ROOT = ROOT.parent
if str(ROOT / "apps" / "sync-api") not in sys.path:
    sys.path.insert(0, str(ROOT / "apps" / "sync-api"))

from app.main import app  # noqa: E402
from app.services import qdrant as qdrant_svc  # noqa: E402


PHOTO_ID = "550e8400-e29b-41d4-a716-446655440000"
# Mint a real access JWT so the new auth dependency (require_auth) accepts it.
# The token's `sub` claim becomes the device_id the endpoint sees.
from app.auth import create_access_token  # noqa: E402

_BEARER_TOKEN = create_access_token("test-device-1234")
BEARER = f"Bearer {_BEARER_TOKEN}"


class _FakeQdrantClient:
    """Minimal in-memory Qdrant stand-in for the conflicts tests."""

    def __init__(self) -> None:
        self.points: dict[str, dict] = {}

    def retrieve(self, collection_name: str, ids, **kwargs):
        records = []
        for pid in ids:
            stored = self.points.get(str(pid))
            if stored:
                records.append(
                    SimpleNamespace(
                        id=stored["id"],
                        vector=stored.get("vector"),
                        payload=stored["payload"],
                    )
                )
        return records

    def upsert(self, collection_name: str, points, wait: bool = True):
        for p in points:
            self.points[str(p.id)] = {
                "id": str(p.id),
                "vector": list(p.vector),
                "payload": dict(p.payload),
            }
        return SimpleNamespace(status="completed")

    # Used indirectly by the conflicts router (no-op for these tests).
    def create_collection(self, **kwargs):
        return True

    def create_payload_index(self, **kwargs):
        return True

    def get_collection(self, collection_name: str):
        return SimpleNamespace(points_count=len(self.points), status="green")


def _local_payload(ts: datetime, checksum: str = "sha256:local") -> dict:
    return {
        "schema_version": 2,
        "photo_id": PHOTO_ID,
        "device_id": "dev-tablet-a",
        "captured_at": ts.isoformat(),
        "lat": 12.97,
        "lng": 77.59,
        "gps_status": "ok",
        "project_id": "proj_demo",
        "file_path": "photos/x.jpg",
        "embedding_status": "ok",
        "enrichment_id": None,
        "enrichment_tags": ["crack"],
        "enrichment_objects": [],
        "enrichment_text": "Hairline crack",
        "synced_at": ts.isoformat(),
        "local_updated_at": ts.isoformat(),
        "vector_checksum": checksum,
        "deletion_marker": False,
        "project_owner": "alice",
        "tags_v2": ["crack"],
    }


def _remote_payload(ts: datetime, checksum: str) -> dict:
    p = _local_payload(ts, checksum)
    p["device_id"] = "dev-tablet-b"
    p["enrichment_text"] = "Hairline crack (revised after re-inspection)"
    p["tags_v2"] = ["crack", "spalling"]
    return p


@pytest.fixture
def fake_qdrant(monkeypatch):
    fake = _FakeQdrantClient()
    monkeypatch.setattr(qdrant_svc, "get_client", lambda: fake)
    monkeypatch.setattr(qdrant_svc, "ensure_collection", lambda *a, **kw: None)
    monkeypatch.setattr(qdrant_svc, "upsert_point", lambda *a, **kw: None)
    return fake


@pytest.fixture
async def client(fake_qdrant):
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as ac:
            yield ac


# ─── 401 ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_conflict_requires_auth(client, fake_qdrant):
    """A request with no Authorization header returns 401."""
    resp = await client.get(f"/sync/conflicts/{PHOTO_ID}")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_conflict_rejects_short_token(client, fake_qdrant):
    """The auth shim rejects tokens shorter than 8 chars."""
    resp = await client.get(
        f"/sync/conflicts/{PHOTO_ID}",
        headers={"Authorization": "Bearer short"},
    )
    assert resp.status_code == 401


# ─── 404 ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_conflict_returns_404_for_unknown_photo(client, fake_qdrant):
    """No point in the fake store → 404."""
    resp = await client.get(
        f"/sync/conflicts/{PHOTO_ID}",
        headers={"Authorization": BEARER},
    )
    assert resp.status_code == 404
    body = resp.json()
    assert "detail" in body
    assert PHOTO_ID in body["detail"]


# ─── 200 + winner ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_conflict_returns_local_winner_when_local_newer(client, fake_qdrant):
    """Local timestamp newer than remote → winner=local."""
    local_ts = datetime(2026, 9, 24, 10, 0, 0, tzinfo=timezone.utc)
    remote_ts = datetime(2026, 9, 24, 9, 0, 0, tzinfo=timezone.utc)
    local = _local_payload(local_ts, checksum="sha256:local")
    remote = _remote_payload(remote_ts, checksum="sha256:remote")
    fake_qdrant.points[PHOTO_ID] = {
        "id": PHOTO_ID,
        "vector": [0.0] * 4,
        "payload": {**remote, "_local_snapshot": local, "_resolved_at": remote_ts.isoformat()},
    }

    resp = await client.get(
        f"/sync/conflicts/{PHOTO_ID}",
        headers={"Authorization": BEARER},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["photo_id"] == PHOTO_ID
    assert body["winner"] == "local"
    # enrichment_text + tags_v2 differ between local and remote.
    assert "enrichment_text" in body["fields_changed"]
    assert "tags_v2" in body["fields_changed"]
    # Both sides are present and non-null.
    assert body["local"] is not None
    assert body["remote"] is not None
    assert body["local"]["enrichment_text"] == "Hairline crack"
    assert body["remote"]["enrichment_text"].startswith("Hairline crack (revised")


@pytest.mark.asyncio
async def test_conflict_returns_remote_winner_when_local_older(client, fake_qdrant):
    """Local timestamp older than remote → winner=remote."""
    local_ts = datetime(2026, 9, 24, 8, 0, 0, tzinfo=timezone.utc)
    remote_ts = datetime(2026, 9, 24, 10, 0, 0, tzinfo=timezone.utc)
    local = _local_payload(local_ts, checksum="sha256:local")
    remote = _remote_payload(remote_ts, checksum="sha256:remote")
    fake_qdrant.points[PHOTO_ID] = {
        "id": PHOTO_ID,
        "vector": [0.0] * 4,
        "payload": {**remote, "_local_snapshot": local, "_resolved_at": remote_ts.isoformat()},
    }

    resp = await client.get(
        f"/sync/conflicts/{PHOTO_ID}",
        headers={"Authorization": BEARER},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["winner"] == "remote"
    assert body["fields_changed"]  # non-empty


@pytest.mark.asyncio
async def test_conflict_returns_merged_when_checksums_match(client, fake_qdrant):
    """Same vector_checksum → idempotent → winner=merged, fields_changed=[]."""
    ts = datetime(2026, 9, 24, 10, 0, 0, tzinfo=timezone.utc)
    local = _local_payload(ts, checksum="sha256:same")
    remote = _remote_payload(ts, checksum="sha256:same")
    fake_qdrant.points[PHOTO_ID] = {
        "id": PHOTO_ID,
        "vector": [0.0] * 4,
        "payload": {**remote, "_local_snapshot": local, "_resolved_at": ts.isoformat()},
    }

    resp = await client.get(
        f"/sync/conflicts/{PHOTO_ID}",
        headers={"Authorization": BEARER},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["winner"] == "merged"
    assert body["fields_changed"] == []


@pytest.mark.asyncio
async def test_conflict_returns_null_local_when_no_snapshot(client, fake_qdrant):
    """If the upload router never wrote a local snapshot, local=null."""
    ts = datetime(2026, 9, 24, 10, 0, 0, tzinfo=timezone.utc)
    remote = _remote_payload(ts, checksum="sha256:remote")
    # No _local_snapshot field.
    fake_qdrant.points[PHOTO_ID] = {
        "id": PHOTO_ID,
        "vector": [0.0] * 4,
        "payload": dict(remote),
    }

    resp = await client.get(
        f"/sync/conflicts/{PHOTO_ID}",
        headers={"Authorization": BEARER},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["local"] is None
    assert body["winner"] == "remote"
    assert body["resolved_at"]  # falls back to synced_at / server-now
