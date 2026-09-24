//! Point payload schema — matches FR-031 in PRD

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Payload schema version. Bump when adding/removing fields.
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

/// GPS status enum (matches PRD)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GpsStatus {
    Ok,
    Unavailable,
    Denied,
}

/// Embedding status enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbeddingStatus {
    Ok,
    Pending,
    Failed,
}

/// An enrichment object-detection result
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EnrichmentObject {
    pub label: String,
    /// Box as [x_min, y_min, x_max, y_max] in pixels
    pub box_: Vec<f32>,
    pub confidence: f32,
}

/// The point payload — every vector has one of these attached.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Payload {
    pub schema_version: u32,
    pub photo_id: String,
    pub device_id: String,
    pub captured_at: String, // ISO-8601 UTC
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub gps_status: GpsStatus,
    pub project_id: String,
    pub file_path: String,
    pub embedding_status: EmbeddingStatus,
    pub enrichment_id: Option<String>,
    pub enrichment_tags: Vec<String>,
    pub enrichment_objects: Vec<EnrichmentObject>,
    pub enrichment_text: Option<String>,
    pub synced_at: Option<String>,
    pub local_updated_at: String,
    pub vector_checksum: String,
}

impl Payload {
    pub fn current_version(&self) -> u32 {
        self.schema_version
    }

    /// Merge another payload into this one, with field-level rules:
    /// - server-owned fields always take from `other`
    /// - first-write-wins fields: error if they differ
    /// - last-write-wins fields: take from `other` if its local_updated_at is newer
    pub fn merge(&self, other: &Payload) -> Payload {
        let mut merged = self.clone();

        // Server-owned fields always overwrite
        merged.enrichment_id = other.enrichment_id.clone();
        merged.enrichment_tags = other.enrichment_tags.clone();
        merged.enrichment_objects = other.enrichment_objects.clone();
        merged.enrichment_text = other.enrichment_text.clone();
        merged.synced_at = other.synced_at.clone();

        // Last-write-wins on local_updated_at
        merged.local_updated_at = if other.local_updated_at > self.local_updated_at {
            other.local_updated_at.clone()
        } else {
            self.local_updated_at.clone()
        };

        // Take whichever has newer local_updated_at for project_id
        if other.local_updated_at > self.local_updated_at {
            merged.project_id = other.project_id.clone();
        }

        merged
    }
}

/// Generic JSON value type for free-form fields in API requests
pub type JsonValue = serde_json::Value;

/// Helper to convert a payload to JSON for transmission
pub fn payload_to_json(payload: &Payload) -> Result<JsonValue, serde_json::Error> {
    serde_json::to_value(payload)
}

/// Helper to parse a payload from JSON
pub fn payload_from_json(value: &JsonValue) -> Result<Payload, serde_json::Error> {
    serde_json::from_value(value.clone())
}

/// Generic field container for storing free-form metadata alongside a vector
pub type FieldMap = BTreeMap<String, JsonValue>;
