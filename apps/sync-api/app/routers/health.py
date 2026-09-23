"""Detailed health + metrics endpoints for the sync API."""

from datetime import datetime, timezone

from fastapi import APIRouter, Response
from loguru import logger

from app.config import settings
from app.services import qdrant

router = APIRouter()

# In-memory counters (process-local; replace with Redis/Prometheus for prod)
_metrics = {
    "uploads_total": 0,
    "uploads_accepted": 0,
    "uploads_conflict": 0,
    "uploads_rejected": 0,
    "pulls_total": 0,
    "pulls_results_returned": 0,
    "started_at": None,
}


@router.get("/healthz")
async def liveness():
    """Lightweight liveness probe (Kubernetes-style)."""
    return {"status": "alive"}


@router.get("/readyz")
async def readiness(response: Response):
    """Readiness probe — verifies we can reach Qdrant Cloud."""
    try:
        client = qdrant.get_client()
        info = client.get_collection(collection_name=settings.qdrant_collection)
        return {
            "status": "ready",
            "qdrant_collection": settings.qdrant_collection,
            "qdrant_points": info.points_count or 0,
            "qdrant_status": str(info.status),
        }
    except Exception as e:
        response.status_code = 503
        return {"status": "not_ready", "error": str(e)}


@router.get("/metrics")
async def metrics():
    """Prometheus-style metrics (plain text)."""
    started_at = _metrics["started_at"] or datetime.now(timezone.utc)
    uptime_seconds = (datetime.now(timezone.utc) - started_at).total_seconds() if _metrics["started_at"] else 0

    lines = [
        "# HELP fieldedge_sync_uploads_total Total upload batches received",
        "# TYPE fieldedge_sync_uploads_total counter",
        f"fieldedge_sync_uploads_total {_metrics['uploads_total']}",
        "",
        "# HELP fieldedge_sync_uploads_accepted_total Uploads accepted (no conflict)",
        "# TYPE fieldedge_sync_uploads_accepted_total counter",
        f"fieldedge_sync_uploads_accepted_total {_metrics['uploads_accepted']}",
        "",
        "# HELP fieldedge_sync_uploads_conflict_total Uploads with conflict resolution",
        "# TYPE fieldedge_sync_uploads_conflict_total counter",
        f"fieldedge_sync_uploads_conflict_total {_metrics['uploads_conflict']}",
        "",
        "# HELP fieldedge_sync_uploads_rejected_total Uploads rejected (invalid payload / too old)",
        "# TYPE fieldedge_sync_uploads_rejected_total counter",
        f"fieldedge_sync_uploads_rejected_total {_metrics['uploads_rejected']}",
        "",
        "# HELP fieldedge_sync_pulls_total Total pull requests",
        "# TYPE fieldedge_sync_pulls_total counter",
        f"fieldedge_sync_pulls_total {_metrics['pulls_total']}",
        "",
        "# HELP fieldedge_sync_pulls_results_total Total points returned via pull",
        "# TYPE fieldedge_sync_pulls_results_total counter",
        f"fieldedge_sync_pulls_results_total {_metrics['pulls_results_returned']}",
        "",
        "# HELP fieldedge_sync_uptime_seconds Process uptime",
        "# TYPE fieldedge_sync_uptime_seconds gauge",
        f"fieldedge_sync_uptime_seconds {uptime_seconds:.1f}",
    ]
    return Response(content="\n".join(lines), media_type="text/plain; version=0.0.4")


def record_upload(accepted: int, conflict: int, rejected: int) -> None:
    """Called from the upload router to update counters."""
    _metrics["uploads_total"] += 1
    _metrics["uploads_accepted"] += accepted
    _metrics["uploads_conflict"] += conflict
    _metrics["uploads_rejected"] += rejected


def record_pull(results: int) -> None:
    _metrics["pulls_total"] += 1
    _metrics["pulls_results_returned"] += results


def init_startup_time() -> None:
    _metrics["started_at"] = datetime.now(timezone.utc)
