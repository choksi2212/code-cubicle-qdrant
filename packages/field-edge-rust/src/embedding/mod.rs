//! Embedding layer — CLIP preprocessing + ONNX Runtime hooks.
//!
//! On the mobile side, `react-native-onnxruntime` runs CLIP inference on
//! the device (separate TurboModule). This crate provides:
//! - Image preprocessing utilities (resize, normalize)
//! - Tokenization helpers for CLIP's BPE tokenizer
//! - Server-side stub for backfilling embeddings on the central cluster

pub mod preprocess;
pub mod ort_embed;
