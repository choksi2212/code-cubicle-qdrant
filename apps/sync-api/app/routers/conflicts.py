"""/sync/conflicts/:photo_id endpoint — per-photo conflict audit.

Returns the local + remote payloads as they stood at the moment of the
last conflict resolution, along with the winner and the fields that
changed. Powers the mobile SyncReportScreen -> ConflictDetailScreen flow.

Resolution rule (kept in sync with sync.py resolution rule):
    1. If checksums match -> idempotent, no conflict, winner = "merged".
    2. Else compare local_updated_at:
         - local < remote -> remote wins (rejected_too_old).
         - local >= remote -> local wins (conflict_resolved, local_wins).

The "local" payload is read from the `_local_snapshot` payload field,
which the upload router writes on every upload (overwriting the previous
local snapshot). This is deliberately minimal — full per-version history
would live in a dedicated conflict_log collection; we don't need that
for the v1 audit view.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger

from app.auth import AuthContext, require_auth
from app.config import settings
from app.models import PointPayload
from app.services import qdrant

router = APIRouter()


def _resolve_winner(
    local: dict[str, Any] | None,
    remote: dict[str, Any],
) -> tuple[str, list[str]]:
    """Apply the conflict-resolution rule and return (winner, fields_changed).

    Kept in sync with sync.py resolution rule — see the module docstring.
    """
    if local is None:
        return "remote", _diff_fields(None, remote)

    local_checksum = local.get("vector_checksum")
    remote_checksum = remote.get("vector_checksum")
    if local_checksum == remote_checksum:
        # Idempotent — same vector, nothing actually conflicted.
        return "merged", []

    local_ts_str = local.get("local_updated_at")
    remote_ts_str = remote.get("local_updated_at")
    try:
        local_ts = (
            datetime.fromisoformat(local_ts_str.replace("Z", "+00:00"))
            if local_ts_str
            else None
        )
    except Exception:
        local_ts = None
    try:
        remote_ts = (
            datetime.fromisoformat(remote_ts_str.replace("Z", "+00:00"))
            if remote_ts_str
            else None
        )
    except Exception:
        remote_ts = None

    if remote_ts and local_ts and local_ts < remote_ts:
        return "remote", _diff_fields(local, remote)

    return "local", _diff_fields(local, remote)


def _diff_fields(
    local: dict[str, Any] | None,
    remote: dict[str, Any],
) -> list[str]:
    """Return the list of top-level payload fields where local != remote.

    Used to populate `fields_changed` in the audit response. Only inspects
    the canonical payload fields (not the internal `_local_snapshot`
    shadow), since those are the ones a user could plausibly care about.
    """
    if local is None:
        return sorted(remote.keys())

    keys = set(local.keys()) | set(remote.keys())
    keys = {k for k in keys if not k.startswith("_")}
    changed: list[str] = []
    for k in keys:
        if local.get(k) != remote.get(k):
            changed.append(k)
    return sorted(changed)


@router.get("/conflicts/{photo_id}")
async def get_conflict(
    photo_id: str,
    ctx: AuthContext = Depends(require_auth),
):
    """Return the audit record for a single photo's last conflict resolution.

    Response shape:
        {
          "photo_id": str,
          "local":   PointPayload | null,
          "remote":  PointPayload,
          "winner":  "local" | "remote" | "merged",
          "fields_changed": [str, ...],
          "resolved_at": ISO-8601
        }

    Returns 404 if Qdrant has no record for `photo_id`.
    """
    client = qdrant.get_client()
    try:
        records = client.retrieve(
            collection_name=settings.qdrant_collection,
            ids=[photo_id],
            with_payload=True,
        )
    except Exception as e:
        logger.warning(f"conflict retrieve failed for {photo_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Qdrant unavailable",
        ) from e

    if not records:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"photo_id {photo_id} not found",
        )

    remote_payload = dict(records[0].payload or {})

    # The local snapshot is stashed in the same payload under a private
    # `_local_snapshot` field by the upload router. Strip it from the
    # remote copy so the response only shows the canonical payload fields.
    local_snapshot = remote_payload.pop("_local_snapshot", None)

    # Validate through the unified model so the wire shape matches what
    # the client sees in /sync/pull. Field-not-present is fine — both
    # models default v2-only fields.
    try:
        remote_validated = PointPayload.model_validate(remote_payload)
        remote_out = remote_validated.model_dump(mode="json", exclude_none=True)
    except Exception:
        # If the stored payload doesn't validate (legacy v1 in the wild
        # before the shim landed), pass it through as-is rather than 500.
        remote_out = remote_payload

    if local_snapshot is not None:
        try:
            local_validated = PointPayload.model_validate(local_snapshot)
            local_out = local_validated.model_dump(mode="json", exclude_none=True)
        except Exception:
            local_out = local_snapshot
    else:
        local_out = None

    winner, fields_changed = _resolve_winner(local_snapshot, remote_payload)

    # `_resolved_at` is stamped by the upload router on conflict
    # resolution. Fall back to the remote's own `synced_at` if missing,
    # otherwise server-now.
    resolved_at = (
        remote_payload.get("_resolved_at")
        or remote_payload.get("synced_at")
        or datetime.now(timezone.utc).isoformat()
    )

    return {
        "photo_id": photo_id,
        "local": local_out,
        "remote": remote_out,
        "winner": winner,
        "fields_changed": fields_changed,
        "resolved_at": resolved_at,
    }
