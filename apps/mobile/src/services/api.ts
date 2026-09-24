/**
 * HTTP client for the FieldEdge sync API.
 *
 * The sync API requires `Authorization: Bearer dev_<device_id>` (any
 * non-empty token ≥8 chars works in v1 — see apps/sync-api/app/auth.py).
 * The token is set once at app start via `setToken()` from the persisted
 * device ID.
 *
 * All requests have a configurable timeout via AbortController so a hung
 * server (e.g. Render cold-start) can't freeze the UI.
 *
 * Observability: every request gets a UUID `X-Request-ID` header so the
 * server can echo it back, and we emit one structured log line with the
 * response status + duration_ms via the JSON logger.
 */

import { SYNC_API_URL } from '../config';
import { logger } from '../util/logger';
import { uuidv4 } from '../util/uuid';

const DEFAULT_TIMEOUT_MS = 60_000;

export interface UploadResult {
  id: string;
  status: string;
  resolution?: string;
  resolved_payload?: unknown;
}

export interface UploadResponse {
  batch_id: string;
  server_time: string;
  results: UploadResult[];
  next_cursor: string;
}

export interface PullPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface PullResponse {
  server_time: string;
  points: PullPoint[];
  next_cursor: string;
  has_more: boolean;
}

export interface HeartbeatResponse {
  status: string;
  server_time: string;
  qdrant_reachable: boolean;
  qdrant_point_count: number;
}

class ApiClient {
  private token: string | null = null;
  private timeoutMs: number = DEFAULT_TIMEOUT_MS;

  setToken(token: string) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  setTimeoutMs(ms: number) {
    this.timeoutMs = ms;
  }

  private headers(requestId: string): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
    };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  /** fetch with an AbortController-based timeout so we never hang forever. */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number = this.timeoutMs,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Wraps a fetch call with request-id generation + structured logging.
   * Logs one line on the way out with status + duration_ms; if the server
   * echoes back an X-Request-ID header (it always does), we surface it
   * so log shippers can stitch the device trace to the server trace.
   */
  private async doFetch(
    op: string,
    url: string,
    init: RequestInit,
    timeoutMs?: number,
  ): Promise<Response> {
    const requestId = uuidv4();
    const start = Date.now();
    let status = 0;
    let responseRequestId: string | null = null;
    let error: string | undefined;
    try {
      const resp = await this.fetchWithTimeout(url, init, timeoutMs);
      status = resp.status;
      responseRequestId = resp.headers.get('X-Request-ID');
      return resp;
    } catch (e) {
      status = 0;
      error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      const durationMs = Date.now() - start;
      logger.info('http request', {
        op,
        url,
        request_id: requestId,
        server_request_id: responseRequestId,
        status,
        duration_ms: durationMs,
        ...(error ? { error } : {}),
      });
    }
  }

  async uploadBatch(req: {
    device_id: string;
    batch_id: string;
    points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>;
  }): Promise<UploadResponse> {
    const resp = await this.doFetch(
      'sync.upload',
      `${SYNC_API_URL}/sync/upload`,
      {
        method: 'POST',
        headers: this.headers(uuidv4()),
        body: JSON.stringify(req),
      },
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Upload failed: ${resp.status} ${body.slice(0, 200)}`);
    }
    return resp.json();
  }

  async pullUpdates(params: {
    since?: string;
    device_id: string;
    limit?: number;
  }): Promise<PullResponse> {
    // React Native ships a minimal WHATWG URL impl that doesn't implement
    // URLSearchParams.set on Android. Build the query string by hand.
    const qs: string[] = [];
    if (params.since) qs.push(`since=${encodeURIComponent(params.since)}`);
    qs.push(`device_id=${encodeURIComponent(params.device_id)}`);
    qs.push(`limit=${encodeURIComponent(String(params.limit ?? 100))}`);
    const url = `${SYNC_API_URL}/sync/pull?${qs.join('&')}`;

    const resp = await this.doFetch(
      'sync.pull',
      url,
      {
        method: 'GET',
        headers: this.headers(uuidv4()),
      },
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Pull failed: ${resp.status} ${body.slice(0, 200)}`);
    }
    return resp.json();
  }

  async heartbeat(): Promise<HeartbeatResponse> {
    const resp = await this.doFetch(
      'sync.heartbeat',
      `${SYNC_API_URL}/sync/heartbeat`,
      {
        method: 'GET',
        headers: this.headers(uuidv4()),
      },
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Heartbeat failed: ${resp.status} ${body.slice(0, 200)}`);
    }
    return resp.json();
  }

  /**
   * FR-080 — replay a previously-uploaded batch after a crash or network
   * drop. The server upserts idempotently by point ID, so re-sending a
   * batch it already has just returns 'accepted' for each point.
   */
  async walReplay(req: {
    device_id: string;
    batch_id: string;
    points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>;
  }): Promise<UploadResponse> {
    const resp = await this.doFetch(
      'sync.wal_replay',
      `${SYNC_API_URL}/sync/wal/replay`,
      {
        method: 'POST',
        headers: this.headers(uuidv4()),
        body: JSON.stringify({ ...req, replay: true }),
      },
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`WAL replay failed: ${resp.status} ${body.slice(0, 200)}`);
    }
    return resp.json();
  }
}

export const apiClient = new ApiClient();
