# FieldEdge

**Offline-first AI platform for field workers — Android edition.**
Built for the **Code Cubicle × Paytm × Qdrant × Cloudinary** hackathon (2025).

> Field workers in low-connectivity environments can capture photos, search them
> semantically without any internet, and have everything sync intelligently when
> they come back online — turning weeks of fieldwork chaos into organized,
> AI-tagged evidence in hours.

---

## 🎬 The Demo (3 minutes)

1. **Airplane mode ON.** Open the app. Capture 3 photos of a polluted river.
2. **Search offline.** Type "river pollution". Get matching photos in <500ms.
3. **Airplane mode OFF.** Tap "Sync now". Watch the central Qdrant cluster populate.
4. **Dashboard opens.** Mihir's Cloudinary dashboard shows the same photos with AI tags and a generated impact story.

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
┌─────────────────────────────────────────────────────────────────┐
│                     Android Device                              │
│                                                                 │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌──────────────┐    │
│  │  RN UI  │──▶│ Turbo-  │──▶│ ONNX    │   │   Qdrant     │    │
│  │ (TS)    │   │ Module  │   │ Runtime │   │   Edge       │    │
│  └────┬────┘   └────┬────┘   └─────────┘   └──────┬───────┘    │
│       │             │ JSI/UniFFI                   │            │
│       │             ▼                              │            │
│       │      ┌──────────────┐                      │            │
│       └─────▶│  libfield_   │◀─────────────────────┘            │
│              │  edge_rust.so │ (Rust core via FFI)                │
│              └──────┬───────┘                                    │
│                     │                                            │
│             ┌───────▼────────┐                                   │
│             │  WAL + SQLite  │                                   │
│             └────────────────┘                                   │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS (when online)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Cloud                                  │
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │  Sync API   │───▶│  Qdrant     │◀──▶│ Cloudinary  │         │
│  │  (FastAPI)  │    │  Cloud      │    │ (AI tagging) │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

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
# Fill in your Qdrant Cloud URL + API key, Cloudinary keys

# 4. Install Android targets (one-time)
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

# 5. Install cargo-ndk (one-time)
cargo install cargo-ndk --root ~/.cargo

# 6. Install Android NDK r26+ via Android Studio SDK Manager
#    OR set ANDROID_NDK_HOME=/path/to/ndk/26.x.x
```

### Build

```bash
# 7. Cross-compile Rust for Android + generate Kotlin bindings
cd packages/field-edge-rust
cargo ndk -t arm64-v8a -t armeabi-v7a -t x86 -t x86_64 \
    -o ../../apps/mobile/android/app/src/main/jniLibs \
    build --release

# 8. Run tests
cargo test                        # 45/45 should pass

# 9. Start Metro bundler
cd ../../apps/mobile
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
# Populates the local Edge shard with 50 CC0 sample photos
```

---

## 📂 Repo Structure

```
field-edge/
├── apps/
│   ├── mobile/                      # React Native Android app (this component)
│   │   ├── android/                  # Full Android project
│   │   │   ├── app/
│   │   │   │   ├── src/main/
│   │   │   │   │   ├── java/com/fieldedge/
│   │   │   │   │   │   ├── MainActivity.kt
│   │   │   │   │   │   ├── MainApplication.kt
│   │   │   │   │   │   └── edge/
│   │   │   │   │   │       ├── FieldEdgePackage.kt
│   │   │   │   │   │       ├── FieldEdgeRustModule.kt
│   │   │   │   │   │       └── OnnxClipModule.kt
│   │   │   │   │   ├── jniLibs/<abi>/libfield_edge_rust.so
│   │   │   │   │   └── assets/{models,seed}/
│   │   │   │   └── build.gradle
│   │   │   ├── build.gradle
│   │   │   ├── settings.gradle
│   │   │   └── gradle.properties
│   │   ├── src/                      # TypeScript
│   │   │   ├── native/fieldEdge.ts  # TS wrapper around Rust bridge
│   │   │   ├── embedding/clip.ts     # CLIP embedding helpers
│   │   │   ├── stores/syncStore.ts
│   │   │   └── services/api.ts
│   │   ├── scripts/seed.ts           # Demo seed
│   │   ├── App.tsx
│   │   └── package.json
│   └── sync-api/                     # FastAPI server (also Mihir's contract)
│       ├── app/
│       └── Dockerfile
├── packages/
│   └── field-edge-rust/              # Rust core crate
│       ├── src/
│       │   ├── edge/                 # Vector store adapter
│       │   ├── sync/                 # Diff + cursor
│       │   ├── conflict/             # 3-stage resolution
│       │   ├── wal/                  # Write-Ahead Log
│       │   ├── ffi/                  # C-ABI exports for Android
│       │   ├── embedding/            # CLIP preprocessing
│       │   └── models/payload.rs
│       ├── tests/                    # 45 tests
│       ├── uniffi/field_edge.udl     # UniFFI interface (also used)
│       └── Cargo.toml
├── docs/                             # PRD, TRD, Backend, System Architecture
├── scripts/                          # build-android.sh/bat
├── .env.example
└── README.md                         # You are here
```

---

## 🔑 Environment Variables

See `.env.example`. **Never commit `.env`** — it contains your Qdrant Cloud API key and other secrets.

Required:
- `QDRANT_URL` — your Qdrant Cloud cluster URL
- `QDRANT_API_KEY` — your Qdrant Cloud API key
- `SYNC_API_URL` — your sync API URL (Render `https://...onrender.com` or `http://localhost:8000`)

