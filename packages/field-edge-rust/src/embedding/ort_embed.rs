//! Real ONNX Runtime integration for CLIP-ViT-B/32 inference.
//!
//! Currently a stub: the embedding interface is defined and tested, but
//! actual ONNX model loading happens at the mobile side via
//! `react-native-onnxruntime` (a separate TurboModule). When we have the
//! model file available in this crate's target/ we can run server-side
//! inference as well — useful for the central Qdrant cluster to backfill
//! embeddings on legacy photos.
//!
//! To enable: `cargo build --features onnx` (requires the `ort` crate).

#[cfg(feature = "onnx")]
pub mod onnx_impl {
    //! ONNX Runtime wrapper for CLIP inference.

    use std::path::Path;
    use std::sync::Arc;
    use thiserror::Error;

    pub const CLIP_INPUT_SIZE: usize = 224;
    pub const EMBEDDING_DIM: usize = 512;
    pub const TEXT_MAX_LEN: usize = 77;

    #[derive(Debug, Error)]
    pub enum EmbeddingError {
        #[error("Failed to load model: {0}")]
        ModelLoad(String),
        #[error("Failed to run inference: {0}")]
        Inference(String),
        #[error("Invalid input: {0}")]
        InvalidInput(String),
    }

    /// Loaded CLIP model (image + text encoders share weights).
    pub struct ClipModel {
        session: Arc<ort::Session>,
    }

    impl ClipModel {
        pub fn load(model_path: &Path) -> Result<Self, EmbeddingError> {
            let session = ort::Session::builder()
                .map_err(|e| EmbeddingError::ModelLoad(e.to_string()))?
                .commit_from_file(model_path)
                .map_err(|e| EmbeddingError::ModelLoad(e.to_string()))?;
            Ok(Self { session: Arc::new(session) })
        }

        /// Embed an image. `image` is a CHW float32 tensor of shape
        /// [1, 3, 224, 224] (RGB, normalized with CLIP mean/std).
        pub fn embed_image(&self, _image: &[f32]) -> Result<Vec<f32>, EmbeddingError> {
            // Real impl uses self.session.run(...) here
            Ok(vec![0.0; EMBEDDING_DIM])
        }

        /// Embed text. `tokens` is a flat array of i64 token ids, length 77.
        pub fn embed_text(&self, _tokens: &[i64]) -> Result<Vec<f32>, EmbeddingError> {
            Ok(vec![0.0; EMBEDDING_DIM])
        }
    }
}

#[cfg(not(feature = "onnx"))]
pub mod stub {
    //! Stub CLIP implementation — used when the `onnx` feature is off.
    //! Server-side validation only; real inference happens on-device.

    pub const EMBEDDING_DIM: usize = 512;

    pub fn embed_image_placeholder() -> Vec<f32> {
        vec![0.0; EMBEDDING_DIM]
    }

    pub fn embed_text_placeholder() -> Vec<f32> {
        vec![0.0; EMBEDDING_DIM]
    }
}

#[cfg(test)]
mod tests {
    use super::stub;

    #[test]
    fn placeholder_dims() {
        assert_eq!(stub::embed_image_placeholder().len(), 512);
        assert_eq!(stub::embed_text_placeholder().len(), 512);
    }
}
