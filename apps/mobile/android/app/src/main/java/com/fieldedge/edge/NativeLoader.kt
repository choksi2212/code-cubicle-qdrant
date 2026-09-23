package com.fieldedge.edge

/**
 * Native helper — looks up C-ABI symbols from libfield_edge_rust.so via
 * the dynamic linker (dlopen/dlsym). This avoids the JNI naming
 * convention entirely; we just call C functions directly.
 */
object NativeLoader {

    init {
        System.loadLibrary("field_edge_rust")
    }

    /** Look up a symbol by name; returns the function pointer as a Long. */
    fun dlsym(name: String): Long {
        return NativeInvoke.feDlsym(name)
    }

    /** Calls a 0-arg C function returning a C string. */
    fun call0(symbol: String): String {
        val addr = dlsym(symbol)
        if (addr == 0L) return ""
        return NativeInvoke.call0String(addr)
    }

    /** Calls a 1-arg C function (`const char*`) returning a C string. */
    fun call1(symbol: String, a: String): String {
        val addr = dlsym(symbol)
        if (addr == 0L) return ""
        return NativeInvoke.call1String(addr, a)
    }

    /** Calls a 2-arg C function returning a C string. */
    fun call2(symbol: String, a: String, b: String): String {
        val addr = dlsym(symbol)
        if (addr == 0L) return ""
        return NativeInvoke.call2String(addr, a, b)
    }

    /** Calls a 1-arg C function returning a long (for fe_point_count). */
    fun callPointCount(symbol: String, shardDir: String): Long {
        val addr = dlsym(symbol)
        if (addr == 0L) return -1L
        return NativeInvoke.call1Long(addr, shardDir)
    }
}
