#!/usr/bin/env bash
# compare-servers.sh — Side-by-side API comparison: Rust server vs Node server.
#
# Usage:
#   ./scripts/compare-servers.sh [--rust-url <url>] [--node-url <url>] [--token <token>]
#
# Defaults:
#   --rust-url  http://localhost:4800  (pnpm dev:server)
#   --node-url  http://localhost:3001  (node packages/server/dist/index.js)
#   --token     read from ~/.config/dev-hub/server-token
#
# Requires: curl, jq

set -euo pipefail

RUST_URL="${RUST_URL:-http://localhost:4800}"
NODE_URL="${NODE_URL:-http://localhost:3001}"
TOKEN="${TOKEN:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --rust-url) RUST_URL=$2; shift 2 ;;
    --node-url) NODE_URL=$2; shift 2 ;;
    --token)    TOKEN=$2;    shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$TOKEN" ]]; then
  TOKEN_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/dev-hub/server-token"
  if [[ -f "$TOKEN_FILE" ]]; then
    TOKEN=$(cat "$TOKEN_FILE")
  else
    echo "ERROR: No token. Pass --token or start server once to generate ~/.config/dev-hub/server-token"
    exit 1
  fi
fi

PASS=0
FAIL=0
SKIP=0

# ── Helpers ────────────────────────────────────────────────────────────────

fetch() {
  local url=$1 method=${2:-GET} body=${3:-}
  local args=(-s -w "\n%{http_code}" -X "$method" -H "Authorization: Bearer $TOKEN")
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  curl "${args[@]}" "$url"
}

compare_endpoint() {
  local label=$1 path=$2 method=${3:-GET} body=${4:-}

  # One-sided smoke test when only one server is available
  if [[ "$rust_ready" = true && "$node_ready" = false ]]; then
    local out status
    out=$(fetch "$RUST_URL$path" "$method" "$body" 2>/dev/null || echo -e "ERROR\n000")
    status=$(echo "$out" | tail -1)
    echo "SMOKE [$label]  Rust=$status  (Node unavailable)"
    [[ "$status" =~ ^2 ]] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
    return
  fi
  if [[ "$rust_ready" = false && "$node_ready" = true ]]; then
    local out status
    out=$(fetch "$NODE_URL$path" "$method" "$body" 2>/dev/null || echo -e "ERROR\n000")
    status=$(echo "$out" | tail -1)
    echo "SMOKE [$label]  Node=$status  (Rust unavailable)"
    [[ "$status" =~ ^2 ]] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
    return
  fi

  local rust_out node_out rust_status node_status rust_body node_body

  rust_out=$(fetch "$RUST_URL$path" "$method" "$body" 2>/dev/null || echo -e "ERROR\n000")
  node_out=$(fetch "$NODE_URL$path" "$method" "$body" 2>/dev/null || echo -e "ERROR\n000")

  rust_status=$(echo "$rust_out" | tail -1)
  node_status=$(echo "$node_out" | tail -1)
  rust_body=$(echo "$rust_out" | head -n -1)
  node_body=$(echo "$node_out" | head -n -1)

  if [[ "$rust_status" != "$node_status" ]]; then
    echo "FAIL  [$label]  status mismatch: Rust=$rust_status  Node=$node_status"
    FAIL=$((FAIL+1))
    return
  fi

  # Structural JSON comparison — compare object key shape for first element if array.
  local rust_cmp node_cmp
  if echo "$rust_body" | jq -e 'type == "array"' >/dev/null 2>&1; then
    rust_cmp=$(echo "$rust_body" | jq 'if length > 0 then .[0] | [paths(scalars)] | sort else [] end' 2>/dev/null || echo "[]")
    node_cmp=$(echo "$node_body" | jq 'if length > 0 then .[0] | [paths(scalars)] | sort else [] end' 2>/dev/null || echo "[]")
  else
    rust_cmp=$(echo "$rust_body" | jq '[paths(scalars)] | sort' 2>/dev/null || echo "[]")
    node_cmp=$(echo "$node_body" | jq '[paths(scalars)] | sort' 2>/dev/null || echo "[]")
  fi

  if [[ "$rust_cmp" != "$node_cmp" ]]; then
    echo "DIFF  [$label]  JSON structure mismatch"
    diff <(echo "$rust_cmp" | jq -r '.[]') <(echo "$node_cmp" | jq -r '.[]') | head -20
    FAIL=$((FAIL+1))
    return
  fi

  echo "OK    [$label]  status=$rust_status"
  PASS=$((PASS+1))
}

# ── Wait for servers ───────────────────────────────────────────────────────

wait_ready() {
  local url=$1 label=$2 max=30 i=0
  while ! curl -sf -H "Authorization: Bearer $TOKEN" "$url/api/health" >/dev/null 2>&1; do
    if [[ $i -ge $max ]]; then
      echo "SKIP  $label unreachable at $url — skipping comparison"
      return 1
    fi
    sleep 1; i=$((i+1))
  done
  echo "  $label ready at $url"
  return 0
}

echo "=== Dev-Hub Server Comparison ==="
echo "  Rust : $RUST_URL"
echo "  Node : $NODE_URL"
echo ""

rust_ready=true
node_ready=true
wait_ready "$RUST_URL" "Rust server" || rust_ready=false
wait_ready "$NODE_URL" "Node server" || node_ready=false

if [[ "$rust_ready" = false && "$node_ready" = false ]]; then
  echo ""
  echo "Both servers unreachable. Start at least one:"
  echo "  Rust: pnpm dev:server"
  echo "  Node: node packages/server/dist/index.js --workspace /path/to/workspace"
  exit 1
fi

if [[ "$rust_ready" = false ]]; then
  echo "WARNING: Rust server unreachable — skipping comparison, running Node-only smoke test."
  echo "  Start Rust server with: pnpm dev:server"
  echo ""
fi

if [[ "$node_ready" = false ]]; then
  echo "WARNING: Node server unreachable — skipping comparison, running Rust-only smoke test."
  echo "  Start Node server with: node packages/server/dist/index.js --workspace /path/to/workspace"
  echo ""
fi

echo ""
echo "=== Endpoint comparison ==="

# Auth
compare_endpoint "health (no auth)"     "/api/health"            "GET"
compare_endpoint "auth/status"          "/api/auth/status"       "GET"
# Workspace
compare_endpoint "workspace/status"     "/api/workspace/status"  "GET"
compare_endpoint "workspace/known"      "/api/workspace/known"   "GET"
# Config
compare_endpoint "config"               "/api/config"            "GET"
# Projects
compare_endpoint "projects"             "/api/projects"          "GET"
# Terminal
compare_endpoint "terminal (list)"      "/api/terminal"          "GET"
# Commands
compare_endpoint "commands (maven)"     "/api/commands?projectType=maven"  "GET"
compare_endpoint "commands (search)"    "/api/commands/search?query=build" "GET"
# Agent store
compare_endpoint "agent-store (list)"   "/api/agent-store"       "GET"
compare_endpoint "agent-store/health"   "/api/agent-store/health" "GET"
compare_endpoint "agent-store/matrix"   "/api/agent-store/matrix" "GET"
# Agent memory
compare_endpoint "agent-memory/templates" "/api/agent-memory/templates" "GET"
# Settings
compare_endpoint "settings/export"     "/api/settings/export"   "GET"

echo ""
echo "=== Results: $PASS passed, $FAIL failed, $SKIP skipped ==="
[[ $FAIL -eq 0 ]]
