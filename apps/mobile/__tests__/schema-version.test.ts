/**
 * Schema versioning — TS-side read shim.
 *
 * Verifies `migratePayload` upgrades payloads from any version (1, 2, or
 * missing discriminator) to the current v2 shape.
 */

// `fieldEdge.ts` transitively pulls in `storageUsage.ts`, which imports
// `react-native-fs` at module-load time. The bare Jest setup doesn't
// transpile RNFS, so stub it out — we're not exercising storage accounting
// here, only the schema migrator.
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    exists: jest.fn(),
    stat: jest.fn(),
    readDir: jest.fn(),
    mkdir: jest.fn(),
    unlink: jest.fn(),
    DocumentDirectoryPath: '/tmp',
  },
}));

import { migratePayload, detectSchemaVersion } from '../src/native/fieldEdge';

const v1Payload = () => ({
  schema_version: 1,
  photo_id: 'p1',
  device_id: 'dev-old',
  captured_at: '2025-05-12T14:23:01Z',
  lat: 12.34,
  lng: 56.78,
  gps_status: 'ok',
  project_id: 'legacy',
  file_path: '/photos/legacy.jpg',
  embedding_status: 'ok',
  enrichment_id: null,
  enrichment_tags: ['alpha', 'beta'],
  enrichment_objects: [],
  enrichment_text: null,
  synced_at: null,
  local_updated_at: '2025-05-12T14:23:01Z',
  vector_checksum: 'sha256:abc',
});

const v2Payload = () => ({
  schema_version: 2,
  photo_id: 'p2',
  device_id: 'dev',
  captured_at: '2025-05-12T14:23:01Z',
  lat: null,
  lng: null,
  gps_status: 'ok',
  project_id: 'P',
  file_path: 'f',
  embedding_status: 'ok',
  enrichment_id: null,
  enrichment_tags: [],
  enrichment_objects: [],
  enrichment_text: null,
  synced_at: null,
  local_updated_at: '2025-05-12T14:23:01Z',
  vector_checksum: 'sha256:def',
  deletion_marker: true,
  project_owner: 'alice',
  tags_v2: ['x', 'y'],
});

describe('detectSchemaVersion', () => {
  it('returns 2 when schema_version is 2', () => {
    expect(detectSchemaVersion(v2Payload())).toBe(2);
  });

  it('returns 1 when schema_version is 1', () => {
    expect(detectSchemaVersion(v1Payload())).toBe(1);
  });

  it('returns 1 when schema_version is missing', () => {
    const p = v1Payload();
    // @ts-ignore — deliberately omit for legacy support.
    delete p.schema_version;
    expect(detectSchemaVersion(p)).toBe(1);
  });
});

describe('migratePayload', () => {
  it('upgrades v1 input to v2 with migration defaults', () => {
    const out = migratePayload(v1Payload());
    expect(out.schema_version).toBe(2);
    expect(out.deletion_marker).toBe(false);
    expect(out.project_owner).toBeNull();
    expect(out.tags_v2).toEqual(['alpha', 'beta']);
    // v1 fields survive.
    expect(out.photo_id).toBe('p1');
    expect(out.enrichment_tags).toEqual(['alpha', 'beta']);
  });

  it('passes v2 input through unchanged', () => {
    const input = v2Payload();
    const out = migratePayload(input);
    expect(out.schema_version).toBe(2);
    expect(out.deletion_marker).toBe(true);
    expect(out.project_owner).toBe('alice');
    expect(out.tags_v2).toEqual(['x', 'y']);
  });

  it('treats missing schema_version as legacy v1', () => {
    const p = v1Payload();
    // @ts-ignore — deliberately omit.
    delete p.schema_version;
    const out = migratePayload(p);
    expect(out.schema_version).toBe(2);
    expect(out.deletion_marker).toBe(false);
    expect(out.project_owner).toBeNull();
    expect(out.tags_v2).toEqual(['alpha', 'beta']);
  });

  it('fills missing v2 fields when a v2 input is incomplete', () => {
    const p = v2Payload();
    // @ts-ignore — forcibly omit the new fields to simulate a partial read.
    delete p.deletion_marker;
    // @ts-ignore
    delete p.project_owner;
    // @ts-ignore
    delete p.tags_v2;
    const out = migratePayload(p);
    expect(out.deletion_marker).toBe(false);
    expect(out.project_owner).toBeNull();
    expect(out.tags_v2).toEqual([]);
  });
});
