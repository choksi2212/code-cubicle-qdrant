//! Authenticated symmetric encryption: AES-256-GCM.
//!
//! Output framing for `encrypt`:
//! ```text
//!   [ 12-byte nonce | ciphertext | 16-byte Poly1305 tag ]
//! ```
//!
//! `nonce || ciphertext || tag` is the canonical AES-GCM "AEAD construct"
//! layout — `aes-gcm` crate's `encrypt_in_place_detached` is exactly this
//! (the tag is appended by us for portability across readers). `decrypt`
//! parses the same layout and verifies the tag, returning
//! [`AesGcmError::TagMismatch`] on tamper.
//!
//! Per-call AAD (additional authenticated data) is used to bind ciphertexts
//! to their semantic context — WAL entries use `b"fieldedge/wal/v1"`,
//! shard payloads use `b"fieldedge/shard/v1"`. A ciphertext encrypted under
//! one context cannot be replayed into the other without re-encryption.

use aes_gcm::aead::{Aead, AeadInPlace, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use getrandom::getrandom;
use thiserror::Error;

/// 12-byte nonce used by AES-GCM (per the standard).
pub const NONCE_LEN: usize = 12;
/// 16-byte authentication tag produced by AES-GCM (Poly1305).
pub const TAG_LEN: usize = 16;
/// AES-256 key length in bytes.
pub const KEY_LEN: usize = 32;

/// Errors raised by [`AesGcmCipher`] when decrypting or framing.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum AesGcmError {
    #[error("decryption failed (authentication tag mismatch — ciphertext tampered or wrong key)")]
    TagMismatch,
    #[error("ciphertext is shorter than nonce+tag header ({} bytes minimum)", NONCE_LEN + TAG_LEN)]
    InvalidFormat,
    #[error("ciphertext contains a non-empty prefix that is neither plaintext magic nor a 12-byte nonce")]
    UnknownFormat,
}

/// Where the 32-byte key actually lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyHandle {
    /// Key bytes are in-process (tests, headless dev, CLI tooling).
    /// `Raw` keys are NEVER stored to disk in this form — they're the
    /// post-HKDF derivation result held only inside [`crate::storage::keyring::KeyRing`].
    Raw,
    /// Key bytes are obtained on demand from Android Keystore (or, on
    /// non-Android targets, a stand-in that throws). The actual key
    /// material is non-exportable on StrongBox-capable devices.
    KeystoreDelegated,
}

/// Authenticated symmetric cipher contract.
pub trait Cipher: Send + Sync {
    fn encrypt(&self, plaintext: &[u8], aad: &[u8]) -> Vec<u8>;
    fn decrypt(&self, ciphertext: &[u8], aad: &[u8]) -> Result<Vec<u8>, AesGcmError>;
}

/// AES-256-GCM cipher with a held 32-byte key.
///
/// Ciphertext layout: `nonce(12) || body(N) || tag(16)`.
///
/// Cloning is cheap because the inner [`Aes256Gcm`] state is rebuilt
/// from the held 32-byte key on demand (the AES round keys are the
/// bulk of the state and reconstructing them is sub-microsecond on
/// modern CPUs).
#[derive(Clone)]
pub struct AesGcmCipher {
    key: [u8; KEY_LEN],
    handle: KeyHandle,
}

impl AesGcmCipher {
    fn core(&self) -> Aes256Gcm {
        Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.key))
    }
}

impl std::fmt::Debug for AesGcmCipher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AesGcmCipher")
            .field("handle", &self.handle)
            .field("key_len", &self.key.len())
            .finish()
    }
}

impl AesGcmCipher {
    /// Build a cipher from raw 32-byte key material. The caller is
    /// responsible for ensuring the bytes were derived securely (HKDF
    /// from a Keystore handle, in production).
    pub fn new(key: [u8; KEY_LEN]) -> Self {
        Self {
            key,
            handle: KeyHandle::Raw,
        }
    }

    /// Build a cipher and mark its handle as KeystoreDelegated — useful
    /// for diagnostics/logging only; the bytes are unchanged.
    pub fn new_keystore_delegated(key: [u8; KEY_LEN]) -> Self {
        let mut c = Self::new(key);
        c.handle = KeyHandle::KeystoreDelegated;
        c
    }

    pub fn handle(&self) -> KeyHandle {
        self.handle
    }

    /// Trivial sanity test the AES-GCM core wires up correctly.
    /// (Used by the round-trip tests.)
    pub fn self_check(&self) -> Result<(), AesGcmError> {
        let pt = b"self-check";
        let ct = self.encrypt(pt, b"");
        let back = self.decrypt(&ct, b"")?;
        if back.as_slice() == pt {
            Ok(())
        } else {
            Err(AesGcmError::TagMismatch)
        }
    }
}

