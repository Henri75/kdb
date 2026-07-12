#!/usr/bin/env bash
# Smoke test for a running Atlas stack: health, stats, search, mcp.
set -euo pipefail

API="http://127.0.0.1:${API_PORT:-8710}"
MCP="http://127.0.0.1:${MCP_PORT:-8711}"
UI="http://127.0.0.1:${UI_PORT:-8712}"
fail=0

check() {
  local name=$1 url=$2 expect=${3:-200}
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$url" || echo 000)
  if [[ "$code" == "$expect" ]]; then
    echo "ok   $name ($code)"
  else
    echo "FAIL $name (got $code, want $expect) — $url"
    fail=1
  fi
}

check "api health"   "$API/api/health"
check "api stats"    "$API/api/stats"
check "api dashboard" "$API/api/dashboard"
check "api projects" "$API/api/projects"
check "api search"   "$API/api/search?q=test&limit=1"
check "mcp health"   "$MCP/health"
check "ui"           "$UI/"

exit $fail
