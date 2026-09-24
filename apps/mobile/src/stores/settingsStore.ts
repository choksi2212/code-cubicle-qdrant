/**
 * Settings store — zustand-backed user preferences.
 *
 * Persisted to AsyncStorage via `zustand/middleware`'s `persist` so
 * settings survive app restarts. Hydration is async; consumers that need
 * the initial value before paint should read from AsyncStorage directly
 * or show a loading state.
 *
 * Fields:
 *   - serverUrl    — sync API base URL (overridable for local dev)
 *   - photoCap     — per-device photo cap (0 = unlimited)
 *   - hasOnboarded — gates the OnboardingScreen on first launch
 *   - syncInterval — Manual / 15m / 1h / 6h — drives the background-sync scheduler
 *
 * Persisted schema version: 3
 *   - v1 → v2: dropped the original syncInterval placeholder
 *   - v2 → v3: reintroduced syncInterval now that WorkManager is wired up;
 *               default 'manual' so the migration is a no-op (existing
 *               v2 users keep their previously-baked-in 'manual' default).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { SYNC_API_URL } from '../config';

export type SyncInterval = 'manual' | '15m' | '1h' | '6h';

interface SettingsState {
  serverUrl: string;
  photoCap: number;
  hasOnboarded: boolean;
  syncInterval: SyncInterval;
  setServerUrl: (url: string) => void;
  setPhotoCap: (n: number) => void;
  markOnboarded: () => void;
  setSyncInterval: (interval: SyncInterval) => void;
  reset: () => void;
}

const STORAGE_KEY = '@fieldedge/settings';

const defaults: Pick<SettingsState, 'serverUrl' | 'photoCap' | 'hasOnboarded' | 'syncInterval'> = {
  serverUrl: SYNC_API_URL,
  photoCap: 5000,
  hasOnboarded: false,
  syncInterval: 'manual',
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      setServerUrl: (url) => set({ serverUrl: url }),
      setPhotoCap: (n) =>
        set({ photoCap: Math.max(0, Math.floor(n)) }),
      markOnboarded: () => set({ hasOnboarded: true }),
      setSyncInterval: (interval) => set({ syncInterval: interval }),
      reset: () => set({ ...defaults, hasOnboarded: false }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      version: 3,
      migrate: (persisted: any, version: number) => {
        // v1 → v2: dropped syncInterval (was a UI placeholder; will be
        // reintroduced by the background-sync feature once WorkManager
        // is wired up).
        if (version < 2 && persisted && 'syncInterval' in persisted) {
          delete persisted.syncInterval;
        }
        // v2 → v3: reintroduce syncInterval (default 'manual'). Existing
        // users land on 'manual' so the migration is effectively a no-op
        // for them.
        if (version < 3) {
          persisted.syncInterval = persisted.syncInterval ?? 'manual';
        }
        return persisted as SettingsState;
      },
    },
  ),
);
