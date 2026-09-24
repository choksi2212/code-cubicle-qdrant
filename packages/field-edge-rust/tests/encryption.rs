//! Encryption end-to-end integration tests.
//!
//! Covers:
//!   * Round-trip + tamper detection at the Cipher layer.
//!   * Encrypted WAL persistence + corruption handling.
//!   * Encrypted shard persistence + retrieval.
//!
//! These run on every commit via `cargo test --test encryption`.
//! Keystore-dependent paths are exercised separately by the Android
//! instrumentation tests in `apps/mobile/android/...`.

use field_edge_rust::edge::{EncryptedInMemoryEdge, EdgeOps, Filter, Point, QueryRequest};
use field_edge_rust::models::payload::{EmbeddingStatus, GpsStatus, Payload, CURRENT_SCHEMA_VERSION};
use field_edge_rust::storage::encryption::{
    AesGcmCipher, AesGcmError, Cipher, KEY_LEN, NONCE_LEN, TAG_LEN,
};
use field_edge_rust::storage::keyring::KeyRing;
use field_edge_rust::wal::log::{
    EncryptedWal, EncryptedWalReader, WalEntry, WalOp, WAL_AAD, WAL_MAGIC_ENCRYPTED,
};
use std::sync::Arc;

fn test_key() -> [u8; KEY_LEN] {
    let mut k = [0u8; KEY_LEN];
    for (i, b) in k.iter_mut().enumerate() {
        *b = (i as u8).wrapping_mul(31);
    }
    k
}

fn make_payload(id: &str, project: &str) -> Payload {
    Payload {
        schema_version: CURRENT_SCHEMA_VERSION,
        photo_id: id.into(),
        device_id: "enc-test".into(),
        captured_at: "2025-05-12T14:23:01Z".into(),
        lat: Some(13.4521),
        lng: Some(75.1234),
        gps_status: GpsStatus::Ok,
        project_id: project.into(),
        file_path: format!("{}.jpg", id),
        embedding_status: EmbeddingStatus::Ok,
        enrichment_id: None,
        enrichment_tags: vec!["alpha".into()],
        enrichment_objects: vec![],
        enrichment_text: None,
        synced_at: None,
        local_updated_at: "2025-05-12T14:23:01Z".into(),
        vector_checksum: format!("sha256:{}", id),
        deletion_marker: false,
        project_owner: None,
        tags_v2: vec!["alpha".into()],
    }
}

fn make_entry(seq: u64, id: &str) -> WalEntry {
    WalEntry {
        op: WalOp::Upsert,
        seq,
        point: Some(Point {
            id: id.into(),
            vector: vec![0.1; 512],
            payload: make_payload(id, "river"),
        }),
        point_id: Some(id.into()),
        ts: "2025-05-12T14:23:01Z".into(),
        sync_state: "pending".into(),
    }
}

// ─── Cipher: round-trip, tamper, framing ────────────────────────────────────

#[test]
fn cipher_round_trip_4kb_payload() {
    let c = AesGcmCipher::new(test_key());
    let pt: Vec<u8> = (0..4096).map(|i| (i % 251) as u8).collect();
    let ct = c.encrypt(&pt, WAL_AAD);
    assert_eq!(ct.len(), pt.len() + NONCE_LEN + TAG_LEN);
    let back = c.decrypt(&ct, WAL_AAD).expect("decrypt 4kb");
    assert_eq!(back, pt);
}

#[test]
fn cipher_tamper_one_byte_fails() {
    let c = AesGcmCipher::new(test_key());
    let mut ct = c.encrypt(b"important data", b"aad");
    ct[NONCE_LEN] ^= 0x01;
    let err = c.decrypt(&ct, b"aad").unwrap_err();
    assert_eq!(err, AesGcmError::TagMismatch);
}

#[test]
fn cipher_nonce_uniqueness() {
    let c = AesGcmCipher::new(test_key());
    let pt = b"repeat me";
    let ct1 = c.encrypt(pt, b"");
    let ct2 = c.encrypt(pt, b"");
    assert_ne!(ct1, ct2, "nonces must differ");
}

#[test]
fn cipher_aad_mismatch_rejected() {
    let c = AesGcmCipher::new(test_key());
    let ct = c.encrypt(b"x", b"context-A");
    let err = c.decrypt(&ct, b"context-B").unwrap_err();
    assert_eq!(err, AesGcmError::TagMismatch);
}

#[test]
fn cipher_short_blob_rejected() {
    let c = AesGcmCipher::new(test_key());
    let err = c.decrypt(&[0u8; 5], b"").unwrap_err();
    assert_eq!(err, AesGcmError::InvalidFormat);
}

// ─── Encrypted WAL ──────────────────────────────────────────────────────────

