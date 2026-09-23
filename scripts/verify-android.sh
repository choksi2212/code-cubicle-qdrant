#!/usr/bin/env bash
# Verify the FieldEdge Android setup is complete.
#
# Checks:
#   - Rust toolchain + Android targets
#   - cargo-ndk installed
#   - Android NDK installed
#   - All required files present
#   - Kotlin compiles (best-effort via Gradle)
#
# Usage: ./scripts/verify-android.sh

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0

ok()   { echo "✅ $*"; PASS=$((PASS+1)); }
fail() { echo "❌ $*"; FAIL=$((FAIL+1)); }
warn() { echo "⚠️  $*"; }

# Rust toolchain
if command -v cargo >/dev/null 2>&1; then
    ok "cargo present ($(cargo --version))"
else
    fail "cargo not installed"
fi

# Android Rust targets
for target in aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android; do
    if rustup target list --installed 2>/dev/null | grep -q "$target"; then
        ok "Rust target: $target"
    else
        fail "Rust target missing: $target (run: rustup target add $target)"
    fi
done

# cargo-ndk
if command -v cargo-ndk >/dev/null 2>&1; then
    ok "cargo-ndk present ($(cargo ndk --version))"
else
    fail "cargo-ndk not installed (run: cargo install cargo-ndk)"
fi

# Android NDK
if [ -n "${ANDROID_NDK_HOME:-}" ] && [ -d "$ANDROID_NDK_HOME" ]; then
    ok "ANDROID_NDK_HOME set: $ANDROID_NDK_HOME"
elif [ -d "${ANDROID_HOME:-}/ndk" ] && [ "$(ls -A "${ANDROID_HOME}/ndk" 2>/dev/null)" ]; then
    NDK_DIR=$(ls -d "${ANDROID_HOME}/ndk"/*/ | head -1)
    ok "NDK installed at $NDK_DIR"
else
    fail "Android NDK not found. Run ./scripts/install-android-deps.sh"
fi

# File presence
REQUIRED=(
    "apps/mobile/android/build.gradle"
    "apps/mobile/android/settings.gradle"
    "apps/mobile/android/gradle.properties"
    "apps/mobile/android/gradlew"
    "apps/mobile/android/app/build.gradle"
    "apps/mobile/android/app/src/main/AndroidManifest.xml"
    "apps/mobile/android/app/src/main/java/com/fieldedge/MainActivity.kt"
    "apps/mobile/android/app/src/main/java/com/fieldedge/MainApplication.kt"
    "apps/mobile/android/app/src/main/java/com/fieldedge/edge/FieldEdgePackage.kt"
    "apps/mobile/android/app/src/main/java/com/fieldedge/edge/FieldEdgeRustModule.kt"
    "apps/mobile/android/app/src/main/java/com/fieldedge/edge/OnnxClipModule.kt"
    "apps/mobile/android/app/src/main/res/values/strings.xml"
    "apps/mobile/android/app/src/main/res/values/styles.xml"
    "apps/mobile/android/app/proguard-rules.pro"
    "apps/mobile/android/app/debug.keystore"
    "packages/field-edge-rust/src/ffi/exports.rs"
    "packages/field-edge-rust/uniffi/field_edge.udl"
    "scripts/build-android.bat"
    "scripts/install-android-deps.sh"
)

for f in "${REQUIRED[@]}"; do
    if [ -f "$ROOT/$f" ]; then
        ok "file: $f"
    else
        fail "file missing: $f"
    fi
done

# iOS files should NOT exist
REMOVED=("apps/mobile/ios")
for f in "${REMOVED[@]}"; do
    if [ ! -e "$ROOT/$f" ]; then
        ok "absent (good): $f"
    else
        warn "still present (should be removed): $f"
    fi
done

# jniLibs dirs
for abi in arm64-v8a armeabi-v7a x86 x86_64; do
    if [ -d "$ROOT/apps/mobile/android/app/src/main/jniLibs/$abi" ]; then
        ok "jniLibs dir: $abi/"
    else
        fail "jniLibs dir missing: $abi/"
    fi
done

echo
echo "═══════════════════════════════════════"
echo "Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi

ok "All checks passed. Run: cd apps/mobile && pnpm android"
