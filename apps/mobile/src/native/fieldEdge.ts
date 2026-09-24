/**
 * TypeScript wrapper around the Rust bridge native module.
 *
 * Exposes a domain-friendly API instead of raw Qdrant Edge calls.
 */

import { NativeModules } from 'react-native';

interface NativeBridge {
  openShard(config: { directory: string }): Promise<{ status: 'ok' | 'err'; value?: unknown; code?: string; message?: string }>;
  upsertPoints(points: PointInput[]): Promise<{ status: 'ok' | 'err'; value?: { upserted: number }; code?: string; message?: string }>;
  query(request: QueryRequest): Promise<{ status: 'ok' | 'err'; value?: QueryHit[]; code?: string; message?: string }>;
  retrieve(ids: string[]): Promise<{ status: 'ok' | 'err'; value?: PointInput[]; code?: string; message?: string }>;
  deletePoints(ids: string[]): Promise<{ status: 'ok' | 'err'; value?: { deleted: number }; code?: string; message?: string }>;
  pointCount(): Promise<number>;
  computeSyncDiff(localJson: string, remoteJson: string): Promise<{ status: 'ok' | 'err'; value?: SyncDiff; code?: string; message?: string }>;
  resolveConflict(localJson: string, remoteJson: string): Promise<{ status: 'ok' | 'err'; value?: ConflictDecision; code?: string; message?: string }>;
  walAppend(walPath: string, entryJson: string): Promise<{ status: 'ok' | 'err'; value?: { seq: number }; code?: string; message?: string }>;
  walReadAll(walPath: string): Promise<{ status: 'ok' | 'err'; value?: WalEntry[]; code?: string; message?: string }>;
  walClear(walPath: string): Promise<{ status: 'ok' | 'err'; value?: { cleared: boolean; removed_bytes: number }; code?: string; message?: string }>;
  version(): Promise<{ status: string; value?: { crate: string; version: string; rust_version: string; features: Record<string, boolean> } }>;
  checksum(vector: number[]): Promise<{ status: string; value?: { checksum: string } }>;
  log(level: string, msg: string, kv: Record<string, unknown>): Promise<boolean>;
}

const LINKING_ERROR =
  `Native module 'FieldEdgeRust' is not linked. ` +
  `Make sure you have run 'pnpm build:native' and rebuilt the app.`;

const native: NativeBridge = (NativeModules as any).FieldEdgeRust
  ? (NativeModules as any).FieldEdgeRust
  : new Proxy({} as NativeBridge, {
      get() {
        throw new Error(LINKING_ERROR);
      },
    });

// ─── Public types ────────────────────────────────────────────────────────────

export interface PointInput {
  id: string;
  vector: number[];
  payload: Payload;
}

export interface Payload {
  schema_version: number;
  photo_id: string;
  device_id: string;
  captured_at: string; // ISO-8601
  lat: number | null;
  lng: number | null;
  gps_status: 'ok' | 'unavailable' | 'denied';
  project_id: string;
  file_path: string;
  embedding_status: 'ok' | 'pending' | 'failed';
  enrichment_id: string | null;
  enrichment_tags: string[];
  enrichment_objects: Array<{ label: string; box: number[]; confidence: number }>;
  enrichment_text: string | null;
  synced_at: string | null;
  local_updated_at: string;
  vector_checksum: string;
  // v2-only fields — see docs/05-SCHEMA-VERSIONS.md
  deletion_marker: boolean;
  project_owner: string | null;
  tags_v2: string[];
}

/**
 * Detect a payload's schema version. Treats a missing `schema_version` as
 * legacy v1 (the original wire format pre-dates the discriminator).
 */
export function detectSchemaVersion(input: any): 1 | 2 {
  const raw = input?.schema_version;
  if (raw === 2 || raw === '2') return 2;
  return 1;
}

/**
 * Upgrade any payload (v1 or v2) to the current schema (v2). v1 inputs get
 * the migration defaults:
 *
 * - `deletion_marker` → false
 * - `project_owner` → null
 * - `tags_v2` → copy of `enrichment_tags`
 *
 * v2 inputs pass through (with any missing v2 fields defaulted). Mutates
 * and returns the input object for in-place upgrades.
 */
export function migratePayload(input: any): Payload {
  if (input == null || typeof input !== 'object') {
    throw new Error('migratePayload: input must be an object');
  }
  const version = detectSchemaVersion(input);
  if (version === 2) {
    // Already current — make sure all v2 fields are present so the result
    // satisfies the strict Payload shape.
    return {
      deletion_marker: !!input.deletion_marker,
      project_owner: input.project_owner ?? null,
      tags_v2: Array.isArray(input.tags_v2) ? input.tags_v2 : [],
      ...input,
    } as Payload;
  }

  // v1 → v2: synthesize defaults for the new fields.
  input.schema_version = 2;
  input.deletion_marker = false;
  input.project_owner = null;
  input.tags_v2 = Array.isArray(input.enrichment_tags) ? [...input.enrichment_tags] : [];
  return input as Payload;
}

