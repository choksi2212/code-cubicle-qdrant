# Product Requirements Document — FieldEdge Edge Component

**Document version:** 1.0
**Last updated:** 2025-09-23
**Owner:** Manas Choksi (Qdrant Edge track lead)
**Hackathon:** Code Cubicle × Paytm × Qdrant, 2025
**Submission deadline:** 2025-10-03
**Final round venue:** Paytm office
**Related problem statements:** PS03 (Qdrant Edge) + PS02 (enrichment)

> This PRD describes the **edge component** of FieldEdge — the React Native mobile app and its on-device Qdrant Edge runtime, exposed via a custom Rust-to-React Native bridge. The enrichment layer and the cloud dashboard (owned by Mihir) are referenced where relevant but specified in their own documents.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Product Vision and Mission](#3-product-vision-and-mission)
4. [Target Users and Personas](#4-target-users-and-persons)
5. [User Journey Maps](#5-user-journey-maps)
6. [User Stories](#6-user-stories)
7. [Functional Requirements](#7-functional-requirements)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Success Metrics and KPIs](#9-success-metrics-and-kpis)
10. [Product Scope (In / Out)](#10-product-scope-in--out)
11. [Release Criteria](#11-release-criteria)
12. [Milestones and Timeline](#12-milestones-and-timeline)
13. [Risks and Mitigations](#13-risks-and-mitigations)
14. [Assumptions and Constraints](#14-assumptions-and-constraints)
15. [Glossary](#15-glossary)

---

## 1. Executive Summary

### 1.1 Product Name
**FieldEdge** — an offline-first AI platform for field workers. The edge component (this document's scope) is the on-device capture-and-search experience built on Qdrant Edge via a custom Rust bridge.

### 1.2 One-Line Pitch
Field workers in low-connectivity environments can capture photos, **search them semantically without any internet**, and have everything sync intelligently when they come back online — turning weeks of fieldwork chaos into organized, AI-tagged evidence in hours.

### 1.3 Why This Product Exists
A research analyst working for an environmental NGO in the Western Ghats spends 60% of her week in mobile-dead zones. Today, her workflow is: snap photos on phone → scribble notes on paper → travel 4 hours back to base → manually upload photos to a shared drive → tag them in Excel → email the Excel to headquarters → realize she forgot to photograph the river crossing on day 2 → give up.

The intelligence is in her head and on her phone. The system never sees it until it's too late. **FieldEdge** flips this: intelligence lives on the device, is searchable instantly, and propagates to the cloud when connectivity returns.

### 1.4 What This Component Delivers (Edge Track Scope)

A React Native mobile application for iOS and Android that:

1. **Captures** photos and short videos with rich metadata (timestamp, GPS, device, project tag).
2. **Generates semantic embeddings on-device** using a quantized CLIP-ViT-B/32 model running through ONNX Runtime Mobile. No data leaves the device for embedding.
3. **Stores vectors locally** in a Qdrant Edge shard embedded in-process via a custom Rust→React Native bridge (UniFFI-generated bindings).
4. **Searches semantically offline** — "show me photos of river pollution" returns matching images by cosine similarity over CLIP text↔image embeddings, with zero network.
5. **Reconciles intelligently when online** — write-ahead log replays, differential sync uploads, conflict resolution by timestamp + vector similarity heuristics, all via the Qdrant Edge sync API plus a thin sync orchestrator.
6. **Exposes a typed TypeScript API** that a sibling Next.js dashboard (track) can call when building the post-sync enrichment flow.

### 1.5 What This Component Does NOT Deliver
- Cloud-side AI tagging. (Owned by track — Mihir.)
- Project / timeline / impact-story dashboard UI. (track.)
- User authentication or multi-tenant account management. (Out of scope for hackathon.)
- Video semantic search. (Photos only in v1; videos get perceptual hashes and metadata only.)
- Cross-device peer-to-peer sync. (All sync routes through central Qdrant Cloud.)

### 1.6 Success Looks Like (Hackathon-Level)
- The 3-minute demo video starts with the phone in **airplane mode**, captures a photo, searches "river pollution," gets a correct result, then turns airplane mode off and watches the central Qdrant cluster populate within seconds — all while Mihir's separate dashboard shows the same photo with AI tags and a generated impact story. **No single second of that demo touches a server the audience can't see.**
- Judges can download the repo, run `pnpm install && pnpm ios` (or Android equivalent), follow the README, and reproduce the offline→online flow in under 10 minutes.
- Mihir's dashboard reads from the central Qdrant cluster **without writing custom integration code** — the API contract from Section 7 is the only thing that connects the two halves.

---

## 2. Problem Statement

### 2.1 The Industry Context
A 2024 GSMA report found that **~290 million people** in India live in areas with no reliable mobile broadband — relevant because the final-round venue is Paytm's office, and Paytm's merchant and field-ops footprint sits heavily in tier-2/3 cities and rural districts where connectivity is intermittent. The same pattern repeats globally: field-research organizations (NGOs, environmental agencies, infrastructure contractors, agricultural extension workers) deploy staff into places where:
- Cellular signal drops in and out during the day.
- Wi-Fi is unavailable for days at a time.
- Devices must survive on battery alone for 48+ hours.
- Sensitive data (locations of endangered species, victims of conflict, critical infrastructure) cannot be uploaded without explicit consent and curation.

### 2.2 The Current Workflow (Without FieldEdge)
A typical NGO field worker using stock tools (Google Photos + WhatsApp + Notion) loses between 30 and 90 minutes per field day to:
- Manually typing filenames that mean nothing the next morning (`IMG_20240512_142233.jpg`).
- Re-finding photos that "I know I took on Tuesday near the river" — requires scrolling through hundreds of thumbnails.
- Deciding which photos are "important enough" to upload over a 2G connection.
- Re-entering context that the photo itself doesn't carry (project code, GPS, subject).

When the field worker finally returns to base, **30-40% of captured media is effectively orphaned** — present on the device, unknown to the organization, unsearchable, untagged, and un-evidenced.

### 2.3 The Technical Gap
Three classes of solution exist today, and each is missing one critical capability:

| Solution | What it does well | What's missing |
|---|---|---|
| Cloud-only vector DBs (Pinecone, Weaviate, Qdrant Cloud) | Fast, scalable, AI-powered search | **Useless offline** — every query is a round trip |
| Mobile vector libraries (FAISS-mobile, sqlite-vss, LanceDB) | Work on device | **No first-class sync semantics** — you build the sync protocol yourself, badly |
| enrichment-style media managers | Excellent AI tagging, transformations, dashboard | **No offline semantic search** — everything assumes upload-first |

**Qdrant Edge closes this gap conceptually** — it is, in the Qdrant team's own framing, "SQLite but for vector search": in-process, embedded, persistent, with built-in sync semantics. As of this writing it ships official bindings only for Python and Rust; **no JavaScript or React Native SDK exists**. FieldEdge's contribution to the Qdrant Edge story is precisely this: prove that the Edge architecture can be brought to the world's most popular mobile app framework via a thin Rust bridge, and demonstrate the offline-first semantic-media workflow it enables.

### 2.4 What Success Eliminates
- **Zero-time semantic search at the point of capture.** The field worker types a question while standing in front of the subject and gets relevant photos in <500 ms, on device.
- **Zero-loss upload.** When connectivity returns, every captured-and-stored vector makes it to the central cluster, in order, deduped, conflict-resolved.
- **Zero-friction enrichment.** enrichment's auto-tagging (categorize, object detection, OCR) attaches to the same point ID the edge already wrote, so the dashboard sees one unified record per photo.
- **Zero-trust violation.** No embedding, no GPS coordinate, no payload leaves the device unless the user explicitly triggers sync. The phone is the source of truth; the cloud is the broadcast.

---

## 3. Product Vision and Mission

### 3.1 Vision Statement (3-Year Horizon)
Every field worker in the world — researcher, inspector, responder, ranger — has a pocket semantic memory that knows what they've seen, where, and when, even when no signal exists. FieldEdge is the platform layer that makes this possible: the on-device vector store (Qdrant Edge), the on-device embedding model (CLIP via ONNX), the sync protocol, and the enrichment APIs.

### 3.2 Mission Statement (Hackathon Horizon)
**For the 2025 Paytm hackathon, deliver a reproducible demo that proves an end-to-end offline-first semantic media workflow on a mobile device using Qdrant Edge as the embedded vector store, accessed via a custom Rust→React Native bridge, and seamlessly enriched by enrichment AI when connectivity is restored.**

### 3.3 Strategic Pillars (Ranked by Hackathon Importance)

1. **Technical depth that impresses Qdrant judges.** The Rust bridge is the headline. Without it, the entry is "yet another mobile app that talks to a vector DB." With it, the entry is "we made Qdrant Edge first-class on React Native."
2. **End-to-end demo that Paytm judges remember.** Offline toggle → search → sync → enrichment → dashboard. Three minutes, no setup.
3. **Realistic vertical that enrichment judges recognize.** Field-media-for-impact is a known enrichment use case (their own marketing page lists "NGO and sustainability organizations" as a customer segment).
4. **Engineering hygiene.** Lockfile committed, reproducible builds, README that works on a fresh clone, no secrets in the repo, clean module boundaries.

### 3.4 Anti-Goals (Explicitly NOT Pursuing)
- Multi-tenant SaaS billing.
- Cross-platform desktop.
- A polished native UI (functional > pretty).
- A general-purpose "scraper for anything" agent.
- A vector DB competitor to Qdrant (we are deepening their ecosystem, not competing with them).

---

## 4. Target Users and Personas

### 4.1 Persona 1 — Priya, the Field Researcher (Primary)

**Demographics**
- Age: 28
- Role: Senior researcher at a small environmental NGO (Wildlife Conservation Society, India chapter — fictional but representative)
- Location: Field stations in the Western Ghats; returns to a Bangalore office 1-2× per month
- Device: Mid-range Android (Samsung Galaxy A35, 8 GB RAM), sometimes her personal iPhone
- Connectivity: Jio or Airtel 4G with frequent drops to 2G or no service in forested zones

**Goals**
- Capture photographic evidence of deforestation, wildlife, river pollution across multi-day treks.
- Find specific photos by subject ("show me all photos of the otter we saw last Thursday") without scrolling through hundreds of files.
- Submit a tagged, organized photo set to headquarters after each trek.

**Pain Points**
- **Lost context.** "I know I photographed the river crossing but I can't remember which day."
- **Orphaned media.** 30% of her photos never make it off her phone.
- **Tagging tax.** She dreads the post-trek Excel session.
- **Battery anxiety.** She can't afford apps that drain the phone.

**How FieldEdge Helps Her**
- Capture → instant semantic search by description.
- Auto-extracts GPS and timestamps.
- One-tap sync when she reaches town.
- enrichment happens while she showers; she returns to a dashboard of pre-tagged media.

### 4.2 Persona 2 — Carlos, the Infrastructure Inspector (Secondary)

**Demographics**
- Age: 45
- Role: Civil engineer for a state highway department
- Location: Rural Maharashtra, project sites with no cellular coverage for hours
- Device: Company-issued ruggedized Android (Cat S62)
- Connectivity: Patchy 3G/4G

**Goals**
- Document pre-construction, during-construction, and post-construction states for compliance.
- Compare photos of the same site across weeks ("how does the bridge pier look today vs. the audit photo from March?").

**Pain Points**
- Cannot compare site states without manually pairing photos.
- Compliance reports require traceable, dated evidence — losing a photo = losing proof.

**How FieldEdge Helps Him**
- Captures are time-stamped and GPS-stamped at the moment of capture.
- Semantic search surfaces "the same site" via visual similarity.
- Sync to central Qdrant + enrichment yields a compliance-ready timeline.

### 4.3 Persona 3 — Dr. Anika, the HQ Analyst (Tertiary, Owned by enrichment Track)

**Demographics**
- Age: 38
- Role: Senior analyst at NGO headquarters, never visits the field herself
- Device: MacBook Pro, 16 GB RAM
- Connectivity: Always-on office Wi-Fi

**Goals**
- Receive pre-tagged, organized, searchable media from field workers.
- Generate monthly impact stories for donor reports.

**How FieldEdge Helps Her (Indirectly)**
- Mihir's separate dashboard consumes the synced data. FieldEdge is the upstream that ensures the data arrives organized and enriched.

### 4.4 Persona 4 — The Paytm Product Manager (Judge Persona)

**Demographics**
- Reviews submissions at the final round
- Familiar with mobile-first, offline-resilient, low-end-device architectures

**What Convinces Her**
- "This pattern — embedded vector store + smart sync — is exactly what we need for merchant tooling in tier-3 markets."
- "The Rust bridge is honest engineering. They didn't pretend a non-existent SDK exists."
- "The demo proves the offline claim. They actually toggled airplane mode."

---

## 5. User Journey Maps

### 5.1 Journey 1 — Capture → Offline Search → Sync (The Hero Demo)

**Stage 1 — Pre-Capture (Field, No Signal)**
- **Action:** Priya opens FieldEdge on her Android.
- **Touchpoints:** App launch screen, project picker.
- **Emotions:** Calm, prepared.
- **System state:** Edge shard loaded from local storage; CLIP model loaded into ONNX Runtime session (~150 MB resident); GPS locked.

**Stage 2 — Capture (Field, No Signal)**
- **Action:** She frames a photo of a polluted river bend, taps the shutter.
- **Touchpoints:** In-app camera, capture confirmation toast.
- **Emotions:** Focused.
- **System state:** JPEG written to local FS → background worker extracts EXIF GPS → runs CLIP inference (~300 ms on A35) → upserts point to local Edge shard with payload `{device_id, captured_at, lat, lng, project_id}` → toast: "Saved. 247 photos in your library."

**Stage 3 — Offline Search (Field, No Signal)**
- **Action:** She taps the search bar, types "trash near water".
- **Touchpoints:** Search input, result grid.
- **Emotions:** Delighted (first time).
- **System state:** Text → CLIP text encoder (~150 ms) → nearest-neighbor query on Edge shard (~20 ms for 1k vectors) → 12 results ranked by cosine similarity → grid renders with thumbnails.

**Stage 4 — Connectivity Returns (Town, Wi-Fi)**
- **Action:** She taps "Sync now" when she reaches a cafe with Wi-Fi.
- **Touchpoints:** Sync progress screen.
- **Emotions:** Relieved.
- **System state:** WAL replay → diff against central cluster → conflict resolution → upload of new + modified points → fetch of cloud-side enrichments (enrichment tags added by Mihir's pipeline) → update local point payloads → "Synced 12 photos. enrichment enriched 9 of them."

**Stage 5 — Post-Sync (HQ)**
- **Action:** Dr. Anika logs into the dashboard.
- **Touchpoints:** Mihir's Next.js dashboard.
- **System state:** All points present, tags attached, timeline generated.

### 5.2 Journey 2 — Capture Conflict (Two Devices, Same Photo)

**Stage 1 — Pre-Capture**
- Priya and a colleague both photograph the same otter. Both have FieldEdge. Both are offline.

**Stage 2 — Independent Capture**
- Device A upserts point ID `p-001` with payload `{device: A, ts: 2025-05-12T14:23:01Z, gps: 13.45, 75.12}`.
- Device B upserts point ID `p-001` with the same payload but slightly different GPS (75.121 vs 75.122) and `device: B`.

**Stage 3 — First Sync (Device A)**
- Uploads to central cluster. Central cluster now has `{device: A, ts: T1, gps: 13.45, 75.12}`.

**Stage 4 — Second Sync (Device B)**
- Pulls central cluster state, finds `p-001` exists.
- Compares local copy vs. server copy via conflict-resolution algorithm (Section 7.4.4 of Backend & DB doc):
  - **Tiebreaker 1:** Higher timestamp wins → B's `T1+0.001s` wins.
  - **Tiebreaker 2:** If timestamps are equal, vector similarity to other local points wins (more "central" = more likely to be authoritative).
  - **Tiebreaker 3:** If still tied, deterministic merge (concatenate unique payload keys, keep most recent value).
- Server updates to B's payload. Both devices' next sync pulls B's state.

**Stage 5 — Convergence**
- After both devices have synced twice, all three states (A local, B local, central) are byte-identical for `p-001`.

### 5.3 Journey 3 — Battery Failure Mid-Sync

**Stage 1**
- Priya triggers sync. 50 photos in the WAL, 30 uploaded.

**Stage 2 — Phone dies at 3% battery**
- WAL is durable on disk. Next launch: app reads WAL, sees 20 unsent entries, resumes from where it left off (idempotent uploads keyed by point ID).

**Stage 3 — Recovery**
- No duplicate uploads. No data loss. Sync completes.

---

## 6. User Stories

> Each story follows the format: *As a [persona], I want to [action], so that [benefit].* Acceptance criteria are testable.

### 6.1 Capture Stories

**STORY-001: One-Shot Capture with Metadata**
- **As** Priya the field researcher,
- **I want** to take a photo and have it automatically tagged with the current GPS, timestamp, and project,
- **so that** I never lose the context of when and where I took it.

**Acceptance Criteria**
- AC-001.1: Capturing a photo stores the JPEG, the embedding (vector), and the payload `{device_id, captured_at (ISO-8601, UTC), lat (float), lng (float), project_id (string)}` in a single Qdrant Edge upsert operation.
- AC-001.2: If GPS is unavailable, the payload stores `lat=null, lng=null` and a `gps_status` field of `"unavailable"`.
- AC-001.3: If the embedding model fails to load, capture still succeeds but the photo is stored in a "pending embedding" queue and the user sees a subtle warning.
- AC-001.4: Capture latency from shutter tap to "Saved" toast is ≤800 ms on a Samsung Galaxy A35 for a 4 MP photo.

**STORY-002: Burst Capture**
- **As** Carlos the inspector,
- **I want** to hold down the shutter to take 5 photos rapidly,
- **so that** I can document a transient event without missing the moment.

**Acceptance Criteria**
- AC-002.1: The camera supports burst mode with up to 5 photos in a 2-second window.
- AC-002.2: Each burst photo is independently embedded and upserted; the UI shows incremental "Saved 1/5, 2/5, …" feedback.
- AC-002.3: Embedding inference is queued (not parallel) to avoid OOM on low-end devices.

**STORY-003: Project Tagging**
- **As** Priya,
- **I want** to set a "project" tag on my device that propagates to all photos I take until I change it,
- **so that** I don't have to retype it for every shot.

**Acceptance Criteria**
- AC-003.1: A "Project" picker is visible on the capture screen. Default is "Unassigned."
- AC-003.2: Changing the project updates a stored preference and applies to subsequent captures.
- AC-003.3: Projects are stored locally; no project metadata ever requires network to function.

### 6.2 Search Stories

**STORY-010: Offline Text Search**
- **As** Priya,
- **I want** to type a description of a scene I remember and see matching photos,
- **so that** I can find evidence without scrolling.

**Acceptance Criteria**
- AC-010.1: Search bar is reachable from the home screen with one tap.
- AC-010.2: Entering "river pollution" and tapping search returns up to 20 photos ranked by CLIP cosine similarity between the text embedding and each photo's image embedding.
- AC-010.3: Search works with airplane mode ON; no network requests are issued (verifiable in DevTools/Flipper network tab).
- AC-010.4: End-to-end search latency (text → embedding → query → render) is ≤700 ms for libraries up to 5,000 photos on the target device.
- AC-010.5: Empty search shows a hint, not an error.

**STORY-011: Search Refinement with Filters**
- **As** Priya,
- **I want** to narrow my search by date range and project,
- **so that** I can find photos from "last week's trek only."

**Acceptance Criteria**
- AC-011.1: A filter sheet exposes date range (from/to) and project (multi-select).
- AC-011.2: Filters translate to Qdrant Edge `Filter` objects combining `FieldCondition` on `captured_at` (range) and `project_id` (match any).
- AC-011.3: Search results update within 200 ms of filter change.

**STORY-012: Search Result Tap → Full Screen**
- **As** Priya,
- **I want** to tap a search result and see the full photo with all metadata,
- **so that** I can verify the match before sharing it.

**Acceptance Criteria**
- AC-012.1: Tapping a result opens a detail screen with the full image, timestamp, GPS, project, and (if synced) enrichment tags.
- AC-012.2: The detail screen supports pinch-to-zoom.
- AC-012.3: A "Share" button generates a `file://` URL for export to other apps (v1: OS share sheet).

### 6.3 Sync Stories

**STORY-020: Manual Sync Trigger**
- **As** Priya,
- **I want** to tap "Sync now" when I reach connectivity,
- **so that** I control when bandwidth is consumed.

**Acceptance Criteria**
- AC-020.1: A "Sync" button is visible on the home screen with a badge showing the count of pending uploads.
- AC-020.2: Tapping it starts a sync run; progress is shown.
- AC-020.3: Sync is idempotent; re-tapping mid-sync does not corrupt state.

**STORY-021: Automatic Background Sync**
- **As** Priya,
- **I want** the app to auto-sync when Wi-Fi is available and battery is above 30%,
- **so that** I don't have to remember.

**Acceptance Criteria**
- AC-021.1: A settings toggle enables/disables auto-sync.
- AC-021.2: Auto-sync only fires when (a) Wi-Fi connected, (b) battery ≥ 30% or charging, (c) app is foregrounded.
- AC-021.3: Auto-sync respects the user's "Wi-Fi only" preference.

**STORY-022: Sync Conflict Visibility**
- **As** Priya,
- **I want** to see when a conflict was resolved and which version won,
- **so that** I trust the system.

**Acceptance Criteria**
- AC-022.1: After sync, a "Sync report" screen shows: N uploaded, M conflicts, K resolved by [timestamp|vector-sim|merge].
- AC-022.2: Tapping a conflict row shows the two payloads and which fields changed.
- AC-022.3: The user can manually override the auto-resolution (v1: read-only — see Backend & DB doc Section 9.6 for v2 manual override design).

### 6.4 Data Integrity Stories

**STORY-030: WAL Durability**
- **As** Priya,
- **I want** to know that photos I take offline are durable even if the app crashes,
- **so that** I trust the system in low-battery, unstable conditions.

**Acceptance Criteria**
- AC-030.1: Every capture writes to the WAL before the "Saved" toast is shown.
- AC-030.2: Killing the app mid-capture leaves the photo on disk and indexed on next launch.
- AC-030.3: The WAL is append-only and rotated when it exceeds 10 MB.

**STORY-031: Schema Versioning**
- **As** Manas the developer,
- **I want** every point payload to carry a schema version,
- **so that** future payload migrations don't break old data.

**Acceptance Criteria**
- AC-031.1: Every payload has `schema_version: 1` (current).
- AC-031.2: On read, if a payload's version is older, a migration function runs (no-op in v1).

### 6.5 Developer-Facing Stories

**STORY-040: One-Command Bootstrap**
- **As** a hackathon judge cloning the repo,
- **I want** to run a single command and have the app buildable,
- **so that** I can evaluate the entry in 10 minutes.

**Acceptance Criteria**
- AC-040.1: `pnpm install` at the repo root installs all dependencies.
- AC-040.2: `pnpm ios` builds the iOS app; `pnpm android` builds Android.
- AC-040.3: The Rust bridge compiles from source via `pnpm build:native` (which invokes `cargo build --release` for both iOS and Android targets).
- AC-040.4: A `README.md` walks through every step.

**STORY-041: Reproducible Demo**
- **As** a judge,
- **I want** to run a seeded demo without setting up real photos,
- **so that** I can see the offline→online flow immediately.

**Acceptance Criteria**
- AC-041.1: A `pnpm demo:seed` command populates the local Edge shard with 50 sample photos (drawn from a small CC0 dataset bundled in `/assets/seed`).
- AC-041.2: After seeding, search and sync behave identically to a real-world capture session.

---

## 7. Functional Requirements

> FRs are numbered FR-001 upward. Each FR has: priority (P0 critical, P1 important, P2 nice-to-have), the Edge component scope (device/server/both), a precise statement, and rationale. P0 must be complete for the hackathon submission; P1 is required for the Paytm-office demo; P2 is stretch.

### 7.1 Capture Subsystem

**FR-001 [P0, device]** The application shall capture a photo via the device camera and persist it as a JPEG file in local app storage under `/<project_id>/<device_id>/<photo_id>.jpg`.
- Rationale: Photos are first-class artifacts. Everything else attaches to them.

**FR-002 [P0, device]** The application shall generate a 512-dimensional image embedding for each captured photo using CLIP-ViT-B/32 (int8 quantized) executed via ONNX Runtime Mobile.
- Rationale: CLIP's shared text-image embedding space enables text-to-image search, which is the demo's defining feature.

**FR-003 [P0, device]** The application shall upsert each captured photo's embedding into the local Qdrant Edge shard as a single point with the payload schema defined in Section 7.5.
- Rationale: Local Edge shard is the source of truth for offline search.

**FR-004 [P0, device]** The application shall capture EXIF GPS coordinates (lat, lng) at shutter time and attach them to the point payload.
- Rationale: GPS is the most useful single piece of metadata for field work.

**FR-005 [P0, device]** The application shall capture timestamp (UTC, ISO-8601, millisecond precision) at shutter time.
- Rationale: Enables chronological ordering and conflict resolution.

**FR-006 [P1, device]** The application shall allow the user to set/change the active project tag from the capture screen.
- Rationale: See STORY-003.

**FR-007 [P1, device]** The application shall support burst capture (up to 5 photos in 2 seconds).
- Rationale: See STORY-002.

**FR-008 [P2, device]** The application shall capture short video clips (≤10 seconds) and persist them with a perceptual hash instead of a CLIP embedding.
- Rationale: Video embedding on mobile is out of v1 scope; perceptual hash + metadata is the compromise.

### 7.2 Embedding Subsystem

**FR-010 [P0, device]** The application shall load the CLIP model from app-bundled assets on first launch and cache it in ONNX Runtime's persistent session cache.
- Rationale: Avoid re-loading 60 MB model on every cold start.

**FR-011 [P0, device]** The application shall execute CLIP image inference on a background thread (not the UI thread).
- Rationale: UI must remain responsive; mid-range Android inference takes 200-500 ms.

**FR-012 [P0, device]** The application shall apply image preprocessing (resize to 224×224, center crop, normalize with CLIP mean/std) before inference.
- Rationale: CLIP requires fixed input shape and normalization.

**FR-013 [P1, device]** The application shall warm up the ONNX Runtime session on app launch (one dummy inference) so the first real capture is fast.
- Rationale: Cold-start latency for ONNX is ~500 ms; warm session is ~50 ms.

**FR-014 [P1, device]** If ONNX Runtime fails to initialize, the app shall continue to function in "degraded mode": photos are saved but marked `embedding_status="failed"` and excluded from semantic search.
- Rationale: Better than crashing.

**FR-015 [P1, device]** The application shall expose a text-encoder function for search queries that produces a 512-dim embedding in the same space as image embeddings.
- Rationale: Required for text-to-image search.

### 7.3 Local Storage Subsystem

**FR-020 [P0, device]** The application shall maintain a Qdrant Edge shard on disk at `<app_docs>/edge-shard/` with the configuration defined in Section 7.4.
- Rationale: Persistence across app restarts.

**FR-021 [P0, device]** The application shall wrap the Rust `qdrant-edge` crate via UniFFI-generated bindings and expose a TypeScript API surface: `create`, `load`, `upsertPoints`, `query`, `retrieve`, `optimize`, `close`.
- Rationale: Section 1.4 — the Rust bridge is the core technical achievement.

**FR-022 [P0, device]** The application shall maintain a write-ahead log (WAL) at `<app_docs>/wal.log` that records every local write before it is durably committed to the Edge shard.
- Rationale: Durability across crashes.

**FR-023 [P0, device]** The application shall maintain a local SQLite metadata DB at `<app_docs>/metadata.sqlite` for: photo file path index, project definitions, sync state per point.
- Rationale: Qdrant payload is good for searchable fields but not for relational sync state.

**FR-024 [P0, device]** The application shall enforce a per-device photo cap of 5,000 by default with a settings override.
- Rationale: Prevent uncontrolled storage growth on low-end devices.

### 7.4 Edge Shard Configuration

**FR-030 [P0, device]** The Edge shard shall be configured with:
- Vector name: `clip`
- Vector dimension: 512
- Distance: `Cosine`
- Quantization: `Scalar` (int8)
- Optimizers: `EdgeOptimizersConfig(deleted_threshold=0.2, vacuum_min_vector_number=100, default_segment_number=2)`
- max_search_threads: 4
- WAL enabled
- Rationale: Matches Qdrant Edge best practices for mobile workloads.

### 7.5 Payload Schema (Per Point)

**FR-031 [P0, device+server]** Every point payload shall conform to:

```json
{
  "schema_version": 1,
  "photo_id": "uuid-v4-string",
  "device_id": "uuid-v4-string (per app install)",
  "captured_at": "2025-05-12T14:23:01.123Z",
  "lat": 13.4521,
  "lng": 75.1234,
  "gps_status": "ok | unavailable | denied",
  "project_id": "string",
  "file_path": "relative/path/from/app_docs",
  "embedding_status": "ok | pending | failed",
  "enrichment_id": "string | null",
  "enrichment_tags": ["string"],
  "enrichment_objects": [{"label": "string", "box": [x, y, w, h], "confidence": float}],
  "enrichment_text": "string | null",
  "synced_at": "ISO-8601 | null",
  "local_updated_at": "ISO-8601",
  "vector_checksum": "sha256:hex"
}
```

### 7.6 Search Subsystem

**FR-040 [P0, device]** The application shall provide a text-input search that embeds the query with the CLIP text encoder and runs `Query.Nearest` against the local Edge shard.
- Rationale: The hero feature.

**FR-041 [P0, device]** The application shall support combining vector search with payload filters (`project_id`, `captured_at` range) via Qdrant Edge `Filter` objects.
- Rationale: STORY-011.

**FR-042 [P0, device]** The application shall display search results as a thumbnail grid (3 columns portrait, 5 landscape) with similarity score badge.
- Rationale: Information density.

**FR-043 [P1, device]** The application shall support search result pagination (load more) for libraries >100 photos.
- Rationale: Performance.

### 7.7 Sync Subsystem

**FR-050 [P0, device]** The application shall implement a sync orchestrator that runs when connectivity is detected and (a) replays the WAL for unsent points, (b) fetches cloud-side updates, (c) resolves conflicts.
- Rationale: The sync story is the technical climax of the demo.

**FR-051 [P0, device]** The application shall upload new points to the central Qdrant cluster via a sync API endpoint (`POST /sync/upload`).
- Rationale: Central cluster is Mihir's dashboard source of truth.

**FR-052 [P0, device]** The application shall fetch cloud-only updates via `GET /sync/pull?since=<cursor>` and apply them locally.
- Rationale: Bidirectional sync.

**FR-053 [P0, server]** The sync API shall return enrichment-enriched payloads as part of the pull response so the edge learns about cloud tags without a separate round trip.
- Rationale: Reduces round trips; Mihir's pipeline writes enrichment once, edge picks it up on next pull.

**FR-054 [P0, device+server]** Both sides shall detect conflicts by comparing `local_updated_at`, `captured_at`, and `vector_checksum`.
- Rationale: Deterministic conflict detection.

**FR-055 [P0, device+server]** Conflict resolution shall follow the algorithm defined in Backend & DB doc Section 9.6 (timestamp > vector-sim > merge).
- Rationale: Predictable behavior judges can interrogate.

**FR-056 [P1, device]** The application shall display a sync report (uploaded / conflicts / errors) after each sync run.
- Rationale: STORY-022.

### 7.8 Camera & Permissions

**FR-060 [P0, device]** The application shall request camera and location permissions on first capture attempt.
- Rationale: OS requirement.

**FR-061 [P0, device]** The application shall gracefully handle permission denial: capture is disabled with a settings deep-link.
- Rationale: UX.

**FR-062 [P1, device]** The application shall request photo library write permission only when the user explicitly exports a photo.
- Rationale: Privacy.

### 7.9 Native Bridge (Rust → RN)

**FR-070 [P0, native]** The Rust core crate (`field-edge-rust`) shall expose the following C-ABI functions via UniFFI:
- `edge_create(directory, config_json) -> EdgeHandle`
- `edge_load(directory) -> EdgeHandle`
- `edge_upsert_points(handle, points_json) -> Result<()>`
- `edge_query(handle, request_json) -> String (JSON results)`
- `edge_retrieve(handle, ids_json) -> String`
- `edge_optimize(handle) -> Result<()>`
- `edge_close(handle) -> Result<()>`
- `edge_sync_diff(local_state_json, remote_state_json) -> String (JSON diff)`
- Rationale: UniFFI-generated bindings require a C-ABI surface; these names map 1:1 to TypeScript methods.

**FR-071 [P0, native]** The native iOS module shall wrap the UniFFI-generated Swift bindings and expose them to React Native via a JSI/TurboModule.
- Rationale: Modern RN architecture.

**FR-072 [P0, native]** The native Android module shall wrap the UniFFI-generated Kotlin bindings and expose them to React Native via a TurboModule.
- Rationale: Modern RN architecture.

**FR-073 [P0, native]** The TypeScript wrapper `@field-edge/react-native` shall provide type-safe access to the native module and SHALL NOT re-export Qdrant types directly — it shall expose a domain-specific API (`fieldEdge.upsertPhoto(point)` not `fieldEdge.upsertPoint(vector, payload)`).
- Rationale: API ergonomics; domain language beats raw storage language.

### 7.10 Sync API Server

**FR-080 [P0, server]** The sync API shall be a FastAPI application exposing:
- `POST /sync/upload` — accepts a batch of points, returns ack with conflict info.
- `GET /sync/pull?since=<cursor>&device_id=<id>` — returns cloud-side updates since cursor.
- `GET /sync/heartbeat` — liveness check.
- `POST /sync/wal/replay` — recovers from interrupted uploads.
- Rationale: See Backend & DB doc Section 3 for full spec.

**FR-081 [P0, server]** The sync API shall authenticate via a device-token issued at first install and stored in the device's secure enclave.
- Rationale: Prevents random uploads.

**FR-082 [P1, server]** The sync API shall batch uploads (≤100 points per request).
- Rationale: Network efficiency on 2G/3G.

### 7.11 Cloud Enrichment Handoff

**FR-090 [P0, server]** When the central Qdrant cluster receives a new point via the sync API, it shall trigger Mihir's separate enrichment pipeline (out of scope for this PRD but referenced here for the contract).
- Rationale: Cross-track contract.

**FR-091 [P0, server]** Enrichment results shall be written back to the same point's payload under `cloudinary_*` fields and SHALL NOT modify `vector`, `device_id`, `captured_at`, or `lat`/`lng`.
- Rationale: Enrichment is additive, never destructive.

---

## 8. Non-Functional Requirements

### 8.1 Performance

**NFR-001 [P0]** End-to-end capture latency (shutter → "Saved" toast) shall be ≤800 ms on Samsung Galaxy A35.
- Measurement: 95th percentile, 100 captures.

**NFR-002 [P0]** Search latency (text input → first result render) shall be ≤700 ms on a 5,000-photo library.
- Measurement: 95th percentile, 10 different queries.

**NFR-003 [P0]** Embedding inference shall complete in ≤400 ms on the target device for a 4 MP photo.
- Measurement: 95th percentile.

**NFR-004 [P0]** The local Edge shard query shall complete in ≤50 ms for `k=20` against 5,000 vectors.
- Measurement: 95th percentile.

**NFR-005 [P1]** Sync upload throughput shall achieve ≥5 photos/second on a 10 Mbps uplink.
- Measurement: end-to-end, including HTTPS overhead.

**NFR-006 [P1]** Cold-start time (app launch → camera ready) shall be ≤3 seconds.
- Measurement: 95th percentile.

**NFR-007 [P2]** App memory footprint while idle shall be ≤250 MB on Android, ≤300 MB on iOS.
- Measurement: RSS after 5 minutes idle.

### 8.2 Reliability

**NFR-010 [P0]** No captured photo shall be lost across an app crash, OS kill, or device reboot.
- Test: simulate `kill -9` mid-capture; verify next launch recovers the photo.

**NFR-011 [P0]** Sync shall be idempotent: re-uploading the same point ID with the same payload produces a no-op.
- Test: run sync twice; verify only one network request per point.

**NFR-012 [P0]** The Edge shard shall survive abrupt termination: no corruption on `kill -9` mid-write.
- Test: kill the app during a heavy upsert burst; reload; verify shard integrity.

**NFR-013 [P1]** Sync shall resume from the last successful point after a network drop.
- Test: kill network mid-sync; reconnect; verify continuation.

### 8.3 Security & Privacy

**NFR-020 [P0]** No photo, embedding, or payload field shall leave the device unless the user explicitly triggers sync (or auto-sync is enabled and the conditions are met).
- Audit: code review + network logging in development builds.

**NFR-021 [P0]** The device token for the sync API shall be stored in iOS Keychain / Android Keystore, never in plaintext.
- Implementation: `react-native-keychain` or platform-native equivalents.

**NFR-022 [P0]** All network calls shall use HTTPS (TLS 1.3 minimum).
- Configuration: enforce at the HTTP client level.

**NFR-023 [P1]** The sync API shall rate-limit per device (60 requests/minute) to prevent abuse.
- Implementation: token-bucket per device_id.

**NFR-024 [P2]** Photos shall be encrypted at rest using platform-native encryption (Android EncryptedSharedPreferences, iOS NSFileProtection).
- Implementation: out of v1 unless time permits.

### 8.4 Scalability

**NFR-030 [P0]** The central Qdrant cluster shall handle ≥10,000 vectors without index rebuild.
- Free tier of Qdrant Cloud supports this.

**NFR-031 [P1]** The sync API shall handle ≥100 concurrent device connections.
- FastAPI + uvicorn workers (≥4) on a 1 vCPU instance.

**NFR-032 [P2]** The local Edge shard shall scale to 50,000 vectors without UI degradation.
- Test: seed 50k synthetic vectors; measure search latency.

### 8.5 Portability

**NFR-040 [P0]** The mobile app shall build and run on iOS 16+ and Android 10+ (API 29+).
- Rationale: covers ~95% of active devices.

**NFR-041 [P0]** The sync API shall run on Linux (Ubuntu 22.04+) and macOS 13+.
- Rationale: developer diversity.

### 8.6 Maintainability

**NFR-050 [P0]** Code shall be formatted with Prettier (TS/JS) and `cargo fmt` (Rust) and verified in CI.
- Rationale: zero-style-debate PRs.

**NFR-051 [P0]** TypeScript shall run in strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Rationale: type safety.

**NFR-052 [P0]** Rust shall deny warnings (`#![deny(warnings)]`) and use `clippy` with `-D warnings`.
- Rationale: code quality.

**NFR-053 [P1]** Test coverage for the Rust core shall be ≥80%.
- Rationale: native code is hard to debug post-deploy.

**NFR-054 [P2]** Documentation site (mdBook or Docusaurus) shall be auto-generated from code comments.
- Rationale: future-self appreciation.

### 8.7 Observability

**NFR-060 [P1]** The mobile app shall log structured events (capture, search, sync) at INFO level, errors at ERROR with stack traces.
- Implementation: `pino` or `winston` + transport to console in dev, file in prod.

**NFR-061 [P2]** The sync API shall expose Prometheus `/metrics` for request counts and latencies.
- Implementation: `prometheus-fastapi-instrumentator`.

### 8.8 Localization (Out of Scope for Hackathon)
- English only in v1. Internationalization deferred.

---

## 9. Success Metrics and KPIs

### 9.1 Hackathon Selection Metrics (First Round → Final Round at Paytm)

| Metric | Target | How Measured |
|---|---|---|
| Demo video completion rate | 100% of required flow shown offline→online | Video review |
| Reproducible build | `pnpm install && pnpm ios` works on a fresh Mac | Judge reproduction |
| Rust bridge functional | Real Qdrant Edge ops via Rust→RN | Code review |
| README clarity | 1st-time setup ≤10 min | Time-to-first-screenshot |

### 9.2 Paytm-Office Demo Metrics (Live Presentation)

| Metric | Target |
|---|---|
| Demo duration | ≤3 minutes |
| Offline search accuracy | ≥7 of 10 judges' ad-hoc queries return relevant results in top-5 |
| Sync success | 100% of pre-seeded photos appear in Mihir's dashboard within 5 sec |
| No-demo-failure rate | ≥95% across dry runs |

### 9.3 Engineering Quality Metrics

| Metric | Target |
|---|---|
| Lines of code (edge app) | ~3-5k TS, ~1.5-2k Rust |
| Test pass rate | 100% on CI |
| Bundle size impact | Rust crate ≤8 MB per platform arch |
| Cold start | ≤3 sec |

### 9.4 Post-Hackathon (Stretch)
- Public GitHub stars ≥50 in week 1.
- Blog post or conference talk submission.

---

## 10. Product Scope (In / Out)

### 10.1 In Scope (Hackathon v1)

- ✅ React Native iOS + Android app
- ✅ Custom Rust bridge to Qdrant Edge via UniFFI
- ✅ Local CLIP-ViT-B/32 int8 embeddings via ONNX Runtime
- ✅ Local Edge shard with scalar quantization
- ✅ Offline semantic search (text → image)
- ✅ Manual + background sync to central Qdrant cluster
- ✅ Conflict resolution (timestamp + vector-sim + merge)
- ✅ WAL for durability
- ✅ Project tagging
- ✅ Burst capture
- ✅ Sync report UI
- ✅ Demo seed dataset
- ✅ 3-minute demo video
- ✅ Comprehensive README + 4 spec docs

### 10.2 Out of Scope (Deferred)

- ❌ Multi-user accounts / auth providers (device tokens only)
- ❌ Video semantic embedding (perceptual hash only)
- ❌ Peer-to-peer device sync (central cluster only)
- ❌ Server-side analytics dashboard (Mihir's track owns this)
- ❌ enrichment integration (Mihir's track owns this)
- ❌ iPad / tablet optimized layouts
- ❌ Encrypted at-rest photos (platform-native only)
- ❌ Background uploads when app is killed
- ❌ Web client

---

## 11. Release Criteria

### 11.1 "Done" Definition for the Hackathon Submission

The submission is considered ready when:

1. **All P0 FRs are implemented and tested.**
2. **All P0 NFRs are met or have documented exceptions.**
3. **The 3-minute demo video is recorded, edited, and uploaded.**
4. **The README walks a fresh-clone judge from zero to a working offline search in ≤10 minutes.**
5. **No `TODO`s, `FIXME`s, or `console.log("DEBUG")` lines in the production build.**
6. **No secrets in the repo** (`.env.example` only).
7. **`pnpm test` and `cargo test` both pass on CI.**
8. **The Rust bridge compiles for both iOS and Android targets.**
9. **The demo seed dataset is committed (≤50 MB total, CC0 licensed).**
10. **A backup fallback to Qdrant local-mode is in place** in case the Rust bridge hits a blocker on the target device, with documentation explaining the tradeoff.

### 11.2 "Done" Definition for the Paytm-Office Round

In addition to Section 11.1:

1. The live demo runs without a script (judges may interrupt with questions).
2. The Rust bridge has a 1-slide explanation ready (architecture diagram).
3. The team can answer technical questions on: quantization choice, conflict-resolution algorithm, sync diff format, WAL durability.

---

## 12. Milestones and Timeline

The hackathon window is **~10 days** (deadline 2025-10-03). Below is the day-by-day plan for the edge track. Mihir's track runs in parallel with the shared contract (sync API) locked on Day 1.

| Day | Manas (Edge) | Shared |
|---|---|---|
| **Day 1** | Scaffold RN app, init Rust crate, UniFFI bindings, "Hello edge_create" smoke test | Lock sync API contract (Section 7.7) |
| **Day 2** | Wire `edge_create`/`edge_load`/`upsert`/`query` end-to-end through TypeScript | Deploy stub sync API to Railway |
| **Day 3** | CLIP model load + inference pipeline + first embedding in Edge | Connect central Qdrant cluster |
| **Day 4** | Capture screen + camera + EXIF GPS extraction | Sync API `/upload` and `/pull` working with stub enrichment |
| **Day 5** | Search screen + CLIP text encoder + result grid | Conflict-resolution algorithm implemented |
| **Day 6** | Sync orchestrator + WAL + idempotency | First end-to-end offline→online flow |
| **Day 7** | Sync report UI + auto-sync toggle + demo seed | Polish, error states, edge cases |
| **Day 8** | Buffer / bug bash | Buffer / bug bash |
| **Day 9** | Demo video recording | Demo video recording (combined) |
| **Day 10** | Submission packaging, README final pass | Submission packaging |

### 12.1 Day-1 Critical Path (Read This Twice)

- **Morning:** Scaffold the Rust crate (`cargo new --lib field-edge-rust`). Add `qdrant-edge` as a dependency. Write the UniFFI UDL file. Get `cargo build` to succeed.
- **Afternoon:** Wire UniFFI to generate Swift/Kotlin bindings. Create the React Native TurboModule skeleton that wraps them. Verify `edge_create` returns a handle from JavaScript.
- **End of Day 1:** A tiny RN screen that calls `fieldEdge.create('./test-shard')` and logs "Created shard successfully." If this works, every other day is incremental.

### 12.2 Decision Gates

- **Day 3 EOD:** If CLIP is not running on-device, fall back to server-side embedding for the demo (still satisfies PS but loses some wow factor). Document the decision.
- **Day 5 EOD:** If sync orchestrator is not end-to-end, the demo video cannot show the full flow. Escalate immediately.

---

## 13. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | UniFFI bindings fail to compile for one platform (iOS or Android) | Medium | High | Day 1 smoke test both platforms. Have a fallback: skip UniFFI, use `cargo-ndk` + manual JNI bindings (Android) and Swift Package Manager with manual FFI (iOS). Document the fallback path in TRD. |
| R-02 | CLIP int8 model accuracy is too low for the demo queries | Medium | High | Test with the seed dataset on Day 2. If accuracy is poor, fall back to fp16 (~120 MB) or use a smaller model (e.g., MobileCLIP-S2). |
| R-03 | Rust→RN JSI bridge has a serialization bottleneck | Medium | Medium | Benchmark with 1k vectors on Day 2. If slow, switch to binary FFI for vector payloads (bincode or postcard). |
| R-04 | Sync API server cold-starts on free-tier Railway (sync latency spikes) | High | Medium | Implement client-side retry with exponential backoff. Add a "warm-up" cron job. |
| R-05 | Qdrant Edge beta API changes mid-hackathon | Low | High | Pin to a specific version in `Cargo.toml`. Note in README that Edge SDK is in beta. |
| R-06 | Demo video recording fails on Day 9 | Medium | High | Record multiple takes on Day 8. Have a screen-capture fallback. |
| R-07 | Mihir's track runs behind | Medium | High | Day 1 sync contract locks the API. Mihir can stub his side; Manas can stub the cloudinary_* fields with `null` initially. |
| R-08 | Mid-range Android device cannot run CLIP in <1 sec | Medium | Medium | Document target devices clearly. Use Galaxy A35 / Pixel 6a as benchmarks. If needed, switch to ONNX Runtime with NNAPI acceleration. |
| R-09 | Qdrant cluster free-tier rate limit hits during demo | Medium | Medium | Pre-warm the cluster with seed data before the demo. Have a backup local-mode fallback on the dashboard side. |
| R-10 | Time-zone differences between team members cause coordination issues | Low | Medium | Daily 15-min sync at fixed time. Async-first updates in shared Slack/Discord channel. |

---

## 14. Assumptions and Constraints

### 14.1 Assumptions

- AS-01: Hackathon judges will run the iOS or Android app on a real device or simulator with internet access at the time of evaluation.
- AS-02: A modern Mac with Xcode 15+ is available for iOS builds.
- AS-03: A modern Linux or macOS machine is available for Android builds and Rust compilation.
- AS-04: The Qdrant Cloud free tier remains available for the duration of the hackathon.
- AS-05: enrichment's free tier provides enough credits for the demo dataset (50 photos + a few videos).
- AS-06: Judges are familiar with React Native but not necessarily with Rust or Qdrant Edge specifically.

### 14.2 Constraints

- C-01: Submission deadline is **2025-10-03** (hard).
- C-02: Team is 2 people.
- C-03: Total development budget is ~10 days.
- C-04: Final round is at Paytm office; demo must run offline-resilient.
- C-05: The chosen problem statements are PS03 (Qdrant Edge) and PS02 (enrichment); submission must address both.
- C-06: All code must be open-source-compatible (no proprietary dependencies that block judges from running it).

---

## 15. Glossary

| Term | Definition |
|---|---|
| **Edge Shard** | A Qdrant Edge self-contained storage unit that operates in-process. Analogous to an SQLite database file but for vector search. |
| **WAL** | Write-Ahead Log. An append-only log of writes that must be flushed to durable storage before the operation is acknowledged. |
| **CLIP** | Contrastive Language-Image Pre-training. A model that produces embeddings in a shared space for images and text, enabling text-to-image search. |
| **UniFFI** | Mozilla's tool for generating foreign-function interface bindings from Rust to multiple languages (Swift, Kotlin, Python, etc.). |
| **TurboModule** | React Native's modern (post-2022) native module API, leveraging JSI for synchronous, low-overhead calls. |
| **JSI** | JavaScript Interface. React Native's low-level bridge between JS and native code. |
| **Cosine similarity** | Distance metric for vectors: 1 = identical direction, 0 = orthogonal, -1 = opposite. Used by CLIP because it cares about semantic direction, not magnitude. |
| **Scalar quantization (int8)** | Reducing vector precision from fp32 to int8. ~4× smaller, ~4× faster search, typically <1% accuracy loss on cosine distance. |
| **WAL replay** | On startup or after crash, reading the WAL and applying any uncommitted writes to the Edge shard. |
| **Conflict resolution** | When the same point ID exists locally and remotely with different payloads, deciding which version wins. |
| **Differential sync** | Sending only the changes (adds, updates, deletes) rather than the entire state. |
| **Device token** | A per-install opaque string used to authenticate the sync API. Stored in Keychain/Keystore. |
| **HNSW** | Hierarchical Navigable Small World. The graph-based approximate nearest neighbor algorithm Qdrant uses. |
| **Payload** | The JSON metadata attached to each vector point. Searchable via Qdrant's filter expressions. |
| **Point** | The atomic unit in Qdrant: a vector + a payload + a unique ID (string or integer). |
| **Cosine** | Distance function. Returns 0 for identical vectors, 2 for opposite. We use `1 - cosine` for similarity scoring in UI. |
| **Ack** | Acknowledgment — server's response confirming receipt of an upload. |
| **Cursor** | Opaque pagination token for sync pulls. The server returns a new cursor with each response; the client passes it back to get only newer items. |

---

**End of PRD Part 2. Next: TRD (Technical Requirements Document).**
