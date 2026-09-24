/**
 * Bare react-native shim for jest unit tests.
 *
 * Two responsibilities:
 *   1. Provide the minimal surface (Platform, NativeModules) that
 *      framework-agnostic modules need so imports don't throw.
 *   2. Expose enough of the React Native component API that snapshot
 *      tests of UI screens can render via react-test-renderer.
 *
 * Components returned are real React elements with their RN name as
 * the type — that lets react-test-renderer produce a sensible tree
 * without trying to spin up the full RN renderer.
 */

const React = require('react');

const mk = (name) => (props) => React.createElement(name, props, props.children);

const AnimatedView = mk('Animated.View');
const AnimatedText = mk('Animated.Text');

module.exports = {
  Platform: {
    OS: 'android',
    Version: 0,
    select: (obj) => (obj && obj.android) || (obj && obj.default) || null,
  },
  NativeModules: {},
  Dimensions: {
    get: (_) => ({ width: 360, height: 800, scale: 1, fontScale: 1 }),
  },
  StyleSheet: {
    create: (obj) => obj,
    flatten: (s) => s || {},
    hairlineWidth: 1,
  },
  View: mk('View'),
  Text: mk('Text'),
  ScrollView: mk('ScrollView'),
  FlatList: mk('FlatList'),
  SectionList: mk('SectionList'),
  RefreshControl: mk('RefreshControl'),
  Pressable: mk('Pressable'),
  TextInput: mk('TextInput'),
  Image: mk('Image'),
  SafeAreaView: mk('SafeAreaView'),
  ActivityIndicator: mk('ActivityIndicator'),
  StatusBar: mk('StatusBar'),
  Switch: mk('Switch'),
  Animated: {
    View: AnimatedView,
    Text: AnimatedText,
    createAnimatedComponent: (C) => mk('Animated.' + (C.displayName || C.name || 'Component')),
    Value: class { constructor(v) { this.__value = v; } },
  },
  Vibration: {
    vibrate: jest.fn(),
  },
  Keyboard: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    removeListener: jest.fn(),
  },
  Alert: {
    alert: jest.fn(),
  },
  PermissionsAndroid: {
    PERMISSIONS: {
      CAMERA: 'android.permission.CAMERA',
      ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
    },
    RESULTS: {
      GRANTED: 'granted',
      DENIED: 'denied',
      NEVER_ASK_AGAIN: 'never_ask_again',
    },
    request: jest.fn(async () => 'granted'),
    requestMultiple: jest.fn(async () => ({
      'android.permission.CAMERA': 'granted',
      'android.permission.ACCESS_FINE_LOCATION': 'granted',
    })),
  },
};
