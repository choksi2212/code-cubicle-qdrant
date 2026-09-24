/**
 * Conflict audit client — `GET /sync/conflicts/:photo_id`.
 *
 * Returns the full audit record for a single photo's last conflict
 * resolution: the local + remote payloads as they stood at resolution
 * time, the winner, the fields that changed, and the resolution
 * timestamp. Used by ConflictDetailScreen to render a side-by-side
 * comparison.
 *
 * Throws on non-2xx so the screen can render an error state.
 */

import { SYNC_API_URL } from '../config';
import { uuidv4 } from '../util/uuid';
import { logger } from '../util/logger';

export interface ConflictPayload {
  photo_id?: string;
  device_id?: string;
  captured_at?: string;
  project_id?: string;
  enrichment_text?: string | null;
  enrichment_tags?: string[];
  tags_v2?: string[];
  local_updated_at?: string;
  vector_checksum?: string;
  // Allow any other PointPayload field through for forward compat.
  [k: string]: unknown;
}

export interface ConflictDetail {
  photo_id: string;
  local: ConflictPayload | null;
  remote: ConflictPayload;
  winner: 'local' | 'remote' | 'merged';
  fields_changed: string[];
  resolved_at: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchConflictDetail(
  photoId: string,
): Promise<ConflictDetail> {
  const url = `${SYNC_API_URL}/sync/conflicts/${encodeURIComponent(photoId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const requestId = uuidv4();
  const start = Date.now();
  let status = 0;
  let responseRequestId: string | null = null;
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Request-ID': requestId,
      },
      signal: controller.signal,
    });
    status = resp.status;
    responseRequestId = resp.headers.get('X-Request-ID');
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(
        `Conflict fetch failed: ${resp.status} ${body.slice(0, 200)}`,
      );
    }
    return (await resp.json()) as ConflictDetail;
  } finally {
    clearTimeout(timer);
    logger.info('http request', {
      op: 'sync.conflict_detail',
      url,
      request_id: requestId,
      server_request_id: responseRequestId,
      status,
      duration_ms: Date.now() - start,
    });
  }
}
