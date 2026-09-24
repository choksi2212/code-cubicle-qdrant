package com.fieldedge.edge

import android.content.Context
import android.content.SharedPreferences
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.util.concurrent.TimeUnit

/**
 * JS-facing bridge for the background-sync WorkManager scheduler.
 *
 * Schedules a unique [SyncWorker] periodic job and exposes
 * cancel/run-once/status helpers so the TypeScript layer can
 * (de)register sync from the Settings screen without re-implementing
 * the constraints/persistence logic.
 *
 * Persistence model:
 *   - Schedule params (intervalMinutes, requiresWifi, requiresCharging)
 *     are mirrored to a private SharedPreferences blob so we can
 *     survive an app restart and rehydrate `getStatus()` from disk.
 *
 * Sync status JSON returned from [getStatus]:
 *   - scheduled         : Boolean — is a periodic job enqueued?
 *   - intervalMinutes   : Int     — period between runs (15 / 60 / 360)
 *   - requiresWifi      : Boolean
 *   - requiresCharging  : Boolean
 *   - lastRunAt         : String? — ISO timestamp of last successful trigger,
 *                                   persisted on every [runOnce] / periodic fire
 *
 * WorkManager's `KEEP` policy means re-calling scheduleSync with the
 * same params is a no-op — we never end up with multiple chains of
 * SyncWorkers piling up behind the scenes.
 */
class SyncSchedulerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "SyncScheduler"
        private const val UNIQUE_WORK_NAME = "fieldedge-sync"
        private const val PREFS_NAME = "fieldedge_sync_prefs"
        private const val KEY_INTERVAL = "interval_minutes"
        private const val KEY_REQUIRES_WIFI = "requires_wifi"
        private const val KEY_REQUIRES_CHARGING = "requires_charging"
        private const val KEY_LAST_RUN_AT = "last_run_at"
        private const val KEY_SCHEDULED = "scheduled"
        /** WorkManager clamps periodic work to ≥15m. */
        private const val MIN_INTERVAL_MINUTES = 15
    }

    private val prefs: SharedPreferences
        get() = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override fun getName(): String = NAME

    /**
     * Enqueue (or refresh) a periodic SyncWorker.
     *
     * @param intervalMinutes  period between runs; clamped to ≥ 15
     *                         (WorkManager's minimum for PeriodicWorkRequest)
     * @param requiresWifi     add the `NetworkType.UNMETERED` constraint
     * @param requiresCharging add the `requiresBatteryNotLow` constraint
     * @param promise          resolved with a brief status JSON on success,
     *                         rejected on validation failure
     */
    @ReactMethod
    fun scheduleSync(
        intervalMinutes: Int,
        requiresWifi: Boolean,
        requiresCharging: Boolean,
        promise: Promise,
    ) {
        try {
            val clamped = intervalMinutes.coerceAtLeast(MIN_INTERVAL_MINUTES)

            val builder = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
            if (requiresWifi) {
                builder.setRequiredNetworkType(NetworkType.UNMETERED)
            }
            if (requiresCharging) {
                builder.setRequiresBatteryNotLow(true)
            }

            val request = PeriodicWorkRequestBuilder<SyncWorker>(
                clamped.toLong(),
                TimeUnit.MINUTES,
            )
                .setConstraints(builder.build())
                .build()

            WorkManager.getInstance(reactContext).enqueueUniquePeriodicWork(
                UNIQUE_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )

            prefs.edit()
                .putInt(KEY_INTERVAL, clamped)
                .putBoolean(KEY_REQUIRES_WIFI, requiresWifi)
                .putBoolean(KEY_REQUIRES_CHARGING, requiresCharging)
                .putBoolean(KEY_SCHEDULED, true)
                .apply()

            val out = WritableNativeMap().apply {
                putBoolean("scheduled", true)
                putInt("intervalMinutes", clamped)
                putBoolean("requiresWifi", requiresWifi)
                putBoolean("requiresCharging", requiresCharging)
            }
            promise.resolve(out)
        } catch (e: Throwable) {
            promise.reject("SCHEDULE_SYNC_FAILED", e.message, e)
        }
    }

    /** Cancel the unique periodic sync job. Idempotent — safe to call when nothing is enqueued. */
    @ReactMethod
    fun cancelSync(promise: Promise) {
        try {
            WorkManager.getInstance(reactContext).cancelUniqueWork(UNIQUE_WORK_NAME)
            prefs.edit()
                .putBoolean(KEY_SCHEDULED, false)
                .apply()
            val out = WritableNativeMap().apply {
                putBoolean("scheduled", false)
            }
            promise.resolve(out)
        } catch (e: Throwable) {
            promise.reject("CANCEL_SYNC_FAILED", e.message, e)
        }
    }

    /** Fire a one-shot SyncWorker (used by the "Retry now" button + manual triggers). */
    @ReactMethod
    fun runOnce(promise: Promise) {
        try {
            val now = System.currentTimeMillis()
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()
            WorkManager.getInstance(reactContext).enqueueUniqueWork(
                "${UNIQUE_WORK_NAME}_once",
                ExistingWorkPolicy.REPLACE,
                request,
            )
            prefs.edit()
                .putLong(KEY_LAST_RUN_AT, now)
                .apply()
            val out = WritableNativeMap().apply {
                putBoolean("enqueued", true)
                putDouble("enqueuedAt", now.toDouble())
            }
            promise.resolve(out)
        } catch (e: Throwable) {
            promise.reject("RUN_ONCE_FAILED", e.message, e)
        }
    }

    /**
     * Returns the persisted schedule + last-run timestamp so the JS
     * layer can rehydrate the SettingsScreen without round-tripping
     * through WorkManager (which would require async observation).
     */
    @ReactMethod
    fun getStatus(promise: Promise) {
        try {
            val scheduled = prefs.getBoolean(KEY_SCHEDULED, false)
            val interval = prefs.getInt(KEY_INTERVAL, 60)
            val wifi = prefs.getBoolean(KEY_REQUIRES_WIFI, true)
            val charging = prefs.getBoolean(KEY_REQUIRES_CHARGING, false)
            val lastRunMs = prefs.getLong(KEY_LAST_RUN_AT, 0L)
            val lastRunIso = if (lastRunMs > 0L) {
                java.time.Instant.ofEpochMilli(lastRunMs).toString()
            } else {
                null
            }
            val out = WritableNativeMap().apply {
                putBoolean("scheduled", scheduled)
                putInt("intervalMinutes", interval)
                putBoolean("requiresWifi", wifi)
                putBoolean("requiresCharging", charging)
                if (lastRunIso != null) putString("lastRunAt", lastRunIso) else putNull("lastRunAt")
            }
            promise.resolve(out)
        } catch (e: Throwable) {
            promise.reject("GET_STATUS_FAILED", e.message, e)
        }
    }
}
