package com.fieldedge.edge;

/**
 * JNI helpers for invoking C-ABI function pointers looked up via dlsym.
 *
 * Each native method takes a function pointer (Long), calls it with the
 * appropriate C-ABI arguments, and converts the result.
 */
public final class NativeInvoke {

    static {
        System.loadLibrary("field_edge_rust");
    }

    private NativeInvoke() {}

    /** Look up a symbol by name; returns the function pointer as a Long. */
    public static native long feDlsym(String name);

    /** Calls a 0-arg C function returning `char*` (heap-allocated, must free). */
    public static native String call0String(long funcPtr);

    /** Calls a 1-arg C function (`const char* a`) returning `char*`. */
    public static native String call1String(long funcPtr, String a);

    /** Calls a 2-arg C function (`const char* a, const char* b`) returning `char*`. */
    public static native String call2String(long funcPtr, String a, String b);

    /** Calls a 1-arg C function (`const char* a`) returning `int64_t`. */
    public static native long call1Long(long funcPtr, String a);
}
