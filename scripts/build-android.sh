#!/usr/bin/env bash
# Linux/macOS equivalent of build-android.bat
# Run from repo root: ./scripts/build-android.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUST_DIR="$ROOT/packages/field-edge-rust"
JNI_DIR="$ROOT/apps/mobile/android/app/src/main/jniLibs"

cd "$RUST_DIR"

echo "📦 [1/2] Generating Kotlin bindings..."
cargo run --release --bin generate-bindings -- --target kotlin --out-dir bindings/kotlin

echo "🦀 [2/2] Cross-compiling Rust for Android..."
cargo ndk \
    -t arm64-v8a \
    -t armeabi-v7a \
    -t x86 \
    -t x86_64 \
    -o "$JNI_DIR" \
    build --release

echo
echo "✅ Done. Artifacts:"
find "$JNI_DIR" -name "libfield_edge_rust.so" | sort
echo "Kotlin bindings: $RUST_DIR/bindings/kotlin/"
