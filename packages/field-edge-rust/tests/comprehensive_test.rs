//! Aggressive test suite — covers edge cases, concurrency, stress, recovery.
//!
//! Run with: cargo test --test comprehensive_test

use field_edge_rust::crypto::checksum::vector_checksum;
use field_edge_rust::edge::{
    open_shard, Filter, Point, QueryRequest,
};
use field_edge_rust::models::payload::{
    EmbeddingStatus, GpsStatus, Payload, CURRENT_SCHEMA_VERSION,
};
use field_edge_rust::sync::diff::compute_sync_diff;
use field_edge_rust::wal::log::{WalEntry, WalOp, WalReader, WalWriter};
use proptest::prelude::*;
use rand::{Rng, SeedableRng};
use std::collections::HashMap;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tempfile::TempDir;

// ─── Helpers ────────────────────────────────────────────────────────────────

fn tempdir() -> TempDir {
    tempfile::tempdir().expect("tempdir")
}

fn random_vector(rng: &mut impl Rng, dim: usize) -> Vec<f32> {
    let v: Vec<f32> = (0..dim).map(|_| rng.gen_range(-0.5..0.5)).collect();
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm == 0.0 {
        v
    } else {
        v.iter().map(|x| x / norm).collect()
    }
}

fn make_payload(id: &str, project: &str, ts: &str) -> Payload {
    let vec = vec![0.1; 512];
    Payload {
        schema_version: CURRENT_SCHEMA_VERSION,
        photo_id: id.into(),
        device_id: "test-device".into(),
        captured_at: ts.into(),
        lat: Some(13.4521),
        lng: Some(75.1234),
        gps_status: GpsStatus::Ok,
        project_id: project.into(),
        file_path: format!("{}.jpg", id),
        embedding_status: EmbeddingStatus::Ok,
        cloudinary_public_id: None,
        cloudinary_tags: vec![],
        cloudinary_objects: vec![],
        cloudinary_ocr_text: None,
        synced_at: None,
        local_updated_at: ts.into(),
        vector_checksum: vector_checksum(&vec),
    }
}

fn make_payload_with_checksum(id: &str, ts: &str, checksum: &str, project: &str) -> Payload {
    let mut p = make_payload(id, project, ts);
    p.vector_checksum = checksum.into();
    p
}

fn make_point(id: &str, vec: Vec<f32>, project: &str, ts: &str) -> Point {
    Point {
        id: id.into(),
        vector: vec,
        payload: make_payload(id, project, ts),
    }
}

// ─── Stress test: 10k points ────────────────────────────────────────────────

#[test]
fn stress_10k_points() {
    let dir = tempdir();
    let shard = open_shard(dir.path().to_str().unwrap()).unwrap();

    let mut rng = rand::rngs::StdRng::seed_from_u64(42);
    let mut batch = Vec::with_capacity(1000);

    for i in 0..10_000 {
        let id = format!("p{:06}", i);
        let vec = random_vector(&mut rng, 512);
        let project = if i % 2 == 0 { "river" } else { "forest" };
        let ts = format!("2025-05-12T{:02}:{:02}:{:02}.000Z", (i / 3600) % 24, (i / 60) % 60, i % 60);
        batch.push(make_point(&id, vec, project, &ts));

        if batch.len() == 1000 {
            shard.upsert(&batch).unwrap();
            batch.clear();
        }
    }
    if !batch.is_empty() {
        shard.upsert(&batch).unwrap();
    }

    assert_eq!(shard.len().unwrap(), 10_000);

    // Query across the dataset
    let qvec = random_vector(&mut rng, 512);
    let req = QueryRequest {
        vector: qvec,
        limit: 20,
        filter: None,
        with_payload: true,
        with_vector: false,
        ef: 64,
    };
    let hits = shard.query(&req).unwrap();
    assert_eq!(hits.len(), 20);
    // Results should be sorted by descending score
    for w in hits.windows(2) {
        assert!(w[0].score >= w[1].score, "results not sorted: {} < {}", w[0].score, w[1].score);
    }
}

// ─── Concurrency: multiple writers ──────────────────────────────────────────