#[test]
fn encrypted_wal_round_trip_10_entries() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("enc.wal");
    let cipher: Arc<dyn Cipher> = Arc::new(AesGcmCipher::new(test_key()));

    let mut writer = EncryptedWal::open_with_cipher(&path, cipher.clone()).expect("open");
    for i in 0..10 {
        writer
            .append(&make_entry(i, &format!("p{:02}", i)))
            .expect("append");
    }
    drop(writer);

    let reader = EncryptedWalReader::open(&path, cipher).expect("reader open");
    let entries: Vec<WalEntry> = reader.map(|r| r.expect("entry")).collect();
    assert_eq!(entries.len(), 10);
    for (i, entry) in entries.iter().enumerate() {
        assert_eq!(entry.seq, i as u64);
        assert_eq!(entry.point.as_ref().unwrap().id, format!("p{:02}", i));
        assert_eq!(entry.point.as_ref().unwrap().payload.project_id, "river");
    }
}

#[test]
fn encrypted_wal_rejects_plaintext_magic() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("mixed.wal");

    // Write a plaintext magic (FELG) by hand; the encrypted reader
    // must reject it as UnknownFormat rather than panic.
    std::fs::write(&path, b"FELG\x01\x00\x00\x00\x00").unwrap();

    let cipher: Arc<dyn Cipher> = Arc::new(AesGcmCipher::new(test_key()));
    let reader = EncryptedWalReader::open(&path, cipher).expect("reader open");
    let err = reader.into_iter().next().expect("one item").unwrap_err();
    let msg = format!("{}", err);
    assert!(
        msg.contains("Unknown WAL format"),
        "expected unknown-format error, got: {}",
        msg
    );
}

#[test]
fn encrypted_wal_magic_constant() {
    // Lock the magic so an accidental rename forces a deliberate schema bump.
    assert_eq!(WAL_MAGIC_ENCRYPTED, b"ENC1");
}

// ─── Encrypted shard ────────────────────────────────────────────────────────

#[test]
fn encrypted_shard_round_trip_5_points() {
    let dir = tempfile::tempdir().expect("tempdir");
    let keyring = KeyRing::from_raw_key(test_key());
    let shard = EncryptedInMemoryEdge::new(dir.path().to_str().unwrap(), &keyring).expect("open");

    let pts: Vec<Point> = (0..5)
        .map(|i| Point {
            id: format!("p{}", i),
            vector: vec![0.1 * (i as f32 + 1.0); 512],
            payload: make_payload(&format!("p{}", i), "river"),
        })
        .collect();
    shard.upsert(&pts).expect("upsert");
    shard.close().expect("close");

    // Reopen with the same key and verify everything survived.
    let shard2 = EncryptedInMemoryEdge::new(dir.path().to_str().unwrap(), &keyring).expect("reopen");
    assert_eq!(shard2.len().unwrap(), 5);
    let rec = shard2.retrieve(&["p2".into()]).expect("retrieve");
    assert_eq!(rec.len(), 1);
    assert_eq!(rec[0].id, "p2");
    assert_eq!(rec[0].payload.project_id, "river");
}

#[test]
fn encrypted_shard_query_with_filter() {
    let dir = tempfile::tempdir().expect("tempdir");
    let keyring = KeyRing::from_raw_key(test_key());
    let shard = EncryptedInMemoryEdge::new(dir.path().to_str().unwrap(), &keyring).expect("open");

    let pts: Vec<Point> = vec![
        Point {
            id: "river-1".into(),
            vector: vec![0.1; 512],
            payload: make_payload("river-1", "river"),
        },
        Point {
            id: "forest-1".into(),
            vector: vec![0.1; 512],
            payload: make_payload("forest-1", "forest"),
        },
    ];
    shard.upsert(&pts).expect("upsert");

    let req = QueryRequest {
        vector: vec![0.1; 512],
        limit: 10,
        filter: Some(Filter::Match {
            key: "project_id".into(),
            value: serde_json::json!("forest"),
        }),
        with_payload: true,
        with_vector: false,
        ef: 64,
    };
    let hits = shard.query(&req).expect("query");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, "forest-1");
}

#[test]
fn encrypted_shard_wrong_key_fails_to_load() {
    let dir = tempfile::tempdir().expect("tempdir");
    let keyring = KeyRing::from_raw_key(test_key());
    let shard = EncryptedInMemoryEdge::new(dir.path().to_str().unwrap(), &keyring).expect("open");
    shard
        .upsert(&[Point {
            id: "p1".into(),
            vector: vec![0.1; 512],
            payload: make_payload("p1", "river"),
        }])
        .expect("upsert");
    shard.close().expect("close");

    // Reopen with a different key — decrypt must fail (tag mismatch).
    let mut other_key = test_key();
    other_key[0] ^= 0xFF;
    let bad_keyring = KeyRing::from_raw_key(other_key);
    let shard2 = EncryptedInMemoryEdge::new(dir.path().to_str().unwrap(), &bad_keyring).expect("open");
    // Bad key ⇒ empty store (we warn-and-fall-back rather than crash).
    assert_eq!(shard2.len().unwrap(), 0);
}
