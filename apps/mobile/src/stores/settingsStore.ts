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
 *   - syncInterval — UI placeholder for background sync (Manual/15m/1h/6h)
 *   - hasOnboarded — gates the OnboardingScreen on first launch
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { SYNC_API_URL } from '../config';

export type SyncInterval = 'manual' | '15m' | '1h' | '6h';

interface SettingsState {
  serverUrl: string;
  photoCap: number;
  syncInterval: SyncInterval;
  hasOnboarded: boolean;
  setServerUrl: (url: string) => void;
  setPhotoCap: (n: number) => void;
  setSyncInterval: (v: SyncInterval) => void;
  markOnboarded: () => void;
  reset: () => void;
}

const STORAGE_KEY = '@fieldedge/settings';

const defaults = {
  serverUrl: SYNC_API_URL,
  photoCap: 5000,
  syncInterval: 'manual' as SyncInterval,
  hasOnboarded: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      setServerUrl: (url) => set({ serverUrl: url }),
      setPhotoCap: (n) =>
        set({ photoCap: Math.max(0, Math.floor(n)) }),
      setSyncInterval: (v) => set({ syncInterval: v }),
      markOnboarded: () => set({ hasOnboarded: true }),
      reset: () => set({ ...defaults, hasOnboarded: false }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);
