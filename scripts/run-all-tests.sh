#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
cd -- "$REPO_ROOT"

if ! command -v setsid >/dev/null 2>&1; then
  printf '%s\n' 'run-all-tests: required command is unavailable: setsid' >&2
  exit 127
fi

terminate_detached_process_group() {
  local signal="$1" child_pid="$2"
  kill -"$signal" -- -"$child_pid" 2>/dev/null ||
    kill -"$signal" "$child_pid" 2>/dev/null || true
}

run_suite() {
  local label="$1"
  shift
  local child_pid="" status pending_signal="" deadline

  printf '\n==> %s\n' "$label"
  trap 'pending_signal=HUP; if [[ -n "$child_pid" ]]; then terminate_detached_process_group TERM "$child_pid"; fi' HUP
  trap 'pending_signal=INT; if [[ -n "$child_pid" ]]; then terminate_detached_process_group TERM "$child_pid"; fi' INT
  trap 'pending_signal=TERM; if [[ -n "$child_pid" ]]; then terminate_detached_process_group TERM "$child_pid"; fi' TERM
  trap 'pending_signal=TSTP; if [[ -n "$child_pid" ]]; then terminate_detached_process_group TERM "$child_pid"; fi' TSTP
  setsid env \
    CI=1 \
    GIT_EDITOR=true \
    GIT_SEQUENCE_EDITOR=true \
    GIT_TERMINAL_PROMPT=0 \
    "$@" </dev/null &
  child_pid=$!
  if [[ -n "$pending_signal" ]]; then
    terminate_detached_process_group TERM "$child_pid"
  fi
  if wait "$child_pid"; then
    status=0
  else
    status=$?
  fi
  if [[ -n "$pending_signal" ]]; then
    deadline=$((SECONDS + 5))
    while kill -0 -- -"$child_pid" 2>/dev/null; do
      if (( SECONDS >= deadline )); then
        terminate_detached_process_group KILL "$child_pid"
        break
      fi
      sleep 0.1 || true
    done
    if kill -0 "$child_pid" 2>/dev/null; then
      if wait "$child_pid"; then
        status=0
      else
        status=$?
      fi
    fi
  fi
  if [[ "$pending_signal" == TSTP ]]; then status=148; fi
  trap - HUP INT TERM TSTP

  if (( status != 0 )); then
    printf 'FAILED: %s (exit %d)\n' "$label" "$status" >&2
    return "$status"
  fi
  printf 'PASS: %s\n' "$label"
}

run_suite 'Rust server tests' pnpm test
run_suite 'Shared package tests' pnpm --filter @dam-hopper/shared test
run_suite 'Browser bridge tests' pnpm --filter @dam-hopper/browser-bridge test
run_suite 'UI unit tests' pnpm --filter @dam-hopper/ui test
run_suite 'Native host tests' pnpm --filter @dam-hopper/native test
run_suite 'UI browser tests' pnpm --filter @dam-hopper/ui test:browser

if [[ "${RUN_NATIVE_E2E:-0}" == 1 ]]; then
  run_suite 'Native SSH-forward E2E tests' \
    pnpm --filter @dam-hopper/native test:e2e:ssh-forward
fi

printf '\nAll enabled test suites passed.\n'
