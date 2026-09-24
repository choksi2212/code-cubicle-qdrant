//! Append-only Write-Ahead Log (WAL)
//!
//! Two on-disk formats coexist:
//!
//! 1. **Plaintext (legacy):** `[magic "FELG"][op u8][length u32 LE][json bytes]`.
//!    Read with [`WalReader::open`] / written with [`WalWriter::create`].
//! 2. **Encrypted:** each entry is AES-256-GCM ciphertext framed as
//!    `nonce(12) || body || tag(16)` and prefixed with the encrypted
//!    framing `[ENC1][op u8][length u32 BE][ciphertext...]`. AAD is
//!    `b"fieldedge/wal/v1"`. See [`EncryptedWal`].
//!
//! The reader detects format by the first 4 bytes:
//!   * `FELG` → plaintext (old format, kept for the migration window)
//!   * `ENC1` → encrypted (new format)
//!   * anything else → [`WalError::UnknownFormat`]
//!
//! `FEW1` is an alias used by the new encrypted helpers' plaintext path
//! for in-process tests; it never appears in shipped binaries.

use crate::edge::Point;
use crate::models::payload::VersionedPayload;
use crate::storage::encryption::{AesGcmError, Cipher, NONCE_LEN, TAG_LEN};
use crate::storage::keyring::KeyRing;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::Arc;
use thiserror::Error;

pub const WAL_MAGIC: &[u8; 4] = b"FELG";
/// Plaintext magic used by the encryption module's tests + migration path.
pub const WAL_MAGIC_PLAINTEXT_V2: &[u8; 4] = b"FEW1";
/// Magic prefix for encrypted WAL entries.
pub const WAL_MAGIC_ENCRYPTED: &[u8; 4] = b"ENC1";

#[derive(Debug, Error)]
pub enum WalError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Bad magic at start of WAL")]
    BadMagic,
    #[error("Unknown WAL format (expected FELG, FEW1, or ENC1 magic)")]
    UnknownFormat,
    #[error("Corrupt entry at offset {offset}: {message}")]
    Corrupt { offset: u64, message: String },
    #[error("JSON decode error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Encryption error: {0}")]
    Crypto(#[from] AesGcmError),
}

/// WAL operation type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum WalOp {
    #[default]
    Upsert,
    Delete,
    OptimizeHint,
}

/// A single WAL entry
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct WalEntry {
    pub op: WalOp,
    pub seq: u64,
    pub point: Option<Point>,
    pub point_id: Option<String>,
    pub ts: String,
    /// 'pending' | 'synced' | 'failed'
    pub sync_state: String,
}

/// Append-only WAL writer
pub struct WalWriter {
    file: BufWriter<File>,
    path: std::path::PathBuf,
}

impl WalWriter {
    pub fn create(path: &Path) -> Result<Self, WalError> {
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .append(true)
            .open(path)?;
        Ok(Self {
            file: BufWriter::new(file),
            path: path.to_path_buf(),
        })
    }

    /// Append a single entry. fsync is called to ensure durability.
    pub fn append(&mut self, entry: &WalEntry) -> Result<(), WalError> {
        let payload = serde_json::to_vec(entry)?;

        // Seek to end (in case file was opened in a mode that doesn't auto-append)
        let _ = self.file.seek(SeekFrom::End(0));

        self.file.write_all(WAL_MAGIC)?;
        self.file.write_all(&[WalOp_to_byte(entry.op)])?;
        self.file.write_all(&(payload.len() as u32).to_le_bytes())?;
        self.file.write_all(&payload)?;
        self.file.flush()?;
        // Force OS-level flush to disk
        self.file.get_ref().sync_data()?;
        Ok(())
    }
}

fn WalOp_to_byte(op: WalOp) -> u8 {
    match op {
        WalOp::Upsert => 0x01,
        WalOp::Delete => 0x02,
        WalOp::OptimizeHint => 0x03,
    }
}

