const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

module.exports = mergeConfig(defaultConfig, {
  // Custom transformer for ONNX models, etc.
  resolver: {
    assetExts: ['png', 'jpg', 'jpeg', 'onnx', 'bin'],
  },
});
