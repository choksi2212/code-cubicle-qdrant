/**
 * Tests for the foreground sync scheduler.
 *
 * Validates the in-app `setInterval` behaviour: starts/stops the timer
 * when startSync/stopSync are called, fires `triggerSync()` at the
 * configured interval, and routes through the native module's
 * scheduleSync/cancelSync when present.
 *
 * Strategy: stub the global `setInterval`/`clearInterval` and the
 * `NativeModules.SyncScheduler` module so we can assert call counts
 * without depending on real timers or RN's bridge.
 */

// All jest.mock factories are self-contained — no out-of-scope refs.
// The mocks write into a per-factory `__mock` bag that we re-import via
// `jest.requireMock` below (TypeScript-friendly, no out-of-scope refs).
jest.mock('react-native', () => {
  const mockSchedule = jest.fn(async () => ({ scheduled: true }));
  const mockCancel = jest.fn(async () => ({ scheduled: false }));
  const mockRunOnce = jest.fn(async () => ({ enqueued: true, enqueuedAt: 0 }));
  const mockGetStatus = jest.fn(async () => ({
    scheduled: false,
    intervalMinutes: 0,
    requiresWifi: true,
    requiresCharging: false,
    lastRunAt: null,
  }));
  const mockAddListener = jest.fn();
  const bag = {
    scheduleSync: mockSchedule,
    cancelSync: mockCancel,
    runOnce: mockRunOnce,
    getStatus: mockGetStatus,
    addListener: mockAddListener,
  };
  return {
    __esModule: true,
    NativeModules: {
      SyncScheduler: {
        scheduleSync: mockSchedule,
        cancelSync: mockCancel,
        runOnce: mockRunOnce,
        getStatus: mockGetStatus,
      },
    },
    NativeEventEmitter: jest.fn().mockImplementation(() => ({
      addListener: mockAddListener,
    })),
    Platform: { OS: 'android', select: (o: any) => o?.android ?? o?.default ?? null },
    __mock: bag,
  };
});

jest.mock('../src/stores/syncStore', () => {
  const triggerSync = jest.fn(async () => ({
    startedAt: new Date(),
    finishedAt: new Date(),
    uploaded: 0,
    downloaded: 0,
    conflicts: 0,
    resolved: 0,
    errors: 0,
    bytesUploaded: 0,
    bytesDownloaded: 0,
  }));
  return {
    __esModule: true,
    useSyncStore: {
      getState: () => ({ triggerSync }),
    },
    __mock: { triggerSync },
  };
});

const mockModule = jest.requireMock('react-native').__mock as {
  scheduleSync: jest.Mock;
  cancelSync: jest.Mock;
  runOnce: jest.Mock;
  getStatus: jest.Mock;
  addListener: jest.Mock;
};
const syncStoreMock = jest.requireMock('../src/stores/syncStore').__mock as {
  triggerSync: jest.Mock;
};

// Track setInterval/clearInterval invocations.
const intervalHandles = new Map<number, unknown>();
let handleCounter = 0;

beforeEach(() => {
  jest.useFakeTimers();
  intervalHandles.clear();
  handleCounter = 0;
  mockModule.scheduleSync.mockClear();
  mockModule.cancelSync.mockClear();
  mockModule.runOnce.mockClear();
  mockModule.getStatus.mockClear();
  mockModule.addListener.mockClear();
  syncStoreMock.triggerSync.mockClear();

  // Replace global timer functions with tracked versions.
  jest.spyOn(global, 'setInterval').mockImplementation(((cb: unknown, _ms?: number) => {
    handleCounter += 1;
    intervalHandles.set(handleCounter, cb);
    return handleCounter as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval);
  jest
    .spyOn(global, 'clearInterval')
    .mockImplementation(((h: unknown) => {
      intervalHandles.delete(Number(h));
    }) as typeof clearInterval);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

import {
  startSync,
  stopSync,
  runOnce,
  getStatus,
  hydrateFromNative,
  _resetForTests,
  _internal,
} from '../src/services/syncScheduler';

describe('syncScheduler in-app foreground timer', () => {
  it('starts a setInterval for the given interval and stops on stopSync', async () => {
    await startSync('15m', true, false);
    expect(mockModule.scheduleSync).toHaveBeenCalledWith(15, true, false);
    expect(intervalHandles.size).toBe(1);

    await stopSync();
    expect(mockModule.cancelSync).toHaveBeenCalled();
    expect(intervalHandles.size).toBe(0);
  });

  it('does NOT start a timer when interval is manual', async () => {
    await startSync('manual', true, false);
    expect(mockModule.scheduleSync).not.toHaveBeenCalled();
    expect(mockModule.cancelSync).toHaveBeenCalled();
    expect(intervalHandles.size).toBe(0);
  });

  it('fires triggerSync every interval', async () => {
    await startSync('15m', true, false);
    expect(syncStoreMock.triggerSync).not.toHaveBeenCalled();

    const cb = Array.from(intervalHandles.values())[0] as () => Promise<void>;
    await cb();
    await cb();
    await cb();
    expect(syncStoreMock.triggerSync).toHaveBeenCalledTimes(3);
  });

  it('runOnce enqueues + calls triggerSync immediately', async () => {
    await runOnce();
    expect(mockModule.runOnce).toHaveBeenCalled();
    expect(syncStoreMock.triggerSync).toHaveBeenCalledTimes(1);
  });

  it('getStatus returns the native module status', async () => {
    mockModule.getStatus.mockResolvedValueOnce({
      scheduled: true,
      intervalMinutes: 60,
      requiresWifi: true,
      requiresCharging: false,
      lastRunAt: '2026-01-01T00:00:00Z',
    });
    const s = await getStatus();
    expect(s?.intervalMinutes).toBe(60);
    expect(s?.lastRunAt).toBe('2026-01-01T00:00:00Z');
  });

  it('hydrateFromNative restores the foreground timer from persisted schedule', async () => {
    mockModule.getStatus.mockResolvedValueOnce({
      scheduled: true,
      intervalMinutes: 360,
      requiresWifi: true,
      requiresCharging: false,
      lastRunAt: null,
    });
    let observed: string | undefined;
    await hydrateFromNative((i) => {
      observed = i;
    });
    expect(observed).toBe('6h');
    expect(intervalHandles.size).toBe(1);
  });

  it('hydrateFromNative does nothing when native reports nothing scheduled', async () => {
    mockModule.getStatus.mockResolvedValueOnce({
      scheduled: false,
      intervalMinutes: 0,
      requiresWifi: true,
      requiresCharging: false,
      lastRunAt: null,
    });
    let observed: string | undefined;
    await hydrateFromNative((i) => {
      observed = i;
    });
    expect(observed).toBeUndefined();
    expect(intervalHandles.size).toBe(0);
  });
});

describe('syncScheduler interval mapping', () => {
  it('maps "manual" to null ms', () => {
    expect(_internal.intervalToMs('manual')).toBeNull();
  });
  it('maps "15m" to 15 min in ms', () => {
    expect(_internal.intervalToMs('15m')).toBe(15 * 60_000);
  });
  it('maps "1h" to 60 min in ms', () => {
    expect(_internal.intervalToMs('1h')).toBe(60 * 60_000);
  });
  it('maps "6h" to 6 hours in ms', () => {
    expect(_internal.intervalToMs('6h')).toBe(6 * 60 * 60_000);
  });
});

afterAll(() => {
  _resetForTests();
});
