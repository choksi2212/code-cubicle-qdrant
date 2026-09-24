/**
 * Tests for PhotoPreviewScreen.
 *
 * Verifies:
 *   - renders the loading state until fieldEdge.retrieve resolves
 *   - shows error if the photo is not found
 *   - shows the metadata card with all expected rows
 *   - shows the "JPEG missing" state when the on-disk file is gone
 *   - calls onClose when the back button is pressed
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('../src/native/fieldEdge', () => ({
  fieldEdge: {
    retrieve: jest.fn(async () => []),
  },
}));

jest.mock('../src/config', () => ({
  photoAbsPath: (_project: string, _device: string, photoId: string) => `/mock/photos/${photoId}.jpg`,
}));

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    exists: jest.fn(async () => true),
  },
}));

import { PhotoPreviewScreen } from '../src/screens/PhotoPreviewScreen';
import { fieldEdge } from '../src/native/fieldEdge';
import RNFS from 'react-native-fs';

const mockedFieldEdge = fieldEdge as jest.Mocked<typeof fieldEdge>;
const mockedExists = RNFS.exists as jest.MockedFunction<typeof RNFS.exists>;

function buildPayload(overrides: Partial<{
  photoId: string;
  lat: number | null;
  lng: number | null;
  gpsStatus: 'ok' | 'unavailable' | 'denied';
  embeddingStatus: 'ok' | 'pending' | 'failed';
  syncedAt: string | null;
}> = {}) {
  return {
    schema_version: 2,
    photo_id: overrides.photoId ?? 'photo-1',
    device_id: 'dev_test',
    captured_at: '2026-09-24T12:00:00Z',
    lat: overrides.lat ?? 12.34,
    lng: overrides.lng ?? 56.78,
    gps_status: overrides.gpsStatus ?? 'ok',
    project_id: 'river-study',
    file_path: 'river-study/dev_test/photo-1.jpg',
    embedding_status: overrides.embeddingStatus ?? 'ok',
    enrichment_id: null,
    enrichment_tags: [],
    enrichment_objects: [],
    enrichment_text: null,
    synced_at: overrides.syncedAt ?? null,
    local_updated_at: '2026-09-24T12:00:00Z',
    vector_checksum: 'sha256:abcdef1234567890',
    deletion_marker: false,
    project_owner: null,
    tags_v2: [],
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

describe('PhotoPreviewScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedExists.mockResolvedValue(true);
  });

  it('shows the loading state on first render', async () => {
    let resolveRetrieve: (value: unknown) => void = () => {};
    mockedFieldEdge.retrieve.mockReturnValueOnce(
      new Promise((r) => { resolveRetrieve = r; }) as any,
    );
    let root: renderer.ReactTestRenderer | null = null;
    await act(async () => {
      root = renderer.create(<PhotoPreviewScreen photoId="p1" onClose={() => {}} />);
    });
    const json = JSON.stringify(root!.toJSON());
    // Either loading spinner or empty tree — both are pre-data.
    expect(json).not.toContain('Photo ID');
    resolveRetrieve([]);
    await act(async () => {});
  });

  it('renders an error state when the photo is not found', async () => {
    mockedFieldEdge.retrieve.mockResolvedValueOnce([]);
    const root = await mountAndLoad(
      <PhotoPreviewScreen photoId="missing" onClose={() => {}} />,
    );
    expect(JSON.stringify(root.toJSON())).toContain('Photo not found in local shard');
  });

  it('renders the metadata card for an OK photo', async () => {
    mockedFieldEdge.retrieve.mockResolvedValueOnce([
      { id: 'p1', vector: [0.1], payload: buildPayload() as any },
    ]);
    const root = await mountAndLoad(
      <PhotoPreviewScreen photoId="p1" onClose={() => {}} />,
    );
    const json = JSON.stringify(root.toJSON());
    expect(json).toContain('Photo ID');
    expect(json).toContain('Captured');
    expect(json).toContain('GPS');
    expect(json).toContain('Project');
    expect(json).toContain('Device');
    expect(json).toContain('Embedding');
    expect(json).toContain('Checksum');
  });

  it('renders "Photo not on disk" state when the file is gone', async () => {
    mockedFieldEdge.retrieve.mockResolvedValueOnce([
      { id: 'p1', vector: [0.1], payload: buildPayload() as any },
    ]);
    mockedExists.mockResolvedValueOnce(false);
    const root = await mountAndLoad(
      <PhotoPreviewScreen photoId="p1" onClose={() => {}} />,
    );
    expect(JSON.stringify(root.toJSON())).toContain('Photo not on disk');
  });

  it('calls onClose when the back button is pressed', async () => {
    mockedFieldEdge.retrieve.mockResolvedValueOnce([
      { id: 'p1', vector: [0.1], payload: buildPayload() as any },
    ]);
    const onClose = jest.fn();
    const root = await mountAndLoad(
      <PhotoPreviewScreen photoId="p1" onClose={onClose} />,
    );
    // The Header's PressableScale wraps the chevron + "Back" Text. Walk the
    // tree and invoke the FIRST Pressable whose rendered tree contains
    // the literal "Back" — there is only one such Pressable in this screen.
    let pressed = false;
    const walk = (node: any) => {
      if (pressed) return;
      if (typeof node.props?.onPress === 'function') {
        let s = '';
        try {
          s = JSON.stringify(node.toJSON ? node.toJSON() : node);
        } catch {
          s = '';
        }
        // The header back button contains "Back"; the toolbar buttons
        // (disabled) have no onPress so the function check filters them out.
        if (s.includes('Back') && s.includes('ChevronLeft')) {
          act(() => node.props.onPress());
          pressed = true;
          return;
        }
      }
      const children = node.children || [];
      for (const child of children) {
        if (child && typeof child === 'object') walk(child);
      }
    };
    walk(root.root);
    expect(onClose).toHaveBeenCalled();
  });
});
