#!/usr/bin/env bash
# smoke.sh — curl-based post-deploy health check for the FieldEdge sync API.
#
# Usage:
#   ./apps/sync-api/scripts/smoke.sh https://field-edge-sync-api-staging.onrender.com
#
# Exits non-zero on any failure so it can gate a CI deploy step.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <base-url>" >&2
  echo "  e.g. $0 https://field-edge-sync-api-staging.onrender.com" >&2
  exit 2
fi

URL="${1%/}"  # strip trailing slash
echo "→ smoke testing ${URL}"

# ── 1. liveness ──────────────────────────────────────────────────────────
HEALTH_BODY=$(curl -fsS --max-time 15 "${URL}/healthz")
echo "  /healthz → ${HEALTH_BODY}"
STATUS=$(echo "${HEALTH_BODY}" | jq -r '.status')
if [[ "${STATUS}" != "ok" ]]; then
  echo "✗ /healthz returned status='${STATUS}' (expected 'ok')" >&2
  exit 1
fi

# ── 2. readiness (Qdrant reachable) ──────────────────────────────────────
READY_BODY=$(curl -fsS --max-time 30 "${URL}/readyz")
echo "  /readyz  → ${READY_BODY}"
READY_STATUS=$(echo "${READY_BODY}" | jq -r '.status')
if [[ "${READY_STATUS}" != "ok" ]]; then
  echo "✗ /readyz returned status='${READY_STATUS}' (expected 'ok')" >&2
  exit 1
fi

QDRANT_OK=$(echo "${READY_BODY}" | jq -r '.qdrant')
if [[ "${QDRANT_OK}" != "true" ]]; then
  echo "✗ /readyz qdrant='${QDRANT_OK}' (expected true)" >&2
  exit 1
fi

echo "✅ smoke ok"