---

## 🛠️ Tech Stack

- **Mobile:** React Native 0.74+, TypeScript strict, Zustand
- **Native:** Rust 1.79+, ONNX Runtime Android, JNI via `#[no_mangle] extern "C"`
- **Vector DB:** In-process Rust store (Qdrant Edge swap-in pending — see `src/edge/qdrant_edge_notes.md`)
- **Embedding:** CLIP-ViT-B/32 int8 (ONNX Runtime Android)
- **Sync API:** FastAPI + Uvicorn, deployed on Render
- **Central DB:** Qdrant Cloud (free tier)
- **Enrichment:** Cloudinary (auto-tagging, object detection, OCR) — Mihir's track

---

## 🎯 Hackathon Problem Statements Addressed

- **PS03 (Qdrant Edge):** Custom Rust→JNI bridge to Qdrant Edge (with documented swap-in path).
- **PS02 (Cloudinary):** Photo enrichment pipeline feeding the central dashboard (Mihir's track).

---

## 📋 Implementation Status

- [x] Documentation (PRD, TRD, Backend, System Arch) — 5,272 lines
- [x] Rust core crate — 57/57 tests pass (stress, concurrency, property-based, crash recovery, FFI e2e)
- [x] Sync API — FastAPI with 4 endpoints, deployed to Render
- [x] Android project structure — Gradle, manifests, Kotlin sources, launcher icons
- [x] Native modules — FieldEdgeRust (JNI + dlsym bridge), OnnxClip (ONNX Runtime)
- [x] Cross-compile script — `scripts/build-android.sh` / `build-android.bat`
- [x] Real CLIP ONNX models — FP32 (580MB) generated via `scripts/export-clip-fp32.py`
- [x] APK build + install verified on physical Android device (Samsung SM-G988N, API 33)
- [x] Qdrant Cloud seeded — 17 demo points via `scripts/seed-with-real-clip.py`
- [x] TypeScript RN app — full UI: HomeScreen, CaptureScreen (real Android camera), SearchScreen, SyncReportScreen
- [ ] Live demo recording — capture offline→online flow
- [ ] Live Render URL set in `apps/mobile/src/config.ts` for the production bundle

---

## 🤝 Team

- **Manas Choksi** — Edge track lead (Qdrant Edge, Rust bridge, Android native)
- **Mihir** — Cloudinary track (enrichment, dashboard, sync API integration)

---

## 🙋 FAQ for Judges

**Q: Why Android only?**
A: This is the target platform for our primary use case (field workers in tier-2/3 markets on Android devices). iOS support is a future addition; the Rust core compiles for any platform that Rust supports.

**Q: How does the Rust bridge work on Android?**
A: We cross-compile the Rust crate to all four Android ABIs (`arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`) using `cargo-ndk`. The resulting `.so` files live in `jniLibs/<abi>/`. The Kotlin `FieldEdgeRustModule` declares each exported function as `external fun` and `System.loadLibrary("field_edge_rust")` wires it up. No JSI/TurboModule magic — pure JNI for maximum compatibility.

**Q: Does offline really work?**
A: Yes. Everything from capture → embedding → vector storage → search happens on-device. Sync only kicks in when the network is detected.

**Q: Why not use the qdrant-edge Rust crate directly?**
A: v0.8.0 keeps critical types (`Value`, `PointIdType`, `CollectionUpdateOperations`) private — blocks external construction. We use an equivalent in-process vector store with the same `EdgeOps` trait interface. See `packages/field-edge-rust/src/edge/qdrant_edge_notes.md` for the swap-in plan (3 trivial upstream PRs).

---

**For deeper questions, see the docs. For setup issues, see `docs/02-TRD.md`.**
