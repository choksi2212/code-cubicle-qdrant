package com.fieldedge.edge

import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.File
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
