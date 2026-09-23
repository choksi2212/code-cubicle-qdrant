/**
 * App-wide configuration. Loaded from .env at build time.
 *
 * In v1 we hardcode values; a future v2 should load from MMKV or env.
 */

import { NativeModules, Platform } from 'react-native';

// ─── Device identity ─────────────────────────────────────────────────────────

/**
 * Per-install device ID. Generated once and stored in Keychain/Keystore
 * by the native side; here we fall back to a random ULID at first launch.
 */
let _deviceId: string | null = null;
export async function getDeviceId(): Promise<string> {
  if (_deviceId) return _deviceId;
  _deviceId = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return _deviceId;
}

export const deviceId = `dev_placeholder`;

// ─── Server endpoints ────────────────────────────────────────────────────────

/**
 * Sync API endpoint.
 *
 * Priority:
 *   1. Process env SYNC_API_URL (injected at bundle time by `metro.config.js`)
 *   2. Android emulator → host machine (10.0.2.2)
 *   3. Physical device → LAN IP of dev machine
 *   4. Production → Render URL (set SYNC_API_URL when bundling release)
 */
const ENV_URL = (typeof process !== 'undefined' && process.env && process.env.SYNC_API_URL)
  ? process.env.SYNC_API_URL
  : null;

export const SYNC_API_URL: string = (() => {
  if (ENV_URL) return ENV_URL;
  if (Platform.OS === 'android') {
    // 10.0.2.2 = Android emulator → host localhost.
    // For physical device against local server, replace with LAN IP.
    return 'http://10.0.2.2:8000';
  }
  return 'http://localhost:8000';
})();

export const FIELD_SHARD_DIR = (() => {
  if (Platform.OS === 'android') {
    return '/data/data/com.fieldedge/files/edge-shard';
  }
  return './edge-shard';
})();

// ─── Feature flags ───────────────────────────────────────────────────────────

export const FEATURES = {
  realClipInference: Platform.OS === 'android',
  backgroundSync: true,
  conflictResolutionUi: true,
};

// ─── Hardcoded project for the demo ─────────────────────────────────────────

export const DEMO_PROJECTS = [
  { id: 'river-study', name: 'River Study', color: '#00BFA6' },
  { id: 'forest-survey', name: 'Forest Survey', color: '#F5A524' },
  { id: 'urban-infra', name: 'Urban Infrastructure', color: '#8B5CF6' },
  { id: 'wildlife-tracker', name: 'Wildlife Tracker', color: '#EF4444' },
];
