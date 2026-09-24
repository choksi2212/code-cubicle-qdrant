//! UniFFI-compatible exports — names match `uniffi/field_edge.udl`.
//!
//! All functions are FFI-safe: they take/return `String` (or raw C strings
//! via the C-ABI escape hatch). UniFFI generates Swift + Kotlin bindings
//! from the UDL that call into this code.

use crate::conflict;
use crate::crypto::checksum::vector_checksum;
use crate::edge::{open_shard as open_shard_impl, EdgeError, EdgeOps, Point, QueryRequest};
use crate::sync::diff::compute_sync_diff;
use crate::wal::log::{WalEntry, WalReader, WalWriter};
use std::fs::OpenOptions;
use std::path::Path;

// ─── Helpers ────────────────────────────────────────────────────────────────

fn map_err(e: EdgeError) -> String {
    format!(
        r#"{{"status":"err","code":"EDGE_ERROR","message":"{}"}}"#,
        e.to_string().replace('"', "'")
    )
}

fn err(code: &str, msg: &str) -> String {
    format!(
        r#"{{"status":"err","code":"{}","message":"{}"}}"#,
        code,
        msg.replace('"', "'")
    )
}

fn ok(value: serde_json::Value) -> String {
    serde_json::to_string(&value)
        .map(|s| format!(r#"{{"status":"ok","value":{}}}"#, s))
        .unwrap_or_else(|e| err("SERDE_ERROR", &e.to_string()))
}

fn ok_raw(value: impl serde::Serialize) -> String {
    serde_json::to_string(&value)
        .map(|s| format!(r#"{{"status":"ok","value":{}}}"#, s))
        .unwrap_or_else(|e| err("SERDE_ERROR", &e.to_string()))
}

// ─── Functions exposed to UniFFI ─────────────────────────────────────────────

/// Open or create a local edge shard.
pub fn open_shard(directory: String) -> String {
    match open_shard_impl(&directory) {
        Ok(_) => ok(serde_json::json!({"directory": directory, "status": "open"})),
        Err(e) => map_err(e),
    }
}

/// Upsert a batch of points (JSON).
pub fn upsert_points(shard_dir: String, points_json: String) -> String {
    let shard = match open_shard_impl(&shard_dir) {
        Ok(s) => s,
        Err(e) => return map_err(e),
    };

    let points: Vec<Point> = match serde_json::from_str(&points_json) {
        Ok(p) => p,
        Err(e) => return err("PARSE_ERROR", &e.to_string()),
    };

    let count = points.len();
    match shard.upsert(&points) {
        Ok(_) => ok(serde_json::json!({"upserted": count})),
        Err(e) => map_err(e),
    }
}

/// Query the local shard (JSON request → JSON results).
pub fn query(shard_dir: String, request_json: String) -> String {
    let shard = match open_shard_impl(&shard_dir) {
        Ok(s) => s,
        Err(e) => return map_err(e),
    };

    let req: QueryRequest = match serde_json::from_str(&request_json) {
        Ok(r) => r,
        Err(e) => return err("PARSE_ERROR", &e.to_string()),
    };

    match shard.query(&req) {
        Ok(hits) => ok_raw(hits),
        Err(e) => map_err(e),
    }
}

/// Retrieve points by ID.
pub fn retrieve(shard_dir: String, ids_json: String) -> String {
    let shard = match open_shard_impl(&shard_dir) {
        Ok(s) => s,
        Err(e) => return map_err(e),
    };

    let ids: Vec<String> = match serde_json::from_str(&ids_json) {
        Ok(v) => v,
        Err(e) => return err("PARSE_ERROR", &e.to_string()),
    };

    match shard.retrieve(&ids) {
        Ok(points) => ok_raw(points),
        Err(e) => map_err(e),
    }
}

/// Delete points by ID.
pub fn delete_points(shard_dir: String, ids_json: String) -> String {
    let shard = match open_shard_impl(&shard_dir) {
        Ok(s) => s,
        Err(e) => return map_err(e),
    };

    let ids: Vec<String> = match serde_json::from_str(&ids_json) {
        Ok(v) => v,
        Err(e) => return err("PARSE_ERROR", &e.to_string()),
    };

    match shard.delete(&ids) {
        Ok(_) => ok(serde_json::json!({"deleted": ids.len()})),
        Err(e) => map_err(e),
    }
}

/// Get the current point count.
pub fn point_count(shard_dir: String) -> i64 {
    match open_shard_impl(&shard_dir) {
        Ok(s) => s.len().unwrap_or(0) as i64,
        Err(_) => -1,
    }
}

/// Compute sync diff between local and remote state (JSON → JSON).
pub fn sync_diff(local_json: String, remote_json: String) -> String {
    match compute_sync_diff(&local_json, &remote_json) {
        Ok(diff) => ok_raw(diff),
        Err(e) => err("DIFF_ERROR", &e),
    }
}

/// Resolve a conflict (JSON → JSON).
pub fn resolve_conflict(local_json: String, remote_json: String) -> String {
    conflict::resolve_conflict_json(&local_json, &remote_json)
        .map(|s| format!(r#"{{"status":"ok","value":{}}}"#, s))
        .unwrap_or_else(|e| err("CONFLICT_ERROR", &e))
}

/// Compute SHA-256 checksum of a vector.
pub fn checksum(vector_json: String) -> String {
    let v: Vec<f32> = match serde_json::from_str(&vector_json) {
        Ok(v) => v,
        Err(e) => return err("PARSE_ERROR", &e.to_string()),
    };
    let cs = vector_checksum(&v);
    ok(serde_json::json!({ "checksum": cs }))
}

/// Append a WAL entry.
pub fn wal_append(wal_path: String, entry_json: String) -> String {
    let entry: WalEntry = match serde_json::from_str(&entry_json) {
        Ok(e) => e,
        Err(e) => {
            // Hex-dump first 320 bytes so we can see hidden chars (BOM, escapes).
            let hex: String = entry_json.bytes().take(320).map(|b| format!("{:02x}", b)).collect();
            return err(
                "PARSE_ERROR",
                &format!("line {} col {}: {} | len={} | hex={}",
                    e.line(), e.column(), e, entry_json.len(), hex),
            );
        }
    };

    let path = Path::new(&wal_path);
    let mut writer = match WalWriter::create(path) {
        Ok(w) => w,
        Err(e) => return err("WAL_ERROR", &e.to_string()),
    };

    match writer.append(&entry) {
        Ok(_) => ok(serde_json::json!({"seq": entry.seq})),
        Err(e) => err("WAL_ERROR", &e.to_string()),
    }
}

/// Read all WAL entries.
pub fn wal_read_all(wal_path: String) -> String {
    let path = Path::new(&wal_path);
    let reader = match WalReader::open(path) {
        Ok(r) => r,
        Err(e) => return err("WAL_ERROR", &e.to_string()),
    };

    let entries: Vec<_> = reader.filter_map(|r| r.ok()).collect();
    ok_raw(entries)
}

/// Truncate the WAL file (remove all entries).
///
/// Used by sync after a successful upload round so the WAL doesn't keep
/// re-uploading the same pending entries forever. The Rust shard still
/// holds the points; the sync API dedups re-uploads by ID.
pub fn wal_clear(wal_path: String) -> String {
    let path = Path::new(&wal_path);
    // fsync + truncate: preserves the file handle's position semantics so
    // a concurrent wal_append keeps appending after the clear.
    let result = OpenOptions::new()
        .write(true)
        .open(path)
        .and_then(|mut f| {
            let len = f.metadata()?.len();
            f.set_len(0)?;
            f.sync_data()?;
            Ok(len)
        });
    match result {
        Ok(removed_bytes) => ok(serde_json::json!({"cleared": true, "removed_bytes": removed_bytes})),
        Err(e) => err("WAL_ERROR", &e.to_string()),
    }
}

/// Get crate version + metadata.
pub fn version() -> String {
    ok(serde_json::json!({
        "crate": "field-edge-rust",
        "version": env!("CARGO_PKG_VERSION"),
        "rust_version": env!("CARGO_PKG_RUST_VERSION"),
        "features": {
            "edge": cfg!(feature = "qdrant-edge-active"),
            "default": true,
        }
    }))
}

// ─── Direct C-ABI exports ──────────────────────────────────────────────────
//
// These are JNI-callable from Kotlin/Android without going through the
// UniFFI metadata system. Each is a `#[no_mangle] extern "C"` wrapper that
// takes a C-string, calls the corresponding JSON function, and returns a
// heap-allocated C-string. Caller is responsible for freeing via
// `fe_string_free`.

/// Free a string returned by any `fe_*` function.
#[no_mangle]
pub extern "C" fn fe_string_free(s: *mut std::os::raw::c_char) {
    if !s.is_null() {
        unsafe {
            drop(std::ffi::CString::from_raw(s));
        }
    }
}

macro_rules! c_abi_export {
    ($name:ident, $func:path, $($arg:ident: $ty:ty),*) => {
        #[no_mangle]
        pub extern "C" fn $name($($arg: *const std::os::raw::c_char),*) -> *mut std::os::raw::c_char {
            // Decode all args from C strings
            $(
                let $arg = match unsafe { c_str_to_owned($arg) } {
                    Ok(s) => s,
                    Err(_) => return std::ptr::null_mut(),
                };
            )*
            let result = $func($($arg),*);
            std::ffi::CString::new(result)
                .map(|c| c.into_raw())
                .unwrap_or(std::ptr::null_mut())
        }
    };
}

unsafe fn c_str_to_owned(ptr: *const std::os::raw::c_char) -> Result<String, String> {
    if ptr.is_null() {
        Ok(String::new())
    } else {
        std::ffi::CStr::from_ptr(ptr)
            .to_str()
            .map(|s| s.to_string())
            .map_err(|e| e.to_string())
    }
}

// ─── Direct C-ABI exports (one per UDL function) ───────────────────────────

c_abi_export!(fe_open_shard, open_shard, dir: String);
c_abi_export!(fe_upsert_points, upsert_points, shard_dir: String, points_json: String);
c_abi_export!(fe_query, query, shard_dir: String, request_json: String);
c_abi_export!(fe_retrieve, retrieve, shard_dir: String, ids_json: String);
c_abi_export!(fe_delete_points, delete_points, shard_dir: String, ids_json: String);
c_abi_export!(fe_sync_diff, sync_diff, local_json: String, remote_json: String);
c_abi_export!(fe_resolve_conflict, resolve_conflict, local_json: String, remote_json: String);
c_abi_export!(fe_checksum, checksum, vector_json: String);
c_abi_export!(fe_wal_append, wal_append, wal_path: String, entry_json: String);
c_abi_export!(fe_wal_read_all, wal_read_all, wal_path: String);
c_abi_export!(fe_wal_clear, wal_clear, wal_path: String);

#[no_mangle]
pub extern "C" fn fe_version() -> *mut std::os::raw::c_char {
    let result = version();
    std::ffi::CString::new(result)
        .map(|c| c.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "C" fn fe_point_count(shard_dir: *const std::os::raw::c_char) -> i64 {
    let dir = match unsafe { c_str_to_owned(shard_dir) } {
        Ok(s) => s,
        Err(_) => return -1,
    };
    point_count(dir)
}

// ─── dlsym-based JNI helpers (called from NativeInvoke.java) ────────────────
//
// These are plain `extern "C"` functions that Kotlin's dlsym can call.
// No JNI naming convention needed — Kotlin looks them up by symbol name.

use std::sync::OnceLock;
use std::collections::HashMap;

static SYMBOL_CACHE: OnceLock<parking_lot::Mutex<HashMap<String, usize>>> = OnceLock::new();

fn symbol_cache() -> &'static parking_lot::Mutex<HashMap<String, usize>> {
    SYMBOL_CACHE.get_or_init(|| parking_lot::Mutex::new(HashMap::new()))
}

#[repr(C)]
struct DlInfo {
    dli_fname: *const std::os::raw::c_char,
    dli_fbase: *mut std::os::raw::c_void,
    dli_sname: *const std::os::raw::c_char,
    dli_saddr: *mut std::os::raw::c_void,
}

extern "C" {
    fn dlopen(filename: *const std::os::raw::c_char, flag: i32) -> *mut std::os::raw::c_void;
    fn dlsym(handle: *mut std::os::raw::c_void, name: *const std::os::raw::c_char) -> *mut std::os::raw::c_void;
    fn dlerror() -> *const std::os::raw::c_char;
}

const RTLD_NOW: i32 = 2;

unsafe fn dlsym_in_self(name: &str) -> *mut std::os::raw::c_void {
    // Check cache first
    {
        let cache = symbol_cache().lock();
        if let Some(&addr) = cache.get(name) {
            return addr as *mut std::os::raw::c_void;
        }
    }
    // dlsym on RTLD_DEFAULT (which is NULL on some platforms, but on Android
    // we need to dlopen the .so explicitly). The library is already loaded
    // (Kotlin loaded it via System.loadLibrary), so we can pass its handle.
    // The simplest reliable way on Android: pass NULL — dlsym(NULL, name) searches
    // the global symbol scope which includes already-loaded libraries.
    let c_name = std::ffi::CString::new(name).unwrap_or_else(|_| std::ffi::CString::new("").unwrap());
    let ptr = dlsym(std::ptr::null_mut(), c_name.as_ptr());
    if !ptr.is_null() {
        let mut cache = symbol_cache().lock();
        cache.insert(name.to_string(), ptr as usize);
    }
    ptr
}

#[no_mangle]
pub extern "C" fn fe_dlsym(name: *const std::os::raw::c_char) -> usize {
    let name = match unsafe { c_str_to_owned(name) } {
        Ok(s) => s,
        Err(_) => return 0,
    };
    unsafe { dlsym_in_self(&name) as usize }
}

/// Type for a 0-arg C function returning a C string.
type Fn0 = unsafe extern "C" fn() -> *mut std::os::raw::c_char;
/// Type for a 1-arg C function (`const char*`) returning a C string.
type Fn1 = unsafe extern "C" fn(*const std::os::raw::c_char) -> *mut std::os::raw::c_char;
/// Type for a 2-arg C function (`const char*, const char*`) returning a C string.
type Fn2 = unsafe extern "C" fn(*const std::os::raw::c_char, *const std::os::raw::c_char) -> *mut std::os::raw::c_char;
/// Type for a 1-arg C function (`const char*`) returning an i64.
type Fn1I64 = unsafe extern "C" fn(*const std::os::raw::c_char) -> i64;

unsafe fn take_c_string_result(ptr: *mut std::os::raw::c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let cstr = std::ffi::CStr::from_ptr(ptr);
    let s = cstr.to_str().unwrap_or("").to_string();
    fe_string_free(ptr);
    s
}

#[no_mangle]
pub extern "C" fn fe_invoke0(func_ptr: usize) -> *mut std::os::raw::c_char {
    unsafe {
        let f: Fn0 = std::mem::transmute(func_ptr);
        let result = f();
        // We don't transfer ownership back — caller (Kotlin) frees it via fe_string_free.
        result
    }
}

#[no_mangle]
pub extern "C" fn fe_invoke1(func_ptr: usize, a: *const std::os::raw::c_char) -> *mut std::os::raw::c_char {
    unsafe {
        let f: Fn1 = std::mem::transmute(func_ptr);
        let result = f(a);
        result
    }
}

#[no_mangle]
pub extern "C" fn fe_invoke2(
    func_ptr: usize,
    a: *const std::os::raw::c_char,
    b: *const std::os::raw::c_char,
) -> *mut std::os::raw::c_char {
    unsafe {
        let f: Fn2 = std::mem::transmute(func_ptr);
        let result = f(a, b);
        result
    }
}

#[no_mangle]
pub extern "C" fn fe_invoke1_i64(func_ptr: usize, a: *const std::os::raw::c_char) -> i64 {
    unsafe {
        let f: Fn1I64 = std::mem::transmute(func_ptr);
        let result = f(a);
        result
    }
}

// ─── JNI exports for NativeInvoke (Kotlin side) ────────────────────────────
//
// These implement the JNI native methods on `com.fieldedge.edge.NativeInvoke`.
// Each one takes a function pointer (looked up via fe_dlsym) and invokes it
// using the C-ABI shim functions above. This avoids all JNI function-table
// fiddling — we only use JNI to convert jstring ↔ char*.
//
// On Android, Kotlin's `external fun` for static methods produces symbols
// like `Java_<pkg>_<class>_<method>` (no extra class prefix for object/companion).

use jni::EnvUnowned;
use jni::objects::JString;
use jni::sys::jstring;

#[no_mangle]
pub extern "C" fn Java_com_fieldedge_edge_NativeInvoke_feDlsym(
    mut env: EnvUnowned<'_>,
    _cls: jni::objects::JClass,
    name: JString<'_>,
) -> i64 {
    let mut name_owned = String::new();
    let _ = env.with_env(|env| -> Result<(), jni::errors::Error> {
        name_owned = env.get_string(&name).map(|s| String::from(s.to_string())).unwrap_or_default();
        Ok(())
    });
    let c_name = std::ffi::CString::new(name_owned).unwrap_or_else(|_| std::ffi::CString::new("").unwrap());
    unsafe { fe_dlsym(c_name.as_ptr()) as i64 }
}

#[no_mangle]
pub extern "C" fn Java_com_fieldedge_edge_NativeInvoke_call0String(
    mut env: EnvUnowned<'_>,
    _cls: jni::objects::JClass,
    func_ptr: i64,
) -> jstring {
    let result_ptr = unsafe { fe_invoke0(func_ptr as usize) };
    let result = if result_ptr.is_null() {
        String::new()
    } else {
        let cstr = unsafe { std::ffi::CStr::from_ptr(result_ptr) };
        let owned = cstr.to_str().unwrap_or("").to_string();
        unsafe { fe_string_free(result_ptr); }
        owned
    };
    let mut out = std::ptr::null_mut();
    let _ = env.with_env(|env| -> Result<(), jni::errors::Error> {
        let jstr = env.new_string(&result)?;
        out = jstr.into_raw();
        Ok(())
    });
    out
}

#[no_mangle]
pub extern "C" fn Java_com_fieldedge_edge_NativeInvoke_call1String(
    mut env: EnvUnowned<'_>,
    _cls: jni::objects::JClass,
    func_ptr: i64,
    a: JString<'_>,
) -> jstring {
    let mut a_owned = String::new();
    let _ = env.with_env(|env| -> Result<(), jni::errors::Error> {
        a_owned = env.get_string(&a).map(|s| String::from(s.to_string())).unwrap_or_default();
        Ok(())
    });
    let c_a = std::ffi::CString::new(a_owned).unwrap_or_else(|_| std::ffi::CString::new("").unwrap());
    let result_ptr = unsafe { fe_invoke1(func_ptr as usize, c_a.as_ptr()) };
    let result = if result_ptr.is_null() {
        String::new()
    } else {
        let cstr = unsafe { std::ffi::CStr::from_ptr(result_ptr) };
        let owned = cstr.to_str().unwrap_or("").to_string();
        unsafe { fe_string_free(result_ptr); }
        owned
    };
    let mut out = std::ptr::null_mut();
    let _ = env.with_env(|env| -> Result<(), jni::errors::Error> {
        let jstr = env.new_string(&result)?;
        out = jstr.into_raw();
        Ok(())
    });
    out
}

#[no_mangle]
pub extern "C" fn Java_com_fieldedge_edge_NativeInvoke_call2String(
    mut env: EnvUnowned<'_>,
    _cls: jni::objects::JClass,
    func_ptr: i64,
    a: JString<'_>,
    b: JString<'_>,
) -> jstring {
    let mut a_owned = String::new();
    let mut b_owned = String::new();
    let _ = env.with_env(|env| -> Result<(), jni::errors::Error> {
        a_owned = env.get_string(&a).map(|s| String::from(s.to_string())).unwrap_or_default();
        b_owned = env.get_string(&b).map(|s| String::from(s.to_string())).unwrap_or_default();
        Ok(())
    });
    let c_a = std::ffi::CString::new(a_owned).unwrap_or_else(|_| std::ffi::CString::new("").unwrap());
    let c_b = std::ffi::CString::new(b_owned).unwrap_or_else(|_| std::ffi::CString::new("").unwrap());
    let result_ptr = unsafe { fe_invoke2(func_ptr as usize, c_a.as_ptr(), c_b.as_ptr()) };
    let result = if result_ptr.is_null() {
        String::new()
    } else {
        let cstr = unsafe { std::ffi::CStr::from_ptr(result_ptr) };
        let owned = cstr.to_str().unwrap_or("").to_string();
        unsafe { fe_string_free(result_ptr); }
        owned
    };
    let mut out = std::ptr::null_mut();
    let _ = env.with_env(|env| -> Result<(), jni::errors::Error> {
        let jstr = env.new_string(&result)?;
        out = jstr.into_raw();
        Ok(())
    });
    out
}

#[no_mangle]
pub extern "C" fn Java_com_fieldedge_edge_NativeInvoke_call1Long(
    mut _env: EnvUnowned<'_>,
    _cls: jni::objects::JClass,
    func_ptr: i64,
    a: JString<'_>,
) -> i64 {
    let mut a_owned = String::new();
    let _ = _env.with_env(|env| -> Result<(), jni::errors::Error> {
        a_owned = env.get_string(&a).map(|s| String::from(s.to_string())).unwrap_or_default();
        Ok(())
    });
    let c_a = std::ffi::CString::new(a_owned).unwrap_or_else(|_| std::ffi::CString::new("").unwrap());
    unsafe { fe_invoke1_i64(func_ptr as usize, c_a.as_ptr()) }
}
