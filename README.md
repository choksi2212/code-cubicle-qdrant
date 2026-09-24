# FieldEdge

**Offline-first AI platform for field workers — Android edition.**
Built for the **Code Cubicle × Paytm × Qdrant** hackathon (2025).

> Field workers in low-connectivity environments can capture photos, search them
> semantically without any internet, and have everything sync intelligently when
> they come back online — turning weeks of fieldwork chaos into organized,
> searchable evidence in hours.

---

## 🎯 What this is

A standalone **offline-first AI edge memory platform** that:

- Captures photos on-device and embeds them with a real CLIP-ViT-B/32 model running through ONNX Runtime.
- Stores the vectors + metadata in a local Qdrant Edge shard via a custom Rust↔React Native bridge.
- Runs semantic + filtered search **without any network access**.
- Decides what stays local and what syncs, then reconciles intelligently with the central Qdrant Cloud cluster when connectivity returns.
- Resolves conflicts by timestamp + vector-checksum heuristics.

Everything below — Rust core, ONNX model loader, sync API, conflict resolution — is self-contained. This repo is a complete, runnable submission.

---

## 🎬 The Demo (3 minutes)

1. **Airplane mode ON.** Open the app. Capture 3 photos of a polluted river.
2. **Search offline.** Type "river pollution". Get matching photos in <500 ms.
3. **Airplane mode OFF.** Tap "Sync now". Watch the central Qdrant cluster populate within seconds.

No third-party cloud APIs are involved in steps 1–2. The only network call is the sync in step 3.

---

## 📚 Documentation

| Doc | Purpose |
|---|---|
| [docs/01-PRD.md](docs/01-PRD.md) | Product Requirements — what we're building and why |
| [docs/02-TRD.md](docs/02-TRD.md) | Technical Requirements — stack, decisions, standards |
| [docs/03-Backend-DB-Implementation.md](docs/03-Backend-DB-Implementation.md) | Backend + DB implementation — endpoints, schema, sync protocol |
| [docs/04-System-Architecture.md](docs/04-System-Architecture.md) | System Architecture — layers, sequences, deployment |

**Read in this order.** PRD → TRD → Backend → System Arch.

---

## 🏗️ Architecture (TL;DR)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Android Device                                                    │
│                                                                     │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌──────────────┐        │
│  │  RN UI  │──▶│ Turbo-  │──▶│ ONNX    │   │   Qdrant     │        │
│  │ (TS)    │   │ Module  │   │ Runtime │   │   Edge       │        │
│  └────┬────┘   └────┬────┘   └─────────┘   └──────┬───────┘        │
│       │             │  JSI/UniFFI                   │                │
│       │             ▼                              │                │
│       │      ┌──────────────┐                      │                │
│       └─────▶│  libfield_   │◀─────────────────────┘                │
│              │  edge_rust.so │ (Rust core via FFI)                   │
│              └──────┬───────┘                                        │
│                     │                                               │
│             ┌───────▼────────┐                                      │
│             │  WAL + Shard   │                                      │
│             └────────────────┘                                      │
└─────────────────────────┬───────────────────────────────────────────┘
                          │  HTTPS
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Sync API (FastAPI)                                                 │
│         │                                                            │
│         ▼                                                            │
│  ┌─────────────┐                                                     │
│  │  Qdrant     │  central cluster (system of record)                 │
│  │  Cloud      │                                                     │
│  └─────────────┘                                                     │
└──────────────────────────────────────────────────────────────────────┘
```

The Qdrant Cloud cluster is shared with any downstream consumer that wants to read from it. This repo owns writes from the device side; consumers (whether that's a dashboard, an enrichment pipeline, or a research notebook) just read.

---

## 🚀 Quick Start (Android — for Judges / Reviewers)

> Estimated time to first run: **20-30 minutes** on a fresh clone.

### Prerequisites

- **Node.js 20+** and **pnpm 9+** (`npm install -g pnpm`)
- **Rust 1.79+** (`rustup install stable`)
- **Android Studio** (Hedgehog or newer) — for SDK + NDK
- **Java 17+** (JDK)
- **Python 3.11+** (for sync API)
- **Android NDK r26+** (installed via Android Studio SDK Manager)

### One-time setup

```bash
# 1. Clone
git clone <repo-url> field-edge && cd field-edge

# 2. Install JS deps
pnpm install

# 3. Set up env
cp .env.example .env
# Fill in your Qdrant Cloud URL + API key

# 4. Install Android targets (one-time)
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

# 5. Install cargo-ndk (one-time)
cargo install cargo-ndk --root ~/.cargo

# 6. Install Android NDK r26+ via Android Studio SDK Manager
#    OR set ANDROID_NDK_HOME=/path/to/ndk/26.x.x
```

### Build

```bash
# 7. Cross-compile Rust for Android
cd packages/field-edge-rust
cargo ndk -t arm64-v8a -t armeabi-v7a -t x86 -t x86_64 \
    -o ../../apps/mobile/android/app/src/main/jniLibs \
    build --release

# 8. Run tests
cargo test                        # 19/19 should pass
cd ../..
pnpm test                         # 9/9 should pass (jest)

# 9. Start Metro bundler
cd apps/mobile
pnpm start

# 10. In another terminal: build and install the Android app
pnpm android
# OR open the android/ folder in Android Studio and click "Run"
```

### Run the sync API locally

```bash
cd apps/sync-api
pip install -e .
uvicorn app.main:app --reload --port 8000
# Then: curl http://localhost:8000/sync/heartbeat
```

### Seed demo data

```bash
cd apps/mobile
pnpm demo:seed
# Populates the local Edge shard with ~50 CC0 sample photos
```

---

## 🧪 What's been verified (on a real Android device)

| Scenario | Result |
|---|---|
| Capture a photo (online) | ✅ local shard, JPEG persisted, search finds it |
| Capture offline (airplane mode) | ✅ same as above; zero network calls |
| Search offline with `river pollution` | ✅ results in ~270 ms, no network |
| Bulk: capture 3 photos → single sync | ✅ WAL=3 → Upload done: 3 accepted, 0 errors |
| Idempotent re-sync (WAL empty) | ✅ no-op, 0 errors |
| Cold start: kill app, relaunch | ✅ point count + WAL entry persist |
| Bad EXIF (no GPS) | ✅ EXIF parse warning, capture completes with `gps_status: "unavailable"` |
| `pnpm test` (jest) | ✅ 9/9 passing |
| `cargo test` (Rust) | ✅ 19/19 passing |

---

## 📦 Repo layout

```
apps/
├── mobile/         # React Native + TypeScript + Kotlin + Rust
│   ├── src/
│   │   ├── services/   # capture, sync, api, location
│   │   ├── screens/    # SearchScreen, CaptureScreen, SyncReportScreen
│   │   ├── native/     # FieldEdgeRust TS wrapper
│   │   ├── embedding/  # ONNX CLIP loader
│   │   └── stores/     # Zustand sync store
│   └── android/     # Android project
└── sync-api/       # FastAPI + Qdrant client

packages/
└── field-edge-rust/  # Rust core: shard + WAL + sync_diff + conflict

docs/                  # PRD / TRD / Backend / Architecture
```

---

## 📄 License

This submission is open-source for hackathon judging. See `LICENSE` for terms.
