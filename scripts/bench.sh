#!/usr/bin/env bash
# bench.sh — Performance baseline for Rust server endpoints.
#
# Usage:
#   ./scripts/bench.sh [--url <server-url>] [--token <token>] [--duration <seconds>] [--connections <n>]
#
# Requires: hey (go install github.com/rakyll/hey@latest)
#           OR wrk (apt install wrk / brew install wrk)
#
# Defaults:
#   --url         http://localhost:4800
#   --duration    10   (seconds per endpoint)
#   --connections 50

set -euo pipefail

SERVER_URL="${SERVER_URL:-http://localhost:4800}"
TOKEN="${TOKEN:-}"
DURATION="${BENCH_DURATION:-10}"
CONNECTIONS="${BENCH_CONNECTIONS:-50}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --url)         SERVER_URL=$2;  shift 2 ;;
    --token)       TOKEN=$2;       shift 2 ;;
    --duration)    DURATION=$2;    shift 2 ;;
    --connections) CONNECTIONS=$2; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$TOKEN" ]]; then
  TOKEN_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/dam-hopper/server-token"
  [[ -f "$TOKEN_FILE" ]] && TOKEN=$(cat "$TOKEN_FILE") || {
    echo "ERROR: No token. Pass --token or run the server once."; exit 1
  }
fi

# ── Tool detection ─────────────────────────────────────────────────────────

if command -v hey &>/dev/null; then
  TOOL=hey
elif command -v wrk &>/dev/null; then
  TOOL=wrk
else
  echo "ERROR: Install 'hey' or 'wrk' for benchmarking."
  echo "  hey: go install github.com/rakyll/hey@latest"
  echo "  wrk: apt install wrk  OR  brew install wrk"
  exit 1
fi

# ── Wait for server ─────────────────────────────────────────────────────────

echo "Waiting for server at $SERVER_URL..."
for i in $(seq 1 30); do
  curl -sf -H "Authorization: Bearer $TOKEN" "$SERVER_URL/api/health" >/dev/null 2>&1 && break
  [[ $i -eq 30 ]] && { echo "Server not ready after 30s"; exit 1; }
  sleep 1
done
echo "Server ready."
echo ""

# ── Benchmark runner ────────────────────────────────────────────────────────

run_bench() {
  local label=$1 path=$2
  local url="$SERVER_URL$path"

  echo "--- $label ---"
  echo "  URL: $url"

  if [[ "$TOOL" = "hey" ]]; then
    hey -z "${DURATION}s" -c "$CONNECTIONS" \
      -H "Authorization: Bearer $TOKEN" \
      "$url" 2>&1 | grep -E "Requests/sec|Average|Fastest|Slowest|99th"
  else
    # wrk — inline Lua for auth header
    wrk -t4 -c"$CONNECTIONS" -d"${DURATION}s" \
      --script=<(printf 'wrk.headers["Authorization"] = "Bearer %s"' "$TOKEN") \
      "$url" 2>&1 | grep -E "Req/Sec|Latency|requests in"
  fi
  echo ""
}

echo "=== DamHopper Rust Server Benchmark ==="
echo "  Server     : $SERVER_URL"
echo "  Tool       : $TOOL"
echo "  Duration   : ${DURATION}s per endpoint"
echo "  Connections: $CONNECTIONS"
echo ""

# Health (no auth overhead)
run_bench "health"             "/api/health"
# Workspace status (auth + RwLock read)
run_bench "workspace/status"   "/api/workspace/status"
# Config (auth + config read)
run_bench "config"             "/api/config"
# Projects list
run_bench "projects"           "/api/projects"
# Terminal list (PTY manager lock)
run_bench "terminal list"      "/api/terminal"
# Commands search (BM25 index)
run_bench "commands search"    "/api/commands/search?query=build"
# Agent store list (filesystem scan)
run_bench "agent-store list"   "/api/agent-store"
# Agent store health
run_bench "agent-store health" "/api/agent-store/health"

echo "=== Benchmark complete ==="
