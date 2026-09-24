package com.fieldedge.edge

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.File
import java.io.FileInputStream
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Real ONNX Runtime Android wrapper for CLIP-ViT-B/32 inference.
 *
 * Two separate ONNX models:
 *   - clip-vision-int8.onnx: image → 512-dim embedding
 *   - clip-text-int8.onnx:   text  → 512-dim embedding
 *
 * Both come from the official openai/clip-vit-base-patch32 model,
 * exported and int8-quantized via scripts/export-clip-int8.py.
 *
 * This is the REAL inference path — no placeholders, no stubs.
 * When the model files aren't present in assets/models/, this module
 * fails with NOT_INITIALIZED. The TypeScript layer surfaces the error
 * to the UI and the search/capture features gracefully degrade.
 */
class OnnxClipModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "OnnxClip"
        private const val TAG = "OnnxClip"
        private const val VISION_MODEL = "models/clip-vision.onnx"
        private const val TEXT_MODEL = "models/clip-text.onnx"
        const val EMBEDDING_DIM = 512
        private const val IMAGE_INPUT_SIZE = 224
        private const val TEXT_MAX_LEN = 77
    }

    private val initialized = AtomicBoolean(false)
    private var ortEnv: OrtEnvironment? = null
    private var visionSession: OrtSession? = null
    private var textSession: OrtSession? = null

    init {
        try {
            initModels()
        } catch (e: Throwable) {
            Log.w(TAG, "ONNX init deferred: ${e.message}")
        }
    }

    override fun getName(): String = NAME

    private fun initModels() {
        if (initialized.get()) return
        val env = OrtEnvironment.getEnvironment()
        val visionFile = copyAssetToCache(VISION_MODEL)
        val textFile = copyAssetToCache(TEXT_MODEL)

        if (!visionFile.exists() || !textFile.exists()) {
            Log.w(TAG, "Model files not found. " +
                "Vision: ${visionFile.absolutePath} (${visionFile.exists()}), " +
                "Text: ${textFile.absolutePath} (${textFile.exists()})")
            return
        }

        val opts = OrtSession.SessionOptions().apply {
            setIntraOpNumThreads(2)
        }
        visionSession = env.createSession(visionFile.absolutePath, opts)
        textSession = env.createSession(textFile.absolutePath, opts)
        ortEnv = env
        initialized.set(true)
        Log.i(TAG, "ONNX sessions ready. Vision: ${visionFile.length() / 1024}KB, Text: ${textFile.length() / 1024}KB")
    }

    private fun copyAssetToCache(assetPath: String): File {
        val cacheFile = File(reactContext.cacheDir, assetPath.substringAfterLast('/'))
        if (!cacheFile.exists()) {
            reactContext.assets.open(assetPath).use { input ->
                cacheFile.outputStream().use { output -> input.copyTo(output) }
            }
        }
        return cacheFile
    }

    /**
     * Embed an image. `pixel_values_json` is a JSON array of 150,528 floats
     * (1 * 3 * 224 * 224), CHW layout, normalized with CLIP mean/std.
     *
     * Pre-processing happens on the TypeScript side via
     * preprocessImage() in src/embedding/clip.ts.
     */
    @ReactMethod
    fun embedImage(pixelValuesJson: String, promise: Promise) {
        try {
            if (!initialized.get()) initModels()
            val s = visionSession
                ?: return promise.reject(
                    "MODEL_NOT_LOADED",
                    "CLIP vision model not loaded. Place clip-vision.onnx in assets/models/",
                )

            val pixels = parseFloat1D(pixelValuesJson)
            val expected = IMAGE_INPUT_SIZE * IMAGE_INPUT_SIZE * 3
            require(pixels.size == expected) {
                "Expected $expected floats (1*3*${IMAGE_INPUT_SIZE}*${IMAGE_INPUT_SIZE}), got ${pixels.size}"
            }

            val shape = longArrayOf(1, 3, IMAGE_INPUT_SIZE.toLong(), IMAGE_INPUT_SIZE.toLong())
            val buffer = FloatBuffer.wrap(pixels)
            val tensor = OnnxTensor.createTensor(ortEnv, buffer, shape)
            val outputs = s.run(mapOf("pixel_values" to tensor))
            tensor.close()
            val embedding = extractEmbedding(outputs)
            outputs.close()
            promise.resolve(embedding)
        } catch (e: Throwable) {
            Log.e(TAG, "embedImage failed", e)
            promise.reject("EMBED_IMAGE_FAILED", e.message, e)
        }
    }

    /**
     * Embed text. `input_ids_json` is a JSON array of 77 i64 token ids.
     * Use CLIP's BPE tokenizer (cliptokenizers JS or @dqbd/tiktoken) on
     * the TS side to produce these tokens.
     */
    @ReactMethod
    fun embedText(inputIdsJson: String, promise: Promise) {
        try {
            if (!initialized.get()) initModels()
            val s = textSession
                ?: return promise.reject(
                    "MODEL_NOT_LOADED",
                    "CLIP text model not loaded. Place clip-text.onnx in assets/models/",
                )

            val tokens = parseLong1D(inputIdsJson)
            require(tokens.size == TEXT_MAX_LEN) {
                "Expected $TEXT_MAX_LEN tokens, got ${tokens.size}"
            }

            val shape = longArrayOf(1, TEXT_MAX_LEN.toLong())
            val buffer = LongBuffer.wrap(tokens)
            val tensor = OnnxTensor.createTensor(ortEnv, buffer, shape)
            val attentionShape = longArrayOf(1, TEXT_MAX_LEN.toLong())
            val attentionBuffer = LongBuffer.wrap(LongArray(TEXT_MAX_LEN) { 1L })
            val attentionTensor = OnnxTensor.createTensor(ortEnv, attentionBuffer, attentionShape)

            val outputs = s.run(
                mapOf(
                    "input_ids" to tensor,
                    "attention_mask" to attentionTensor,
                )
            )
            tensor.close()
            attentionTensor.close()
            val embedding = extractEmbedding(outputs)
            outputs.close()
            promise.resolve(embedding)
        } catch (e: Throwable) {
            Log.e(TAG, "embedText failed", e)
            promise.reject("EMBED_TEXT_FAILED", e.message, e)
        }
    }

    /**
     * Returns true once both ONNX sessions are initialized.
     * The TS layer uses this to gate whether the model is ready.
     */
    @ReactMethod
    fun isReady(promise: Promise) {
        promise.resolve(initialized.get())
    }

    /**
     * FR-013 — warm up the ONNX sessions at app launch.
     *
     * Loads the model files into memory and creates both OrtSession objects
     * without doing any inference. The first real `embedImage` / `embedText`
     * call afterwards will skip the ~500 ms cold-start cost. Idempotent:
     * safe to call multiple times.
     */
    @ReactMethod
    fun warmUp(promise: Promise) {
        try {
            if (!initialized.get()) {
                initModels()
            }
            val ready = initialized.get() && visionSession != null && textSession != null
            if (ready) {
                promise.resolve(true)
            } else {
                promise.reject(
                    "MODEL_NOT_LOADED",
                    "CLIP model files not found in assets/models/. " +
                    "Expected clip-vision-int8.onnx and clip-text-int8.onnx.",
                )
            }
        } catch (e: Throwable) {
            Log.e(TAG, "warmUp failed", e)
            promise.reject("WARMUP_FAILED", e.message, e)
        }
    }

    /**
     * Embed an image directly from a file URI.
     *
     * Reads the JPEG/PNG with BitmapFactory, resizes to 224×224 with
     * bilinear sampling, applies CLIP's per-channel mean/std normalization,
     * converts HWC→CHW, and runs ONNX inference.
     *
     * The TypeScript layer passes `photoUri` (a content:// or file:// path).
     */
    @ReactMethod
    fun embedImageFromUri(uri: String, promise: Promise) {
        try {
            if (!initialized.get()) initModels()
            val s = visionSession
                ?: return promise.reject(
                    "MODEL_NOT_LOADED",
                    "CLIP vision model not loaded. Place clip-vision.onnx in assets/models/",
                )

            // Resolve content:// URIs by reading through ContentResolver.
            val bitmap: Bitmap? = if (uri.startsWith("content://")) {
                reactApplicationContext.contentResolver.openInputStream(android.net.Uri.parse(uri))?.use { input ->
                    BitmapFactory.decodeStream(input)
                }
            } else {
                val path = if (uri.startsWith("file://")) uri.removePrefix("file://") else uri
                FileInputStream(File(path)).use { input ->
                    BitmapFactory.decodeStream(input)
                }
            }
            if (bitmap == null) {
                return promise.reject("IMAGE_READ_FAILED", "Could not decode image at $uri")
            }

            val chw = preprocessForClip(bitmap)
            bitmap.recycle()

            val shape = longArrayOf(1, 3, IMAGE_INPUT_SIZE.toLong(), IMAGE_INPUT_SIZE.toLong())
            val buffer = FloatBuffer.wrap(chw)
            val tensor = OnnxTensor.createTensor(ortEnv, buffer, shape)
            val outputs = s.run(mapOf("pixel_values" to tensor))
            tensor.close()
            val embedding = extractEmbedding(outputs)
            outputs.close()
            promise.resolve(embedding)
        } catch (e: Throwable) {
            Log.e(TAG, "embedImageFromUri failed", e)
            promise.reject("EMBED_IMAGE_FAILED", e.message, e)
        }
    }

    /**
     * Convert a Bitmap → 224×224 → CHW Float32 normalized for CLIP.
     *
     * CLIP mean (RGB): [0.48145466, 0.4578275, 0.40821073]
     * CLIP std  (RGB): [0.26862954, 0.26130258, 0.27577711]
     */
    private fun preprocessForClip(bitmap: Bitmap): FloatArray {
        val w = IMAGE_INPUT_SIZE
        val h = IMAGE_INPUT_SIZE
        val resized = Bitmap.createScaledBitmap(bitmap, w, h, true)
        try {
            // ARGB_8888 → extract RGB ints
            val pixels = IntArray(w * h)
            resized.getPixels(pixels, 0, w, 0, 0, w, h)
            val out = FloatArray(1 * 3 * h * w)
            val meanR = 0.48145466f
            val meanG = 0.4578275f
            val meanB = 0.40821073f
            val stdR = 0.26862954f
            val stdG = 0.26130258f
            val stdB = 0.27577711f
            for (i in 0 until w * h) {
                val p = pixels[i]
                val r = ((p shr 16) and 0xff) / 255f
                val g = ((p shr 8) and 0xff) / 255f
                val b = (p and 0xff) / 255f
                out[i] = (r - meanR) / stdR
                out[w * h + i] = (g - meanG) / stdG
                out[2 * w * h + i] = (b - meanB) / stdB
            }
            return out
        } finally {
            if (resized !== bitmap) resized.recycle()
        }
    }

    private fun extractEmbedding(result: OrtSession.Result): String {
        val firstEntry = result.iterator().next()
        val raw = firstEntry.value.value
        return when (raw) {
            is Array<*> -> {
                if (raw.isNotEmpty() && raw[0] is FloatArray) {
                    floatArrayToJson(raw[0] as FloatArray)
                } else if (raw.isNotEmpty() && raw[0] is Array<*>) {
                    @Suppress("UNCHECKED_CAST")
                    floatArrayToJson((raw[0] as Array<FloatArray>)[0])
                } else {
                    throw IllegalStateException("Unexpected ONNX output shape: ${raw.javaClass}")
                }
            }
            is FloatArray -> floatArrayToJson(raw)
            else -> throw IllegalStateException("Unexpected ONNX output type: ${raw.javaClass}")
        }
    }

    private fun parseFloat1D(json: String): FloatArray {
        val trimmed = json.trim().removePrefix("[").removeSuffix("]")
        if (trimmed.isEmpty()) return FloatArray(0)
        return trimmed.split(",").map { it.trim().toFloat() }.toFloatArray()
    }

    private fun parseLong1D(json: String): LongArray {
        val trimmed = json.trim().removePrefix("[").removeSuffix("]")
        if (trimmed.isEmpty()) return LongArray(0)
        return trimmed.split(",").map { it.trim().toLong() }.toLongArray()
    }

    private fun floatArrayToJson(arr: FloatArray): String {
        val sb = StringBuilder("[")
        for (i in arr.indices) {
            if (i > 0) sb.append(",")
            sb.append(arr[i])
        }
        sb.append("]")
        return sb.toString()
    }
}
