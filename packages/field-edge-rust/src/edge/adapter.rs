//! Edge storage adapter — in-process vector store with on-disk snapshot.
//!
//! Implements the `EdgeOps` trait with full cosine-similarity search,
//! payload filters, and persistent snapshot. Suitable for ≤10k vectors
//! (our hackathon scale).
//!
//! Two on-disk formats are available:
//!   * Plaintext (default): `edge_snapshot.bin` written with bincode.
//!   * Encrypted:           AES-256-GCM-sealed, written by
//!     [`EncryptedInMemoryEdge`]. Vectors are encrypted too — they
//!     could leak photo content via nearest-neighbor reconstruction.
//!
//! See `qdrant_edge_notes.md` for the qdrant-edge v0.8.0 API gap analysis
//! and the planned swap.

use crate::crypto::checksum::vector_checksum;
use crate::models::payload::{Payload, CURRENT_SCHEMA_VERSION};
use crate::storage::encryption::{Cipher, NONCE_LEN, TAG_LEN};
use crate::storage::keyring::KeyRing;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use thiserror::Error;

const VECTOR_DIM: usize = 512;
const SNAPSHOT_FILE: &str = "edge_snapshot.bin";

/// Errors from edge operations
#[derive(Debug, Error)]
pub enum EdgeError {
    #[error("IO error: {0}")]
    Io(String),
    #[error("Invalid payload: {0}")]
    InvalidPayload(String),
    #[error("Backend unavailable: {0}")]
    BackendUnavailable(String),
    #[error("Other: {0}")]
    Other(String),
}

/// A point to be stored: vector + payload + id
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Point {
    pub id: String,
    pub vector: Vec<f32>,
    pub payload: Payload,
}

/// A query result with similarity score
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoredPoint {
    pub id: String,
    pub score: f32,
    pub payload: Payload,
}

/// Filter expression for narrowing search
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Filter {
    Match { key: String, value: serde_json::Value },
    Range { key: String, gte: Option<f64>, lte: Option<f64> },
    And { children: Vec<Filter> },
    Or { children: Vec<Filter> },
    Not { child: Box<Filter> },
}

/// Query request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryRequest {
    pub vector: Vec<f32>,
    pub limit: usize,
    #[serde(default)]
    pub filter: Option<Filter>,
    #[serde(default = "default_true")]
    pub with_payload: bool,
    #[serde(default)]
    pub with_vector: bool,
    #[serde(default = "default_ef")]
    pub ef: usize,
}

fn default_true() -> bool { true }
fn default_ef() -> usize { 64 }

/// Trait for edge backends
pub trait EdgeOps: Send + Sync {
    fn upsert(&self, points: &[Point]) -> Result<(), EdgeError>;
    fn query(&self, req: &QueryRequest) -> Result<Vec<ScoredPoint>, EdgeError>;
    fn retrieve(&self, ids: &[String]) -> Result<Vec<Point>, EdgeError>;
    fn delete(&self, ids: &[String]) -> Result<(), EdgeError>;
    fn optimize(&self) -> Result<(), EdgeError>;
    fn close(&self) -> Result<(), EdgeError>;
    fn len(&self) -> Result<usize, EdgeError>;
}

// ─── In-memory implementation ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredPoint {
    vector: Vec<f32>,
    payload: Payload,
}

/// In-process vector store with on-disk snapshot for durability.
pub struct InMemoryEdge {
    points: RwLock<HashMap<String, StoredPoint>>,
    snapshot_path: std::path::PathBuf,
    persist_lock: parking_lot::Mutex<()>,
    /// Unique ID for tmp file naming (avoids races when multiple InMemoryEdge
    /// instances share a directory).
    instance_id: u64,
}

impl InMemoryEdge {
    pub fn new(directory: &str) -> Result<Self, EdgeError> {
        let path = Path::new(directory);
        if !path.exists() {
            fs::create_dir_all(path).map_err(|e| EdgeError::Io(e.to_string()))?;
        }
        let snapshot_path = path.join(SNAPSHOT_FILE);

        let mut points = HashMap::new();
        if snapshot_path.exists() {
            match fs::read(&snapshot_path) {
                Ok(bytes) => match bincode::deserialize::<HashMap<String, StoredPoint>>(&bytes) {
                    Ok(loaded) => points = loaded,
                    Err(e) => tracing::warn!("snapshot decode failed, starting fresh: {}", e),
                },
                Err(e) => tracing::warn!("snapshot read failed, starting fresh: {}", e),
            }
        }

        // Generate unique instance ID based on object address
        let instance_id = {
            let p = &points as *const _ as usize;
            p as u64
        };

        Ok(Self {
            points: RwLock::new(points),
            snapshot_path,
            persist_lock: parking_lot::Mutex::new(()),
            instance_id,
        })
    }

