/**
 * Capture flow — orchestrates the full pipeline:
 *   1. Enforce per-device photo cap (FR-024)
 *   2. Persist the JPEG under <app_docs>/<project>/<device>/<photo>.jpg (FR-001)
 *   3. Extract EXIF GPS coordinates
 *   4. Run ONNX CLIP inference (or degraded-mode fallback per FR-014)
 *   5. Compute vector checksum
 *   6. Build Payload (per PRD §7.5)
 *   7. Upsert to local Edge shard via Rust bridge
 *   8. Append to WAL for sync queue
 */

import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { uuidv4 } from '../util/uuid';
import { fieldEdge, Payload } from '../native/fieldEdge';
import { embedImage } from '../embedding/clip';
import { captureGps } from './location';
import {
  getDeviceId,
  WAL_PATH,
  getPhotoCap,
  photoDir,
  photoAbsPath,
  relativePhotoPath,
} from '../config';

const PROJECT_DEFAULT = 'unassigned';

export interface CaptureInput {
  photoUri: string;
  width: number;
  height: number;
  projectId?: string;
}

export interface CaptureResult {
  photoId: string;
  vector: number[];
  payload: Payload;
  gpsSource: 'exif' | 'device' | 'none';
  embeddingStatus: 'ok' | 'failed';
}

export class PhotoCapExceededError extends Error {
  constructor(public current: number, public cap: number) {
    super(
      `Photo cap exceeded: ${current} on disk, cap is ${cap}. ` +
      `Sync or delete old photos before capturing more.`,
    );
    this.name = 'PhotoCapExceededError';
  }
}

/**
 * Run the full capture pipeline for a freshly-taken photo.
 *
 *  1. Enforce photo cap (FR-024)
 *  2. Persist JPEG to <app_docs>/<project>/<device>/<photo>.jpg (FR-001)
 *  3. Extract GPS (try EXIF on photo, then device location)
 *  4. Run CLIP embedding — falls back to degraded mode on failure (FR-014)
 *  5. Compute SHA-256 checksum
 *  6. Build payload (matches PRD §7.5)
 *  7. Upsert to local Edge shard via Rust bridge
 *  8. Append to WAL for sync queue
 */
export async function processCapture(input: CaptureInput): Promise<CaptureResult> {
  if (Platform.OS !== 'android') {
    throw new Error('Capture is only supported on Android');
  }

  const photoId = uuidv4();
  const capturedAt = new Date().toISOString();
  const projectId = input.projectId || PROJECT_DEFAULT;
  const deviceIdStr = await getDeviceId();

  // 0. Enforce per-device photo cap (FR-024).
  const cap = getPhotoCap();
  if (cap > 0) {
    const currentCount = await fieldEdge.pointCount();
    if (currentCount >= cap) {
      throw new PhotoCapExceededError(currentCount, cap);
    }
  }

  // 1. Persist the JPEG to <app_docs>/<project>/<device>/<photo>.jpg (FR-001).
  //    image-picker's cache is wiped by Android on storage pressure; copy the
  //    bytes into our sandbox so the photo survives.
  const absDest = photoAbsPath(projectId, deviceIdStr, photoId);
  const destDir = photoDir(projectId, deviceIdStr);
  try {
    await RNFS.mkdir(destDir);
  } catch (_) {
    // Directory may already exist; mkdir throws on existing dirs on some
    // platforms, which is fine — the copyFile will succeed.
  }
  // RNFS.copyFile accepts file:// or plain paths; strip file:// prefix.
  const srcPath = input.photoUri.startsWith('file://')
    ? input.photoUri.replace(/^file:\/\//, '')
    : input.photoUri;
  try {
    await RNFS.copyFile(srcPath, absDest);
  } catch (e) {
    throw new Error(`Failed to persist JPEG to ${absDest}: ${String(e)}`);
  }

  // 2. GPS: try EXIF on the photo, then device location
  const { coords: gps, source: gpsSource } = await captureGps(input.photoUri);

  // 3. Real CLIP embedding via ONNX Runtime, with degraded-mode fallback (FR-014).
  let vector: number[] | null = null;
  let embeddingStatus: 'ok' | 'failed' = 'ok';
  let embeddingError: string | null = null;
  try {
    vector = await embedImage(input.photoUri);
    if (!vector) {
      embeddingStatus = 'failed';
      embeddingError = 'CLIP model returned no embedding';
    }
  } catch (e) {
    embeddingStatus = 'failed';
    embeddingError = String(e);
    console.warn('[capture] CLIP failed, falling back to degraded mode:', e);
  }

  // 4. SHA-256 checksum (Rust returns {status, value:{checksum}}).
  //    Only meaningful when we actually have a vector.
  const checksumStr =
    vector && embeddingStatus === 'ok'
      ? (await fieldEdge.checksum(vector)).value?.checksum ?? ''
      : '';

  // 5. Build payload (PRD §7.5). file_path is the relative path under
  //    <app_docs> so it matches the convention in the PRD example.
  const payload: Payload = {
    schema_version: 1,
    photo_id: photoId,
    device_id: deviceIdStr,
    captured_at: capturedAt,
    lat: gps?.lat ?? null,
    lng: gps?.lng ?? null,
    gps_status: gps ? 'ok' : 'unavailable',
    project_id: projectId,
    file_path: relativePhotoPath(projectId, deviceIdStr, photoId),
    embedding_status: embeddingStatus,
    enrichment_id: null,
    enrichment_tags: [],
    enrichment_objects: [],
    enrichment_text: null,
    synced_at: null,
    local_updated_at: capturedAt,
    vector_checksum: checksumStr,
  };

  // 6. Upsert to local Edge shard. In degraded mode we still record the
  //    photo (with a zero vector placeholder) so the metadata survives,
  //    but it won't appear in semantic search results.
  if (embeddingStatus === 'ok' && vector) {
    const result = await fieldEdge.upsertPoints([
      { id: photoId, vector, payload },
    ]);
    if (!result.upserted) {
      throw new Error('Upsert returned 0 — Edge shard rejected the point');
    }
  } else {
    // Degraded mode: persist a zero vector so the point exists in the shard
    // for metadata (and future re-embedding), but won't match search.
    const zero = new Array(512).fill(0);
    await fieldEdge.upsertPoints([{ id: photoId, vector: zero, payload }]);
  }

  // 7. Append to WAL (sync queue). Skipped in degraded mode since there's
  //    no useful vector to upload.
  if (embeddingStatus === 'ok') {
    await fieldEdge.walAppend(WAL_PATH, JSON.stringify({
      op: 'upsert',
      seq: Date.now(),
      point_id: photoId,
      vector_checksum: checksumStr,
      project_id: projectId,
      ts: capturedAt,
      sync_state: 'pending',
    }));
  } else {
    console.warn(
      `[capture] Skipping WAL append for ${photoId} (embedding failed: ${embeddingError})`,
    );
  }

  return {
    photoId,
    vector: vector ?? [],
    payload,
    gpsSource,
    embeddingStatus,
  };
}
