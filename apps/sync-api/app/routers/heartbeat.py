"""/sync/heartbeat endpoint for liveness checks."""

from datetime import datetime, timezone

from fastapi import APIRouter

from app.config import settings
from app.models import HeartbeatResponse
from app.services import qdrant

router = APIRouter()


@router.get("/heartbeat", response_model=HeartbeatResponse)
async def heartbeat():
    """Liveness probe with cluster health."""
    server_time = datetime.now(timezone.utc)

    try:
        client = qdrant.get_client()
        count = qdrant.collection_count(client, settings.qdrant_collection)
        return HeartbeatResponse(
            status="ok",
            server_time=server_time,
            qdrant_reachable=True,
            qdrant_point_count=count,
        )
    except Exception:
        return HeartbeatResponse(
            status="degraded",
            server_time=server_time,
            qdrant_reachable=False,
        )
