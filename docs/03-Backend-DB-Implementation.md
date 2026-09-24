# Backend & Database Implementation — FieldEdge

**Document version:** 1.0
**Last updated:** 2025-09-23
**Owner:** Manas Choksi (sync orchestrator, Qdrant Edge + Cloud)
**Companion to:** [01-PRD.md](01-PRD.md), [02-TRD.md](02-TRD.md), [04-System-Architecture.md](04-System-Architecture.md)

---

## Table of Contents

1. [Backend Architecture Overview](#1-backend-architecture-overview)
2. [Sync API Endpoints — Full Spec](#2-sync-api-endpoints--full-spec)
3. [Qdrant Edge Local Setup (Real SDK + Fallback)](#3-qdrant-edge-local-setup-real-sdk--fallback)
4. [Central Qdrant Cloud Cluster Setup](#4-central-qdrant-cloud-cluster-setup)
5. [Collection Schema and Payload Design](#5-collection-schema-and-payload-design)
6. [Point Payload Field Reference](#6-point-payload-field-reference)
7. [Vector Index Configuration](#7-vector-index-configuration)
8. [Write-Ahead Log (WAL) Design](#8-write-ahead-log-wal-design)
9. [Sync Protocol — Differential, Idempotent, Conflict-Aware](#9-sync-protocol--differential-idempotent-conflict-aware)
10. [Conflict Resolution Algorithm](#10-conflict-resolution-algorithm)
11. [Embedding Pipeline Implementation](#11-embedding-pipeline-implementation)
12. [Caching Strategy](#12-caching-strategy)
13. [Error Handling, Retries, Observability](#13-error-handling-retries-observability)
14. [Code Examples — End-to-End Flows](#14-code-examples--end-to-end-flows)

---

## 1. Backend Architecture Overview

### 1.1 Component Map

The backend comprises four cooperating components:

1. **Local Qdrant Edge shard** — embedded in the device, accessed via the Rust bridge (or its `qdrant-client` local-mode fallback). Source of truth for offline semantic search.
2. **Local metadata SQLite DB** — on-device relational store for photo file paths, project definitions, sync state per point, WAL cursor.
3. **Local Write-Ahead Log (WAL)** — append-only log of every local write; replayed on startup or after crash.
4. **Sync API server** (FastAPI, Python) — stateless orchestrator that accepts uploads from devices, writes to central Qdrant cluster, and returns pull cursors.

### 1.2 Data Flow — Capture to Search to Sync

```
[Camera shutter]
     │
     ▼
[Image preprocessing → 224×224 PNG]
     │
     ▼
[ONNX Runtime: CLIP image embedding (512-dim fp16 → int8 quantized)]
     │
     ▼
[Append entry to WAL: {op: 'upsert', point_id, vector, payload}]
     │
     ▼
[Sync WAL → Edge shard upsert]
     │
     ▼
[Photo saved at /<project>/<device>/<photo>.jpg; metadata in SQLite]
     │
     ▼
[UI shows "Saved" toast]
     │
     ▼
[User types "river pollution"]
     │
     ▼
[ONNX Runtime: CLIP text embedding (512-dim)]
     │
     ▼
[Edge shard query: nearest 20 by cosine similarity, filtered by project/date]
     │
     ▼
[UI shows result grid]
     │
     ▼
[User taps "Sync now"]
     │
     ▼
[Sync orchestrator: compute diff(local, server), upload new, pull updates, resolve conflicts]
     │
     ▼
[Central Qdrant cluster + Mihir's separate pipeline]
```

### 1.3 Trust Boundaries

| Boundary | Inside | Outside | Encrypted? |
|---|---|---|---|
| Device ↔ user | App sandbox | Other apps on device | OS sandbox |
| App ↔ native module | Same process | OS | IPC; no encryption needed |
| Native ↔ Rust | Same process | OS | FFI; no encryption needed |
| Device ↔ sync API | TLS 1.3 | Internet | Yes (HTTPS) |
| Sync API ↔ Qdrant Cloud | TLS 1.3 | Qdrant cluster | Yes (HTTPS) |
| Sync API ↔ enrichment | TLS 1.3 | enrichment | Yes (HTTPS) |

---

## 2. Sync API Endpoints — Full Spec

### 2.1 `POST /sync/upload`

**Purpose:** Accept a batch of points from a device, write them to the central Qdrant cluster, return per-point ack with conflict info.

**Request:**
```http
POST /sync/upload HTTP/1.1
Host: api.fieldedge.example.com
Authorization: Bearer <device_token>
Content-Type: application/json

{
  "device_id": "550e8400-e29b-41d4-a716-446655440000",
  "batch_id": "2025-05-12T14:23:01.123Z-001",
  "points": [
    {
      "id": "01HXZ3KQ9R8X9V6QH7Y4N5M3BP",
      "vector": [0.012, -0.034, ...],
      "payload": {
        "schema_version": 1,
        "photo_id": "01HXZ3KQ9R8X9V6QH7Y4N5M3BP",
        "device_id": "550e8400-...",
        "captured_at": "2025-05-12T14:23:01.123Z",
        "lat": 13.4521,
        "lng": 75.1234,
        "gps_status": "ok",
        "project_id": "p-river-study",
        "file_path": "p-river-study/550e.../01HXZ....jpg",
        "embedding_status": "ok",
        "local_updated_at": "2025-05-12T14:23:01.456Z",
        "vector_checksum": "sha256:abc123..."
      }
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "batch_id": "2025-05-12T14:23:01.123Z-001",
  "server_time": "2025-05-12T14:25:33.001Z",
  "results": [
    {
      "id": "01HXZ3KQ9R8X9V6QH7Y4N5M3BP",
      "status": "accepted",
      "server_version": 1
    },
    {
      "id": "01HXZ3KQ9R8X9V6QH7Y4N5M3BP",
      "status": "conflict_resolved",
      "resolution": "remote_wins",
      "resolved_payload": { ... }
    }
  ],
  "next_cursor": "eyJzZXJ2ZXJfdGltZSI6IjIwMjUtMDUtMTNUMTQ6MjU6MzMuMDAxWiIsImxhc3RfaWQiOiIwMUhYWjNLUTlSOFg5VjZRSDdZNE41TTNCUCJ9"
}
```

**Status values per point:**
- `accepted` — wrote successfully, no conflict.
- `accepted_with_merge` — wrote successfully after merge (rare; payloads had disjoint keys).
- `conflict_resolved` — conflict detected; resolved by algorithm in Section 10. Field `resolution` shows which side won or that it was merged.
- `rejected_too_old` — server has a newer version and rejected the older write (rare; only if `local_updated_at` is more than 1 day older than server's).
- `rejected_invalid_payload` — payload failed schema validation.

**Status codes:**
- `200` — batch processed (individual results may still be rejections).
- `400` — request body malformed.
- `401` — missing or invalid device token.
- `413` — batch too large (>100 points).
- `429` — rate limit exceeded.
- `503` — central Qdrant unavailable; client should retry with backoff.

### 2.2 `GET /sync/pull`

**Purpose:** Return all points updated on the server since the given cursor, in order. Includes enrichment-enriched payloads when available.

**Request:**
```http
GET /sync/pull?since=eyJzZXJ2ZXJfdGltZSI6IjIwMjUt...&device_id=550e8400...&limit=100 HTTP/1.1
Authorization: Bearer <device_token>
```

**Query params:**
- `since` (required): opaque cursor from previous response.
- `device_id` (required): the calling device's ID; used to filter out the device's own writes from the pull (it already has them locally).
- `limit` (optional, default 100, max 500): max points to return.

**Response (200 OK):**
```json
{
  "server_time": "2025-05-12T14:30:00.000Z",
  "points": [
    {
      "id": "01HXZ3KQ9R8X9V6QH7Y4N5M3BP",
      "vector": [0.012, -0.034, ...],
      "payload": {
        "...": "...",
        "enrichment_id": "abc123def",
        "enrichment_tags": ["water", "pollution", "outdoor"],
        "enrichment_objects": [
          {"label": "bottle", "box": [10, 20, 50, 60], "confidence": 0.92}
        ],
        "enrichment_text": null,
        "synced_at": "2025-05-12T14:25:33.001Z",
        "server_version": 1
      }
    }
  ],
  "next_cursor": "eyJzZXJ2ZXJfdGltZSI6IjIwMjUtMDUtMTNUMTQ6MzA6MDAuMDAwWiIsImxhc3RfaWQiOiIwMUhYWjNLUTlSOFg5VjZRSDdZNE41TTNCUCJ9",
  "has_more": true
}
```

When `has_more` is false, the client knows the pull is complete.

**Cursor format:** Base64URL-encoded JSON `{server_time: ISO-8601, last_id: ULID}`. Server uses this to issue an indexed range query.

### 2.3 `POST /sync/wal/replay`

**Purpose:** Recover from an interrupted batch upload. Same request format as `/sync/upload` but with `replay: true`. Server deduplicates by checking if the `batch_id` was already fully processed.

```http
POST /sync/wal/replay HTTP/1.1
Content-Type: application/json

{
  "device_id": "...",
  "batch_id": "...",
  "replay": true,
  "points": [ ... ]
}
```

**Response:** Same shape as `/sync/upload`. Server compares incoming `batch_id` to its WAL of processed batches (kept for 24 hours); if found, returns cached results without re-writing.

### 2.4 `GET /sync/heartbeat`

**Purpose:** Liveness check; returns server time + cluster health.

```http
GET /sync/heartbeat HTTP/1.1
```

**Response (200 OK):**
```json
{
  "status": "ok",
  "server_time": "2025-05-12T14:30:00.000Z",
  "qdrant_reachable": true,
  "qdrant_point_count": 12453
}
```

### 2.5 Auth Header

All non-`/sync/heartbeat` endpoints require:
```http
Authorization: Bearer dev_<256-bit-base64>
```

Server validates token against SQLite `devices` table; rejected tokens return `401`.

### 2.6 Rate Limits

- 60 requests/minute per device token.
- 1000 points/minute per device token (across all upload batches).
- Exceeding returns `429` with `Retry-After` header.

---

## 3. Qdrant Edge Local Setup (Real SDK + Fallback)

### 3.1 Real SDK Path: `qdrant-edge` via Rust Bridge

**Create the shard:**

```rust
use field_edge_rust::edge::{QdrantEdgeAdapter, EdgeOps, EdgeConfig};
use field_edge_rust::models::Distance;

pub fn create_local_shard(dir: &str) -> Result<Box<dyn EdgeOps>, EdgeError> {
    let cfg = EdgeConfig {
        vectors: HashMap::from([(
            "clip".to_string(),
            EdgeVectorParams {
                size: 512,
                distance: Distance::Cosine,
            },
        )]),
        quantization_config: Some(QuantizationConfig::Scalar(ScalarQuantization {
            quantile: 0.99,
            always_ram: false,
        })),
        optimizers_config: Some(EdgeOptimizersConfig {
            deleted_threshold: 0.2,
            vacuum_min_vector_number: 100,
            default_segment_number: 2,
        }),
        max_search_threads: 4,
        wal_options: Some(WalOptions {
            wal_capacity_mb: 32,
            wal_segments_ahead: 2,
        }),
    };

    let shard = EdgeShard::create(dir, cfg)?;
    Ok(Box::new(QdrantEdgeAdapter::new(shard)))
}
```

**Load existing shard:**

```rust
pub fn load_local_shard(dir: &str) -> Result<Box<dyn EdgeOps>, EdgeError> {
    let shard = EdgeShard::load(dir)?;
    Ok(Box::new(QdrantEdgeAdapter::new(shard)))
}
```

### 3.2 Fallback Path: `qdrant-client` Local Mode

```rust
use qdrant_client::{QdrantClient, QdrantClientConfig, client::VectorParams, config::Distance};

pub fn create_local_shard_fallback(path: &str) -> Result<Box<dyn EdgeOps>, EdgeError> {
    let config = QdrantClientConfig {
        storage_path: Some(path.to_string()),
        ..Default::default()
    };
    let client = QdrantClient::new(config)?;

    client.create_collection(
        "field_edge_clip",
        VectorParams {
            size: 512,
            distance: Distance::Cosine,
            ..Default::default()
        },
    ).await.ok(); // ignore "already exists"

    Ok(Box::new(QdrantClientAdapter::new(client, "field_edge_clip")))
}
```

### 3.3 Choosing the Implementation

**Cargo feature flag** (compile-time):
```toml
[features]
default = ["edge"]
edge = []
local-mode = []
```

**Conditional compilation:**
```rust
#[cfg(feature = "edge")]
pub fn open_shard(dir: &str) -> Result<Box<dyn EdgeOps>, EdgeError> {
    create_local_shard(dir)
}

#[cfg(feature = "local-mode")]
pub fn open_shard(dir: &str) -> Result<Box<dyn EdgeOps>, EdgeError> {
    create_local_shard_fallback(dir)
}
```

### 3.4 Day-1 Smoke Test

```rust
#[test]
fn smoke_create_load_query() {
    let dir = tempfile::tempdir().unwrap();
    let mut shard = open_shard(dir.path().to_str().unwrap()).unwrap();

    shard.upsert(&[Point {
        id: "test-1".to_string(),
        vector: vec![0.1; 512],
        payload: json!({"label": "hello"}),
    }]).unwrap();

    shard.optimize().unwrap();
    drop(shard);

    let mut shard2 = open_shard(dir.path().to_str().unwrap()).unwrap();
    let hits = shard2.query(&QueryRequest {
        vector: vec![0.1; 512],
        limit: 1,
        filter: None,
    }).unwrap();

    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, "test-1");
}
```

---

## 4. Central Qdrant Cloud Cluster Setup

### 4.1 Cluster Provisioning

1. Sign up at [cloud.qdrant.io](https://cloud.qdrant.io).
2. Create a free-tier cluster in the region closest to the demo device.
3. Note the cluster URL and API key. Store in `.env` (NOT in any committed file).

```
QDRANT_URL=https://790d645c-576d-484c-bd4b-be5147fab877.ca-central-1-0.aws.cloud.qdrant.io
QDRANT_API_KEY=eyJhbGciOiJIUzI1NiIs...
```

### 4.2 Collection Creation

```python
# scripts/create_central_collection.py
import os
from qdrant_client import QdrantClient
from qdrant_client.http import models

client = QdrantClient(
    url=os.environ["QDRANT_URL"],
    api_key=os.environ["QDRANT_API_KEY"],
)

client.create_collection(
    collection_name="field_edge_central",
    vectors_config=models.VectorParams(
        size=512,
        distance=models.Distance.COSINE,
    ),
    quantization_config=models.ScalarQuantization(
        quantile=0.99,
        always_ram=False,
    ),
    hnsw_config=models.HnswConfigDiff(
        m=16,
        ef_construct=100,
        full_scan_threshold=10000,
    ),
    optimizers_config=models.OptimizersConfigDiff(
        default_segment_number=2,
        max_segment_size=20000,
        memmap_threshold=50000,
    ),
)

# Create payload indexes for filtered search
client.create_payload_index(
    collection_name="field_edge_central",
    field_name="project_id",
    field_schema=models.PayloadSchemaType.KEYWORD,
)
client.create_payload_index(
    collection_name="field_edge_central",
    field_name="captured_at",
    field_schema=models.PayloadSchemaType.DATETIME,
)
client.create_payload_index(
    collection_name="field_edge_central",
    field_name="device_id",
    field_schema=models.PayloadSchemaType.KEYWORD,
)
```

### 4.3 Free-Tier Limits

| Resource | Limit | Our headroom |
|---|---|---|
| Cluster size | 1 GB RAM | ~50k 512-dim int8 vectors fit |
| Vectors | 1M | We use <10k |
| Collections | Unlimited | We use 1 |
| API requests | 100/sec | We use <1/sec |
| Storage | 4 GB | We use <1 GB |

### 4.4 Authentication

- API key is sent as `api-key: <key>` header (NOT Bearer — Qdrant convention).
- Rotation: not needed for hackathon; document for v2.

---

## 5. Collection Schema and Payload Design

### 5.1 Collection Naming

| Environment | Local | Central |
|---|---|---|
| Collection name | `field_edge_local` | `field_edge_central` |

(Same schema, different physical deployments.)

### 5.2 Vector Specification

| Property | Value |
|---|---|
| Name | `clip` |
| Dimension | 512 |
| Distance | Cosine |
| Quantization | Scalar int8 |

### 5.3 Payload Schema (matches FR-031 from PRD)

```json
{
  "schema_version": 1,
  "photo_id": "01HXZ3KQ9R8X9V6QH7Y4N5M3BP",
  "device_id": "550e8400-e29b-41d4-a716-446655440000",
  "captured_at": "2025-05-12T14:23:01.123Z",
  "lat": 13.4521,
  "lng": 75.1234,
  "gps_status": "ok",
  "project_id": "p-river-study",
  "file_path": "p-river-study/550e8400.../01HXZ3KQ9R8X9V6QH7Y4N5M3BP.jpg",
  "embedding_status": "ok",
  "enrichment_id": null,
  "enrichment_tags": [],
  "enrichment_objects": [],
  "enrichment_text": null,
  "synced_at": null,
  "local_updated_at": "2025-05-12T14:23:01.456Z",
  "vector_checksum": "sha256:abc123..."
}
```

### 5.4 Payload Indexes (for filtered search)

| Field | Type | Indexed for |
|---|---|---|
| `project_id` | Keyword | Match |
| `captured_at` | Datetime | Range |
| `device_id` | Keyword | Match (used by `/sync/pull` to exclude own writes) |
| `enrichment_id` | Keyword | Match (nullable) |
| `synced_at` | Datetime | Range (for diagnostics) |

### 5.5 Schema Versioning

- Every payload has `schema_version: 1`.
- Future versions add new fields; old fields are deprecated, not removed.
- Migration logic on read: if `schema_version < current`, run `migrate(payload, from_version)` function. (v1 has no migrations.)

---

## 6. Point Payload Field Reference

| Field | Type | Required | Mutable | Description |
|---|---|---|---|---|
| `schema_version` | int | ✓ | no | Payload schema version |
| `photo_id` | ULID | ✓ | no | Unique identifier (same as point ID) |
| `device_id` | UUID | ✓ | no | Originating device's install ID |
| `captured_at` | ISO-8601 | ✓ | no | Shutter timestamp (UTC, ms precision) |
| `lat` | float or null | ✓ | no | GPS latitude |
| `lng` | float or null | ✓ | no | GPS longitude |
| `gps_status` | enum | ✓ | no | `ok` \| `unavailable` \| `denied` |
| `project_id` | string | ✓ | yes | User-assigned project tag |
| `file_path` | string | ✓ | no | Relative path from app docs root |
| `embedding_status` | enum | ✓ | yes | `ok` \| `pending` \| `failed` |
| `enrichment_id` | string or null | no | yes | enrichment asset ID (after sync) |
| `enrichment_tags` | string[] | no | yes | Auto-tagging results (after sync) |
| `enrichment_objects` | object[] | no | yes | Object detection results (after sync) |
| `enrichment_text` | string or null | no | yes | OCR results (after sync) |
| `synced_at` | ISO-8601 or null | no | yes | Server-receipt timestamp |
| `local_updated_at` | ISO-8601 | ✓ | yes | Last local modification timestamp |
| `vector_checksum` | string | ✓ | no | SHA-256 of vector bytes, prefix `sha256:` |

### 6.1 `enrichment_objects` Shape

```json
{
  "label": "bottle",
  "box": [x_min, y_min, x_max, y_max],
  "confidence": 0.92
}
```

Box coordinates are pixel-based, image-relative. Image dimensions stored implicitly (enrichment stores the asset dimensions).

### 6.2 `vector_checksum` Computation

```python
import hashlib

def compute_checksum(vector: list[float]) -> str:
    # Convert to bytes (little-endian float32) deterministically
    b = b''.join(struct.pack('<f', v) for v in vector)
    return "sha256:" + hashlib.sha256(b).hexdigest()
```

Used during conflict detection — if two payloads have the same vector checksum, they're guaranteed identical even if other fields differ.

---

## 7. Vector Index Configuration

### 7.1 Local Edge Shard Index

```rust
EdgeConfig {
    vectors: HashMap::from([(
        "clip".to_string(),
        EdgeVectorParams {
            size: 512,
            distance: Distance::Cosine,
        },
    )]),
    quantization_config: Some(QuantizationConfig::Scalar(ScalarQuantization {
        quantile: 0.99,
        always_ram: false,
    })),
    optimizers_config: Some(EdgeOptimizersConfig {
        deleted_threshold: 0.2,
        vacuum_min_vector_number: 100,
        default_segment_number: 2,
    }),
    max_search_threads: 4,
    search_pool_core: 0,
}
```

### 7.2 Central Qdrant Cluster Index

```python
HnswConfigDiff(
    m=16,                       # Edges per node
    ef_construct=100,           # Build-time search width
    full_scan_threshold=10000,  # Above this, force full scan
)
ScalarQuantization(
    quantile=0.99,              # Ignore top 1% outliers
    always_ram=False,           # Allow on-disk
)
OptimizersConfigDiff(
    default_segment_number=2,
    max_segment_size=20000,
    memmap_threshold=50000,
)
```

### 7.3 Index Tuning Rationale

- **m=16**: Standard for 512-dim. Higher m = better recall, slower indexing.
- **ef_construct=100**: 2x of m. Good balance for ≤100k vectors.
- **quantile=0.99**: Excludes outliers; standard for cosine distance.
- **memmap_threshold=50000**: Vectors stay in RAM until 50k; we never approach this.

### 7.4 Per-Query `ef` Parameter

Set `ef` per query (not stored in config):

```typescript
const results = await fieldEdge.query({
  vector: queryEmbedding,
  limit: 20,
  filter: { ... },
  ef: 64,  // search-time width; higher = better recall, slower
});
```

Default `ef=64`. For "best match" UX, use `ef=128`.

---

## 8. Write-Ahead Log (WAL) Design

### 8.1 Purpose

The WAL guarantees that no local write is acknowledged to the UI until it is durably committed to disk, even if the app is killed mid-operation. WAL entries are replayed on startup or after crash.

### 8.2 File Format

Binary, append-only. Each entry is:

```
┌──────────┬───────────┬──────────────┬─────────────────────────┐
│ Magic    │ Op (u8)   │ Length (u32) │ Payload (bytes)         │
│ 4 bytes  │           │ little-endian│ length-prefixed JSON     │
└──────────┴───────────┴──────────────┴─────────────────────────┘
```

- Magic: `b"FELG"` (FieldEdge Log).
- Op values: `0x01 = UPSERT`, `0x02 = DELETE`, `0x03 = OPTIMIZE_HINT`.
- Length: byte length of the JSON payload.
- Payload: UTF-8 JSON.

### 8.3 WAL Entry Examples

**UPSERT:**
```json
{
  "op": "UPSERT",
  "seq": 42,
  "point_id": "01HXZ3KQ9R8X9V6QH7Y4N5M3BP",
  "vector": [0.012, -0.034, ...],
  "payload": { ... },
  "ts": "2025-05-12T14:23:01.456Z"
}
```

**DELETE:**
```json
{
  "op": "DELETE",
  "seq": 43,
  "point_id": "01HXZ3KQ9R8X9V6QH7Y4N5M3BP",
  "ts": "2025-05-12T14:30:00.000Z"
}
```

### 8.4 WAL Lifecycle

```
   Capture       WAL Append      Shard Upsert      Sync OK
     │               │                  │               │
     │  ─UPSERT─►   │                  │               │
     │               │  ─UPSERT─►      │               │
     │               │                  │  ─upload─►   │
     │               │                  │               │  ◄── mark synced
     ▼               ▼                  ▼               ▼
   [UI toast]   [fsync to disk]   [in-memory]      [SQLite flag]
```

1. Capture writes to WAL, calls `fsync`, then upserts to shard.
2. UI shows "Saved" only after both fsync and shard upsert succeed.
3. Sync marks entry as uploaded; WAL entry remains for 7 days for crash recovery.

### 8.5 WAL Replay

On app startup, the WAL is replayed:

```rust
pub fn replay_wal(wal_path: &Path, shard: &mut dyn EdgeOps) -> Result<ReplayReport, EdgeError> {
    let mut report = ReplayReport::default();
    let file = File::open(wal_path)?;
    let reader = BufReader::new(file);

    for entry in WalReader::new(reader) {
        match entry.op {
            Op::Upsert => {
                shard.upsert(&[entry.into_point()])?;
                report.upserts_replayed += 1;
            }
            Op::Delete => {
                shard.delete(&[entry.point_id])?;
                report.deletes_replayed += 1;
            }
            _ => {}
        }
    }

    Ok(report)
}
```

If the WAL is corrupt at byte offset N, replay stops at N and the remaining bytes are quarantined to `wal.corrupt-<ts>`. The app continues with whatever was successfully replayed.

### 8.6 WAL Rotation

When the WAL exceeds 10 MB, it's renamed to `wal.<timestamp>.rotated` and a new empty WAL is started. Rotated files are kept for 7 days then deleted on app launch.

### 8.7 WAL and Sync Coordination

Each entry has a `sync_state` flag (`pending` | `uploading` | `synced` | `failed`). The sync orchestrator reads entries with `sync_state = pending` and uploads them.

After successful upload:
- `sync_state = synced`
- Point's `synced_at` payload field is updated.
- WAL entry is NOT deleted (kept for crash recovery; the entry's `sync_state` makes it inert).

---

## 9. Sync Protocol — Differential, Idempotent, Conflict-Aware

### 9.1 Goals

1. **Idempotent:** Re-uploading the same point with the same payload is a no-op.
2. **Differential:** Only send what changed; don't re-upload unchanged points.
3. **Batched:** Up to 100 points per request to minimize round trips.
4. **Resumable:** Mid-batch network drop resumes from the last successful point.
5. **Conflict-aware:** Detects conflicts, resolves deterministically, surfaces to UI.

### 9.2 Sync Orchestrator State Machine

```
        ┌──────────┐
        │   IDLE   │ ◄────────────────────────┐
        └────┬─────┘                          │
             │ triggerSync()                  │
             ▼                                │
        ┌──────────┐  diff computed           │
        │  DIFFING │ ───────────────────┐     │
        └────┬─────┘                    │     │
             │                          ▼     │
             ▼                  ┌──────────┐  │
        ┌──────────┐   upload   │ UPLOADING│  │
        │UPLOADING │ ◄──────────│  BATCH   │  │
        └────┬─────┘            └──────────┘  │
             │ all uploaded                   │
             ▼                                │
        ┌──────────┐                          │
        │  PULLING │                          │
        └────┬─────┘                          │
             │ has_more = false               │
             ▼                                │
        ┌──────────┐                          │
        │RESOLVING │  (conflict resolution)   │
        └────┬─────┘                          │
             │                                │
             ▼                                │
        ┌──────────┐                          │
        │ REPORTING│                          │
        └────┬─────┘                          │
             │                                │
             └────────────────────────────────┘
```

### 9.3 Diff Computation (Client Side)

```rust
pub fn compute_sync_diff(
    local: &HashMap<String, Point>,
    remote: &HashMap<String, Point>,
) -> SyncDiff {
    let mut to_upload = Vec::new();
    let mut to_download = Vec::new();
    let mut conflicts = Vec::new();

    for (id, local_point) in local {
        match remote.get(id) {
            None => to_upload.push(id.clone()),
            Some(remote_point) => {
                if local_point.payload == remote_point.payload {
                    // Same payload, same vector — no-op
                } else if local_point.vector_checksum == remote_point.vector_checksum {
                    // Same vector, different payload (e.g., metadata update)
                    to_upload.push(id.clone());
                } else {
                    // Different vector + different payload — CONFLICT
                    conflicts.push(id.clone());
                }
            }
        }
    }

    for id in remote.keys() {
        if !local.contains_key(id) {
            to_download.push(id.clone());
        }
    }

    SyncDiff { to_upload, to_download, conflicts }
}
```

### 9.4 Upload Protocol

```typescript
async function uploadBatch(batch: Point[]): Promise<UploadResult[]> {
  const BATCH_SIZE = 100;
  const results: UploadResult[] = [];

  for (let i = 0; i < batch.length; i += BATCH_SIZE) {
    const slice = batch.slice(i, i + BATCH_SIZE);
    const resp = await retryWithBackoff(() =>
      fetch(`${SYNC_API_URL}/sync/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_id: deviceId,
          batch_id: generateBatchId(),
          points: slice,
        }),
      })
    );

    if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
    const data = await resp.json();
    results.push(...data.results);
  }

  return results;
}
```

### 9.5 Pull Protocol

```typescript
async function pullUpdates(since: string | null): Promise<PullResult> {
  let cursor = since;
  const allPoints: Point[] = [];

  while (true) {
    const url = new URL(`${SYNC_API_URL}/sync/pull`);
    url.searchParams.set('device_id', deviceId);
    if (cursor) url.searchParams.set('since', cursor);
    url.searchParams.set('limit', '100');

    const resp = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${deviceToken}` },
    });

    if (!resp.ok) throw new Error(`Pull failed: ${resp.status}`);
    const data = await resp.json();

    allPoints.push(...data.points);
    cursor = data.next_cursor;

    if (!data.has_more) break;
  }

  return { points: allPoints, cursor };
}
```

### 9.6 Conflict Resolution

See Section 10 for the full algorithm. The orchestrator invokes it per conflict after both sides have been read:

```typescript
const resolved = await fieldEdge.resolveConflict(
  localPoint.payload,
  remotePoint.payload,
);

if (resolved.winner === 'local') {
  // Local wins; re-upload with merged payload
  await uploadBatch([localPoint]);
} else if (resolved.winner === 'remote') {
  // Remote wins; update local
  await fieldEdge.upsertPoints([{
    id: conflictId,
    vector: remotePoint.vector,
    payload: resolved.resolved_payload,
  }]);
} else {
  // Merged; upload merged version
  await uploadBatch([{
    id: conflictId,
    vector: pickVector(localPoint, remotePoint),
    payload: resolved.resolved_payload,
  }]);
}
```

### 9.7 Sync Report

After a complete sync run, the orchestrator emits a `SyncReport`:

```typescript
interface SyncReport {
  startedAt: Date;
  finishedAt: Date;
  uploaded: number;
  downloaded: number;
  conflicts: number;
  errors: number;
  resolutionBreakdown: {
    timestampWinner: number;   // local won by timestamp
    vectorSimWinner: number;   // local won by vector similarity
    remoteWinner: number;
    merged: number;
  };
  conflictDetails: Array<{
    pointId: string;
    localUpdatedAt: string;
    remoteUpdatedAt: string;
    resolution: string;
    fieldsChanged: string[];
  }>;
}
```

This is shown in the `SyncReportScreen` (per STORY-022).

### 9.8 Idempotency in Practice

- **Server side:** Server keeps a 24-hour rolling log of `(device_id, batch_id) → results`. A replay of the same batch_id returns the cached results.
- **Client side:** Each point has a `local_updated_at`. Re-uploading an unchanged point results in `vector_checksum` matching server, so no write happens.

### 9.9 Resumability

- Client tracks `last_synced_seq` in SQLite.
- On sync restart (after crash or network drop), only entries with `seq > last_synced_seq` are uploaded.
- Server-side idempotency ensures no duplicates if a partial batch succeeded before the drop.

---

## 10. Conflict Resolution Algorithm

### 10.1 Algorithm Overview

Three-stage tiebreaker:

1. **Timestamp:** Higher `local_updated_at` wins.
2. **Vector similarity:** If timestamps are within 1 second (effectively simultaneous), the version whose vector is more similar to other local points (i.e., more "central" in the local collection) wins.
3. **Merge:** If still tied, field-level merge.

### 10.2 Stage 1 — Timestamp Comparison

```rust
pub fn resolve_by_timestamp(
    local: &Payload,
    remote: &Payload,
) -> Resolution {
    let local_ts = parse_iso8601(&local.local_updated_at);
    let remote_ts = parse_iso8601(&remote.local_updated_at);

    if (local_ts - remote_ts).abs() > Duration::seconds(1) {
        if local_ts > remote_ts {
            Resolution::LocalWins
        } else {
            Resolution::RemoteWins
        }
    } else {
        Resolution::TieBreakByVector
    }
}
```

### 10.3 Stage 2 — Vector Similarity

If timestamps are within 1 second, compute the mean cosine similarity of each candidate vector to the 20 nearest other points in the local Edge shard. The higher mean wins.

```rust
pub fn resolve_by_vector_sim(
    local_id: &str,
    local_vector: &[f32],
    remote_vector: &[f32],
    shard: &dyn EdgeOps,
) -> Resolution {
    let local_neighbors = shard.query(&QueryRequest {
        vector: local_vector.to_vec(),
        limit: 20,
        filter: Some(Filter::must_not(FieldCondition::match_id(local_id))),
    }).unwrap_or_default();

    let remote_neighbors = shard.query(&QueryRequest {
        vector: remote_vector.to_vec(),
        limit: 20,
        filter: Some(Filter::must_not(FieldCondition::match_id(local_id))),
    }).unwrap_or_default();

    let local_mean_score: f32 = local_neighbors.iter().map(|h| h.score).sum::<f32>()
        / local_neighbors.len().max(1) as f32;

    let remote_mean_score: f32 = remote_neighbors.iter().map(|h| h.score).sum::<f32>()
        / remote_neighbors.len().max(1) as f32;

    if local_mean_score > remote_mean_score {
        Resolution::LocalWins
    } else if remote_mean_score > local_mean_score {
        Resolution::RemoteWins
    } else {
        Resolution::Merge
    }
}
```

**Intuition:** A point whose vector is more "central" in the local collection is more likely to be the canonical version. This is a heuristic but works well in practice.

### 10.4 Stage 3 — Field-Level Merge

If still tied, perform a deterministic merge:

```rust
pub fn merge_payloads(local: &Payload, remote: &Payload) -> Payload {
    let mut merged = local.clone();

    for (key, remote_value) in remote {
        match merged.get(key) {
            None => {
                merged.insert(key.clone(), remote_value.clone());
            }
            Some(local_value) => {
                if local_value != remote_value {
                    // Conflict on this field. Take the one with the more recent value's updated_at.
                    // For simplicity here: if the field is in our mutable list, use the most recent.
                    // (For fields like enrichment_tags that are server-derived, remote always wins.)
                    if is_server_owned_field(key) {
                        merged.insert(key.clone(), remote_value.clone());
                    } else {
                        // Take whichever has the higher captured_at (last resort)
                        merged.insert(key.clone(), remote_value.clone());
                    }
                }
            }
        }
    }

    merged
}
```

**Server-owned fields** (remote always wins for these):
- `enrichment_id`
- `enrichment_tags`
- `enrichment_objects`
- `enrichment_text`
- `synced_at`
- `server_version`

**Client-owned fields** (last-write-wins on tie):
- `project_id`
- `local_updated_at`

**Immutable fields** (first-write-wins; conflict is an error):
- `photo_id`
- `device_id`
- `captured_at`
- `lat`, `lng`, `gps_status`
- `vector_checksum`
- `file_path`

### 10.5 Conflict Surfacing

Every conflict is recorded in `SyncReport.conflictDetails` and visible in `SyncReportScreen`. The user sees:

- Which point had the conflict.
- Both timestamps.
- Which fields differed.
- Which version won.

For v2, we'd add a "manual override" UI; for v1, the auto-resolution is final but visible.

---

## 11. Embedding Pipeline Implementation

### 11.1 Image Preprocessing

CLIP requires:
- 224×224 RGB input.
- Normalized with mean `[0.48145466, 0.4578275, 0.40821073]`, std `[0.26862954, 0.26130258, 0.27577711]`.
- Pixel values in `[0, 1]` float32.

```typescript
async function preprocessForCLIP(uri: string): Promise Float32Array> {
  // 1. Resize to 224x224
  const resized = await ImageResizer.createResizedImage(
    uri, 224, 224, 'PNG', 100, 0, undefined, false,
    { mode: 'cover', onlyScaleDown: true }
  );

  // 2. Read pixels
  const pixels = await readPixelData(resized.uri);  // Uint8Array RGBA

  // 3. Convert to float32, normalize
  const MEAN = [0.48145466, 0.4578275, 0.40821073];
  const STD = [0.26862954, 0.26130258, 0.27577711];

  const float32 = new Float32Array(224 * 224 * 3);
  for (let i = 0; i < 224 * 224; i++) {
    const r = pixels[i * 4] / 255.0;
    const g = pixels[i * 4 + 1] / 255.0;
    const b = pixels[i * 4 + 2] / 255.0;

    float32[i * 3] = (r - MEAN[0]) / STD[0];
    float32[i * 3 + 1] = (g - MEAN[1]) / STD[1];
    float32[i * 3 + 2] = (b - MEAN[2]) / STD[2];
  }

  return float32;
}
```

### 11.2 ONNX Runtime Call (Rust Side)

```rust
use ort::{Session, Value, inputs};

pub struct EmbeddingModel {
    session: parking_lot::Mutex<Session>,
    image_input_name: String,
    text_input_name: String,
}

impl EmbeddingModel {
    pub fn load(model_path: &Path) -> Result<Self, EmbeddingError> {
        let session = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(2)?
            .commit_from_file(model_path)?;

        Ok(Self {
            session: parking_lot::Mutex::new(session),
            image_input_name: "pixel_values".to_string(),
            text_input_name: "input_ids".to_string(),
        })
    }

    pub fn embed_image(&self, image: &[f32]) -> Result<Vec<f32>, EmbeddingError> {
        let input_shape = vec![1, 3, 224, 224];
        let input_tensor = Value::from_array((
            input_shape.as_slice(),
            image.to_vec().into_boxed_slice(),
        ))?;

        let session = self.session.lock();
        let outputs = session.run(inputs![&self.image_input_name => input_tensor])?;

        let output = outputs[0].try_extract::<f32>()?;
        let vec: Vec<f32> = output.1.to_vec();

        // L2 normalize
        let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
        Ok(vec.iter().map(|x| x / norm).collect())
    }

    pub fn embed_text(&self, text: &str) -> Result<Vec<f32>, EmbeddingError> {
        // Tokenize using CLIP's BPE tokenizer (cliptokenizers crate)
        let tokens = clip_tokenizers::tokenize(text, 77);  // CLIP context length

        let input_tensor = Value::from_array((
            vec![1, 77].as_slice(),
            tokens.into_boxed_slice(),
        ))?;

        let session = self.session.lock();
        let outputs = session.run(inputs![&self.text_input_name => input_tensor])?;

        let output = outputs[0].try_extract::<f32>()?;
        let vec: Vec<f32> = output.1.to_vec();

        let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
        Ok(vec.iter().map(|x| x / norm).collect())
    }
}
```

### 11.3 Embedding Caching

- The model session is loaded once and kept in a `Mutex<Session>` for the app's lifetime.
- First inference is slow (~500 ms); subsequent are fast (~250 ms).
- A dummy "warmup" inference is run on first capture to avoid the cold-start hit on user-facing operations.

### 11.4 Memory Budget

- ONNX Runtime session: ~120 MB resident.
- Model weights: ~63 MB.
- Working memory per inference: ~10 MB peak.
- Total: ~200 MB. Acceptable on devices with ≥4 GB RAM.

For low-memory devices (<3 GB), we lazy-load the model only on first capture and unload after 5 minutes of inactivity.

---

## 12. Caching Strategy

### 12.1 Caches by Layer

| Cache | Where | TTL | Invalidation |
|---|---|---|---|
| Embedding model session | RAM | App lifetime | App restart |
| Local Edge shard | Disk | Until `optimize()` | n/a |
| WAL | Disk | 7 days post-sync | Rotation |
| Search results | RAM (Zustand) | Per query | New query |
| Project list | MMKV | Until changed | User edits |
| Sync cursors | SQLite | Until next sync | New sync |
| Photo thumbnails | Disk cache | Until photo deleted | Photo delete |

### 12.2 Embedding Cache (Why Not)

We do NOT cache embeddings — they're already cheap to recompute and storing them separately from the shard would create two sources of truth. The shard IS the embedding store.

### 12.3 Thumbnail Cache

Photo thumbnails are generated on-demand and cached:

```typescript
async function getThumbnail(photoId: string, size: number): Promise<string> {
  const cacheKey = `thumb_${photoId}_${size}`;
  const cached = await FileSystem.readAsStringAsync(`${cacheDir}/${cacheKey}`, {
    encoding: 'base64',
  }).catch(() => null);

  if (cached) return cached;

  const thumb = await generateThumbnail(photoId, size);
  await FileSystem.writeAsStringAsync(`${cacheDir}/${cacheKey}`, thumb, {
    encoding: 'base64',
  });
  return thumb;
}
```

Generated using `react-native-image-resizer` to 256×256 for grid display.

### 12.4 HTTP Response Cache

The sync API sets `Cache-Control: no-store` to ensure fresh data. The client does not cache HTTP responses.

---

## 13. Error Handling, Retries, Observability

### 13.1 Error Categories

| Category | Examples | Handling |
|---|---|---|
| `UserError` | Permission denied, no storage | Show UI, no retry |
| `NetworkError` | DNS, timeout, 5xx | Retry with backoff |
| `ValidationError` | Bad payload, schema mismatch | Log, surface to UI, don't retry |
| `InternalError` | Rust panic, ONNX init failure | Log with stack, graceful degrade |
| `ConflictError` | Conflict detected | Handled by sync orchestrator |
| `AuthError` | Token expired, 401 | Re-auth, retry once |

### 13.2 Retry Policy

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number } = {
    maxAttempts: 5,
    baseDelayMs: 500,
    maxDelayMs: 30000,
  }
): Promise<T> {
  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === options.maxAttempts - 1) throw err;
      if (!isRetryable(err)) throw err;

      const delay = Math.min(
        options.baseDelayMs * Math.pow(2, attempt) + Math.random() * 100,
        options.maxDelayMs
      );
      await sleep(delay);
    }
  }
  throw new Error('Unreachable');
}
```

- `isRetryable`: returns true for `NetworkError`, `InternalError`, 5xx responses.
- Returns false for `ValidationError`, `AuthError`, 4xx responses (except 429).

### 13.3 Retry-After Handling

For `429 Too Many Requests`, parse the `Retry-After` header and wait that long:

```typescript
if (resp.status === 429) {
  const retryAfter = parseInt(resp.headers.get('Retry-After') ?? '5');
  await sleep(retryAfter * 1000);
  // ... retry
}
```

### 13.4 Logging

**Client side (pino):**
```typescript
import pino from 'pino';
const logger = pino({
  level: 'info',
  transport: {
    target: 'react-native-file-logger',
    options: { path: '/logs/app.log' },
  },
});

logger.info({ pointId, durationMs }, 'capture.complete');
logger.error({ err }, 'embedding.failed');
```

**Server side (loguru):**
```python
from loguru import logger

logger.add("logs/sync-api.log", rotation="100 MB", retention="7 days")
logger.info("upload.received device_id={} batch_size={}", device_id, len(points))
logger.error("qdrant.unreachable error={}", e)
```

### 13.5 Crash Recovery

- App writes a heartbeat to MMKV every 30 sec.
- On launch, if last heartbeat > 5 min ago, the app marks itself as "recovered from potential crash" and replays the WAL aggressively.
- Crash reports (Sentry or Bugsnag) for unhandled exceptions. (Stretch — not v1.)

---

## 14. Code Examples — End-to-End Flows

### 14.1 Capture Flow (TypeScript)

```typescript
// src/hooks/useCaptureFlow.ts
import { useCallback } from 'react';
import { useEmbedding } from './useEmbedding';
import { fieldEdge } from '@field-edge/react-native';
import { writeWal, markSynced } from '@/services/wal';
import { savePhoto, extractGps } from '@/services/photos';

export function useCaptureFlow() {
  const embedding = useEmbedding();

  return useCallback(async (uri: string, projectId: string) => {
    const photoId = ulid();
    const capturedAt = new Date().toISOString();
    const gps = await extractGps(uri);
    const filePath = `${projectId}/${deviceId}/${photoId}.jpg`;

    // 1. Save photo to local FS
    await savePhoto(uri, filePath);

    // 2. Generate embedding
    const vector = embedding
      ? await embedding.embedImage(uri)
      : new Array(512).fill(0); // placeholder if embedding failed

    // 3. Build payload
    const payload = {
      schema_version: 1,
      photo_id: photoId,
      device_id: deviceId,
      captured_at: capturedAt,
      lat: gps?.lat ?? null,
      lng: gps?.lng ?? null,
      gps_status: gps ? 'ok' : 'unavailable',
      project_id: projectId,
      file_path: filePath,
      embedding_status: embedding ? 'ok' : 'failed',
      local_updated_at: new Date().toISOString(),
      vector_checksum: computeChecksum(vector),
    };

    // 4. Write WAL entry
    await writeWal({
      op: 'UPSERT',
      seq: nextWalSeq(),
      point_id: photoId,
      vector: Array.from(vector),
      payload,
      ts: capturedAt,
    });

    // 5. Upsert to local Edge shard
    await fieldEdge.upsertPoints([
      { id: photoId, vector: Array.from(vector), payload },
    ]);

    return photoId;
  }, [embedding]);
}
```

### 14.2 Search Flow (TypeScript)

```typescript
// src/hooks/useSearch.ts
import { useCallback, useState } from 'react';
import { useEmbedding } from './useEmbedding';
import { fieldEdge } from '@field-edge/react-native';
import { useSearchStore } from '@/stores/searchStore';

export function useSearch() {
  const embedding = useEmbedding();
  const { setResults, setLoading } = useSearchStore();

  return useCallback(async (query: string, filters: SearchFilters) => {
    if (!embedding || !query.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const queryVec = await embedding.embedText(query);

      const filterParts: any[] = [];
      if (filters.projectIds.length > 0) {
        filterParts.push({
          type: 'or',
          children: filters.projectIds.map(id => ({
            type: 'match', key: 'project_id', value: id,
          })),
        });
      }
      if (filters.dateFrom || filters.dateTo) {
        filterParts.push({
          type: 'range',
          key: 'captured_at',
          gte: filters.dateFrom?.getTime(),
          lte: filters.dateTo?.getTime(),
        });
      }

      const hits = await fieldEdge.query({
        vector: Array.from(queryVec),
        limit: 20,
        filter: filterParts.length > 0
          ? { type: 'and', children: filterParts }
          : undefined,
        withPayload: true,
        withVector: false,
      });

      setResults(hits);
    } finally {
      setLoading(false);
    }
  }, [embedding, setResults, setLoading]);
}
```

### 14.3 Sync Orchestrator (TypeScript)

```typescript
// src/services/sync.ts
import { fieldEdge } from '@field-edge/react-native';
import { deviceId, deviceToken } from '@/services/auth';
import { SYNC_API_URL } from '@/constants';
import { readWalPending, markWalSynced } from '@/services/wal';
import { setSyncReport } from '@/stores/syncStore';

export async function runSync(): Promise<SyncReport> {
  const startedAt = new Date();
  const report: SyncReport = {
    startedAt,
    finishedAt: startedAt,
    uploaded: 0,
    downloaded: 0,
    conflicts: 0,
    errors: 0,
    resolutionBreakdown: { timestampWinner: 0, vectorSimWinner: 0, remoteWinner: 0, merged: 0 },
    conflictDetails: [],
  };

  try {
    // 1. Read pending WAL entries
    const pending = await readWalPending();

    // 2. Diff against server
    const remoteState = await fetchRemoteSnapshot();
    const diff = await fieldEdge.computeSyncDiff(
      JSON.stringify(localToMap(pending)),
      remoteState,
    );

    // 3. Upload local-only + conflicted-as-local
    if (diff.to_upload.length > 0) {
      const pointsToUpload = pending.filter(p => diff.to_upload.includes(p.id));
      const results = await uploadBatch(pointsToUpload);
      for (const r of results) {
        if (r.status === 'accepted') {
          report.uploaded++;
          await markWalSynced(r.id);
        } else if (r.status === 'conflict_resolved') {
          report.conflicts++;
          // Track in breakdown
        }
      }
    }

    // 4. Pull server updates
    const pull = await pullUpdates(getLastSyncCursor());
    for (const p of pull.points) {
      await fieldEdge.upsertPoints([{ id: p.id, vector: p.vector, payload: p.payload }]);
      report.downloaded++;
    }
    setLastSyncCursor(pull.cursor);

    // 5. Resolve conflicts (if any flagged for resolution)
    // ... (Section 10 algorithm)

    return report;
  } catch (err) {
    report.errors++;
    throw err;
  } finally {
    report.finishedAt = new Date();
    setSyncReport(report);
  }
}
```

### 14.4 Server Upload Handler (Python)

```python
# app/routers/sync.py
from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
from app.models.point import Point, UploadRequest, UploadResponse, PointResult
from app.services.qdrant import central_qdrant
from app.services.cursor import encode_cursor, decode_cursor
from app.auth import verify_device_token
import time

router = APIRouter(prefix="/sync", tags=["sync"])

@router.post("/upload", response_model=UploadResponse)
async def upload_points(
    req: UploadRequest,
    device_id: str = Depends(verify_device_token),
):
    if len(req.points) > 100:
        raise HTTPException(status_code=413, detail="Batch too large")

    results = []
    for point in req.points:
        try:
            # Check for existing point
            existing = central_qdrant.retrieve(
                collection_name="field_edge_central",
                ids=[point.id],
            )

            if not existing:
                # New point — write
                central_qdrant.upsert(
                    collection_name="field_edge_central",
                    points=[point.to_qdrant_point()],
                )
                results.append(PointResult(id=point.id, status="accepted", server_version=1))

            elif existing[0].payload == point.payload:
                # No change — idempotent no-op
                results.append(PointResult(id=point.id, status="accepted", server_version=existing[0].payload.get("server_version", 1)))

            else:
                # Conflict — resolve
                resolution = resolve_conflict(existing[0].payload, point.payload)
                central_qdrant.upsert(
                    collection_name="field_edge_central",
                    points=[resolution.to_qdrant_point()],
                )
                results.append(PointResult(
                    id=point.id,
                    status="conflict_resolved",
                    resolution=resolution.winner,
                    resolved_payload=resolution.payload,
                ))

        except ValidationError as e:
            results.append(PointResult(
                id=point.id, status="rejected_invalid_payload",
                error_message=str(e),
            ))

    return UploadResponse(
        batch_id=req.batch_id,
        server_time=datetime.utcnow().isoformat() + "Z",
        results=results,
        next_cursor=encode_cursor(datetime.utcnow(), results[-1].id if results else ""),
    )
```

---

**End of Backend & DB Implementation Doc. Next: System Architecture (04).**
