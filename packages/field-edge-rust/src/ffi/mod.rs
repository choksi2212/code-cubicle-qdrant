//! FFI exports — exposed via UniFFI to Swift/Kotlin and via JSI to RN
//!
//! This is the C-ABI surface. The UniFFI UDL declares higher-level types,
//! but raw JSON-string entry points are exposed for the JSI bridge to avoid
//! type marshaling complexity on the hot path.

pub mod exports;

pub use exports::*;
