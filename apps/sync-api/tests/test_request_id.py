"""Tests for the RequestIdMiddleware — server generates and echoes X-Request-ID.

We don't boot the full FastAPI app here (the openapi-compliance tests already
exercise that). Instead we drive the middleware directly through Starlette
TestClient so the assertions focus on request-id behaviour.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Make `app` importable when running pytest from the repo root.
TEST_FILE = Path(__file__).resolve()
ROOT = TEST_FILE.parent
while ROOT != ROOT.parent and not (ROOT / "apps").is_dir():
    ROOT = ROOT.parent
if str(ROOT / "apps" / "sync-api") not in sys.path:
    sys.path.insert(0, str(ROOT / "apps" / "sync-api"))

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.middleware import REQUEST_ID_HEADER, RequestIdMiddleware  # noqa: E402


UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


def test_request_without_header_generates_uuid():
    """Server must mint a UUIDv4 request_id when the client omits the header."""
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/x")
    def x(request: Request):
        return {"rid": request.state.request_id}

    client = TestClient(app)
    resp = client.get("/x")
    assert resp.status_code == 200
    body = resp.json()
    rid = body["rid"]
    assert isinstance(rid, str)
    assert UUID_RE.match(rid), f"expected UUID v4, got {rid!r}"
    # And the response echoes it back.
    assert resp.headers.get(REQUEST_ID_HEADER) == rid


def test_request_with_header_is_echoed():
    """Server must respect the client-supplied X-Request-ID verbatim."""
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/x")
    def x(request: Request):
        return {"rid": request.state.request_id}

    client = TestClient(app)
    incoming = "abc-123_DEF.456"
    resp = client.get("/x", headers={REQUEST_ID_HEADER: incoming})
    assert resp.status_code == 200
    assert resp.json()["rid"] == incoming
    assert resp.headers.get(REQUEST_ID_HEADER) == incoming


def test_response_header_always_set_even_on_404():
    """Even error paths should expose the request_id for log correlation."""
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/known")
    def known():
        return {"ok": True}

    client = TestClient(app)
    # Hit a route that doesn't exist — Starlette will 404, but middleware still runs.
    resp = client.get("/does-not-exist")
    assert resp.status_code == 404
    assert REQUEST_ID_HEADER in resp.headers
    rid = resp.headers[REQUEST_ID_HEADER]
    # 404 path doesn't carry request.state, so middleware must still mint + set it.
    assert rid and len(rid) >= 8


def test_request_id_uniqueness_across_requests():
    """Each unheadered request gets its own generated UUID."""
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/x")
    def x(request: Request):
        return {"rid": request.state.request_id}

    client = TestClient(app)
    seen = {client.get("/x").headers[REQUEST_ID_HEADER] for _ in range(50)}
    assert len(seen) == 50, "expected 50 unique generated request_ids"
