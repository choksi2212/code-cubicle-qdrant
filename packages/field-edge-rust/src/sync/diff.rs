//! Sync diff: compute local-vs-remote point diffs for incremental sync

use crate::models::payload::Payload;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Result of a sync diff computation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncDiff {
    /// Point IDs the device should upload to the server
    pub to_upload: Vec<String>,
    /// Point IDs the device should download from the server
    pub to_download: Vec<String>,
    /// Point IDs that exist locally and remotely with different vectors
    pub conflicts: Vec<String>,
}

/// Resolution outcome for a conflict
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictResolution {
    LocalWins,
    RemoteWins,
    Merged,
    Unresolved,
}

/// Compute diff between local and remote point sets.
///
/// Input is a JSON string for each side; each is a map of point_id -> payload.
/// Vectors are represented by their `vector_checksum` field for comparison.
pub fn compute_sync_diff(
    local_state_json: &str,
    remote_state_json: &str,
) -> Result<SyncDiff, String> {
    let local: HashMap<String, Payload> =
        serde_json::from_str(local_state_json).map_err(|e| format!("local parse: {}", e))?;
    let remote: HashMap<String, Payload> =
        serde_json::from_str(remote_state_json).map_err(|e| format!("remote parse: {}", e))?;

    let mut to_upload = Vec::new();
    let mut conflicts = Vec::new();

    for (id, local_payload) in &local {
        match remote.get(id) {
            None => to_upload.push(id.clone()),
            Some(remote_payload) => {
                if local_payload == remote_payload {
                    // Same payload — no-op
                } else if local_payload.vector_checksum == remote_payload.vector_checksum {
                    // Same vector, different metadata — additive update, upload local
                    to_upload.push(id.clone());
                } else {
                    // Different vector + different payload — true conflict
                    conflicts.push(id.clone());
                }
            }
        }
    }

    let to_download: Vec<String> = remote
        .keys()
        .filter(|id| !local.contains_key(*id))
        .cloned()
        .collect();

    Ok(SyncDiff {
        to_upload,
        to_download,
        conflicts,
    })
}

/// Resolve a conflict by timestamp heuristic alone (vector-sim tier runs separately)
pub fn resolve_by_timestamp(local: &Payload, remote: &Payload) -> ConflictResolution {
    let local_ts = &local.local_updated_at;
    let remote_ts = &remote.local_updated_at;

    if local_ts == remote_ts {
        ConflictResolution::Unresolved
    } else if local_ts > remote_ts {
        ConflictResolution::LocalWins
    } else {
        ConflictResolution::RemoteWins
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(id: &str, ts: &str, checksum: &str) -> Payload {
        Payload {
            schema_version: 1,
            photo_id: id.to_string(),
            device_id: "dev-1".into(),
            captured_at: "2025-05-12T14:23:01.000Z".into(),
            lat: Some(13.4521),
            lng: Some(75.1234),
            gps_status: crate::models::payload::GpsStatus::Ok,
            project_id: "p1".into(),
            file_path: "f".into(),
            embedding_status: crate::models::payload::EmbeddingStatus::Ok,
            cloudinary_public_id: None,
            cloudinary_tags: vec![],
            cloudinary_objects: vec![],
            cloudinary_ocr_text: None,
            synced_at: None,
            local_updated_at: ts.into(),
            vector_checksum: checksum.into(),
        }
    }

    #[test]
    fn diff_basic() {
        let mut local: HashMap<String, Payload> = HashMap::new();
        local.insert("p1".into(), payload("p1", "2025-05-12T10:00:00Z", "sha256:abc"));
        local.insert("p2".into(), payload("p2", "2025-05-12T11:00:00Z", "sha256:def"));

        let mut remote: HashMap<String, Payload> = HashMap::new();
        remote.insert("p2".into(), payload("p2", "2025-05-12T11:00:00Z", "sha256:def"));
        remote.insert("p3".into(), payload("p3", "2025-05-12T12:00:00Z", "sha256:ghi"));

        let diff = compute_sync_diff(
            &serde_json::to_string(&local).unwrap(),
            &serde_json::to_string(&remote).unwrap(),
        )
        .unwrap();

        assert_eq!(diff.to_upload, vec!["p1"]);
        assert_eq!(diff.to_download, vec!["p3"]);
        assert!(diff.conflicts.is_empty());
    }

    #[test]
    fn diff_detects_conflict() {
        let mut local: HashMap<String, Payload> = HashMap::new();
        local.insert("p1".into(), payload("p1", "2025-05-12T10:00:00Z", "sha256:abc"));

        let mut remote: HashMap<String, Payload> = HashMap::new();
        remote.insert("p1".into(), payload("p1", "2025-05-12T10:00:00Z", "sha256:xyz"));

        let diff = compute_sync_diff(
            &serde_json::to_string(&local).unwrap(),
            &serde_json::to_string(&remote).unwrap(),
        )
        .unwrap();

        assert!(diff.to_upload.is_empty());
        assert!(diff.conflicts.contains(&"p1".to_string()));
    }

    #[test]
    fn timestamp_resolution() {
        let local = payload("p1", "2025-05-12T10:00:00.000Z", "sha256:abc");
        let remote = payload("p1", "2025-05-12T10:00:01.000Z", "sha256:abc");
        assert_eq!(resolve_by_timestamp(&local, &remote), ConflictResolution::RemoteWins);

        let local = payload("p1", "2025-05-12T10:00:02.000Z", "sha256:abc");
        let remote = payload("p1", "2025-05-12T10:00:01.000Z", "sha256:abc");
        assert_eq!(resolve_by_timestamp(&local, &remote), ConflictResolution::LocalWins);
    }
}
