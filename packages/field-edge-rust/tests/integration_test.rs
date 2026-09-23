//! Integration tests for the FieldEdge Rust core
//!
//! Exercises: edge shard open/upsert/query, WAL round-trip,
//! sync diff, conflict resolution.

use field_edge_rust::crypto::checksum::vector_checksum;
use field_edge_rust::edge::{open_shard, EdgeOps, Point, QueryRequest};
use field_edge_rust::models::payload::{
    EmbeddingStatus, GpsStatus, Payload, CURRENT_SCHEMA_VERSION,
};
use field_edge_rust::sync::diff::{compute_sync_diff, resolve_by_timestamp, ConflictResolution};
use field_edge_rust::wal::log::{WalEntry, WalOp, WalReader, WalWriter};
use std::collections::HashMap;
use std::path::PathBuf;
use tempfile::TempDir;

fn test_dir() -> TempDir {
    tempfile::tempdir().expect("tempdir")
}

fn make_payload(id: &str, ts: &str, checksum: &str, project: &str) -> Payload {
    Payload {
        schema_version: CURRENT_SCHEMA_VERSION,
        photo_id: id.into(),
        device_id: "test-device".into(),
        captured_at: "2025-05-12T14:23:01.000Z".into(),
        lat: Some(13.4521),
        lng: Some(75.1234),
        gps_status: GpsStatus::Ok,
        project_id: project.into(),
        file_path: format!("test/{}.jpg", id),
        embedding_status: EmbeddingStatus::Ok,
        cloudinary_public_id: None,
        cloudinary_tags: vec![],
        cloudinary_objects: vec![],
        cloudinary_ocr_text: None,
        synced_at: None,
        local_updated_at: ts.into(),
        vector_checksum: checksum.into(),
    }
}

fn make_point(id: &str, vec: Vec<f32>, ts: &str, project: &str) -> Point {
    let checksum = vector_checksum(&vec);
    Point {
        id: id.into(),
        vector: vec,
        payload: make_payload(id, ts, &checksum, project),
    }
}

#[test]
fn edge_open_upsert_query_round_trip() {
    let dir = test_dir();
    let shard_dir = dir.path().to_str().unwrap();

    let shard = open_shard(shard_dir).expect("open");
    assert_eq!(shard.len().unwrap(), 0);

    // Upsert 3 points
    let pts = vec![
        make_point("p1", vec![0.1; 512], "2025-05-12T10:00:00Z", "river"),
        make_point("p2", vec![0.2; 512], "2025-05-12T10:01:00Z", "river"),
        make_point("p3", vec![0.3; 512], "2025-05-12T10:02:00Z", "forest"),
    ];
    shard.upsert(&pts).expect("upsert");
    assert_eq!(shard.len().unwrap(), 3);

    // Query
    let req = QueryRequest {
        vector: vec![0.15; 512],
        limit: 10,
        filter: None,
        with_payload: true,
        with_vector: false,
        ef: 64,
    };
    let hits = shard.query(&req).expect("query");
    assert!(hits.len() >= 1);

    shard.close().ok();
}

#[test]
fn edge_query_with_filter() {
    let dir = test_dir();
    let shard_dir = dir.path().to_str().unwrap();
    let shard = open_shard(shard_dir).unwrap();

    let pts = vec![
        make_point("p1", vec![0.1; 512], "2025-05-12T10:00:00Z", "river"),
        make_point("p2", vec![0.2; 512], "2025-05-12T10:01:00Z", "forest"),
    ];
    shard.upsert(&pts).unwrap();

    use field_edge_rust::edge::Filter;
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

    shard.close().ok();
}

#[test]
fn wal_round_trip() {
    let dir = test_dir();
    let wal_path: PathBuf = dir.path().join("test.wal");

    let mut writer = WalWriter::create(&wal_path).unwrap();
    let entry = WalEntry {
        op: WalOp::Upsert,
        seq: 1,
        point: Some(make_point("p1", vec![0.1; 512], "2025-05-12T10:00:00Z", "p")),
        point_id: Some("p1".into()),
        ts: "2025-05-12T10:00:00Z".into(),
        sync_state: "pending".into(),
    };
    writer.append(&entry).unwrap();
    drop(writer);

    let reader = WalReader::open(&wal_path).unwrap();
    let entries: Vec<_> = reader.collect();
    assert_eq!(entries.len(), 1);
    let e = entries[0].as_ref().unwrap();
    assert_eq!(e.seq, 1);
    assert_eq!(e.op, WalOp::Upsert);
}

#[test]
fn sync_diff_no_conflicts() {
    let mut local: HashMap<String, Payload> = HashMap::new();
    local.insert("p1".into(), make_payload("p1", "2025-05-12T10:00:00Z", "sha256:abc", "p"));
    let mut remote: HashMap<String, Payload> = HashMap::new();
    remote.insert("p1".into(), make_payload("p1", "2025-05-12T10:00:00Z", "sha256:abc", "p"));
    remote.insert("p2".into(), make_payload("p2", "2025-05-12T11:00:00Z", "sha256:def", "p"));

    let diff = compute_sync_diff(
        &serde_json::to_string(&local).unwrap(),
        &serde_json::to_string(&remote).unwrap(),
    )
    .unwrap();

    assert!(diff.conflicts.is_empty());
    assert!(diff.to_download.contains(&"p2".to_string()));
}

#[test]
fn sync_diff_detects_conflict() {
    let mut local: HashMap<String, Payload> = HashMap::new();
    local.insert("p1".into(), make_payload("p1", "2025-05-12T10:00:00Z", "sha256:abc", "A"));
    let mut remote: HashMap<String, Payload> = HashMap::new();
    remote.insert("p1".into(), make_payload("p1", "2025-05-12T10:00:00Z", "sha256:xyz", "B"));

    let diff = compute_sync_diff(
        &serde_json::to_string(&local).unwrap(),
        &serde_json::to_string(&remote).unwrap(),
    )
    .unwrap();

    assert!(diff.conflicts.contains(&"p1".to_string()));
}

#[test]
fn conflict_resolution_timestamp() {
    let local = make_payload("p1", "2025-05-12T10:00:02.000Z", "sha256:abc", "A");
    let remote = make_payload("p1", "2025-05-12T10:00:01.000Z", "sha256:abc", "B");
    assert_eq!(resolve_by_timestamp(&local, &remote), ConflictResolution::LocalWins);
}

#[test]
fn checksum_deterministic() {
    let v = vec![0.1, 0.2, 0.3, 0.4];
    let c1 = vector_checksum(&v);
    let c2 = vector_checksum(&v);
    assert_eq!(c1, c2);
    assert!(c1.starts_with("sha256:"));
}

#[test]
fn edge_retrieve_by_ids() {
    let dir = test_dir();
    let shard_dir = dir.path().to_str().unwrap();
    let shard = open_shard(shard_dir).unwrap();

    let pts = vec![
        make_point("p1", vec![0.1; 512], "2025-05-12T10:00:00Z", "p"),
        make_point("p2", vec![0.2; 512], "2025-05-12T10:01:00Z", "p"),
    ];
    shard.upsert(&pts).unwrap();

    let retrieved = shard.retrieve(&["p1".into(), "p2".into()]).unwrap();
    assert_eq!(retrieved.len(), 2);

    shard.close().ok();
}
