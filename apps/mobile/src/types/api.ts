// Generated from apps/sync-api/openapi.yaml — keep in sync.
//
// Hand-port of the FieldEdge sync API OpenAPI 3.1 schemas. If you change a
// shape here, change `apps/sync-api/openapi.yaml` first and then regenerate
// (or just port it by hand, which is what this file is).

// ── Enums ───────────────────────────────────────────────────────────────────

export type GpsStatus = 'ok' | 'unavailable' | 'denied';
export type EmbeddingStatus = 'ok' | 'pending' | 'failed';

export type PointResultStatus =
  | 'accepted'
  | 'accepted_with_merge'
  | 'conflict_resolved'
  | 'rejected_too_old'
  | 'rejected_invalid_payload';

export type PointResultResolution = 'local_wins' | 'remote_wins' | 'merged';

export type HeartbeatStatus = 'ok' | 'degraded';

export type HealthStatus = 'alive';

export type ReadyStatus = 'ready' | 'not_ready';

export type WalEntryOp = 'insert' | 'update' | 'delete';

// ── Core data shapes ────────────────────────────────────────────────────────

export interface PointPayload {
  schema_version?: number; // default 1
  photo_id: string;
  device_id: string;
  captured_at: string; // date-time
  lat: number | null;
  lng: number | null;
  gps_status?: GpsStatus; // default 'ok'
  project_id: string;
  file_path: string;
  embedding_status?: EmbeddingStatus; // default 'ok'
  enrichment_id: string | null;
  enrichment_tags?: string[]; // default []
  enrichment_objects?: Array<Record<string, unknown>>; // default []
  enrichment_text: string | null;
  synced_at: string | null; // date-time
  local_updated_at: string; // date-time
  vector_checksum: string;
}

export interface Point {
  id: string;
  vector: number[]; // 512 floats
  payload: PointPayload;
}

// ── Request shapes ──────────────────────────────────────────────────────────

export interface UploadRequest {
  device_id: string;
  batch_id: string;
  points: Point[]; // max 100
}

export interface PullRequest {
  // NOTE: the live server uses GET /sync/pull with query params, not this
  // JSON body. Kept here for documentation symmetry.
  device_id: string;
  since_ts: string; // date-time
}

export interface WalReplayRequest {
  device_id: string;
  batch_id: string;
  points: Point[]; // max 100
  replay?: boolean; // default true
}

// ── Response shapes ─────────────────────────────────────────────────────────

export interface PointResult {
  id: string;
  status: PointResultStatus;
  resolution: PointResultResolution | null;
  resolved_payload: Record<string, unknown> | null;
  error_message: string | null;
  server_version: number | null;
}

export interface UploadResponse {
  batch_id: string;
  server_time: string; // date-time
  results: PointResult[];
  next_cursor: string;
}

export interface PullPoint {
  // Loose shape — server returns `dict[str, Any]`. Real rows include `id`,
  // `vector` (often empty for scrolled results), and `payload`.
  id?: string;
  vector?: number[];
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PullResponse {
  server_time: string; // date-time
  points: PullPoint[];
  next_cursor: string;
  has_more: boolean;
}

// WalReplayResponse reuses UploadResponse on the server.
export type WalReplayResponse = UploadResponse;

export interface HeartbeatResponse {
  status: HeartbeatStatus;
  server_time: string; // date-time
  qdrant_reachable: boolean;
  qdrant_point_count: number | null;
}

export interface HealthResponse {
  status: HealthStatus;
}

export interface ReadyResponse {
  status: ReadyStatus;
  qdrant_collection?: string;
  qdrant_points?: number;
  qdrant_status?: string;
  error?: string;
}

// ── Error shapes ────────────────────────────────────────────────────────────

export interface ErrorResponse {
  detail?: string;
  [key: string]: unknown;
}

export interface ValidationErrorItem {
  loc: Array<string | number>;
  msg: string;
  type: string;
}

export interface HTTPValidationError {
  detail: ValidationErrorItem[];
}

// ── WAL entry (device-side shape, documented for spec completeness) ────────

export interface WalEntry {
  batch_id: string;
  device_id: string;
  point_id: string;
  op: WalEntryOp;
  vector_checksum: string;
  local_updated_at: string; // date-time
  [key: string]: unknown;
}
