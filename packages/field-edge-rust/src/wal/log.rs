//! Append-only Write-Ahead Log (WAL)
//!
//! Binary format: [magic 4B][op u8][length u32 LE][json bytes]
//! Magic: `FELG` (FieldEdge Log)
//!
//! Used to durably record local writes before they hit the Edge shard, so
//! crash recovery can replay them.

use crate::edge::Point;
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;
use thiserror::Error;

pub const WAL_MAGIC: &[u8; 4] = b"FELG";

#[derive(Debug, Error)]
pub enum WalError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Bad magic at start of WAL")]
    BadMagic,
    #[error("Corrupt entry at offset {offset}: {message}")]
    Corrupt { offset: u64, message: String },
    #[error("JSON decode error: {0}")]
    Json(#[from] serde_json::Error),
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

        if &magic != WAL_MAGIC {
            return Some(Err(WalError::Corrupt {
                offset: self.offset,
                message: "bad magic".into(),
            }));
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

        match serde_json::from_slice::<WalEntry>(&payload) {
            Ok(mut entry) => {
                entry.op = op; // ensure op matches what we read
                Some(Ok(entry))
            }
            Err(e) => Some(Err(WalError::Json(e))),
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
            schema_version: 1,
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