fn byte_to_WalOp(b: u8) -> Result<WalOp, WalError> {
    match b {
        0x01 => Ok(WalOp::Upsert),
        0x02 => Ok(WalOp::Delete),
        0x03 => Ok(WalOp::OptimizeHint),
        _ => Err(WalError::Corrupt {
            offset: 0,
            message: format!("unknown op byte: {}", b),
        }),
    }
}

/// Route a WAL entry's payload through `VersionedPayload` so v1 entries
/// recorded by older devices are upgraded to v2 on replay.
///
/// The shape of a WAL entry is `{ "op": ..., "seq": ..., "point": { "id": ...,
/// "vector": [...], "payload": {...} }, ... }`. We only touch the inner
/// `payload` object; the rest of the entry passes through unchanged.
fn migrate_wal_payload(value: Result<Value, serde_json::Error>) -> Result<Value, WalError> {
    let mut value = value?;

    if let Some(point) = value.get_mut("point").and_then(|p| p.as_object_mut()) {
        if let Some(payload_val) = point.get_mut("payload") {
            // Take ownership of the inner payload value, migrate it, and
            // splice the v2 form back in.
            let raw = payload_val.take();
            let versioned = VersionedPayload::from_value(raw).map_err(WalError::Json)?;
            let migrated = versioned.migrate_to_v2();
            *payload_val = serde_json::to_value(migrated).map_err(WalError::Json)?;
        }
    }

    Ok(value)
}

/// WAL reader (iterator-style)
pub struct WalReader {
    file: BufReader<File>,
    offset: u64,
}

impl WalReader {
    pub fn open(path: &Path) -> Result<Self, WalError> {
        let file = File::open(path)?;
        Ok(Self {
            file: BufReader::new(file),
            offset: 0,
        })
    }
}

impl Iterator for WalReader {
    type Item = Result<WalEntry, WalError>;

    fn next(&mut self) -> Option<Self::Item> {
        // Read 4-byte magic
        let mut magic = [0u8; 4];
        match self.file.read_exact(&mut magic) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return None,
            Err(e) => return Some(Err(WalError::Io(e))),
        }

        if &magic != WAL_MAGIC && &magic != WAL_MAGIC_PLAINTEXT_V2 {
            return Some(Err(WalError::UnknownFormat));
        }
        self.offset += 4;

        // Read 1-byte op
        let mut op_byte = [0u8; 1];
        if let Err(e) = self.file.read_exact(&mut op_byte) {
            return Some(Err(WalError::Io(e)));
        }
        let op = match byte_to_WalOp(op_byte[0]) {
            Ok(o) => o,
            Err(e) => return Some(Err(e)),
        };
        self.offset += 1;

        // Read 4-byte length
        let mut len_bytes = [0u8; 4];
        if let Err(e) = self.file.read_exact(&mut len_bytes) {
            return Some(Err(WalError::Io(e)));
        }
        let len = u32::from_le_bytes(len_bytes) as usize;
        self.offset += 4;

        // Read payload
        let mut payload = vec![0u8; len];
        if let Err(e) = self.file.read_exact(&mut payload) {
            return Some(Err(WalError::Io(e)));
        }
        self.offset += len as u64;

        match migrate_wal_payload(serde_json::from_slice::<Value>(&payload)) {
            Ok(value) => match serde_json::from_value::<WalEntry>(value) {
                Ok(mut entry) => {
                    entry.op = op; // ensure op matches what we read
                    Some(Ok(entry))
                }
                Err(e) => Some(Err(WalError::Json(e))),
            },
            Err(e) => Some(Err(e)),
        }
    }
}

// ─── Encrypted WAL ───────────────────────────────────────────────────────────
//
// Same on-disk structure as plaintext, but the payload bytes are run
// through AES-256-GCM with AAD = b"fieldedge/wal/v1". The reader detects
// the format from the magic (ENC1 vs FELG/FEW1) and falls through to
// either path automatically.
//
// AAD binding to "wal/v1" is critical: a ciphertext produced by another
// FieldEdge subsystem (e.g. shard index) cannot be replayed against the
// WAL even if the attacker controls the key bytes — the GCM tag won't
// verify under the wrong context.

