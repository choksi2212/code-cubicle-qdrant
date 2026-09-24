/**
 * Snapshot tests for SettingsScreen.
 *
 * Renders the screen and verifies the snapshot locks the layout
 * (sections, inputs, stepper, interval chips, account row, about).
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

jest.mock('../src/stores/settingsStore', () => {
  const state = {
    serverUrl: 'https://default.test',
    photoCap: 5000,
    syncInterval: 'manual',
    hasOnboarded: true,
    setServerUrl: jest.fn(),
    setPhotoCap: jest.fn(),
    setSyncInterval: jest.fn(),
    markOnboarded: jest.fn(),
    reset: jest.fn(),
  };
  return {
    useSettingsStore: (selector: any) => selector(state),
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
    expect(json).toContain('Server URL');
    expect(json).toContain('Photo cap');
    expect(json).toContain('Sync interval');
    expect(json).toContain('Account');
    expect(json).toContain('Storage usage');
    expect(json).toContain('About');
    expect(json).toContain('Log out');
    expect(json).toContain('Built for Paytm × Qdrant hackathon');
  });
});
