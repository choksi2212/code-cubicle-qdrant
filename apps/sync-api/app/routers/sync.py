"""/sync/upload and /sync/pull endpoints."""

import base64
import json
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from loguru import logger

from app.auth import verify_device_token
from app.config import settings
from app.models import (
    Point,
    PointResult,
    PullResponse,
    UploadRequest,
    UploadResponse,
)
from app.services import qdrant

router = APIRouter()


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


@router.post("/upload", response_model=UploadResponse)
async def upload_points(
    req: UploadRequest,
    device_id: str = Depends(verify_device_token),
):
    """Accept a batch of points from a device and write to the central cluster."""
    if len(req.points) > 100:
        raise HTTPException(status_code=413, detail="Batch too large (>100 points)")

    client = qdrant.get_client()
    qdrant.ensure_collection(client, settings.qdrant_collection)

    results: list[PointResult] = []
    for point in req.points:
        try:
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
                except Exception as e:
                    logger.warning(f"upsert failed for {point.id}: {e}")
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

        except Exception as e:
            logger.exception(f"Failed to process point {point.id}")
            results.append(
                PointResult(
                    id=point.id,
                    status="rejected_invalid_payload",
                    error_message=str(e),
                )
            )

    server_time = datetime.now(timezone.utc)
    last_id = req.points[-1].id if req.points else ""

    # Record metrics
    from app.routers.health import record_upload
    record_upload(
        accepted=sum(1 for r in results if r.status == "accepted"),
        conflict=sum(1 for r in results if r.status == "conflict_resolved"),
        rejected=sum(1 for r in results if r.status.startswith("rejected")),
    )

    return UploadResponse(
        batch_id=req.batch_id,
        server_time=server_time,
        results=results,
        next_cursor=_encode_cursor(server_time, last_id),
    )


@router.get("/pull", response_model=PullResponse)
async def pull_updates(
    since: str | None = Query(default=None),
    device_id: str = Depends(verify_device_token),
    limit: int = Query(default=100, le=500),
):
    """Return cloud-side updates since the given cursor."""
    if since:
        server_time, _ = _decode_cursor(since)
    else:
        server_time = datetime.now(timezone.utc).replace(microsecond=0)

    client = qdrant.get_client()
    since_iso = server_time.isoformat()
    points, next_offset = qdrant.scroll_points(client, settings.qdrant_collection, since_iso, limit)

    # Exclude the device's own writes
    filtered = [p for p in points if p["payload"].get("device_id") != device_id]

    new_server_time = datetime.now(timezone.utc)
    new_cursor = _encode_cursor(new_server_time, filtered[-1]["id"] if filtered else "")

    from app.routers.health import record_pull
    record_pull(len(filtered))

    return PullResponse(
        server_time=new_server_time,
        points=filtered,
        next_cursor=new_cursor,
        has_more=next_offset is not None,
    )
