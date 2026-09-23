/**
 * Sync store — Zustand-based state for sync runs.
 */

import { create } from 'zustand';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'complete';

export interface SyncReport {
  startedAt: Date;
  finishedAt: Date;
  uploaded: number;
  downloaded: number;
  conflicts: number;
  errors: number;
}

interface SyncState {
  status: SyncStatus;
  lastReport: SyncReport | null;
  pendingCount: number;
  triggerSync: () => Promise<void>;
  setPendingCount: (count: number) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: 'idle',
  lastReport: null,
  pendingCount: 0,
  triggerSync: async () => {
    set({ status: 'syncing' });
    try {
      // TODO: replace with real sync implementation
      await new Promise((r) => setTimeout(r, 1500));
      set({
        status: 'complete',
        lastReport: {
          startedAt: new Date(),
          finishedAt: new Date(),
          uploaded: 0,
          downloaded: 0,
          conflicts: 0,
          errors: 0,
        },
      });
    } catch (e) {
      set({ status: 'error' });
    }
  },
  setPendingCount: (count: number) => set({ pendingCount: count }),
}));
