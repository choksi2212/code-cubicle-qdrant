/**
 * Demo seed script — populates the local Edge shard with 50 sample photos.
 *
 * In v1: generates synthetic 512-dim vectors (one per "photo") and inserts
 * them with realistic payloads. v2: loads actual CC0 photos and runs CLIP
 * inference on them.
 */

import { fieldEdge } from '../src/native/fieldEdge';
import { ulid } from 'ulid';

const PROJECTS = ['river-study', 'forest-survey', 'urban-infra', 'wildlife-tracker'];
const DEVICE_ID = 'demo-device-001';
const SHARD_DIR = './demo-edge-shard';

function randomVector(seed: number, dim = 512): number[] {
  // Deterministic pseudo-random vector (good enough for demo)
  const vec: number[] = [];
  let s = seed;
  for (let i = 0; i < dim; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    vec.push(((s % 1000) / 1000 - 0.5) * 0.1);
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0));
  return vec.map((v) => v / norm);
}

async function main() {
  console.log('🌱 Seeding demo data...');

  await fieldEdge.openShard({ directory: SHARD_DIR });
  console.log('✅ Edge shard opened');

  const now = Date.now();
  const points = [];

  for (let i = 0; i < 50; i++) {
    const projectId = PROJECTS[i % PROJECTS.length];
    const photoId = ulid();
    const vec = randomVector(i + 1);

    const payload = {
      schema_version: 1,
      photo_id: photoId,
      device_id: DEVICE_ID,
      captured_at: new Date(now - i * 60_000).toISOString(),
      lat: 13.4521 + (Math.random() - 0.5) * 0.1,
      lng: 75.1234 + (Math.random() - 0.5) * 0.1,
      gps_status: 'ok' as const,
      project_id: projectId,
      file_path: `${projectId}/${DEVICE_ID}/${photoId}.jpg`,
      embedding_status: 'ok' as const,
      cloudinary_public_id: null,
      cloudinary_tags: [],
      cloudinary_objects: [],
      cloudinary_ocr_text: null,
      synced_at: null,
      local_updated_at: new Date(now - i * 60_000).toISOString(),
      vector_checksum: await fieldEdge.checksum(vec),
    };

    points.push({ id: photoId, vector: vec, payload });
  }

  await fieldEdge.upsertPoints(points);
  console.log(`✅ Inserted ${points.length} points`);

  const count = await fieldEdge.pointCount();
  console.log(`📊 Total points in shard: ${count}`);

  // Demo query
  const queryVec = randomVector(42);
  const hits = await fieldEdge.query({ vector: queryVec, limit: 5 });
  console.log(`🔍 Top 5 similar to seed 42:`);
  for (const hit of hits) {
    console.log(`  - ${hit.id} (score=${hit.score.toFixed(4)}, project=${hit.payload.project_id})`);
  }

  console.log('✅ Seed complete. Run the app to see the data.');
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
