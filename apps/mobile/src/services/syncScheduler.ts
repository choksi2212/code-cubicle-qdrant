/**
 * Foreground sync scheduler.
 *
 * Bridges between the JS layer and the Android `SyncSchedulerModule`
 * (which talks to WorkManager). On startup we hydrate from native
 * status so we know if a periodic job is already enqueued and start
 * an in-app `setInterval` so sync fires *while the user has the app
 * open* — WorkManager's periodic work can lag 15-60 minutes, which
 * is too slow for an active capture session.
 *
 * Lifecycle:
 *   - startSync(intervalMinutes, requiresWifi, requiresCharging)
 *       → native scheduleSync + start foreground timer
 *   - stopSync()
 *       → native cancelSync + clear foreground timer
 *   - runOnce()
 *       → native runOnce + immediately triggerSync() (skips the timer)
 *   - getStatus()
 *       → returns the native status blob
 *
 * The native broadcast (`com.fieldedge.SYNC_TRIGGER`) wakes us when
 * WorkManager fires — we forward it to `triggerSync()` so the JS-side
 * state machine stays consistent regardless of who initiated the run.
 */

import { NativeEventEmitter, NativeModules } from 'react-native';
import { useSyncStore } from '../stores/syncStore';

export type SyncInterval = 'manual' | '15m' | '1h' | '6h';

export interface SchedulerStatus {
  scheduled: boolean;
  intervalMinutes: number;
  requiresWifi: boolean;
  requiresCharging: boolean;
  lastRunAt: string | null;
}

interface NativeScheduler {
  scheduleSync(
    intervalMinutes: number,
    requiresWifi: boolean,
    requiresCharging: boolean,
  ): Promise<SchedulerStatus>;
  cancelSync(): Promise<{ scheduled: boolean }>;
  runOnce(): Promise<{ enqueued: boolean; enqueuedAt: number }>;
  getStatus(): Promise<SchedulerStatus>;
}

const SyncSchedulerModule: NativeScheduler | undefined =
  NativeModules.SyncScheduler as NativeScheduler | undefined;

// ─── In-app foreground timer ────────────────────────────────────────────

let foregroundTimer: ReturnType<typeof setInterval> | null = null;
let currentIntervalMs: number | null = null;

function intervalToMs(interval: SyncInterval): number | null {
  switch (interval) {
    case '15m':
      return 15 * 60_000;
    case '1h':
      return 60 * 60_000;
    case '6h':
      return 6 * 60 * 60_000;
    case 'manual':
      return null;
  }
}

function stopForegroundTimer(): void {
  if (foregroundTimer) {
    clearInterval(foregroundTimer);
    foregroundTimer = null;
  }
  currentIntervalMs = null;
}

function startForegroundTimer(interval: SyncInterval): void {
  stopForegroundTimer();
  const ms = intervalToMs(interval);
  if (ms == null) return;
  currentIntervalMs = ms;
  foregroundTimer = setInterval(() => {
    // Fire and forget — errors are surfaced via the syncStore's
    // status transitions and logged.
    useSyncStore
      .getState()
      .triggerSync()
      .catch((e) => console.warn('[syncScheduler] foreground sync failed:', String(e)));
  }, ms);
}

// ─── Wire the native broadcast to triggerSync ────────────────────────────

let emitterWired = false;
function ensureEmitter(): void {
  if (emitterWired) return;
  if (!SyncSchedulerModule) return;
  try {
    const emitter = new NativeEventEmitter(
      NativeModules.SyncScheduler as never,
    );
    // The exact event name matches ACTION_SYNC_TRIGGER in SyncWorker.kt.
    emitter.addListener('com.fieldedge.SYNC_TRIGGER', () => {
      useSyncStore
        .getState()
        .triggerSync()
        .catch((e) =>
          console.warn('[syncScheduler] WorkManager-triggered sync failed:', String(e)),
        );
    });
    emitterWired = true;
  } catch (_) {
    // Module not present (e.g. iOS or unit-test environment) — silently
    // skip; the in-app timer still works.
  }
}

// ─── Public API ──────────────────────────────────────────────────────────

export async function startSync(
  interval: SyncInterval,
  requiresWifi: boolean,
  requiresCharging: boolean,
): Promise<void> {
  ensureEmitter();
  if (interval === 'manual') {
    await stopSync();
    return;
  }
  const minutes =
    interval === '15m' ? 15 : interval === '1h' ? 60 : 360;
  if (SyncSchedulerModule) {
    try {
      await SyncSchedulerModule.scheduleSync(
        minutes,
        requiresWifi,
        requiresCharging,
      );
    } catch (e) {
      console.warn('[syncScheduler] native scheduleSync failed:', String(e));
    }
  }
  startForegroundTimer(interval);
}

export async function stopSync(): Promise<void> {
  stopForegroundTimer();
  if (SyncSchedulerModule) {
    try {
      await SyncSchedulerModule.cancelSync();
    } catch (e) {
      console.warn('[syncScheduler] native cancelSync failed:', String(e));
    }
  }
}

export async function runOnce(): Promise<void> {
  ensureEmitter();
  if (SyncSchedulerModule) {
    try {
      await SyncSchedulerModule.runOnce();
    } catch (e) {
      console.warn('[syncScheduler] native runOnce failed:', String(e));
    }
  }
  // Also fire locally — WorkManager's broadcast is async and the
  // user expects near-immediate feedback when they hit "Retry now".
  try {
    await useSyncStore.getState().triggerSync();
  } catch (e) {
    console.warn('[syncScheduler] local runOnce failed:', String(e));
  }
}

export async function getStatus(): Promise<SchedulerStatus | null> {
  if (!SyncSchedulerModule) return null;
  try {
    return await SyncSchedulerModule.getStatus();
  } catch (e) {
    console.warn('[syncScheduler] native getStatus failed:', String(e));
    return null;
  }
}

/** Hydrate the in-app timer from the persisted native schedule (call once at app boot). */
export async function hydrateFromNative(
  onInterval?: (interval: SyncInterval) => void,
): Promise<void> {
  ensureEmitter();
  const status = await getStatus();
  if (!status || !status.scheduled) return;
  const interval: SyncInterval =
    status.intervalMinutes <= 15
      ? '15m'
      : status.intervalMinutes <= 60
        ? '1h'
        : '6h';
  startForegroundTimer(interval);
  onInterval?.(interval);
}

/** Test-only — clear any timers set by the in-app scheduler without touching native state. */
export function _resetForTests(): void {
  stopForegroundTimer();
  emitterWired = false;
}

export const _internal = {
  intervalToMs,
  stopForegroundTimer,
  startForegroundTimer,
};
