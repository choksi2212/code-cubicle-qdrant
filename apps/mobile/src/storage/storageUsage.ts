/**
 * Disk usage accounting for FieldEdge on-device storage.
 *
 * Three buckets:
 *   - Photos:    JPEGs under <app_docs>/<project>/<device>/*.jpg
 *   - Shard:     Edge shard files under FIELD_SHARD_DIR
 *   - WAL:       Append-only log at WAL_PATH
 *
 * Sizes are summed by walking the directory tree with RNFS and adding up
 * `stat.size`. Missing directories count as 0 bytes so callers can use
 * this even before the first capture.
 *
 * This module deliberately lives outside `services/` — it's a pure
 * accounting helper with no side effects and no async business logic,
 * which is what makes it easy to unit-test under jest.
 */

import RNFS from 'react-native-fs';
import { FIELD_SHARD_DIR, WAL_PATH } from '../config';

export interface StorageUsage {
  photosBytes: number;
  shardBytes: number;
  walBytes: number;
}

/**
 * Sum the total size of every file reachable under `dir`.
 *
 * Walks recursively; on any per-file error (permission, vanished) we
 * just skip it. Returns 0 if the directory doesn't exist yet.
 */
async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: RNFS.ReadDirItem[];
  try {
    entries = await RNFS.readDir(dir);
  } catch (_) {
    // ENOENT or permission denied — treat as empty.
    return 0;
  }
  for (const entry of entries) {
    if (entry.isFile()) {
      total += entry.size ?? 0;
    } else if (entry.isDirectory()) {
      total += await dirSize(entry.path);
    }
  }
  return total;
}

/**
 * Sum sizes of JPEGs under every <project>/<device> subdir of
 * <app_docs>. The photo-dir layout is <docs>/<project>/<device>/*.jpg
 * (see `photoDir()` in config.ts), so we walk one level at a time.
 */
async function photosBytes(): Promise<number> {
  const docs = RNFS.DocumentDirectoryPath;
  let top: RNFS.ReadDirItem[];
  try {
    top = await RNFS.readDir(docs);
  } catch (_) {
    return 0;
  }
  let total = 0;
  for (const project of top) {
    if (!project.isDirectory()) continue;
    let devices: RNFS.ReadDirItem[];
    try {
      devices = await RNFS.readDir(project.path);
    } catch (_) {
      continue;
    }
    for (const dev of devices) {
      if (!dev.isDirectory()) continue;
      total += await dirSize(dev.path);
    }
  }
  return total;
}

/**
 * Size of the WAL file. Falls back to 0 if missing.
 */
async function walBytes(): Promise<number> {
  try {
    const stat = await RNFS.stat(WAL_PATH);
    return Number(stat.size) || 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Compute disk usage across all three buckets. Each bucket is computed
 * independently so a failure in one (e.g. WAL missing) doesn't lose the
 * others.
 */
export async function storageUsage(): Promise<StorageUsage> {
  const [photosBytesVal, shardBytesVal, walBytesVal] = await Promise.all([
    photosBytes(),
    dirSize(FIELD_SHARD_DIR),
    walBytes(),
  ]);
  return {
    photosBytes: photosBytesVal,
    shardBytes: shardBytesVal,
    walBytes: walBytesVal,
  };
}

/**
 * Human-readable formatter used by the Settings screen.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
