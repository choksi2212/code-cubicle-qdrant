/**
 * Bare lucide-react-native shim for jest unit tests.
 *
 * lucide-react-native renders real <Svg> elements; jest has no native SVG
 * runtime. The shim returns a deterministic React element keyed by icon
 * name so tests can assert presence ("this screen uses the Camera icon")
 * without rendering pixels.
 *
 * Every name exposed by src/components/Icon.tsx must be listed here so
 * the shim stays in sync with the real wrapper. Aliases (CheckCircle2 →
 * CircleCheck, AlertTriangle → TriangleAlert, XCircle → CircleX,
 * Loader2 → Loader, MoreHorizontal → Ellipsis) are exported alongside
 * their canonical lucide names.
 */

const React = require('react');

const mkIcon = (name) => {
  const Icon = (props) =>
    React.createElement('Icon', { name, ...props }, props.children);
  Icon.displayName = name;
  return Icon;
};

const NAMES = [
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
  // Aliases that resolve to the same underlying icon
  'Loader2', 'CheckCircle2', 'AlertTriangle', 'XCircle', 'MoreHorizontal',
];

const exports_ = {};
for (const n of NAMES) exports_[n] = mkIcon(n);

module.exports = exports_;
module.exports.default = exports_;
