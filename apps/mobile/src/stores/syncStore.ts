/**
 * Sync store — Zustand-based state for sync runs.
 *
 * Wraps the real `runSync` orchestrator. The UI's `App.tsx` consumes
 * `status` for the button label and disabled state; `triggerSync` is the
 * canonical entry point. The retry queue (`retryQueue.ts`) records
 * failure attempts with exponential backoff; the sync-scheduler
 * (`syncScheduler.ts`) wires WorkManager + an in-app `setInterval`
 * that both call `triggerSync()`.
 *
 * Fields added by the background-sync feature:
 *   - retryCount      : current attempt number (1..7) since last success
 *   - nextRetryAt     : when the auto-retry will fire (or null if dead-lettered)
 *   - deadLetterCount : how many times we've hit attempt 7 since install
 *   - lastError       : most recent sync error message
 */

import { create } from 'zustand';
import { runSync, SyncMetrics } from '../services/sync';
import {
  recordFailure as queueRecordFailure,
  recordSuccess as queueRecordSuccess,
  reset as queueReset,
  getNextRetryAt,
  getSnapshot as queueSnapshot,
} from '../services/retryQueue';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'complete';

export type { SyncMetrics as SyncReport };

interface SyncState {
  status: SyncStatus;
  lastReport: SyncMetrics | null;
  pendingCount: number;
  lastError: string | null;
  // Background-sync additions
  retryCount: number;
  nextRetryAt: Date | null;
  deadLetterCount: number;
  lastRunAt: Date | null;
  // Actions
  triggerSync: () => Promise<SyncMetrics>;
  setPendingCount: (count: number) => void;
  recordSyncSuccess: () => Promise<void>;
  recordSyncFailure: (err: string) => Promise<number | null>;
  resetRetry: () => Promise<void>;
  syncRetryStateFromQueue: () => void;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  status: 'idle',
  lastReport: null,
  pendingCount: 0,
  lastError: null,
  retryCount: 0,
  nextRetryAt: null,
  deadLetterCount: 0,
  lastRunAt: null,

  triggerSync: async () => {
    set({ status: 'syncing', lastError: null });
    try {
      const report = await runSync(undefined, (msg) => console.log('[sync]', msg));
      const finishedAt = report.finishedAt ?? new Date();
      await get().recordSyncSuccess();
      set({ status: 'complete', lastReport: report, lastError: null });
      return report;
    } catch (e) {
      const msg = String(e);
      await get().recordSyncFailure(msg);
      set({ status: 'error', lastError: msg });
      throw e;
    }
  },

  setPendingCount: (count: number) => set({ pendingCount: count }),

  recordSyncSuccess: async () => {
    await queueRecordSuccess();
    set({
      retryCount: 0,
      nextRetryAt: null,
      lastError: null,
      lastRunAt: new Date(),
    });
  },

  recordSyncFailure: async (err: string) => {
    const delayMs = await queueRecordFailure(err);
    set((s) => ({
      retryCount: s.retryCount + 1,
      nextRetryAt: delayMs == null ? null : new Date(Date.now() + delayMs),
      lastError: err,
      lastRunAt: new Date(),
    }));
    if (delayMs == null) {
      // dead-lettered — bump the counter
      const snap = queueSnapshot();
      set({ deadLetterCount: snap.deadLetterCount });
      return null;
    }
    return delayMs;
  },

  resetRetry: async () => {
    await queueReset();
    set({
      retryCount: 0,
      nextRetryAt: null,
      lastError: null,
    });
  },

  syncRetryStateFromQueue: () => {
    const snap = queueSnapshot();
    set({
      retryCount: snap.attempt,
      nextRetryAt: getNextRetryAt(),
      deadLetterCount: snap.deadLetterCount,
      lastError: snap.lastError,
    });
  },
}));
