//! End-to-end test of the C-ABI exports.
//!
//! Validates that the same JSON-string surface we expose to Android via JNI
//! works correctly. This is the test that runs on the host; the Kotlin
//! module mirrors these calls.
//!
//! Run: cargo test --test ffi_e2e_test

use field_edge_rust::ffi::exports as ffi;

#[test]
fn ffi_open_shard_ok() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap().to_string();
    let result = ffi::open_shard(path.clone());
    assert!(result.contains("\"status\":\"ok\""), "expected ok, got: {}", result);
}

#[test]
fn ffi_upsert_points_then_query() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap().to_string();
    let _ = ffi::open_shard(path.clone());

    // Build a single point
    let point_json = serde_json::json!({
        "id": "p1",
        "vector": vec![0.5_f32; 512],
        "payload": {
            "schema_version": 1,
            "photo_id": "p1",
            "device_id": "test",
            "captured_at": "2025-05-12T10:00:00.000Z",
            "lat": 0.0,
            "lng": 0.0,
            "gps_status": "ok",
            "project_id": "p",
            "file_path": "f",
            "embedding_status": "ok",
            "cloudinary_public_id": null,
            "cloudinary_tags": [],
            "cloudinary_objects": [],
            "cloudinary_ocr_text": null,
            "synced_at": null,
            "local_updated_at": "2025-05-12T10:00:00.000Z",
            "vector_checksum": "sha256:test",
        }
    });
    let upsert = ffi::upsert_points(path.clone(), serde_json::to_string(&vec![point_json]).unwrap());
    assert!(upsert.contains("\"upserted\":1"));

    // Query
    let query_req = serde_json::json!({
        "vector": vec![0.5_f32; 512],
        "limit": 5,
        "filter": null,
        "with_payload": true,
        "with_vector": false,
        "ef": 64
    });
    let query_result = ffi::query(path.clone(), query_req.to_string());
    assert!(query_result.contains("\"status\":\"ok\""), "got: {}", query_result);
    assert!(query_result.contains("\"id\":\"p1\""));
}

#[test]
fn ffi_sync_diff_no_conflicts() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap().to_string();
    let _ = ffi::open_shard(path);

    let mut local = serde_json::Map::new();
    local.insert("p1".into(), serde_json::json!({
        "schema_version": 1, "photo_id": "p1", "device_id": "d",
        "captured_at": "2025-05-12T10:00:00.000Z",
        "lat": 0.0, "lng": 0.0, "gps_status": "ok",
        "project_id": "p", "file_path": "f", "embedding_status": "ok",
        "cloudinary_public_id": null, "cloudinary_tags": [], "cloudinary_objects": [],
        "cloudinary_ocr_text": null, "synced_at": null,
        "local_updated_at": "2025-05-12T10:00:00.000Z", "vector_checksum": "sha256:abc"
    }));

    let mut remote = local.clone();
    remote.insert("p2".into(), serde_json::json!({
        "schema_version": 1, "photo_id": "p2", "device_id": "d",
        "captured_at": "2025-05-12T11:00:00.000Z",
        "lat": 0.0, "lng": 0.0, "gps_status": "ok",
        "project_id": "p", "file_path": "f", "embedding_status": "ok",
        "cloudinary_public_id": null, "cloudinary_tags": [], "cloudinary_objects": [],
        "cloudinary_ocr_text": null, "synced_at": null,
        "local_updated_at": "2025-05-12T11:00:00.000Z", "vector_checksum": "sha256:def"
    }));

    let result = ffi::sync_diff(
        serde_json::to_string(&local).unwrap(),
        serde_json::to_string(&remote).unwrap(),
    );
    assert!(result.contains("\"status\":\"ok\""));
    assert!(result.contains("\"to_upload\""));
    assert!(result.contains("\"to_download\""));
    assert!(result.contains("\"p2\""));
}

