package com.fieldedge.edge

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.Arguments
import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * FieldEdge Rust bridge — calls into libfield_edge_rust.so via dlsym.
 *
 * The Rust crate exports plain C-ABI functions that take C-strings and
 * return heap-allocated C-strings (free with fe_string_free). Kotlin
 * uses dlsym to look up the symbols at runtime — this sidesteps all the
 * JNI function-table / naming-mangling complexity and just works.
 */
class FieldEdgeRustModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "FieldEdgeRust"
        private const val TAG = "FieldEdgeRust"
        const val LIB_NAME = "field_edge_rust"

        init {
            System.loadLibrary(LIB_NAME)
        }
    }

    override fun getName(): String = NAME

    private val scope = CoroutineScope(Dispatchers.Main + kotlinx.coroutines.Job())

    init {
        Log.i(TAG, "FieldEdgeRust module ready (lib=$LIB_NAME loaded)")
    }

    // ─── dlsym wrappers ──────────────────────────────────────────────────────

    private fun lookup(name: String): Long {
        return NativeLoader.dlsym(name)
    }

    /** Calls a C-ABI function with 1 C-string argument, returns the JSON string. */
    private fun call1(symbol: String, a: String): String {
        return NativeLoader.call1(symbol, a)
    }

    private fun call2(symbol: String, a: String, b: String): String {
        return NativeLoader.call2(symbol, a, b)
    }

    private fun call0(symbol: String): String {
        return NativeLoader.call0(symbol)
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private fun readableMapToJson(map: ReadableMap?): String {
        if (map == null) return "{}"
        return try {
            val obj = JSONObject()
            val iter = map.keySetIterator()
            while (iter.hasNextKey()) {
                val key = iter.nextKey()
                obj.put(key, readableToJsonValue(map, key))
            }
            obj.toString()
        } catch (e: Throwable) {
            Log.w(TAG, "readableMapToJson failed: ${e.message}")
            "{}"
        }
    }

    private fun readableArrayToJson(arr: ReadableArray?): String {
        if (arr == null) return "[]"
        return try {
            val list = JSONArray()
            for (i in 0 until arr.size()) {
                list.put(readableArrayItemToJsonValue(arr, i))
            }
            list.toString()
        } catch (e: Throwable) {
            Log.w(TAG, "readableArrayToJson failed: ${e.message}")
            "[]"
        }
    }

    private fun readableToJsonValue(map: ReadableMap, key: String): Any? {
        return when (map.getType(key)) {
            ReadableType.Null -> JSONObject.NULL
            ReadableType.Boolean -> map.getBoolean(key)
            ReadableType.Number -> map.getDouble(key)
            ReadableType.String -> map.getString(key)
            ReadableType.Map -> JSONObject(readableMapToJson(map.getMap(key)))
            ReadableType.Array -> JSONArray(readableArrayToJson(map.getArray(key)))
        }
    }

    private fun readableArrayItemToJsonValue(arr: ReadableArray, idx: Int): Any? {
        return when (arr.getType(idx)) {
            ReadableType.Null -> JSONObject.NULL
            ReadableType.Boolean -> arr.getBoolean(idx)
            ReadableType.Number -> arr.getDouble(idx)
            ReadableType.String -> arr.getString(idx)
            ReadableType.Map -> JSONObject(readableMapToJson(arr.getMap(idx)))
            ReadableType.Array -> JSONArray(readableArrayToJson(arr.getArray(idx)))
        }
    }

    private fun jsonToWritableMap(json: String): WritableNativeMap {
        val map = WritableNativeMap()
        try {
            val obj = JSONObject(json)
            val keys = obj.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                putJsonValue(map, key, obj.get(key))
            }
        } catch (e: Throwable) {
            Log.w(TAG, "jsonToWritableMap failed: ${e.message}")
        }
        return map
    }

    private fun putJsonValue(map: WritableNativeMap, key: String, value: Any?) {
        when (value) {
            null, JSONObject.NULL -> map.putNull(key)
            is Boolean -> map.putBoolean(key, value)
            is Int -> map.putInt(key, value)
            is Long -> map.putDouble(key, value.toDouble())
            is Double -> map.putDouble(key, value)
            is Float -> map.putDouble(key, value.toDouble())
            is String -> map.putString(key, value)
            is JSONObject -> {
                val nested = WritableNativeMap()
                val keys = value.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    putJsonValue(nested, k, value.get(k))
                }
                map.putMap(key, nested)
            }
            is JSONArray -> {
                val arr = Arguments.createArray()
                for (i in 0 until value.length()) {
                    val item = value.get(i)
                    when (item) {
                        null -> arr.pushNull()
                        is Boolean -> arr.pushBoolean(item)
                        is Int -> arr.pushInt(item)
                        is Long -> arr.pushDouble(item.toDouble())
                        is Double -> arr.pushDouble(item)
                        is Float -> arr.pushDouble(item.toDouble())
                        is String -> arr.pushString(item)
                        is JSONObject -> {
                            val nestedMap = WritableNativeMap()
                            val keys = item.keys()
                            while (keys.hasNext()) {
                                val k = keys.next()
                                putJsonValue(nestedMap, k, item.get(k))
                            }
                            arr.pushMap(nestedMap)
                        }
                        is JSONArray -> {
                            val nestedArr = Arguments.createArray()
                            for (j in 0 until item.length()) {
                                val ni = item.get(j)
                                when (ni) {
                                    null -> nestedArr.pushNull()
                                    is Boolean -> nestedArr.pushBoolean(ni)
                                    is Int -> nestedArr.pushInt(ni)
                                    is Long -> nestedArr.pushDouble(ni.toDouble())
                                    is Double -> nestedArr.pushDouble(ni)
                                    is Float -> nestedArr.pushDouble(ni.toDouble())
                                    is String -> nestedArr.pushString(ni)
                                    else -> nestedArr.pushString(ni.toString())
                                }
                            }
                            arr.pushArray(nestedArr)
                        }
                        else -> arr.pushString(item.toString())
                    }
                }
                map.putArray(key, arr)
            }
            else -> map.putString(key, value.toString())
        }
    }

    private fun getShardDir(): String {
        val files = reactApplicationContext.filesDir
        val shard = java.io.File(files, "field_edge_shard")
        if (!shard.exists()) shard.mkdirs()
        return shard.absolutePath
    }

    private fun errorResponse(msg: String): String =
        """{"status":"err","code":"JNI_NULL","message":"$msg"}"""

    // ─── React-exposed methods ───────────────────────────────────────────────

    @ReactMethod
    fun openShard(config: ReadableMap, promise: Promise) {
        scope.launch {
            try {
                val directory = if (config.hasKey("directory")) config.getString("directory") ?: "" else ""
                val result = withContext(Dispatchers.IO) { call1("fe_open_shard", directory) }
                promise.resolve(jsonToWritableMap(result.ifEmpty { errorResponse("null result") }))
            } catch (e: Throwable) {
                promise.reject("EDGE_OPEN_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun upsertPoints(points: ReadableArray, promise: Promise) {
        scope.launch {
            try {
                val json = readableArrayToJson(points)
                val shardDir = getShardDir()
                val result = withContext(Dispatchers.IO) { call2("fe_upsert_points", shardDir, json) }
                promise.resolve(jsonToWritableMap(result.ifEmpty { errorResponse("null result") }))
            } catch (e: Throwable) {
                promise.reject("EDGE_UPSERT_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun query(request: ReadableMap, promise: Promise) {
        scope.launch {
            try {
                val json = readableMapToJson(request)
                val shardDir = getShardDir()
                val result = withContext(Dispatchers.IO) { call2("fe_query", shardDir, json) }
                promise.resolve(jsonToWritableMap(result.ifEmpty { errorResponse("null result") }))
            } catch (e: Throwable) {
                promise.reject("EDGE_QUERY_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun retrieve(ids: ReadableArray, promise: Promise) {
        scope.launch {
            try {
                val json = readableArrayToJson(ids)
                val shardDir = getShardDir()
                val result = withContext(Dispatchers.IO) { call2("fe_retrieve", shardDir, json) }
                promise.resolve(jsonToWritableMap(result.ifEmpty { errorResponse("null result") }))
            } catch (e: Throwable) {
                promise.reject("EDGE_RETRIEVE_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun deletePoints(ids: ReadableArray, promise: Promise) {
        scope.launch {
            try {
                val json = readableArrayToJson(ids)
                val shardDir = getShardDir()
                val result = withContext(Dispatchers.IO) { call2("fe_delete_points", shardDir, json) }
                promise.resolve(jsonToWritableMap(result.ifEmpty { errorResponse("null result") }))
            } catch (e: Throwable) {
                promise.reject("EDGE_DELETE_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun pointCount(promise: Promise) {
        scope.launch {
            try {
                val shardDir = getShardDir()
                val count = withContext(Dispatchers.IO) {
                    NativeLoader.callPointCount("fe_point_count", shardDir)
                }
                promise.resolve(count.toDouble())
            } catch (e: Throwable) {
                promise.reject("EDGE_COUNT_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun computeSyncDiff(localJson: String, remoteJson: String, promise: Promise) {
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { call2("fe_sync_diff", localJson, remoteJson) }
                promise.resolve(jsonToWritableMap(result.ifEmpty { errorResponse("null result") }))
            } catch (e: Throwable) {
                promise.reject("SYNC_DIFF_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun resolveConflict(localJson: String, remoteJson: String, promise: Promise) {
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { call2("fe_resolve_conflict", localJson, remoteJson) }
                promise.resolve(jsonToWritableMap(result.ifEmpty { errorResponse("null result") }))
            } catch (e: Throwable) {
                promise.reject("CONFLICT_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun checksum(vector: ReadableArray, promise: Promise) {
        scope.launch {
            try {
                val json = readableArrayToJson(vector)
                val result = withContext(Dispatchers.IO) { call1("fe_checksum", json) }
                promise.resolve(jsonToWritableMap(result.ifEmpty { errorResponse("null result") }))
            } catch (e: Throwable) {
                promise.reject("CHECKSUM_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun walAppend(walPath: String, entryJson: String, promise: Promise) {
        scope.launch {
            try {
                val hex: String = entryJson.toByteArray(Charsets.UTF_8).take(280).joinToString("") { "%02x".format(it) }
                Log.i(TAG, "walAppend entryJson (${entryJson.length} bytes): $hex")
                val result = withContext(Dispatchers.IO) { call2("fe_wal_append", walPath, entryJson) }
                promise.resolve(jsonToWritableMap(result.ifEmpty { errorResponse("null result") }))
            } catch (e: Throwable) {
                promise.reject("WAL_APPEND_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun walReadAll(walPath: String, promise: Promise) {
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { call1("fe_wal_read_all", walPath) }
                promise.resolve(jsonToWritableMap(result.ifEmpty { errorResponse("null result") }))
            } catch (e: Throwable) {
                promise.reject("WAL_READ_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun walClear(walPath: String, promise: Promise) {
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { call1("fe_wal_clear", walPath) }
                promise.resolve(jsonToWritableMap(result.ifEmpty { errorResponse("null result") }))
            } catch (e: Throwable) {
                promise.reject("WAL_CLEAR_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun version(promise: Promise) {
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { call0("fe_version") }
                promise.resolve(jsonToWritableMap(result.ifEmpty { errorResponse("null result") }))
            } catch (e: Throwable) {
                promise.reject("VERSION_FAILED", e.message, e)
            }
        }
    }

    /**
     * Create (or recreate) a 256-bit AES key in the Android Keystore
     * under `alias`. StrongBox is preferred when available so the key
     * bytes never leave the Secure Hardware. The key is NOT marked
     * extractable by default — that's a separate decision made by
     * `feKeyFromKeystore` (the field-evidence flow explicitly needs the
     * raw bytes to derive the WAL/shard subkeys via HKDF on the Rust
     * side, so we use `setIsStrongBoxBacked` for StrongBox and accept
     * that on non-StrongBox devices the bytes sit in TEE/TrustZone).
     *
     * Idempotent: if the alias already exists, this is a no-op and the
     * Promise resolves with `created: false`. To rotate, call
     * `feKeyDelete(alias)` first (not exposed yet — see
     * docs/09-ENCRYPTION.md).
     */
    @ReactMethod
    fun feKeyCreate(alias: String, promise: Promise) {
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                    if (ks.containsAlias(alias)) {
                        return@withContext """{"status":"ok","value":{"created":false,"alias":"$alias"}}"""
                    }
                    val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
                    val spec = KeyGenParameterSpec.Builder(
                        alias,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                    )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .setRandomizedEncryptionRequired(true)
                        .apply {
                            // StrongBox when available (Android 9+). Falls
                            // back to TEE on devices without a Secure
                            // Element.
                            try {
                                setIsStrongBoxBacked(true)
                            } catch (e: Throwable) {
                                Log.i(TAG, "StrongBox unavailable for $alias, using TEE: ${e.message}")
                            }
                        }
                        .build()
                    kg.init(spec)
                    kg.generateKey()
                    """{"status":"ok","value":{"created":true,"alias":"$alias"}}"""
                }
                promise.resolve(jsonToWritableMap(result))
            } catch (e: Throwable) {
                promise.reject("KEY_CREATE_FAILED", e.message, e)
            }
        }
    }

    /**
     * Fetch the raw bytes of a Keystore-resident AES key.
     *
     * The key must have been created via `feKeyCreate` first. Returns
     * a `WritableArray` of bytes (`Number`s in [0, 255]) that the caller
     * can pass to native code. On the Rust side these bytes are HKDF'd
     * into a per-context subkey — the raw Keystore bytes never appear
     * in plaintext on disk or in network payloads.
     */
    @ReactMethod
    fun feKeyFromKeystore(alias: String, promise: Promise) {
        scope.launch {
            try {
                val payload = withContext(Dispatchers.IO) {
                    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                    val secretKey = ks.getKey(alias, null) as? SecretKey
                        ?: throw IllegalStateException("Alias '$alias' missing or not a SecretKey")
                    val raw = secretKey.encoded
                        ?: throw IllegalStateException("Keystore key has no extractable bytes (setIsStrongBoxBacked must be true at creation)")
                    if (raw.isEmpty()) {
                        throw IllegalStateException("Keystore returned zero-length key for alias '$alias'")
                    }
                    raw
                }
                // Push the bytes into Rust's process-global key slot so
                // any later `fe_key_from_keystore_bytes` call (on the
                // native side) can read them synchronously.
                installKeystoreKeyNative(alias, payload)
                val out = WritableNativeArray()
                for (b in payload) {
                    out.pushInt(b.toInt() and 0xFF)
                }
                promise.resolve(out)
            } catch (e: Throwable) {
                Log.w(TAG, "feKeyFromKeystore failed for alias='$alias': ${e.message}")
                promise.reject("KEY_FROM_KEYSTORE_FAILED", e.message, e)
            }
        }
    }

    /** JNI shim — populates Rust's `INSTALLED_KEY` slot with raw key bytes. */
    private external fun installKeystoreKeyNative(alias: String, bytes: ByteArray): Boolean

    /**
     * Structured-log line. Forwarded to Android logcat under tag
     * "field_edge" so it's visible in `adb logcat | grep field_edge`.
     *
     * The Rust observability module (`packages/field-edge-rust/src/observability`)
     * emits the same JSON shape to stderr; logcat captures both, so
     * operators see one consistent stream regardless of whether the line
     * originated in Rust (WAL, sync, conflict) or Kotlin (this method).
     *
     * Signature:
     *   level:    "DEBUG" | "INFO" | "WARN" | "ERROR" (case-insensitive)
     *   msg:      human-readable line
     *   kv:       ReadableMap of {key: string} pairs (values are stringified)
     *
     * Returns a Promise so callers can `await` it from JS if they want
     * ordering. The Log.println call itself is synchronous and fast.
     */
    @ReactMethod
    fun log(level: String, msg: String, kv: ReadableMap?, promise: Promise) {
        try {
            val kvJson = readableMapToJson(kv)
            val androidLevel = when (level.uppercase()) {
                "DEBUG" -> Log.DEBUG
                "WARN", "WARNING" -> Log.WARN
                "ERROR" -> Log.ERROR
                else -> Log.INFO
            }
            // Inline JSON: { "level": "...", "msg": "...", "kv": {...} }.
            // msg is JSON-escaped so quotes/newlines survive logcat verbatim.
            Log.println(
                androidLevel,
                "field_edge",
                "{\"level\":\"${level.uppercase()}\",\"msg\":${jsonString(msg)},\"kv\":$kvJson}"
            )
            promise.resolve(true)
        } catch (e: Throwable) {
            promise.reject("LOG_FAILED", e.message, e)
        }
    }

    /** JSON-encode a string with proper escaping for inline log lines. */
    private fun jsonString(s: String): String {
        val sb = StringBuilder(s.length + 2)
        sb.append('"')
        for (c in s) {
            when (c) {
                '\\' -> sb.append("\\\\")
                '"' -> sb.append("\\\"")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\b' -> sb.append("\\b")
                '\u000c' -> sb.append("\\f")
                else -> if (c.code < 0x20) sb.append(String.format("\\u%04x", c.code)) else sb.append(c)
            }
        }
        sb.append('"')
        return sb.toString()
    }
}
