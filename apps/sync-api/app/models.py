"""Pydantic models for the sync API."""

from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field


# ─── Request models ──────────────────────────────────────────────────────────


class PointPayload(BaseModel):
    schema_version: int = 1
    photo_id: str
    device_id: str
    captured_at: datetime
    lat: float | None = None
    lng: float | None = None
    gps_status: Literal["ok", "unavailable", "denied"] = "ok"
    project_id: str
    file_path: str
    embedding_status: Literal["ok", "pending", "failed"] = "ok"
    cloudinary_public_id: str | None = None
    cloudinary_tags: list[str] = Field(default_factory=list)
    cloudinary_objects: list[dict[str, Any]] = Field(default_factory=list)
    cloudinary_ocr_text: str | None = None
    synced_at: datetime | None = None
    local_updated_at: datetime
    vector_checksum: str


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
