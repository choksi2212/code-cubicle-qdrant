/**
 * Sync store — Zustand-based state for sync runs.
 *
 * Wraps the real `runSync` orchestrator. The UI's `App.tsx` consumes
 * `status` for the button label and disabled state; `triggerSync` is the
 * canonical entry point.
 */

import { create } from 'zustand';
import { runSync, SyncMetrics } from '../services/sync';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'complete';

export type { SyncMetrics as SyncReport };

interface SyncState {
  status: SyncStatus;
  lastReport: SyncMetrics | null;
  pendingCount: number;
  lastError: string | null;
  triggerSync: () => Promise<SyncMetrics>;
  setPendingCount: (count: number) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: 'idle',
  lastReport: null,
  pendingCount: 0,
  lastError: null,
  triggerSync: async () => {
    set({ status: 'syncing', lastError: null });
    try {
      const report = await runSync(undefined, (msg) => console.log('[sync]', msg));
      set({ status: 'complete', lastReport: report, lastError: null });
      return report;
    } catch (e) {
      const msg = String(e);
      set({ status: 'error', lastError: msg });
      throw e;
    }
  },
  setPendingCount: (count: number) => set({ pendingCount: count }),
}));
