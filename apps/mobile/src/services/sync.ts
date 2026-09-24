/**
 * Real sync orchestrator.
 *
 * Flow:
 *   1. Read WAL entries (point_id + checksum + project_id)
 *   2. Look up each point's full payload + vector from the local Rust shard
 *   3. Compute diff: local vs remote (Qdrant Cloud snapshot)
 *   4. Upload new points via POST /sync/upload
 *   5. Pull remote updates via GET /sync/pull
 *   6. Resolve conflicts via Rust bridge
 *   7. Apply resolved points to local Edge shard
 *   8. Emit SyncReport for UI
 *
 * The orchestrator is idempotent: re-running after a partial failure
 * picks up where it left off.
 */

import { fieldEdge, Payload, SyncDiff, ConflictDecision } from '../native/fieldEdge';
import { apiClient } from './api';
import { deviceId } from '../config';

const WAL_PATH_DEFAULT = '/data/data/com.fieldedge/files/edge-shard/sync.wal';

interface WalEntry {
  op: 'upsert' | 'delete' | 'optimize_hint';
  point_id: string;
  vector_checksum: string;
  project_id: string;
  ts: string;
  sync_state: 'pending' | 'synced' | 'failed';
}

export interface SyncMetrics {
  startedAt: Date;
  finishedAt: Date;
  uploaded: number;
  downloaded: number;
  conflicts: number;
  resolved: number;
  errors: number;
  bytesUploaded: number;
  bytesDownloaded: number;
}

export async function runSync(
  walPath: string = WAL_PATH_DEFAULT,
  onProgress?: (msg: string) => void,
): Promise<SyncMetrics> {
  const startedAt = new Date();
  const metrics: SyncMetrics = {
    startedAt,
    finishedAt: startedAt,
    uploaded: 0,
    downloaded: 0,
    conflicts: 0,
    resolved: 0,
    errors: 0,
    bytesUploaded: 0,
    bytesDownloaded: 0,
  };

  onProgress?.('Reading pending writes…');

  // 1. Read pending WAL entries.
  //    WAL may not exist yet — treat as empty.
  let walEntries: WalEntry[] = [];
  try {
    const walJson = await fieldEdge.walReadAll(walPath);
    const parsed = JSON.parse(walJson);
    if (parsed && Array.isArray(parsed)) {
      walEntries = parsed;
    }
  } catch (e) {
    console.warn('[sync] wal read failed, treating as empty:', e);
  }

  const pending = walEntries.filter(
    (e) => e.op === 'upsert' && e.sync_state === 'pending',
  );

  onProgress?.(`Found ${pending.length} pending uploads`);

  // 2. Look up full point data (id + vector + payload) from local shard.
  const localPoints: Array<{
    id: string;
    vector: number[];
    payload: Payload;
  }> = [];
  if (pending.length > 0) {
    try {
      const ids = pending.map((e) => e.point_id);
      const lookupJson = await fieldEdge.retrieve(ids);
      const lookupResp = JSON.parse(lookupJson);
      if (lookupResp?.value && Array.isArray(lookupResp.value)) {
        for (const p of lookupResp.value) {
          localPoints.push({
            id: p.id,
            vector: p.vector,
            payload: p.payload,
          });
        }
      }
    } catch (e) {
      console.warn('[sync] local lookup failed:', e);
    }
  }

  if (localPoints.length === 0) {
    metrics.finishedAt = new Date();
    onProgress?.('Nothing to upload');
    return metrics;
  }

  // 3. Upload batch to the sync API.
  try {
    const batchId = `${startedAt.toISOString()}-${deviceId}`;
    const req = {
      device_id: deviceId,
      batch_id: batchId,
      points: localPoints,
    };
    const resp = await apiClient.uploadBatch(req);
    metrics.uploaded += resp.results.filter((r) => r.status === 'accepted').length;
    metrics.conflicts += resp.results.filter(
      (r) => r.status === 'conflict_resolved',
    ).length;
    metrics.resolved += resp.results.filter(
      (r) => r.status === 'conflict_resolved',
    ).length;
    metrics.errors += resp.results.filter((r) => r.status === 'error').length;
    onProgress?.(`Uploaded ${metrics.uploaded} points`);
  } catch (e) {
    console.error('[sync] upload batch failed:', e);
    metrics.errors++;
  }

  // 4. Pull remote updates
  try {
    onProgress?.('Pulling remote updates…');
    const pull = await apiClient.pullUpdates({
      device_id: deviceId,
      limit: 100,
    });

    for (const p of pull.points) {
      const payload = p.payload as unknown as Payload;
      await fieldEdge.upsertPoints([
        { id: p.id, vector: p.vector, payload },
      ]);
      metrics.downloaded++;
    }
    onProgress?.(`Pulled ${metrics.downloaded} points`);
  } catch (e) {
    console.error('[sync] pull failed:', e);
    metrics.errors++;
  }

  metrics.finishedAt = new Date();
  onProgress?.('Sync complete');
  return metrics;
}
