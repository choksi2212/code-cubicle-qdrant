/**
 * Bare react-native-reanimated shim for jest unit tests.
 *
 * Reanimated's worklets + native bridges can't run under jest's node env,
 * so we replace the API with simple stubs that return shared values whose
 * `.value` reads/writes are no-ops. Animations effectively resolve
 * synchronously, which is fine for testing component structure and
 * interaction handlers — we're not testing animation curves here.
 *
 * Tests that need to assert animation output should mock individual
 * shared values or run with the real reanimated runtime.
 */

const React = require('react');

const noopSharedValue = (initial) => {
  const obj = { value: initial };
  Object.defineProperty(obj, 'value', {
    configurable: true,
    enumerable: true,
    get() { return obj._v; },
    set(v) { obj._v = v; },
  });
  obj._v = initial;
  return obj;
};

const mkAnimatedComponent = (name) => (props) =>
  React.createElement(name, props, props.children);

const Animated = {
  View: mkAnimatedComponent('Animated.View'),
  Text: mkAnimatedComponent('Animated.Text'),
  ScrollView: mkAnimatedComponent('Animated.ScrollView'),
  createAnimatedComponent: (C) =>
    mkAnimatedComponent('Animated.' + (C.displayName || C.name || 'Component')),
};

module.exports = Object.assign({}, Animated, {
  useSharedValue: (v) => noopSharedValue(v),
  useDerivedValue: (fn) => noopSharedValue(fn()),
  useAnimatedStyle: (fn) => fn(),
  useAnimatedReaction: () => {},
  useAnimatedScrollHandler: (handlers) => {
    // Return a no-op handler that the ScrollView's onScroll can call.
    // Tests don't simulate scroll, so we just stash the handlers.
    const wrapped = () => {};
    wrapped.__handlers = handlers;
    return wrapped;
  },
  useAnimatedRef: () => ({ current: null }),
  withTiming: (v) => v,
  withSpring: (v) => v,
  withDelay: (_, v) => v,
  withSequence: (...vs) => vs[vs.length - 1],
  withRepeat: (v) => v,
  cancelAnimation: () => {},
  interpolate: (v) => v,
  Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
  Easing: {
    linear: () => 0,
    ease: () => 0,
    in: () => 0,
    out: () => 0,
    inOut: () => 0,
    bezier: () => 0,
  },
  runOnJS: (fn) => fn,
  runOnUI: (fn) => fn,
  Animated,
  default: Animated,
});
