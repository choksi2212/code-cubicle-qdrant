//! Sync orchestrator: diff computation, cursor encoding

pub mod diff;

pub use diff::{compute_sync_diff, SyncDiff, ConflictResolution};
