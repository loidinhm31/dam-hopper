#!/usr/bin/env bash
# Provision and verify the Chromium executable used by the Rust backend host browser
# (server/src/browser_host) in CI. Shared by the Application E2E and Rust Linux jobs.
#
# Contract:
#   1. Select the lockfile-pinned Playwright Chromium (deterministic; never the mutable
#      runner-installed google-chrome, which is a launcher script and not the real ELF).
#   2. Reject missing / non-executable / world-writable executables (same rule as
#      BrowserHostConfig::validate_executable_permissions).
#   3. On runners that restrict unprivileged user namespaces (Ubuntu 24.04 AppArmor),
#      attach a narrow userns profile to the exact ELF. Sandbox stays enabled.
#   4. Prove readiness with production-equivalent flags (--headless=new,
#      --remote-debugging-port=0, sandbox ON): wait for DevToolsActivePort and a successful
#      CDP /json/version response. `--dump-dom` is NOT used: full new-headless Chrome never
#      exits after dumping, so it cannot signal readiness.
#   5. Tear the probe's own process group down, then publish DAM_HOPPER_BROWSER_EXECUTABLE.
#
# Run from the repository root. Bounded: READY_TIMEOUT_S (default 30) + 10s teardown.
set -euo pipefail

READY_TIMEOUT_S="${READY_TIMEOUT_S:-30}"
TEARDOWN_TIMEOUT_S=10

PROBE_DIR=""
CHROME_PID=""
CHROME_EXEC=""
CANONICAL_CHROME=""

diagnostics() {
  echo "::group::browser provisioning diagnostics"
  echo "kernel: $(uname -r)"
  echo "apparmor_restrict_unprivileged_userns: $(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo n/a)"
  echo "unprivileged_userns_clone: $(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo n/a)"
  echo "selected: ${CHROME_EXEC:-<none>}"
  echo "canonical: ${CANONICAL_CHROME:-<none>}"
  if [ -n "${CANONICAL_CHROME}" ] && [ -e "${CANONICAL_CHROME}" ]; then
    ls -l "${CANONICAL_CHROME}" || true
    echo "magic: $(head -c 4 "${CANONICAL_CHROME}" | od -An -c | tr -s ' ')"
    timeout 10s "${CANONICAL_CHROME}" --version 2>&1 || true
  fi
  if [ -n "${PROBE_DIR}" ]; then
    echo "--- browser stderr (tail) ---"
    tail -n 40 "${PROBE_DIR}/stderr.log" 2>/dev/null || true
    echo "--- DevToolsActivePort ---"
    cat "${PROBE_DIR}/profile/DevToolsActivePort" 2>/dev/null || echo "<absent>"
  fi
  echo "--- recent AppArmor denials (best effort) ---"
  (sudo -n dmesg 2>/dev/null || dmesg 2>/dev/null || true) | grep -iE 'apparmor.*(denied|userns)' | tail -n 10 || true
  echo "::endgroup::"
}

# Terminate only the probe's own process group; escalate to SIGKILL after a grace period.
stop_probe() {
  [ -n "${CHROME_PID}" ] || return 0
  kill -TERM -- "-${CHROME_PID}" 2>/dev/null || true
  local i
  for ((i = 0; i < TEARDOWN_TIMEOUT_S * 10; i++)); do
    kill -0 -- "-${CHROME_PID}" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 -- "-${CHROME_PID}" 2>/dev/null; then
    kill -KILL -- "-${CHROME_PID}" 2>/dev/null || true
    sleep 0.5
  fi
  wait "${CHROME_PID}" 2>/dev/null || true
  local alive=0
  kill -0 -- "-${CHROME_PID}" 2>/dev/null && alive=1
  CHROME_PID=""
  return "${alive}"
}

on_exit() {
  local status=$?
  trap - EXIT
  if [ "${status}" -ne 0 ]; then
    diagnostics || true
  fi
  stop_probe || true
  [ -z "${PROBE_DIR}" ] || rm -rf "${PROBE_DIR}"
  exit "${status}"
}
trap on_exit EXIT

fail() {
  echo "::error::$*"
  exit 1
}

# 1. Deterministic selection: executable of the pinned Playwright Chromium.
CHROME_EXEC="$(pnpm --filter @dam-hopper/ui exec node -e 'import("playwright").then((p) => process.stdout.write(p.chromium.executablePath()))')"
[ -n "${CHROME_EXEC}" ] || fail "Playwright did not report a Chromium executable path"
[ -f "${CHROME_EXEC}" ] || fail "Browser executable not found: ${CHROME_EXEC}"
[ -x "${CHROME_EXEC}" ] || fail "Browser executable is not executable: ${CHROME_EXEC}"
CANONICAL_CHROME="$(readlink -f "${CHROME_EXEC}")"

# 2. Permission policy.
if find -L "${CHROME_EXEC}" -perm -0002 -print -quit | grep -q .; then
  fail "Browser executable has unsafe world-writable permissions: ${CHROME_EXEC}"
fi

# 3. Narrow AppArmor userns allowance for the exact ELF (sandbox remains enabled).
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = "1" ] \
  && command -v apparmor_parser >/dev/null 2>&1; then
  sudo tee /etc/apparmor.d/dam-hopper-playwright-chromium >/dev/null <<EOF
abi <abi/4.0>,
include <tunables/global>

profile dam-hopper-playwright-chromium "${CANONICAL_CHROME}" flags=(unconfined) {
  userns,
}
EOF
  sudo apparmor_parser -r /etc/apparmor.d/dam-hopper-playwright-chromium
fi

# 4. Readiness probe with production-equivalent flags.
PROBE_DIR="$(mktemp -d)"
mkdir -m 700 "${PROBE_DIR}/profile"
# setsid: probe leads its own session/process group so teardown never touches other processes.
setsid "${CANONICAL_CHROME}" \
  --remote-debugging-port=0 \
  --user-data-dir="${PROBE_DIR}/profile" \
  --no-first-run --no-default-browser-check \
  --headless=new about:blank \
  >"${PROBE_DIR}/stdout.log" 2>"${PROBE_DIR}/stderr.log" </dev/null &
CHROME_PID=$!

ready=0
for ((i = 0; i < READY_TIMEOUT_S * 4; i++)); do
  kill -0 "${CHROME_PID}" 2>/dev/null || fail "Browser exited before becoming ready"
  port_file="${PROBE_DIR}/profile/DevToolsActivePort"
  if [ -s "${port_file}" ]; then
    port="$(head -n 1 "${port_file}")"
    if [[ "${port}" =~ ^[0-9]+$ ]] \
      && curl -fsS --max-time 3 "http://127.0.0.1:${port}/json/version" 2>/dev/null | grep -q '"Browser"'; then
      ready=1
      break
    fi
  fi
  sleep 0.25
done
[ "${ready}" -eq 1 ] || fail "Browser did not become CDP-ready within ${READY_TIMEOUT_S}s"

# 5. Bounded teardown must succeed before publishing.
stop_probe || fail "Probe process group did not terminate"

echo "Browser host executable ready: ${CHROME_EXEC} ($(timeout 10s "${CANONICAL_CHROME}" --version 2>&1 | head -n 1))"
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "DAM_HOPPER_BROWSER_EXECUTABLE=${CHROME_EXEC}" >> "${GITHUB_ENV}"
fi
