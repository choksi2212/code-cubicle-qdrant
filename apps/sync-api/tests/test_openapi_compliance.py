"""
OpenAPI 3.1 compliance tests for the FieldEdge sync API.

Boots the FastAPI app in-process via httpx + asgi-lifespan, exercises every
endpoint documented in apps/sync-api/openapi.yaml with a realistic
payload, and asserts the response conforms to the schema. Also verifies
that invalid payloads produce a 422 with FastAPI's default validation
error envelope.

Qdrant is mocked at the service-module boundary so these tests run
without a live cluster.
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
import yaml
from asgi_lifespan import LifespanManager
from jsonschema import Draft202012Validator

# Make `app` importable when running `pytest apps/sync-api/tests/`.
TEST_FILE = Path(__file__).resolve()
# Walk up until we find the repo root (the directory that contains `apps/`).
ROOT = TEST_FILE.parent
while ROOT != ROOT.parent and not (ROOT / "apps").is_dir():
    ROOT = ROOT.parent
if str(ROOT / "apps" / "sync-api") not in sys.path:
    sys.path.insert(0, str(ROOT / "apps" / "sync-api"))

from app.main import app  # noqa: E402
from app.services import qdrant as qdrant_svc  # noqa: E402

OPENAPI_PATH = ROOT / "apps" / "sync-api" / "openapi.yaml"


# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def openapi_spec():
    with OPENAPI_PATH.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _resolve_pointer(doc, pointer: str):
    """Resolve a JSON-pointer (`#/a/b/c`) against a document."""
    if not pointer.startswith("#/"):
        return None
    cur = doc
    for part in pointer[2:].split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(cur, list):
            cur = cur[int(part)]
        else:
            cur = cur[part]
    return cur


def _deref(doc, schema):
    """Recursively replace `$ref` JSON-pointers with their resolved values."""
    if isinstance(schema, dict):
        if "$ref" in schema and len(schema) == 1:
            target = _resolve_pointer(doc, schema["$ref"])
            if target is None:
                return schema
            return _deref(doc, target)
        return {k: _deref(doc, v) for k, v in schema.items()}
    if isinstance(schema, list):
        return [_deref(doc, item) for item in schema]
    return schema


@pytest.fixture(scope="session")
def schema_validator(openapi_spec):
    """Return a factory that yields a Draft-2020-12 validator for a given schema name.

    Each schema is fully dereferenced against the parent OpenAPI document
    before validation so that cross-schema `$ref` pointers (e.g.
    UploadResponse -> PointResult) resolve inline without needing a
    registry.
    """
    parent_doc = openapi_spec
    schemas = parent_doc["components"]["schemas"]

    def _make(schema_name: str) -> Draft202012Validator:
        resolved = _deref(parent_doc, schemas[schema_name])
        return Draft202012Validator(resolved)

    return _make


class _FakeQdrantClient:
    """In-memory Qdrant stand-in that satisfies the methods the sync API uses."""

    def __init__(self) -> None:
        self.points: dict[str, dict] = {}

    # ── collection management ───────────────────────────────────────────────
    def create_collection(self, **kwargs):
        return True

    def create_payload_index(self, **kwargs):
        return True

    def get_collection(self, collection_name: str):
        return SimpleNamespace(
            points_count=len(self.points),
            status="green",
        )

    # ── points ─────────────────────────────────────────────────────────────
    def upsert(self, collection_name: str, points, wait: bool = True):
        for p in points:
            self.points[str(p.id)] = {
                "id": str(p.id),
                "vector": list(p.vector),
                "payload": dict(p.payload),
            }
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
        records = [
            SimpleNamespace(id=p["id"], payload=p["payload"])
            for p in self.points.values()
        ]
        return records, None  # no further pages


@pytest.fixture
def fake_qdrant(monkeypatch):
    fake = _FakeQdrantClient()

    monkeypatch.setattr(qdrant_svc, "get_client", lambda: fake)
    monkeypatch.setattr(qdrant_svc, "ensure_collection", lambda *a, **kw: None)
    monkeypatch.setattr(qdrant_svc, "upsert_point", lambda *a, **kw: None)
    monkeypatch.setattr(qdrant_svc, "retrieve_point",
                        lambda client, collection, pid: fake.points.get(pid))
    monkeypatch.setattr(qdrant_svc, "scroll_points",
                        lambda client, collection, since, limit: ([], None))
    monkeypatch.setattr(qdrant_svc, "collection_count", lambda *a, **kw: len(fake.points))

    return fake


@pytest.fixture
async def client(fake_qdrant):
    """ASGI client with lifespan events fired."""
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
            headers={"Authorization": "Bearer dev_device-abc-1234"},
        ) as ac:
            yield ac


# ── Helpers ────────────────────────────────────────────────────────────────


def _sample_point_payload() -> dict:
    return {
        "schema_version": 1,
        "photo_id": "01HF8Z9X3N4Y7K5V2C1A0B6D7E",
        "device_id": "device-abc-1234",
        "captured_at": "2026-09-24T10:00:00+00:00",
        "lat": 12.9716,
        "lng": 77.5946,
        "gps_status": "ok",
        "project_id": "proj_demo",
        "file_path": "photos/01HF8Z9X3N4Y7K5V2C1A0B6D7E.jpg",
        "embedding_status": "ok",
        "enrichment_id": None,
        "enrichment_tags": ["crack", "spalling"],
        "enrichment_objects": [{"label": "crack", "score": 0.91}],
        "enrichment_text": "Hairline crack observed",
        "synced_at": None,
        "local_updated_at": "2026-09-24T10:00:01+00:00",
        "vector_checksum": "sha256:abcdef0123456789",
    }


def _sample_point() -> dict:
    return {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "vector": [0.01] * 512,
        "payload": _sample_point_payload(),
    }


def _sample_upload_request() -> dict:
    return {
        "device_id": "device-abc-1234",
        "batch_id": "01HF8Z9X3N4Y7K5V2C1A0B6D7E",
        "points": [_sample_point()],
    }


# ── /healthz ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_healthz_matches_schema(client, schema_validator):
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    schema_validator("HealthResponse").validate(body)
    assert body == {"status": "alive"}


# ── /readyz ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_readyz_matches_schema_when_qdrant_ok(client, schema_validator):
    resp = await client.get("/readyz")
    assert resp.status_code == 200
    body = resp.json()
    schema_validator("ReadyResponse").validate(body)
    assert body["status"] == "ready"
    assert "qdrant_collection" in body
    assert isinstance(body["qdrant_points"], int)


# ── /sync/heartbeat ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sync_heartbeat_matches_schema(client, schema_validator):
    resp = await client.get("/sync/heartbeat")
    assert resp.status_code == 200
    body = resp.json()
    schema_validator("HeartbeatResponse").validate(body)
    assert body["status"] in ("ok", "degraded")
    assert isinstance(body["qdrant_reachable"], bool)
    # server_time is a valid datetime string
    datetime.fromisoformat(body["server_time"].replace("Z", "+00:00"))


# ── /sync/upload ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sync_upload_matches_schema(client, schema_validator, fake_qdrant):
    # Seed a known point so we exercise the "existing" branch as well.
    fake_qdrant.points["550e8400-e29b-41d4-a716-446655440000"] = {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "vector": [0.0] * 512,
        "payload": {
            **_sample_point_payload(),
            "vector_checksum": "sha256:DIFFERENT",
            "server_version": 1,
        },
    }

    resp = await client.post("/sync/upload", json=_sample_upload_request())
    assert resp.status_code == 200, resp.text
    body = resp.json()
    schema_validator("UploadResponse").validate(body)
    assert body["batch_id"] == "01HF8Z9X3N4Y7K5V2C1A0B6D7E"
    assert isinstance(body["results"], list) and len(body["results"]) == 1
    result = body["results"][0]
    # Result itself validates against PointResult too.
    schema_validator("PointResult").validate(result)
    assert result["status"] in {
        "accepted",
        "accepted_with_merge",
        "conflict_resolved",
        "rejected_too_old",
        "rejected_invalid_payload",
    }


@pytest.mark.asyncio
async def test_sync_upload_invalid_payload_returns_422(client):
    bad = _sample_upload_request()
    bad["points"][0]["vector"] = [0.0] * 100  # wrong dim — Pydantic allows this server-side
    # Drop a required field instead:
    bad["points"][0]["payload"].pop("photo_id")
    resp = await client.post("/sync/upload", json=bad)
    assert resp.status_code == 422
    body = resp.json()
    assert "detail" in body and isinstance(body["detail"], list)


# ── /sync/pull ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sync_pull_matches_schema(client, schema_validator):
    resp = await client.get("/sync/pull", params={"since": "", "limit": 50})
    assert resp.status_code == 200
    body = resp.json()
    schema_validator("PullResponse").validate(body)
    assert body["has_more"] is False
    assert isinstance(body["points"], list)
    datetime.fromisoformat(body["server_time"].replace("Z", "+00:00"))


@pytest.mark.asyncio
async def test_sync_pull_rejects_oversized_limit(client):
    resp = await client.get("/sync/pull", params={"limit": 10_000})
    assert resp.status_code == 422
    body = resp.json()
    assert "detail" in body


# ── /sync/wal/replay ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sync_wal_replay_matches_schema(client, schema_validator):
    req = _sample_upload_request()
    req["replay"] = True
    resp = await client.post("/sync/wal/replay", json=req)
    assert resp.status_code == 200
    body = resp.json()
    # Server returns UploadResponse here, which is the same shape we expect.
    schema_validator("UploadResponse").validate(body)
    assert isinstance(body["results"], list)


@pytest.mark.asyncio
async def test_sync_wal_replay_missing_batch_id_returns_422(client):
    req = _sample_upload_request()
    req.pop("batch_id")
    resp = await client.post("/sync/wal/replay", json=req)
    assert resp.status_code == 422


# ── /sync/upload unauthorized ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sync_upload_without_token_returns_401():
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as ac:
            resp = await ac.post("/sync/upload", json=_sample_upload_request())
    assert resp.status_code == 401


# ── /sync/pull — qdrant returns one row, schema accepts ────────────────────


@pytest.mark.asyncio
async def test_sync_pull_with_one_point_matches_schema(client, schema_validator, monkeypatch):
    pt = _sample_point()
    # /sync/pull excludes writes made by the calling device, so the seeded
    # payload must have a device_id that does NOT match the auth header.
    pt["payload"]["device_id"] = "other-device-9876"
    points = [{"id": pt["id"], "vector": pt["vector"], "payload": pt["payload"]}]

    def fake_scroll(*a, **kw):
        return points, None  # one page, no more

    monkeypatch.setattr(qdrant_svc, "scroll_points", fake_scroll)

    resp = await client.get("/sync/pull")
    assert resp.status_code == 200
    body = resp.json()
    schema_validator("PullResponse").validate(body)
    assert len(body["points"]) == 1
    assert body["points"][0]["id"] == pt["id"]


# ── OpenAPI document itself is structurally valid ──────────────────────────


def test_openapi_document_is_valid_3_1(openapi_spec):
    """Smoke-test that the hand-written spec parses as a real OpenAPI 3.1 doc."""
    from openapi_spec_validator import validate
    validate(openapi_spec)
    # Every component schema referenced from a path must exist.
    schemas = openapi_spec["components"]["schemas"]
    for path, ops in openapi_spec["paths"].items():
        for method, op in ops.items():
            if method.startswith("x-") or method == "parameters":
                continue
            for code, resp in op.get("responses", {}).items():
                content = resp.get("content", {})
                for media_type, media in content.items():
                    schema = media.get("schema", {})
                    if "$ref" in schema:
                        ref_name = schema["$ref"].rsplit("/", 1)[-1]
                        assert ref_name in schemas, (
                            f"{method.upper()} {path} {code} refs missing schema {ref_name}"
                        )


def test_openapi_every_object_schema_sets_additional_properties(openapi_spec):
    """Every component schema that is an object must explicitly set additionalProperties.

    The repo policy is that no object schema is silently permissive: either
    `additionalProperties: false` (strict) or `additionalProperties: true`
    (escape hatch — e.g. dict[str, Any] wrappers like PullResponse.points).
    """
    schemas = openapi_spec["components"]["schemas"]
    missing = []
    for name, schema in schemas.items():
        if schema.get("type") != "object":
            continue
        if "additionalProperties" not in schema:
            missing.append(name)
    assert not missing, (
        f"Object schemas without explicit additionalProperties: {missing}"
    )
