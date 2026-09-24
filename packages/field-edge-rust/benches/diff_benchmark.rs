use criterion::{criterion_group, criterion_main, Criterion};
use field_edge_rust::sync::diff::compute_sync_diff;
use std::collections::HashMap;

fn bench_diff(c: &mut Criterion) {
    let mut local = HashMap::new();
    let mut remote = HashMap::new();
    for i in 0..1000 {
        let id = format!("p{}", i);
        let payload = serde_json::json!({
            "schema_version": 1,
            "photo_id": id,
            "device_id": "dev",
            "captured_at": "2025-05-12T10:00:00Z",
            "lat": 0.0,
            "lng": 0.0,
            "gps_status": "ok",
            "project_id": "p",
            "file_path": "f",
            "embedding_status": "ok",
            "enrichment_id": null,
            "enrichment_tags": [],
            "enrichment_objects": [],
            "enrichment_text": null,
            "synced_at": null,
            "local_updated_at": "2025-05-12T10:00:00Z",
            "vector_checksum": format!("sha256:{}", i),
        });
        local.insert(id.clone(), payload.clone());
        if i % 2 == 0 {
            remote.insert(id.clone(), payload.clone());
        } else {
            remote.insert(id, payload);
        }
    }

    let local_json = serde_json::to_string(&local).unwrap();
    let remote_json = serde_json::to_string(&remote).unwrap();

    c.bench_function("sync_diff_1k_points", |b| {
        b.iter(|| {
            compute_sync_diff(&local_json, &remote_json).unwrap();
        });
    });
}

criterion_group!(benches, bench_diff);
criterion_main!(benches);
