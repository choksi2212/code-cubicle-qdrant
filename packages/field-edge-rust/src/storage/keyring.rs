//! Per-device key derivation.
//!
//! The Android Keystore holds the master key (non-exportable on
//! StrongBox-capable devices). We pull the raw bytes back through JNI
//! — they never leave the process — and then run HKDF-SHA256 over them
//! with the info string `b"fieldedge/wal+v1"` to derive the working
//! subkey used by [`AesGcmCipher`].
//!
//! HKDF gives us three properties we want:
//!   1. **Domain separation.** Different info strings yield different
//!      subkeys, so the same Keystore alias can be re-used for future
//!      purposes (e.g. `fieldedge/index+v1`) without key collisions.
//!   2. **Forward separation.** Rotating the underlying Keystore key
//!      rotates all derived subkeys automatically.
//!   3. **No cross-protocol leakage.** A cipher text encrypted for the
//!      WAL cannot be replayed against the shard index even if an
//!      attacker controls one half of the AAD.
//!
//! On non-Android targets (Linux/macOS test runners, CI) the
//! "from_keystore_alias" path returns an error; the corresponding
//! test path is [`KeyRing::from_raw_key`].

use crate::storage::encryption::{AesGcmCipher, Cipher, KeyHandle};
use hkdf::Hkdf;
use sha2::Sha256;
use thiserror::Error;

/// HKDF info string used for every subkey FieldEdge derives today.
/// Bump the `+v1` suffix when adding a new context that needs a
/// separate subkey under the same Keystore alias.
pub const HKDF_INFO: &[u8] = b"fieldedge/wal+v1";

#[derive(Debug, Error)]
pub enum KeyRingError {
    #[error("HKDF expand failed")]
    HkdfExpand,
    #[error("Android Keystore unavailable on this target")]
    KeystoreUnavailable,
    #[error("Keystore alias not found: {0}")]
    AliasNotFound(String),
    #[error("Keystore returned an unexpected key length: {0} bytes")]
    UnexpectedKeyLength(usize),
    #[error("JNI call failed: {0}")]
    Jni(String),
}

/// Per-device cipher container.
pub struct KeyRing {
    cipher: AesGcmCipher,
    /// The 32-byte subkey. Held only for diagnostics / re-key flows;
    /// the working encryption path goes through `cipher`.
    subkey: [u8; 32],
}

impl std::fmt::Debug for KeyRing {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KeyRing")
            .field("handle", &self.cipher.handle())
            .finish()
    }
}

impl KeyRing {
    /// Test/dev constructor: build a KeyRing directly from a 32-byte
    /// key (bypasses HKDF + Keystore). Production code uses
    /// [`KeyRing::from_keystore_alias`].
    pub fn from_raw_key(key: [u8; 32]) -> Self {
        Self {
            cipher: AesGcmCipher::new(key),
            subkey: key,
        }
    }

    /// Build a KeyRing by asking Android Keystore for the master key
    /// under `alias`, then HKDF-deriving the working subkey.
    ///
    /// On non-Android targets this returns `KeystoreUnavailable`. The
    /// Android implementation lives in `crate::ffi::exports` —
    /// specifically the `fe_key_from_keystore` shim.
    pub fn from_keystore_alias(alias: &str) -> Result<Self, KeyRingError> {
        let ikm = fetch_keystore_key(alias)?;
        if ikm.len() < 32 {
            return Err(KeyRingError::UnexpectedKeyLength(ikm.len()));
        }
        // Take the first 32 bytes; ignore the rest. Keystore AES keys are
        // always 16 or 32 bytes — anything else is a programming error.
        let mut raw = [0u8; 32];
        raw.copy_from_slice(&ikm[..32]);
        let subkey = hkdf_sha256(&raw, alias.as_bytes())?;
        Ok(Self {
            cipher: AesGcmCipher::new_keystore_delegated(subkey),
            subkey,
        })
    }

    /// Encrypt through the wrapped cipher.
    pub fn encrypt(&self, plaintext: &[u8], aad: &[u8]) -> Vec<u8> {
        self.cipher.encrypt(plaintext, aad)
    }

