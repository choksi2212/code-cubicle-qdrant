# Technical Requirements Document — FieldEdge Edge Component

**Document version:** 1.0
**Last updated:** 2025-09-23
**Owner:** Manas Choksi
**Companion to:** [01-PRD.md](01-PRD.md)
**Status:** Living document — update as decisions are made during the hackathon

---

## Table of Contents

1. [Tech Stack Overview](#1-tech-stack-overview)
2. [Frontend Stack (React Native)](#2-frontend-stack-react-native)
3. [Rust Core Crate](#3-rust-core-crate)
4. [Native Bridge (UniFFI + TurboModule)](#4-native-bridge-uniffi--turbomodule)
5. [Database Strategy — Qdrant Edge vs Local-Mode Fallback](#5-database-strategy--qdrant-edge-vs-local-mode-fallback)
6. [Embedding Model — Selection, Quantization, Inference](#6-embedding-model--selection-quantization-inference)
7. [Sync API Backend](#7-sync-api-backend)
8. [State Management](#8-state-management)
9. [Build System and Tooling](#9-build-system-and-tooling)
10. [Testing Strategy](#10-testing-strategy)
11. [CI/CD](#11-cicd)
12. [Performance Budget and Profiling](#12-performance-budget-and-profiling)
13. [Security Architecture](#13-security-architecture)
14. [Dependency Management](#14-dependency-management)
15. [Environment Configuration](#15-environment-configuration)
16. [Code Quality Standards](#16-code-quality-standards)
17. [API Style Guide](#17-api-style-guide)

---

## 1. Tech Stack Overview

### 1.1 One-Line Stack Summary
**React Native (TypeScript) → TurboModule → UniFFI → Rust → Qdrant Edge crate. Embeddings via ONNX Runtime Mobile (CLIP int8). Sync to central Qdrant Cloud over a FastAPI orchestrator.**

### 1.2 Layered View

| Layer | Technology | Version | Role |
|---|---|---|---|
| UI | React Native | 0.74+ | Screens, navigation, user input |
| UI language | TypeScript | 5.4+ | Strict mode |
| UI state | Zustand | 4.5+ | App-wide reactive state |
| UI navigation | React Navigation | 6.x | Stack + modal |
| Native module wrapper | RN TurboModule | 0.74+ | Type-safe native API surface |
| Native bindings generator | UniFFI | 0.27+ | Rust → Swift + Kotlin |
| Rust core | Rust | 1.79+ (stable) | Business logic, sync, conflict resolution |
| Vector store | `qdrant-edge` crate | 0.8.x | In-process vector DB |
| Vector store (fallback) | `qdrant-client` (local mode) | 1.12+ | Path-persistent vector DB |
| Embedding runtime | ONNX Runtime Mobile | 1.19+ | INT8 quantized model inference |
| Embedding model | CLIP-ViT-B/32 int8 | ONNX export | Text + image embeddings |
| Sync API | FastAPI | 0.115+ | REST endpoints |
| Sync API runtime | Uvicorn | 0.32+ | ASGI server |
| Sync API deploy | Railway / Render | n/a | Free-tier hosting |
| Central vector DB | Qdrant Cloud | Free tier | Centralized vector store |
| Object storage | S3 / enrichment | n/a | Photo binary storage |
| Logging (RN) | `pino` + `react-native-file-logger` | latest | Structured app logs |
| Logging (server) | `loguru` | 0.7+ | Server logs |
| Testing (TS) | Jest + React Native Testing Library | latest | Unit + component tests |
| Testing (RN) | Detox | 20+ | E2E tests |
| Testing (Rust) | `cargo test` + `mockall` | latest | Unit + integration |
| Testing (API) | `pytest` + `httpx` | latest | API tests |
| Linting (TS) | ESLint + Prettier | latest | Style + lint |
| Linting (Rust) | `cargo fmt` + `cargo clippy` | latest | Style + lint |
| CI | GitHub Actions | n/a | PR checks |
| Monorepo | pnpm workspaces | 9.x | Dependency hoisting |
| Bundler (RN) | Metro | 0.80+ | JS bundling |

### 1.3 Decision Matrix — Why These Choices

| Decision | Alternative Considered | Why We Chose This |
|---|---|---|
| React Native | Flutter | Judges are more familiar with RN; Mihir can also read it; ONNX Runtime has first-class RN support |
| TypeScript strict | Plain JS | Type safety is the only way to keep RN↔Rust contracts aligned |
| UniFFI | Manual FFI bindings | UniFFI is mature, Mozilla-maintained, generates idiomatic Swift/Kotlin |
| Rust | C++ | Qdrant Edge is officially Rust; we get exact API parity |
| Custom Rust bridge | `qdrant-edge-py` via Chaquopy | Chaquopy is Android-only; we need iOS too |
| Custom Rust bridge | Skip Edge, use `qdrant-client` local mode | Edge SDK is in beta but our README + architecture diagram justify the bridge; judges respect honesty |
| ONNX Runtime | TensorFlow Lite | ONNX has better React Native support; CLIP ONNX exports are more common |
| CLIP-ViT-B/32 | MobileCLIP-S2 | CLIP is well-documented; MobileCLIP has fewer pre-built ONNX exports; B/32 fits in 60 MB INT8 |
| FastAPI | Express (Node) | Python ecosystem matches Rust ecosystem; FastAPI is async-native |
| Zustand | Redux Toolkit | Zustand is 10× less boilerplate, sufficient for our state shape |
| Railway | Fly.io, Vercel, AWS | Railway free tier is simplest for a 10-day demo |
| GitHub Actions | CircleCI | Free for public repos; ubiquitous |

### 1.4 Anti-Stack (Explicitly Avoided)

- ❌ **Expo managed workflow** — we need custom native modules + ONNX Runtime + Rust, all of which require bare RN. Expo's prebuild pattern can work but adds friction.
- ❌ **Realm / WatermelonDB** — SQLite via `op-sqlite` is enough; we don't need an ORM.
- ❌ **Firebase / Supabase** — we're building the sync orchestrator ourselves; no managed backend.
- ❌ **Pinecone / Weaviate** — Qdrant is the sponsor; using a competitor would be tone-deaf.
- ❌ **Hermes engine disablers** — Hermes stays on; ONNX Runtime works fine with Hermes.

---

## 2. Frontend Stack (React Native)

### 2.1 Project Layout

```
field-edge/
├── apps/
│   ├── mobile/                      # React Native app (this component)
│   │   ├── src/
│   │   │   ├── screens/             # CaptureScreen, SearchScreen, SyncReportScreen, ...
│   │   │   ├── components/          # Reusable UI
│   │   │   ├── hooks/               # useEdgeShard, useSync, useEmbedding, ...
│   │   │   ├── stores/              # Zustand stores
│   │   │   ├── services/            # API client, file system, permissions
│   │   │   ├── native/              # TypeScript wrappers around native modules
│   │   │   │   └── fieldEdge.ts     # Public API of the Rust bridge
│   │   │   ├── utils/               # Date, geo, image preprocessing
│   │   │   ├── assets/              # Seed images, model file
│   │   │   └── App.tsx
│   │   ├── ios/                     # Xcode project + Swift wrapper
│   │   ├── android/                 # Gradle + Kotlin wrapper
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── jest.config.js
│   ├── sync-api/                    # FastAPI server (also used by Mihir)
│   └── dashboard/                   # Mihir's Next.js app (out of scope)
├── packages/
│   ├── field-edge-rust/             # Rust core crate
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── edge/
│   │   │   ├── sync/
│   │   │   ├── conflict/
│   │   │   ├── embedding/           # Model load glue (Rust side)
│   │   │   └── wal/
│   │   ├── uniffi/
│   │   │   └── field_edge.udl       # UniFFI interface definition
│   │   ├── Cargo.toml
│   │   └── tests/
│   └── field-edge-react-native/     # TS wrapper around TurboModule
│       ├── src/
│       │   └── index.ts
│       └── package.json
├── docs/                            # PRD, TRD, Backend, System Architecture
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

### 2.2 React Native Version & Why

- **RN 0.74+**: required for TurboModules + Fabric architecture, which is what UniFFI's TypeScript output assumes.
- **New Architecture (Fabric + TurboModules) enabled**: by default in 0.74. Verified by `newArchEnabled=true` in `gradle.properties` and `RCT_NEW_ARCH_ENABLED=1` env var for iOS.

### 2.3 TypeScript Configuration

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "jsx": "react-native",
    "skipLibCheck": true
  }
}
```

### 2.4 Dependencies (Mobile App)

```jsonc
{
  "dependencies": {
    "react": "18.2.0",
    "react-native": "0.74.5",
    "@react-navigation/native": "^6.1.18",
    "@react-navigation/native-stack": "^6.11.0",
    "react-native-screens": "^3.34.0",
    "react-native-safe-area-context": "^4.11.0",
    "react-native-vision-camera": "^4.5.3",            // Camera
    "react-native-image-resizer": "^1.4.5",            // Pre-resize before embedding
    "@react-native-async-storage/async-storage": "^2.0.0",
    "react-native-mmkv": "^3.1.0",                     // Fast key-value (device_id, settings)
    "react-native-sqlite-storage": "^6.0.1",           // Metadata DB
    "react-native-keychain": "^8.2.0",                 // Secure device token storage
    "@react-native-community/netinfo": "^11.4.1",      // Connectivity detection
    "zustand": "^4.5.5",
    "pino": "^9.5.0",
    "react-native-file-logger": "^0.6.0",
    "date-fns": "^4.1.0",
    "ulid": "^2.3.0",                                  // Photo IDs
    "@field-edge/react-native": "workspace:*"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/jest": "^29.5.13",
    "typescript": "^5.6.3",
    "jest": "^29.7.0",
    "@testing-library/react-native": "^12.7.2",
    "detox": "^20.27.0",
    "eslint": "^9.13.0",
    "prettier": "^3.3.3",
    "@react-native/eslint-config": "^0.74.85"
  }
}
```

### 2.5 Folder Convention

- **`screens/`**: One file per screen. Co-locate the screen-specific components if not reused elsewhere.
- **`components/`**: Reusable UI primitives (`Button`, `Card`, `SearchBar`).
- **`hooks/`**: Stateful logic (`useCaptureFlow`, `useEdgeQuery`).
- **`stores/`**: Zustand stores (`useSyncStore`, `useSettingsStore`).
- **`services/`**: Side-effectful singletons (`apiClient`, `imageStorage`).
- **`native/`**: TypeScript bridge to native modules — single source of truth for what the device can do.

### 2.6 Navigation Graph

```
Stack (root)
├── HomeScreen (capture button + search bar + sync badge)
├── SearchScreen (results grid)
├── PhotoDetailScreen (single photo + metadata + share)
├── SyncReportScreen (last sync summary)
├── SettingsScreen (auto-sync toggle, project picker)
└── CameraScreen (full-screen camera with shutter)
```

Modal: `ProjectPickerSheet`, `FilterSheet` (presented over SearchScreen).

### 2.7 Theme & Styling

- `StyleSheet.create` (no styled-components, no NativeWind) for v1 — keeps bundle small and avoids NativeWind's build-time complexity.
- Color tokens:
  - `--bg`: `#0E1116`
  - `--surface`: `#1A1F26`
  - `--text-primary`: `#E6EAF0`
  - `--text-secondary`: `#8B95A5`
  - `--accent`: `#00BFA6` (Qdrant brand teal — fits sponsor alignment)
  - `--warning`: `#F5A524`
  - `--error`: `#E5484D`

---

## 3. Rust Core Crate

### 3.1 Crate Name and Location
`field-edge-rust` — `packages/field-edge-rust/Cargo.toml`.

### 3.2 Cargo.toml

```toml
[package]
name = "field-edge-rust"
version = "0.1.0"
edition = "2021"
rust-version = "1.79"

[lib]
crate-type = ["staticlib", "cdylib"]
name = "field_edge_rust"

[dependencies]
qdrant-edge = "0.8"
qdrant-client = { version = "1.12", default-features = false, features = ["rustls-tls"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
uuid = { version = "1", features = ["v4", "serde"] }
ulid = { version = "1", features = ["serde"] }
sha2 = "0.10"
thiserror = "1"
anyhow = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
uniffi_macros = "0.27"
bincode = "1.3"

[build-dependencies]
uniffi = { version = "0.27", features = ["build"] }

[dev-dependencies]
mockall = "0.13"
tempfile = "3"
criterion = { version = "0.5", features = ["html_reports"] }
```

### 3.3 Crate Type Explanation

- `staticlib` — for linking into iOS app.
- `cdylib` — for Android (loaded via JNI).
- Both needed because iOS and Android use different loading mechanisms.

### 3.4 Module Layout

```
src/
├── lib.rs               # UniFFI UDL scaffolding + module declarations
├── edge/
│   ├── mod.rs           # Public re-exports
│   ├── shard.rs         # Wraps qdrant_edge::EdgeShard
│   ├── config.rs        # EdgeConfig construction
│   ├── point.rs         # Domain Point type (photo + vector + payload)
│   └── error.rs         # EdgeError enum
├── embedding/
│   ├── mod.rs
│   ├── preprocess.rs    # Image preprocessing (resize, normalize)
│   └── runtime.rs       # ONNX Runtime wrapper (Rust-side bridge to C++)
├── sync/
│   ├── mod.rs
│   ├── diff.rs          # Compute diff between local and remote point sets
│   ├── cursor.rs        # Opaque pagination cursor
│   └── report.rs        # SyncReport type (returned to UI)
├── conflict/
│   ├── mod.rs
│   ├── detect.rs        # Conflict detection
│   ├── resolve.rs       # Resolution algorithm (timestamp > vec-sim > merge)
│   └── merge.rs         # Field-level merge for ties
├── wal/
│   ├── mod.rs
│   ├── log.rs           # Append-only WAL
│   └── replay.rs        # Replay on startup
├── models/
│   ├── mod.rs
│   ├── photo.rs         # PhotoMetadata
│   ├── project.rs       # Project
│   └── payload.rs       # Payload schema (matches FR-031)
├── crypto/
│   ├── mod.rs
│   └── checksum.rs      # SHA-256 of vector for vector_checksum field
└── ffi/
    ├── mod.rs
    └── exports.rs       # Functions exposed via UniFFI
```

### 3.5 UniFFI UDL File (`field_edge.udl`)

```idl
namespace field_edge {
  EdgeHandle edge_create(string directory, string config_json);
  EdgeHandle edge_load(string directory);
  void edge_close(EdgeHandle handle);
  
  sequence<UpsertResult> edge_upsert_points(EdgeHandle handle, string points_json);
  string edge_query(EdgeHandle handle, string request_json);
  string edge_retrieve(EdgeHandle handle, string ids_json);
  void edge_optimize(EdgeHandle handle);
  
  SyncDiff edge_sync_diff(string local_state_json, string remote_state_json);
  ResolvedConflict edge_resolve_conflict(string local_payload_json, string remote_payload_json);
};

dictionary UpsertResult {
  string point_id;
  boolean accepted;
  string error_message?;
};

dictionary SyncDiff {
  sequence<string> to_upload;
  sequence<string> to_download;
  sequence<string> conflicts;
};

dictionary ResolvedConflict {
  string winner;  // "local" | "remote" | "merged"
  string resolved_payload_json;
};
```

### 3.6 Why UniFFI Over Alternatives

| Alternative | Pros | Cons | Verdict |
|---|---|---|---|
| **UniFFI** | Mozilla-maintained, generates idiomatic Swift+Kotlin, single UDL file | Slightly slower compile vs raw FFI | ✅ Chosen |
| `cargo-ndk` + manual JNI | Full control, fast | Manual binding code, error-prone | ❌ Fallback only |
| `swig-rust` | Mature | Less idiomatic output | ❌ |
| `cxx` | Clean C++ interop | Targets C++, not Swift | ❌ |
| Direct `extern "C"` | Maximum perf | Highest maintenance | ❌ Last resort |

### 3.7 Rust Coding Standards

- `#![deny(warnings)]` at crate root.
- `cargo clippy -- -D warnings` in CI.
- `cargo fmt --check` in CI.
- All public functions documented with `///` doc comments.
- Errors via `thiserror` enums; main entry points convert with `anyhow`.
- No `unwrap()` in production code; allowed in tests.
- All async functions take `tokio` runtime as parameter (not panicking on missing runtime).

### 3.8 Why Two Vector Store Dependencies?

The crate has both `qdrant-edge` AND `qdrant-client` (local mode). This is intentional:

- **Primary path:** `qdrant-edge` via UniFFI.
- **Fallback path:** If `qdrant-edge` fails on a target device, the same Rust API can be implemented against `qdrant-client` with `QdrantClient::new(QdrantClientConfig { storage_path: Some(dir) })`.

This is a **code-path switch**, not a runtime branch — the TypeScript API is identical. The decision is made at Rust compile time via a `cfg` flag:

```rust
#[cfg(feature = "edge")]
mod edge_impl {
  pub fn open(path: &str) -> Result<Box<dyn EdgeOps>, Error> {
    Ok(Box::new(EdgeShardAdapter::new(EdgeShard::load(path)?)))
  }
}

#[cfg(feature = "local-mode")]
mod edge_impl {
  pub fn open(path: &str) -> Result<Box<dyn EdgeOps>, Error> {
    let client = QdrantClient::new(QdrantClientConfig {
      storage_path: Some(path.to_string()),
      ..Default::default()
    })?;
    Ok(Box::new(LocalClientAdapter::new(client)))
  }
}
```

Both adapters implement `trait EdgeOps` with the same methods the UDL exposes.

### 3.9 Performance Targets (Rust Core)

| Operation | Target | Measurement |
|---|---|---|
| `edge_create` | < 200 ms | On Samsung Galaxy A35 |
| `edge_load` | < 500 ms for 5,000 vectors | Cold load |
| `edge_upsert_points` (batch of 10) | < 50 ms | Warm cache |
| `edge_query` (k=20, 5k vectors) | < 50 ms | 95th percentile |
| `edge_sync_diff` (1k vs 1k) | < 200 ms | JSON parsing + diff |
| `edge_resolve_conflict` | < 5 ms | Per conflict |

---

## 4. Native Bridge (UniFFI + TurboModule)

### 4.1 Architecture

```
┌──────────────────────────────────────────────────────────┐
│ JavaScript (TypeScript)                                  │
│   import { fieldEdge } from '@field-edge/react-native'   │
│   await fieldEdge.createShard({ dir: '/edge' })          │
└──────────────────┬───────────────────────────────────────┘
                   │ TurboModule (JSI)
┌──────────────────▼───────────────────────────────────────┐
│ Native wrapper                                            │
│   iOS:  FieldEdgeModule.swift (TurboModule)               │
│   Android: FieldEdgeModule.kt (TurboModule)              │
└──────────────────┬───────────────────────────────────────┘
                   │ UniFFI-generated bindings
┌──────────────────▼───────────────────────────────────────┐
│ Rust core (staticlib / cdylib)                            │
│   field_edge_rust::ffi::edge_create(...)                  │
│   field_edge_rust::ffi::edge_upsert_points(...)           │
└──────────────────────────────────────────────────────────┘
```

### 4.2 iOS Setup

1. UniFFI generates Swift bindings into `packages/field-edge-rust/target/swift/`.
2. Swift Package Manager exposes `FieldEdgeRust` as a local package.
3. The RN iOS app includes this via `Package.swift` dependency in `ios/`.
4. `FieldEdgeModule.swift` wraps the UniFFI calls and conforms to `RCTBridgeModule` (TurboModule).

### 4.3 Android Setup

1. UniFFI generates Kotlin bindings into `packages/field-edge-rust/target/kotlin/`.
2. The Rust crate is built for all Android targets (arm64-v8a, armeabi-v7a, x86_64) via `cargo-ndk`.
3. Output `.so` files are placed in `android/app/src/main/jniLibs/<abi>/`.
4. Kotlin wrapper `FieldEdgeModule.kt` extends `ReactContextBaseJavaModule` (TurboModule).

### 4.4 TurboModule Spec (TypeScript)

```typescript
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  createShard(dir: string, configJson: string): Promise<boolean>;
  loadShard(dir: string): Promise<boolean>;
  upsertPoints(handleId: number, pointsJson: string): Promise<string>;
  query(handleId: number, requestJson: string): Promise<string>;
  closeShard(handleId: number): Promise<void>;
  computeSyncDiff(localJson: string, remoteJson: string): Promise<string>;
  resolveConflict(localJson: string, remoteJson: string): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('FieldEdge');
```

### 4.5 TypeScript Public API (in `@field-edge/react-native`)

The raw TurboModule is wrapped to give a domain-friendly API:

```typescript
// packages/field-edge-react-native/src/index.ts

import { NativeModules, Platform } from 'react-native';

const LINKING_ERROR =
  `Native module 'FieldEdge' is not linked. ` +
  `Make sure you rebuilt the app after running 'pnpm build:native'.`;

const FieldEdge = NativeModules.FieldEdge
  ? NativeModules.FieldEdge
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

export interface EdgeConfig {
  vectorDim?: number;       // default 512
  distance?: 'Cosine' | 'Euclid' | 'Dot';
  quantization?: 'Scalar' | 'Product' | 'Binary' | 'None';
  maxSearchThreads?: number;
}

export interface PointInput {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface QueryRequest {
  vector: number[];
  limit: number;
  filter?: FilterExpression;
  withPayload?: boolean;
  withVector?: boolean;
}

export type FilterExpression =
  | { type: 'match'; key: string; value: string | number | boolean }
  | { type: 'range'; key: string; gte?: number; lte?: number }
  | { type: 'and' | 'or'; children: FilterExpression[] };

export interface QueryHit {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export class FieldEdgeClient {
  private handleId: number | null = null;

  async open(dir: string, config: EdgeConfig = {}): Promise<void> {
    const ok = await FieldEdge.createShard(dir, JSON.stringify({
      vectorDim: 512,
      distance: 'Cosine',
      quantization: 'Scalar',
      ...config,
    }));
    if (!ok) throw new Error('Failed to create shard');
    this.handleId = 1; // simplified; real impl uses a handle registry
  }

  async upsertPoints(points: PointInput[]): Promise<void> {
    if (this.handleId == null) throw new Error('Shard not open');
    await FieldEdge.upsertPoints(this.handleId, JSON.stringify(points));
  }

  async query(req: QueryRequest): Promise<QueryHit[]> {
    if (this.handleId == null) throw new Error('Shard not open');
    const raw = await FieldEdge.query(this.handleId, JSON.stringify(req));
    return JSON.parse(raw) as QueryHit[];
  }

  async close(): Promise<void> {
    if (this.handleId == null) return;
    await FieldEdge.closeShard(this.handleId);
    this.handleId = null;
  }
}

export const fieldEdge = new FieldEdgeClient();
```

### 4.6 JSI vs Bridge Performance

TurboModules use JSI (JavaScript Interface), which means:
- Calls are **synchronous** when needed (Promise resolve is microtask, not bridge roundtrip).
- No JSON serialization cost — arguments are passed directly across JSI.
- Vector arrays (512 floats) cross the boundary as `ArrayBuffer` via JSI's `TypedArray` support.

For batched operations (`upsertPoints`), we serialize to JSON in TS → deserialize in Rust. This is ~5 MB/s on a mid-range phone, acceptable for batches of ≤50 points.

For single-point operations (search query), we keep vectors as `Float32Array` and pass via JSI directly — no JSON serialization.

### 4.7 Error Handling

All native calls return `Promise<Result<T, EdgeError>>` where `EdgeError` is a Rust enum serialized to a structured string:

```typescript
export interface EdgeError {
  code: 'IO_ERROR' | 'CORRUPT_SHARD' | 'INVALID_PAYLOAD' | 'OUT_OF_DISK' | 'TIMEOUT';
  message: string;
  context?: Record<string, unknown>;
}
```

The TS wrapper converts these to thrown `Error` instances with `.code` and `.message`.

---

## 5. Database Strategy — Qdrant Edge vs Local-Mode Fallback

### 5.1 Decision

**Primary:** `qdrant-edge` via Rust bridge. **Fallback:** `qdrant-client` in local mode, behind the same `EdgeOps` trait.

### 5.2 Why Both?

- `qdrant-edge` is in **beta** as of writing (v0.8.0, Aug 2026).
- Beta can mean API churn, platform gaps, or crashes on certain inputs.
- For a 10-day hackathon, we cannot afford to debug Qdrant Edge internals.
- Therefore: same code, two implementations, runtime-selected via Cargo feature flag.
- The TS API is identical — judges don't see the switch.

### 5.3 Cargo Features

```toml
[features]
default = ["edge"]
edge = []
local-mode = []
```

```bash
# Default build (uses qdrant-edge)
cargo build --release

# Fallback build (uses qdrant-client local mode)
cargo build --release --no-default-features --features local-mode
```

### 5.4 `EdgeOps` Trait (Common Interface)

```rust
// src/edge/mod.rs

pub trait EdgeOps: Send + Sync {
  fn upsert(&self, points: &[Point]) -> Result<(), EdgeError>;
  fn query(&self, req: &QueryRequest) -> Result<Vec<ScoredPoint>, EdgeError>;
  fn retrieve(&self, ids: &[String]) -> Result<Vec<Point>, EdgeError>;
  fn optimize(&self) -> Result<(), EdgeError>;
  fn close(&self) -> Result<(), EdgeError>;
  fn len(&self) -> Result<usize, EdgeError>;
}
```

### 5.5 Adapter: `qdrant-edge`

```rust
// src/edge/qdrant_edge_adapter.rs

use qdrant_edge::{EdgeShard, EdgeConfig, EdgeVectorParams, Distance, Query, QueryRequest as EdgeQRequest, Filter, FieldCondition, MatchValue};

pub struct QdrantEdgeAdapter {
  shard: parking_lot::Mutex<EdgeShard>,
}

impl EdgeOps for QdrantEdgeAdapter {
  fn upsert(&self, points: &[Point]) -> Result<(), EdgeError> {
    let ops: Vec<_> = points.iter().map(|p| {
      UpdateOperation::UpsertPoints(vec![Point {
        id: Some(p.id.clone().into()),
        vector: Some(HashMap::from([("clip".to_string(), p.vector.clone())])),
        payload: Some(json_to_payload(&p.payload)?),
      }])
    }).collect();
    let mut shard = self.shard.lock();
    for op in ops {
      shard.update(op).map_err(EdgeError::from)?;
    }
    Ok(())
  }

  fn query(&self, req: &QueryRequest) -> Result<Vec<ScoredPoint>, EdgeError> {
    let mut shard = self.shard.lock();
    let edge_req = EdgeQRequest {
      query: Query::Nearest(req.vector.clone(), Some("clip".to_string())),
      filter: req.filter.as_ref().map(convert_filter).transpose()?,
      limit: req.limit as u64,
      with_payload: Some(true),
      with_vector: Some(false),
    };
    let response = shard.query(edge_req).map_err(EdgeError::from)?;
    Ok(response.into_iter().map(|r| ScoredPoint {
      id: r.id.to_string(),
      score: r.score,
      payload: payload_to_json(r.payload)?,
    }).collect())
  }
  // ... other methods
}
```

### 5.6 Adapter: `qdrant-client` Local Mode

```rust
// src/edge/qdrant_client_adapter.rs

use qdrant_client::{QdrantClient, QdrantClientConfig, client::Payload};

pub struct QdrantClientAdapter {
  client: QdrantClient,
  collection: String,
}

impl QdrantClientAdapter {
  pub fn new(path: &str, collection: &str) -> Result<Self, EdgeError> {
    let config = QdrantClientConfig {
      storage_path: Some(path.to_string()),
      ..Default::default()
    };
    let client = QdrantClient::new(config).map_err(EdgeError::from)?;
    
    // Ensure collection exists
    client.create_collection(&collection, VectorParams {
      size: 512,
      distance: Distance::Cosine,
      ..Default::default()
    }).await.ok(); // ignore "already exists" errors
    
    Ok(Self { client, collection: collection.to_string() })
  }
}

impl EdgeOps for QdrantClientAdapter {
  fn upsert(&self, points: &[Point]) -> Result<(), EdgeError> {
    // ... same external behavior, different internal calls
  }
  // ... other methods
}
```

### 5.7 README Disclosure

```markdown
## Vector Store Implementation

FieldEdge is built to use [Qdrant Edge](https://qdrant.tech/documentation/edge/)
as its embedded vector store. Qdrant Edge is in beta as of this writing (v0.8.0).

Our primary implementation uses `qdrant-edge` via a custom Rust-to-React Native
bridge built with [Mozilla UniFFI](https://github.com/mozilla/uniffi-rs).
The full C-ABI is defined in `packages/field-edge-rust/uniffi/field_edge.udl`.

We also ship a **fallback** implementation using `qdrant-client` in local mode
(behind the same trait), activated by:
\`\`\`bash
cargo build --release --no-default-features --features local-mode
\`\`\`

This fallback gives us a guaranteed-working path in case the beta SDK has a
gap on the target device. The TypeScript API is identical in both modes.
```

---

## 6. Embedding Model — Selection, Quantization, Inference

### 6.1 Model Selection

| Model | Dim | Size (fp32) | Size (int8) | Accuracy | Mobile Speed (mid-range) |
|---|---|---|---|---|---|
| CLIP-ViT-B/32 | 512 | 150 MB | 63 MB | High | ~250 ms/image |
| CLIP-ViT-L/14 | 768 | 890 MB | 350 MB | Highest | ~1.5 s/image |
| MobileCLIP-S2 (Apple) | 512 | 80 MB | 33 MB | High (≈B/32) | ~150 ms/image |
| all-MiniLM-L6-v2 | 384 | 90 MB | 22 MB | Text only | ~80 ms/text |
| SigLIP-base | 768 | 360 MB | 130 MB | Higher than CLIP | ~600 ms/image |

### 6.2 Decision: CLIP-ViT-B/32 int8

- **Why CLIP:** The demo's defining feature is text-to-image search ("show me river pollution" → matching photos). Only CLIP-family models give us a shared embedding space for text and images.
- **Why B/32 not L/14:** L/14 is too large for mid-range phones (350 MB INT8 won't fit alongside the app).
- **Why int8 quantization:** ~4× smaller, ~3× faster, <1% accuracy loss on cosine distance (Qdrant's published benchmarks).
- **Why not MobileCLIP:** Fewer pre-built ONNX exports in the wild as of writing; we lose a day hunting for the right export. CLIP B/32 has been exported to ONNX by Microsoft, Hugging Face, and others.
- **Why not SigLIP:** Higher accuracy but larger and slower; not worth the trade for the demo.

### 6.3 Model Acquisition

```bash
# Export CLIP-ViT-B/32 to ONNX with int8 quantization
pip install optimum[exporters]
optimum-cli export onnx \
  --model openai/clip-vit-base-patch32 \
  --task feature-extraction \
  ./clip-vit-b32-onnx/

# Quantize to int8
python -m onnxruntime.quantization.quantize_static \
  ./clip-vit-b32-onnx/model.onnx \
  ./clip-vit-b32-int8/model.onnx \
  --format QOperator \
  --per_channel \
  --reduce_range
```

The resulting `model.onnx` (~63 MB) is bundled in `apps/mobile/src/assets/models/`.

### 6.4 ONNX Runtime Setup

- iOS: `onnxruntime-objc` via CocoaPods.
- Android: `onnxruntime-android` AAR.
- Both expose C APIs; Rust wraps them in `src/embedding/runtime.rs`.

### 6.5 Inference Pipeline

```typescript
// apps/mobile/src/hooks/useEmbedding.ts

import { useEffect, useState } from 'react';
import { fieldEdge } from '@field-edge/react-native';
import * as ImageResizer from 'react-native-image-resizer';

export function useEmbedding() {
  const [model, setModel] = useState<EmbeddingModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await EmbeddingModel.load();
      if (!cancelled) setModel(m);
    })();
    return () => { cancelled = true; };
  }, []);

  return model;
}

export class EmbeddingModel {
  private static instance: EmbeddingModel | null = null;

  static async load(): Promise<EmbeddingModel> {
    if (EmbeddingModel.instance) return EmbeddingModel.instance;
    const m = new EmbeddingModel();
    await m.warmup();
    EmbeddingModel.instance = m;
    return m;
  }

  async embedImage(uri: string): Promise<Float32Array> {
    const resized = await ImageResizer.createResizedImage(
      uri, 224, 224, 'PNG', 100, 0, undefined, false,
      { mode: 'cover', onlyScaleDown: true }
    );
    return await NativeEmbedding.embedImage(resized.uri);
  }

  async embedText(text: string): Promise<Float32Array> {
    return await NativeEmbedding.embedText(text);
  }

  private async warmup() {
    // Run a dummy inference to compile the ONNX graph cache
    await NativeEmbedding.embedImage('dummy');
  }
}
```

### 6.6 Performance Targets

| Operation | Target | P99 |
|---|---|---|
| Image resize (4 MP → 224×224) | ≤80 ms | ≤150 ms |
| CLIP image inference | ≤300 ms | ≤450 ms |
| CLIP text inference | ≤80 ms | ≤150 ms |
| End-to-end `embedImage` | ≤400 ms | ≤600 ms |

### 6.7 Model Updates

For v1, the model is bundled in the app. Updates require a new app release. For v2 (post-hackathon), we'd add a CDN-backed model check on launch with a "model update available" prompt.

---

## 7. Sync API Backend

### 7.1 Stack

- **FastAPI 0.115+** with `uvicorn` ASGI server.
- **SQLite** for sync cursors and audit logs (Postgres if free tier Postgres is available on Railway).
- **Qdrant Cloud** as the central vector store (free tier).
- **httpx** for enrichment calls.
- **Deploy:** Railway free tier (1 vCPU, 512 MB RAM).

### 7.2 Project Layout

```
apps/sync-api/
├── pyproject.toml              # Poetry or uv
├── app/
│   ├── main.py                 # FastAPI app
│   ├── config.py               # Pydantic settings
│   ├── deps.py                 # Dependencies (auth, db)
│   ├── auth.py                 # Device token verification
│   ├── routers/
│   │   ├── sync.py             # /sync/upload, /sync/pull
│   │   ├── wal.py              # /sync/wal/replay
│   │   └── heartbeat.py
│   ├── services/
│   │   ├── qdrant.py           # Central cluster client
│   │   ├── cursor.py           # Opaque cursor encoding
│   │   ├── enrichment.py       # enrichment handoff
│   │   └── audit.py            # Audit log writer
│   ├── models/
│   │   ├── point.py            # Pydantic point model
│   │   └── responses.py
│   └── utils/
│       ├── diff.py             # Server-side diff computation
│       └── logging.py
├── tests/
└── Dockerfile
```

### 7.3 Endpoints (Summary — full spec in Backend & DB doc)

- `POST /sync/upload` — accepts batch of points, returns ack with conflict info.
- `GET /sync/pull?since=<cursor>&device_id=<id>` — returns cloud updates since cursor.
- `POST /sync/wal/replay` — recovers from interrupted uploads.
- `GET /sync/heartbeat` — liveness probe.

### 7.4 Authentication

- Each device gets a token at first install (generated by sync API, stored in Keychain).
- Token sent as `Authorization: Bearer <token>` header.
- Tokens are 256-bit random, prefixed with `dev_` for easy identification in logs.

### 7.5 Deployment Config

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml poetry.lock ./
RUN pip install poetry && poetry install --no-dev
COPY app/ ./app/
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

### 7.6 Environment Variables (Server)

```bash
QDRANT_URL=https://<your-cluster>.aws.cloud.qdrant.io
QDRANT_API_KEY=<your-api-key>
CLOUDINARY_API_KEY=<key>
JWT_SECRET=<random-256-bit>
DATABASE_URL=sqlite:///./sync.db
LOG_LEVEL=INFO
RATE_LIMIT_PER_MINUTE=60
```

---

## 8. State Management

### 8.1 Why Zustand (Not Redux)

- 10× less boilerplate.
- TS-first; selectors are typed.
- Smaller bundle (~3 KB vs ~12 KB).
- No provider wrapping needed.
- Sufficient for our state shape (not deeply nested, not high-frequency updates).

### 8.2 Stores

**`useSyncStore`**
- State: `{ status: 'idle'|'uploading'|'pulling'|'error', pendingCount: number, lastSyncAt: Date | null, lastReport: SyncReport | null }`
- Actions: `trigger()`, `cancel()`, `applyReport(report)`.

**`useSettingsStore`** (persisted via MMKV)
- `autoSyncEnabled: boolean`
- `wifiOnly: boolean`
- `minBatteryPercent: number` (default 30)
- `currentProjectId: string`
- `knownProjects: Project[]`

**`useSearchStore`**
- `query: string`
- `filters: { dateFrom?: Date, dateTo?: Date, projectIds: string[] }`
- `results: QueryHit[]`
- `loading: boolean`
- Actions: `setQuery`, `setFilters`, `runSearch`.

**`useCaptureStore`**
- `pendingCount: number` (photos awaiting embedding or sync)
- `lastCaptureAt: Date | null`
- Actions: `onCapture(point)`.

### 8.3 Persistence Boundary

- Persistent (MMKV): user settings, last-known project, device_id.
- Persistent (SQLite): photo metadata, sync cursors.
- Persistent (Edge shard): vectors + searchable payloads.
- In-memory (Zustand): ephemeral UI state.

---

## 9. Build System and Tooling

### 9.1 Monorepo Tool

**pnpm workspaces** (9.x). Chosen over Turborepo for v1 simplicity — we have <10 packages.

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

### 9.2 Top-Level Scripts (`package.json`)

```jsonc
{
  "scripts": {
    "build:native": "pnpm --filter field-edge-rust build:native",
    "ios": "pnpm --filter mobile ios",
    "android": "pnpm --filter mobile android",
    "start": "pnpm --filter mobile start",
    "test": "pnpm -r test",
    "test:rust": "cargo test --workspace",
    "lint": "pnpm -r lint",
    "format": "pnpm -r format",
    "demo:seed": "pnpm --filter mobile demo:seed",
    "sync-api:dev": "pnpm --filter sync-api dev",
    "sync-api:deploy": "railway up"
  }
}
```

### 9.3 Rust Build Script

```jsonc
{
  "scripts": {
    "build:native": "cargo build --release && uniffi-bindgen generate src/field_edge.udl --language swift --out-dir target/swift && uniffi-bindgen generate src/field_edge.udl --language kotlin --out-dir target/kotlin && cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 -o ../mobile/android/app/src/main/jniLibs build --release"
  }
}
```

### 9.4 Tool Versions (Pinned)

- Node: 20.x LTS
- pnpm: 9.x
- Rust: 1.79+ (toolchain pinned in `rust-toolchain.toml`)
- Python: 3.12 (sync API)
- Java: 17 (Android)
- Kotlin: 1.9.x
- Xcode: 15.4+ (iOS)

---

## 10. Testing Strategy

### 10.1 Test Pyramid

```
        ┌───────────────────────────┐
        │   E2E (Detox)             │  ~5 tests, critical paths
        ├───────────────────────────┤
        │  Integration (Rust + API) │  ~20 tests
        ├───────────────────────────┤
        │  Unit (TS + Rust + Py)    │  ~150 tests
        └───────────────────────────┘
```

### 10.2 Unit Tests

- **TS:** Jest + React Native Testing Library. Target: hooks, stores, services.
- **Rust:** `cargo test`. Target: edge adapters, sync diff, conflict resolution, WAL.
- **Python:** `pytest`. Target: API endpoints (with mocked Qdrant), diff logic.

### 10.3 Integration Tests

- Rust ↔ actual Edge shard on disk (no mocking): insert 1000 synthetic points, query, verify.
- Sync API ↔ actual Qdrant Cloud free cluster: round-trip a point.
- TS ↔ native module (via `react-native-testing-library` with mock native).

### 10.4 E2E Tests (Detox)

Critical paths:
1. Capture flow (open camera → snap → confirm toast).
2. Search flow (seed data → search "river" → see results).
3. Sync flow (toggle wifi off → sync disabled; toggle on → sync enabled).
4. Offline continuity (airplane mode → capture → search → airplane mode off → sync).

### 10.5 Coverage Targets

- Rust core: ≥80% line coverage (enforced in CI via `cargo-tarpaulin`).
- TS: ≥70% for `src/services/` and `src/native/`.
- Python: ≥80% for `app/services/`.

---

## 11. CI/CD

### 11.1 GitHub Actions Workflows

**`.github/workflows/ci.yml`** (on every PR):
1. Install pnpm, Rust, Python.
2. `pnpm install` (with cache).
3. `pnpm lint` (ESLint + Prettier check + cargo fmt check + cargo clippy).
4. `pnpm test` (Jest for TS, cargo test for Rust, pytest for Python).
5. `cargo build --release` (verifies the bridge compiles).
6. Verify `apps/mobile/ios/Pods` install (iOS smoke build, not full Xcode build).

**`.github/workflows/release.yml`** (on tag push):
1. Build Rust for iOS + Android (matrix).
2. Build iOS app via `xcodebuild`.
3. Build Android app via `gradle assembleRelease`.
4. Upload artifacts.

### 11.2 Branch Strategy

- `main` — stable, deployable.
- `feat/*` — feature branches.
- `fix/*` — bug fixes.
- PRs require 1 approval (team is 2 people, so this is light).

---

## 12. Performance Budget and Profiling

### 12.1 Mobile App Budget

| Metric | Budget | Tool |
|---|---|---|
| JS bundle (compressed) | ≤5 MB | `metro` analyzer |
| Rust binary (per arch) | ≤8 MB | `cargo bloat` |
| ONNX model (bundled) | ≤70 MB | file size |
| Total APK / IPA | ≤90 MB | build output |
| Cold start (JS ready) | ≤3 s | `react-native-performance` |
| Frame rate (camera view) | ≥50 FPS | `react-native-performance` |

### 12.2 Sync API Budget

| Metric | Budget | Tool |
|---|---|---|
| Cold start (worker ready) | ≤5 s | Railway logs |
| p50 `/sync/upload` (10 points) | ≤200 ms | Prometheus |
| p99 `/sync/upload` (10 points) | ≤1 s | Prometheus |
| p50 `/sync/pull` (50 points) | ≤300 ms | Prometheus |
| Memory per worker | ≤200 MB | Prometheus |

### 12.3 Profiling Tools

- **React Native:** React DevTools, Flipper, Chrome DevTools Performance tab.
- **Rust:** `cargo flamegraph`, `criterion` benchmarks for hot paths.
- **ONNX:** `onnxruntime_perf_test` binary for inference benchmarks.

---

## 13. Security Architecture

### 13.1 Threat Model

| Threat | Mitigation |
|---|---|
| Stolen device | Photos are on-device only until sync; device token in Keychain/Keystore |
| Network MITM | HTTPS only (TLS 1.3); cert pinning via `react-native-ssl-pinning` |
| Forged sync requests | Device token + per-request nonce |
| Server breach | Server stores no photos, only vectors + metadata; binary in enrichment |
| Model theft | Model is in the app bundle; reversing is possible but out of scope for v1 |
| GPS data leakage | GPS only leaves device with explicit sync; user can disable in settings |

### 13.2 Secrets Handling

- All secrets via `.env` files; `.env.example` committed with placeholders.
- `dotenv` loaded in dev only; production secrets via hosting provider's env-var UI.
- CI secrets via GitHub Actions secrets; never in workflow YAML.
- Device tokens: generated by sync API at first install; stored in Keychain/Keystore.

### 13.3 Permissions

- iOS: `NSCameraUsageDescription`, `NSLocationWhenInUseUsageDescription`, `NSPhotoLibraryAddUsageDescription`.
- Android: `CAMERA`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `WRITE_EXTERNAL_STORAGE` (only for export).

---

## 14. Dependency Management

### 14.1 Version Pinning Strategy

- **Patch versions:** auto-update via `pnpm update`.
- **Minor versions:** manual review.
- **Major versions:** explicit PR.
- Lockfile (`pnpm-lock.yaml`) is committed.

### 14.2 Dependency Hygiene

- `pnpm dedupe --check` in CI.
- `cargo audit` in CI (weekly cron).
- `pip-audit` for Python (weekly cron).
- No `*` versions in any `package.json` or `Cargo.toml`.

### 14.3 Vendored Dependencies

- The CLIP ONNX model is vendored at `apps/mobile/src/assets/models/`.
- Seed dataset (50 CC0 photos) is vendored at `apps/mobile/src/assets/seed/`.
- Total vendored binary size: ≤80 MB.

---

## 15. Environment Configuration

### 15.1 `.env.example` (Repo Root)

```bash
# Qdrant Cloud (central cluster)
QDRANT_URL=https://your-cluster.aws.cloud.qdrant.io
QDRANT_API_KEY=replace-with-your-api-key

# Sync API (after deployment)
SYNC_API_URL=http://localhost:8000
# (production): SYNC_API_URL=https://your-railway-app.up.railway.app

# enrichment (Mihir's track, shared here for reference)
CLOUDINARY_API_KEY=your-api-key

# Server-only (sync API deployment)
JWT_SECRET=replace-with-random-256-bit
DATABASE_URL=sqlite:///./sync.db
LOG_LEVEL=INFO
```

### 15.2 Local Dev Setup (Day-1 README Section)

```bash
# 1. Clone the repo
git clone <repo-url> field-edge && cd field-edge

# 2. Install JS deps
pnpm install

# 3. Build the Rust bridge (both platforms)
pnpm build:native

# 4. iOS: install pods and run
cd apps/mobile/ios && pod install && cd ../..
pnpm ios

# 5. Android: just run
pnpm android
```

---

## 16. Code Quality Standards

### 16.1 TypeScript

- Strict mode (see Section 2.3).
- No `any` in production code (allowed in tests for mocks).
- All exported functions have explicit return types.
- ESLint with `@react-native/eslint-config` + custom rules:
  - `@typescript-eslint/no-floating-promises: error`
  - `@typescript-eslint/no-misused-promises: error`
  - `import/order: error`

### 16.2 Rust

- `#![deny(warnings)]`.
- `clippy::pedantic` enabled, with allowed exceptions in `clippy.toml`.
- All public items documented.
- No `unsafe` outside `src/ffi/`.

### 16.3 Python

- Type hints everywhere; `mypy --strict` in CI.
- `ruff` for lint + format (replaces black + flake8).
- `pytest` for tests.

### 16.4 Git Commits

Conventional Commits format:
- `feat: add offline search`
- `fix: handle empty payload gracefully`
- `docs: update PRD with conflict resolution`
- `refactor: extract sync diff into separate module`

---

## 17. API Style Guide

### 17.1 TypeScript Public API

- Functions over classes where possible.
- Promise-returning, async by default.
- Errors thrown, not returned (except for expected business outcomes like "no results").
- Configuration via a single options object; required fields as positional args.

```typescript
// Good
async function upsertPoints(points: PointInput[]): Promise<void>

// Bad — error-as-value pattern
async function upsertPoints(points: PointInput[]): Promise<{ ok: boolean, error?: string }>
```

### 17.2 Rust Public API

- `Result<T, E>` everywhere; `thiserror` for `E`.
- Builder pattern for complex configuration.
- `&[T]` for read-only slices; `Vec<T>` only when ownership is needed.

### 17.3 HTTP API

- RESTful resource naming (`/sync/upload` is the action-on-resource).
- JSON only; UTF-8; ISO-8601 timestamps.
- Snake_case for JSON fields; camelCase in TS.
- All errors as `{"error": {"code": "...", "message": "..."}}`.

---

**End of TRD. Next: Backend & DB Implementation Doc (03).**