impl Cipher for AesGcmCipher {
    fn encrypt(&self, plaintext: &[u8], aad: &[u8]) -> Vec<u8> {
        // 12-byte random nonce per call, sourced from the OS CSPRNG.
        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom(&mut nonce_bytes).expect("OS CSPRNG available");
        let nonce = Nonce::from_slice(&nonce_bytes);

        let mut buf = plaintext.to_vec();
        // `encrypt_in_place_detached` takes AAD as a raw `&[u8]` — the
        // GCM tag authenticates it implicitly.
        let tag = self
            .core()
            .encrypt_in_place_detached(nonce, aad, &mut buf)
            .expect("AES-GCM encrypt_in_place_detached never fails with valid nonce/key");
        let mut out = Vec::with_capacity(NONCE_LEN + buf.len() + TAG_LEN);
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&buf);
        out.extend_from_slice(tag.as_slice());
        out
    }

    fn decrypt(&self, blob: &[u8], aad: &[u8]) -> Result<Vec<u8>, AesGcmError> {
        if blob.len() < NONCE_LEN + TAG_LEN {
            return Err(AesGcmError::InvalidFormat);
        }
        let (nonce_bytes, rest) = blob.split_at(NONCE_LEN);
        let (body, tag_bytes) = rest.split_at(rest.len() - TAG_LEN);
        if tag_bytes.len() != TAG_LEN {
            return Err(AesGcmError::InvalidFormat);
        }
        let nonce = Nonce::from_slice(nonce_bytes);
        let tag = aes_gcm::Tag::from_slice(tag_bytes);

        // Copy body into a mutable buffer for `decrypt_in_place_detached`
        // (which authenticates + decrypts in place). On tag mismatch the
        // `aead` crate returns its own error variant — we collapse to
        // `TagMismatch` because that's the only meaningful outcome here.
        let mut buf = body.to_vec();
        self.core()
            .decrypt_in_place_detached(nonce, aad, &mut buf, &tag)
            .map(|_| buf)
            .map_err(|_| AesGcmError::TagMismatch)
    }
}

// Convenience: blanket `Cipher` impl for `Arc<dyn Cipher>` doesn't
// exist by default in Rust; we add a thin newtype so callers can hold
// it via a trait object without rewriting everywhere.
impl Cipher for std::sync::Arc<dyn Cipher> {
    fn encrypt(&self, plaintext: &[u8], aad: &[u8]) -> Vec<u8> {
        (**self).encrypt(plaintext, aad)
    }
    fn decrypt(&self, blob: &[u8], aad: &[u8]) -> Result<Vec<u8>, AesGcmError> {
        (**self).decrypt(blob, aad)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key() -> [u8; KEY_LEN] {
        // Deterministic test key — never used in production.
        let mut k = [0u8; KEY_LEN];
        for (i, b) in k.iter_mut().enumerate() {
            *b = i as u8;
        }
        k
    }

    #[test]
    fn round_trip() {
        let c = AesGcmCipher::new(test_key());
        let pt = b"hello, field edge";
        let ct = c.encrypt(pt, b"aad");
        let back = c.decrypt(&ct, b"aad").expect("decrypt");
        assert_eq!(back, pt);
    }

    #[test]
    fn empty_plaintext_is_valid() {
        let c = AesGcmCipher::new(test_key());
        let ct = c.encrypt(b"", b"");
        // Just nonce + tag — 28 bytes overhead, no body.
        assert_eq!(ct.len(), NONCE_LEN + TAG_LEN);
        let back = c.decrypt(&ct, b"").expect("decrypt empty");
        assert!(back.is_empty());
    }

    #[test]
    fn nonce_uniqueness() {
        let c = AesGcmCipher::new(test_key());
        let pt = b"same plaintext";
        let ct1 = c.encrypt(pt, b"");
        let ct2 = c.encrypt(pt, b"");
        assert_ne!(ct1, ct2, "nonces must differ across calls");
    }

    #[test]
    fn tampered_ciphertext_fails_loudly() {
        let c = AesGcmCipher::new(test_key());
        let mut ct = c.encrypt(b"data", b"aad");
        // Flip one byte in the body.
        let last = ct.len() - 1;
        ct[NONCE_LEN] ^= 0x01;
        let _ = last; // keep last variable alive for clarity
        let err = c.decrypt(&ct, b"aad").unwrap_err();
        assert_eq!(err, AesGcmError::TagMismatch);
    }

    #[test]
    fn tampered_tag_fails() {
        let c = AesGcmCipher::new(test_key());
        let mut ct = c.encrypt(b"data", b"aad");
        let last = ct.len() - 1;
        ct[last] ^= 0x01;
        let err = c.decrypt(&ct, b"aad").unwrap_err();
        assert_eq!(err, AesGcmError::TagMismatch);
    }

    #[test]
    fn aad_mismatch_fails() {
        let c = AesGcmCipher::new(test_key());
        let ct = c.encrypt(b"data", b"context-A");
        // Wrong AAD on decrypt — tag will not verify.
        let err = c.decrypt(&ct, b"context-B").unwrap_err();
        assert_eq!(err, AesGcmError::TagMismatch);
    }

    #[test]
    fn truncated_ciphertext_rejected() {
        let c = AesGcmCipher::new(test_key());
        // Shorter than nonce+tag header.
        let err = c.decrypt(&[0u8; 5], b"").unwrap_err();
        assert_eq!(err, AesGcmError::InvalidFormat);
    }

    #[test]
    fn self_check_passes() {
        let c = AesGcmCipher::new(test_key());
        c.self_check().expect("self_check");
    }
}
