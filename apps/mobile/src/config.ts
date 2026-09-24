/**
 * App-wide configuration.
 *
 * Device ID is generated on first launch with ulid() and persisted via
 * AsyncStorage so it survives reinstalls of the JS bundle. The sync API
 * accepts the token `dev_<deviceId>` (see apps/sync-api/app/auth.py).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { ulid } from 'ulid';

// ─── Device identity ─────────────────────────────────────────────────────────

const DEVICE_ID_KEY = '@fieldedge/device_id';
const DEVICE_TOKEN_KEY = '@fieldedge/device_token';

let _deviceId: string | null = null;
let _deviceToken: string | null = null;

/**
 * Read or generate the per-install device ID.
 *
 * - First launch: ulid() → AsyncStorage → return.
 * - Subsequent launches: read from AsyncStorage, cache in memory.
 *
 * The sync API's auth uses the token `dev_<deviceId>` (≥8 chars after the
 * `dev_` prefix satisfies the length check).
 */
export async function getDeviceId(): Promise<string> {
  if (_deviceId) return _deviceId;
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) {
    _deviceId = stored;
    return stored;
  }
  const fresh = ulid();
  await AsyncStorage.setItem(DEVICE_ID_KEY, fresh);
  _deviceId = fresh;
  return fresh;
}

/**
 * Return the Bearer token the sync API expects. Derived from the device ID.
 */
export async function getDeviceToken(): Promise<string> {
  if (_deviceToken) return _deviceToken;
  const id = await getDeviceId();
  _deviceToken = `dev_${id}`;
  return _deviceToken;
}

// ─── Server endpoints ────────────────────────────────────────────────────────

/**
 * Sync API endpoint.
 *
 * Priority:
 *   1. process.env.SYNC_API_URL (only inlined if the babel env-vars plugin
 *      is configured; otherwise this branch is dead)
 *   2. Production → Render URL (default for the hackathon demo so the
 *      bundle works out-of-the-box on physical devices)
 *   3. Android emulator → host machine (10.0.2.2) — used for local dev
 *   4. Other platforms → localhost
 */
const ENV_URL = (typeof process !== 'undefined' && process.env && process.env.SYNC_API_URL)
  ? process.env.SYNC_API_URL
  : null;

export const SYNC_API_URL: string = (() => {
  if (ENV_URL && ENV_URL.length > 0) return ENV_URL;
  // Default to the deployed Render service so the demo works without any
  // extra configuration. Override at bundle time by setting
  // SYNC_API_URL=http://10.0.2.2:8000 (emulator) or a LAN IP for a
  // physical device pointed at a local FastAPI server.
  if (Platform.OS === 'android') {
    return 'https://code-cubicle-qdrant.onrender.com';
  }
  return 'http://localhost:8000';
})();

export const FIELD_SHARD_DIR = (() => {
  if (Platform.OS === 'android') {
    return '/data/data/com.fieldedge/files/edge-shard';
  }
  return './edge-shard';
})();

/** Same path as FIELD_SHARD_DIR plus the canonical WAL filename. */
export const WAL_PATH = `${FIELD_SHARD_DIR}/sync.wal`;

// ─── Photo cap (FR-024) ─────────────────────────────────────────────────────

/** Default per-device photo cap. Override at runtime with setPhotoCap(). */
export const PHOTO_CAP_DEFAULT = 5000;
let _photoCap: number = PHOTO_CAP_DEFAULT;
export function setPhotoCap(n: number) { _photoCap = Math.max(0, Math.floor(n)); }
export function getPhotoCap(): number { return _photoCap; }

// ─── Photo file paths (FR-001) ──────────────────────────────────────────────
//
// JPEGs live under <app_docs>/<project_id>/<device_id>/<photo_id>.jpg so
// they survive Android clearing the image-picker cache.

export function photoDir(projectId: string, deviceId: string): string {
  return `${RNFS.DocumentDirectoryPath}/${projectId}/${deviceId}`;
}

export function photoAbsPath(projectId: string, deviceId: string, photoId: string): string {
  return `${photoDir(projectId, deviceId)}/${photoId}.jpg`;
}

export function relativePhotoPath(projectId: string, deviceId: string, photoId: string): string {
  return `${projectId}/${deviceId}/${photoId}.jpg`;
}

export function photoFileUri(absPath: string): string {
  return absPath.startsWith('file://') ? absPath : `file://${absPath}`;
}

/** Build a `file://` URI from a relative payload.file_path. */
export function photoFileUriFromRelative(relPath: string): string {
  return photoFileUri(`${RNFS.DocumentDirectoryPath}/${relPath}`);
}

/** Re-export for screens that need the absolute docs path. */
export const APP_DOCS_PATH = RNFS.DocumentDirectoryPath;

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
