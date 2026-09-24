/**
 * Snapshot + behavior tests for MapScreen.
 *
 * Verifies:
 *   - renders the locked layout (header + map canvas)
 *   - filters to geo-tagged captures only (drops gps_status != "ok")
 *   - shows the "No GPS coordinates captured yet" empty state when none
 *   - invokes the marker press handler with the photoId
 */

import React from 'react';
import renderer, { act, ReactTestInstance } from 'react-test-renderer';

jest.mock('../src/native/fieldEdge', () => ({
  fieldEdge: {
    retrieve: jest.fn(async () => []),
  },
}));

jest.mock('../src/config', () => ({
  photoFileUriFromRelative: (rel: string) => `file:///mock/${rel}`,
}));

import { MapScreen } from '../src/screens/MapScreen';
import { MapView } from '../src/components/MapView';
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

/**
 * Mount + let the async load() settle so the post-load tree is
 * serialized. See AlbumScreen.test.tsx for the same helper.
 */
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
    const root = await mountAndLoad(<MapScreen onBack={() => {}} />);
    expect(root.toJSON()).toMatchSnapshot();
  });

  it('matches the locked layout snapshot (populated with markers)', async () => {
    mockedFieldEdge.retrieve.mockResolvedValueOnce([
      buildPoint({
        id: 'p1',
        photoId: 'p1',
        lat: 12.34,
        lng: 56.78,
        capturedAt: '2026-09-24T12:00:00Z',
      }),
      buildPoint({
        id: 'p2',
        photoId: 'p2',
        lat: 12.36,
        lng: 56.80,
        capturedAt: '2026-08-20T12:00:00Z',
      }),
    ]);
    const root = await mountAndLoad(<MapScreen onBack={() => {}} />);
    expect(root.toJSON()).toMatchSnapshot();
  });

  it('filters out points with gps_status != "ok"', async () => {
    mockedFieldEdge.retrieve.mockResolvedValueOnce([
      buildPoint({
        id: 'p1',
        photoId: 'p1',
        lat: 12.34,
        lng: 56.78,
        gpsStatus: 'ok',
      }),
      buildPoint({
        id: 'p2',
        photoId: 'p2',
        lat: 12.36,
        lng: 56.80,
        gpsStatus: 'denied',
      }),
      buildPoint({
        id: 'p3',
        photoId: 'p3',
        lat: 12.40,
        lng: 56.90,
        gpsStatus: 'unavailable',
      }),
    ]);
    const root = await mountAndLoad(<MapScreen onBack={() => {}} />);
    const mapView = root.root.findByType(MapView);
    expect(mapView.props.markers.length).toBe(1);
    expect(mapView.props.markers[0].photoId).toBe('p1');
  });

  it('shows the "No GPS coordinates captured yet" empty state when no geo data', async () => {
    mockedFieldEdge.retrieve.mockResolvedValueOnce([
      buildPoint({ id: 'p1', photoId: 'p1', gpsStatus: 'denied' }),
    ]);
    const root = await mountAndLoad(<MapScreen onBack={() => {}} />);
    expect(JSON.stringify(root.toJSON())).toContain(
      'No GPS coordinates captured yet',
    );
  });

  it('invokes onMarkerPress via the MapView when a marker is tapped', async () => {
    // Patch Alert so the jsdom-less env doesn't blow up.
    const realAlert = (require('react-native').Alert as any).alert;
    (require('react-native').Alert as any).alert = jest.fn();

    mockedFieldEdge.retrieve.mockResolvedValueOnce([
      buildPoint({
        id: 'p1',
        photoId: 'photo-marker',
        lat: 12.34,
        lng: 56.78,
      }),
    ]);
    const root = await mountAndLoad(<MapScreen onBack={() => {}} />);
    const mapView = root.root.findByType(MapView);
    act(() => {
      (mapView.props as any).onMarkerPress('photo-marker');
    });
    expect((require('react-native').Alert as any).alert).toHaveBeenCalled();
    (require('react-native').Alert as any).alert = realAlert;
  });

  it('renders a Back button that calls onBack', async () => {
    mockedFieldEdge.retrieve.mockResolvedValueOnce([]);
    const onBack = jest.fn();
    const root = await mountAndLoad(<MapScreen onBack={onBack} />);
    // The Back text lives inside a Pressable. findByProps on the
    // Pressable is tricky with the mock, so walk down from a
    // Text with the back-string and bubble to its parent Pressable.
    const backText = root.root.findByProps({ children: '← Back' });
    expect(backText).toBeTruthy();
    const pressable = backText.parent;
    act(() => {
      (pressable.props as any).onPress();
    });
    expect(onBack).toHaveBeenCalled();
  });
});
