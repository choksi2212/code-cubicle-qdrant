/**
 * Bare react-native shim for jest unit tests.
 *
 * capture.ts does `import { Platform } from 'react-native'`. Platform.OS
 * needs to exist so the early `if (Platform.OS !== 'android')` guard
 * doesn't throw when run under jest.
 */

module.exports = {
  Platform: {
    OS: 'android',
    Version: 0,
  },
  NativeModules: {},
};
