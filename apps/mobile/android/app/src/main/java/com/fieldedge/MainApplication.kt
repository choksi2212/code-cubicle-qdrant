package com.fieldedge

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.fieldedge.edge.FieldEdgePackage
import com.fieldedge.edge.SyncSchedulerPackage

class MainApplication : Application(), ReactApplication {

    override val reactNativeHost: ReactNativeHost =
        object : DefaultReactNativeHost(this) {
            override fun getPackages(): List<ReactPackage> {
                val packages = PackageList(this).packages
                // FieldEdgePackage owns SecureStoreModule (auth JWT) +
                // FieldEdgeRust + OnnxClip modules.
                packages.add(FieldEdgePackage())
                // SyncSchedulerPackage owns SyncSchedulerModule +
                // SyncWorker (WorkManager-based background sync).
                packages.add(SyncSchedulerPackage())
                return packages
            }

            override fun getJSMainModuleName(): String = "index"
            override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG
            override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
            override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
        }

    override val reactHost: ReactHost
        get() = getDefaultReactHost(applicationContext, reactNativeHost)

    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
            load()
        }
    }
}
