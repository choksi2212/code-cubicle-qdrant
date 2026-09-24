/**
 * HTTP client for the FieldEdge sync API.
 *
 * Auth flow (see docs/08-AUTH.md):
 *   - The access token is the bearer for every `/sync/*` request.
 *   - On 401 the client calls the refresh handler (registered via
 *     `setRefreshHandler`) which mints a fresh pair via `/auth/refresh`,
 *     persists it, and returns the new access token. The original
 *     request is retried once with the new bearer.
 *   - If refresh itself 401s, the client throws `AuthExpiredError` and
 *     the UI navigates back to the LoginScreen.
 *
 * The token used to be the opaque `dev_<device_id>` string set once at
 * startup; now it's a real, server-minted JWT that the secure-store
 * module persists. The API surface (setToken / getToken) is unchanged
 * so existing call-sites don't churn.
 */

import { SYNC_API_URL } from '../config';
import { logger } from '../util/logger';
import { uuidv4 } from '../util/uuid';

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Thrown when both the original request and the refresh-then-retry
 * attempt returned 401. The caller (usually the App's global error
 * boundary) catches this and navigates back to the LoginScreen.
 */
export class AuthExpiredError extends Error {
  constructor(message: string = 'Auth expired') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}

type RefreshHandler = () => Promise<string | null>;
// The refresh handler is wired up by App.tsx at startup. It knows how
// to call /auth/refresh, persist the new pair, and return the new
// access token (or null if refresh itself failed). When the handler
// returns null the original request will not be retried — the client
// will throw AuthExpiredError and let the UI re-route to login.

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
  private refreshHandler: RefreshHandler | null = null;
  // Guard against two concurrent 401s racing each other — only one
  // /auth/refresh call should be in flight at a time. If a second
  // request 401s while we're already refreshing, it just awaits the
  // same in-flight token.
  private refreshing: Promise<string | null> | null = null;

  setToken(token: string) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  setTimeoutMs(ms: number) {
    this.timeoutMs = ms;
  }

  /**
   * Wire up the refresh handler. The App calls this once at startup
   * after hydrating tokens from EncryptedSharedPreferences:
   *
   *   apiClient.setRefreshHandler(async () => {
   *     const cur = await getTokens();
   *     if (!cur) return null;
   *     const resp = await fetch(`${SYNC_API_URL}/auth/refresh`, {
   *       method: 'POST',
   *       headers: { 'Content-Type': 'application/json' },
   *       body: JSON.stringify({ refresh_token: cur.refresh }),
   *     });
   *     if (!resp.ok) return null;
   *     const body = await resp.json();
   *     await setTokens({ access: body.access_token, refresh: body.refresh_token });
   *     return body.access_token;
   *   });
   *
   * Returning a non-null string means "this is the new bearer; please
   * retry the original request". Returning null means "refresh failed,
   * give up and surface AuthExpiredError".
   */
  setRefreshHandler(fn: RefreshHandler) {
    this.refreshHandler = fn;
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
   * Wraps a fetch call with request-id generation + structured logging
   * AND the 401-refresh-retry dance.
   *
   * The request is sent once. On 200/2xx we return immediately. On 401
   * we call the registered refresh handler, swap in the new access
   * token, and retry the request once. If the retry 401s again (or
   * the refresh handler returns null) we throw `AuthExpiredError` so
   * the UI can navigate back to the LoginScreen.
   *
   * Two concurrent 401s share one refresh call via `this.refreshing` —
   * otherwise we'd burn the daily refresh-token rate limit on
   * background tabs that all wake up at once.
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
    let attempt = 1;

    // First attempt — header may not have a token yet (e.g. before
    // hydration). The header() helper below handles that case.
    let resp = await this.fetchWithTimeout(url, init, timeoutMs);
    status = resp.status;
    responseRequestId = resp.headers.get('X-Request-ID');

    if (resp.status === 401 && this.refreshHandler) {
      const newToken = await this.coalescedRefresh();
      if (!newToken) {
        // Refresh failed — surface so the UI can log out.
        throw new AuthExpiredError('Refresh token rejected; please sign in again.');
      }
      this.token = newToken;
      attempt = 2;
      // Replay with the fresh bearer. Replace the Authorization header
      // on the existing init.headers without mutating the caller's copy.
      const retryInit: RequestInit = {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          Authorization: `Bearer ${newToken}`,
        },
      };
      resp = await this.fetchWithTimeout(url, retryInit, timeoutMs);
      status = resp.status;
      responseRequestId = resp.headers.get('X-Request-ID');
      if (resp.status === 401) {
        // Even with a brand-new token the server rejected us → bail.
        throw new AuthExpiredError('Auth still failing after refresh.');
      }
    }

    logger.info('http request', {
      op,
      url,
      request_id: requestId,
      server_request_id: responseRequestId,
      status,
      duration_ms: Date.now() - start,
      attempt,
    });
    return resp;
  }

  /**
   * Coalesce concurrent refresh calls. Multiple in-flight 401s all
   * await the same Promise so we only hit `/auth/refresh` once.
   */
  private async coalescedRefresh(): Promise<string | null> {
    if (this.refreshing) return this.refreshing;
    if (!this.refreshHandler) return null;
    this.refreshing = (async () => {
      try {
        return await this.refreshHandler!();
      } finally {
        // Always clear so the next batch can fire.
        this.refreshing = null;
      }
    })();
    return this.refreshing;
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
