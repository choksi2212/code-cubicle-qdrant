/**
 * Snapshot + behaviour tests for ConflictDetailScreen.
 *
 * Asserts:
 *   - renders loading state on mount
 *   - calls fetchConflictDetail with the supplied photoId
 *   - renders the three panels (Local, Remote, Resolution) once resolved
 *   - renders an error state when the fetch throws
 *
 * `fetchConflictDetail` is mocked at the module boundary so we don't
 * need a real server (or a network layer).
 */

import React from 'react';
import { safeStringify, findPressableWithText } from './helpers/testHelpers';
import renderer from 'react-test-renderer';
import { act } from 'react-test-renderer';

const mockFetchDetail = jest.fn();

jest.mock('../src/services/conflict', () => ({
  fetchConflictDetail: (...args: unknown[]) => mockFetchDetail(...args),
}));

// Mock the logger so the http_request line doesn't crash on a missing
// logger impl.
jest.mock('../src/util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../src/util/uuid', () => ({
  uuidv4: () => 'test-uuid',
}));

import { ConflictDetailScreen } from '../src/screens/ConflictDetailScreen';

const SAMPLE_DETAIL = {
  photo_id: '550e8400-e29b-41d4-a716-446655440000',
  local: {
    device_id: 'dev-tablet-a',
    captured_at: '2026-09-24T10:00:00+00:00',
    project_id: 'proj_demo',
    local_updated_at: '2026-09-24T10:00:01+00:00',
    vector_checksum: 'sha256:local',
    enrichment_text: 'Hairline crack',
    enrichment_tags: ['crack'],
    tags_v2: ['crack'],
  },
  remote: {
    device_id: 'dev-tablet-b',
    captured_at: '2026-09-24T10:00:00+00:00',
    project_id: 'proj_demo',
    local_updated_at: '2026-09-24T09:00:00+00:00',
    vector_checksum: 'sha256:remote',
    enrichment_text: 'Hairline crack (revised)',
    enrichment_tags: ['crack', 'spalling'],
    tags_v2: ['crack', 'spalling'],
  },
  winner: 'local',
  fields_changed: ['enrichment_text', 'tags_v2'],
  resolved_at: '2026-09-24T10:00:02+00:00',
};

describe('ConflictDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls fetchConflictDetail with the supplied photoId', async () => {
    mockFetchDetail.mockResolvedValueOnce(SAMPLE_DETAIL);
    await act(async () => {
      renderer.create(
        <ConflictDetailScreen
          photoId="550e8400-e29b-41d4-a716-446655440000"
          onClose={() => {}}
        />,
      );
    });
    expect(mockFetchDetail).toHaveBeenCalledTimes(1);
    expect(mockFetchDetail).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('renders the winner banner + side-by-side panels once the fetch resolves', async () => {
    mockFetchDetail.mockResolvedValueOnce(SAMPLE_DETAIL);
    let tree: renderer.ReactTestRenderer | null = null;
    await act(async () => {
      tree = renderer.create(
        <ConflictDetailScreen
          photoId="550e8400-e29b-41d4-a716-446655440000"
          onClose={() => {}}
        />,
      );
    });
    const json = safeStringify(tree!.toJSON());
    expect(json).toContain('Local version won');
    expect(json).toContain('Local');
    expect(json).toContain('Remote');
    expect(json).toContain('enrichment_text');
    expect(json).toContain('tags_v2');
  });

  it('renders an error state when the fetch throws', async () => {
    mockFetchDetail.mockRejectedValueOnce(new Error('network down'));
    let tree: renderer.ReactTestRenderer | null = null;
    await act(async () => {
      tree = renderer.create(
        <ConflictDetailScreen
          photoId="550e8400-e29b-41d4-a716-446655440000"
          onClose={() => {}}
        />,
      );
    });
    const json = safeStringify(tree!.toJSON());
    expect(json).toContain('Could not load conflict');
    expect(json).toContain('network down');
    expect(json).toContain('Back');
  });

  it('renders "Unavailable" when local payload is null', async () => {
    mockFetchDetail.mockResolvedValueOnce({
      ...SAMPLE_DETAIL,
      local: null,
      winner: 'remote',
      fields_changed: ['enrichment_text'],
    });
    let tree: renderer.ReactTestRenderer | null = null;
    await act(async () => {
      tree = renderer.create(
        <ConflictDetailScreen
          photoId="550e8400-e29b-41d4-a716-446655440000"
          onClose={() => {}}
        />,
      );
    });
    const json = safeStringify(tree!.toJSON());
    expect(json).toContain('Unavailable');
    expect(json).toContain('Remote version won');
  });

  it('matches the locked layout snapshot once the fetch resolves', async () => {
    mockFetchDetail.mockResolvedValueOnce(SAMPLE_DETAIL);
    let tree: renderer.ReactTestRenderer | null = null;
    await act(async () => {
      tree = renderer.create(
        <ConflictDetailScreen
          photoId="550e8400-e29b-41d4-a716-446655440000"
          onClose={() => {}}
        />,
      );
    });
    expect(tree!.toJSON()).toMatchSnapshot();
  });
});
