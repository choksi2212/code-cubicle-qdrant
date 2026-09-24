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
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { SYNC_API_URL } from '../config';

interface SettingsState {
  serverUrl: string;
  photoCap: number;
  hasOnboarded: boolean;
  setServerUrl: (url: string) => void;
  setPhotoCap: (n: number) => void;
  markOnboarded: () => void;
  reset: () => void;
}

const STORAGE_KEY = '@fieldedge/settings';

const defaults = {
  serverUrl: SYNC_API_URL,
  photoCap: 5000,
  hasOnboarded: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      setServerUrl: (url) => set({ serverUrl: url }),
      setPhotoCap: (n) =>
        set({ photoCap: Math.max(0, Math.floor(n)) }),
      markOnboarded: () => set({ hasOnboarded: true }),
      reset: () => set({ ...defaults, hasOnboarded: false }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      migrate: (persisted: any, version: number) => {
        // v1 → v2: dropped syncInterval (was a UI placeholder; will be
        // reintroduced by the background-sync feature once WorkManager
        // is wired up).
        if (version < 2 && persisted && 'syncInterval' in persisted) {
          delete persisted.syncInterval;
        }
        return persisted as SettingsState;
      },
    },
  ),
);
