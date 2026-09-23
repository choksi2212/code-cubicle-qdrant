//! Conflict resolution: 3-stage algorithm
//!
//! 1. Timestamp: higher local_updated_at wins (within 1s = tie)
//! 2. Vector similarity (run by caller — we expose a helper)
//! 3. Field-level merge (deterministic)
//!
//! See PRD §6.4 (STORY-022) and Backend doc §10.

use crate::models::payload::Payload;
use serde::{Deserialize, Serialize};

/// Decision returned by conflict resolution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictDecision {
    pub winner: ConflictWinner,
    pub resolved_payload: Payload,
    /// For UI: which fields changed in the merge
    pub fields_changed: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictWinner {
    Local,
    Remote,
    Merged,
}

/// Resolve a conflict purely from the two payloads (timestamp + merge stages).
/// Vector-sim tier requires running nearest-neighbor queries against the local
/// shard; that's exposed separately.
pub fn resolve_conflict(local: &Payload, remote: &Payload) -> ConflictDecision {
    // Stage 1: timestamp
    let winner = pick_winner_by_timestamp(local, remote);

    let (winner_payload, decision_winner) = match winner {
        ConflictWinner::Local => (local.clone(), ConflictWinner::Local),
        ConflictWinner::Remote => (remote.clone(), ConflictWinner::Remote),
        ConflictWinner::Merged => {
            let merged = local.merge(remote);
            (merged, ConflictWinner::Merged)
        }
    };

    let fields_changed = diff_fields(local, remote);

    ConflictDecision {
        winner: decision_winner,
        resolved_payload: winner_payload,
        fields_changed,
    }
}

/// JSON-string entry point (used by UniFFI)
pub fn resolve_conflict_json(local_json: &str, remote_json: &str) -> Result<String, String> {
    let local: Payload = serde_json::from_str(local_json).map_err(|e| e.to_string())?;
    let remote: Payload = serde_json::from_str(remote_json).map_err(|e| e.to_string())?;
    let decision = resolve_conflict(&local, &remote);
    serde_json::to_string(&decision).map_err(|e| e.to_string())
}

fn pick_winner_by_timestamp(local: &Payload, remote: &Payload) -> ConflictWinner {
    // ISO-8601 strings are lexicographically sortable when in the same format.
    // Compare as strings first; fall back to parsing if needed.
    if local.local_updated_at == remote.local_updated_at {
        return ConflictWinner::Merged;
    }

    let local_t = parse_iso(&local.local_updated_at);
    let remote_t = parse_iso(&remote.local_updated_at);

    match (local_t, remote_t) {
        (Some(lt), Some(rt)) => {
            let diff = (lt - rt).num_seconds().abs();
            if diff > 1 {
                if lt > rt { ConflictWinner::Local } else { ConflictWinner::Remote }
            } else {
                ConflictWinner::Merged
            }
        }
        _ => {
            // Fall back to string comparison
            if local.local_updated_at > remote.local_updated_at {
                ConflictWinner::Local
            } else if local.local_updated_at < remote.local_updated_at {
                ConflictWinner::Remote
            } else {
                ConflictWinner::Merged
            }
        }
    }
}

fn parse_iso(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    // Try RFC 3339 first; if that fails, try appending fractional seconds.
    if let Ok(d) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(d.with_timezone(&chrono::Utc));
    }
    // Handle "2025-05-12T10:00:02Z" by appending ".0"
    let augmented = if s.ends_with('Z') && !s.contains('.') {
        format!("{}.0", &s[..s.len() - 1])
    } else {
        s.to_string()
    };
    chrono::DateTime::parse_from_rfc3339(&augmented)
        .ok()
        .map(|d| d.with_timezone(&chrono::Utc))
}

fn diff_fields(local: &Payload, remote: &Payload) -> Vec<String> {
    let mut changed = vec![];
    if local.project_id != remote.project_id { changed.push("project_id".into()); }
    if local.cloudinary_tags != remote.cloudinary_tags { changed.push("cloudinary_tags".into()); }
    if local.cloudinary_public_id != remote.cloudinary_public_id { changed.push("cloudinary_public_id".into()); }
    if local.local_updated_at != remote.local_updated_at { changed.push("local_updated_at".into()); }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::payload::{EmbeddingStatus, GpsStatus};

    fn make_payload(id: &str, ts: &str, project: &str) -> Payload {
        Payload {
            schema_version: 1,
            photo_id: id.into(),
            device_id: "dev".into(),
            captured_at: "2025-05-12T14:23:01Z".into(),
            lat: Some(0.0),
            lng: Some(0.0),
            gps_status: GpsStatus::Ok,
            project_id: project.into(),
            file_path: "f".into(),
            embedding_status: EmbeddingStatus::Ok,
            cloudinary_public_id: None,
            cloudinary_tags: vec![],
            cloudinary_objects: vec![],
            cloudinary_ocr_text: None,
            synced_at: None,
            local_updated_at: ts.into(),
            vector_checksum: "sha256:abc".into(),
        }
    }

    #[test]
    fn local_wins_when_newer() {
        let local = make_payload("p", "2025-05-12T10:00:05.000Z", "A");
        let remote = make_payload("p", "2025-05-12T10:00:01.000Z", "B");
        let d = resolve_conflict(&local, &remote);
        assert_eq!(d.winner, ConflictWinner::Local);
        assert_eq!(d.resolved_payload.project_id, "A");
    }

    #[test]
    fn remote_wins_when_newer() {
        let local = make_payload("p", "2025-05-12T10:00:01.000Z", "A");
        let remote = make_payload("p", "2025-05-12T10:00:05.000Z", "B");
        let d = resolve_conflict(&local, &remote);
        assert_eq!(d.winner, ConflictWinner::Remote);
        assert_eq!(d.resolved_payload.project_id, "B");
    }

    #[test]
    fn merged_within_one_second() {
        let local = make_payload("p", "2025-05-12T10:00:00.000Z", "A");
        let remote = make_payload("p", "2025-05-12T10:00:00.500Z", "B");
        let d = resolve_conflict(&local, &remote);
        assert_eq!(d.winner, ConflictWinner::Merged);
    }

    #[test]
    fn merge_takes_remote_metadata() {
        let mut local = make_payload("p", "2025-05-12T10:00:00.000Z", "A");
        let mut remote = make_payload("p", "2025-05-12T10:00:00.500Z", "B");
        local.cloudinary_tags = vec!["old".into()];
        remote.cloudinary_tags = vec!["new".into()];

        let d = resolve_conflict(&local, &remote);
        assert_eq!(d.winner, ConflictWinner::Merged);
        assert_eq!(d.resolved_payload.cloudinary_tags, vec!["new".to_string()]);
    }
}
