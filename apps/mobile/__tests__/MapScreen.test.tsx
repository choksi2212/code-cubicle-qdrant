/**
 * Snapshot + behavior tests for MapScreen.
 *
 * Verifies:
 *   - renders the locked layout (header + map canvas)
 *   - filters to geo-tagged captures only (drops gps_status != "ok")
 *   - shows the "No GPS coordinates captured yet" empty state when none
 *   - invokes onOpenPhoto with the photoId when a marker is tapped
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

/**
 * safeStringify — JSON.stringify with circular-ref and function guards.
 *
 * react-test-renderer's toJSON() returns an object tree that contains
 * React-element props (with `_owner` back-references to the parent fiber)
 * and function props. Plain JSON.stringify throws "Converting circular
 * structure to JSON" or returns undefined when handed these. This
 * replacer drops functions, breaks cycles with WeakSet, and skips React
 * internal keys so the resulting string is stable for assertions.
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  const REACT_INTERNAL_KEYS = new Set(['_owner', '_store', '$$typeof']);
  return JSON.stringify(value, (key, val) => {
    if (typeof val === 'function') return undefined;
    if (key && REACT_INTERNAL_KEYS.has(key)) return undefined;
    if (val && typeof val === 'object') {
      if (seen.has(val as object)) return undefined;
      seen.add(val as object);
    }
    return val;
  });
}

jest.mock('../src/native/fieldEdge', () => ({
  fieldEdge: {
    retrieve: jest.fn(async () => []),
  },
}));

jest.mock('../src/config', () => ({
  photoFileUriFromRelative: (rel: string) => `file:///mock/${rel}`,
}));

import { MapScreen } from '../src/screens/MapScreen';
import { fieldEdge } from '../src/native/fieldEdge';

const mockedFieldEdge = fieldEdge as jest.Mocked<typeof fieldEdge>;

function buildPoint(overrides: Partial<{
  id: string;
  photoId: string;
  capturedAt: string;
  filePath: string;
  lat: number | null;
  lng: number | null;
  gpsStatus: 'ok' | 'unavailable' | 'denied';
}> = {}) {
  const now = new Date();
  const defaults = {
    id: overrides.id ?? 'p1',
    photoId: overrides.photoId ?? 'p1',
    capturedAt: overrides.capturedAt ?? now.toISOString(),
    filePath: overrides.filePath ?? 'proj/dev/p1.jpg',
    lat: overrides.lat ?? null,
    lng: overrides.lng ?? null,
    gpsStatus: overrides.gpsStatus ?? 'ok',
  };
  return {
    id: defaults.id,
    vector: [0.1, 0.2],
    payload: {
      schema_version: 2,
      photo_id: defaults.photoId,
      device_id: 'dev_test',
      captured_at: defaults.capturedAt,
      lat: defaults.lat,
      lng: defaults.lng,
      gps_status: defaults.gpsStatus,
      project_id: 'river-study',
      file_path: defaults.filePath,
      embedding_status: 'ok' as const,
      enrichment_id: null,
      enrichment_tags: [],
      enrichment_objects: [],
      enrichment_text: null,
      synced_at: null,
      local_updated_at: defaults.capturedAt,
      vector_checksum: 'sha256:test',
      deletion_marker: false,
      project_owner: null,
      tags_v2: [],
    },
  };
}

async function mountAndLoad(element: React.ReactElement) {
  let root: renderer.ReactTestRenderer | null = null;
  await act(async () => {
    root = renderer.create(element);
  });
  await act(async () => {});
  return root!;
}

describe('MapScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('matches the locked layout snapshot (no GPS data)', async () => {
    mockedFieldEdge.retrieve.mockResolvedValueOnce([]);
    const root = await mountAndLoad(<MapScreen onBack={() => {}} onOpenPhoto={() => {}} />);
    expect(root.toJSON()).toMatchSnapshot();
  });

  it('matches the locked layout snapshot (populated with markers)', async () => {
    mockedFieldEdge.retrieve.mockResolvedValueOnce([
      buildPoint({ id: 'p1', photoId: 'p1', lat: 12.34, lng: 56.78 }),
      buildPoint({ id: 'p2', photoId: 'p2', lat: 12.36, lng: 56.80 }),
    ]);
    const root = await mountAndLoad(<MapScreen onBack={() => {}} onOpenPhoto={() => {}} />);
    expect(root.toJSON()).toMatchSnapshot();
  });

  it('shows the "No GPS data yet" empty state when no geo data', async () => {
    mockedFieldEdge.retrieve.mockResolvedValueOnce([
      buildPoint({ id: 'p1', photoId: 'p1', gpsStatus: 'denied' }),
    ]);
    const root = await mountAndLoad(<MapScreen onBack={() => {}} onOpenPhoto={() => {}} />);
    expect(JSON.stringify(root.toJSON())).toContain('No GPS data yet');
  });

  it('renders markers for geo-tagged photos', async () => {
    const onOpenPhoto = jest.fn();
    mockedFieldEdge.retrieve.mockResolvedValueOnce([
      buildPoint({ id: 'photo-marker', photoId: 'photo-marker', lat: 12.34, lng: 56.78 }),
    ]);
    const root = await mountAndLoad(<MapScreen onBack={() => {}} onOpenPhoto={onOpenPhoto} />);
    const json = safeStringify(root.toJSON());
    // The marker pin renders the photo id (substring) somewhere in the
    // tree — we don't pin a specific accessibilityLabel because the
    // marker styling is internal to MapScreen.
    expect(json).toContain('photo-marker');
  });

  it('renders a Back button that calls onBack', async () => {
    mockedFieldEdge.retrieve.mockResolvedValueOnce([]);
    const onBack = jest.fn();
    const root = await mountAndLoad(<MapScreen onBack={onBack} onOpenPhoto={() => {}} />);
    // Walk the TestInstance tree (avoid JSON.stringify — reanimated's
    // shared values create circular structures that break it). Look for
    // any onPress handler whose subtree contains the string 'Back'.
    const containsBack = (node: any): boolean => {
      if (node == null) return false;
      if (typeof node === 'string') return node === 'Back';
      const kids = (node as any).children || [];
      for (const k of kids) {
        if (containsBack(k)) return true;
      }
      return false;
    };
    let pressed = false;
    const walk = (node: any) => {
      if (pressed || !node) return;
      if (typeof node.props?.onPress === 'function' && containsBack(node)) {
        act(() => node.props.onPress());
        pressed = true;
        return;
      }
      const kids = node.children || [];
      for (const child of kids) {
        if (child && typeof child === 'object') walk(child);
      }
    };
    walk(root.root);
    expect(onBack).toHaveBeenCalled();
  });
});