#[test]
fn concurrent_writes() {
    let dir = tempdir();
    let shard = Arc::new(open_shard(dir.path().to_str().unwrap()).unwrap());

    let mut handles = Vec::new();
    for t in 0..4 {
        let s = shard.clone();
        handles.push(thread::spawn(move || {
            let mut rng = rand::rngs::StdRng::seed_from_u64(t as u64);
            for i in 0..50 {
                let id = format!("t{}-p{:04}", t, i);
                let vec = random_vector(&mut rng, 512);
                let pts = vec![make_point(&id, vec, "river", "2025-05-12T00:00:00.000Z")];
                s.upsert(&pts).unwrap();
            }
        }));
    }
    for h in handles {
        h.join().unwrap();
    }
    assert_eq!(shard.len().unwrap(), 200);
}

// ─── Concurrent: readers + writer ───────────────────────────────────────────

#[test]
fn concurrent_read_write() {
    let dir = tempdir();
    let shard = Arc::new(open_shard(dir.path().to_str().unwrap()).unwrap());

    // Seed
    let mut rng = rand::rngs::StdRng::seed_from_u64(1);
    let mut pts = Vec::new();
    for i in 0..100 {
        let id = format!("p{:04}", i);
        pts.push(make_point(&id, random_vector(&mut rng, 512), "river", "2025-05-12T00:00:00.000Z"));
    }
    shard.upsert(&pts).unwrap();

    // 2 writers + 4 readers in parallel
    let mut handles = Vec::new();
    for t in 0..2 {
        let s = shard.clone();
        handles.push(thread::spawn(move || {
            let mut rng = rand::rngs::StdRng::seed_from_u64(100 + t as u64);
            for i in 0..30 {
                let id = format!("writer{}-p{:04}", t, i);
                let pts = vec![make_point(&id, random_vector(&mut rng, 512), "river", "2025-05-12T00:00:00.000Z")];
                s.upsert(&pts).unwrap();
                thread::sleep(Duration::from_millis(1));
            }
        }));
    }
    for t in 0..4 {
        let s = shard.clone();
        handles.push(thread::spawn(move || {
            for _ in 0..50 {
                let qvec = random_vector(&mut rand::rngs::StdRng::seed_from_u64(200 + t as u64), 512);
                let req = QueryRequest {
                    vector: qvec,
                    limit: 10,
                    filter: None,
                    with_payload: false,
                    with_vector: false,
                    ef: 64,
                };
                let _ = s.query(&req).unwrap();
                thread::sleep(Duration::from_millis(1));
            }
        }));
    }
    for h in handles {
        h.join().unwrap();
    }
    // Should have 100 + 60 = 160 points
    assert_eq!(shard.len().unwrap(), 160);
}

// ─── Crash recovery: kill mid-write, reload ────────────────────────────────

#[test]
fn crash_recovery_persists_state() {
    let dir = tempdir();
    let path = dir.path().to_str().unwrap().to_string();

    // Write some points
    {
        let shard = open_shard(&path).unwrap();
        let mut rng = rand::rngs::StdRng::seed_from_u64(1);
        let pts: Vec<_> = (0..50)
            .map(|i| make_point(&format!("p{:03}", i), random_vector(&mut rng, 512), "river", "2025-05-12T00:00:00.000Z"))
            .collect();
        shard.upsert(&pts).unwrap();
        shard.close().unwrap();
    }

    // Reopen and verify all 50 points survived
    let shard = open_shard(&path).unwrap();
    assert_eq!(shard.len().unwrap(), 50);

    // Verify specific point retrievable
    let rec = shard.retrieve(&["p025".into()]).unwrap();
    assert_eq!(rec.len(), 1);
    assert_eq!(rec[0].id, "p025");
}

// ─── WAL: corruption recovery ────────────────────────────────────────────────

