package com.fieldedge.edge

import android.content.Context
import android.content.Intent
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf

/**
 * WorkManager worker that wakes the app up on a periodic schedule and
 * asks the JS side to perform a sync run.
 *
 * The actual sync logic lives in TypeScript (`useSyncStore.triggerSync`)
 * because it needs access to the WAL, the Rust shard, and the
 * HTTP client. The Worker is just a wake-up mechanism — it emits a
 * one-shot broadcast that `syncScheduler.ts` listens for and dispatches
 * into `triggerSync()`.
 *
 * Inputs (via [WorkRequest] InputData):
 *   - DEVICE_ID : String — the persisted ULID used as the Bearer token salt
 *   - TOKEN     : String? (optional) — only needed if we ever move auth
 *                 out of the JS layer; today the JS layer rebuilds it
 *                 from `getDeviceId()` on each sync.
 *
 * Constraints passed at schedule time:
 *   - NetworkType.CONNECTED   (always required)
 *   - requiresNetworkTypeWifi (only if user opted in via Settings)
 *   - requiresBatteryNotLow    (only if user opted in via Settings)
 *
 * Returns:
 *   - [Result.success] when the broadcast was sent
 *   - [Result.retry]   for transient failures (WorkManager will back off)
 *
 * JS receiver (see `syncScheduler.ts`):
 *   - Subscribes to `com.fieldedge.SYNC_TRIGGER` via `DeviceEventEmitter`
 *     and calls `useSyncStore.getState().triggerSync()`.
 */
class SyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    companion object {
        /** Broadcast action the JS `DeviceEventEmitter` listens for. */
        const val ACTION_SYNC_TRIGGER = "com.fieldedge.SYNC_TRIGGER"

        /** InputData key carrying the device ULID (purely informational — JS re-derives). */
        const val KEY_DEVICE_ID = "DEVICE_ID"
        /** InputData key carrying an optional pre-derived Bearer token. */
        const val KEY_TOKEN = "TOKEN"
    }

    override suspend fun doWork(): Result {
        return try {
            val ctx = applicationContext
            val deviceId = inputData.getString(KEY_DEVICE_ID)
            val token = inputData.getString(KEY_TOKEN)

            // Send the wake-up broadcast. The JS listener is wired in
            // syncScheduler.ts and calls triggerSync() which reads the
            // current device id from AsyncStorage.
            val intent = Intent(ACTION_SYNC_TRIGGER).apply {
                setPackage(ctx.packageName)
                if (deviceId != null) putExtra(KEY_DEVICE_ID, deviceId)
                if (token != null) putExtra(KEY_TOKEN, token)
            }
            ctx.sendBroadcast(intent)

            // Surface the data we shipped so WorkManager's diagnostics
            // page can show the device id + last attempt timestamp.
            val out = workDataOf(
                KEY_DEVICE_ID to (deviceId ?: ""),
                "LAST_TRIGGER_AT" to System.currentTimeMillis(),
            )
            Result.success(out)
        } catch (e: Throwable) {
            // Transient — let WorkManager back off and retry.
            Result.retry()
        }
    }
}
