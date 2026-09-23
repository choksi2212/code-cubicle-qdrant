//! Conflict resolution layer

pub mod resolve;

pub use resolve::{resolve_conflict, resolve_conflict_json, ConflictDecision};
