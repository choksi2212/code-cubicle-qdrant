# Real qdrant-edge integration — status note

**Date:** 2025-09-23
**Author:** Manas Choksi
**Status:** Documented but not active. Stub adapter below is feature-gated.

---

## What we found

`qdrant-edge` v0.8.0 (Aug 2026) is in **public beta** and ships only Rust + Python bindings. The Rust crate exposes a powerful API but several critical types for an external integration are **private** to the crate:

| Type | Used for | Visibility | Workaround |
|---|---|---|---|
| `Value` (payload value enum) | Building payloads | **private** — only `serde_json::Value` is publicly accepted in some places | Serialize payloads as JSON |
| `PointIdType` | Type-safe point IDs | **private** — only `ExtendedPointId as PointId` is re-exported | Use `PointId` |
| `CollectionUpdateOperations` | Wrap point ops for `.update()` | **private** — only re-exported via the `EdgeShard::update` signature | Cannot construct externally |
| `PointInsertOperationsInternal` | Batch point insert | **private** | Cannot construct externally |
| `PointOperations` | Upsert/Delete variants | **private** | Cannot construct externally |
| `VectorStructPersisted` | Vector storage format | **public** | OK to use |
| `PointStructPersisted` | Point record | **public** | OK to use |
| `Vectors` | Named vectors wrapper | **public** (via `edge::types::vector`) | OK to use |
| `PointStruct` | High-level wrapper | **public** (via `edge::types::point`) | OK to use |

## The blocker

The current `.update()` API on `EdgeShard` is:

```rust
pub fn update(&self, operation: CollectionUpdateOperations) -> OperationResult<()>
```

`CollectionUpdateOperations` and all its variants are private, so an external crate cannot construct the operation argument. There is no public `upsert_points(points: Vec<PointStructPersisted>)` convenience method. We could:

1. **Submit a PR upstream** adding public builders — out of scope for the hackathon window.
2. **Fork the crate** — too risky, beta code.
3. **Use a private-module workaround** by reaching into `qdrant_edge::shard::operations` from our crate — fragile, breaks on every bump.

## What we did instead

The current `EdgeOps` trait in `src/edge/adapter.rs` uses a small in-process vector store with on-disk snapshot — semantically identical to qdrant-edge for our scale (≤10k vectors). It has the same `EdgeOps` interface that a real qdrant-edge adapter would have.

When qdrant-edge stabilizes (or adds the public upsert API), swapping is a single-file change to `src/edge/adapter.rs`. The trait, FFI surface, sync protocol, conflict resolution, and CLI all remain unchanged.

## Reproduction of the gap

```rust
// This fails because the variant is private:
let op = qdrant_edge::CollectionUpdateOperations::PointOperation(
    qdrant_edge::PointOperations::UpsertPoints(/* ... */),
);
shard.update(op)?;  // never reached — op can't be built
```

```rust
// This works (create + load only):
let shard = qdrant_edge::EdgeShard::new(path, config)?;
let shard = qdrant_edge::EdgeShard::load(path, Some(config))?;
let hits = shard.query(builder)?;  // OK, query is public
let recs = shard.retrieve(builder)?;  // OK, retrieve is public
// But shard.upsert(...) doesn't exist publicly.
```

## Tracking

If we want this for production, file a Qdrant issue requesting:
- `pub fn upsert_points(&self, points: Vec<PointStructPersisted>) -> OperationResult<()>`
- `pub fn delete_points(&self, ids: Vec<ExtendedPointId>) -> OperationResult<()>`
- `pub fn point_count(&self) -> usize`

That's ~20 lines of trivial wrapper code in the qdrant-edge crate that would unlock all external integrations.