    fn persist(&self) -> Result<(), EdgeError> {
        // Serialize concurrent persist calls so they don't trample each other's
        // temp file on Windows (and don't waste I/O).
        let _guard = self.persist_lock.lock();
        let snapshot = self.points.read().clone();
        let bytes = bincode::serialize(&snapshot).map_err(|e| EdgeError::Other(e.to_string()))?;
        // Atomic write: write to per-instance temp, then rename.
        // Per-instance tmp path avoids races between multiple InMemoryEdge
        // instances sharing a directory.
        let mut tmp_name = self.snapshot_path.file_name().unwrap().to_owned();
        tmp_name.push(format!(".{}.tmp", self.instance_id));
        let tmp_path = self.snapshot_path.with_file_name(tmp_name);
        fs::write(&tmp_path, bytes).map_err(|e| EdgeError::Io(e.to_string()))?;
        fs::rename(&tmp_path, &self.snapshot_path)
            .map_err(|e| EdgeError::Io(e.to_string()))?;
        Ok(())
    }

    /// Internal helper used by [`EncryptedInMemoryEdge`] — clone the
    /// current in-memory state for re-serialization through a cipher.
    pub(crate) fn snapshot_clone(&self) -> HashMap<String, StoredPoint> {
        self.points.read().clone()
    }

    /// Internal helper used by [`EncryptedInMemoryEdge`] — build an
    /// instance with a pre-populated points map pointing at a custom
    /// snapshot path (so the encrypted wrapper can route persistence
    /// through its own cipher).
    pub(crate) fn with_state(
        directory: &str,
        points: HashMap<String, StoredPoint>,
        snapshot_path: std::path::PathBuf,
    ) -> Result<Self, EdgeError> {
        let path = Path::new(directory);
        if !path.exists() {
            fs::create_dir_all(path).map_err(|e| EdgeError::Io(e.to_string()))?;
        }
        // Address-based unique ID — same scheme as the public ctor so
        // concurrent instances don't trample each other's tmp files.
        let instance_id = {
            let p = &points as *const _ as usize;
            p as u64
        };
        Ok(Self {
            points: RwLock::new(points),
            snapshot_path,
            persist_lock: parking_lot::Mutex::new(()),
            instance_id,
        })
    }

    fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        let len = a.len().min(b.len());
        let mut dot = 0.0f64;
        let mut norm_a = 0.0f64;
        let mut norm_b = 0.0f64;
        for i in 0..len {
            let x = a[i] as f64;
            let y = b[i] as f64;
            dot += x * y;
            norm_a += x * x;
            norm_b += y * y;
        }
        if norm_a == 0.0 || norm_b == 0.0 {
            return 0.0;
        }
        (dot / (norm_a.sqrt() * norm_b.sqrt())) as f32
    }

    fn matches_filter(payload: &Payload, filter: &Filter) -> bool {
        match filter {
            Filter::Match { key, value } => {
                let v = payload_get(payload, key);
                v.as_ref() == Some(value)
            }
            Filter::Range { key, gte, lte } => {
                let v = payload_get(payload, key);
                match v {
                    Some(serde_json::Value::Number(n)) => {
                        let x = n.as_f64().unwrap_or(f64::NAN);
                        let lower_ok = gte.map(|g| x >= g).unwrap_or(true);
                        let upper_ok = lte.map(|l| x <= l).unwrap_or(true);
                        lower_ok && upper_ok
                    }
                    // ISO-8601 strings are lexicographically sortable, so we
                    // can use string ordering for date/time range filters.
                    Some(serde_json::Value::String(s)) => {
                        let lower_ok = gte
                            .map(|g| s.as_str() >= format_f64(g).as_str())
                            .unwrap_or(true);
                        let upper_ok = lte
                            .map(|l| s.as_str() <= format_f64(l).as_str())
                            .unwrap_or(true);
                        lower_ok && upper_ok
                    }
                    _ => false,
                }
            }
            Filter::And { children } => children.iter().all(|c| Self::matches_filter(payload, c)),
            Filter::Or { children } => children.iter().any(|c| Self::matches_filter(payload, c)),
            Filter::Not { child } => !Self::matches_filter(payload, child),
        }
    }
}

/// Open or create the local shard.
pub fn open_shard(directory: &str) -> Result<Box<dyn EdgeOps>, EdgeError> {
    Ok(Box::new(InMemoryEdge::new(directory)?))
}

