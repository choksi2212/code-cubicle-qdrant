/**
 * Icon — verifies that every documented icon name renders, that the
 * size token maps to a numeric pixel size, and that colour overrides
 * pass through to the underlying SVG.
 *
 * The lucide-react-native shim returns a real React element keyed by
 * the icon's displayName, so we assert on the JSON tree's `name` and
 * the `color` / `size` props.
 */

import React from 'react';
import renderer from 'react-test-renderer';
import { Icon } from '../src/components/Icon';
import { colors } from '../src/theme/tokens';

function nameOf(el: renderer.ReactTestRenderer['root']): string {
  const tree = el.toJSON();
  return JSON.stringify(tree);
}

describe('Icon', () => {
  it('renders a Camera icon with default size and colour', () => {
    const tree = renderer.create(<Icon name="Camera" />).toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('Camera');
    expect(json).toContain(`"size":20`); // md = 20px
    expect(json).toContain(colors.textPrimary);
  });

  it('maps the xs size to 14px', () => {
    const tree = renderer.create(<Icon name="Camera" size="xs" />).toJSON();
    expect(JSON.stringify(tree)).toContain('"size":14');
  });

  it('maps the xl size to 32px', () => {
    const tree = renderer.create(<Icon name="Camera" size="xl" />).toJSON();
    expect(JSON.stringify(tree)).toContain('"size":32');
  });

  it('passes through an explicit colour', () => {
    const tree = renderer
      .create(<Icon name="Check" color="#ff00ff" />)
      .toJSON();
    expect(JSON.stringify(tree)).toContain('#ff00ff');
  });

  it('passes through a custom strokeWidth', () => {
    const tree = renderer
      .create(<Icon name="Check" strokeWidth={3} />)
      .toJSON();
    expect(JSON.stringify(tree)).toContain('"strokeWidth":3');
  });

  it('renders every icon name documented in the Icon spec', () => {
    const names = [
      'Camera', 'RefreshCw', 'Settings', 'Sliders', 'SlidersHorizontal',
      'ChevronLeft', 'ChevronRight', 'ChevronDown', 'ChevronUp',
      'Search', 'Map', 'MapPin', 'Image', 'ImageOff', 'ImagePlus',
      'Folder', 'X', 'Check', 'AlertCircle', 'Plus', 'Minus',
      'Database', 'Lock', 'LogOut', 'Trash2', 'Info', 'Wifi', 'WifiOff',
      'Clock', 'Calendar', 'Hash',
      'Sparkles', 'Wand2', 'Layers', 'Grid3x3', 'Compass', 'Aperture',
      'Eye', 'Heart', 'Star', 'Bookmark', 'Share', 'Download', 'Upload',
      'Filter', 'Loader', 'CircleCheck', 'TriangleAlert', 'CircleX',
      'ArrowLeft', 'ArrowRight', 'Ellipsis', 'Smartphone', 'Shield',
      'Loader2', 'CheckCircle2', 'AlertTriangle', 'XCircle', 'MoreHorizontal',
    ];
    for (const name of names) {
      const tree = renderer.create(<Icon name={name as any} />).toJSON();
      expect(JSON.stringify(tree)).toContain(name);
    }
    // sanity: helper consumed
    expect(nameOf).toBeTruthy();
  });
});