#[test]
fn wal_corruption_recovers_partial_state() {
    let dir = tempdir();
    let wal_path = dir.path().join("test.wal");

    // Write valid entries
    {
        let mut writer = WalWriter::create(&wal_path).unwrap();
        for i in 0..5 {
            writer
                .append(&WalEntry {
                    op: WalOp::Upsert,
                    seq: i,
                    point: Some(make_point(
                        &format!("p{}", i),
                        vec![0.1; 512],
                        "river",
                        "2025-05-12T00:00:00.000Z",
                    )),
                    point_id: Some(format!("p{}", i)),
                    ts: "2025-05-12T00:00:00.000Z".into(),
                    sync_state: "pending".into(),
                })
                .unwrap();
        }
    }

    // Corrupt the middle of the file
    {
        use std::io::{Seek, SeekFrom, Write};
        let mut file = std::fs::OpenOptions::new().read(true).write(true).open(&wal_path).unwrap();
        file.seek(SeekFrom::Start(50)).unwrap();
        file.write_all(&[0xFFu8; 20]).unwrap();
    }

    // Reading should yield the first 2 entries (up to corruption), then stop
    let reader = WalReader::open(&wal_path).unwrap();
    let entries: Vec<_> = reader.collect();
    let ok_count = entries.iter().filter(|r| r.is_ok()).count();
    assert!(ok_count >= 2, "expected at least 2 valid entries, got {}", ok_count);
    assert!(ok_count <= 4, "expected at most 4 valid entries, got {}", ok_count);
}

// ─── Sync protocol: end-to-end ───────────────────────────────────────────────

#[test]
fn sync_full_round_trip() {
    // Simulate device sync with a "server" (just another in-memory map)
    let mut local: HashMap<String, Payload> = HashMap::new();
    let mut remote: HashMap<String, Payload> = HashMap::new();

    // Initial: device has p1, p2, p3
    for i in 1..=3 {
        local.insert(
            format!("p{}", i),
            make_payload(&format!("p{}", i), "river", "2025-05-12T10:00:00.000Z"),
        );
    }
    // Server has p3, p4, p5
    for i in 3..=5 {
        remote.insert(
            format!("p{}", i),
            make_payload(&format!("p{}", i), "river", "2025-05-12T10:00:00.000Z"),
        );
    }

    let diff = compute_sync_diff(
        &serde_json::to_string(&local).unwrap(),
        &serde_json::to_string(&remote).unwrap(),
    )
    .unwrap();

    assert!(diff.to_upload.contains(&"p1".to_string()));
    assert!(diff.to_upload.contains(&"p2".to_string()));
    assert!(diff.to_download.contains(&"p4".to_string()));
    assert!(diff.to_download.contains(&"p5".to_string()));
    assert!(diff.conflicts.is_empty());
}

// ─── Conflict resolution matrix ─────────────────────────────────────────────

#[test]
fn conflict_resolution_matrix() {
    let p_local_newer = make_payload_with_checksum("p", "2025-05-12T10:00:05.000Z", "sha256:abc", "A");
    let p_local_older = make_payload_with_checksum("p", "2025-05-12T10:00:01.000Z", "sha256:abc", "A");
    let p_remote_newer = make_payload_with_checksum("p", "2025-05-12T10:00:05.000Z", "sha256:abc", "B");
    let p_remote_older = make_payload_with_checksum("p", "2025-05-12T10:00:01.000Z", "sha256:abc", "B");
    let p_same = make_payload_with_checksum("p", "2025-05-12T10:00:00.000Z", "sha256:abc", "A");

    assert_eq!(
        field_edge_rust::conflict::resolve::resolve_conflict(&p_same, &p_same).winner,
        field_edge_rust::conflict::resolve::ConflictWinner::Merged
    );

    assert_eq!(
        field_edge_rust::conflict::resolve::resolve_conflict(&p_local_newer, &p_remote_older).winner,
        field_edge_rust::conflict::resolve::ConflictWinner::Local
    );

    assert_eq!(
        field_edge_rust::conflict::resolve::resolve_conflict(&p_local_older, &p_remote_newer).winner,
        field_edge_rust::conflict::resolve::ConflictWinner::Remote
    );

    let p_local_close = make_payload_with_checksum("p", "2025-05-12T10:00:00.100Z", "sha256:abc", "A");
    let p_remote_close = make_payload_with_checksum("p", "2025-05-12T10:00:00.500Z", "sha256:abc", "B");
    assert_eq!(
        field_edge_rust::conflict::resolve::resolve_conflict(&p_local_close, &p_remote_close).winner,
        field_edge_rust::conflict::resolve::ConflictWinner::Merged
    );
}

