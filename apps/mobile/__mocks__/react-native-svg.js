/**
 * Bare react-native-svg shim for jest unit tests.
 *
 * react-native-svg renders real native <Svg> primitives; jest's node env
 * has no UI thread, so we replace each SVG component with a plain React
 * element that forwards props. The rendered JSON tree still contains
 * `width`, `height`, `stroke`, `strokeWidth`, etc. — enough for our
 * snapshot + assertion tests to validate the markup we produce.
 *
 * The Svg root preserves its name prop (we tag it with the icon's
 * accessibilityLabel) so tests can assert that a particular icon name
 * was rendered.
 */

const React = require('react');

const mk = (displayName) => {
  const C = (props) => React.createElement(displayName, props, props.children);
  C.displayName = displayName;
  return C;
};

const Svg = mk('Svg');
const Path = mk('Path');
const Circle = mk('Circle');
const Ellipse = mk('Ellipse');
const Line = mk('Line');
const Polyline = mk('Polyline');
const Polygon = mk('Polygon');
const Rect = mk('Rect');

module.exports = {
  __esModule: true,
  default: Svg,
  Svg,
  Path,
  Circle,
  Ellipse,
  Line,
  Polyline,
  Polygon,
  Rect,
};
