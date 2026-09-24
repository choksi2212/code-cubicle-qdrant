# Observability — Structured Logs and Request-ID Threading

**Document version:** 1.0
**Last updated:** 2026-09-24
**Owner:** Manas Choksi

This document covers the **foundational** observability stack: structured JSON
logging and end-to-end request-ID threading. It does **not** cover the
Sentry / OpenTelemetry integration — that lands in a separate pass once we
have real DSNs / collector endpoints configured.

---

## Table of Contents

1. [Why this matters](#1-why-this-matters)
2. [Log shape](#2-log-shape)
3. [Log levels](#3-log-levels)
4. [Request-ID threading](#4-request-id-threading)
5. [Reading the logs](#5-reading-the-logs)
6. [Adding a new field](#6-adding-a-new-field)
7. [What's next (Sentry + OTel)](#7-whats-next-sentry--otel)

---

## 1. Why this matters

When a customer reports "sync didn't work last Tuesday at 2am", we need to
find the trace in seconds — not minutes. The path is:

1. Grep server logs for the device_id or `request_id` the customer
   shared.
2. See every log line for that request across upload, conflict
   resolution, and response.
3. Find the matching device-side lines (Android logcat).
4. Reconstruct the failure in minutes, not hours.

Without structured logs and a single trace token, this is impossible.

---

## 2. Log shape

Every log line is a single JSON object. Required fields:

```json
{
  "ts": "2026-09-24T12:34:56.789Z",
  "level": "INFO",
  "msg": "upload completed",
  "request_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Plus any kv-pairs the call site supplied — typical extras:

| Field         | Meaning                                            |
|---------------|----------------------------------------------------|
| `op`          | dotted name of the operation (`sync.upload.point`)  |
| `device_id`   | mobile device identifier                           |
| `point_id`    | UUID of the point being processed                  |
| `batch_id`    | ULID of the upload batch                           |
| `duration_ms` | how long the operation took                        |
| `status`      | terminal status (`accepted`, `conflict_resolved`, …)|
| `error`       | exception message (when applicable)                |

The same shape applies to:

* **Server** (FastAPI / Python) — emitted via stdlib `logging` with the
  JSON formatter in `apps/sync-api/app/logging_config.py`. Existing
  `loguru` call-sites are auto-rewired to the same JSON sink.
* **Mobile / React Native** — emitted via `console.log(JSON.stringify(...))`
  through the `logger` in `apps/mobile/src/util/logger.ts`.
* **Rust core** — emitted to stderr (which Android logcat captures) from
  `packages/field-edge-rust/src/observability/mod.rs`.
* **Android / Kotlin** — forwarded through the React bridge into Android
  `Log.println` under tag `field_edge`.

---

## 3. Log levels

`DEBUG` < `INFO` < `WARN` < `ERROR`.

Filter via the `LOG_LEVEL` env var. Default is `INFO`. Examples:

```bash
LOG_LEVEL=DEBUG heroku config:set LOG_LEVEL=DEBUG       # heroku
LOG_LEVEL=DEBUG python -m app.main                       # local server
LOG_LEVEL=DEBUG ./android-studio-build                   # Android
```

`LOG_LEVEL` is read independently by:

* `apps/sync-api/app/logging_config.py` (Python) — controls both the
  stdlib and loguru handlers.
* `packages/field-edge-rust/src/observability/mod.rs` — read at each
  `log()` call from `std::env`.
* `apps/mobile/src/util/logger.ts` — read at module load (set via babel
  plugin or a build-time constant).

---

## 4. Request-ID threading

### Client side (mobile)

Every outbound HTTP request to the sync API gets a fresh `X-Request-ID`
header — a UUIDv4 minted by `uuidv4()` in `apps/mobile/src/util/uuid.ts`
(see `apps/mobile/src/services/api.ts::doFetch`). The same UUID is emitted
in the structured log line as `request_id`.

### Server side

`RequestIdMiddleware` (`apps/sync-api/app/middleware/request_id.py`):

* Reads the inbound `X-Request-ID` header.
* If absent or malformed, mints a UUIDv4.
* Stores it on `request.state.request_id` so route handlers can read it.
* Echoes it back in the response as `X-Request-ID`.

Route handlers in `apps/sync-api/app/routers/sync.py` thread the ID into
every structured log call via the `bind(request_id=..., device_id=...)`
helper from `apps/sync-api/app/logging_config.py`.

### Rust side

The Rust observability module currently always emits `request_id: "-"`
because we don't propagate the ID into the Rust FFI yet. Wiring the ID
through the dlsym boundary is straightforward (drop a C-string param into
`fe_log`); tracked as a follow-up in the Sentry/OTel pass.

---

## 5. Reading the logs

### Server (Render / Heroku)

```bash
render logs --tail                              # render
heroku logs --tail --app fieldedge-sync-api      # heroku
```

Then filter:

```bash
render logs --tail | jq 'select(.request_id == "550e8400-...")' | less
```

or

```bash
heroku logs --tail | jq -c 'select(.device_id == "dev_abc123...")'
```

### Device (Android)

```bash
adb logcat | grep field_edge
```

Then filter by trace:

```bash
adb logcat | grep field_edge | grep '"request_id":"550e8400-..."' | less
```

For a single device's whole day:

```bash
adb logcat -d | grep field_edge | jq -c 'select(.device_id == "dev_abc123...")'
```

(Requires `jq`.)

### Local development

```bash
# server
LOG_LEVEL=DEBUG python -m app.main | tee /tmp/server.log

# mobile (android emulator, RN debug console)
adb logcat -s field_edge:V ReactNativeJS:V | tee /tmp/device.log
```

---

## 6. Adding a new field

Pick the layer closest to where the data is born.

### Server (Python)

In your route handler:

```python
from app.logging_config import bind as log_bind

logg = log_bind(request_id=rid, device_id=device_id, op="sync.upload")
logg.info("upload received", batch_id=req.batch_id, n_points=len(req.points))
# or add a one-off field on the call site:
logg.info("upload received", batch_id=req.batch_id, project_id="river-study")
```

`project_id` is now emitted in the JSON line as `"project_id": "river-study"`.

### Mobile (TypeScript)

```ts
import { logger, bind } from '../util/logger';

logger.info('photo captured', { photo_id: 'abc', project_id: 'river-study' });

// or inside a request:
const reqLog = bind({ request_id: '...', device_id: '...' });
reqLog.info('photo captured', { photo_id: 'abc' });
```

### Rust

```rust
use field_edge_rust::observability::log;

log("INFO", "wal appended", &[
    ("op", "wal.append"),
    ("point_id", "550e8400-..."),
    ("seq", "42"),
]);
```

Anything in the kv slice becomes a JSON string field.

### Android / Kotlin

If a new field is only available in Kotlin (e.g. UI state), pass it
through the `log()` bridge method:

```ts
import { fieldEdge } from '../native/fieldEdge';

await fieldEdge.log('INFO', 'user opened settings', {
  route: 'SettingsScreen',
  device_id: '...',
});
```

This becomes a single logcat line under tag `field_edge`.

---

## 7. What's next (Sentry + OTel)

The Sentry and OpenTelemetry SDKs are **not** installed in this pass —
they need real DSNs and collector endpoints configured per environment,
which is a separate config-and-secrets task.

What this foundation gives the next pass:

* `request_id` is already end-to-end; OTel can use it as `trace_id` (or
  the parent span id) without a second pass of plumbing.
* Every log line is JSON, so Sentry's
  [`beforeSend`](https://docs.sentry.io/platforms/javascript/configuration/options/#before-send)
  hook can decorate it without parsing free-text.
* The Rust observability module is the natural place for the
  `tracing-opentelemetry` exporter — it already writes to stderr, so a
  `tracing_subscriber::fmt().json().flatten_event(true).with_writer(...)`
  swap lands cleanly.

Planned follow-up tasks (separate from this PR):

1. Add `sentry-sdk[fastapi]` and `sentry-sdk[ruby]` (no — wrong
   project) — add `sentry-sdk[fastapi]` for the API and
   `@sentry/react-native` for the mobile app, gated on the `SENTRY_DSN`
   env var.
2. Add `opentelemetry-instrumentation-fastapi`, `opentelemetry-exporter-otlp`
   on the server and `@opentelemetry/instrumentation-react-native` on the
   mobile side; point at a Tempo / Jaeger collector.
3. Convert `request_id` ↔ OTel `trace_id` in a single helper so log
   lines and spans stay correlatable.

---

**Companion docs:**

* [01-PRD.md](01-PRD.md) — original product requirements (FR-130
  covers observability hooks).
* [04-System-Architecture.md](04-System-Architecture.md) — system diagram
  showing the log flow from device → server → log shipper.
