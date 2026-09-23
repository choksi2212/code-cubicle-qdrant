//! Vector checksum computation

use sha2::{Digest, Sha256};

/// Compute SHA-256 of a vector's bytes, returned as `"sha256:<hex>"`
pub fn vector_checksum(vector: &[f32]) -> String {
    let bytes: Vec<u8> = vector
        .iter()
        .flat_map(|f| f.to_le_bytes())
        .collect();
    let digest = Sha256::digest(&bytes);
    format!("sha256:{}", hex::encode(digest))
}

/// Compute SHA-256 of arbitrary bytes
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("sha256:{}", hex::encode(digest))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checksum_deterministic() {
        let v1 = vec![0.1, 0.2, 0.3];
        let v2 = vec![0.1, 0.2, 0.3];
        assert_eq!(vector_checksum(&v1), vector_checksum(&v2));
    }

    #[test]
    fn checksum_differs() {
        let v1 = vec![0.1, 0.2, 0.3];
        let v2 = vec![0.1, 0.2, 0.4];
        assert_ne!(vector_checksum(&v1), vector_checksum(&v2));
    }
}
