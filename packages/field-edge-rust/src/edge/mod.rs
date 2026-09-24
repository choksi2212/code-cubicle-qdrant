//! Edge storage layer
//!
//! Primary: in-process vector store with on-disk snapshot (works on all
//! platforms, same `EdgeOps` interface as qdrant-edge).
//!
//! Future: real `qdrant-edge` adapter when its public API exposes the
//! upsert/delete convenience methods we need. See `qdrant_edge_notes.md`.

pub mod adapter;

pub use adapter::{
    EncryptedInMemoryEdge, EncryptedShardError, EdgeError, EdgeOps, Filter, Point, QueryRequest,
    ScoredPoint, ENCRYPTED_SNAPSHOT_FILE, SHARD_AAD,
};

/// Open the local edge shard (plaintext).
pub fn open_shard(directory: &str) -> Result<Box<dyn EdgeOps>, EdgeError> {
    adapter::open_shard(directory)
}
