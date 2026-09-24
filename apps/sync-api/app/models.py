"""Pydantic models for the sync API.

Schema versioning
-----------------

Point payloads carry a ``schema_version`` discriminator. v1 is the original
wire format (no soft-delete, no project owner, no ``tags_v2``). v2 adds those
fields and is the canonical format the server always writes.

``PointPayload`` is a *unified* model: it accepts both v1 and v2 input
(via a ``model_validator`` that dispatches on ``schema_version``), and always
exposes v2 fields to downstream code. The router applies a one-shot
migration shim in :func:`upload_points` to bump incoming v1 payloads to v2
before they reach Qdrant — so the central store stays at a single version.
"""

from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator


# ─── Versioned payload schemas ──────────────────────────────────────────────


class PointPayloadV1(BaseModel):
    """Original wire format — preserved for read-side compatibility."""

    schema_version: Literal[1] = 1
    photo_id: str
    device_id: str
    captured_at: datetime
    lat: float | None = None
    lng: float | None = None
    gps_status: Literal["ok", "unavailable", "denied"] = "ok"
    project_id: str
    file_path: str
    embedding_status: Literal["ok", "pending", "failed"] = "ok"
    enrichment_id: str | None = None
    enrichment_tags: list[str] = Field(default_factory=list)
    enrichment_objects: list[dict[str, Any]] = Field(default_factory=list)
    enrichment_text: str | None = None
    synced_at: datetime | None = None
    local_updated_at: datetime
    vector_checksum: str


class PointPayloadV2(BaseModel):
    """Current wire format — adds soft-delete, project owner, and tags_v2."""

    schema_version: Literal[2] = 2
    photo_id: str
    device_id: str
    captured_at: datetime
    lat: float | None = None
    lng: float | None = None
    gps_status: Literal["ok", "unavailable", "denied"] = "ok"
    project_id: str
    file_path: str
    embedding_status: Literal["ok", "pending", "failed"] = "ok"
    enrichment_id: str | None = None
    enrichment_tags: list[str] = Field(default_factory=list)
    enrichment_objects: list[dict[str, Any]] = Field(default_factory=list)
    enrichment_text: str | None = None
    synced_at: datetime | None = None
    local_updated_at: datetime
    vector_checksum: str
    deletion_marker: bool = False
    project_owner: str | None = None
    tags_v2: list[str] = Field(default_factory=list)


class PointPayload(BaseModel):
    """Unified payload — accepts v1 and v2 input, exposes v2 fields.

    Validation accepts either schema. After parsing, ``schema_version`` is
    whatever the input said — the router upgrades v1 → v2 before persisting
    to Qdrant.
    """

    schema_version: int = 2
    photo_id: str
    device_id: str
    captured_at: datetime
    lat: float | None = None
    lng: float | None = None
    gps_status: Literal["ok", "unavailable", "denied"] = "ok"
    project_id: str
    file_path: str
    embedding_status: Literal["ok", "pending", "failed"] = "ok"
    enrichment_id: str | None = None
    enrichment_tags: list[str] = Field(default_factory=list)
    enrichment_objects: list[dict[str, Any]] = Field(default_factory=list)
    enrichment_text: str | None = None
    synced_at: datetime | None = None
    local_updated_at: datetime
    vector_checksum: str
    # v2-only fields — defaulted so v1 input still parses.
    deletion_marker: bool = False
    project_owner: str | None = None
    tags_v2: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _accept_v1_or_v2(cls, data: Any) -> Any:
        """Dispatch on ``schema_version`` and validate against the right class.

        Anything that isn't a dict (e.g. an already-validated model instance
        coming back from a parent model) flows through unchanged.
        """
        if not isinstance(data, dict):
            return data

        version = data.get("schema_version")
        # Missing discriminator → treat as legacy v1 (the original wire format).
        if version is None:
            version = 1
            data["schema_version"] = 1

        if version == 1:
            v1 = PointPayloadV1.model_validate(data)
            data = v1.model_dump()
        elif version == 2:
            v2 = PointPayloadV2.model_validate(data)
            data = v2.model_dump()
        else:
            raise ValueError(f"unknown payload schema_version: {version}")
        return data


# ─── Request models ──────────────────────────────────────────────────────────


class Point(BaseModel):
    id: str
    vector: list[float]
    payload: PointPayload


class UploadRequest(BaseModel):
    device_id: str
    batch_id: str
    points: list[Point]


class WalReplayRequest(UploadRequest):
    replay: bool = True


# ─── Response models ─────────────────────────────────────────────────────────


class PointResult(BaseModel):
    id: str
    status: Literal[
        "accepted",
        "accepted_with_merge",
        "conflict_resolved",
        "rejected_too_old",
        "rejected_invalid_payload",
    ]
    resolution: Literal["local_wins", "remote_wins", "merged"] | None = None
    resolved_payload: dict[str, Any] | None = None
    error_message: str | None = None
    server_version: int | None = None


class UploadResponse(BaseModel):
    batch_id: str
    server_time: datetime
    results: list[PointResult]
    next_cursor: str


class IdempotentUploadResponse(UploadResponse):
    """``POST /sync/upload`` response — always carries ``already_received``.

    ``already_received`` defaults to ``False`` for fresh uploads and is
    flipped to ``True`` by the router when the request body's
    canonical SHA-256 matches a batch already accepted in the last 24h.
    ``results`` is empty on a cached replay; ``next_cursor`` echoes the
    cursor from the original (cached) response so the device's
    pull-cursor state machine keeps moving.
    """

    already_received: bool = False


class PullResponse(BaseModel):
    server_time: datetime
    points: list[dict[str, Any]]
    next_cursor: str
    has_more: bool


class HeartbeatResponse(BaseModel):
    status: Literal["ok", "degraded"]
    server_time: datetime
    qdrant_reachable: bool
    qdrant_point_count: int | None = None
