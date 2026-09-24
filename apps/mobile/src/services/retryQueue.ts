/**
 * Exponential-backoff retry queue for the sync orchestrator.
 *
 * Curve (base, no jitter):
 *   attempt 1 → 1 min
 *   attempt 2 → 5 min
 *   attempt 3 → 25 min
 *   attempt 4 → 2 h 5 min
 *   attempt 5 → 10 h 25 min
 *   attempt 6 → 24 h   (capped — 5^5 × 60s = 3125m would otherwise blow past)
 *   attempt 7 → 24 h   (capped; this attempt dead-letters after firing)
 *
 * After attempt 7 fires (success or failure), the orchestrator stops
 * auto-scheduling. The user sees a "Retry now" button on Settings to
 * force a fresh attempt and reset the counter.
 *
 * Persisted to AsyncStorage so we survive app restarts — otherwise a
 * crash mid-backoff would reset attempt count to 0 and start the curve
 * over, effectively undoing the backoff protection.
 *
 * Math:
 *   base = min(60_000 * 5^(attempt-1), 24h)
 *   jitter = base * 0.2 * (random()*2 - 1)   ← ±20%
 *   delay = max(1000, base + jitter)         ← never < 1s
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@fieldedge/retry_queue';
const MAX_ATTEMPTS = 7;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

export interface PersistedRetryState {
  attempt: number;
  nextRetryAt: string | null; // ISO
  deadLetterCount: number;
  lastError: string | null;
}

const DEFAULT_STATE: PersistedRetryState = {
  attempt: 0,
  nextRetryAt: null,
  deadLetterCount: 0,
  lastError: null,
};

// ─── Pure functions (no IO, exported for unit tests) ─────────────────────

/** Compute the backoff delay (ms) for the given attempt number (1-indexed). */
export function computeBackoff(attempt: number): number {
  if (attempt < 1) return 1000;
  const base = Math.min(60_000 * Math.pow(5, attempt - 1), MAX_BACKOFF_MS);
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(1000, base + jitter);
}

/** Attempts ≥ this number should NOT auto-schedule the next retry — dead-letter instead. */
export function shouldDeadLetter(attempt: number): boolean {
  return attempt >= MAX_ATTEMPTS;
}

// ─── Module-level state (lazy-loaded from AsyncStorage) ───────────────────

let _state: PersistedRetryState = { ...DEFAULT_STATE };
let _hydrated = false;
let _hydrationPromise: Promise<void> | null = null;

async function hydrate(): Promise<void> {
  if (_hydrated) return;
  if (_hydrationPromise) return _hydrationPromise;
  _hydrationPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedRetryState>;
        _state = { ...DEFAULT_STATE, ...parsed };
      }
    } catch (_) {
      // Corrupt JSON or storage error — fall back to defaults.
      _state = { ...DEFAULT_STATE };
    } finally {
      _hydrated = true;
    }
  })();
  return _hydrationPromise;
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch (_) {
    // Best-effort — in-memory state still reflects the change for this run.
  }
}

/** Record a sync failure. Returns the delay (ms) until the next auto-retry, or null if dead-lettered. */
export async function recordFailure(error: string): Promise<number | null> {
  await hydrate();
  _state.attempt = Math.min(_state.attempt + 1, MAX_ATTEMPTS);
  _state.lastError = error;
  if (shouldDeadLetter(_state.attempt)) {
    _state.deadLetterCount += 1;
    _state.nextRetryAt = null;
    await persist();
    return null;
  }
  const delayMs = computeBackoff(_state.attempt);
  _state.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
  await persist();
  return delayMs;
}

/** Record a successful sync — clears the attempt counter + next-retry slot. */
export async function recordSuccess(): Promise<void> {
  await hydrate();
  _state.attempt = 0;
  _state.nextRetryAt = null;
  _state.lastError = null;
  await persist();
}

/** Read-only snapshot of the current state (for the Settings UI). */
export function getSnapshot(): PersistedRetryState {
  return { ..._state };
}

/** Next retry timestamp as a Date, or null if dead-lettered / idle. */
export function getNextRetryAt(): Date | null {
  if (!_state.nextRetryAt) return null;
  const ms = Date.parse(_state.nextRetryAt);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

/** Force the attempt counter back to 0 (used by the "Retry now" button). */
export async function reset(): Promise<void> {
  await hydrate();
  _state = { ...DEFAULT_STATE };
  await persist();
}

/** Wait for hydration to complete on first launch. */
export async function ready(): Promise<void> {
  await hydrate();
}

export const RETRY_QUEUE_MAX_ATTEMPTS = MAX_ATTEMPTS;
