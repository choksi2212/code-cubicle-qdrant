//! Encryption throughput microbenchmarks.
//!
//! Run with:
//! ```text
//! cargo bench --bench encryption_bench
//! ```
//!
//! Compares AES-256-GCM encrypt/decrypt against the equivalent plaintext
//! `fs::write` / `fs::read` baseline. Performance budgets documented in
//! `docs/09-ENCRYPTION.md`:
//!   * 4 KB payload  encrypt + decrypt  < 50 µs
//!   * 2 KB payload  encrypt + decrypt  < 25 µs
//!
//! These targets are very loose — modern AES-NI on x86 does AES-GCM at
//! ~5 GB/s, so 4 KB takes roughly 0.8 µs. The bench exists primarily as
//! a regression catcher: if a future change accidentally routes through
//! a slow path (e.g. SHA-256 instead of AES-NI), we'll see it here.

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use field_edge_rust::storage::encryption::{AesGcmCipher, Cipher, KEY_LEN};
use std::io::Write;

fn bench_key() -> [u8; KEY_LEN] {
    let mut k = [0u8; KEY_LEN];
    for (i, b) in k.iter_mut().enumerate() {
        *b = i as u8;
    }
    k
}

fn bench_payload(size: usize) -> Vec<u8> {
    // Deterministic, non-zero payload so benchmarks are reproducible
    // across runs and so the AES-NI path is exercised (all-zero payloads
    // are sometimes optimised away by crypto backends).
    (0..size).map(|i| (i % 251) as u8).collect()
}

fn bench_encrypt(c: &mut Criterion) {
    let cipher = AesGcmCipher::new(bench_key());
    let aad = b"fieldedge/wal/v1";
    let mut group = c.benchmark_group("encryption");
    for size in [2048usize, 4096usize, 16384usize] {
        let payload = bench_payload(size);
        group.throughput(Throughput::Bytes(payload.len() as u64));
        group.bench_with_input(BenchmarkId::new("aes_gcm_encrypt", size), &payload, |b, p| {
            b.iter(|| cipher.encrypt(p, aad))
        });
        group.bench_with_input(BenchmarkId::new("aes_gcm_decrypt", size), &payload, |b, p| {
            let ct = cipher.encrypt(p, aad);
            b.iter(|| cipher.decrypt(&ct, aad))
        });
        // Combined encrypt + decrypt for the headline number.
        group.bench_with_input(BenchmarkId::new("aes_gcm_roundtrip", size), &payload, |b, p| {
            b.iter(|| {
                let ct = cipher.encrypt(p, aad);
                cipher.decrypt(&ct, aad).unwrap()
            })
        });
    }
    group.finish();
}

fn bench_plaintext_baseline(c: &mut Criterion) {
    // Reference: `fs::write` + `fs::read` of the same payload. This is
    // what the encrypted path replaces; if our numbers are anywhere
    // near this baseline we're well under budget.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("baseline.bin");
    let mut group = c.benchmark_group("plaintext_baseline");
    for size in [2048usize, 4096usize, 16384usize] {
        let payload = bench_payload(size);
        group.throughput(Throughput::Bytes(payload.len() as u64));
        group.bench_with_input(BenchmarkId::new("fs_write_read", size), &payload, |b, p| {
            b.iter(|| {
                let mut f = std::fs::File::create(&path).unwrap();
                f.write_all(p).unwrap();
                drop(f);
                std::fs::read(&path).unwrap()
            })
        });
    }
    group.finish();
}

criterion_group!(benches, bench_encrypt, bench_plaintext_baseline);
criterion_main!(benches);
