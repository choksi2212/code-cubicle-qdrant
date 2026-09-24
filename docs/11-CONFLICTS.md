# Conflict resolution

This document describes how FieldEdge detects, resolves, and audits
**sync conflicts** — cases where two devices (or one device and the
central cluster) have divergent versions of the same photo.

> **Why this matters.** A conflict that resolves silently is a
> liability for an enterprise. A site engineer should be able to open
> the app and see *"your photo was replaced by a newer version from
> your colleague's tablet"*, inspect both copies, and (eventually) take
> manual action if the auto-resolution was wrong.

---

## How conflicts are detected

A conflict occurs when the device tries to upload a point whose
`vector_checksum` differs from the one already in Qdrant for the same
`photo_id`. The detection happens server-side, in
`apps/sync-api/app/routers/sync.py::upload_points`:

1. The device sends a batch of points (`POST /sync/upload`).
2. For each point, the server reads the existing record from Qdrant.
3. If `existing.payload.vector_checksum == new.payload.vector_checksum`,
   the upload is **idempotent** (`accepted`).
4. If the checksums differ, the server treats it as a conflict and
   invokes the resolution rule.

A second detection path lives client-side in
`apps/mobile/src/services/sync.ts::runSync` (pull loop): when the
device pulls a remote point whose `local_updated_at` is older than the
device's local copy, the device skips the upsert and counts it as a
locally-resolved conflict.

---

## How they're resolved

The server applies a **last-writer-wins** rule keyed on
`local_updated_at`:

| Condition                                                  | Result              | Winner in audit UI |
|------------------------------------------------------------|---------------------|--------------------|
| `local_updated_at` is newer than (or equal to) remote       | local wins          | `local`            |
| `local_updated_at` is older than remote                    | remote wins         | `remote`           |
| `vector_checksum` matches (idempotent)                     | no real conflict    | `merged`           |

This rule is implemented in two places, intentionally kept in lock-step:

- `apps/sync-api/app/routers/sync.py` — the authoritative resolution
  that writes the winner to Qdrant.
- `apps/sync-api/app/routers/conflicts.py::_resolve_winner` — a
  duplicate used for the audit endpoint, so it stays consistent with
  the resolver without creating an import-time dependency on the live
  router (which other agents are editing in parallel). The module
  docstring is the cross-reference.

When the server resolves in favour of local, it stamps
`server_version` on the merged payload so clients can detect the bump
on a subsequent pull.

---

## Where the audit trail lives

The audit endpoint reads two things out of the central Qdrant
collection:

- **`remote`** — the point's current Qdrant payload (the winner, or
  the merged result).
- **`local`** — the payload as the device's most-recent upload saw
  it, read from a private `_local_snapshot` payload field that the
  upload router writes on every successful upload (overwriting the
  previous snapshot).

The upload router is responsible for stamping `_local_snapshot` on
each accepted / conflict-resolved point. That stamping is a single
additional payload field on the existing upsert — no new endpoint, no
new collection.

> **Note.** v1 keeps only the *latest* local snapshot. Full per-version
> history would live in a dedicated `conflict_log` collection; that's a
> follow-up.

The audit endpoint itself:

```
GET /sync/conflicts/{photo_id}
Authorization: Bearer <access JWT>

200 OK
{
  "photo_id": "uuid",
  "local":      <PointPayload | null>,
  "remote":     <PointPayload>,
  "winner":     "local" | "remote" | "merged",
  "fields_changed": ["enrichment_text", "tags_v2", ...],
  "resolved_at": "2026-09-24T10:00:02+00:00"
}

401 Unauthorized   — missing or invalid Bearer token
404 Not Found      — photo_id is unknown to Qdrant
503 Unavailable    — Qdrant unreachable
```

`fields_changed` is computed server-side by diffing the top-level
payload fields between `local` and `remote` (skipping private
underscore-prefixed fields). It's empty when `winner == merged`
(payloads were identical).

---

## How the audit is surfaced in the UI

The mobile app surfaces conflicts in two places:

1. **`SyncReportScreen`** — after every sync run, if any conflicts
   were detected, a "Conflicts" section appears below the standard
   counts. Each row shows the short photo id, the winner, and the
   fields that changed. Tapping a row navigates to
   **`ConflictDetailScreen`**.
2. **`ConflictDetailScreen`** — renders the full `ConflictDetail`
   payload as three panels (Local, Remote, Resolution). Useful for a
   user who wants to compare the two copies field-by-field.

Both screens are offline-aware: the API call has a 30-second
AbortController timeout and surfaces a human-readable error state on
non-2xx responses.

---

## Out of scope — manual override

A user-facing "force remote wins" / "force local wins" button is
**deliberately out of scope** for this milestone. Adding it would
require:

- A new endpoint (`POST /sync/conflicts/:photo_id/override`) that
  re-writes the central point.
- A client-side confirmation flow (preventing accidental overwrites).
- A way to surface the override in the audit trail (so the chain
  stays trustworthy).

These are all reasonable follow-ups, but they need design review with
the data-integrity owner before shipping — auto-resolution may be
wrong sometimes, but a silent override could be worse.

When the manual override lands, the right home for it is on
`ConflictDetailScreen`, behind a long-press or a small "..." menu, so
the user has to consciously choose.
