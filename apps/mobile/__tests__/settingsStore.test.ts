/**
 * Tests for the settings store (zustand + AsyncStorage persist).
 *
 * AsyncStorage is stubbed here (rather than using the package's jest
 * mock) because the project's jest config runs in the node environment
 * — pulling in the official mock would require a jsdom env that
 * isn't installed.
 */

// Mocks must be declared before importing the module under test.
// jest hoists jest.mock() above the imports below.
jest.mock('../src/config', () => ({
  SYNC_API_URL: 'https://test.example',
  PHOTO_CAP_DEFAULT: 5000,
}));

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
    multiGet: jest.fn(async (keys: string[]) =>
      keys.map((k) => [k, memStore[k] ?? null] as [string, string | null]),
    ),
    multiSet: jest.fn(async (pairs: [string, string][]) => {
      for (const [k, v] of pairs) memStore[k] = v;
    }),
    multiRemove: jest.fn(async (keys: string[]) => {
      for (const k of keys) delete memStore[k];
    }),
  };
  return {
    __esModule: true,
    default: api,
    ...api,
  };
});

import { useSettingsStore } from '../src/stores/settingsStore';

const STORAGE_KEY = '@fieldedge/settings';

beforeEach(async () => {
  for (const k of Object.keys(memStore)) delete memStore[k];
  // Reset the store's own state to defaults between tests.
  useSettingsStore.setState({
    serverUrl: useSettingsStore.getState().serverUrl,
    photoCap: 5000,
    syncInterval: 'manual',
    hasOnboarded: false,
  });
});

describe('settingsStore', () => {
  it('exposes defaults on a fresh store', () => {
    const s = useSettingsStore.getState();
    expect(typeof s.serverUrl).toBe('string');
    expect(s.photoCap).toBe(5000);
    expect(s.syncInterval).toBe('manual');
    expect(s.hasOnboarded).toBe(false);
  });

  it('persists every setter change to AsyncStorage', async () => {
    const s = useSettingsStore.getState();

    s.setServerUrl('https://example.test');
    s.setPhotoCap(123);
    s.setSyncInterval('1h');
    s.markOnboarded();

    // Wait a tick for persist's debounced write.
    await new Promise((r) => setTimeout(r, 50));

    const raw = memStore[STORAGE_KEY];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.serverUrl).toBe('https://example.test');
    expect(parsed.state.photoCap).toBe(123);
    expect(parsed.state.syncInterval).toBe('1h');
    expect(parsed.state.hasOnboarded).toBe(true);
  });

  it('reloads persisted state when the module is re-required (cold launch)', async () => {
    // Round 1 — set values & let persist flush.
    useSettingsStore.getState().setServerUrl('https://reload.test');
    useSettingsStore.getState().setPhotoCap(42);
    useSettingsStore.getState().setSyncInterval('6h');
    useSettingsStore.getState().markOnboarded();
    await new Promise((r) => setTimeout(r, 50));

    // Round 2 — wipe the module cache and require it again to simulate
    // a cold app launch. The store is rebuilt with `defaults` first
    // then rehydrated from memStore.
    jest.resetModules();
    const { useSettingsStore: reloaded } = require('../src/stores/settingsStore');
    expect(reloaded.getState().serverUrl).not.toBe('https://reload.test'); // not yet hydrated

    // After hydration (persist fires async), values reflect memStore.
    await new Promise((r) => setTimeout(r, 50));
    const s = reloaded.getState();
    expect(s.serverUrl).toBe('https://reload.test');
    expect(s.photoCap).toBe(42);
    expect(s.syncInterval).toBe('6h');
    expect(s.hasOnboarded).toBe(true);
  });

  it('reset() clears onboarding flag and restores defaults', () => {
    useSettingsStore.getState().markOnboarded();
    useSettingsStore.getState().setPhotoCap(7);
    useSettingsStore.getState().setSyncInterval('15m');
    expect(useSettingsStore.getState().hasOnboarded).toBe(true);

    useSettingsStore.getState().reset();
    const after = useSettingsStore.getState();
    expect(after.hasOnboarded).toBe(false);
    expect(after.photoCap).toBe(5000);
    expect(after.syncInterval).toBe('manual');
  });

  it('setPhotoCap floors non-negative integers', () => {
    const s = useSettingsStore.getState();
    s.setPhotoCap(-5);
    expect(useSettingsStore.getState().photoCap).toBe(0);
    s.setPhotoCap(3.9);
    expect(useSettingsStore.getState().photoCap).toBe(3);
    s.setPhotoCap(0);
    expect(useSettingsStore.getState().photoCap).toBe(0);
    s.setPhotoCap(250);
    expect(useSettingsStore.getState().photoCap).toBe(250);
  });
});
