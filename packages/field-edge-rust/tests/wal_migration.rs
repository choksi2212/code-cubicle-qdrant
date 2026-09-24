//! WAL migration — replaying v1 entries must produce v2 payloads.
//!
//! Older FieldEdge clients write payloads at `schema_version: 1` (no
//! soft-delete, no project owner, no `tags_v2`). When the WAL is replayed
//! after a crash, the reader upgrades each entry to the current schema
//! before handing it to the edge shard. This test writes v1 entries
//! directly to a WAL and asserts that what comes back is v2 with the
//! expected defaults.

use field_edge_rust::edge::Point;
use field_edge_rust::models::payload::{EmbeddingStatus, GpsStatus, PayloadV2, CURRENT_SCHEMA_VERSION};
use field_edge_rust::wal::log::{WalEntry, WalOp, WalReader, WalWriter};

fn v1_entry_json(seq: u64, id: &str) -> String {
    let vector: Vec<f32> = vec![0.1; 8];
    serde_json::json!({
        "op": "upsert",
        "seq": seq,
        "point": {
            "id": id,
            "vector": vector,
            "payload": {
                "schema_version": 1,
                "photo_id": id,
                "device_id": "dev-old",
                "captured_at": "2025-05-12T14:23:01Z",
                "lat": 12.34,
                "lng": 56.78,
                "gps_status": "ok",
                "project_id": "legacy-project",
                "file_path": "/photos/legacy.jpg",
                "embedding_status": "ok",
                "enrichment_id": null,
                "enrichment_tags": ["alpha", "beta"],
                "enrichment_objects": [],
                "enrichment_text": null,
                "synced_at": null,
                "local_updated_at": "2025-05-12T14:23:01Z",
                "vector_checksum": "sha256:legacy"
            }
        },
        "point_id": id,
        "ts": "2025-05-12T14:23:01Z",
        "sync_state": "pending"
    })
    .to_string()
}

fn write_v1_entry(path: &std::path::Path, seq: u64, id: &str) {
    let raw = v1_entry_json(seq, id);
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .unwrap();
    use std::io::Write;
    f.write_all(b"FELG").unwrap();
    f.write_all(&[0x01]).unwrap(); // WalOp::Upsert
    let bytes = raw.into_bytes();
    let len = bytes.len() as u32;
    f.write_all(&len.to_le_bytes()).unwrap();
    f.write_all(&bytes).unwrap();
    f.sync_data().unwrap();
}

#[test]
fn replay_upgrades_v1_entries_to_v2() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("v1.wal");

    // Write two v1 entries by hand.
    write_v1_entry(&path, 1, "p1");
    write_v1_entry(&path, 2, "p2");

    // Replay.
    let reader = WalReader::open(&path).unwrap();
    let entries: Vec<WalEntry> = reader.map(|r| r.expect("read entry")).collect();

    assert_eq!(entries.len(), 2);

    for entry in &entries {
        let point: &Point = entry
            .point
            .as_ref()
            .expect("upsert entry must carry a point");
        // After migration, the payload is always v2 — the WAL migrator
        // produces `PayloadV2` regardless of the on-disk schema_version.
        assert_eq!(point.payload.schema_version, CURRENT_SCHEMA_VERSION);
        assert!(!point.payload.deletion_marker);
        assert!(point.payload.project_owner.is_none());
        // tags_v2 should mirror enrichment_tags for legacy v1 entries.
        assert_eq!(point.payload.tags_v2, vec!["alpha", "beta"]);
        // The op stays as written on disk.
        assert_eq!(entry.op, WalOp::Upsert);
    }

    // The vector survived the round trip.
    let v = &entries[0].point.as_ref().unwrap().vector;
    assert_eq!(v.len(), 8);
}

#[test]
fn replay_upgrades_v2_entries_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("v2.wal");

    // Write a v2 entry using the high-level API.
    let mut writer = WalWriter::create(&path).unwrap();
    let payload = PayloadV2 {
        schema_version: 2,
        photo_id: "p".into(),
        device_id: "d".into(),
        captured_at: "2025-05-12T14:23:01Z".into(),
        lat: None,
        lng: None,
        gps_status: GpsStatus::Ok,
        project_id: "P".into(),
        file_path: "f".into(),
        embedding_status: EmbeddingStatus::Ok,
        enrichment_id: None,
        enrichment_tags: vec![],
        enrichment_objects: vec![],
        enrichment_text: None,
        synced_at: None,
        local_updated_at: "2025-05-12T14:23:01Z".into(),
        vector_checksum: "sha256:abc".into(),
        deletion_marker: true,
        project_owner: Some("alice".into()),
        tags_v2: vec!["a".into(), "b".into()],
    };
    writer
        .append(&WalEntry {
            op: WalOp::Upsert,
            seq: 1,
            point: Some(Point {
                id: "p".into(),
                vector: vec![0.0; 4],
                payload,
            }),
            point_id: Some("p".into()),
            ts: "2025-05-12T14:23:01Z".into(),
            sync_state: "pending".into(),
        })
        .unwrap();
    drop(writer);

    let reader = WalReader::open(&path).unwrap();
    let entries: Vec<WalEntry> = reader.map(|r| r.unwrap()).collect();
    assert_eq!(entries.len(), 1);
    let p = entries[0].point.as_ref().unwrap();
    assert!(p.payload.deletion_marker);
    assert_eq!(p.payload.project_owner.as_deref(), Some("alice"));
    assert_eq!(p.payload.tags_v2, vec!["a".to_string(), "b".to_string()]);
}
