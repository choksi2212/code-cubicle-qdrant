"""Request-ID middleware — threads an opaque trace token end-to-end.

* Client may send ``X-Request-ID`` (mobile generates a UUID per request).
* If absent, the server mints a UUIDv4.
* The ID is stored on ``request.state.request_id`` so route handlers and
  structured log calls can read it.
* It is echoed back in the response as ``X-Request-ID`` so the client can
  correlate its own log line with the server's.
"""

from __future__ import annotations

import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


REQUEST_ID_HEADER = "X-Request-ID"


def _mint_request_id() -> str:
    return str(uuid.uuid4())


def extract_request_id(request: Request) -> str:
    """Read ``X-Request-ID`` from incoming headers, or mint a new UUID."""
    incoming = request.headers.get(REQUEST_ID_HEADER)
    if incoming:
        cleaned = incoming.strip()
        # Light validation: drop garbage but accept opaque strings (UUIDs,
        # ULIDs, "mw-1" — anything alphanumeric plus a few separators).
        # Cap at 128 chars to bound log/header size; minimum is 1 to allow
        # any non-empty identifier the client chose.
        if 1 <= len(cleaned) <= 128 and all(c.isalnum() or c in "-_." for c in cleaned):
            return cleaned
    return _mint_request_id()


class RequestIdMiddleware(BaseHTTPMiddleware):
    """ASGI middleware that populates ``request.state.request_id``."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        rid = extract_request_id(request)
        # Attach to request state for downstream handlers / structured logs.
        request.state.request_id = rid

        # Log the incoming request with the chosen request_id.
        from app.logging_config import log  # local import: avoid app-import cycles
        log(
            "info",
            "request received",
            request_id=rid,
            op=f"{request.method.lower()} {request.url.path}",
        )

        response: Response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = rid
        return response
