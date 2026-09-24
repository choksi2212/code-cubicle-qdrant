/**
 * Button — verifies that:
 *   - every variant (primary / secondary / ghost / danger) renders
 *     without crashing and applies its expected background colour
 *   - tapping the button fires onPress exactly once
 *   - loading state replaces the label with a spinner and swallows
 *     onPress
 *   - disabled state swallows onPress
 *   - leading/trailing icons render the requested Lucide name
 *   - fullWidth={false} drops the width:100% from the rendered style
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Button } from '../src/components/Button';
import { colors } from '../src/theme/tokens';

function findPressable(root: renderer.ReactTestRenderer['root']) {
  // Pressable's element is the named 'Pressable' our shim returns.
  return root.root.findByType('Pressable' as any);
}

describe('Button', () => {
  it('renders a primary button with the label and accent background', () => {
    const root = renderer.create(
      <Button label="Save" onPress={() => {}} variant="primary" />,
    );
    const json = JSON.stringify(root.toJSON());
    expect(json).toContain('Save');
    expect(json).toContain(colors.accent);
  });

  it('renders secondary / ghost / danger variants with distinct backgrounds', () => {
    const variants: Array<{
      variant: 'secondary' | 'ghost' | 'danger';
      expectColour: string;
    }> = [
      { variant: 'secondary', expectColour: colors.surface },
      { variant: 'ghost', expectColour: 'transparent' },
      { variant: 'danger', expectColour: colors.dangerSubtle },
    ];
    for (const { variant, expectColour } of variants) {
      const root = renderer.create(
        <Button label="Go" onPress={() => {}} variant={variant} />,
      );
      const json = JSON.stringify(root.toJSON());
      expect(json).toContain(expectColour);
    }
  });

  it('fires onPress when tapped', () => {
    const onPress = jest.fn();
    const root = renderer.create(
      <Button label="Tap" onPress={onPress} />,
    );
    const pressable = findPressable(root);
    act(() => {
      (pressable.props as any).onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('replaces the label with a spinner while loading and ignores onPress', () => {
    const onPress = jest.fn();
    const root = renderer.create(
      <Button label="Save" onPress={onPress} loading />,
    );
    const json = JSON.stringify(root.toJSON());
    expect(json).not.toContain('Save');
    expect(json).toContain('ActivityIndicator');
    const pressable = findPressable(root);
    // When loading, onPress is undefined (button is disabled).
    expect((pressable.props as any).disabled).toBe(true);
    expect((pressable.props as any).onPress).toBeUndefined();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('disables the press handler while disabled', () => {
    const onPress = jest.fn();
    const root = renderer.create(
      <Button label="Save" onPress={onPress} disabled />,
    );
    const pressable = findPressable(root);
    expect((pressable.props as any).disabled).toBe(true);
  });

  it('renders a leading icon and a trailing icon', () => {
    const root = renderer.create(
      <Button
        label="Sync"
        onPress={() => {}}
        leadingIcon="RefreshCw"
        trailingIcon="ChevronRight"
      />,
    );
    const json = JSON.stringify(root.toJSON());
    expect(json).toContain('RefreshCw');
    expect(json).toContain('ChevronRight');
  });

  it('drops the full-width rule when fullWidth is false', () => {
    const root = renderer.create(
      <Button label="Inline" onPress={() => {}} fullWidth={false} />,
    );
    const json = JSON.stringify(root.toJSON());
    expect(json).not.toContain('"width":"100%"');
  });
});
