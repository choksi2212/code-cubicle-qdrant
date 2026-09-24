# System Architecture — FieldEdge Edge Component

**Document version:** 1.0
**Last updated:** 2025-09-23
**Owner:** Manas Choksi
**Companion to:** [01-PRD.md](01-PRD.md), [02-TRD.md](02-TRD.md), [03-Backend-DB-Implementation.md](03-Backend-DB-Implementation.md)

---

## Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [Architecture Layers](#2-architecture-layers)
3. [Component Diagrams](#3-component-diagrams)
4. [Data Flow Diagrams](#4-data-flow-diagrams)
5. [Sequence Diagrams](#5-sequence-diagrams)
6. [Edge Device Architecture (Deep Dive)](#6-edge-device-architecture-deep-dive)
7. [Sync Mechanism Deep Dive](#7-sync-mechanism-deep-dive)
8. [Conflict Resolution Algorithm — Visual](#8-conflict-resolution-algorithm--visual)
9. [Network Topology](#9-network-topology)
10. [Deployment Architecture](#10-deployment-architecture)
11. [Scalability Considerations](#11-scalability-considerations)
12. [Disaster Recovery](#12-disaster-recovery)
13. [Performance Architecture](#13-performance-architecture)
14. [Future Roadmap](#14-future-roadmap)

---

## 1. High-Level Overview

### 1.1 Product in One Picture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           FIELD WORKER'S PHONE                           │
│                                                                          │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐   ┌─────────────┐ │
│  │   React     │   │    Rust      │   │    ONNX      │   │  Qdrant     │ │
│  │   Native    │──▶│   Bridge     │──▶│   Runtime    │   │  Edge       │ │
│  │   (UI)      │   │ (UniFFI)     │   │  (CLIP int8) │   │  (shard)    │ │
│  └──────┬──────┘   └──────────────┘   └──────────────┘   └──────┬──────┘ │
│         │                                                       │        │
│         │              ┌──────────────────────┐                 │        │
│         └─────────────▶│   Sync Orchestrator  │◀────────────────┘        │
│                        │   (TypeScript)       │                          │
│                        └──────────┬───────────┘                          │
│                                   │                                      │
│                        ┌──────────▼───────────┐                          │
│                        │  Write-Ahead Log     │                          │
│                        │  + SQLite Metadata   │                          │
│                        └──────────────────────┘                          │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │
                          ◀── sync (when online) ──▶
                                      │
┌─────────────────────────────────────▼────────────────────────────────────┐
│                              CLOUD                                        │
│                                                                          │
│  ┌────────────────────┐    ┌────────────────────┐    ┌────────────────┐  │
│  │    Sync API        │───▶│   Qdrant Cloud     │◀──▶│  enrichment    │  │
│  │    (FastAPI)       │    │   (central shard)  │    │  (AI tagging)  │  │
│  └─────────┬──────────┘    └────────────────────┘    └────────┬───────┘  │
│            │                                                  │          │
│            ▼                                                  ▼          │
│  ┌────────────────────┐                           ┌────────────────┐    │
│  │   Audit Log        │                           │   Next.js      │    │
│  │   (SQLite)         │                           │   Dashboard    │    │
│  └────────────────────┘                           │   (Mihir's)    │    │
│                                                   └────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Architectural Style

- **Offline-first.** The edge device is the source of truth; cloud is the broadcast.
- **Polyglot persistence.** Qdrant (vectors), SQLite (metadata), filesystem (photos), MMKV (settings) — each chosen for what it does best.
- **Eventual consistency.** Cloud converges to edge state through idempotent, conflict-aware sync.
- **Bridge pattern for native interop.** RN ↔ Rust ↔ Qdrant Edge via UniFFI-generated bindings.

### 1.3 Quality Attributes (Prioritized)

| Attribute | Priority | How Achieved |
|---|---|---|
| Offline capability | Critical | All inference + storage on-device; sync is best-effort |
| Durability | Critical | WAL + idempotent sync + recoverable crash state |
| Reproducibility | High | Lockfiles, vendored models, deterministic seed data |
| Performance | High | ONNX int8, scalar quantization, async I/O |
| Privacy | High | Nothing leaves device without explicit sync |
| Extensibility | Medium | Trait-based edge adapter, pluggable sync API |
| Testability | Medium | Test pyramid (unit → integration → E2E) |

---

## 2. Architecture Layers

### 2.1 Layer Cake

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Layer 6: PRESENTATION                                                  │
│    React Native screens, navigation, theme                              │
├─────────────────────────────────────────────────────────────────────────┤
│  Layer 5: APPLICATION SERVICES                                          │
│    Sync orchestrator, capture flow, search service, settings mgmt       │
├─────────────────────────────────────────────────────────────────────────┤
│  Layer 4: DOMAIN MODELS                                                 │
│    Photo, Point, Project, SyncReport, ConflictResolution                │
├─────────────────────────────────────────────────────────────────────────┤
│  Layer 3: ADAPTERS / PORTS                                              │
│    StorageAdapter (Edge shard), EmbeddingAdapter (ONNX),                │
│    NetworkAdapter (HTTP), FileSystemAdapter (FS)                        │
├─────────────────────────────────────────────────────────────────────────┤
│  Layer 2: NATIVE BRIDGE                                                 │
│    UniFFI bindings, TurboModules, ONNX Runtime C API                    │
├─────────────────────────────────────────────────────────────────────────┤
│  Layer 1: SYSTEM                                                        │
│    OS APIs: Camera, GPS, Network, FileSystem, Keychain                  │
└─────────────────────────────────────────────────────────────────────────┘
```

Each layer depends only on the layer below it. The Domain Models layer has zero dependencies on infrastructure (the dependency rule).

### 2.2 Layer Responsibilities

**Layer 6 — Presentation:**
- Render screens.
- Handle user input.
- Display state via Zustand subscriptions.
- No business logic beyond UI concerns.

**Layer 5 — Application Services:**
- Orchestrate multi-step workflows (capture → embed → store; search → query → render).
- Coordinate adapters.
- Enforce invariants (e.g., "cannot search with no photos").

**Layer 4 — Domain Models:**
- Type definitions for business entities.
- Validation logic (schema checks, invariant enforcement).
- Pure functions for domain operations (e.g., `mergePayloads(a, b)`).

**Layer 3 — Adapters:**
- Implement the ports (interfaces) defined by domain models.
- Translate between domain types and external system types.
- Handle errors from external systems.

**Layer 2 — Native Bridge:**
- FFI declarations and JSI bindings.
- Memory management for cross-boundary allocations.
- Type marshaling.

**Layer 1 — System:**
- Platform APIs (iOS/Android/Node.js).

### 2.3 Cross-Cutting Concerns

- **Logging:** Crosses all layers; configured once at app entry, used everywhere via injected logger.
- **Error handling:** Each layer translates errors to its own type; bubbles up to a unified `AppError` at the boundary.
- **Auth:** Token is fetched at app start, injected via context, used by NetworkAdapter.

---

## 3. Component Diagrams

### 3.1 Mobile App Components

```
┌─────────────────────────────────────────────────────────────────┐
│                          Mobile App                              │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Capture     │  │  Search      │  │  Sync        │           │
│  │  Screen      │  │  Screen      │  │  Report      │           │
│  │              │  │              │  │  Screen      │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Capture     │  │  Search      │  │  Sync        │           │
│  │  Hook        │  │  Hook        │  │  Service     │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌──────────────────────────────────────────────────┐           │
│  │          Embedding Model (ONNX)                  │           │
│  └──────────────────────┬───────────────────────────┘           │
│                         │                                           │
│  ┌──────────────────────▼───────────────────────────┐           │
│  │       Rust Bridge (TurboModule)                  │           │
│  │  - fieldEdge.open()                              │           │
│  │  - fieldEdge.upsertPoints()                      │           │
│  │  - fieldEdge.query()                             │           │
│  │  - fieldEdge.computeSyncDiff()                   │           │
│  │  - fieldEdge.resolveConflict()                   │           │
│  └──────────────────────┬───────────────────────────┘           │
│                         │                                           │
│         ┌───────────────┼───────────────┐                         │
│         ▼               ▼               ▼                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                  │
│  │ Edge Shard  │ │     WAL     │ │  Metadata   │                  │
│  │ (vectors)   │ │  (log)      │ │  (SQLite)   │                  │
│  └─────────────┘ └─────────────┘ └─────────────┘                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Rust Core Components

```
┌─────────────────────────────────────────────────────────────────┐
│                      Rust Core Crate                            │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  FFI Layer (UniFFI)                      │    │
│  │  edge_create, edge_load, edge_upsert_points, ...        │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                        │                                        │
│  ┌─────────────────────▼───────────────────────────────────┐    │
│  │              Edge Adapter Layer                         │    │
│  │   ┌──────────────────┐    ┌──────────────────┐          │    │
│  │   │  QdrantEdge      │    │  QdrantClient    │          │    │
│  │   │  Adapter         │    │  Adapter (fallback)         │    │
│  │   └────────┬─────────┘    └────────┬─────────┘          │    │
│  │            │           trait EdgeOps                    │    │
│  │            └────────────┬────────────┘                  │    │
│  └─────────────────────────┼────────────────────────────────┘    │
│                            │                                     │
│  ┌─────────────────────────▼────────────────────────────────┐    │
│  │              Sync Layer                                 │    │
│  │   diff.rs, cursor.rs, report.rs                         │    │
│  └─────────────────────────┬────────────────────────────────┘    │
│                            │                                     │
│  ┌─────────────────────────▼────────────────────────────────┐    │
│  │           Conflict Resolution Layer                     │    │
│  │   detect.rs, resolve.rs, merge.rs                       │    │
│  └─────────────────────────┬────────────────────────────────┘    │
│                            │                                     │
│  ┌─────────────────────────▼────────────────────────────────┐    │
│  │              WAL Layer                                  │    │
│  │   log.rs, replay.rs                                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Sync API Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    Sync API (FastAPI)                           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                HTTP Layer (routers/)                    │    │
│  │   sync.py, wal.py, heartbeat.py                         │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                        │                                        │
│  ┌─────────────────────▼───────────────────────────────────┐    │
│  │             Service Layer                                │    │
│  │   ┌──────────┐  ┌──────────┐  ┌──────────┐              │    │
│  │   │ Qdrant   │  │ Cursor   │  │ Audit    │              │    │
│  │   │ Service  │  │ Service  │  │ Service  │              │    │
│  │   └──────────┘  └──────────┘  └──────────┘              │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                        │                                        │
│  ┌─────────────────────▼───────────────────────────────────┐    │
│  │             Domain Models (Pydantic)                     │    │
│  │   Point, UploadRequest, UploadResponse, ...             │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                        │                                        │
│  ┌─────────────────────▼───────────────────────────────────┐    │
│  │             Cross-Cutting                               │    │
│  │   auth.py, deps.py, config.py, logging.py               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Data Flow Diagrams

### 4.1 DFD Level 0 — Context

```
                ┌────────────────┐
   Photos ────▶  │                │ ────▶ Synced photos
   Queries ────▶ │    FieldEdge   │ ────▶ Search results
   Sync taps ──▶ │                │ ────▶ Sync reports
                │                │ ────▶ Cloud photos + tags
                └────────────────┘
```

### 4.2 DFD Level 1 — Major Processes

```
                 Photos                              Sync Report
                   │                                    ▲
                   ▼                                    │
            ┌─────────────┐                       ┌─────┴──────┐
            │  P1: Capture│                       │ P5: Report │
            └──────┬──────┘                       └─────▲──────┘
                   │                                    │
                   ▼                                    │
            ┌─────────────┐    Embeddings      ┌────────┴────────┐
            │  P2: Embed  │ ◀────────────────▶ │ P4: Sync        │
            └──────┬──────┘                    └────────▲────────┘
                   │                                    │
                   ▼                                    │
            ┌─────────────┐   Vectors    ┌──────────────┴────────┐
            │  P3: Store  │ ───────────▶ │ Central Qdrant        │
            └─────────────┘             └───────────────────────┘
                       │
                       ▼
                 Local Edge Shard
```

### 4.3 DFD Level 2 — P1 Capture Detail

```
Camera      ┌─────────────────┐     GPS       ┌──────────────┐
  ────────▶ │  Shutter event  │ ◀──────────── │ GPS Service  │
            └────────┬────────┘              └──────────────┘
                     │
                     ▼
            ┌─────────────────┐
            │ P1.1: Save photo│ ──▶ Local FS
            └────────┬────────┘
                     │
                     ▼
            ┌─────────────────┐
            │ P1.2: Extract   │ ──▶ Metadata
            │       metadata  │
            └────────┬────────┘
                     │
                     ▼
            ┌─────────────────┐
            │ P1.3: Generate  │ ──▶ Embedding
            │       embedding │
            └────────┬────────┘
                     │
                     ▼
            ┌─────────────────┐
            │ P1.4: Build     │ ──▶ Payload
            │       payload   │
            └────────┬────────┘
                     │
                     ▼
            ┌─────────────────┐
            │ P1.5: WAL write │ ──▶ WAL
            └────────┬────────┘
                     │
                     ▼
            ┌─────────────────┐
            │ P1.6: Shard     │ ──▶ Edge Shard
            │       upsert    │
            └────────┬────────┘
                     │
                     ▼
                "Saved" toast
```

---

## 5. Sequence Diagrams

### 5.1 Offline Capture and Search

```
User          App (RN)        Native Bridge    Rust Core       ONNX Runtime    Edge Shard
 │                │                │               │                 │              │
 │  Tap shutter   │                │               │                 │              │
 │ ──────────────▶│                │               │                 │              │
 │                │ resize+norm    │               │                 │              │
 │                │ ────┐          │               │                 │              │
 │                │     ▼          │               │                 │              │
 │                │ 224x224 PNG    │               │                 │              │
 │                │ ◀───┘          │               │                 │              │
 │                │                │               │                 │              │
 │                │ embedImage(uri)│               │                 │              │
 │                │ ──────────────▶│               │                 │              │
 │                │                │ embed_image() │                 │              │
 │                │                │ ─────────────▶│                 │              │
 │                │                │               │  pixel_values   │              │
 │                │                │               │ ────────────────▶              │
 │                │                │               │                 │              │
 │                │                │               │  embeddings[512] │              │
 │                │                │               │ ◀────────────────              │
 │                │                │  Vec<f32>     │                 │              │
 │                │                │ ◀─────────────│                 │              │
 │                │ ◀ Float32Array │               │                 │              │
 │                │                │               │                 │              │
 │                │ upsertPoints() │               │                 │              │
 │                │ ──────────────▶│               │                 │              │
 │                │                │ WAL.append    │                 │              │
 │                │                │ ─────────────▶│                 │              │
 │                │                │ fsync         │                 │              │
 │                │                │ ─────────────▶│                 │              │
 │                │                │ shard.upsert  │                 │              │
 │                │                │ ─────────────▶│                 │              │
 │                │                │               │ EdgeShard.update()             │
 │                │                │               │ ──────────────────────────────▶│
 │                │                │               │                 │              │
 │                │ ◀──── OK ──────│               │                 │              │
 │  "Saved" toast │                │               │                 │              │
 │ ◀──────────────│                │               │                 │              │
 │                │                │               │                 │              │
 │ (later)        │                │               │                 │              │
 │                │                │               │                 │              │
 │  Type query    │                │               │                 │              │
 │ ──────────────▶│                │               │                 │              │
 │                │ embedText(q)   │               │                 │              │
 │                │ ──────────────▶│               │                 │              │
 │                │                │ embed_text()  │                 │              │
 │                │                │ ─────────────▶│                 │              │
 │                │                │               │ input_ids       │              │
 │                │                │               │ ────────────────▶              │
 │                │                │               │ ◀──── text_emb  │              │
 │                │                │ ◀── Vec<f32>  │                 │              │
 │                │ ◀ Float32Array │               │                 │              │
 │                │                │               │                 │              │
 │                │ query(vec, 20) │               │                 │              │
 │                │ ──────────────▶│               │                 │              │
 │                │                │ shard.query   │                 │              │
 │                │                │ ─────────────▶│                 │              │
 │                │                │               │ EdgeShard.query()             │
 │                │                │               │ ──────────────────────────────▶│
 │                │                │               │                 │  ScoredPoints│
 │                │                │               │ ◀──────────────────────────────│
 │                │                │ ◀── Vec<Hit>  │                 │              │
 │                │ ◀ QueryHit[]   │               │                 │              │
 │  Results grid  │                │               │                 │              │
 │ ◀──────────────│                │               │                 │              │
```

### 5.2 Online Sync (Upload + Pull)

```
Device (RN)              Sync API            Central Qdrant       enrichment
   │                       │                       │                   │
   │  POST /sync/upload    │                       │                   │
   │  (points + payload)   │                       │                   │
   │ ─────────────────────▶│                       │                   │
   │                       │ for each point:        │                   │
   │                       │ check existing        │                   │
   │                       │ ─────────────────────▶│                   │
   │                       │                       │ retrieve by id    │
   │                       │ ◀─────────────────────│                   │
   │                       │ upsert new/conflict   │                   │
   │                       │ ─────────────────────▶│                   │
   │                       │                       │                   │
   │                       │ trigger enrichment    │                   │
   │                       │ ─────────────────────────────────────────▶│
   │                       │                       │   upload + tag    │
   │                       │ ◀─────────────────────────────────────────│
   │                       │ write tags to payload │                   │
   │                       │ ─────────────────────▶│                   │
   │ 200 OK + acks         │                       │                   │
   │ ◀─────────────────────│                       │                   │
   │                       │                       │                   │
   │  GET /sync/pull       │                       │                   │
   │  ?since=cursor        │                       │                   │
   │ ─────────────────────▶│                       │                   │
   │                       │ scroll qdrant         │                   │
   │                       │ ─────────────────────▶│                   │
   │                       │ ◀───── points ────────│                   │
   │                       │ (includes enrichment  │                   │
   │                       │  tags from prior batch)                  │
   │ 200 OK + points       │                       │                   │
   │ ◀─────────────────────│                       │                   │
   │                       │                       │                   │
   │ upsert to local shard │                       │                   │
   │ (with enrichments)    │                       │                   │
```

### 5.3 Conflict Detection and Resolution

```
Device A     Sync API    Central Qdrant    Device B
   │             │             │              │
   │             │             │              │  upsert point X
   │             │             │              │  (vector A, payload A)
   │             │             │              │  WAL entry
   │             │             │              │
   │  upload X   │             │              │
   │ ───────────▶│             │              │
   │             │ upsert A    │              │
   │             │ ───────────▶│              │
   │             │             │  store A     │
   │             │             │              │
   │             │ ◀── OK ─────│              │
   │ ◀── ACK ────│             │              │
   │             │             │              │
   │             │             │              │  upload X
   │             │             │              │ ─────────────▶│
   │             │             │ retrieve A   │              │
   │             │             │ ◀────────────│              │
   │             │             │ existing = A │              │
   │             │             │ incoming = B │              │
   │             │             │ different!   │              │
   │             │             │              │
   │             │             │ ts(A) vs ts(B)              │
   │             │             │ - if diff > 1s: newer wins  │
   │             │             │ - if within 1s: vector sim  │
   │             │             │ - if still tie: merge       │
   │             │             │              │
   │             │             │ write winner │              │
   │             │             │ ───────────▶ │              │
   │             │             │              │              │
   │             │ ◀─ ACK ─────│              │              │
   │             │             │              │ ◀─ ACK ──────│
   │             │             │              │              │
   │  GET /sync/pull          │              │              │
   │ ─────────────────────────▶              │              │
   │             │ retrieve X  │              │              │
   │             │ ◀───────────│              │              │
   │ ◀── winner +│             │              │              │
   │   conflict  │             │              │              │
   │   report    │             │              │              │
   │             │             │              │              │
   │ local shard │             │              │              │
   │ updated to  │             │              │              │
   │ match winner│             │              │              │
```

### 5.4 App Cold Start with WAL Replay

```
App Launch
    │
    ▼
[Bootstrap] ─── Load MMKV settings, device_id, device_token
    │
    ▼
[Open Edge Shard]
    │
    ├──▶ if shard dir exists: EdgeShard.load()
    │        │
    │        ▼
    │   [Read WAL]
    │        │
    │        ├──▶ if entries: replay (upsert each into shard)
    │        │
    │        ▼
    │   [Rotate if > 10MB]
    │
    ▼
[Load ONNX Model] ─── First launch only; cache session
    │
    ▼
[Warmup Inference] ─── Dummy inference to compile graph cache
    │
    ▼
[UI Render]
```

### 5.5 Sync Background Trigger

```
NetInfo                Sync Orchestrator          API
   │                          │                    │
   │ connectivity change      │                    │
   │ ────────────────────────▶│                    │
   │                          │ check conditions:  │
   │                          │  - Wi-Fi only?     │
   │                          │  - battery ≥ 30%?  │
   │                          │  - foreground?     │
   │                          │  - auto-sync on?   │
   │                          │                    │
   │                          │ all met?           │
   │                          │ ───┐               │
   │                          │    ▼               │
   │                          │ triggerSync()      │
   │                          │ ─────────────────▶│
   │                          │                    │
```

---

## 6. Edge Device Architecture (Deep Dive)

### 6.1 Process Layout

A single RN process runs three logical subsystems:

```
┌────────────────────────────────────────────────────────────────────┐
│  React Native Process (PID = 1 user-visible)                      │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  JavaScript Thread (Hermes engine)                          │   │
│  │  - React reconciler                                          │   │
│  │  - Zustand stores                                           │   │
│  │  - Sync orchestrator                                         │   │
│  │  - Service layer (services/*)                              │   │
│  └────────────────────┬────────────────────────────────────────┘   │
│                       │ JSI calls (synchronous, low overhead)      │
│  ┌────────────────────▼────────────────────────────────────────┐   │
│  │  Native Modules Thread                                       │   │
│  │  - FieldEdge TurboModule (Rust bridge)                      │   │
│  │  - Embedding TurboModule (ONNX Runtime)                     │   │
│  │  - Camera, GPS, FileSystem, Keychain, MMKV (RN built-ins)  │   │
│  └────────────────────┬────────────────────────────────────────┘   │
│                       │ FFI calls                                 │
│  ┌────────────────────▼────────────────────────────────────────┐   │
│  │  Native Libraries (linked into the app binary)             │   │
│  │  - libfield_edge_rust.a (static)                            │   │
│  │  - libonnxruntime.a (static)                               │   │
│  │  - libqdrant_edge.dylib (linked via UniFFI)                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 6.2 Thread Model

| Thread | Used For | Owner |
|---|---|---|
| JS thread | React rendering, business logic | Hermes |
| UI thread (native) | Native UI updates, gesture handling | OS |
| Shadow queue (native) | Layout calculations | OS |
| Rust worker pool | Edge shard operations, ONNX inference | `tokio` runtime inside Rust |
| Network thread | HTTP requests | `fetch` polyfill (RN) |
| File system thread | Photo save/load | `expo-file-system` worker |

The Rust runtime is initialized on the first TurboModule call and lives for the process lifetime. Default: 4 worker threads + 1 main thread.

### 6.3 Memory Layout

| Component | Resident | Peak |
|---|---|---|
| JS heap | ~30 MB | ~80 MB |
| RN runtime | ~40 MB | ~60 MB |
| Edge shard (5k vectors, int8) | ~30 MB | ~30 MB |
| ONNX Runtime session | ~120 MB | ~200 MB (during inference) |
| Rust runtime | ~10 MB | ~20 MB |
| WAL (10 MB max) | ~10 MB | ~10 MB |
| Photo cache | varies | ~50 MB |
| **Total** | **~240 MB** | **~450 MB** |

### 6.4 Storage Layout

```
<App Documents>/
├── edge-shard/                  # Qdrant Edge shard directory
│   ├── segments/                # Vector segments
│   ├── payload/                 # Payload data
│   ├── wal                      # Edge's internal WAL
│   └── config.json              # EdgeConfig
├── wal.log                      # Our app-level WAL
├── wal.<ts>.rotated             # Rotated WAL files
├── metadata.sqlite              # Project, photo metadata, sync state
├── device_token                 # Sync API token (plaintext; small risk)
├── settings.mmkv                # User preferences
├── photos/
│   ├── <project_id>/
│   │   ├── <device_id>/
│   │   │   ├── <photo_id_1>.jpg
│   │   │   ├── <photo_id_2>.jpg
│   │   │   └── ...
├── thumbs/
│   ├── <photo_id>_256.jpg
│   └── ...
└── logs/
    └── app.log                  # Pino logs
```

### 6.5 App Lifecycle Hooks

| Event | Handler |
|---|---|
| `AppRegistry.registerComponent` | Initialize Rust runtime |
| `applicationDidFinishLaunching` (iOS) / `onCreate` (Android) | Load MMKV, load ONNX model |
| `AppState change → background` | Flush WAL, pause sync |
| `AppState change → foreground` | Resume sync if conditions met |
| `applicationWillTerminate` | Best-effort WAL flush; no guarantee on iOS |

---

## 7. Sync Mechanism Deep Dive

### 7.1 Sync Triggers

| Trigger | Conditions | Priority |
|---|---|---|
| User taps "Sync now" | Always | Manual |
| App foreground + auto-sync on | Wi-Fi + battery ≥ 30% + Wi-Fi-only setting honored | High |
| Periodic timer (every 15 min) | Same as foreground | Low |
| New connectivity detected | Same as foreground | Medium |

### 7.2 Sync Phases

1. **DIFFING** — Compute local vs. server diff (Section 9.3 of Backend doc).
2. **UPLOADING** — Send `to_upload` in batches of 100.
3. **PULLING** — Get `next_cursor`-based updates until `has_more = false`.
4. **RESOLVING** — For each conflict, run resolution algorithm (Section 10 of Backend doc).
5. **REPORTING** — Emit SyncReport to UI.

### 7.3 Concurrency Model

- One sync run at a time per device.
- Multiple devices can sync concurrently (server is stateless).
- Within a sync run, uploads and pulls happen sequentially (deterministic state transitions).

### 7.4 Sync State Persistence

| State | Where | Used For |
|---|---|---|
| Last sync cursor | SQLite | Resume after restart |
| Last sync report | MMKV | Show in UI |
| Pending WAL entries | WAL file | Track unsynced writes |
| Per-point sync state | SQLite `points` table | Per-point visibility |

### 7.5 Failure Modes

| Failure | Detection | Recovery |
|---|---|---|
| Network drop mid-batch | `fetch` rejects or `Response.ok = false` | Retry with backoff; idempotent on server |
| Server returns 5xx | `Response.status === 5xx` | Retry; client doesn't move cursor until success |
| Server returns 429 | `Response.status === 429` | Wait `Retry-After` seconds; retry |
| Device crashes mid-sync | Next launch sees unsynced WAL | Replay WAL; sync resumes |
| Token expired | `Response.status === 401` | Re-auth (refresh token in v2; for v1, log out and prompt re-install) |
| Out of disk space | Native FS error | Surface UI; user must free space |

### 7.6 Sync Quality Metrics (Recorded Per Run)

```typescript
interface SyncMetrics {
  durationMs: number;
  bytesUploaded: number;
  bytesDownloaded: number;
  pointsUploaded: number;
  pointsDownloaded: number;
  conflictsDetected: number;
  conflictsResolved: number;
  httpRetries: number;
  errors: number;
}
```

Logged to console + sent to server (best-effort) for v2 analytics.

---

## 8. Conflict Resolution Algorithm — Visual

### 8.1 Decision Tree

```
                   ┌─────────────────────┐
                   │  Conflict Detected  │
                   │  (local vs. remote) │
                   └──────────┬──────────┘
                              │
                              ▼
                ┌─────────────────────────────┐
                │  |ts_local - ts_remote|     │
                │        > 1 second?         │
                └──────────┬──────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼ YES                     ▼ NO
    ┌─────────────────┐         ┌─────────────────┐
    │ Newer wins      │         │ Within 1 second │
    │ (timestamp)     │         │ → tiebreak by   │
    │                 │         │   vector sim    │
    └────────┬────────┘         └────────┬────────┘
             │                          │
             ▼                          ▼
    ┌─────────────────┐         ┌─────────────────────┐
    │ LOCAL_WINS or   │         │ Compute mean cos    │
    │ REMOTE_WINS     │         │ sim of each to top  │
    │                 │         │ 20 other local pts  │
    └─────────────────┘         └──────────┬──────────┘
                                           │
                              ┌────────────┴────────────┐
                              │                         │
                              ▼ HIGHER                  ▼ LOWER
                    ┌─────────────────┐         ┌─────────────────┐
                    │ LOCAL_WINS      │         │ REMOTE_WINS     │
                    │ (vector sim)    │         │ (vector sim)    │
                    └─────────────────┘         └─────────────────┘

                            ▲ Both tiebreak stages may
                            │ produce equal mean scores.
                            ▼
                   ┌─────────────────────┐
                   │  Still tied?        │
                   │  → Field-level merge│
                   │  (Section 10.4 of   │
                   │  Backend doc)       │
                   └──────────┬──────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ MERGED          │
                    │ (deterministic) │
                    └─────────────────┘
```

### 8.2 Worked Example

**Scenario:** Two devices capture the same otter within 0.8 seconds.

**Local payload (Device A):**
```json
{
  "captured_at": "2025-05-12T14:23:01.100Z",
  "local_updated_at": "2025-05-12T14:23:01.250Z",
  "project_id": "p-river-study",
  "lat": 13.4521,
  "lng": 75.1234
}
```

**Remote payload (Device B):**
```json
{
  "captured_at": "2025-05-12T14:23:01.900Z",
  "local_updated_at": "2025-05-12T14:23:01.900Z",
  "project_id": "p-river-study",
  "lat": 13.4522,
  "lng": 75.1235
}
```

**Step 1: Timestamp comparison**
- `|ts_local - ts_remote| = |250 - 900| = 650ms`
- Less than 1 second → go to vector similarity stage.

**Step 2: Vector similarity**
- Query local shard for top-20 nearest to local's vector (excluding self): mean score = 0.78.
- Query local shard for top-20 nearest to remote's vector (excluding self): mean score = 0.81.
- Remote's vector is more "central" in the local collection → REMOTE_WINS.

**Result:** Device A's payload is updated to match Device B's.

**Step 3: Surface to UI**
- SyncReport records: `pointId: 01HXZ..., localUpdatedAt: ..., remoteUpdatedAt: ..., resolution: REMOTE_WINS, fieldsChanged: [lat, lng, local_updated_at]`.

### 8.3 Edge Case: Identical Vectors, Different Metadata

```
Local:  vector [0.012, ...], payload {project_id: "A", tags: ["x"]}
Remote: vector [0.012, ...], payload {project_id: "B", tags: ["y"]}
```

The `vector_checksum` is identical (same vector), so this is **not** a conflict per Section 9.3 — it's an "additive update." Server writes remote's payload; local pulls it on next sync. The user's project selection in `project_id` reflects their most recent choice.

### 8.4 Edge Case: Concurrent Deletion

If Device A deletes point X while Device B is editing it:
- Device A sends DELETE.
- Device B sends UPSERT with new payload.
- Server detects: incoming op type differs.
- Tiebreaker: timestamp wins (assume B's UPSERT is newer → B's data survives).
- Device A's next pull sees X is back; UI re-renders it.
- Surface as conflict: "X was deleted and recreated; your version was restored."

---

## 9. Network Topology

### 9.1 Logical View

```
┌─────────────────┐
│   Device (A)    │────── HTTPS ──────┐
└─────────────────┘                   │
                                      ▼
┌─────────────────┐         ┌─────────────────┐
│   Device (B)    │────────▶│   Sync API      │
└─────────────────┘         │   (FastAPI)     │
                            └────────┬────────┘
┌─────────────────┐                   │
│   Device (C)    │───────────────────┘
└─────────────────┘                   │
                                      ▼
                            ┌─────────────────┐
                            │ Qdrant Cloud    │
                            │ (central shard) │
                            └─────────────────┘
                                      │
                                      ▼
                            ┌─────────────────┐
                            │ enrichment      │
                            │ (AI enrichment) │
                            └─────────────────┘
```

### 9.2 Physical Reality (Free Tier)

- Devices: distributed globally, intermittent connectivity.
- Sync API: hosted on Railway free tier (`*.up.railway.app`).
- Qdrant Cloud: AWS ca-central-1.
- enrichment: their global CDN.

Latency (typical):
- Device → Sync API: 50-300ms.
- Sync API → Qdrant Cloud: 10-50ms (same region).
- Sync API → enrichment: 100-300ms.

### 9.3 DNS and Certificates

- Sync API URL: `https://field-edge-sync.up.railway.app` (placeholder).
- TLS 1.3 enforced; cert pinned via `react-native-ssl-pinning` (P-256 SHA-256).
- Qdrant Cloud URL: pinned via the qdrant-client's built-in cert validation.

### 9.4 Bandwidth Budget

A single sync batch of 100 points:
- Vectors: 100 × 512 × 4 bytes = 200 KB
- Payloads: ~100 × 2 KB = 200 KB
- Overhead: 10 KB
- **Total: ~410 KB per batch**

A typical sync run of 1000 points = ~4 MB. Acceptable on 4G, painful on 2G (deferred to Wi-Fi-only mode).

---

## 10. Deployment Architecture

### 10.1 Mobile App Deployment

- **iOS:** Built via `xcodebuild`. Output `.ipa` uploaded to TestFlight for internal testing.
- **Android:** Built via `gradle assembleRelease`. Output `.aab` uploaded to Google Play internal track.
- **v1 (hackathon):** Direct APK / IPA distribution via the GitHub repo's release page. Judges install via TestFlight (iOS) or side-load APK (Android).

### 10.2 Sync API Deployment

- **Platform:** Railway free tier.
- **Process:** `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4`
- **Auto-deploy:** On `git push` to `main`, Railway triggers a rebuild.
- **Logs:** Railway logs streamed to the dashboard; also stored in `/logs/sync-api.log`.
- **Scaling:** Single instance for hackathon; Railway scales horizontally if traffic spikes.

### 10.3 Qdrant Cloud Deployment

- **Cluster:** Free tier, 1 GB RAM.
- **Region:** `ca-central-1` (Canada Central); pick closest to demo audience.
- **API key:** stored in `.env` and Railway's secret manager.

### 10.4 enrichment Deployment

- **Account:** Free tier.
- **Upload preset:** unsigned for demo (auth'd for prod).
- **Auto-tagging:** enabled on the preset (`categorize`, `aws_rek`, `text_detection`).

### 10.5 Demo Day Deployment

For the Paytm-office demo:
- Mobile app: pre-installed on demo devices (Manas's iPhone + a backup Android).
- Sync API: running on Railway (URL hardcoded in the app).
- Central Qdrant: warmed with seed data (50 sample photos pre-uploaded).
- enrichment: 50 photos pre-processed with tags.
- Demo flow: capture new photo → search → sync → verify in dashboard. All happens in <60 seconds.

---

## 11. Scalability Considerations

### 11.1 Edge Device Scaling

| Dimension | Current | Scale Limit | Bottleneck |
|---|---|---|---|
| Photos per device | 5,000 | 50,000 | Edge shard query latency |
| Searches per minute | 10 | 100 | ONNX text encoding throughput |
| Sync runs per day | 5 | 50 | Network bandwidth |

Beyond 5k photos, consider:
- **Quantization tightening** (move to binary quantization, 32× smaller vectors).
- **Hierarchical Edge** (multiple shards per project, merged on demand).
- **Server-side fallback** for searches that need cross-device data.

### 11.2 Server Scaling

| Dimension | Current | Scale Limit | Bottleneck |
|---|---|---|---|
| Devices per server | 100 | 1,000 | Worker count (4 default) |
| Points in central cluster | 10,000 | 1,000,000 | Qdrant free tier RAM |
| Requests per second | 1 | 100 | Qdrant rate limit |

Beyond the limits:
- Move to Qdrant paid tier.
- Add Redis caching for hot reads.
- Shard Qdrant by `device_id` or `project_id`.

### 11.3 Network Scaling

- Centralized cloud is a bottleneck; for v2, consider regional Qdrant clusters with cross-region replication.
- P2P device sync (Bluetooth) for nearby devices, falling back to cloud.

---

## 12. Disaster Recovery

### 12.1 Failure Scenarios

| Scenario | Impact | Recovery |
|---|---|---|
| Device lost/stolen | Photos lost if not synced | Device token is invalidated; user re-installs and re-syncs from cloud |
| Edge shard corrupted | All local vectors lost | Cloud has the authoritative state; user re-syncs |
| Sync API down | New sync runs fail | Client retries with backoff; data on device is safe |
| Qdrant Cloud outage | Pulls fail, uploads queue | Client retries; data on device is safe |
| enrichment outage | Enrichment delayed | Point exists without tags; tags populate when enrichment recovers |
| WAL corrupted | Some recent writes lost | Replay stops at corruption point; older data is safe |

### 12.2 Backups

- **Local:** No backup needed; cloud is the backup.
- **Cloud (Qdrant):** Qdrant Cloud takes automatic snapshots (free tier: daily, 7-day retention).
- **enrichment:** Their standard retention policy (no control for free tier).

### 12.3 Data Loss Windows

- **Photo in capture → sync:** bounded by user action. Worst case: user captures photo, never syncs, loses phone → photo lost.
- **Photo in sync → cloud:** bounded by network. Idempotent retries ensure eventual delivery.
- **Cloud enrichment:** bounded by enrichment availability. Enrichment is eventually consistent.

### 12.4 Manual Recovery Procedure

If the user reports "my photos aren't showing up":

1. Verify sync ran (check SyncReport).
2. Verify network connectivity to Sync API.
3. Check central Qdrant point count via `/sync/heartbeat`.
4. If point exists in Qdrant but not on device: trigger sync pull.
5. If point exists on device but not in Qdrant: trigger sync upload.
6. If neither: check WAL for the entry; replay if missing.

---

## 13. Performance Architecture

### 13.1 Hot Paths and Their Budgets

| Path | Budget | Current (estimated) | Headroom |
|---|---|---|---|
| App cold start | 3s | ~2.5s | OK |
| Capture | 800ms | ~600ms | OK |
| Search | 700ms | ~500ms | OK |
| Sync upload (100 points) | 5s | ~3s | OK |
| Sync pull (100 points) | 5s | ~2s | OK |

### 13.2 Critical Optimizations

1. **ONNX session warm-up.** First inference is ~500ms slow; warm session is ~250ms. We warm on app launch.
2. **Scalar quantization.** 4× smaller vectors, 4× faster search, <1% accuracy loss.
3. **Batch sync uploads.** 100 points per request; amortizes HTTPS overhead.
4. **WAL fsync throttling.** Group 3-5 captures into a single fsync to reduce I/O.
5. **JSI direct calls.** No JSON serialization for single-point operations.

### 13.3 Profiling Plan

- Day 2: Profile ONNX inference on the target device.
- Day 4: Profile the capture hot path with React DevTools.
- Day 5: Profile search latency with 5k synthetic vectors.
- Day 7: Profile sync round-trip end-to-end.

### 13.4 Memory Pressure Handling

- If the OS warns of memory pressure, unload the ONNX model (re-load on next capture).
- If WAL exceeds 10MB, rotate.
- If photo cache exceeds 50MB, evict oldest thumbnails.

---

## 14. Future Roadmap

### 14.1 v1 (Hackathon) — Current Scope

- Photos only (no video semantic search).
- Single-device-to-cloud sync (no P2P).
- Manual + auto sync (no real-time push).
- CLIP-ViT-B/32 (one model, no on-device model switching).

### 14.2 v2 (Post-Hackathon, 1-2 months)

- **Video semantic search** via per-frame CLIP embeddings.
- **P2P sync** via Bluetooth Low Energy for nearby devices.
- **Push notifications** when cloud enrichments arrive (replace polling).
- **Multi-device pairing** with cryptographic identity per user (not just device tokens).
- **iPad-optimized layouts** for HQ analysts reviewing media.

### 14.3 v3 (6 months)

- **Real-time co-capture** (multiple devices editing the same point ID in <100ms windows).
- **Model marketplace** — users pick their embedding model (CLIP, SigLIP, MobileCLIP, custom-trained).
- **Cross-language search** — search in Hindi, get English-tagged results.
- **Federated learning** — local models improve without central training.

### 14.4 Non-Goals Forever

- Becoming a general-purpose vector DB.
- Replacing cloud-only solutions for users with reliable internet.
- Competing with enrichment on media transformation (we complement, not compete).

---

## Appendix A: Glossary of Cross-Document Terms

| Term | Definition | First Defined In |
|---|---|---|
| Edge Shard | Qdrant Edge in-process storage unit | PRD §15 |
| WAL | Write-Ahead Log | PRD §15 |
| CLIP | Contrastive Language-Image Pre-training | PRD §15 |
| UniFFI | Mozilla FFI generator | PRD §15 |
| TurboModule | RN native module API | TRD §4 |
| JSI | JavaScript Interface | TRD §4 |
| Scalar quantization | int8 vector compression | TRD §6 |
| Edge Adapter | Rust struct wrapping the edge impl | TRD §5 |
| Sync Diff | Local vs. remote comparison result | Backend §9 |
| Conflict Resolution | Algorithm for reconciling same-ID different-payload | Backend §10 |
| Sync Report | UI-visible summary of a sync run | Backend §9 |
| Cursor | Opaque pagination token for sync pull | Backend §2 |
| EdgeOps Trait | Common interface for Edge backends | TRD §5 |

---

## Appendix B: File Map

```
docs/
├── 01-PRD.md                          # This PRD
├── 02-TRD.md                          # Technical Requirements
├── 03-Backend-DB-Implementation.md    # Backend + DB deep dive
└── 04-System-Architecture.md          # System Architecture (this doc)
```

---

**End of System Architecture Document. All four documents complete.**

For next steps: read [README.md](../README.md) for bootstrap instructions, then proceed to Day 1 of the [PRD §12 milestone timeline](01-PRD.md#12-milestones-and-timeline).
