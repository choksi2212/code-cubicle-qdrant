"""Tests for structured JSON logging — every log line is a JSON object with
the required fields. Drives the FastAPI app in-process and captures stdout.
"""

from __future__ import annotations

import io
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

# Make `app` importable when running pytest from the repo root.
TEST_FILE = Path(__file__).resolve()
ROOT = TEST_FILE.parent
while ROOT != ROOT.parent and not (ROOT / "apps").is_dir():
    ROOT = ROOT.parent
if str(ROOT / "apps" / "sync-api") not in sys.path:
    sys.path.insert(0, str(ROOT / "apps" / "sync-api"))

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.logging_config import (  # noqa: E402
    JsonFormatter,
    configure_logging,
    log,
)
from app.middleware import RequestIdMiddleware  # noqa: E402


# ── JsonFormatter unit tests (no FastAPI needed) ────────────────────────────


def _format(record_kwargs: dict) -> dict:
    """Build a LogRecord with the given fields and run it through the formatter."""
    rec = logging.LogRecord(
        name="fieldedge",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg=record_kwargs.pop("msg", "hello"),
        args=(),
        exc_info=None,
    )
    for k, v in record_kwargs.items():
        rec.__dict__[k] = v
    line = JsonFormatter().format(rec)
    return json.loads(line)


def test_formatter_emits_required_fields():
    out = _format({"msg": "hi", "request_id": "abc-123", "device_id": "dev-1"})
    assert out["msg"] == "hi"
    assert out["level"] == "INFO"
    assert out["request_id"] == "abc-123"
    assert out["device_id"] == "dev-1"
    # ts is ISO-8601 UTC, millisecond precision.
    ts = out["ts"]
    # `+00:00` suffix may appear depending on fromtimestamp impl; either is fine.
    parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    assert parsed.tzinfo is not None


def test_formatter_defaults_request_id_to_dash():
    out = _format({"msg": "no-rid"})
    assert out["request_id"] == "-"


def test_formatter_handles_non_serializable_extra():
    import uuid

    rid = uuid.uuid4()
    out = _format({"msg": "x", "request_id": "r", "device_id": "d", "point_id": rid})
    # `default=str` in json.dumps turns the UUID into a string.
    assert out["point_id"] == str(rid)


# ── End-to-end: an endpoint hit produces a JSON log line ──────────────────


@pytest.fixture
def isolated_logger():
    """Capture every JSON-formatted line emitted during a test.

    We attach a fresh ``StreamHandler`` to the root logger so we don't fight
    over whatever ``configure_logging`` already installed.
    """
    configure_logging("DEBUG")
    buf = io.StringIO()
    handler = logging.StreamHandler(stream=buf)
    handler.setFormatter(JsonFormatter())
    handler.setLevel(logging.DEBUG)
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.DEBUG)
    yield buf
    root.removeHandler(handler)


def _json_lines(buf: io.StringIO) -> list[dict]:
    out: list[dict] = []
    for raw in buf.getvalue().splitlines():
        raw = raw.strip()
        if not raw:
            continue
        # Defensive: skip non-JSON noise (e.g. a stray loguru warning).
        try:
            out.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return out


def test_endpoint_hit_emits_valid_json_log(isolated_logger):
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/ping")
    def ping(request: Request):
        # Endpoint pulls the per-request id from middleware and threads it into
        # the structured log call — exactly the pattern routers/sync.py uses.
        from app.logging_config import bind as _bind
        _bind(request_id=request.state.request_id).info(
            "ping handled", op="ping.handle", extra_field="ok"
        )
        return {"ok": True}

    client = TestClient(app)
    resp = client.get("/ping", headers={"X-Request-ID": "rid-ping-1"})
    assert resp.status_code == 200

    lines = _json_lines(isolated_logger)
    assert lines, "expected at least one JSON log line to be emitted"

    # Find our explicit log call.
    handled = [ln for ln in lines if ln.get("msg") == "ping handled"]
    assert handled, f"expected 'ping handled' line, got: {lines}"
    line = handled[0]
    # Required fields per spec.
    for k in ("ts", "level", "msg"):
        assert k in line, f"missing {k!r} in {line}"
    assert line["request_id"] == "rid-ping-1"
    assert line["op"] == "ping.handle"
    assert line["extra_field"] == "ok"


def test_request_id_threaded_into_log_call(isolated_logger):
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/echo2")
    def echo2(request: Request):
        # Bind via request.state.request_id — the structured log helper
        # always includes whatever fields we pass.
        from app.logging_config import bind
        bind(request_id=request.state.request_id).info(
            "echo handled", op="echo.handle", value=42
        )
        return {"rid": request.state.request_id}

    client = TestClient(app)
    resp = client.get("/echo2", headers={"X-Request-ID": "thread-me-1"})
    assert resp.status_code == 200

    lines = _json_lines(isolated_logger)
    handled = [ln for ln in lines if ln.get("msg") == "echo handled"]
    assert handled, "expected 'echo handled' log line"
    assert handled[0]["request_id"] == "thread-me-1"
    assert handled[0]["op"] == "echo.handle"
    assert handled[0]["value"] == 42


def test_middleware_emits_request_received_log(isolated_logger):
    """The RequestIdMiddleware itself should emit one 'request received' line per hit."""
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/anything")
    def anything():
        return {"ok": True}

    client = TestClient(app)
    client.get("/anything", headers={"X-Request-ID": "mw-1"})
    client.get("/anything")  # no header → server mints one

    lines = _json_lines(isolated_logger)
    received = [ln for ln in lines if ln.get("msg") == "request received"]
    assert len(received) >= 2, "expected at least two 'request received' lines"
    rids = {ln["request_id"] for ln in received}
    assert "mw-1" in rids


def test_log_levels_respect_LOG_LEVEL_env(monkeypatch):
    """LOG_LEVEL=ERROR must filter out INFO log lines."""
    monkeypatch.setenv("LOG_LEVEL", "ERROR")
    configure_logging()  # re-reads the env

    buf = io.StringIO()
    handler = logging.StreamHandler(stream=buf)
    handler.setFormatter(JsonFormatter())
    handler.setLevel(logging.ERROR)
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        log("info", "should be filtered")
        log("error", "should pass through")
        lines = _json_lines(buf)
        msgs = [ln["msg"] for ln in lines]
        assert "should pass through" in msgs
        assert "should be filtered" not in msgs
    finally:
        root.removeHandler(handler)
        # Reset for subsequent tests.
        monkeypatch.delenv("LOG_LEVEL", raising=False)
        configure_logging()