export interface QueryRequest {
  vector: number[];
  limit: number;
  filter?: FilterExpression;
  with_payload?: boolean;
  with_vector?: boolean;
}

export type FilterExpression =
  | { type: 'match'; key: string; value: string | number | boolean | null }
  | { type: 'range'; key: string; gte?: number; lte?: number }
  | { type: 'and'; children: FilterExpression[] }
  | { type: 'or'; children: FilterExpression[] }
  | { type: 'not'; child: FilterExpression };

export interface QueryHit {
  id: string;
  score: number;
  payload: Payload;
}

export interface SyncDiff {
  to_upload: string[];
  to_download: string[];
  conflicts: string[];
}

export interface ConflictDecision {
  winner: 'local' | 'remote' | 'merged';
  resolved_payload: Payload;
  fields_changed: string[];
}

export interface WalEntry {
  op: 'upsert' | 'delete' | 'optimize_hint';
  seq: number;
  point: PointInput | null;
  point_id: string | null;
  ts: string;
  sync_state: 'pending' | 'synced' | 'failed';
}

// ─── Client ──────────────────────────────────────────────────────────────────

class FieldEdgeClient {
  private directory: string = '';

  async openShard(config: { directory: string }): Promise<{ status: string }> {
    this.directory = config.directory;
    return native.openShard(config);
  }

  async upsertPoints(points: PointInput[]): Promise<{ upserted: number }> {
    const resp = await native.upsertPoints(points);
    if (resp.status === 'err') throw new Error(`${resp.code}: ${resp.message}`);
    return resp.value ?? { upserted: 0 };
  }

  async query(request: QueryRequest): Promise<QueryHit[]> {
    const resp = await native.query(request);
    if (resp.status === 'err') throw new Error(`${resp.code}: ${resp.message}`);
    return resp.value ?? [];
  }

  async retrieve(ids: string[]): Promise<PointInput[]> {
    const resp = await native.retrieve(ids);
    if (resp.status === 'err') throw new Error(`${resp.code}: ${resp.message}`);
    return resp.value ?? [];
  }

  async deletePoints(ids: string[]): Promise<{ deleted: number }> {
    const resp = await native.deletePoints(ids);
    if (resp.status === 'err') throw new Error(`${resp.code}: ${resp.message}`);
    return resp.value ?? { deleted: 0 };
  }

  async pointCount(): Promise<number> {
    return native.pointCount();
  }

  async computeSyncDiff(localJson: string, remoteJson: string): Promise<SyncDiff> {
    const resp = await native.computeSyncDiff(localJson, remoteJson);
    if (resp.status === 'err') throw new Error(`${resp.code}: ${resp.message}`);
    return resp.value ?? { to_upload: [], to_download: [], conflicts: [] };
  }

  async resolveConflict(
    local: Payload,
    remote: Payload,
  ): Promise<ConflictDecision> {
    const resp = await native.resolveConflict(JSON.stringify(local), JSON.stringify(remote));
    if (resp.status === 'err') throw new Error(`${resp.code}: ${resp.message}`);
    return resp.value!;
  }

  async walAppend(walPath: string, entryJson: string): Promise<{ seq: number }> {
    const resp = await native.walAppend(walPath, entryJson);
    if (resp.status === 'err') throw new Error(`${resp.code}: ${resp.message}`);
    return resp.value ?? { seq: 0 };
  }

  async walReadAll(walPath: string): Promise<WalEntry[]> {
    const resp = await native.walReadAll(walPath);
    if (resp.status === 'err') throw new Error(`${resp.code}: ${resp.message}`);
    return resp.value ?? [];
  }

  async walClear(walPath: string): Promise<{ cleared: boolean; removed_bytes: number }> {
    const resp = await native.walClear(walPath);
    if (resp.status === 'err') throw new Error(`${resp.code}: ${resp.message}`);
    return resp.value ?? { cleared: false, removed_bytes: 0 };
  }

  async version(): Promise<{ status: string; value?: { crate: string; version: string; rust_version: string; features: Record<string, boolean> } }> {
    return native.version();
  }

  async checksum(vector: number[]): Promise<{ status: string; value?: { checksum: string } }> {
    return native.checksum(vector);
  }

  /**
   * Forward one structured log line through the bridge. The Kotlin side
   * (`FieldEdgeRustModule.kt::log`) routes it into Android logcat under
   * tag "field_edge" so operators can read it with
   * `adb logcat | grep field_edge`.
   *
   * Best-effort: if the bridge isn't available (e.g. running under Jest
   * with no native module shim) we silently swallow the rejection —
   * logging must never crash the app or break a test.
   */
  async log(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', msg: string, kv: Record<string, unknown> = {}): Promise<void> {
    try {
      await native.log(level, msg, kv);
    } catch {
      // see doc above
    }
  }
}

export const fieldEdge = new FieldEdgeClient();
export { FieldEdgeClient };
