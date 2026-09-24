/**
 * Bare lucide-react-native shim for jest unit tests.
 *
 * lucide-react-native renders real <Svg> elements; jest has no native SVG
 * runtime. The shim returns a deterministic React element keyed by icon
 * name so tests can assert presence ("this screen uses the Camera icon")
 * without rendering pixels.
 */

const React = require('react');

const mkIcon = (name) => {
  const Icon = (props) =>
    React.createElement('Icon', { name, ...props }, props.children);
  Icon.displayName = name;
  return Icon;
};

const NAMES = [
  'Camera', 'RefreshCw', 'Settings', 'Sliders', 'ChevronLeft', 'ChevronRight',
  'Search', 'Map', 'MapPin', 'Image', 'Folder', 'X', 'Check', 'AlertCircle',
  'Plus', 'Minus', 'Database', 'Lock', 'LogOut', 'Trash2', 'Info', 'Wifi',
  'WifiOff', 'Clock', 'Calendar', 'Hash',
];

const exports_ = {};
for (const n of NAMES) exports_[n] = mkIcon(n);

module.exports = exports_;
module.exports.default = exports_;
