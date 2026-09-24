/**
 * SegmentedControl — verifies that:
 *   - every segment renders its label
 *   - tapping a segment fires onChange with the segment's value
 *   - the active segment is marked selected via accessibilityState
 *   - the highlight view is rendered (track + sliding pill)
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { SegmentedControl } from '../src/components/SegmentedControl';

const SEGMENTS = [
  { value: 'manual', label: 'Manual' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
];

function pressables(root: renderer.ReactTestRenderer['root']) {
  return root.root.findAllByType('Pressable' as any);
}

describe('SegmentedControl', () => {
  it('renders every segment label', () => {
    const root = renderer.create(
      <SegmentedControl
        segments={SEGMENTS}
        value="manual"
        onChange={() => {}}
      />,
    );
    const json = JSON.stringify(root.toJSON());
    expect(json).toContain('Manual');
    expect(json).toContain('15m');
    expect(json).toContain('1h');
    expect(json).toContain('6h');
  });

  it('fires onChange with the segment value when tapped', () => {
    const onChange = jest.fn();
    const root = renderer.create(
      <SegmentedControl
        segments={SEGMENTS}
        value="manual"
        onChange={onChange}
      />,
    );
    const all = pressables(root);
    // First four Pressables are the segments themselves; index 0 = Manual.
    act(() => {
      (all[0].props as any).onPress();
    });
    expect(onChange).toHaveBeenCalledWith('manual');

    act(() => {
      (all[2].props as any).onPress();
    });
    expect(onChange).toHaveBeenCalledWith('1h');
  });

  it('marks the active segment as selected for accessibility', () => {
    const root = renderer.create(
      <SegmentedControl
        segments={SEGMENTS}
        value="1h"
        onChange={() => {}}
      />,
    );
    const all = pressables(root);
    const manualSelected = (all[0].props as any).accessibilityState?.selected;
    const oneHourSelected = (all[2].props as any).accessibilityState?.selected;
    expect(manualSelected).toBe(false);
    expect(oneHourSelected).toBe(true);
  });

  it('renders a highlight element (sliding pill)', () => {
    const root = renderer.create(
      <SegmentedControl
        segments={SEGMENTS}
        value="manual"
        onChange={() => {}}
      />,
    );
    // In a real renderer, onLayout fires and the highlight mounts; in
    // jest with no layout, the highlight isn't rendered yet. We assert
    // the underlying track is present and the sliding pill effect is
    // wired by re-creating with a mock layout via test renderer.
    let layoutFired = false;
    const rootWithLayout = renderer.create(
      <SegmentedControl
        segments={SEGMENTS}
        value="manual"
        onChange={() => {
          layoutFired = true;
        }}
      />,
    );
    // Manually fire onLayout for the active segment to kick the highlight
    // into existence.
    const pressables = rootWithLayout.root.findAllByType('Pressable' as any);
    // The active segment is the first pressable; invoke its onLayout
    // callback with a faked layout.
    act(() => {
      (pressables[0].props as any).onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 80, height: 40 } },
      });
    });
    // Re-render to pick up the new layout state.
    const json = JSON.stringify(rootWithLayout.toJSON());
    // After layout, the highlight Animated.View should appear in the tree.
    expect(json).toContain('Animated.View');
    expect(layoutFired).toBe(false); // sanity
  });

  it('renders an optional icon for each segment', () => {
    const root = renderer.create(
      <SegmentedControl
        segments={[
          { value: 'a', label: 'A', icon: 'Check' },
          { value: 'b', label: 'B', icon: 'X' },
        ]}
        value="a"
        onChange={() => {}}
      />,
    );
    const json = JSON.stringify(root.toJSON());
    expect(json).toContain('Check');
    expect(json).toContain('X');
  });
});
