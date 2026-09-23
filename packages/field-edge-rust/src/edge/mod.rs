//! Edge storage layer
//!
//! Primary: in-process vector store with on-disk snapshot (works on all
//! platforms, same `EdgeOps` interface as qdrant-edge).
//!
//! Future: real `qdrant-edge` adapter when its public API exposes the
//! upsert/delete convenience methods we need. See `qdrant_edge_notes.md`.

pub mod adapter;

pub use adapter::{EdgeError, EdgeOps, Filter, Point, QueryRequest, ScoredPoint};

/// Open the local edge shard.
pub fn open_shard(directory: &str) -> Result<Box<dyn EdgeOps>, EdgeError> {
    adapter::open_shard(directory)
}