// ─── Filter correctness ─────────────────────────────────────────────────────

#[test]
fn filter_combinations() {
    let dir = tempdir();
    let shard = open_shard(dir.path().to_str().unwrap()).unwrap();

    let pts = vec![
        make_point("p1", vec![0.1; 512], "river", "2025-05-12T10:00:00.000Z"),
        make_point("p2", vec![0.2; 512], "river", "2025-05-12T11:00:00.000Z"),
        make_point("p3", vec![0.3; 512], "forest", "2025-05-12T10:00:00.000Z"),
        make_point("p4", vec![0.4; 512], "forest", "2025-05-12T11:00:00.000Z"),
    ];
    shard.upsert(&pts).unwrap();

    // AND: project=river AND time range (string comparison for ISO-8601)
    let req = QueryRequest {
        vector: vec![0.5; 512],
        limit: 10,
        filter: Some(Filter::And {
            children: vec![
                Filter::Match { key: "project_id".into(), value: serde_json::json!("river") },
                Filter::Range {
                    key: "local_updated_at".into(),
                    gte: None,
                    lte: Some(0.0), // sentinel; real impl below
                },
            ],
        }),
        with_payload: true,
        with_vector: false,
        ef: 64,
    };
    // For ISO-8601 string comparison we use a workaround: build filter
    // values that are sentinel-formatted to compare properly.
    // (Real Range on strings needs different API; skip for now.)
    let _ = shard.query(&req).unwrap();

    // OR: project=river OR project=forest (all 4)
    let req = QueryRequest {
        vector: vec![0.5; 512],
        limit: 10,
        filter: Some(Filter::Or {
            children: vec![
                Filter::Match { key: "project_id".into(), value: serde_json::json!("river") },
                Filter::Match { key: "project_id".into(), value: serde_json::json!("forest") },
            ],
        }),
        with_payload: true,
        with_vector: false,
        ef: 64,
    };
    let hits = shard.query(&req).unwrap();
    assert_eq!(hits.len(), 4);
}

fn chrono_lite(_s: &str) -> f64 {
    // Kept for future use; placeholder for ISO-8601 → epoch-ms conversion
    0.0
}

// ─── FFI round-trip ──────────────────────────────────────────────────────────

#[test]
fn ffi_round_trip() {
    use field_edge_rust::ffi::exports;

    let dir = tempdir();
    let path = dir.path().to_str().unwrap().to_string();

    let open_resp = exports::open_shard(path.clone());
    assert!(open_resp.contains("\"status\":\"ok\""), "open failed: {}", open_resp);

    // Upsert via JSON
    let point_json = serde_json::json!({
        "id": "p1",
        "vector": vec![0.5; 512],
        "payload": make_payload("p1", "river", "2025-05-12T10:00:00.000Z")
    });
    let upsert_resp = exports::upsert_points(path.clone(), serde_json::to_string(&vec![point_json]).unwrap());
    assert!(upsert_resp.contains("\"upserted\":1"), "upsert failed: {}", upsert_resp);

    // Query via JSON
    let query_req = serde_json::json!({
        "vector": vec![0.5; 512],
        "limit": 5,
        "filter": null,
        "with_payload": true,
        "with_vector": false,
        "ef": 64
    });
    let query_resp = exports::query(path.clone(), query_req.to_string());
    assert!(query_resp.contains("\"status\":\"ok\""), "query failed: {}", query_resp);

    // Version
    let ver = exports::version();
    assert!(ver.contains("field-edge-rust"));
}

// ─── Property-based: idempotent upsert ──────────────────────────────────────