/// AAD used for every encrypted WAL entry. Bump the trailing `v1` when
/// changing the WAL on-disk schema (the magic stays `ENC1`).
pub const WAL_AAD: &[u8] = b"fieldedge/wal/v1";

/// Encrypted WAL — same API shape as [`WalWriter`], but every entry
/// payload is AES-256-GCM-sealed before being flushed.
pub struct EncryptedWal {
    file: BufWriter<File>,
    path: std::path::PathBuf,
    cipher: Arc<dyn Cipher>,
    /// Running count of bytes appended (for diagnostics).
    bytes_written: u64,
}

impl EncryptedWal {
    /// Open (or create) an encrypted WAL.
    ///
    /// Existing plaintext WALs (FELG/FEW1) are NOT touched. To migrate,
    /// use [`EncryptedWal::migrate_plaintext`] once after upgrading.
    pub fn open(path: &Path, keyring: &KeyRing) -> Result<Self, WalError> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        Ok(Self {
            file: BufWriter::new(file),
            path: path.to_path_buf(),
            cipher: Arc::new(keyring.cipher().clone()),
            bytes_written: 0,
        })
    }

    /// Open with an arbitrary cipher (used by tests that don't want to
    /// spin up a full KeyRing).
    pub fn open_with_cipher(path: &Path, cipher: Arc<dyn Cipher>) -> Result<Self, WalError> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        Ok(Self {
            file: BufWriter::new(file),
            path: path.to_path_buf(),
            cipher,
            bytes_written: 0,
        })
    }

    /// Append one entry. The plaintext is JSON, then encrypted with
    /// AAD = WAL_AAD.
    pub fn append(&mut self, entry: &WalEntry) -> Result<(), WalError> {
        let plaintext = serde_json::to_vec(entry)?;
        let ciphertext = self.cipher.encrypt(&plaintext, WAL_AAD);
        // Frame: [ENC1][op u8][length u32 BE][ciphertext]
        let _ = self.file.seek(SeekFrom::End(0));
        self.file.write_all(WAL_MAGIC_ENCRYPTED)?;
        self.file.write_all(&[WalOp_to_byte(entry.op)])?;
        self.file.write_all(&(ciphertext.len() as u32).to_le_bytes())?;
        self.file.write_all(&ciphertext)?;
        self.file.flush()?;
        self.file.get_ref().sync_data()?;
        self.bytes_written += (4 + 1 + 4 + ciphertext.len()) as u64;
        Ok(())
    }

    pub fn bytes_written(&self) -> u64 {
        self.bytes_written
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Read all entries back. Iterator-style; entries that fail to
    /// decrypt are reported as `WalError::Crypto` so the caller can
    /// decide whether to truncate-and-rebuild or surface to the user.
    pub fn iterate(&self) -> Result<Vec<WalEntry>, WalError> {
        let reader = EncryptedWalReader::open(&self.path, self.cipher.clone())?;
        let mut out = Vec::new();
        for item in reader {
            out.push(item?);
        }
        Ok(out)
    }

    /// One-shot migration: read every plaintext entry from `src`,
    /// re-append it encrypted to `dst`. Use during the WAL format
    /// upgrade window.
    pub fn migrate_plaintext(src: &Path, dst: &Path, keyring: &KeyRing) -> Result<u64, WalError> {
        let cipher: Arc<dyn Cipher> = Arc::new(keyring.cipher().clone());
        let mut writer = Self::open_with_cipher(dst, cipher)?;
        let reader = WalReader::open(src)?;
        let mut migrated = 0u64;
        for item in reader {
            let entry = item?;
            writer.append(&entry)?;
            migrated += 1;
        }
        Ok(migrated)
    }
}

/// Encrypted WAL reader — symmetric counterpart of [`EncryptedWal`].
pub struct EncryptedWalReader {
    file: BufReader<File>,
    cipher: Arc<dyn Cipher>,
}

impl EncryptedWalReader {
    pub fn open(path: &Path, cipher: Arc<dyn Cipher>) -> Result<Self, WalError> {
        let file = File::open(path)?;
        Ok(Self {
            file: BufReader::new(file),
            cipher,
        })
    }
}

