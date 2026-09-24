"""/sync/heartbeat endpoint for liveness checks."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.auth import AuthContext, require_auth
from app.config import settings
from app.models import HeartbeatResponse
from app.services import qdrant

router = APIRouter()


@router.get("/heartbeat", response_model=HeartbeatResponse)
async def heartbeat(_ctx: AuthContext = Depends(require_auth)):
    """Liveness probe with cluster health.

    Auth-required (any valid access token). We accept the dependency so
    the OpenAPI doc reflects that an enterprise must be signed in to
    monitor the cluster; the device_id from the token is logged but not
    used in the response.
    """
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
