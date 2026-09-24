/**
 * Real sync orchestrator.
 *
 * Flow:
 *   1. Read pending entries from the WAL (append-only log written by capture.ts)
 *   2. Look up each pending point's full vector+payload in the local Rust shard
 *   3. Upload the batch to the sync API (`POST /sync/upload`)
 *   4. Pull remote updates (`GET /sync/pull`)
 *   5. Upsert pulled points into the local shard
 *   6. Return SyncMetrics so the UI can render the report
 *
 * Notes:
 *   - The sync API authenticates with `Authorization: Bearer dev_<deviceId>`
 *     and deduplicates uploads by point ID (upsert).
 *   - All HTTP calls use AbortController timeouts so a hung server can't
 *     freeze the UI.
 *   - WAL entries stay on disk after upload; server dedup makes re-uploads
 *     cheap, and keeping them gives us a crash-recovery trail.
 */

import { fieldEdge, Payload } from '../native/fieldEdge';
import { apiClient } from './api';
import { getDeviceId, WAL_PATH } from '../config';

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

export type { SyncMetrics as SyncReport };

interface WalEntryLike {
  op: string;
  seq: number;
  point_id: string | null;
  ts: string;
  sync_state: string;
}

export async function runSync(
  _unused?: string,
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

  // Make sure we have a Bearer token set on the API client before any request.
  let deviceId: string;
  try {
    deviceId = await getDeviceId();
    if (!apiClient.getToken()) {
      apiClient.setToken(`dev_${deviceId}`);
    }
  } catch (e) {
    onProgress?.(`Failed to read device id: ${String(e)}`);
    metrics.errors++;
    metrics.finishedAt = new Date();
    return metrics;
  }

  try {
    onProgress?.('Reading WAL…');
    const walEntries = await fieldEdge.walReadAll(WAL_PATH);
    const pending = walEntries.filter(
      (e: WalEntryLike) => e.op === 'upsert' && e.sync_state === 'pending' && !!e.point_id,
    );

    onProgress?.(`WAL has ${walEntries.length} entries (${pending.length} pending upload)`);

    // 1+2. Upload pending WAL entries.
    if (pending.length > 0) {
      const pointIds = pending.map((e: WalEntryLike) => e.point_id!) as string[];
      onProgress?.(`Looking up ${pointIds.length} points in local shard…`);
      const localPoints = await fieldEdge.retrieve(pointIds);
      onProgress?.(`Retrieved ${localPoints.length} points — uploading batch…`);

      if (localPoints.length > 0) {
        try {
          const resp = await apiClient.uploadBatch({
            device_id: deviceId,
            batch_id: `${startedAt.toISOString()}-${deviceId}`,
            points: localPoints.map((p) => ({
              id: p.id,
              vector: p.vector,
              payload: p.payload as unknown as Record<string, unknown>,
            })),
          });

          let accepted = 0;
          let errored = 0;
          for (const r of resp.results) {
            if (r.status === 'accepted' || r.status === 'deduplicated') {
              accepted++;
            } else if (r.status === 'conflict_resolved') {
              accepted++;
              metrics.conflicts++;
              metrics.resolved++;
            } else {
              errored++;
            }
          }
          metrics.uploaded = accepted;
          metrics.errors += errored;

          // Bytes accounting (approximate — vector floats + JSON envelope).
          metrics.bytesUploaded = localPoints.reduce(
            (acc, p) => acc + p.vector.length * 4 + JSON.stringify(p.payload).length,
            0,
          );

          onProgress?.(`Upload done: ${accepted} accepted, ${errored} errors`);
        } catch (e) {
          onProgress?.(`Upload batch failed: ${String(e)}`);
          metrics.errors++;
        }
      } else {
        onProgress?.('No local points matched WAL pending set (shard may be empty)');
      }
    }

    // 3. Pull remote updates.
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
        metrics.bytesDownloaded += p.vector.length * 4 + JSON.stringify(p.payload).length;
      }
      onProgress?.(`Pulled ${metrics.downloaded} points from server`);
    } catch (e) {
      onProgress?.(`Pull failed: ${String(e)}`);
      metrics.errors++;
    }
  } catch (e) {
    onProgress?.(`Sync failed: ${String(e)}`);
    metrics.errors++;
  }

  metrics.finishedAt = new Date();
  onProgress?.('Sync complete');
  return metrics;
}
