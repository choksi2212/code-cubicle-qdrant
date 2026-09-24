/**
 * Jest config — minimal setup for unit tests of pure-TS utilities.
 *
 * Uses babel-jest (already a dev dep) with the React Native babel preset
 * to compile TSX/TS on the fly. No React Native runtime; tests should
 * only import framework-agnostic modules under src/util/, src/config.ts,
 * etc. Anything that imports NativeModules must be mocked separately.
 */

module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts', '<rootDir>/__tests__/**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.tsx?$': ['babel-jest', { configFile: './babel.config.js' }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!react-native|@react-native|@react-native-async-storage|react-native-fs|react-native-reanimated|react-native-safe-area-context|lucide-react-native)/',
  ],
  // Tests mock RNFS, fieldEdge, location, clip, config explicitly — the
  // bare `react-native` import in capture.ts should still resolve to a
  // shim so the SyntaxError above doesn't fire. AsyncStorage is mocked
  // per-test (settingsStore.test.ts stubs an in-memory map) because the
  // package's bundled jest mock requires the jsdom env which we don't
  // pull in here.
  moduleNameMapper: {
    '^react-native$': '<rootDir>/__mocks__/react-native.js',
    '^react-native-reanimated$': '<rootDir>/__mocks__/react-native-reanimated.js',
    '^react-native-safe-area-context$': '<rootDir>/__mocks__/react-native-safe-area-context.js',
    '^lucide-react-native$': '<rootDir>/__mocks__/lucide-react-native.js',
  },
  testEnvironment: 'node',
};
