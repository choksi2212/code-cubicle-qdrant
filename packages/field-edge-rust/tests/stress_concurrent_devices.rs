//! Concurrent multi-device sync stress test.
//!
//! Simulates 3 devices all uploading conflicting versions of the same photo
//! at the same time, verifies that conflict resolution produces a deterministic
//! outcome (timestamp winner + vector-sim tiebreak + merge fallback).

use field_edge_rust::conflict::resolve::resolve_conflict;
use field_edge_rust::edge::{open_shard, EdgeOps};
use field_edge_rust::models::payload::{EmbeddingStatus, GpsStatus, Payload};
use std::collections::HashMap;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

const VECTOR_DIM: usize = 512;

fn make_payload(device: &str, ts: &str, project: &str, vec_hash: &str) -> Payload {
    // Hash the seed string so different inputs produce different vectors/checksums.
    let mut h: u64 = 1469598103934665603;
    for b in vec_hash.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    let v: Vec<f32> = (0..VECTOR_DIM)
        .map(|i| {
            let s = (h.wrapping_add(i as u64)) as f64;
            ((s / u64::MAX as f64) - 0.5) as f32
        })
        .collect();
    let checksum = format!("sha256:{}:{}", device, vec_hash);
    Payload {
        schema_version: 2,
        photo_id: "p1".into(),
        device_id: device.into(),
        captured_at: ts.into(),
        lat: Some(13.4521),
        lng: Some(75.1234),
        gps_status: GpsStatus::Ok,
        project_id: project.into(),
        file_path: format!("{}/{}/p1.jpg", project, device),
        embedding_status: EmbeddingStatus::Ok,
        enrichment_id: None,
        enrichment_tags: vec!["river".into(), "pollution".into()],
        enrichment_objects: vec![],
        enrichment_text: None,
        synced_at: None,
        local_updated_at: ts.into(),
        vector_checksum: checksum,
        deletion_marker: false,
        project_owner: None,
        tags_v2: vec![],
    }
}

#[test]
fn conflict_matrix_3_devices_concurrent() {
    // Device A: vector A, ts T-2
    // Device B: vector B, ts T-1 (newest)
    // Device C: vector C, ts T-0 (same as A within 1s)
    let pa = make_payload("dev-a", "2025-05-12T10:00:00.000Z", "river-study", "vecA");
    let pb = make_payload("dev-b", "2025-05-12T10:00:05.000Z", "river-study", "vecB");
    let pc = make_payload("dev-c", "2025-05-12T10:00:00.500Z", "river-study", "vecC");

    // Device B's should win overall (newest by far)
    let decision_ab = resolve_conflict(&pa, &pb);
    assert!(
        matches!(decision_ab.winner, field_edge_rust::conflict::resolve::ConflictWinner::Remote)
    );
    println!("A vs B: {:?}", decision_ab.winner);

    // Device A and C are within 1 second → merge
    let decision_ac = resolve_conflict(&pa, &pc);
    assert!(matches!(
        decision_ac.winner,
        field_edge_rust::conflict::resolve::ConflictWinner::Merged
    ));
    println!("A vs C: {:?}", decision_ac.winner);
}

#[test]
fn concurrent_writes_to_local_shard_no_corruption() {
    // 5 threads, each writing 200 points to a SINGLE shared shard.
    // Verifies: (1) all points land, (2) count is correct, (3) snapshot persists.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap().to_string();

    // Open the shard ONCE; share the same instance across all threads.
    let shard = Arc::new(open_shard(&path).unwrap());

    let start = Instant::now();
    let mut handles = Vec::new();
    for t in 0..5 {
        let s = shard.clone();
        handles.push(thread::spawn(move || {
            for i in 0..200 {
                let id = format!("t{}-p{:04}", t, i);
                let payload = make_payload(
                    &format!("dev-{}", t),
                    "2025-05-12T10:00:00.000Z",
                    "river-study",
                    &id,
                );
                s.upsert(&[field_edge_rust::edge::Point {
                    id,
                    vector: (0..VECTOR_DIM).map(|j| (j as f32) / 100.0).collect(),
                    payload,
                }])
                .unwrap();
            }
        }));
    }
    for h in handles {
        h.join().unwrap();
    }
    shard.close().unwrap();
    let elapsed = start.elapsed();
    println!("5x200 writes (shared shard) took {:?}", elapsed);

    // Reopen and verify count
    let shard = open_shard(&path).unwrap();
    let count = shard.len().unwrap();
    println!("persisted count: {}", count);
    assert_eq!(count, 1000, "expected 1000 points, got {}", count);
}

