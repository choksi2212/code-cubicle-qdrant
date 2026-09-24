//! Local storage encryption layer.
//!
//! On rooted Android devices the app's `/data/data/<pkg>/files/` directory
//! is world-readable to anyone with shell access. Photos stored there carry
//! GPS, timestamps, and (sometimes) identifiable people — a serious GDPR /
//! enterprise leak surface. We counter this with AES-256-GCM using a key
//! that lives in the Android Keystore (and is therefore non-exportable
//! outside the Secure Hardware on devices with StrongBox).
//!
//! Module map:
//! * [`encryption`] — the [`Cipher`] trait + [`AesGcmCipher`] impl
//!   + [`KeyHandle`] enum describing the key's provenance.
//! * [`keyring`] — [`KeyRing`], the per-device facade that derives a
//!   32-byte subkey via HKDF-SHA256 and hands it to the cipher.
//!
//! See `docs/09-ENCRYPTION.md` for the full architecture, threat model,
//! and migration story.

pub mod encryption;
pub mod keyring;

pub use encryption::{AesGcmCipher, AesGcmError, Cipher, KeyHandle};
pub use keyring::KeyRing;
