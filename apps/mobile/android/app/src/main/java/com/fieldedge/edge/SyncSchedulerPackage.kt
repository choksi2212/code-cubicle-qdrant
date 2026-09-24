package com.fieldedge.edge

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Registers the [SyncSchedulerModule] with React Native.
 *
 * Kept in its own package (separate from [FieldEdgePackage]) because
 * `FieldEdgePackage` is owned by the auth agent — they register
 * `SecureStoreModule` there. Splitting the packages lets both teams
 * land their changes in parallel without merge conflicts on the same
 * file. `MainApplication.kt` then needs to add *both* packages to
 * its `getPackages()` list — coordinate with the auth agent for that
 * wiring.
 */
class SyncSchedulerPackage : BaseReactPackage() {

    override fun getModule(
        name: String,
        reactContext: ReactApplicationContext,
    ): NativeModule? {
        return when (name) {
            SyncSchedulerModule.NAME -> SyncSchedulerModule(reactContext)
            else -> null
        }
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                SyncSchedulerModule.NAME to ReactModuleInfo(
                    SyncSchedulerModule.NAME,
                    SyncSchedulerModule::class.java.name,
                    false, // canOverrideExistingModule
                    false, // needsEagerInit
                    false, // isCxxModule
                    false, // isTurboModule
                ),
            )
        }
    }
}
