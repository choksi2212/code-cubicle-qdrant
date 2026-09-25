const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');
const fs = require('fs');

const defaultConfig = getDefaultConfig(__dirname);

// Workspace root is two levels up from apps/mobile. With pnpm hoisting
// + workspace mode, some packages (react-native-reanimated, etc.) live
// at the root node_modules but Metro resolves relative to its CWD.
//
// Reanimated's FlatList.tsx imports `react` via a relative path that
// Metro resolves to its symlinked pnpm store location — that's a
// DIFFERENT module instance from the one resolved by apps/mobile's own
// React import, which manifests as "Cannot read property 'useState'
// of null" at runtime because hooks run against one React instance
// while components are created by another.
//
// We force every `react` / `react-native` / `react-native-reanimated`
// import to resolve to a single canonical location via
// `resolveRequest`, so Metro treats them as a single module across the
// whole bundle.
const workspaceRoot = path.resolve(__dirname, '..', '..');
const localNodeModules = path.resolve(__dirname, 'node_modules');

function aliasResolve(context, moduleName, platform) {
  const aliasedModules = ['react', 'react-native', 'react-native-reanimated'];
  if (aliasedModules.includes(moduleName)) {
    try {
      const resolved = path.join(localNodeModules, moduleName);
      const pkgPath = path.join(resolved, 'package.json');
      if (fs.existsSync(pkgPath)) {
        return context.resolveRequest(context, resolved, platform);
      }
    } catch {
      // fall through to default resolution
    }
  }
  return context.resolveRequest(context, moduleName, platform);
}

module.exports = mergeConfig(defaultConfig, {
  resolver: {
    assetExts: ['png', 'jpg', 'jpeg', 'onnx', 'bin'],
    nodeModulesPaths: [
      localNodeModules,
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    resolveRequest: aliasResolve,
  },
  watchFolders: [workspaceRoot],
});
