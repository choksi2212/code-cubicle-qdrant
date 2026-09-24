package com.fieldedge.edge

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Registers the FieldEdge native module with React Native.
 *
 * Three modules are exposed through this package:
 *   - FieldEdgeRust   — UniFFI Kotlin bindings for the Rust core
 *   - OnnxClip        — ONNX Runtime wrapper for CLIP-ViT-B/32
 *   - SecureStore     — EncryptedSharedPreferences-backed KV for JWTs
 */
class FieldEdgePackage : BaseReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        return when (name) {
            "FieldEdgeRust" -> FieldEdgeRustModule(reactContext)
            "OnnxClip" -> OnnxClipModule(reactContext)
            "SecureStore" -> SecureStoreModule(reactContext)
            else -> null
        }
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                "FieldEdgeRust" to ReactModuleInfo(
                    "FieldEdgeRust",
                    FieldEdgeRustModule::class.java.name,
                    false,  // canOverrideExistingModule
                    false,  // needsEagerInit
                    false,  // isCxxModule
                    false,  // isTurboModule
                ),
                "OnnxClip" to ReactModuleInfo(
                    "OnnxClip",
                    OnnxClipModule::class.java.name,
                    false,
                    false,
                    false,
                    false,
                ),
                "SecureStore" to ReactModuleInfo(
                    "SecureStore",
                    SecureStoreModule::class.java.name,
                    false,
                    false,
                    false,
                    false,
                ),
            )
        }
    }
}

