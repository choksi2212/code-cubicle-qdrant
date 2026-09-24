// MUST be the very first import — polyfills globalThis.crypto.getRandomValues
// before anything else (ULID library and our uuidv4() helper need it).
import 'react-native-get-random-values';

// Reanimated's runtime initialiser must be loaded before any code that
// uses `useSharedValue` / `withTiming` etc. so the global timer /
// worklet polyfills are installed before the first render.
import 'react-native-reanimated';

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
