# Schema Versions

This document records the versioned evolution of the `Payload` struct that
travels over the wire between the FieldEdge mobile client, the on-device
Rust shard, the WAL, and the central sync API.

## Why versioned?

We renamed `cloudinary_public_id` → `enrichment_id` mid-development and had
to wipe the central cluster. In production we cannot break the wire format
when adding fields. Versioned payloads let us:

- **Read old data** without rewriting it on disk.
- **Add new fields** without breaking clients on the previous version.
- **Migrate lazily** on read, so the storage layer never has to know about
  both shapes at once.

The discriminator is the integer field `schema_version` at the top level of
the payload object. A missing `schema_version` is treated as v1 (the
original wire format pre-dates the discriminator).

## v1 — original

The baseline schema as captured before this versioning system existed.

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | `u32` (= `1`) | Optional on the wire — missing ⇒ v1 |
| `photo_id` | `String` | ULID on the device |
| `device_id` | `String` | |
| `captured_at` | `String` | ISO-8601 UTC |
| `lat` | `Option<f64>` | |
| `lng` | `Option<f64>` | |
| `gps_status` | `GpsStatus` enum (`ok`/`unavailable`/`denied`) | |
| `project_id` | `String` | |
| `file_path` | `String` | device-local path |
| `embedding_status` | `EmbeddingStatus` enum (`ok`/`pending`/`failed`) | |
| `enrichment_id` | `Option<String>` | (was `cloudinary_public_id`) |
| `enrichment_tags` | `Vec<String>` | server-generated |
| `enrichment_objects` | `Vec<EnrichmentObject>` | server-generated |
| `enrichment_text` | `Option<String>` | server-generated |
| `synced_at` | `Option<String>` | ISO-8601 UTC |
| `local_updated_at` | `String` | ISO-8601 UTC |
| `vector_checksum` | `String` | `sha256:<hex>` |

## v2 — current (`CURRENT_SCHEMA_VERSION = 2`)

Adds three server-owned fields. v2 is the canonical form the server always
writes.

| Field | Type | Default on migration | Notes |
| --- | --- | --- | --- |
| `deletion_marker` | `bool` | `false` | Soft-delete flag — points with this set stay in the store but are filtered out of queries. |
| `project_owner` | `Option<String>` | `None` | Owning user/team identifier. Backfilled from auth context when known. |
| `tags_v2` | `Vec<String>` | `enrichment_tags.clone()` | Independent tag list, separate from the server-generated `enrichment_tags`. |

All v1 fields are preserved unchanged. v2 is a strict superset of v1.

## Migration path

The migration is `v1 → v2` only. The current writer always emits v2, so
readers only ever need to handle at most two versions.

### Rust

```rust
use field_edge_rust::models::payload::VersionedPayload;

let raw: &[u8] = /* ... bytes from disk or the wire ... */;
let migrated: PayloadV2 = VersionedPayload::from_bytes(raw)?
    .migrate_to_v2();
```

`VersionedPayload::from_bytes` peeks at `schema_version` (defaulting to `1`
when absent) and dispatches to the matching variant. `migrate_to_v2` then
applies the rules above.

### Python (sync API)

The `PointPayload` Pydantic model exposes a `model_validator(mode="before")`
that inspects `schema_version` and dispatches to `PointPayloadV1` or
`PointPayloadV2` for validation. Either is accepted on input. The router
runs a one-shot migration shim in `upload_points` (only) that bumps
incoming v1 payloads to v2 before they reach Qdrant.

`wal_replay` deliberately does NOT migrate on the way in — replay is a
re-run of an already-uploaded batch, and we want the original
`schema_version` preserved on disk.

### TypeScript (mobile)

```ts
import { migratePayload } from '@field-edge/mobile/native/fieldEdge';

const payload: Payload = migratePayload(inputFromServer);
```

`migratePayload` mutates and returns the input. v2 inputs are normalized
(defaults filled if the network dropped a field); v1 inputs are upgraded
in-place.

## Rollback policy

- v2 is forward-incompatible on the wire only in the sense that a v1
  reader would silently drop the three new fields. Our own readers
  (Rust WAL migrator, sync API validator, TS helper) all run the upgrade
  before downstream code sees the payload, so a v1 client reading a v2
  payload still works — it just doesn't see `deletion_marker` /
  `project_owner` / `tags_v2`.
- To roll back, redeploy a release that writes `schema_version: 1` for
  new points (i.e. drop the v2 fields from the write path). Existing v2
  payloads already in Qdrant remain readable; their v2 fields are
  tolerated by v1 readers as unknown keys.
- The WAL migrator is best-effort and idempotent: re-running
  `VersionedPayload::migrate_to_v2` on an already-v2 payload returns the
  same payload unchanged.

## Bumping the schema

1. Add a `PayloadV3` struct in `packages/field-edge-rust/src/models/payload.rs`
   with the new fields, and `#[serde(default)]` so older readers keep
   working.
2. Add a `V3(PayloadV3)` variant to `VersionedPayload` and a case in
   `from_value` / `from_bytes`.
3. Extend `migrate_to_v2` (or, eventually, `migrate_to_v3`) with the
   rule for going v3 → v2.
4. Bump `CURRENT_SCHEMA_VERSION` to `3`.
5. Mirror the new field in `PointPayloadV2` (Python) and the TS
   `Payload` interface.
6. Add unit tests for the new variant and the new migrator.

The wire stays backward-compatible because every reader runs through
`VersionedPayload` before handing data to the rest of the pipeline.