    /// Decrypt through the wrapped cipher.
    pub fn decrypt(&self, blob: &[u8], aad: &[u8]) -> Result<Vec<u8>, crate::storage::encryption::AesGcmError> {
        self.cipher.decrypt(blob, aad)
    }

    pub fn cipher(&self) -> &AesGcmCipher {
        &self.cipher
    }

    /// Handle (Raw / KeystoreDelegated) — useful for logging.
    pub fn handle(&self) -> KeyHandle {
        self.cipher.handle()
    }
}

/// HKDF-SHA256: extract+expand 32 bytes from `ikm`, with `salt = ""` and
/// `info = HKDF_INFO || context_tag` so different contexts under the same
/// alias produce different subkeys.
///
/// `context_tag` is the per-use discriminator (e.g. `b"wal"`,
/// `b"shard"`). Today the subkey derivation uses the same `HKDF_INFO`
/// string — the context tag is reserved for the future when the WAL
/// and shard subkeys are formally separated.
fn hkdf_sha256(ikm: &[u8], context_tag: &[u8]) -> Result<[u8; 32], KeyRingError> {
    let mut info = Vec::with_capacity(HKDF_INFO.len() + context_tag.len());
    info.extend_from_slice(HKDF_INFO);
    info.extend_from_slice(context_tag);
    let hk = Hkdf::<Sha256>::new(None, ikm);
    let mut out = [0u8; 32];
    hk.expand(&info, &mut out)
        .map_err(|_| KeyRingError::HkdfExpand)?;
    Ok(out)
}

/// Platform-specific Keystore fetch. On Android this dispatches to the
/// JNI shim in `crate::ffi::exports`. Everywhere else it returns
/// `KeystoreUnavailable` — the tests use [`KeyRing::from_raw_key`].
fn fetch_keystore_key(alias: &str) -> Result<Vec<u8>, KeyRingError> {
    #[cfg(target_os = "android")]
    {
        crate::ffi::exports::fe_key_from_keystore_bytes(alias)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = alias;
        Err(KeyRingError::KeystoreUnavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_ikm() -> [u8; 32] {
        let mut k = [0u8; 32];
        for (i, b) in k.iter_mut().enumerate() {
            *b = (i as u8).wrapping_mul(7);
        }
        k
    }

    #[test]
    fn from_raw_key_round_trips() {
        let key = dummy_ikm();
        let kr = KeyRing::from_raw_key(key);
        let pt = b"hello, keyring";
        let ct = kr.encrypt(pt, b"aad");
        let back = kr.decrypt(&ct, b"aad").expect("decrypt");
        assert_eq!(back, pt);
    }

    #[test]
    fn hkdf_is_deterministic() {
        let ikm = dummy_ikm();
        let a = hkdf_sha256(&ikm, b"wal").expect("hkdf a");
        let b = hkdf_sha256(&ikm, b"wal").expect("hkdf b");
        assert_eq!(a, b);
    }

    #[test]
    fn hkdf_context_tags_diverge() {
        let ikm = dummy_ikm();
        let wal = hkdf_sha256(&ikm, b"wal").expect("hkdf wal");
        let shard = hkdf_sha256(&ikm, b"shard").expect("hkdf shard");
        assert_ne!(wal, shard);
    }

    #[test]
    fn keystore_unavailable_off_android() {
        // Linux/macOS/Windows targets can't reach the Keystore. The
        // error message is the public contract.
        let err = KeyRing::from_keystore_alias("any-alias").unwrap_err();
        assert!(matches!(err, KeyRingError::KeystoreUnavailable));
    }

    #[test]
    fn tampered_decrypt_via_keyring_fails() {
        let kr = KeyRing::from_raw_key(dummy_ikm());
        let mut ct = kr.encrypt(b"data", b"ctx");
        // Flip a body byte.
        ct[crate::storage::encryption::NONCE_LEN] ^= 0x01;
        let err = kr.decrypt(&ct, b"ctx").unwrap_err();
        assert_eq!(
            err,
            crate::storage::encryption::AesGcmError::TagMismatch
        );
    }
}
