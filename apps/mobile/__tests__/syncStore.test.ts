/**
 * Tests for the sync store.
 *
 * Covers the retry-aware additions: `retryCount` increments on
 * failure, `deadLetterCount` transitions at attempt 7, and
 * `recordSyncSuccess` clears the backoff state.
 */

const memStore: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: jest.fn(async (k: string) =>
      Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null,
    ),
    setItem: jest.fn(async (k: string, v: string) => {
      memStore[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete memStore[k];
    }),
    clear: jest.fn(async () => {
      for (const k of Object.keys(memStore)) delete memStore[k];
    }),
  };
  return { __esModule: true, default: api, ...api };
});

// Stub the runSync orchestrator via jest.mock — no out-of-scope refs.
jest.mock('../src/services/sync', () => ({
  runSync: jest.fn(),
}));

import { useSyncStore } from '../src/stores/syncStore';
import { runSync as runSyncMock } from '../src/services/sync';
import { reset as queueReset } from '../src/services/retryQueue';

beforeEach(async () => {
  for (const k of Object.keys(memStore)) delete memStore[k];
  await queueReset();
  (runSyncMock as jest.Mock).mockReset();
  useSyncStore.setState({
    status: 'idle',
    lastReport: null,
    pendingCount: 0,
    lastError: null,
    retryCount: 0,
    nextRetryAt: null,
    deadLetterCount: 0,
    lastRunAt: null,
  });
});

describe('syncStore', () => {
  it('starts with retryCount=0 and deadLetterCount=0', () => {
    const s = useSyncStore.getState();
    expect(s.retryCount).toBe(0);
    expect(s.deadLetterCount).toBe(0);
    expect(s.nextRetryAt).toBeNull();
  });

  it('recordSyncFailure increments retryCount + records error', async () => {
    const delay = await useSyncStore.getState().recordSyncFailure('boom');
    expect(delay).not.toBeNull();
    const s = useSyncStore.getState();
    expect(s.retryCount).toBe(1);
    expect(s.lastError).toBe('boom');
    expect(s.nextRetryAt).not.toBeNull();
  });

  it('recordSyncSuccess clears retryCount, nextRetryAt, lastError', async () => {
    await useSyncStore.getState().recordSyncFailure('e1');
    await useSyncStore.getState().recordSyncFailure('e2');
    expect(useSyncStore.getState().retryCount).toBe(2);

    await useSyncStore.getState().recordSyncSuccess();
    const s = useSyncStore.getState();
    expect(s.retryCount).toBe(0);
    expect(s.lastError).toBeNull();
    expect(s.nextRetryAt).toBeNull();
    expect(s.lastRunAt).not.toBeNull();
  });

  it('dead-letters at attempt 7 (retryCount stops at 7, deadLetterCount=1)', async () => {
    for (let i = 0; i < 6; i++) {
      const r = await useSyncStore.getState().recordSyncFailure('e');
      expect(r).not.toBeNull();
    }
    expect(useSyncStore.getState().retryCount).toBe(6);
    expect(useSyncStore.getState().deadLetterCount).toBe(0);

    const seventh = await useSyncStore.getState().recordSyncFailure('final');
    expect(seventh).toBeNull();
    const s = useSyncStore.getState();
    expect(s.retryCount).toBe(7);
    expect(s.deadLetterCount).toBe(1);
    expect(s.nextRetryAt).toBeNull();
  });

  it('triggerSync routes through recordSyncSuccess on success', async () => {
    (runSyncMock as jest.Mock).mockResolvedValueOnce({
      startedAt: new Date(),
      finishedAt: new Date(),
      uploaded: 0,
      downloaded: 0,
      conflicts: 0,
      resolved: 0,
      errors: 0,
      bytesUploaded: 0,
      bytesDownloaded: 0,
    });
    await useSyncStore.getState().triggerSync();
    const s = useSyncStore.getState();
    expect(s.status).toBe('complete');
    expect(s.lastError).toBeNull();
    expect(s.retryCount).toBe(0);
  });

  it('triggerSync routes through recordSyncFailure on throw', async () => {
    (runSyncMock as jest.Mock).mockRejectedValueOnce(new Error('net down'));
    await expect(useSyncStore.getState().triggerSync()).rejects.toThrow('net down');
    const s = useSyncStore.getState();
    expect(s.status).toBe('error');
    expect(s.lastError).toBe('Error: net down');
    expect(s.retryCount).toBe(1);
    expect(s.nextRetryAt).not.toBeNull();
  });

  it('resetRetry clears attempt counter', async () => {
    await useSyncStore.getState().recordSyncFailure('x');
    await useSyncStore.getState().recordSyncFailure('y');
    expect(useSyncStore.getState().retryCount).toBe(2);
    await useSyncStore.getState().resetRetry();
    const s = useSyncStore.getState();
    expect(s.retryCount).toBe(0);
    expect(s.nextRetryAt).toBeNull();
    expect(s.lastError).toBeNull();
  });
});
