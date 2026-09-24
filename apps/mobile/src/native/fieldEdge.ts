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
  cloudinary_public_id: string | null;
  cloudinary_tags: string[];
  cloudinary_objects: Array<{ label: string; box: number[]; confidence: number }>;
  cloudinary_ocr_text: string | null;
  synced_at: string | null;
  local_updated_at: string;
  vector_checksum: string;
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
}

export const fieldEdge = new FieldEdgeClient();
export { FieldEdgeClient };
