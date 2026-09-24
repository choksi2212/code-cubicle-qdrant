module.exports = {
  presets: ['@react-native/babel-preset'],
  plugins: [
    // Reanimated's babel plugin MUST be last. It rewrites worklets into
    // serialised strings so the UI thread can evaluate them; without
    // it, `useSharedValue`/`withTiming` calls throw at runtime.
    'react-native-reanimated/plugin',
  ],
};
