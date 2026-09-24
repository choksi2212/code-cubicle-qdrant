package com.fieldedge.edge

import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * SecureStoreModule — Android-side bridge for `apps/mobile/src/services/tokenStore.ts`.
 *
 * Wraps AndroidX `EncryptedSharedPreferences` with a MasterKey that uses
 * AES256_GCM. Both keys and values are encrypted at rest with a key
 * stored in the Android Keystore, so reading the prefs file off-device
 * yields nothing readable.
 *
 * Surface (all `@ReactMethod`s are async — JS gets a Promise):
 *   - setItem(key: String, value: String): Promise<void>
 *   - getItem(key: String): Promise<String?>  (null when missing)
 *   - removeItem(key: String): Promise<void>
 *
 * We expose one shared prefs file (`fieldedge_secure.xml`) for both
 * access + refresh tokens. Adding more keys later is just more calls
 * to `prefs.edit().putString(...)` — no schema changes needed.
 */
class SecureStoreModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "SecureStore"
        private const val TAG = "SecureStore"
        private const val PREFS_FILE = "fieldedge_secure"
    }

    /**
     * Lazy-init the encrypted prefs. We don't build it in init {} so a
     * Keystore failure on first launch doesn't crash the whole app —
     * tokenStore.ts falls back to its in-memory shim in that case and
     * the user just has to log in again after a reboot.
     */
    private val prefs by lazy {
        try {
            val masterKey = MasterKey.Builder(reactContext)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                reactContext,
                PREFS_FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (e: Throwable) {
            android.util.Log.w(TAG, "EncryptedSharedPreferences init failed: ${e.message}")
            null
        }
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun setItem(key: String, value: String, promise: Promise) {
        try {
            val p = prefs
            if (p == null) {
                promise.reject("SECURE_STORE_UNAVAILABLE", "EncryptedSharedPreferences unavailable")
                return
            }
            p.edit().putString(key, value).apply()
            promise.resolve(null)
        } catch (e: Throwable) {
            promise.reject("SECURE_STORE_SET_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun getItem(key: String, promise: Promise) {
        try {
            val p = prefs
            if (p == null) {
                promise.resolve(null)
                return
            }
            promise.resolve(p.getString(key, null))
        } catch (e: Throwable) {
            promise.reject("SECURE_STORE_GET_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun removeItem(key: String, promise: Promise) {
        try {
            val p = prefs
            if (p == null) {
                promise.resolve(null)
                return
            }
            p.edit().remove(key).apply()
            promise.resolve(null)
        } catch (e: Throwable) {
            promise.reject("SECURE_STORE_REMOVE_FAILED", e.message, e)
        }
    }
}