impl EdgeOps for InMemoryEdge {
    fn upsert(&self, points: &[Point]) -> Result<(), EdgeError> {
        let mut store = self.points.write();
        for p in points {
            store.insert(
                p.id.clone(),
                StoredPoint {
                    vector: p.vector.clone(),
                    payload: p.payload.clone(),
                },
            );
        }
        drop(store);
        self.persist()
    }

    fn query(&self, req: &QueryRequest) -> Result<Vec<ScoredPoint>, EdgeError> {
        let store = self.points.read();

        let mut candidates: Vec<(&String, &StoredPoint, f32)> = store
            .iter()
            .filter(|(_, sp)| {
                req.filter
                    .as_ref()
                    .map(|f| Self::matches_filter(&sp.payload, f))
                    .unwrap_or(true)
            })
            .map(|(id, sp)| {
                let score = Self::cosine_similarity(&req.vector, &sp.vector);
                (id, sp, score)
            })
            .collect();

        // Sort by score descending
        candidates.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

        Ok(candidates
            .into_iter()
            .take(req.limit)
            .map(|(id, sp, score)| ScoredPoint {
                id: id.clone(),
                score,
                payload: sp.payload.clone(),
            })
            .collect())
    }

    fn retrieve(&self, ids: &[String]) -> Result<Vec<Point>, EdgeError> {
        let store = self.points.read();
        Ok(ids
            .iter()
            .filter_map(|id| {
                store.get(id).map(|sp| Point {
                    id: id.clone(),
                    vector: sp.vector.clone(),
                    payload: sp.payload.clone(),
                })
            })
            .collect())
    }

    fn delete(&self, ids: &[String]) -> Result<(), EdgeError> {
        let mut store = self.points.write();
        for id in ids {
            store.remove(id);
        }
        drop(store);
        self.persist()
    }

    fn optimize(&self) -> Result<(), EdgeError> {
        // No-op for in-memory
        Ok(())
    }

    fn close(&self) -> Result<(), EdgeError> {
        self.persist()
    }

    fn len(&self) -> Result<usize, EdgeError> {
        Ok(self.points.read().len())
    }
}

// ─── Encrypted in-memory shard ───────────────────────────────────────────────
//
// Wraps an [`InMemoryEdge`]-equivalent store but persists a bincode
// snapshot through an [`Cipher`]. Both the points hashmap AND the
// underlying vectors are inside that snapshot, so encrypting the bytes
// once is sufficient — the bincode stream is opaque from outside.
//
// AAD used for the snapshot = `b"fieldedge/shard/v1"` (binds the cipher
// to its semantic context; a snapshot can't be replayed against the WAL).

/// AAD for the encrypted shard snapshot.
pub const SHARD_AAD: &[u8] = b"fieldedge/shard/v1";
/// Snapshot filename for the encrypted variant (kept distinct from
/// plaintext so the two never co-exist on disk).
pub const ENCRYPTED_SNAPSHOT_FILE: &str = "edge_snapshot.enc";

#[derive(Debug, Error)]
pub enum EncryptedShardError {
    #[error("io: {0}")]
    Io(String),
    #[error("bincode: {0}")]
    Bincode(String),
    #[error("encryption: {0}")]
    Crypto(String),
}

/// Encrypted shard — same `EdgeOps` API as [`InMemoryEdge`], but the
/// on-disk snapshot is AES-256-GCM-sealed with AAD = SHARD_AAD.
pub struct EncryptedInMemoryEdge {
    inner: InMemoryEdge,
    cipher: Arc<dyn Cipher>,
    snapshot_path: std::path::PathBuf,
}

impl EncryptedInMemoryEdge {
    /// Open or create an encrypted shard under `directory`.
    pub fn new(directory: &str, keyring: &KeyRing) -> Result<Self, EdgeError> {
        Self::new_with_cipher(directory, Arc::new(keyring.cipher().clone()))
    }

