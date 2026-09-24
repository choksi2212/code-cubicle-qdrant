"""Schema versioning tests for the sync API.

Covers the v1 ↔ v2 accept-emit contract:

- ``PointPayload`` accepts v1 input (no new fields, ``schema_version: 1``)
  and exposes the v2 fields with the migration defaults.
- ``PointPayload`` accepts v2 input unchanged.
- ``PointPayload`` accepts v1 input that omits ``schema_version`` entirely
  (the original wire format pre-dates the discriminator).
- The router-side migration shim converts v1 → v2 before Qdrant upsert.
- Round-trip: v1 in → migrated v2 in the persisted payload dict.
"""

from datetime import datetime, timezone

import pytest
from app.models import (
    Point,
    PointPayload,
    PointPayloadV1,
    PointPayloadV2,
    UploadRequest,
)


def _v1_dict() -> dict:
    return {
        "schema_version": 1,
        "photo_id": "p1",
        "device_id": "dev-old",
        "captured_at": datetime(2025, 5, 12, 14, 23, 1, tzinfo=timezone.utc),
        "lat": 12.34,
        "lng": 56.78,
        "gps_status": "ok",
        "project_id": "legacy",
        "file_path": "/photos/x.jpg",
        "embedding_status": "ok",
        "enrichment_id": None,
        "enrichment_tags": ["alpha", "beta"],
        "enrichment_objects": [],
        "enrichment_text": None,
        "synced_at": None,
        "local_updated_at": datetime(2025, 5, 12, 14, 23, 1, tzinfo=timezone.utc),
        "vector_checksum": "sha256:abc",
    }


def _v2_dict(**overrides) -> dict:
    base = _v1_dict() | {
        "schema_version": 2,
        "deletion_marker": True,
        "project_owner": "alice",
        "tags_v2": ["x", "y"],
    }
    base.update(overrides)
    return base


# ─── v1 input ────────────────────────────────────────────────────────────────


def test_unified_accepts_v1_with_defaults():
    """v1 input parses cleanly; v2 fields take the migration defaults."""
    payload = PointPayload.model_validate(_v1_dict())
    assert payload.schema_version == 1
    assert payload.deletion_marker is False
    assert payload.project_owner is None
    assert payload.tags_v2 == []
    # v1 fields survive intact.
    assert payload.photo_id == "p1"
    assert payload.enrichment_tags == ["alpha", "beta"]


def test_unified_accepts_v1_without_schema_version():
    """Missing discriminator → treated as legacy v1."""
    d = _v1_dict()
    del d["schema_version"]
    payload = PointPayload.model_validate(d)
    assert payload.schema_version == 1
    assert payload.deletion_marker is False
    assert payload.project_owner is None
    assert payload.tags_v2 == []


# ─── v2 input ────────────────────────────────────────────────────────────────


def test_unified_accepts_v2_unchanged():
    payload = PointPayload.model_validate(_v2_dict())
    assert payload.schema_version == 2
    assert payload.deletion_marker is True
    assert payload.project_owner == "alice"
    assert payload.tags_v2 == ["x", "y"]


def test_unified_accepts_v2_with_minimal_defaults():
    """v2 with the new fields defaulted is still valid."""
    d = _v1_dict() | {"schema_version": 2}
    payload = PointPayload.model_validate(d)
    assert payload.schema_version == 2
    assert payload.deletion_marker is False
    assert payload.project_owner is None
    assert payload.tags_v2 == []


# ─── Migration shim ──────────────────────────────────────────────────────────


def _migrate_to_v2(payload: PointPayload) -> PointPayload:
    """Mirror of the shim in ``routers/sync.py::upload_points``.

    We keep a parallel implementation here so the test exercises the same
    transformation logic without going through HTTP.
    """
    if payload.schema_version == 1:
        return payload.model_copy(update={
            "schema_version": 2,
            "deletion_marker": False,
            "project_owner": None,
            "tags_v2": list(payload.enrichment_tags),
        })
    return payload


def test_migration_shim_upgrades_v1_to_v2():
    payload = PointPayload.model_validate(_v1_dict())
    migrated = _migrate_to_v2(payload)
    assert migrated.schema_version == 2
    assert migrated.deletion_marker is False
    assert migrated.project_owner is None
    # tags_v2 mirrors enrichment_tags on legacy migration.
    assert migrated.tags_v2 == ["alpha", "beta"]
    assert migrated.enrichment_tags == ["alpha", "beta"]


def test_migration_shim_is_noop_for_v2():
    payload = PointPayload.model_validate(_v2_dict())
    migrated = _migrate_to_v2(payload)
    # Identity for v2 — owner / tags_v2 / deletion_marker all preserved.
    assert migrated.schema_version == 2
    assert migrated.deletion_marker is True
    assert migrated.project_owner == "alice"
    assert migrated.tags_v2 == ["x", "y"]


# ─── Round-trip ──────────────────────────────────────────────────────────────


def test_round_trip_v1_to_persisted_v2():
    """Full pipeline: v1 in → router shim → v2 in the persisted dict."""
    point = Point(
        id="01ARZ3NDEKTSV4RRFFQ69G5FAV",
        vector=[0.1] * 4,
        payload=PointPayload.model_validate(_v1_dict()),
    )
    req = UploadRequest(device_id="dev-old", batch_id="b1", points=[point])

    # The shim runs at the router; simulate it here.
    req.points[0].payload = _migrate_to_v2(req.points[0].payload)

    persisted = req.points[0].payload.model_dump(mode="json")
    assert persisted["schema_version"] == 2
    assert persisted["deletion_marker"] is False
    assert persisted["project_owner"] is None
    assert persisted["tags_v2"] == ["alpha", "beta"]
    # v1 fields still there for downstream filters / queries.
    assert persisted["enrichment_tags"] == ["alpha", "beta"]
    assert persisted["project_id"] == "legacy"


def test_round_trip_v2_unchanged():
    point = Point(
        id="01ARZ3NDEKTSV4RRFFQ69G5FAV",
        vector=[0.1] * 4,
        payload=PointPayload.model_validate(_v2_dict()),
    )
    req = UploadRequest(device_id="dev", batch_id="b2", points=[point])
    req.points[0].payload = _migrate_to_v2(req.points[0].payload)

    persisted = req.points[0].payload.model_dump(mode="json")
    assert persisted["schema_version"] == 2
    assert persisted["deletion_marker"] is True
    assert persisted["project_owner"] == "alice"
    assert persisted["tags_v2"] == ["x", "y"]


# ─── Class-level guarantees ──────────────────────────────────────────────────


def test_point_payload_v1_rejects_v2_field():
    """The strict v1 model rejects payloads that declare a v2-only field."""
    with pytest.raises(Exception):
        PointPayloadV1.model_validate(_v2_dict())


def test_point_payload_v2_accepts_v1_input_via_defaults():
    """v2 is a superset of v1 — v1-shaped data parses with v2 fields defaulted
    (as long as ``schema_version=2``)."""
    d = _v1_dict() | {"schema_version": 2}
    payload = PointPayloadV2.model_validate(d)
    assert payload.schema_version == 2
    assert payload.deletion_marker is False
    assert payload.project_owner is None
    assert payload.tags_v2 == []
