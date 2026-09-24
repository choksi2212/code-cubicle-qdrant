/**
 * Tests for tokenStore and the api-client 401-refresh-retry logic.
 *
 * Covers:
 *   - tokenStore round-trips through the SecureStore native module.
 *   - tokenStore falls back to the in-memory shim when the native module
 *     is absent (jest test env).
 *   - apiClient on 401: invokes the registered refresh handler, retries
 *     the request once with the new bearer, and surfaces AuthExpiredError
 *     when refresh also 401s.
 *   - Two concurrent 401s share one refresh call (coalescing).
 */

import { apiClient, AuthExpiredError } from '../src/services/api';
import { getTokens, setTokens, clearTokens } from '../src/services/tokenStore';

// api.ts transitively imports `../config` which pulls in `react-native-fs` —
// jest can't parse the TS source for that package, so we stub it out here.
// Same trick photo-cap.test.ts uses.
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    DocumentDirectoryPath: '/tmp/docs',
    mkdir: jest.fn(async () => undefined),
    copyFile: jest.fn(async () => undefined),
  },
}));

// ── tokenStore ──────────────────────────────────────────────────────────────


describe('tokenStore', () => {
  beforeEach(async () => {
    await clearTokens();
  });

  it('round-trips a token pair through the native module', async () => {
    const { NativeModules } = require('react-native');
    const memMap: Record<string, string> = {};
    NativeModules.SecureStore = {
      setItem: jest.fn(async (k: string, v: string) => {
        memMap[k] = v;
      }),
      getItem: jest.fn(async (k: string) => memMap[k] ?? null),
      removeItem: jest.fn(async (k: string) => {
        delete memMap[k];
      }),
    };

    // Re-import so it picks up the new native module instance.
    jest.resetModules();
    const fresh = require('../src/services/tokenStore');
    await fresh.setTokens({ access: 'access-A', refresh: 'refresh-A' });

    const got = await fresh.getTokens();
    expect(got).toEqual({ access: 'access-A', refresh: 'refresh-A' });

    await fresh.clearTokens();
    const cleared = await fresh.getTokens();
    expect(cleared).toBeNull();
  });

  it('falls back to in-memory storage when the native module is missing', async () => {
    const { NativeModules } = require('react-native');
    delete NativeModules.SecureStore;

    jest.resetModules();
    const fresh = require('../src/services/tokenStore');
    await fresh.setTokens({ access: 'x', refresh: 'y' });
    const got = await fresh.getTokens();
    expect(got).toEqual({ access: 'x', refresh: 'y' });
  });
});

// ── apiClient 401-refresh-retry ─────────────────────────────────────────────


type Handler = () => Promise<string | null>;

function setFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  (global as any).fetch = jest.fn(impl);
}

function fakeResponse(status: number, body: unknown = {}): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (_: string) => null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  apiClient.setToken('');
  apiClient.setRefreshHandler(async () => null);
});

describe('apiClient 401-refresh-retry', () => {
  it('passes through 200 without invoking the refresh handler', async () => {
    setFetch(async () => fakeResponse(200, { status: 'ok' }));
    const refresh = jest.fn(async () => 'new-token');
    apiClient.setRefreshHandler(refresh);

    const resp = await apiClient.heartbeat();
    expect(resp.status).toBe('ok');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('on 401: calls refresh handler, retries with new bearer, returns 200', async () => {
    let calls = 0;
    setFetch(async (_url, init) => {
      calls += 1;
      if (calls === 1) {
        // First call: stale token → 401
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          'Bearer stale',
        );
        return fakeResponse(401, { detail: 'Token expired' });
      }
      // Second call (retry): must carry the new bearer
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        'Bearer fresh',
      );
      return fakeResponse(200, { status: 'ok' });
    });

    apiClient.setToken('stale');
    apiClient.setRefreshHandler(async () => {
      apiClient.setToken('fresh');
      return 'fresh';
    });

    const resp = await apiClient.heartbeat();
    expect(resp.status).toBe('ok');
    expect(calls).toBe(2);
  });

  it('on 401 when refresh returns null: throws AuthExpiredError', async () => {
    setFetch(async () => fakeResponse(401, { detail: 'expired' }));
    apiClient.setToken('stale');
    apiClient.setRefreshHandler(async () => null);

    await expect(apiClient.heartbeat()).rejects.toBeInstanceOf(AuthExpiredError);
  });

  it('on 401 when refresh returns a token but retry still 401s: throws AuthExpiredError', async () => {
    setFetch(async () => fakeResponse(401, { detail: 'still bad' }));
    apiClient.setToken('stale');
    apiClient.setRefreshHandler(async () => 'fresh');

    await expect(apiClient.heartbeat()).rejects.toBeInstanceOf(AuthExpiredError);
  });

  it('coalesces concurrent 401s into one refresh call', async () => {
    let refreshCalls = 0;
    let respCalls = 0;
    setFetch(async () => {
      respCalls += 1;
      if (respCalls <= 3) return fakeResponse(401, {});
      // After the refresh, every subsequent request gets 200.
      return fakeResponse(200, { status: 'ok' });
    });
    apiClient.setToken('stale');
    apiClient.setRefreshHandler(async () => {
      refreshCalls += 1;
      // Tiny delay so other requests stack up behind us.
      await new Promise((r) => setTimeout(r, 10));
      apiClient.setToken('fresh');
      return 'fresh';
    });

    // Fire three requests concurrently — all should hit the same refresh.
    await Promise.all([
      apiClient.heartbeat(),
      apiClient.heartbeat(),
      apiClient.heartbeat(),
    ]);
    expect(refreshCalls).toBe(1);
  });
});
