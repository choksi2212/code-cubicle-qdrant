/**
 * Tests for the reusable PhotoGrid component.
 *
 * Covers:
 *   - renders an empty state when given no photos
 *   - passes the photo list + renderItem to FlatList (with numColumns)
 *   - the per-cell renderItem handler invokes onPress(photoId)
 *   - invokes fieldEdge.retrieve when pull-to-refresh fires
 *   - honors numColumns override
 *
 * Note: the jest react-native shim treats FlatList as an inert element
 * (it doesn't iterate `data` + `renderItem`). We test the cell renderer
 * directly rather than going through FlatList's internal lifecycle.
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

import { PhotoGrid } from '../src/components/PhotoGrid';
import { fieldEdge } from '../src/native/fieldEdge';

const mockedFieldEdge = fieldEdge as jest.Mocked<typeof fieldEdge>;

const SAMPLE = [
  {
    photoId: 'p1',
    photoPath: 'proj/dev/p1.jpg',
    capturedAt: '2026-09-20T10:00:00Z',
    lat: 12.34,
    lng: 56.78,
  },
  {
    photoId: 'p2',
    photoPath: 'proj/dev/p2.jpg',
    capturedAt: '2026-09-20T11:00:00Z',
    lat: null,
    lng: null,
  },
];

describe('PhotoGrid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the empty state when given no photos', () => {
    const root = renderer.create(
      <PhotoGrid photos={[]} onPress={() => {}} />,
    );
    const tree = JSON.stringify(root.toJSON());
    expect(tree).toContain('No photos yet');
  });

  it('passes the photo list + 3 columns to FlatList by default', () => {
    const root = renderer.create(
      <PhotoGrid photos={SAMPLE} onPress={() => {}} />,
    );
    const fl = root.root.findByProps({ numColumns: 3 });
    expect(fl).toBeTruthy();
    expect((fl.props as any).data).toEqual(SAMPLE);
  });

  it('the renderItem output invokes onPress with the photoId', () => {
    const onPress = jest.fn();
    const root = renderer.create(
      <PhotoGrid photos={SAMPLE} onPress={onPress} />,
    );
    // Pull the renderItem fn off FlatList's props and invoke it as the
    // real FlatList would. The returned tree is a Pressable whose
    // onPress calls our handler.
    const fl = root.root.findByProps({ numColumns: 3 });
    const renderItem = (fl.props as any).renderItem;
    expect(typeof renderItem).toBe('function');
    const cellElement = renderItem({ item: SAMPLE[0] });
    const cellRenderer = renderer.create(cellElement);
    const pressable = cellRenderer.root.findByType('Pressable' as any);
    act(() => {
      (pressable.props as any).onPress();
    });
    expect(onPress).toHaveBeenCalledWith('p1');
  });

  it('re-queries the shard on pull-to-refresh', async () => {
    const onRefresh = jest.fn();
    const root = renderer.create(
      <PhotoGrid photos={SAMPLE} onPress={() => {}} onRefresh={onRefresh} />,
    );
    // RefreshControl is a prop on FlatList (the mock doesn't render it
    // as a child element). We pull it off FlatList's props directly.
    const fl = root.root.findByProps({ numColumns: 3 });
    const refresh = (fl.props as any).refreshControl;
    expect(refresh).toBeTruthy();
    expect((refresh as any).props.tintColor).toBe('#00BFA6');
    await act(async () => {
      await (refresh as any).props.onRefresh();
    });
    expect(mockedFieldEdge.retrieve).toHaveBeenCalledWith([]);
    expect(onRefresh).toHaveBeenCalled();
  });

  it('honors numColumns override', () => {
    const root = renderer.create(
      <PhotoGrid photos={SAMPLE} onPress={() => {}} numColumns={2} />,
    );
    // Debug: print all matches so we can see why .data is undefined.
    const matches = root.root.findAllByProps({ numColumns: 2 });
    expect(matches.length).toBeGreaterThan(0);
    // The FlatList we render carries both numColumns AND data. If
    // findByProps returned the right element, .data should be SAMPLE.
    const flatList = matches.find(
      (m: ReactTestInstance) => Array.isArray((m.props as any).data),
    );
    expect(flatList).toBeTruthy();
    expect((flatList!.props as any).numColumns).toBe(2);
    expect((flatList!.props as any).data).toEqual(SAMPLE);
  });
});
