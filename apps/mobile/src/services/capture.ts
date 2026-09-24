/**
 * Capture flow — orchestrates the full pipeline:
 *   1. Take photo via VisionCamera
 *   2. Extract EXIF GPS coordinates
 *   3. Resize + normalize for CLIP
 *   4. Run ONNX inference
 *   5. Compute vector checksum
 *   6. Build Payload (per PRD §7.5)
 *   7. Upsert to local Edge shard via Rust bridge
 *   8. Append to WAL for sync queue
 */

import { Platform } from 'react-native';
import { ulid } from 'ulid';
import { fieldEdge, Payload } from '../native/fieldEdge';
import { embedImage } from '../embedding/clip';
import { captureGps } from './location';
import { deviceId } from '../config';

const SHARD_DIR = '/data/data/com.fieldedge/files/edge-shard';
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
}

/**
 * Run the full capture pipeline for a freshly-taken photo.
 *
 *  1. Extract GPS (try EXIF on photo, fall back to device location)
 *  2. Run real CLIP embedding via ONNX Runtime
 *  3. Compute SHA-256 checksum
 *  4. Build payload (matches PRD §7.5)
 *  5. Upsert to local Edge shard via Rust bridge
 *  6. Append to WAL for sync queue
 */
export async function processCapture(input: CaptureInput): Promise<CaptureResult> {
  if (Platform.OS !== 'android') {
    throw new Error('Capture is only supported on Android');
  }

  const photoId = ulid();
  const capturedAt = new Date().toISOString();
  const projectId = input.projectId || PROJECT_DEFAULT;

  // 1. GPS: try EXIF on the photo, then device location
  const { coords: gps, source: gpsSource } = await captureGps(input.photoUri);

  // 2. Real CLIP embedding via ONNX Runtime
  const vector = await embedImage(input.photoUri);
  if (!vector) {
    throw new Error('CLIP model returned no embedding');
  }

  // 3. SHA-256 checksum (Rust returns {status, value:{checksum}})
  const checksumResp = await fieldEdge.checksum(vector);
  const checksumStr = checksumResp?.value?.checksum ?? '';

  // 4. Build payload (PRD §7.5)
  const payload: Payload = {
    schema_version: 1,
    photo_id: photoId,
    device_id: deviceId,
    captured_at: capturedAt,
    lat: gps?.lat ?? null,
    lng: gps?.lng ?? null,
    gps_status: gps ? 'ok' : 'unavailable',
    project_id: projectId,
    file_path: `${projectId}/${deviceId}/${photoId}.jpg`,
    embedding_status: 'ok',
    cloudinary_public_id: null,
    cloudinary_tags: [],
    cloudinary_objects: [],
    cloudinary_ocr_text: null,
    synced_at: null,
    local_updated_at: capturedAt,
    vector_checksum: checksumStr,
  };

  // 5. Upsert to local Edge shard (Rust core)
  const result = await fieldEdge.upsertPoints([
    { id: photoId, vector, payload },
  ]);
  if (!result.upserted) {
    throw new Error('Upsert returned 0 — Edge shard rejected the point');
  }

  // 6. Append to WAL (sync queue).
  //    Strip the `vector` and `payload` from the WAL entry — the server
  //    has them via the upload batch. WAL stores only id/checksum/metadata.
  //    This sidesteps the column-7288 PARSE_ERROR we hit when serializing
  //    the full 512-float vector + payload via the RN bridge.
  await fieldEdge.walAppend(`${SHARD_DIR}/sync.wal`, JSON.stringify({
    op: 'upsert',
    seq: Date.now(),
    point_id: photoId,
    vector_checksum: checksumStr,
    project_id: projectId,
    ts: capturedAt,
    sync_state: 'pending',
  }));

  return { photoId, vector, payload, gpsSource };
}

