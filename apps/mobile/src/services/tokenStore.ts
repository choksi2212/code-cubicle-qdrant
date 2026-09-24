/**
 * tokenStore — read/write the JWT pair to Android EncryptedSharedPreferences.
 *
 * Storage is delegated to a native module (`SecureStore`, see
 * `apps/mobile/android/.../SecureStoreModule.kt`) which wraps the
 * AndroidX `security-crypto` library's `EncryptedSharedPreferences`
 * with `MasterKey.Builder(...).setKeyScheme(AES256_GCM)`.
 *
 * This module is platform-aware: on Android it round-trips through the
 * native bridge. On other platforms (jest unit tests, web) it falls
 * back to an in-memory map so screens and tests can run without the
 * native module installed.
 */

import { NativeModules } from 'react-native';

export interface TokenPair {
  access: string;
  refresh: string;
}

interface SecureStoreNative {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
}

const ACCESS_KEY = '@fieldedge/access_token';
const REFRESH_KEY = '@fieldedge/refresh_token';

// On Android the native module is registered by FieldEdgePackage.kt.
// In jest tests / non-android environments we shim with an in-memory map
// so the screens under test can boot without a native bridge.
const native: SecureStoreNative | undefined =
  (NativeModules as Record<string, unknown>).SecureStore as
    | SecureStoreNative
    | undefined;

const memStore: Record<string, string> = {};

const fallback: SecureStoreNative = {
  setItem: async (k, v) => {
    memStore[k] = v;
  },
  getItem: async (k) => memStore[k] ?? null,
  removeItem: async (k) => {
    delete memStore[k];
  },
};

const store: SecureStoreNative = native ?? fallback;

export async function getTokens(): Promise<TokenPair | null> {
  const [access, refresh] = await Promise.all([
    store.getItem(ACCESS_KEY),
    store.getItem(REFRESH_KEY),
  ]);
  if (!access || !refresh) return null;
  return { access, refresh };
}

export async function setTokens(pair: TokenPair): Promise<void> {
  await Promise.all([
    store.setItem(ACCESS_KEY, pair.access),
    store.setItem(REFRESH_KEY, pair.refresh),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    store.removeItem(ACCESS_KEY),
    store.removeItem(REFRESH_KEY),
  ]);
}
