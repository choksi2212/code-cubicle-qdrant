# 09. Encryption at Rest

> Status: implemented in `packages/field-edge-rust/src/storage/` (commit
> `feat(storage): AES-256-GCM encryption of WAL + shard via Android Keystore`).
> Key rotation: out of scope — see "Future work" at the end.

## Why

Field evidence — geotagged photos of sensitive sites, identifiable
species, vulnerable habitats — is the product. On a rooted Android phone
the app's `/data/data/com.fieldedge/files/` directory is one `adb pull`
away from plaintext. For an enterprise or GDPR posture that's a red
flag: GPS coordinates alone can identify individuals; species locations
can attract poachers.

The standard fix is **authenticated symmetric encryption with a key that
never leaves the Secure Hardware**. We use AES-256-GCM with a 256-bit key
bound to Android Keystore (StrongBox when available, TEE otherwise).

## Architecture

```
┌─────────────────────────┐  ┌─────────────────────────┐
│  Android Keystore       │  │  HKDF-SHA256 (Rust)     │
│  (StrongBox / TEE)      │  │  info = "fieldedge/     │
│  alias = "fieldedge-v1" │──▶  wal+v1"               │
│  key = 32 random bytes  │  │  okm  = 32 bytes        │
└─────────────────────────┘  └─────────────────────────┘
                                       │
                                       ▼
                              ┌─────────────────────┐
                              │  KeyRing            │
                              │  (cipher + handle)  │
                              └─────────────────────┘
                                       │
                ┌──────────────────────┼──────────────────────┐
                ▼                      ▼                      ▼
        ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
        │ AesGcmCipher │      │ AesGcmCipher │      │ AesGcmCipher │
        │ AAD =        │      │ AAD =        │      │ AAD =        │
        │ "wal/v1"     │      │ "shard/v1"   │      │ "ffi/v1"     │
        └──────────────┘      └──────────────┘      └──────────────┘
                │                      │                      │
                ▼                      ▼                      ▼
        ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
        │  WAL         │      │  Shard       │      │  FFI         │
        │  entries     │      │  snapshot    │      │  raw bytes   │
        └──────────────┘      └──────────────┘      └──────────────┘
```

### Components

| Layer | File | Purpose |
| --- | --- | --- |
| `Cipher` trait + `AesGcmCipher` | `src/storage/encryption.rs` | Authenticated symmetric encryption. Layout: `nonce(12) \|\| body \|\| tag(16)`. |
| `KeyRing` | `src/storage/keyring.rs` | Owns the derived subkey + cipher. `from_raw_key` (tests) and `from_keystore_alias` (Android). |
| `EncryptedWal` | `src/wal/log.rs` | AES-GCM-sealed WAL entries, magic `ENC1`. |
| `EncryptedInMemoryEdge` | `src/edge/adapter.rs` | AES-GCM-sealed shard snapshot, file `edge_snapshot.enc`. |
| FFI: `fe_key_init`, `fe_key_from_keystore`, `fe_cipher_*` | `src/ffi/exports.rs` | C-ABI surface for the JS side and tests. |
| `FieldEdgeRustModule.feKeyCreate`, `feKeyFromKeystore` | `FieldEdgeRustModule.kt` | Android Keystore bridge (StrongBox where available). |

### Key derivation

```text
Keystore AES-256  →  raw bytes (32B)  →  HKDF-SHA256(salt=∅, info="fieldedge/wal+v1")
                   ────────────────     ──────────────────────────────────────────
                   bridged by JNI       →  subkey (32B) used by AesGcmCipher
```

HKDF gives us three properties:
1. **Domain separation** — different info strings → different subkeys,
   so a future index subsystem can have its own without colliding.
2. **Forward separation** — rotating the underlying Keystore alias
   automatically rotates every derived subkey.
3. **No cross-protocol leakage** — AAD strings (`wal/v1`, `shard/v1`,
   `ffi/v1`) bind each ciphertext to its semantic context. A WAL
   ciphertext can't be replayed against the shard even if an attacker
   holds the subkey.

## Threat model

### Protected against

* **Rooted-phone file dump.** A casual `adb pull /data/data/com.fieldedge/files/`
  yields AES-GCM ciphertexts. Without the Keystore-protected key (which
  never leaves the Secure Element), they're opaque.
* **Offline backup exfiltration.** `adb backup` (when not blocked) or a
  cloud backup of `/data/data/com.fieldedge/files/` produces ciphertext
  only.
* **Cross-app read.** Other apps with `READ_EXTERNAL_STORAGE` cannot
  read app-private storage regardless, but the encryption adds a
  defense-in-depth layer.

