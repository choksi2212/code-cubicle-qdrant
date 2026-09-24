/**
 * Snapshot tests for SettingsScreen.
 *
 * Renders the screen and verifies the snapshot locks the layout
 * (sections, inputs, stepper, account row, storage usage, about).
 *
 * The snapshot must be inspected and accepted on first run — don't
 * blindly regenerate on changes.
 */

import React from 'react';
import renderer from 'react-test-renderer';

jest.mock('../src/storage/storageUsage', () => ({
  storageUsage: jest.fn(async () => ({
    photosBytes: 5_000_000,
    shardBytes: 2_000_000,
    walBytes: 4096,
  })),
  formatBytes: (b: number) =>
    b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`,
}));

jest.mock('../src/config', () => ({
  getDeviceToken: jest.fn(async () => 'dev_abcdefgh1234'),
}));

const mockStartSync = jest.fn(async () => {});
const mockStopSync = jest.fn(async () => {});
const mockRunOnce = jest.fn(async () => {});
const mockGetStatus = jest.fn(async () => ({
  scheduled: false,
  intervalMinutes: 0,
  requiresWifi: true,
  requiresCharging: false,
  lastRunAt: null,
}));

jest.mock('../src/services/syncScheduler', () => ({
  startSync: (...args: unknown[]) => mockStartSync(...args),
  stopSync: (...args: unknown[]) => mockStopSync(...args),
  runOnce: (...args: unknown[]) => mockRunOnce(...args),
  getStatus: (...args: unknown[]) => mockGetStatus(...args),
}));

jest.mock('../src/stores/settingsStore', () => {
  const state = {
    serverUrl: 'https://default.test',
    photoCap: 5000,
    hasOnboarded: true,
    syncInterval: 'manual',
    setServerUrl: jest.fn(),
    setPhotoCap: jest.fn(),
    markOnboarded: jest.fn(),
    setSyncInterval: jest.fn(),
    reset: jest.fn(),
  };
  return {
    useSettingsStore: (selector: any) => selector(state),
  };
});

jest.mock('../src/stores/syncStore', () => {
  const state = {
    status: 'idle',
    lastReport: null,
    pendingCount: 0,
    lastError: null,
    retryCount: 0,
    nextRetryAt: null,
    deadLetterCount: 0,
    lastRunAt: null,
    triggerSync: jest.fn(),
    setPendingCount: jest.fn(),
    recordSyncSuccess: jest.fn(),
    recordSyncFailure: jest.fn(),
    resetRetry: jest.fn(),
    syncRetryStateFromQueue: jest.fn(),
  };
  return {
    useSyncStore: (selector: any) => selector(state),
  };
});

import { SettingsScreen } from '../src/screens/SettingsScreen';

describe('SettingsScreen', () => {
  it('matches the locked layout snapshot', () => {
    const tree = renderer
      .create(
        <SettingsScreen onClose={() => {}} onLogout={() => {}} />,
      )
      .toJSON();
    expect(tree).toMatchSnapshot();
  });

  it('renders every required section header', () => {
    const tree = renderer
      .create(
        <SettingsScreen onClose={() => {}} onLogout={() => {}} />,
      )
      .toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('Settings');
    expect(json).toContain('Sync');
    expect(json).toContain('Server URL');
    expect(json).toContain('Photo cap');
    expect(json).toContain('Account');
    expect(json).toContain('Storage');
    expect(json).toContain('About');
    expect(json).toContain('Log out');
    expect(json).toContain('Built for the Paytm × Qdrant hackathon');
  });

  it('renders all four sync-interval chips', () => {
    const tree = renderer
      .create(
        <SettingsScreen onClose={() => {}} onLogout={() => {}} />,
      )
      .toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('Manual');
    expect(json).toContain('15m');
    expect(json).toContain('1h');
    expect(json).toContain('6h');
  });

  it('shows Last sync / Next sync rows when not dead-lettered', () => {
    const tree = renderer
      .create(
        <SettingsScreen onClose={() => {}} onLogout={() => {}} />,
      )
      .toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('Last sync');
    expect(json).toContain('Next sync');
  });
});
