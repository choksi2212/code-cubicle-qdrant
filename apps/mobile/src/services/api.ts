/**
 * HTTP client for the FieldEdge sync API.
 */

const SYNC_API_URL = process.env.SYNC_API_URL ?? 'http://localhost:8000';

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

export interface PullResponse {
  server_time: string;
  points: Array<{
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
  }>;
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

  setToken(token: string) {
    this.token = token;
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  async uploadBatch(req: {
    device_id: string;
    batch_id: string;
    points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>;
  }): Promise<UploadResponse> {
    const resp = await fetch(`${SYNC_API_URL}/sync/upload`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(req),
    });
    if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
    return resp.json();
  }

  async pullUpdates(params: { since?: string; device_id: string; limit?: number }): Promise<PullResponse> {
    const url = new URL(`${SYNC_API_URL}/sync/pull`);
    if (params.since) url.searchParams.set('since', params.since);
    url.searchParams.set('device_id', params.device_id);
    url.searchParams.set('limit', String(params.limit ?? 100));

    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: this.headers(),
    });
    if (!resp.ok) throw new Error(`Pull failed: ${resp.status}`);
    return resp.json();
  }

  async heartbeat(): Promise<HeartbeatResponse> {
    const resp = await fetch(`${SYNC_API_URL}/sync/heartbeat`);
    if (!resp.ok) throw new Error(`Heartbeat failed: ${resp.status}`);
    return resp.json();
  }
}

export const apiClient = new ApiClient();
