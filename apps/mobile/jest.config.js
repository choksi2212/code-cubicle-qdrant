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
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.tsx?$': ['babel-jest', { configFile: './babel.config.js' }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!react-native|@react-native|@react-native-async-storage|react-native-fs)/',
  ],
  // Tests mock RNFS, fieldEdge, location, clip, config explicitly — the
  // bare `react-native` import in capture.ts should still resolve to a
  // shim so the SyntaxError above doesn't fire.
  moduleNameMapper: {
    '^react-native$': '<rootDir>/__mocks__/react-native.js',
  },
};
