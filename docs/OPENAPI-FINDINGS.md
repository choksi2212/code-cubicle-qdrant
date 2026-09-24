# OpenAPI findings

Findings uncovered while writing `apps/sync-api/openapi.yaml` against the
live FastAPI app. **None of these have been fixed in the router — this doc
is the deliverable.** They are tracked here so the next pass can decide
what to actually change.

All findings refer to the implementation in `apps/sync-api/app/`.

---

## F1. `/sync/pull` is `GET`, not `POST` with a JSON body

- **Spec sketch:** `POST /sync/pull` with body `{device_id, since_ts}`,
  returning `{points, server_ts}`.
- **Actual server:** `GET /sync/pull` with query params `since`, `limit`
  and `device_id` resolved from the `Authorization: Bearer dev_<id>`
  header. Returns `PullResponse` with `server_time`, `points`,
  `next_cursor`, `has_more`.
- **Implication:** The TS client's `apiClient.pullUpdates({since,
  device_id, limit})` builds a query string — that's the real contract.
  Any spec / docs that describe a JSON body for pull are out of date.

## F2. `/sync/heartbeat` is `GET`, not `POST`; no device list

- **Spec sketch:** `POST /sync/heartbeat` returning a device list.
- **Actual server:** `GET /sync/heartbeat` returning
  `HeartbeatResponse` (`{status, server_time, qdrant_reachable,
  qdrant_point_count}`).
- **Implication:** The heartbeat is a server-side liveness probe with
  Qdrant reachability. There is no per-device heartbeat on the server
  today; the mobile client should not expect a device list back.

## F3. `/sync/upload` is JSON, not multipart

- **Spec sketch:** multipart with `points`.
- **Actual server:** `application/json` body
  `UploadRequest{device_id, batch_id, points[]}`.
- **Implication:** Photo bytes are NOT sent through the sync API. They
  live on the device (`file_path` in the payload) and are flushed to
  Cloudinary via PS02 separately.

## F4. `/sync/wal/replay` returns `UploadResponse`, not a generic ack

- **Spec sketch:** returns `ack`.
- **Actual server:** returns the full `UploadResponse` with per-point
  results — same shape as `POST /sync/upload`. The OpenAPI spec keeps
  `WalReplayResponse` as an alias for `UploadResponse` for documentation
  symmetry; clients should reuse their upload-response handler.

## F5. `/healthz` does not include a `version` field

- **Spec sketch:** returns `{status, version}`.
- **Actual server:** returns only `{status: "alive"}`.
- **Implication:** The PRD sketches a `version` echo, but the route
  handler in `app/routers/health.py` does not return one. To add it,
  thread `app.version` through `liveness()`.

## F6. `/readyz` shape differs from the PRD

- **Spec sketch:** returns `{qdrant: bool, version: string}`.
- **Actual server:** returns `{status: "ready"|"not_ready",
  qdrant_collection, qdrant_points, qdrant_status}` on 200, or
  `{status: "not_ready", error}` on 503.
- **Implication:** There is no top-level `qdrant: bool`; readiness is
  inferred from `status == "ready"`. `qdrant_points` is an integer count,
  not a boolean.

## F7. `enrichment_objects` is `list[dict[str, Any]]` (no schema)

- The Pydantic model declares
  `enrichment_objects: list[dict[str, Any]]`. The OpenAPI schema mirrors
  that as `additionalProperties: true` on each item. The shape is up to
  the enrichment service (YOLO-style detector output: `{label, score,
  bbox}` etc.) — no server-side validation. If you want a strict schema,
  define one in `app/models.py` first; right now it's permissive by
  design.

## F8. `resolution` enum requires `null` for `accepted` results

- `PointResult.resolution` is `Literal["local_wins", "remote_wins",
  "merged"] | None` and is left `null` whenever `status == "accepted"`.
- The OpenAPI spec had to include `null` in the enum for the contract
  test to pass. Worth noting in case anyone tries to "tighten" the enum
  by removing the `None` later.

## F9. `vector_checksum` mismatch on identical-content replay is a 409-shaped edge case

- The server's idempotency check is `existing.payload.vector_checksum ==
  point.payload.vector_checksum`. If a device changes its vector but
  reuses the same point id (e.g. a regenerate flow) it will always go
  down the conflict-resolution path. Not strictly a schema bug, but
  worth surfacing — clients that always bump `vector_checksum` will
  never get the cheap `accepted` branch.

## F10. No auth endpoint modelled

- The current server accepts any Bearer token >= 8 chars
  (`app/auth.py::verify_device_token`). There is no real device-token
  issuance endpoint yet. `openapi.yaml` leaves a TODO marker at the
  bottom of `components.securitySchemes` for the future endpoint. The
  contract tests use `Bearer dev_device-abc-1234` because that's what
  `verify_device_token` accepts today.
