# 10 — Album + Map views

Wave 2 feature for the FieldEdge mobile app. Adds two new browse paths
on top of the existing semantic search:

| View | Path | Best for |
|------|------|----------|
| Album | `apps/mobile/src/screens/AlbumScreen.tsx` | "show me what I shot last week" |
| Map   | `apps/mobile/src/screens/MapScreen.tsx` | "what did I capture near this point" |

The home (`SearchScreen`) now exposes a `Search | Album | Map` chip
strip that swaps the body of the screen.

---

## Why two more views?

Semantic search is great when the researcher knows the concept they're
looking for ("river pollution"). It's useless when they want to
re-visit what they did on Tuesday, or remember whether they already
photographed a particular streambank. Those are time- and
space-bucketed questions, not semantic ones.

---

## Album view

### Design

- **SectionList over FlatList** — five fixed recency buckets
  ("Today", "Yesterday", "This week", "This month", "Older") give the
  user a coarse time scrubber without us inventing arbitrary group
  boundaries. Buckets are computed in the user's local timezone (the
  day boundary is `Date(year, month, day)`, not UTC midnight).
- **Three columns** — matches the existing search grid; matches the
  physical aspect ratio of a phone held in two hands.
- **Empty state** — explicit "No photos yet" copy with a hint to
  capture, so a researcher on day one isn't staring at a blank grid
  wondering if the app is broken.

### Loading

`AlbumScreen` calls `fieldEdge.retrieve([])` once on mount. The local
shard is bounded by FR-024 (≤ 5 000 photos) so a single call is fine
— no pagination, no scroll-bound window. Pull-to-refresh
re-issues the same call.

### Reuse

The grid body is `PhotoGrid` (`apps/mobile/src/components/PhotoGrid.tsx`),
a reusable 3-column thumbnail component. AlbumScreen hands the
section data straight to it. SearchScreen already inlined its own grid;
future refactor can swap it over to `PhotoGrid`.

---

## Map view

### Offline-first design (v1)

We deliberately do **not** use a real map library
(`react-native-maps`, MapLibre, etc.) in v1. The implementation
(`apps/mobile/src/components/MapView.tsx`) is a pure `View` canvas
with absolute-positioned circles for each marker. Lat/lng axes are
labeled but the background is blank.

The three reasons:

1. **Privacy** — fetching map tiles hands the user's spatial trail to
   a third-party tile provider (Mapbox / Google / OSM). FieldEdge's
   whole pitch is "the shard never leaves the device" — leaking the
   density of a researcher's field site defeats that promise.
2. **Offline correctness** — field workers routinely go off-grid. A
   map that needs tile downloads breaks the moment they do. A
   pure-View overlay always renders.
3. **Bundle size + native deps** — `react-native-maps` pulls Google
   Play Services on Android (~15 MB APK growth) and a permission
   surface we don't want.

### Marker semantics

- **Size by recency** — fresh captures (last 30 days) get a 16 px
  accent-green dot; older ones fade to a 10 px gray.
- **Tap → metadata Alert** — for v1 the marker tap fires an
  `Alert.alert` with id/lat/lng/captured_at. A dedicated
  `PhotoPreviewScreen` is the v2 follow-up so the user sees the actual
  JPEG.
- **Bounding box** — computed from marker positions. If all markers
  share coords (degenerate case) the box expands to a ~100 m square
  so the marker is visible.

### Filter

Only points with `gps_status === "ok"` and non-null `lat`/`lng` are
plotted. `unavailable` / `denied` captures still appear in AlbumScreen
— they're spatial absences, not deletions.

### V2 follow-up — optional tile fetch

A future iteration will gate a real map behind a settings flag:

| Setting | Default | Privacy story |
|---------|---------|---------------|
| `mapTileSource: 'none'` | **yes** | Tiles never requested; pure offline. |
| `mapTileSource: 'mapbox'` | no | Requires a Mapbox token; tiles fetched on demand. |
| `mapTileSource: 'osm'` | no | Open Street Map tile servers; no token required but OSM privacy policy applies. |

When a non-`none` value is set, the `MapView` component will mount
`react-native-maps` behind the same marker projection. Until then,
v1 stays 100% offline.

---

## Performance notes

| Library size | Behaviour |
|--------------|-----------|
| ≤ 500 photos | Single `retrieve([])` call, render all sections, no virtualization tricks needed. |
| 500–2 000 | Still single call; `SectionList`'s built-in row recycling keeps memory flat. |
| 2 000–5 000 (FR-024 cap) | Still single call but we should add a "render window" — only mount `PhotoGrid` for the section currently in view. |
| > 5 000 | Hit FR-024 cap first; raise the cap or shard into multi-day albums. |

The shared `PhotoGrid` already uses `FlatList` so it virtualizes
within a section. Cross-section virtualization (don't mount grids
outside the viewport) is the next optimisation when we see real users
hitting the cap.

---

## Files

| Layer | File | Status |
|-------|------|--------|
| Screen | `apps/mobile/src/screens/AlbumScreen.tsx` | NEW |
| Screen | `apps/mobile/src/screens/MapScreen.tsx` | NEW |
| Component | `apps/mobile/src/components/PhotoGrid.tsx` | NEW |
| Component | `apps/mobile/src/components/MapView.tsx` | NEW |
| Screen | `apps/mobile/src/screens/SearchScreen.tsx` | MODIFIED (tab strip) |
| App | `apps/mobile/App.tsx` | MODIFIED (Screen union + branches) |
| Test | `apps/mobile/__tests__/PhotoGrid.test.tsx` | NEW (5 cases) |
| Test | `apps/mobile/__tests__/AlbumScreen.test.tsx` | NEW (5 cases, 2 snapshots) |
| Test | `apps/mobile/__tests__/MapScreen.test.tsx` | NEW (6 cases, 2 snapshots) |