    /// Open with an arbitrary cipher (tests / custom key material).
    pub fn new_with_cipher(directory: &str, cipher: Arc<dyn Cipher>) -> Result<Self, EdgeError> {
        let path = Path::new(directory);
        if !path.exists() {
            fs::create_dir_all(path).map_err(|e| EdgeError::Io(e.to_string()))?;
        }
        let snapshot_path = path.join(ENCRYPTED_SNAPSHOT_FILE);

        // Decrypt the existing snapshot if it exists; otherwise seed
        // with an empty store. We don't delegate to InMemoryEdge's own
        // constructor because that one points at a plaintext file.
        let mut points = HashMap::new();
        if snapshot_path.exists() {
            match Self::read_snapshot(&snapshot_path, cipher.as_ref()) {
                Ok(loaded) => points = loaded,
                Err(e) => tracing::warn!("encrypted snapshot read failed, starting fresh: {}", e),
            }
        }

        // Hand-build an InMemoryEdge instance with the populated points
        // but pointing at the encrypted snapshot path. We replicate its
        // fields because there's no public constructor that takes both.
        let inner = InMemoryEdge::with_state(directory, points, snapshot_path.clone())?;

        Ok(Self {
            inner,
            cipher,
            snapshot_path,
        })
    }

    fn read_snapshot(
        path: &Path,
        cipher: &dyn Cipher,
    ) -> Result<HashMap<String, StoredPoint>, EncryptedShardError> {
        let bytes = fs::read(path).map_err(|e| EncryptedShardError::Io(e.to_string()))?;
        if bytes.len() < NONCE_LEN + TAG_LEN {
            return Err(EncryptedShardError::Io(format!(
                "snapshot too short ({} bytes)",
                bytes.len()
            )));
        }
        let plaintext = cipher
            .decrypt(&bytes, SHARD_AAD)
            .map_err(|e| EncryptedShardError::Crypto(e.to_string()))?;
        bincode::deserialize::<HashMap<String, StoredPoint>>(&plaintext)
            .map_err(|e| EncryptedShardError::Bincode(e.to_string()))
    }

    fn persist(&self) -> Result<(), EdgeError> {
        let snapshot = self.inner.snapshot_clone();
        let plaintext = bincode::serialize(&snapshot).map_err(|e| EdgeError::Other(e.to_string()))?;
        let ciphertext = self.cipher.encrypt(&plaintext, SHARD_AAD);
        // Atomic write via tempfile + rename to avoid corruption on crash.
        let mut tmp_name = self.snapshot_path.file_name().unwrap().to_owned();
        tmp_name.push(".tmp");
        let tmp_path = self.snapshot_path.with_file_name(tmp_name);
        fs::write(&tmp_path, ciphertext).map_err(|e| EdgeError::Io(e.to_string()))?;
        fs::rename(&tmp_path, &self.snapshot_path).map_err(|e| EdgeError::Io(e.to_string()))?;
        Ok(())
    }
}

impl EdgeOps for EncryptedInMemoryEdge {
    fn upsert(&self, points: &[Point]) -> Result<(), EdgeError> {
        self.inner.upsert(points)?;
        self.persist()
    }
    fn query(&self, req: &QueryRequest) -> Result<Vec<ScoredPoint>, EdgeError> {
        self.inner.query(req)
    }
    fn retrieve(&self, ids: &[String]) -> Result<Vec<Point>, EdgeError> {
        self.inner.retrieve(ids)
    }
    fn delete(&self, ids: &[String]) -> Result<(), EdgeError> {
        self.inner.delete(ids)?;
        self.persist()
    }
    fn optimize(&self) -> Result<(), EdgeError> {
        self.inner.optimize()
    }
    fn close(&self) -> Result<(), EdgeError> {
        self.persist()
    }
    fn len(&self) -> Result<usize, EdgeError> {
        self.inner.len()
    }
}

fn format_f64(f: f64) -> String {
    // For ISO-8601 timestamp comparison; we want stable string form
    // The f64 here is interpreted as the timestamp in milliseconds-since-epoch.
    // For string-on-string comparison to work, the payload value must be ISO-8601.
    // Since we can't reconstruct ISO-8601 from a raw f64 epoch, this comparison
    // only works correctly when both sides are stored in the same format.
    // In practice, callers should use string ranges against string fields.
    format!("{:020.6}", f)
}

