//! Structured JSON logging for the FieldEdge Rust core.
//!
//! Android logcat captures anything written to stderr, so we emit one JSON
//! object per line to stderr. The line shape mirrors the rest of the
//! stack — `{ts, level, msg, request_id, ...kv}` — so log shippers can
//! stitch the device trace to the server trace by request_id.
//!
//! No external crate needed: `serde_json` and `chrono` are already in the
//! dependency graph. We deliberately don't use the existing `tracing`
//! setup because we want the JSON shape to be byte-for-byte stable and
//! free of tracing's per-event formatting decisions. `tracing` stays
//! available for internal use; this is the boundary that crosses the
//! FFI.
//!
//! Levels: DEBUG < INFO < WARN < ERROR. Filtering is controlled by the
//! env var `LOG_LEVEL` (defaults to INFO).

use chrono::Utc;
use serde_json::{Map, Value};
use std::io::{self, Write};

const LEVELS: &[&str] = &["DEBUG", "INFO", "WARN", "ERROR"];

/// Returns true when a level string passes the LOG_LEVEL filter.
fn should_emit(level: &str) -> bool {
    let env = std::env::var("LOG_LEVEL").unwrap_or_else(|_| "INFO".to_string());
    let env_up = env.to_uppercase();
    let env_idx = LEVELS.iter().position(|l| *l == env_up).unwrap_or(1);
    let lvl_idx = LEVELS.iter().position(|l| *l == level.to_uppercase()).unwrap_or(1);
    lvl_idx >= env_idx
}

fn normalize_level(level: &str) -> &'static str {
    match level.to_uppercase().as_str() {
        "DEBUG" => "DEBUG",
        "WARN" | "WARNING" => "WARN",
        "ERROR" => "ERROR",
        _ => "INFO",
    }
}

/// Build the JSON payload that `log` will emit. Exposed so unit tests can
/// assert on the exact shape without depending on stderr capture, which
/// is unreliable on Windows.
fn build_payload(level: &str, msg: &str, kv: &[(&str, &str)]) -> Map<String, Value> {
    let ts = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut obj = Map::new();
    obj.insert("ts".into(), Value::String(ts));
    obj.insert("level".into(), Value::String(normalize_level(level).into()));
    obj.insert("msg".into(), Value::String(msg.to_string()));
    obj.insert("request_id".into(), Value::String("-".to_string()));
    for (k, v) in kv {
        obj.insert((*k).to_string(), Value::String((*v).to_string()));
    }
    obj
}

/// Emit a single JSON object describing one event to stderr.
///
/// `level` is case-insensitive; anything not in {DEBUG, INFO, WARN, ERROR}
/// is treated as INFO. `msg` is the human-readable line. `kv` is a slice
/// of (key, value) string pairs.
pub fn log(level: &str, msg: &str, kv: &[(&str, &str)]) {
    if !should_emit(level) {
        return;
    }
    let obj = build_payload(level, msg, kv);
    let line = match serde_json::to_string(&Value::Object(obj)) {
        Ok(s) => s,
        Err(_) => return, // never panic across FFI
    };
    let mut err = io::stderr().lock();
    let _ = writeln!(err, "{}", line);
    let _ = err.flush();
}

/// One-shot convenience for the common "fire and forget" case.
pub fn info(msg: &str) { log("INFO", msg, &[]); }
pub fn warn(msg: &str) { log("WARN", msg, &[]); }
pub fn error(msg: &str) { log("ERROR", msg, &[]); }
pub fn debug(msg: &str) { log("DEBUG", msg, &[]); }

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::sync::Mutex;

    // Tests that mutate process-wide LOG_LEVEL must hold this lock so they
    // don't race each other (cargo test runs in parallel by default).
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Required keys must always be present and correctly typed.
    #[test]
    fn payload_has_required_fields() {
        let obj = build_payload("INFO", "hello", &[("op", "sync.upload")]);
        let v = Value::Object(obj);
        assert_eq!(v["level"], "INFO");
        assert_eq!(v["msg"], "hello");
        assert_eq!(v["request_id"], "-");
        assert_eq!(v["op"], "sync.upload");
        assert!(v["ts"].is_string(), "ts must be ISO-8601 string");
        // ts must parse as a datetime.
        let ts_str = v["ts"].as_str().unwrap();
        chrono::DateTime::parse_from_rfc3339(ts_str).expect("ts must be RFC-3339");
    }

    #[test]
    fn payload_round_trips_as_valid_json() {
        let obj = build_payload(
            "DEBUG",
            "round-trip",
            &[("request_id", "abc-123"), ("device_id", "dev-7"), ("point_id", "p-9")],
        );
        let s = serde_json::to_string(&Value::Object(obj.clone())).unwrap();
        let parsed: Value = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed["request_id"], "abc-123");
        assert_eq!(parsed["device_id"], "dev-7");
        assert_eq!(parsed["point_id"], "p-9");
        assert_eq!(parsed["level"], "DEBUG");
        assert_eq!(parsed["msg"], "round-trip");
    }

    #[test]
    fn payload_default_request_id_is_dash() {
        let obj = build_payload("WARN", "no-rid", &[]);
        assert_eq!(obj["request_id"], "-");
    }

    #[test]
    fn normalize_level_is_case_insensitive() {
        assert_eq!(normalize_level("info"), "INFO");
        assert_eq!(normalize_level("Info"), "INFO");
        assert_eq!(normalize_level("WARN"), "WARN");
        assert_eq!(normalize_level("warning"), "WARN");
        assert_eq!(normalize_level("ERROR"), "ERROR");
        assert_eq!(normalize_level("bogus"), "INFO"); // unknown → INFO
    }

    #[test]
    fn should_emit_respects_log_level_env() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("LOG_LEVEL", "ERROR");
        assert!(!should_emit("DEBUG"));
        assert!(!should_emit("INFO"));
        assert!(!should_emit("WARN"));
        assert!(should_emit("ERROR"));
        std::env::remove_var("LOG_LEVEL");
    }

    #[test]
    fn should_emit_defaults_to_info() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        std::env::remove_var("LOG_LEVEL");
        assert!(should_emit("INFO"));
        assert!(should_emit("ERROR"));
        assert!(!should_emit("DEBUG"));
    }

    #[test]
    fn should_emit_lowercases_env() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("LOG_LEVEL", "warn");
        assert!(should_emit("ERROR"));
        assert!(should_emit("WARN"));
        assert!(!should_emit("INFO"));
        std::env::remove_var("LOG_LEVEL");
    }

    /// Calling log() must not panic even with pathological inputs.
    #[test]
    fn log_does_not_panic_on_garbage() {
        log("BOGUS_LEVEL", "msg with \x00 null and \n newline", &[]);
        log("", "", &[("", ""), ("key", "value")]);
    }

    #[test]
    fn log_emits_expected_keys_via_payload_builder() {
        // We don't try to capture stderr portably (Windows quirks); instead
        // we exercise the public builder to assert the shape, then call
        // log() once so it executes the writeln path against the real
        // stderr (best-effort, won't fail the test if it can't be read).
        let obj = build_payload(
            "INFO",
            "http request",
            &[("op", "sync.upload"), ("duration_ms", "123"), ("status", "200")],
        );
        let v = Value::Object(obj);
        for k in ["ts", "level", "msg", "request_id", "op", "duration_ms", "status"] {
            assert!(v.get(k).is_some(), "missing required key {k}");
        }
        log("INFO", "http request", &[("op", "sync.upload"), ("duration_ms", "123")]);
    }
}
