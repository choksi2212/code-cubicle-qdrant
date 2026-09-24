/**
 * Tests for the exponential-backoff retry queue.
 *
 * Covers the pure backoff curve, the dead-letter threshold, the
 * `recordFailure` / `recordSuccess` persistence contract, and
 * `getNextRetryAt`.
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

import {
  computeBackoff,
  shouldDeadLetter,
  recordFailure,
  recordSuccess,
  getSnapshot,
  getNextRetryAt,
  reset,
  RETRY_QUEUE_MAX_ATTEMPTS,
} from '../src/services/retryQueue';

const ONE_MIN = 60_000;
const ONE_HOUR = 60 * ONE_MIN;
const ONE_DAY = 24 * ONE_HOUR;

beforeEach(async () => {
  // Drain AsyncStorage so each test starts at attempt=0.
  for (const k of Object.keys(memStore)) delete memStore[k];
  await reset();
});

describe('computeBackoff', () => {
  it('produces the 60_000 × 5^(attempt-1) base curve (no jitter)', () => {
    // Seed the RNG so jitter is deterministic.
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.5); // jitter=0
    try {
      expect(computeBackoff(1)).toBe(ONE_MIN);
      expect(computeBackoff(2)).toBe(5 * ONE_MIN);
      expect(computeBackoff(3)).toBe(25 * ONE_MIN);
      expect(computeBackoff(4)).toBe(125 * ONE_MIN); // 2h 5m
      expect(computeBackoff(5)).toBe(625 * ONE_MIN); // 10h 25m
    } finally {
      spy.mockRestore();
    }
  });

  it('clamps to 24 hours at attempt 6 and beyond', () => {
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      expect(computeBackoff(6)).toBe(ONE_DAY);
      expect(computeBackoff(7)).toBe(ONE_DAY);
      expect(computeBackoff(20)).toBe(ONE_DAY);
    } finally {
      spy.mockRestore();
    }
  });

  it('returns at least 1 second even with negative jitter or attempt ≤ 0', () => {
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0); // jitter=-0.2
    try {
      // attempt 1 with -20% jitter: 60_000 * 0.8 = 48_000 → still ≥ 1000
      expect(computeBackoff(1)).toBeGreaterThanOrEqual(1000);
      // Attempt ≤ 0 clamps to 1 second.
      expect(computeBackoff(0)).toBe(1000);
      expect(computeBackoff(-3)).toBe(1000);
    } finally {
      spy.mockRestore();
    }
  });

  it('jitter stays within ±20% of base for attempts 1..5', () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const base = Math.min(60_000 * Math.pow(5, attempt - 1), ONE_DAY);
      for (let trial = 0; trial < 25; trial++) {
        const v = computeBackoff(attempt);
        const lower = base * 0.8;
        const upper = base * 1.2;
        expect(v).toBeGreaterThanOrEqual(Math.max(1000, lower - 1));
        expect(v).toBeLessThanOrEqual(upper + 1);
      }
    }
  });
});

describe('shouldDeadLetter', () => {
  it('transitions to dead-letter at attempt 7', () => {
    expect(shouldDeadLetter(7)).toBe(true);
    expect(shouldDeadLetter(8)).toBe(true);
  });
  it('does NOT dead-letter for attempts 1..6', () => {
    for (let i = 1; i <= 6; i++) {
      expect(shouldDeadLetter(i)).toBe(false);
    }
  });
});

describe('recordFailure / recordSuccess', () => {
  it('increments attempt counter on each failure and schedules next retry', async () => {
    const delay = await recordFailure('boom');
    expect(delay).not.toBeNull();
    expect(typeof delay).toBe('number');
    expect(getSnapshot().attempt).toBe(1);
    expect(getSnapshot().lastError).toBe('boom');
    expect(getNextRetryAt()).not.toBeNull();
  });

  it('resets attempt counter on success', async () => {
    await recordFailure('a');
    await recordFailure('b');
    expect(getSnapshot().attempt).toBe(2);
    await recordSuccess();
    expect(getSnapshot().attempt).toBe(0);
    expect(getSnapshot().lastError).toBeNull();
    expect(getNextRetryAt()).toBeNull();
  });

  it('returns null + bumps deadLetterCount after attempt 7 fires', async () => {
    for (let i = 0; i < RETRY_QUEUE_MAX_ATTEMPTS - 1; i++) {
      const r = await recordFailure('x');
      expect(r).not.toBeNull();
    }
    expect(getSnapshot().attempt).toBe(RETRY_QUEUE_MAX_ATTEMPTS - 1);
    expect(getSnapshot().deadLetterCount).toBe(0);

    const delay = await recordFailure('y');
    expect(delay).toBeNull();
    expect(getSnapshot().deadLetterCount).toBe(1);
    expect(getNextRetryAt()).toBeNull();
  });

  it('persists state across module reloads (simulated app restart)', async () => {
    await recordFailure('persist-me');
    expect(getSnapshot().attempt).toBe(1);
    expect(getSnapshot().lastError).toBe('persist-me');

    // Wipe the module registry so a subsequent `require` re-executes
    // retryQueue.ts (which re-initialises `_state` to defaults) and
    // triggers hydration from memStore on first access. memStore is
    // declared in the test file's module scope, so it survives
    // jest.resetModules() and the AsyncStorage mock re-binds to it
    // via closure.
    jest.resetModules();
    const rq = require('../src/services/retryQueue');
    await rq.ready();
    expect(rq.getSnapshot().attempt).toBe(1);
    expect(rq.getSnapshot().lastError).toBe('persist-me');
    expect(rq.getNextRetryAt()).not.toBeNull();
  });
});