fn payload_get(payload: &Payload, key: &str) -> Option<serde_json::Value> {
    match key {
        "schema_version" => Some(serde_json::json!(payload.schema_version)),
        "photo_id" => Some(serde_json::json!(payload.photo_id)),
        "device_id" => Some(serde_json::json!(payload.device_id)),
        "captured_at" => Some(serde_json::json!(payload.captured_at)),
        "lat" => payload.lat.map(|v| serde_json::json!(v)),
        "lng" => payload.lng.map(|v| serde_json::json!(v)),
        "gps_status" => Some(serde_json::json!(format!("{:?}", payload.gps_status).to_lowercase())),
        "project_id" => Some(serde_json::json!(payload.project_id)),
        "file_path" => Some(serde_json::json!(payload.file_path)),
        "embedding_status" => Some(serde_json::json!(format!("{:?}", payload.embedding_status).to_lowercase())),
        "enrichment_id" => payload.enrichment_id.clone().map(|v| serde_json::json!(v)),
        "enrichment_tags" => Some(serde_json::json!(payload.enrichment_tags)),
        "enrichment_objects" => Some(serde_json::json!(payload.enrichment_objects)),
        "enrichment_text" => payload.enrichment_text.clone().map(|v| serde_json::json!(v)),
        "synced_at" => payload.synced_at.clone().map(|v| serde_json::json!(v)),
        "local_updated_at" => Some(serde_json::json!(payload.local_updated_at)),
        "vector_checksum" => Some(serde_json::json!(payload.vector_checksum)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::payload::{EmbeddingStatus, GpsStatus};

    fn make_payload(id: &str) -> Payload {
        Payload {
            schema_version: CURRENT_SCHEMA_VERSION,
            photo_id: id.into(),
            device_id: "test".into(),
            captured_at: "2025-05-12T14:23:01Z".into(),
            lat: Some(13.4521),
            lng: Some(75.1234),
            gps_status: GpsStatus::Ok,
            project_id: "river-study".into(),
            file_path: format!("{}.jpg", id),
            embedding_status: EmbeddingStatus::Ok,
            enrichment_id: None,
            enrichment_tags: vec![],
            enrichment_objects: vec![],
            enrichment_text: None,
            synced_at: None,
            local_updated_at: "2025-05-12T14:23:01Z".into(),
            vector_checksum: vector_checksum(&vec![0.1; 512]),
            deletion_marker: false,
            project_owner: None,
            tags_v2: vec![],
        }
    }

    fn make_point(id: &str, vec: Vec<f32>, project: &str) -> Point {
        let mut p = make_payload(id);
        p.project_id = project.into();
        Point {
            id: id.into(),
            vector: vec,
            payload: p,
        }
    }

    #[test]
    fn round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let shard = open_shard(dir.path().to_str().unwrap()).unwrap();

        let pts = vec![
            make_point("p1", vec![0.1; 512], "river"),
            make_point("p2", vec![0.2; 512], "river"),
            make_point("p3", vec![0.3; 512], "forest"),
        ];
        shard.upsert(&pts).unwrap();
        assert_eq!(shard.len().unwrap(), 3);

        let req = QueryRequest {
            vector: vec![0.15; 512],
            limit: 10,
            filter: None,
            with_payload: true,
            with_vector: false,
            ef: 64,
        };
        let hits = shard.query(&req).unwrap();
        assert!(!hits.is_empty());
    }

    #[test]
    fn filter_by_project() {
        let dir = tempfile::tempdir().unwrap();
        let shard = open_shard(dir.path().to_str().unwrap()).unwrap();

        let pts = vec![
            make_point("p1", vec![0.1; 512], "river"),
            make_point("p2", vec![0.2; 512], "forest"),
        ];
        shard.upsert(&pts).unwrap();

        let req = QueryRequest {
            vector: vec![0.15; 512],
            limit: 10,
            filter: Some(Filter::Match {
                key: "project_id".into(),
                value: serde_json::json!("river"),
            }),
            with_payload: true,
            with_vector: false,
            ef: 64,
        };
        let hits = shard.query(&req).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "p1");
    }

    #[test]
    fn delete_removes_points() {
        let dir = tempfile::tempdir().unwrap();
        let shard = open_shard(dir.path().to_str().unwrap()).unwrap();

        let pts = vec![
            make_point("p1", vec![0.1; 512], "river"),
            make_point("p2", vec![0.2; 512], "river"),
        ];
        shard.upsert(&pts).unwrap();
        assert_eq!(shard.len().unwrap(), 2);

        shard.delete(&["p1".into()]).unwrap();
        assert_eq!(shard.len().unwrap(), 1);
    }

    #[test]
    fn cosine_similarity_works() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        assert!((InMemoryEdge::cosine_similarity(&a, &b) - 1.0).abs() < 1e-6);

        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        assert!(InMemoryEdge::cosine_similarity(&a, &b).abs() < 1e-6);
    }

    #[test]
    fn persists_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap();

        {
            let shard = open_shard(path).unwrap();
            shard
                .upsert(&[make_point("p1", vec![0.1; 512], "river")])
                .unwrap();
            shard.close().unwrap();
        }

        // Reopen and verify persistence
        let shard = open_shard(path).unwrap();
        assert_eq!(shard.len().unwrap(), 1);
    }
}