### NOT protected against

* **Attacker with code execution on the device.** They can call
  `feKeyFromKeystore` and `fe_cipher_decrypt` directly. Encryption at
  rest is not a substitute for an OS-level sandbox compromise detector.
* **Side-channel attacks on AES-NI / ARMv8 Crypto Extensions.** We rely
  on the platform's AES-GCM implementation. Cache-timing attacks on
  AES-GCM are well-studied but require local code execution — already
  covered above.
* **Compromised Keystore.** If the Secure Element itself is broken
  (rare, e.g. side-channel on the TEE), the protection collapses.
  StrongBox reduces this surface significantly.

## Migration story

### WAL

Three format-detection rules, applied by [`WalReader::next`]:

| First 4 bytes | Treated as | Path |
| --- | --- | --- |
| `FELG` | Legacy plaintext (existing format) | `WalReader::open` decrypts nothing. |
| `FEW1` | New plaintext (used by tests) | Same. |
| `ENC1` | Encrypted | `EncryptedWalReader::open` + `AesGcmCipher::decrypt`. |
| anything else | Error | `WalError::UnknownFormat`. |

To migrate an old plaintext WAL during an upgrade:

```rust
use field_edge_rust::wal::log::EncryptedWal;
use field_edge_rust::storage::keyring::KeyRing;

let keyring = KeyRing::from_keystore_alias("fieldedge-v1")?;
let migrated = EncryptedWal::migrate_plaintext(&old_wal, &new_wal, &keyring)?;
tracing::info!("migrated {} WAL entries to encrypted format", migrated);
```

### Shard

Plaintext snapshots (`edge_snapshot.bin`) and encrypted snapshots
(`edge_snapshot.enc`) live in the same directory but never both at
once — the encrypted variant always writes to a distinct filename. To
upgrade a device with a plaintext snapshot:

1. Open with the plaintext [`InMemoryEdge`].
2. Read every `retrieve` into a `Vec<Point>`.
3. Re-upsert into a fresh [`EncryptedInMemoryEdge`] backed by the
   same directory. The encrypted snapshot replaces the plaintext one.
4. The plaintext snapshot can be removed once the new shard is
   verified.

## Performance

Measured on the bench host (Windows 11, x86-64 with AES-NI). See
`benches/encryption_bench.rs`. Run with `cargo bench --bench
encryption_bench`.

| Payload size | Operation | Per-call latency | Throughput |
| --- | --- | --- | --- |
| 2 KB | encrypt | 1.40 µs | 1.37 GiB/s |
| 2 KB | decrypt | 1.40 µs | 1.36 GiB/s |
| 4 KB | encrypt | 2.57 µs | 1.49 GiB/s |
| 4 KB | decrypt | 2.64 µs | 1.44 GiB/s |
| 16 KB | encrypt | 9.6 µs | 1.6 GiB/s |
| 16 KB | decrypt | 9.6 µs | 1.6 GiB/s |

For reference, the equivalent plaintext `fs::write` + `fs::read` on the
same host is ~660 µs for 4 KB — the AES-GCM path is roughly **250×
faster** than disk I/O, which means encryption is invisible in the hot
path. Both spec targets (`< 50 µs` for 4 KB, `< 25 µs` for 2 KB) are
met with an order of magnitude of headroom.

## Future work

### Key rotation (out of scope for v1)

The HKDF step makes rotation cheap: re-create the Keystore alias with a
fresh 32 random bytes and re-derive. Existing ciphertexts become
undecryptable, however, so a real rotation needs:

1. A **key-version header** on every encrypted blob (currently the
   magic `ENC1` implicitly assumes one key version).
2. A **re-encryption pass** that reads with the old key and re-writes
   with the new one.
3. A **fallback reader** that keeps the old subkey around until the
   re-encryption pass is complete.

Suggested bump: when adding the version header, also extend the magic
to `ENC2` so old binaries don't accidentally try to decrypt the new
format.

### Per-entry nonce de-duplication

Today each encrypt call generates a fresh 12-byte random nonce. With a
2^32 birthday bound that's 4 billion encrypts before a 50% collision
risk — plenty for a field-evidence workload. If we ever exceed that,
the standard fix is a counter-based nonce (RFC 5116 §3.2) with the
Keystore key acting as the counter master.

### `setIsStrongBoxBacked` fallback

Some low-end devices lack StrongBox. The `feKeyCreate` path already
falls back to TEE-isolated keys via the `try/catch` around
`setIsStrongBoxBacked(true)`. A future telemetry field
(`key_origin: "strongbox" | "tee" | "software"`) would help operators
gauge fleet coverage.
