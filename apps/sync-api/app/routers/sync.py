"""/sync/upload and /sync/pull endpoints."""

import base64
import hashlib
import json
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from loguru import logger

from app.auth import AuthContext, require_auth
from app.config import settings
from app.logging_config import bind as log_bind
from app.models import (
    IdempotentUploadResponse,
    Point,
    PointResult,
    PullResponse,
    UploadRequest,
    UploadResponse,
    WalReplayRequest,
)
from app.redis_client import get_redis
from app.services import qdrant

router = APIRouter()

# Idempotency cache TTL — long enough to absorb network retries, short
# enough that re-syncing the same photos tomorrow isn't blocked. See
# docs/12-REDIS.md for the trade-off.
_IDEMPOTENCY_TTL_SECONDS = 86_400


def _hash_batch(body: UploadRequest) -> str:
    """Stable SHA-256 of the request body (canonical JSON).

    We ``model_dump(mode='json')`` so datetimes become ISO strings (and
    the dict is fully JSON-serialisable). ``sort_keys=True`` plus the
    Pydantic field order is what makes the hash deterministic across
    server restarts and across clients that reorder their points list —
    we deliberately hash the points in the order the device sent them,
    because reordering IS a different upload attempt from the device's
    perspective (a point's position in the batch is part of the wire
    contract for conflict resolution). The id-only hash is what we use
    for the cache key.
    """
    payload_dict: dict[str, Any] = body.model_dump(mode="json")
    canonical = json.dumps(payload_dict, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _encode_cursor(ts: datetime, last_id: str) -> str:
    payload = json.dumps({"server_time": ts.isoformat(), "last_id": last_id})
    return base64.urlsafe_b64encode(payload.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return datetime.fromisoformat(payload["server_time"]), payload["last_id"]
    except Exception:
        # Default: 7 days ago
        return datetime.now(timezone.utc).replace(microsecond=0), ""


def _request_id(request: Request) -> str:
    """Read the per-request ID set by RequestIdMiddleware (or '-' if unset)."""
    return getattr(getattr(request, "state", None), "request_id", "-")


@router.post("/upload", response_model=IdempotentUploadResponse)
async def upload_points(
    req: UploadRequest,
    request: Request,
    ctx: AuthContext = Depends(require_auth),
):
    """Accept a batch of points from a device and write to the central cluster.

    Idempotency: the request body's canonical SHA-256 is used as a Redis
    cache key. A repeated POST of the same body within 24h returns the
    original cached response with ``already_received=true`` instead of
    re-running the per-point conflict loop. When Redis is unreachable
    the cache check degrades gracefully (we just process the batch
    twice) — see docs/12-REDIS.md.
    """
    rid = _request_id(request)
    device_id = ctx.device_id
    logg = log_bind(request_id=rid, device_id=device_id, op="sync.upload")

    if len(req.points) > 100:
        logg.warning("upload batch too large", batch_id=req.batch_id, n_points=len(req.points))
        raise HTTPException(status_code=413, detail="Batch too large (>100 points)")

    logg.info("upload received", batch_id=req.batch_id, n_points=len(req.points))

    # ── Idempotency: SHA-256 the body, look up in Redis ──────────────────
    batch_hash = _hash_batch(req)
    cache_key = f"upload:{batch_hash}"
    cached_response_key = f"{cache_key}:response"

    cached_payload: dict[str, Any] | None = None
    if settings.redis_enabled:
        try:
            r = await get_redis()
            if r is not None:
                exists = await r.exists(cache_key)
                if exists:
                    cached_raw = await r.get(cached_response_key)
                    if cached_raw:
                        try:
                            cached_payload = json.loads(cached_raw)
                            logg.info(
                                "upload idempotent replay",
                                batch_id=req.batch_id,
                                n_points=len(req.points),
                                batch_hash=batch_hash[:12],
                            )
                        except Exception:
                            cached_payload = None
        except Exception as e:
            logg.warning(
                "redis idempotency lookup failed — processing batch",
                error=str(e),
                batch_id=req.batch_id,
            )

    if cached_payload is not None:
        # Return the cached response, flipping already_received=True so
        # the client can detect the replay even if the original
        # response omitted the flag (Redis may have cached an older
        # UploadResponse-shaped payload from before this commit).
        try:
            cached_payload["already_received"] = True
            return IdempotentUploadResponse.model_validate(cached_payload)
        except Exception:
            # Corrupt cache entry — fall through and process normally,
            # rewriting the cache at the end.
            cached_payload = None

    client = qdrant.get_client()
    qdrant.ensure_collection(client, settings.qdrant_collection)

    results: list[PointResult] = []
    for point in req.points:
        point_log = log_bind(
            request_id=rid, device_id=device_id, point_id=point.id, op="sync.upload.point"
        )
        try:
            # Migration shim (v1 → v2) — incoming payloads are upgraded to v2
            # before they touch Qdrant. wal_replay intentionally does NOT do
            # this: it's a re-run of an already-uploaded batch, and we want
            # to preserve the original schema_version there.
            if point.payload.schema_version == 1:
                point.payload = point.payload.model_copy(update={
                    "schema_version": 2,
                    "deletion_marker": False,
                    "project_owner": None,
                    "tags_v2": list(point.payload.enrichment_tags),
                })
                point_log.info("payload migrated v1 -> v2")
            payload_dict = point.payload.model_dump(mode="json")
            existing = qdrant.retrieve_point(client, settings.qdrant_collection, point.id)

            if not existing:
                # New point — ensure it's a valid UUID (Qdrant Cloud requirement)
                try:
                    qdrant.upsert_point(
                        client,
                        settings.qdrant_collection,
                        point.id,
                        point.vector,
                        payload_dict,
                    )
                    results.append(PointResult(id=point.id, status="accepted", server_version=1))
                    point_log.info("point accepted", status="accepted")
                except Exception as e:
                    point_log.warning("upsert failed", error=str(e), point_id=point.id)
                    results.append(
                        PointResult(
                            id=point.id,
                            status="rejected_invalid_payload",
                            error_message=str(e),
                        )
                    )
                continue

            # Check for conflict
            if existing["payload"].get("vector_checksum") == point.payload.vector_checksum:
                # Same vector; idempotent
                results.append(
                    PointResult(
                        id=point.id,
                        status="accepted",
                        server_version=existing["payload"].get("server_version", 1),
                    )
                )
                point_log.info("point accepted (idempotent)", status="accepted")
                continue

            # Conflict: resolve by timestamp
            local_ts = point.payload.local_updated_at
            remote_ts_str = existing["payload"].get("local_updated_at")
            remote_ts = (
                datetime.fromisoformat(remote_ts_str.replace("Z", "+00:00"))
                if remote_ts_str
                else None
            )

            if remote_ts and local_ts < remote_ts:
                # Local is older; reject
                results.append(
                    PointResult(
                        id=point.id,
                        status="rejected_too_old",
                        resolved_payload=existing["payload"],
                    )
                )
                point_log.info("point rejected (remote newer)", status="rejected_too_old")
            else:
                # Local wins; write
                merged = {**existing["payload"], **payload_dict}
                qdrant.upsert_point(
                    client,
                    settings.qdrant_collection,
                    point.id,
                    point.vector,
                    merged,
                )
                results.append(
                    PointResult(
                        id=point.id,
                        status="conflict_resolved",
                        resolution="local_wins",
                        resolved_payload=merged,
                        server_version=merged.get("server_version", 1) + 1,
                    )
                )
                point_log.info("point conflict resolved (local wins)", status="conflict_resolved")

        except Exception as e:
            point_log.exception("point processing failed", error=str(e), point_id=point.id)
            results.append(
                PointResult(
                    id=point.id,
                    status="rejected_invalid_payload",
                    error_message=str(e),
                )
            )

    server_time = datetime.now(timezone.utc)
    last_id = req.points[-1].id if req.points else ""

    accepted = sum(1 for r in results if r.status == "accepted")
    conflict = sum(1 for r in results if r.status == "conflict_resolved")
    rejected = sum(1 for r in results if r.status.startswith("rejected"))

    # Record metrics
    from app.routers.health import record_upload
    record_upload(accepted=accepted, conflict=conflict, rejected=rejected)

    response = IdempotentUploadResponse(
        batch_id=req.batch_id,
        server_time=server_time,
        results=results,
        next_cursor=_encode_cursor(server_time, last_id),
        already_received=False,
    )

    # ── Cache the response for the next 24h ──────────────────────────────
    if settings.redis_enabled:
        try:
            r = await get_redis()
            if r is not None:
                cache_payload = response.model_dump(mode="json")
                await r.set(cache_key, "1", ex=_IDEMPOTENCY_TTL_SECONDS)
                await r.set(
                    cached_response_key,
                    json.dumps(cache_payload, default=str),
                    ex=_IDEMPOTENCY_TTL_SECONDS,
                )
        except Exception as e:
            logg.warning(
                "redis idempotency write failed — response not cached",
                error=str(e),
                batch_id=req.batch_id,
            )

    logg.info(
        "upload completed",
        batch_id=req.batch_id,
        n_points=len(req.points),
        n_accepted=accepted,
        n_conflict=conflict,
        n_rejected=rejected,
    )

    return response


@router.get("/pull", response_model=PullResponse)
async def pull_updates(
    request: Request,
    since: str | None = Query(default=None),
    ctx: AuthContext = Depends(require_auth),
    limit: int = Query(default=100, le=500),
):
    """Return cloud-side updates since the given cursor."""
    rid = _request_id(request)
    device_id = ctx.device_id
    logg = log_bind(request_id=rid, device_id=device_id, op="sync.pull")

    if since:
        server_time, _ = _decode_cursor(since)
    else:
        server_time = datetime.now(timezone.utc).replace(microsecond=0)

    logg.info("pull received", since=since, limit=limit)

    client = qdrant.get_client()
    since_iso = server_time.isoformat()
    points, next_offset = qdrant.scroll_points(client, settings.qdrant_collection, since_iso, limit)

    # Exclude the device's own writes
    filtered = [p for p in points if p["payload"].get("device_id") != device_id]

    new_server_time = datetime.now(timezone.utc)
    new_cursor = _encode_cursor(new_server_time, filtered[-1]["id"] if filtered else "")

    from app.routers.health import record_pull
    record_pull(len(filtered))

    logg.info("pull completed", n_points=len(filtered), has_more=next_offset is not None)

    return PullResponse(
        server_time=new_server_time,
        points=filtered,
        next_cursor=new_cursor,
        has_more=next_offset is not None,
    )


@router.post("/wal/replay", response_model=UploadResponse)
async def wal_replay(
    req: WalReplayRequest,
    request: Request,
    ctx: AuthContext = Depends(require_auth),
):
    """FR-080 — replay a previously-uploaded batch after a crash.

    Used when the device believes a `POST /sync/upload` succeeded but never
    received a response (e.g. network dropped mid-flight). The device sends
    the same batch_id + points again; the server upserts idempotently by
    point ID and returns the per-point result.
    """
    rid = _request_id(request)
    device_id = ctx.device_id
    logg = log_bind(
        request_id=rid,
        device_id=device_id,
        batch_id=req.batch_id,
        op="sync.wal_replay",
    )
    logg.info("wal replay received", n_points=len(req.points))

    # Re-use the upload_points logic by calling it directly via the same flow.
    # FastAPI doesn't allow easy reuse, so we mirror the same loop here.
    if len(req.points) > 100:
        logg.warning("wal replay batch too large", n_points=len(req.points))
        raise HTTPException(status_code=413, detail="Batch too large (>100 points)")

    client = qdrant.get_client()
    qdrant.ensure_collection(client, settings.qdrant_collection)

    results: list[PointResult] = []
    for point in req.points:
        point_log = log_bind(
            request_id=rid,
            device_id=device_id,
            point_id=point.id,
            op="sync.wal_replay.point",
        )
        try:
            payload_dict = point.payload.model_dump(mode="json")
            existing = qdrant.retrieve_point(client, settings.qdrant_collection, point.id)

            if not existing:
                # Fresh point.
                try:
                    qdrant.upsert_point(
                        client, settings.qdrant_collection,
                        point.id, point.vector, payload_dict,
                    )
                    results.append(PointResult(id=point.id, status="accepted", server_version=1))
                    point_log.info("wal replay point accepted", status="accepted")
                except Exception as e:
                    point_log.warning("wal replay upsert failed", error=str(e), point_id=point.id)
                    results.append(PointResult(
                        id=point.id, status="rejected_invalid_payload",
                        error_message=str(e),
                    ))
                continue

            # Existing point — idempotent if checksum matches.
            if existing["payload"].get("vector_checksum") == point.payload.vector_checksum:
                results.append(PointResult(
                    id=point.id, status="accepted",
                    server_version=existing["payload"].get("server_version", 1),
                ))
                point_log.info("wal replay point accepted (idempotent)", status="accepted")
                continue

            # Different checksum → conflict, resolve by timestamp.
            local_ts = point.payload.local_updated_at
            remote_ts_str = existing["payload"].get("local_updated_at")
            remote_ts = (
                datetime.fromisoformat(remote_ts_str.replace("Z", "+00:00"))
                if remote_ts_str else None
            )
            if remote_ts and local_ts < remote_ts:
                results.append(PointResult(
                    id=point.id, status="rejected_too_old",
                    resolved_payload=existing["payload"],
                ))
                point_log.info("wal replay point rejected (remote newer)", status="rejected_too_old")
            else:
                merged = {**existing["payload"], **payload_dict}
                qdrant.upsert_point(
                    client, settings.qdrant_collection,
                    point.id, point.vector, merged,
                )
                results.append(PointResult(
                    id=point.id, status="conflict_resolved",
                    resolution="local_wins", resolved_payload=merged,
                    server_version=merged.get("server_version", 1) + 1,
                ))
                point_log.info("wal replay conflict resolved (local wins)", status="conflict_resolved")
        except Exception as e:
            point_log.exception("wal replay point failed", error=str(e), point_id=point.id)
            results.append(PointResult(
                id=point.id, status="rejected_invalid_payload",
                error_message=str(e),
            ))

    server_time = datetime.now(timezone.utc)
    last_id = req.points[-1].id if req.points else ""

    accepted = sum(1 for r in results if r.status == "accepted")
    conflict = sum(1 for r in results if r.status == "conflict_resolved")
    rejected = sum(1 for r in results if r.status.startswith("rejected"))

    from app.routers.health import record_upload
    record_upload(accepted=accepted, conflict=conflict, rejected=rejected)

    logg.info(
        "wal replay completed",
        n_points=len(req.points),
        n_accepted=accepted,
        n_conflict=conflict,
        n_rejected=rejected,
    )

    return UploadResponse(
        batch_id=req.batch_id,
        server_time=server_time,
        results=results,
        next_cursor=_encode_cursor(server_time, last_id),
    )
