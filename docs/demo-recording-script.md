# FieldEdge 3-Minute Demo — Recording Script

**Audience:** Hackathon judges (Paytm, Qdrant, enrichment).
**Device:** Android phone with FieldEdge installed.
**Network:** Toggle airplane mode on/off.
**Pre-recording:** Make sure Qdrant Cloud has the 12 seed points uploaded (`scripts/seed-with-real-clip.py`).

---

## Timeline (180 seconds total)

| Time | Action | What to Show | What's Happening Technically |
|---|---|---|---|
| 0:00-0:15 | Cold open | Title card "FieldEdge — Offline-first AI for field workers" | — |
| 0:15-0:30 | The promise | "Watch a field worker capture photos with NO internet, search them with semantic AI, and sync them when they finally get signal." | — |
| 0:30-0:50 | Open the app | Toggle airplane mode ON. Open FieldEdge. Show the "Rust core v0.1.0, 12 points loaded" status bar. | The Kotlin app loads `libfield_edge_rust.so` via `System.loadLibrary`, calls `fe_open_shard` to open the embedded Edge shard, `fe_point_count` returns 12 (from the bundled seed) |
| 0:50-1:30 | **Demo moment 1: offline semantic search** | Tap the search bar. Type "river pollution". Show the result grid appearing with 12 photos. Tap one to view detail. **Note: airplane mode is still ON.** | `OnnxClipModule.embedText("river pollution")` runs real CLIP text encoder on-device → 512-dim vector → `fe_query` against local Edge shard → cosine similarity → top hits returned. **No internet touched.** |
| 1:30-1:50 | **Demo moment 2: capture offline** | Tap "Capture". Take 3 photos of the desk / a wall / anything (real photos). Show "Captured photo XXXXXX — saved offline." | `react-native-vision-camera` → JPEG → `captureGps()` reads device GPS via `@react-native-community/geolocation` and EXIF from JPEG → `OnnxClipModule.embedImage()` runs real CLIP vision encoder → 512-dim vector → `fe_upsertPoints` writes to local Edge shard → `fe_walAppend` queues for sync |
| 1:50-2:15 | **Demo moment 3: sync online** | Toggle airplane mode OFF. Tap "Sync now". Show the SyncReport screen with "Uploaded: 3, Downloaded: 0". | `runSync()` in `src/services/sync.ts` → reads WAL pending entries → `fieldEdge.computeSyncDiff()` against Qdrant Cloud snapshot → `apiClient.uploadBatch()` HTTP POST to sync API (FastAPI) → sync API writes to Qdrant Cloud via `qdrant-client` |
| 2:15-2:50 | **Demo moment 4: search finds the new photos** | Tap search bar, type "wall" or whatever the captured object was. Show the freshly-synced photos at the top. | `OnnxClipModule.embedText()` → fetch from sync API `/sync/pull` → upsert into local Edge shard → re-query → results include the new photos ranked by REAL CLIP semantic similarity |
| 2:50-3:00 | Closing | Show sync report one more time + "Built with custom Rust→JNI bridge, real ONNX CLIP inference, real Qdrant Cloud search — no placeholders." | — |

---

## Pre-Recording Checklist

- [ ] Android device connected via USB debugging (`adb devices` shows it)
- [ ] App installed: `adb install -r app-debug.apk`
- [ ] Camera permission granted
- [ ] Location permission granted
- [ ] Airplane mode starts ON
- [ ] Open the app before recording starts; verify "12 points loaded"
- [ ] Qdrant Cloud has 12 seed points: `python scripts/seed-with-real-clip.py`
- [ ] Sync API running: `python -m uvicorn app.main:app --port 8000`

## Recording Tips

1. **Show the status bar first** — judges should see "12 points, Rust v0.1.0" so they know there's real data + a real Rust bridge.
2. **Type slowly** — give CLIP inference time to show the latency. "River pollution" takes ~300ms.
3. **Toggle airplane mode visibly** — pull down the notification shade, tap the airplane icon, watch the network icon disappear/reappear.
4. **Show the sync report screen** — counts of uploaded/downloaded/conflicts are the technical proof.
5. **End on the architecture** — if time permits, show `adb logcat | grep FieldEdge` to reveal the native module logs.

## Post-Recording

- Trim to exactly 3:00
- Add captions (English)
- Upload to YouTube (unlisted)
- Add link to GitHub repo in description
- Submit via hackathon portal

---

## What this demo PROVES to judges

| Judge persona | What they'll see |
|---|---|
| **Qdrant judge** | Real Qdrant Cloud queries returning semantically-ranked results from real CLIP embeddings. Custom Rust→JNI bridge instead of using their JS SDK (which doesn't exist yet). |
| **enrichment judge** | The enrichment handoff is wired in the payload schema (`enrichment_id`, `enrichment_tags`, etc.) — points uploaded to Qdrant Cloud carry the metadata shape their API expects. |
| **Paytm judge** | The offline-first architecture is exactly what tier-2/3 merchant tooling needs. Airplane mode toggle demonstrates the resilience. |
