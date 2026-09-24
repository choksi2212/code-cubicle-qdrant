/**
 * Icon — verifies that every documented icon name renders, that the
 * size token maps to a numeric pixel size, and that colour / strokeWidth
 * overrides pass through to the underlying SVG.
 *
 * The Icon component is a thin wrapper over react-native-svg primitives.
 * In jest, those primitives resolve to plain <Svg>/<Path> elements whose
 * JSON tree contains the width, height, stroke, and strokeWidth props.
 * We assert on those tree properties.
 */

import React from 'react';
import renderer from 'react-test-renderer';
import { Icon } from '../src/components/Icon';
import { colors } from '../src/theme/tokens';

describe('Icon', () => {
  it('renders a Camera icon with default size and colour', () => {
    const tree = renderer.create(<Icon name="Camera" />).toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('Camera');
    expect(json).toContain('"width":20'); // md = 20px
    expect(json).toContain('"height":20');
    expect(json).toContain(colors.textPrimary);
  });

  it('maps the xs size to 14px', () => {
    const tree = renderer.create(<Icon name="Camera" size="xs" />).toJSON();
    expect(JSON.stringify(tree)).toContain('"width":14');
    expect(JSON.stringify(tree)).toContain('"height":14');
  });

  it('maps the xl size to 32px', () => {
    const tree = renderer.create(<Icon name="Camera" size="xl" />).toJSON();
    expect(JSON.stringify(tree)).toContain('"width":32');
    expect(JSON.stringify(tree)).toContain('"height":32');
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

  it('renders every canonical icon name documented in the Icon spec', () => {
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
      'Power', 'HardDrive', 'Server',
    ];
    for (const name of names) {
      const tree = renderer.create(<Icon name={name as any} />).toJSON();
      expect(JSON.stringify(tree)).toContain(name);
    }
    // Aliases render their canonical counterpart — verify they're still
    // callable via the alias name without crashing.
    const aliases = ['Loader2', 'CheckCircle2', 'AlertTriangle', 'XCircle', 'MoreHorizontal'];
    for (const alias of aliases) {
      const tree = renderer.create(<Icon name={alias as any} />).toJSON();
      expect(tree).toBeTruthy();
    }
  });

  it('renders null for unknown icon names (no throw)', () => {
    const tree = renderer.create(<Icon name={'DoesNotExist' as any} />).toJSON();
    expect(tree).toBeNull();
  });
});
