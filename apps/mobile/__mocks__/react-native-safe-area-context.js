/**
 * Bare react-native-safe-area-context shim for jest unit tests.
 *
 * We can't read real insets under jest's node env. The shim returns
 * zeroes for the SafeAreaProvider's initial metrics so screens render
 * at full size, plus a useSafeAreaInsets() hook that always reports
 * zero insets. Tests don't depend on insets — they're asserting UI
 * structure, not layout.
 */

const React = require('react');

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

exports.SafeAreaProvider = function SafeAreaProvider({ children }) {
  return React.createElement(React.Fragment, null, children);
};

exports.SafeAreaView = function SafeAreaView(props) {
  return React.createElement('SafeAreaView', props, props.children);
};

exports.useSafeAreaInsets = () => insets;

exports.useSafeAreaFrame = () => ({
  x: 0,
  y: 0,
  width: 360,
  height: 800,
});

exports.SafeAreaInsetsContext = React.createContext({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

exports.SafeAreaFrameContext = React.createContext({
  x: 0,
  y: 0,
  width: 360,
  height: 800,
});

exports.initialWindowMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 800 },
  insets,
};