#[test]
fn ffi_resolve_conflict_merges_within_1s() {
    let p1 = serde_json::json!({
        "schema_version": 1, "photo_id": "p", "device_id": "d",
        "captured_at": "2025-05-12T10:00:00.000Z",
        "lat": 0.0, "lng": 0.0, "gps_status": "ok",
        "project_id": "A", "file_path": "f", "embedding_status": "ok",
        "cloudinary_public_id": null, "cloudinary_tags": [], "cloudinary_objects": [],
        "cloudinary_ocr_text": null, "synced_at": null,
        "local_updated_at": "2025-05-12T10:00:00.100Z", "vector_checksum": "sha256:abc"
    });
    let p2 = serde_json::json!({
        "schema_version": 1, "photo_id": "p", "device_id": "d",
        "captured_at": "2025-05-12T10:00:00.000Z",
        "lat": 0.0, "lng": 0.0, "gps_status": "ok",
        "project_id": "B", "file_path": "f", "embedding_status": "ok",
        "cloudinary_public_id": null, "cloudinary_tags": [], "cloudinary_objects": [],
        "cloudinary_ocr_text": null, "synced_at": null,
        "local_updated_at": "2025-05-12T10:00:00.500Z", "vector_checksum": "sha256:abc"
    });
    let result = ffi::resolve_conflict(p1.to_string(), p2.to_string());
    assert!(result.contains("\"status\":\"ok\""));
    assert!(result.contains("\"winner\""));
}

#[test]
fn ffi_checksum_format() {
    let v = vec![0.1_f32; 512];
    let result = ffi::checksum(serde_json::to_string(&v).unwrap());
    assert!(result.contains("\"status\":\"ok\""));
    assert!(result.contains("sha256:"));
}

#[test]
fn ffi_version_contains_metadata() {
    let result = ffi::version();
    assert!(result.contains("\"status\":\"ok\""));
    assert!(result.contains("field-edge-rust"));
    assert!(result.contains("\"version\""));
}

#[test]
fn ffi_point_count_after_upserts() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap().to_string();
    let _ = ffi::open_shard(path.clone());

    let mut points = Vec::new();
    for i in 0..3 {
        points.push(serde_json::json!({
            "id": format!("p{}", i),
            "vector": vec![0.5_f32; 512],
            "payload": {
                "schema_version": 1, "photo_id": format!("p{}", i), "device_id": "d",
                "captured_at": "2025-05-12T10:00:00.000Z",
                "lat": 0.0, "lng": 0.0, "gps_status": "ok",
                "project_id": "p", "file_path": "f", "embedding_status": "ok",
                "cloudinary_public_id": null, "cloudinary_tags": [], "cloudinary_objects": [],
                "cloudinary_ocr_text": null, "synced_at": null,
                "local_updated_at": "2025-05-12T10:00:00.000Z", "vector_checksum": "sha256:test"
            }
        }));
    }
    ffi::upsert_points(path.clone(), serde_json::to_string(&points).unwrap());

    let count = ffi::point_count(path);
    assert_eq!(count, 3);
}

#[test]
fn ffi_delete_points_removes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap().to_string();
    let _ = ffi::open_shard(path.clone());

    let point = serde_json::json!({
        "id": "p1", "vector": vec![0.5_f32; 512],
        "payload": {
            "schema_version": 1, "photo_id": "p1", "device_id": "d",
            "captured_at": "2025-05-12T10:00:00.000Z",
            "lat": 0.0, "lng": 0.0, "gps_status": "ok",
            "project_id": "p", "file_path": "f", "embedding_status": "ok",
            "cloudinary_public_id": null, "cloudinary_tags": [], "cloudinary_objects": [],
            "cloudinary_ocr_text": null, "synced_at": null,
            "local_updated_at": "2025-05-12T10:00:00.000Z", "vector_checksum": "sha256:test"
        }
    });
    ffi::upsert_points(path.clone(), serde_json::to_string(&vec![point]).unwrap());
    assert_eq!(ffi::point_count(path.clone()), 1);

    let del = ffi::delete_points(path.clone(), serde_json::to_string(&vec!["p1"]).unwrap());
    assert!(del.contains("\"deleted\":1"));
    assert_eq!(ffi::point_count(path), 0);
}
