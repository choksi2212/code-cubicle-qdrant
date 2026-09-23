#!/usr/bin/env bash
# Build the Rust core crate + generate UniFFI bindings.
#
# Usage:
#   ./scripts/build-rust.sh           # debug build
#   ./scripts/build-rust.sh release    # release build

set -e

MODE="${1:-debug}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUST_DIR="$ROOT/packages/field-edge-rust"

echo "🦀 Building Rust core ($MODE)..."
cd "$RUST_DIR"
cargo build $MODE

echo "📦 Generating UniFFI bindings..."
mkdir -p "$RUST_DIR/bindings/swift" "$RUST_DIR/bindings/kotlin"

UNIFFI_BINDGEN="C:/Users/niklaus/.cargo/bin/uniffi-bindgen.exe"
if [ ! -f "$UNIFFI_BINDGEN" ]; then
  UNIFFI_BINDGEN=$(which uniffi-bindgen 2>/dev/null || echo "")
fi

if [ -z "$UNIFFI_BINDGEN" ] || [ ! -f "$UNIFFI_BINDGEN" ]; then
  echo "⚠️  uniffi-bindgen not found. Install with:"
  echo "    cargo install uniffi_bindgen --root ~/.cargo"
  echo ""
  echo "Skipping binding generation. UniFFI scaffolding is still compiled into the .so/.dylib/.dll."
  exit 0
fi

"$UNIFFI_BINDGEN" generate "$RUST_DIR/uniffi/field_edge.udl" --language swift --out-dir "$RUST_DIR/bindings/swift"
"$UNIFFI_BINDGEN" generate "$RUST_DIR/uniffi/field_edge.udl" --language kotlin --out-dir "$RUST_DIR/bindings/kotlin"

echo "✅ Done. Outputs:"
echo "   - Rust crate: $RUST_DIR/target/"
echo "   - Swift bindings: $RUST_DIR/bindings/swift/"
echo "   - Kotlin bindings: $RUST_DIR/bindings/kotlin/"