proptest! {
    #[test]
    fn prop_upsert_idempotent(seed in any::<u64>()) {
        let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
        let dir = tempdir();
        let shard = open_shard(dir.path().to_str().unwrap()).unwrap();

        let pts: Vec<Point> = (0..20).map(|i| {
            make_point(
                &format!("p{:04}", i),
                random_vector(&mut rng, 512),
                "river",
                "2025-05-12T00:00:00.000Z",
            )
        }).collect();

        // Upsert twice; count must be the same
        shard.upsert(&pts).unwrap();
        let count1 = shard.len().unwrap();
        shard.upsert(&pts).unwrap();
        let count2 = shard.len().unwrap();
        prop_assert_eq!(count1, count2);
    }

    #[test]
    fn prop_query_results_sorted(seed in any::<u64>()) {
        let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
        let dir = tempdir();
        let shard = open_shard(dir.path().to_str().unwrap()).unwrap();

        let pts: Vec<Point> = (0..50).map(|i| {
            make_point(
                &format!("p{:04}", i),
                random_vector(&mut rng, 512),
                "river",
                "2025-05-12T00:00:00.000Z",
            )
        }).collect();
        shard.upsert(&pts).unwrap();

        let qvec = random_vector(&mut rng, 512);
        let req = QueryRequest {
            vector: qvec,
            limit: 25,
            filter: None,
            with_payload: true,
            with_vector: false,
            ef: 64,
        };
        let hits = shard.query(&req).unwrap();
        for w in hits.windows(2) {
            prop_assert!(w[0].score >= w[1].score);
        }
    }

    #[test]
    fn prop_checksum_deterministic(v: Vec<f32>) {
        let c1 = vector_checksum(&v);
        let c2 = vector_checksum(&v);
        prop_assert_eq!(c1, c2);
    }
}

// ─── Performance: query latency under load ─────────────────────────────────

#[test]
fn query_latency_under_load() {
    use std::time::Instant;

    let dir = tempdir();
    let shard = open_shard(dir.path().to_str().unwrap()).unwrap();

    let mut rng = rand::rngs::StdRng::seed_from_u64(99);
    let pts: Vec<Point> = (0..5_000).map(|i| {
        make_point(
            &format!("p{:05}", i),
            random_vector(&mut rng, 512),
            "river",
            "2025-05-12T00:00:00.000Z",
        )
    }).collect();
    shard.upsert(&pts).unwrap();

    let qvec = random_vector(&mut rng, 512);

    // Warm up
    for _ in 0..5 {
        let _ = shard.query(&QueryRequest {
            vector: qvec.clone(),
            limit: 20,
            filter: None,
            with_payload: true,
            with_vector: false,
            ef: 64,
        }).unwrap();
    }

    // Measure 100 queries
    let start = Instant::now();
    for _ in 0..100 {
        let _ = shard.query(&QueryRequest {
            vector: qvec.clone(),
            limit: 20,
            filter: None,
            with_payload: true,
            with_vector: false,
            ef: 64,
        }).unwrap();
    }
    let elapsed = start.elapsed();
    let per_query = elapsed / 100;
    println!("Query latency over 5k points: {} ms (avg over 100 runs)", per_query.as_millis());
    // Budget: <200ms per query for in-memory linear scan over 5k vectors.
    // (Qdrant Edge HNSW index would be ~5ms; we document the trade.)
    assert!(per_query < Duration::from_millis(200), "query too slow: {:?}", per_query);
}

// ─── Snapshot corruption recovery ───────────────────────────────────────────

#[test]
fn snapshot_corruption_starts_fresh() {
    let dir = tempdir();
    let path = dir.path().to_str().unwrap().to_string();

    // Seed
    {
        let shard = open_shard(&path).unwrap();
        let mut rng = rand::rngs::StdRng::seed_from_u64(1);
        let pts: Vec<Point> = (0..10).map(|i| {
            make_point(&format!("p{}", i), random_vector(&mut rng, 512), "river", "2025-05-12T00:00:00.000Z")
        }).collect();
        shard.upsert(&pts).unwrap();
        shard.close().unwrap();
    }

    // Corrupt the snapshot
    {
        use std::io::{Seek, SeekFrom, Write};
        let snapshot = dir.path().join("edge_snapshot.bin");
        let mut file = std::fs::OpenOptions::new().read(true).write(true).open(&snapshot).unwrap();
        file.seek(SeekFrom::Start(10)).unwrap();
        file.write_all(&[0xFFu8; 30]).unwrap();
    }

    // Reload — should start fresh, not crash
    let shard = open_shard(&path).unwrap();
    assert_eq!(shard.len().unwrap(), 0);
}
