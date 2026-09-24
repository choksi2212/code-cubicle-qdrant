#!/usr/bin/env bash
# Dump the auto-generated FastAPI OpenAPI spec from a live sync-api process.
# Useful for diff-checking against the hand-written apps/sync-api/openapi.yaml.
#
# Usage:  ./scripts/generate-openapi.sh           # writes openapi.generated.yaml
#         OUTPUT=custom.yaml ./scripts/generate-openapi.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT="${OUTPUT:-$ROOT/openapi.generated.yaml}"

cd "$ROOT/apps/sync-api"

# Ensure the package is installed in editable mode.
if ! python -c "import app.main" 2>/dev/null; then
  echo "[generate-openapi] installing sync-api in editable mode..." >&2
  pip install -e "$ROOT/apps/sync-api" >/dev/null
fi

echo "[generate-openapi] dumping live OpenAPI to $OUTPUT" >&2
python - <<PY > "$OUTPUT"
import json, sys, yaml
from app.main import app
spec = app.openapi()
# Force a deterministic dump so diffs are readable.
print(yaml.safe_dump(json.loads(json.dumps(spec)), sort_keys=False, default_flow_style=False, width=120))
PY

echo "[generate-openapi] wrote $OUTPUT" >&2
echo "[generate-openapi] diff vs hand-written spec (if any):" >&2
if [ -f "$ROOT/apps/sync-api/openapi.yaml" ]; then
  diff -u "$ROOT/apps/sync-api/openapi.yaml" "$OUTPUT" | head -80 || true
fi
