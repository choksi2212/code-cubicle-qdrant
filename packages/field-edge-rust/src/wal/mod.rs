//! Write-Ahead Log

pub mod log;

pub use log::{WalEntry, WalOp, WalReader, WalWriter, WAL_MAGIC};