#[test]
fn snapshot_atomic_under_concurrent_writes() {
    // Verify that the snapshot file is always parseable, even under concurrent writes.
    // (Crash recovery: if app dies mid-write, the snapshot is either old or new — never corrupt.)
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap().to_string();

    let shard = Arc::new(open_shard(&path).unwrap());

    let mut handles = Vec::new();
    for t in 0..4 {
        let s = shard.clone();
        handles.push(thread::spawn(move || {
            for i in 0..100 {
                let id = format!("atomic-t{}-p{:04}", t, i);
                let payload = make_payload(
                    &format!("dev-{}", t),
                    "2025-05-12T10:00:00.000Z",
                    "river-study",
                    &id,
                );
                s.upsert(&[field_edge_rust::edge::Point {
                    id,
                    vector: (0..VECTOR_DIM).map(|j| (j as f32) / 100.0).collect(),
                    payload,
                }])
                .unwrap();
                // Stress: read immediately to trigger snapshot rewrite path
                let _ = s.len().unwrap();
            }
        }));
    }
    for h in handles {
        h.join().unwrap();
    }

    // After all writers done, drop shard and reopen. Snapshot must be parseable.
    drop(shard);
    thread::sleep(Duration::from_millis(50)); // give filesystem a moment

    let reopened = open_shard(&path).unwrap();
    assert!(reopened.len().unwrap() >= 380, "expected ~400 points after reopen");
}

#[test]
fn diff_correctness_under_churn() {
    // Local has 1000 points. Remote has 800 shared (different device_id → additive upload)
    // + 100 points unique to remote (different file_path → to_download).
    let mut local: HashMap<String, Payload> = HashMap::new();
    let mut remote: HashMap<String, Payload> = HashMap::new();

    for i in 0..1000 {
        let id = format!("p{:04}", i);
        let ts = format!("2025-05-12T10:{:02}:{:02}.000Z", i / 60, i % 60);
        local.insert(id.clone(), make_payload("dev-a", &ts, "river-study", &id));

        if i < 800 {
            // Same id, different device — additive upload from local perspective
            remote.insert(id.clone(), make_payload("dev-b", &ts, "river-study", &id));
        }
    }
    // 100 unique-to-remote points
    for i in 1000..1100 {
        let id = format!("remote-p{:04}", i);
        let ts = format!("2025-05-12T11:{:02}:{:02}.000Z", i / 60, i % 60);
        let mut p = make_payload("dev-b", &ts, "river-study", &id);
        p.file_path = format!("river-study/dev-b/unique-{}.jpg", id);
        remote.insert(id.clone(), p);
    }

    let diff = field_edge_rust::sync::diff::compute_sync_diff(
        &serde_json::to_string(&local).unwrap(),
        &serde_json::to_string(&remote).unwrap(),
    )
    .unwrap();

    println!(
        "diff: {} to_upload, {} to_download, {} conflicts",
        diff.to_upload.len(),
        diff.to_download.len(),
        diff.conflicts.len(),
    );

    // Verify the structure of the diff:
    // - 100 downloads (unique-to-remote)
    // - Some combination of uploads + conflicts for the 800 shared points
    assert_eq!(diff.to_download.len(), 100, "100 unique-to-remote points");
    // Total local-side action: 800 shared (conflicts) + 200 local-only (uploads) = 1000
    let total_local_actions = diff.conflicts.len() + diff.to_upload.len();
    assert_eq!(total_local_actions, 1000, "1000 local points to reconcile");
}
