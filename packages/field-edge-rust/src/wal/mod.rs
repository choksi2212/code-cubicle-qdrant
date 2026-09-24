//! Write-Ahead Log

pub mod log;

pub use log::{
    EncryptedWal, EncryptedWalReader, WalEntry, WalOp, WalReader, WalWriter, WAL_AAD, WAL_MAGIC,
    WAL_MAGIC_ENCRYPTED, WAL_MAGIC_PLAINTEXT_V2,
};
