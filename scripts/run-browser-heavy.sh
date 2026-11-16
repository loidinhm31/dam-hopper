#!/usr/bin/env bash
# Serialize browser-heavy runs (real Chromium: host-browser E2E, browser_host_* cargo tests) so
# concurrent agents or terminals cannot stack Chromium trees on one machine.
#
#   scripts/run-browser-heavy.sh pnpm --filter @dam-hopper/ui test:e2e e2e/os-host-browser
#   scripts/run-browser-heavy.sh cargo test --manifest-path server/Cargo.toml --test browser_host_media
#
# One run at a time per host: waits up to BROWSER_HEAVY_WAIT_S (default 3600) for the lock, runs
# the command at low CPU/IO priority and returns its exit status. Nested invocations reuse the
# outer lock (DAM_HOPPER_BROWSER_HEAVY_LOCKED) instead of deadlocking on themselves.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

if [ -n "${DAM_HOPPER_BROWSER_HEAVY_LOCKED:-}" ]; then
  exec "$@"
fi

LOCK_FILE="${BROWSER_HEAVY_LOCK_FILE:-${XDG_RUNTIME_DIR:-/tmp}/dam-hopper-browser-heavy.lock}"
exec 9>"$LOCK_FILE"
if ! flock -w "${BROWSER_HEAVY_WAIT_S:-3600}" 9; then
  echo "timed out waiting for another browser-heavy run (lock: $LOCK_FILE)" >&2
  exit 75
fi

export DAM_HOPPER_BROWSER_HEAVY_LOCKED=1
# The lock fd is inherited by the child on purpose: it is released when the whole run exits.
exec nice -n 10 ionice -c 2 -n 7 "$@"