impl Iterator for EncryptedWalReader {
    type Item = Result<WalEntry, WalError>;

    fn next(&mut self) -> Option<Self::Item> {
        let mut magic = [0u8; 4];
        match self.file.read_exact(&mut magic) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return None,
            Err(e) => return Some(Err(WalError::Io(e))),
        }
        if &magic != WAL_MAGIC_ENCRYPTED {
            // If we hit a plaintext magic, treat it as corrupt —
            // mixed-format WALs are never produced by the encrypted
            // writer.
            return Some(Err(WalError::UnknownFormat));
        }
        let mut op_byte = [0u8; 1];
        if let Err(e) = self.file.read_exact(&mut op_byte) {
            return Some(Err(WalError::Io(e)));
        }
        let op = match byte_to_WalOp(op_byte[0]) {
            Ok(o) => o,
            Err(e) => return Some(Err(e)),
        };
        let mut len_bytes = [0u8; 4];
        if let Err(e) = self.file.read_exact(&mut len_bytes) {
            return Some(Err(WalError::Io(e)));
        }
        let len = u32::from_le_bytes(len_bytes) as usize;
        let mut ciphertext = vec![0u8; len];
        if let Err(e) = self.file.read_exact(&mut ciphertext) {
            return Some(Err(WalError::Io(e)));
        }
        // Sanity: the body must be at least nonce + tag.
        if ciphertext.len() < NONCE_LEN + TAG_LEN {
            return Some(Err(WalError::Corrupt {
                offset: 0,
                message: format!(
                    "encrypted entry too short ({} bytes, need ≥{})",
                    ciphertext.len(),
                    NONCE_LEN + TAG_LEN
                ),
            }));
        }
        let plaintext = match self.cipher.decrypt(&ciphertext, WAL_AAD) {
            Ok(p) => p,
            Err(e) => return Some(Err(WalError::Crypto(e))),
        };
        match migrate_wal_payload(serde_json::from_slice::<Value>(&plaintext)) {
            Ok(value) => match serde_json::from_value::<WalEntry>(value) {
                Ok(mut entry) => {
                    entry.op = op;
                    Some(Ok(entry))
                }
                Err(e) => Some(Err(WalError::Json(e))),
            },
            Err(e) => Some(Err(e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edge::Point;
    use crate::models::payload::{EmbeddingStatus, GpsStatus, Payload};

    fn make_entry(seq: u64, id: &str) -> WalEntry {
        let payload = Payload {
            schema_version: 2,
            photo_id: id.into(),
            device_id: "dev".into(),
            captured_at: "2025-05-12T14:23:01Z".into(),
            lat: Some(0.0),
            lng: Some(0.0),
            gps_status: GpsStatus::Ok,
            project_id: "p".into(),
            file_path: "f".into(),
            embedding_status: EmbeddingStatus::Ok,
            enrichment_id: None,
            enrichment_tags: vec![],
            enrichment_objects: vec![],
            enrichment_text: None,
            synced_at: None,
            local_updated_at: "2025-05-12T14:23:01Z".into(),
            vector_checksum: "sha256:abc".into(),
            deletion_marker: false,
            project_owner: None,
            tags_v2: vec![],
        };

        WalEntry {
            op: WalOp::Upsert,
            seq,
            point: Some(Point {
                id: id.into(),
                vector: vec![0.1; 512],
                payload,
            }),
            point_id: Some(id.into()),
            ts: "2025-05-12T14:23:01Z".into(),
            sync_state: "pending".into(),
        }
    }

    #[test]
    fn roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.wal");

        let mut writer = WalWriter::create(&path).unwrap();
        writer.append(&make_entry(1, "p1")).unwrap();
        writer.append(&make_entry(2, "p2")).unwrap();
        drop(writer);

        let reader = WalReader::open(&path).unwrap();
        let entries: Vec<_> = reader.collect();
        assert_eq!(entries.len(), 2);
        assert!(entries[0].is_ok());
        assert!(entries[1].is_ok());
    }
}
