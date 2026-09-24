"""Structured JSON logging for the FieldEdge sync API.

Why
---
"When a customer reports sync didn't work last Tuesday at 2am" we need to
be able to grep one request_id and see the entire trace end-to-end. Stdlib
``logging`` is wired to a single-line JSON formatter, and ``loguru`` is
re-pointed at the same formatter so existing call-sites keep working.

Public surface
--------------
* :func:`configure_logging` — idempotent; call once at app startup.
* :func:`log` — convenience helper that takes ``(level, msg, **kv)`` and
  emits a JSON line with ``ts``, ``level``, ``msg``, and any supplied
  structured fields. Internally uses stdlib ``logging`` so behaviour is
  independent of loguru's patched state.
* :data:`LOG_LEVEL` — current effective level (read from ``LOG_LEVEL`` env,
  defaults to ``INFO``).
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any


# ─── Configuration ──────────────────────────────────────────────────────────

_VALID_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}


def _resolve_log_level() -> str:
    raw = os.environ.get("LOG_LEVEL", "INFO").strip().upper()
    return raw if raw in _VALID_LEVELS else "INFO"


LOG_LEVEL: str = _resolve_log_level()


# ─── JSON formatter ─────────────────────────────────────────────────────────


class JsonFormatter(logging.Formatter):
    """Emit one JSON object per log record.

    Required keys per the observability spec: ``ts``, ``level``, ``msg``.
    Extra fields passed via ``logger.log(level, msg, extra={...})`` are
    merged in. ``request_id`` defaults to ``"-"`` when absent so log
    shippers always see the field.
    """

    # Standard LogRecord attributes we never want to copy into the JSON.
    _RESERVED = {
        "name", "msg", "args", "levelname", "levelno", "pathname",
        "filename", "module", "exc_info", "exc_text", "stack_info",
        "lineno", "funcName", "created", "msecs", "relativeCreated",
        "thread", "threadName", "processName", "process", "message",
        "taskName",
    }

    def format(self, record: logging.LogRecord) -> str:  # noqa: D401
        # `ts`: ISO-8601 UTC with millisecond precision.
        ts = datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(
            timespec="milliseconds"
        )
        # Base payload.
        payload: dict[str, Any] = {
            "ts": ts,
            "level": record.levelname,
            "msg": record.getMessage(),
        }

        # Copy all non-reserved extras so `extra={"request_id": ...}` flows through.
        for key, value in record.__dict__.items():
            if key in self._RESERVED or key.startswith("_"):
                continue
            if key in payload:
                continue
            payload[key] = value

        # Always expose request_id — "-" when no middleware set one yet.
        payload.setdefault("request_id", "-")

        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)

        # json.dumps with default=str swallows non-serializable values (e.g. UUID).
        return json.dumps(payload, default=str, ensure_ascii=False)


# ─── Setup ──────────────────────────────────────────────────────────────────


_configured = False


def configure_logging(level: str | None = None) -> None:
    """Install the JSON handler on the root logger (idempotent).

    Safe to call multiple times — subsequent calls only adjust the level.
    Also re-points loguru at the same formatter so its existing call-sites
    (``logger.info(...)`` in routers) emit JSON too.
    """
    global _configured, LOG_LEVEL

    if level is not None:
        LOG_LEVEL = level.strip().upper() if level.strip().upper() in _VALID_LEVELS else "INFO"

    root = logging.getLogger()
    # Drop any existing handlers we previously installed (idempotent re-runs).
    for h in list(root.handlers):
        if getattr(h, "_fieldedge_json", False):
            root.removeHandler(h)

    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler._fieldedge_json = True  # type: ignore[attr-defined]
    handler.setLevel(LOG_LEVEL)
    root.addHandler(handler)
    root.setLevel(LOG_LEVEL)

    # Quiet noisy libraries at DEBUG/INFO; surface warnings and above.
    for noisy in ("uvicorn.access", "uvicorn.error", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(max(logging.WARNING, _level_num(LOG_LEVEL)))

    _repoint_loguru()

    _configured = True


def _level_num(name: str) -> int:
    return logging.getLevelName(name)


# ─── Loguru interop ─────────────────────────────────────────────────────────


def _repoint_loguru() -> None:
    """Make ``loguru.logger`` emit the same JSON line.

    Loguru is patched at import time elsewhere in the app; we wipe its
    handlers and add a single sink that writes via stdlib ``logging`` so
    the output format is identical (single JSON object per line).
    """
    try:
        from loguru import logger as _loguru_logger  # type: ignore
    except Exception:
        return

    try:
        _loguru_logger.remove()
    except Exception:
        pass

    def _sink(message) -> None:  # loguru SinkCallable
        record = message.record
        level_name = record["level"].name
        level_no = _level_num(level_name) if level_name in _VALID_LEVELS else logging.INFO
        stdlib_record = logging.LogRecord(
            name=record["name"],
            level=level_no,
            pathname=record["file"].path if hasattr(record["file"], "path") else str(record["file"]),
            lineno=record["line"],
            msg=record["message"],
            args=(),
            exc_info=record["exception"],
        )
        # Copy extras (excluding reserved keys) onto the stdlib record.
        for key, value in record["extra"].items():
            if key in JsonFormatter._RESERVED or key.startswith("_"):
                continue
            stdlib_record.__dict__[key] = value
        logging.getLogger().handle(stdlib_record)

    _loguru_logger.add(_sink, level=LOG_LEVEL, format="{message}")


# ─── Convenience helper ─────────────────────────────────────────────────────


def log(level: str, msg: str, **fields: Any) -> None:
    """Emit one structured log line.

    Example::

        log("info", "upload accepted", device_id="abc", point_id="p1",
            request_id="...", duration_ms=12, op="sync.upload")

    ``level`` is case-insensitive. Extra fields are merged into the JSON
    payload as-is (JSON-encoded via :func:`json.dumps`'s ``default=str``).
    """
    level_norm = level.strip().upper()
    if level_norm not in _VALID_LEVELS:
        level_norm = "INFO"
    logging.getLogger("fieldedge").log(_level_num(level_norm), msg, extra=fields)


def bind(**fields: Any) -> "BoundLogger":
    """Return a binder that re-emits ``fields`` on every subsequent call.

    Useful inside request handlers::

        logg = bind(request_id=rid, device_id=dev)
        logg.info("upload received", op="sync.upload", point_id=pid)
    """
    return BoundLogger(fields)


class BoundLogger:
    def __init__(self, fields: dict[str, Any]) -> None:
        self._fields = dict(fields)

    def _emit(self, level: str, msg: str, **extra: Any) -> None:
        merged = {**self._fields, **extra}
        log(level, msg, **merged)

    def debug(self, msg: str, **kw: Any) -> None: self._emit("DEBUG", msg, **kw)
    def info(self, msg: str, **kw: Any) -> None:  self._emit("INFO",  msg, **kw)
    def warning(self, msg: str, **kw: Any) -> None: self._emit("WARNING", msg, **kw)
    def error(self, msg: str, **kw: Any) -> None:  self._emit("ERROR", msg, **kw)
    def exception(self, msg: str, **kw: Any) -> None: self._emit("ERROR", msg, **kw)


# ─── Tests for the formatter ────────────────────────────────────────────────
# Lightweight self-tests so the formatter ships with a smoke-check built in
# (these run via ``python -m app.logging_config``).
if __name__ == "__main__":  # pragma: no cover
    configure_logging("DEBUG")
    log("info", "hello", request_id="abc-123", device_id="dev-1")
    log("debug", "tick", op="wal.tick", duration_ms=4)
    try:
        raise RuntimeError("boom")
    except RuntimeError:
        logging.getLogger("fieldedge").exception("caught", extra={"op": "sync.upload"})
    sys.stdout.flush()
