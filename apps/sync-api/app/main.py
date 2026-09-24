"""FastAPI application entry point."""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.config import settings
from app.logging_config import configure_logging
from app.middleware import MIDDLEWARE_CLASSES
from app.routers import auth, conflicts, heartbeat, health, sync


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown hooks."""
    from app.routers.health import init_startup_time
    init_startup_time()

    port = os.environ.get("PORT", settings.port)
    logger.info(f"Starting FieldEdge sync API on port {port}")
    logger.info(f"Qdrant URL: {settings.qdrant_url}")
    yield
    logger.info("Shutting down FieldEdge sync API")


# Configure JSON logging as early as possible so even the lifespan startup
# log lines come out in the structured format.
configure_logging()

app = FastAPI(
    title="FieldEdge Sync API",
    description="Orchestrator between FieldEdge mobile devices and the central Qdrant cluster",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Observability middleware — request_id threading end-to-end. Registered last
# so it becomes the outermost layer (closest to the network).
for _mw in MIDDLEWARE_CLASSES:
    app.add_middleware(_mw)  # type: ignore[arg-type]

# Routers
app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(sync.router, prefix="/sync", tags=["sync"])
app.include_router(conflicts.router, prefix="/sync", tags=["conflicts"])
app.include_router(heartbeat.router, prefix="/sync", tags=["heartbeat"])
app.include_router(health.router, tags=["health"])


@app.get("/")
async def root():
    return {
        "service": "FieldEdge Sync API",
        "version": "0.1.0",
        "endpoints": [
            "/auth/login",
            "/auth/refresh",
            "/auth/me",
            "/sync/upload",
            "/sync/pull",
            "/sync/wal/replay",
            "/sync/conflicts/{photo_id}",
            "/sync/heartbeat",
        ],
    }


def run():
    """Entrypoint for `python -m app.main`."""
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.port,
        reload=settings.debug,
        log_level="info",
    )


if __name__ == "__main__":
    run()
