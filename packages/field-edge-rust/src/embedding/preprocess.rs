//! Image preprocessing utilities for CLIP
//!
//! CLIP expects 224×224 RGB normalized with mean/std.

/// CLIP normalization constants
pub const CLIP_MEAN: [f32; 3] = [0.48145466, 0.4578275, 0.40821073];
pub const CLIP_STD: [f32; 3] = [0.26862954, 0.26130258, 0.27577711];
pub const CLIP_INPUT_SIZE: usize = 224;

/// Normalize a single pixel (RGB, 0-255) to CLIP space
pub fn normalize_pixel(r: u8, g: u8, b: u8) -> [f32; 3] {
    [
        (r as f32 / 255.0 - CLIP_MEAN[0]) / CLIP_STD[0],
        (g as f32 / 255.0 - CLIP_MEAN[1]) / CLIP_STD[1],
        (b as f32 / 255.0 - CLIP_MEAN[2]) / CLIP_STD[2],
    ]
}

/// Tokenize text using CLIP's BPE (stub — full impl in clip-tokenizers crate)
pub fn tokenize_for_clip(text: &str, max_len: usize) -> Vec<i64> {
    // Stub: real impl uses BPE tokenizer
    // For now, just produce a fixed-length sequence of small ints
    let bytes = text.as_bytes();
    let mut tokens: Vec<i64> = bytes.iter().take(max_len).map(|&b| b as i64).collect();
    tokens.resize(max_len, 0);
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_pixel_basic() {
        let n = normalize_pixel(128, 128, 128);
        assert!(n.iter().all(|&v| v.is_finite()));
    }

    #[test]
    fn tokenize_handles_empty() {
        let t = tokenize_for_clip("", 5);
        assert_eq!(t.len(), 5);
        assert!(t.iter().all(|&v| v == 0));
    }

    #[test]
    fn tokenize_respects_max_len() {
        let t = tokenize_for_clip("hello world this is a test", 5);
        assert_eq!(t.len(), 5);
    }
}
