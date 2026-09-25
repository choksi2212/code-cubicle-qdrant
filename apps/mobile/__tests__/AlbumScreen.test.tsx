/**
 * Snapshot + behavior tests for AlbumScreen.
 *
 * Verifies:
 *   - renders the locked layout (header + sections)
 *   - groups photos into Today / Yesterday / This week / Older buckets
 *   - shows the empty state when the shard has no photos
 *   - calls onPhotoPress when a thumbnail is tapped
 */

import React from 'react';
import { safeStringify, findPressableWithText } from './helpers/testHelpers';
import renderer, { act, ReactTestInstance } from 'react-test-renderer';

jest.mock('../src/native/fieldEdge', () => ({
  fieldEdge: {
    retrieve: jest.fn(async () => []),
  },
}));

jest.mock('../src/config', () => ({
  photoFileUriFromRelative: (rel: string) => `file:///mock/${rel}`,
}));

import { AlbumScreen } from '../src/screens/AlbumScreen';
import { fieldEdge } from '../src/native/fieldEdge';

const mockedFieldEdge = fieldEdge as jest.Mocked<typeof fieldEdge>;

function buildPoint(overrides: Partial<{
  id: string;
  photoId: string;
  capturedAt: string;
  filePath: string;
  lat: number | null;
  lng: number | null;
}> = {}) {
  const now = new Date();
  const defaults = {
    id: overrides.id ?? 'p1',
    photoId: overrides.photoId ?? 'p1',
    capturedAt: overrides.capturedAt ?? now.toISOString(),
    filePath: overrides.filePath ?? 'proj/dev/p1.jpg',
    lat: overrides.lat ?? null,
    lng: overrides.lng ?? null,
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
      gps_status: 'ok' as const,
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

/**
 * Helper: mount the screen, let the async load() settle, and return the
 * react-test-renderer root. We need to call toJSON() AFTER the await
 * so the snapshot reflects the post-load tree.
 */
async function mountAndLoad(element: React.ReactElement) {
  let root: renderer.ReactTestRenderer | null = null;
  await act(async () => {
    root = renderer.create(element);
  });
  // One more act to drain any final micro-tasks (the useEffect's
  // promise chain).
  await act(async () => {});
  return root!;
}

describe('AlbumScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('matches the locked layout snapshot (empty shard)', async () => {
    mockedFieldEdge.retrieve.mockResolvedValueOnce([]);
    const root = await mountAndLoad(
      <AlbumScreen onBack={() => {}} onPhotoPress={() => {}} />,
    );
    expect(root.toJSON()).toMatchSnapshot();
  });

  it('matches the locked layout snapshot (populated shard)', async () => {
    // Pin timestamps so the snapshot stays stable across runs.
    const today = new Date('2026-09-24T12:00:00Z');
    const yesterday = new Date('2026-09-22T12:00:00Z');
    mockedFieldEdge.retrieve.mockResolvedValueOnce([
      buildPoint({ id: 'p1', photoId: 'p1', capturedAt: today.toISOString() }),
      buildPoint({
        id: 'p2',
        photoId: 'p2',
        capturedAt: yesterday.toISOString(),
      }),
    ]);
    const root = await mountAndLoad(
      <AlbumScreen onBack={() => {}} onPhotoPress={() => {}} />,
    );
    expect(root.toJSON()).toMatchSnapshot();
  });

  it('groups photos into Today / Yesterday / This week / Older buckets', async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    mockedFieldEdge.retrieve.mockResolvedValueOnce([
      buildPoint({ id: 'a', photoId: 'a', capturedAt: new Date(now - 1000).toISOString() }),
      buildPoint({ id: 'b', photoId: 'b', capturedAt: new Date(now - 60_000).toISOString() }),
      buildPoint({ id: 'c', photoId: 'c', capturedAt: new Date(now - 1 * day).toISOString() }),
      buildPoint({ id: 'd', photoId: 'd', capturedAt: new Date(now - 3 * day).toISOString() }),
      buildPoint({ id: 'e', photoId: 'e', capturedAt: new Date(now - 15 * day).toISOString() }),
      buildPoint({ id: 'f', photoId: 'f', capturedAt: new Date(now - 90 * day).toISOString() }),
    ]);
    const root = await mountAndLoad(
      <AlbumScreen onBack={() => {}} onPhotoPress={() => {}} />,
    );
    const json = safeStringify(root.toJSON());
    expect(json).toContain('Today');
    expect(json).toContain('Yesterday');
    expect(json).toContain('This week');
    expect(json).toContain('This month');
    expect(json).toContain('Older');
  });

  it('shows the empty state when the shard is empty', async () => {
    mockedFieldEdge.retrieve.mockResolvedValueOnce([]);
    const root = await mountAndLoad(
      <AlbumScreen onBack={() => {}} onPhotoPress={() => {}} />,
    );
    expect(safeStringify(root.toJSON())).toContain('No photos yet');
  });

  it('invokes onPhotoPress when a thumbnail cell is pressed', async () => {
    const onPhotoPress = jest.fn();
    const now = new Date().toISOString();
    mockedFieldEdge.retrieve.mockResolvedValueOnce([
      buildPoint({ id: 'p1', photoId: 'photo-abc', capturedAt: now }),
    ]);
    const root = await mountAndLoad(
      <AlbumScreen onBack={() => {}} onPhotoPress={onPhotoPress} />,
    );
    // Walk the tree without JSON.stringify (reanimated shared values make
    // toJSON() throw on circular refs). Look for any Pressable whose subtree
    // contains the photo id we rendered.
    const target = findPressableWithText(root.root, 'photo-abc');
    expect(target).not.toBeNull();
    act(() => target.props.onPress());
    expect(onPhotoPress).toHaveBeenCalledWith('photo-abc');
  });
});
