/**
 * Thin JSON-structured logger for the FieldEdge mobile app.
 *
 * Every log line is a single JSON object. We log to `console.log` /
 * `console.warn` / `console.error` so React Native picks them up and
 * surfaces them in `adb logcat` (Android) and the Metro console.
 *
 * Required fields per the observability spec:
 *   { ts, level, msg, request_id, ...kv }
 *
 * `request_id` is threaded from `X-Request-ID` headers (api.ts attaches
 * one to every outbound request). It defaults to "-" when absent so
 * downstream log shippers always see the key.
 *
 * Levels filter via env (defaults to INFO). In production the bundler
 * strips DEBUG lines via `babel-plugin-transform-remove-console` only if
 * desired; for v1 we just rely on LOG_LEVEL.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVELS: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

const LEVEL_TO_CONSOLE: Record<LogLevel, 'log' | 'warn' | 'error'> = {
  DEBUG: 'log',
  INFO: 'log',
  WARN: 'warn',
  ERROR: 'error',
};

let CURRENT_LEVEL: LogLevel = 'INFO';
try {
  // process.env may not exist in some React Native contexts; guard it.
  const raw = (globalThis as any).process?.env?.LOG_LEVEL as string | undefined;
  if (raw && raw.toUpperCase() in LEVELS) {
    CURRENT_LEVEL = raw.toUpperCase() as LogLevel;
  }
} catch {
  // best-effort; default stays INFO
}

/** Test-only: override the current minimum level. */
export function _setLogLevel(level: LogLevel): void {
  CURRENT_LEVEL = level;
}

function nowIso(): string {
  // ISO-8601 UTC with millisecond precision, e.g. "2026-09-24T12:34:56.789Z".
  return new Date().toISOString();
}

function emit(level: LogLevel, msg: string, kv?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[CURRENT_LEVEL]) return;
  const payload: Record<string, unknown> = {
    ts: nowIso(),
    level,
    msg,
    request_id: '-',
    ...kv,
  };
  const line = JSON.stringify(payload);
  const fn = LEVEL_TO_CONSOLE[level];
  // eslint-disable-next-line no-console
  (console as any)[fn](line);
}

export const logger = {
  debug(msg: string, kv?: Record<string, unknown>): void {
    emit('DEBUG', msg, kv);
  },
  info(msg: string, kv?: Record<string, unknown>): void {
    emit('INFO', msg, kv);
  },
  warn(msg: string, kv?: Record<string, unknown>): void {
    emit('WARN', msg, kv);
  },
  error(msg: string, kv?: Record<string, unknown>): void {
    emit('ERROR', msg, kv);
  },
};

/**
 * Returns a new logger that re-emits the supplied `kv` on every call.
 * Mirrors the server-side `bind()` helper — useful inside a request
 * handler so request_id / device_id don't have to be threaded manually.
 */
export function bind(kv: Record<string, unknown>) {
  return {
    debug(msg: string, extra?: Record<string, unknown>): void {
      logger.debug(msg, { ...kv, ...extra });
    },
    info(msg: string, extra?: Record<string, unknown>): void {
      logger.info(msg, { ...kv, ...extra });
    },
    warn(msg: string, extra?: Record<string, unknown>): void {
      logger.warn(msg, { ...kv, ...extra });
    },
    error(msg: string, extra?: Record<string, unknown>): void {
      logger.error(msg, { ...kv, ...extra });
    },
  };
}
