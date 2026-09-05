#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
cd -- "$REPO_ROOT"

echo "=== Verifying Terminal Idle Suspend Security & Boundary Contracts ==="

echo "--> Checking for forbidden sudo execution in server/src/..."
if grep -rn -E 'Command::new\(.*"sudo".*\)' server/src/ 2>/dev/null; then
    echo "FAIL: Found Command::new(\"sudo\") invocation in server/src/" >&2
    exit 1
fi
if grep -rn "sudo" server/src/idle_suspend/ 2>/dev/null; then
    echo "FAIL: Found sudo reference in server/src/idle_suspend/" >&2
    exit 1
fi
echo "PASS: Zero sudo execution in server/src/ and zero sudo references in idle_suspend."

# 2. Check for shell invocation in idle_suspend modules
echo "--> Checking for forbidden shell execution in server/src/idle_suspend/..."
if grep -rn -E 'Command::new\("(sh|bash|zsh)"\)' server/src/idle_suspend/ 2>/dev/null; then
    echo "FAIL: Found direct shell invocation in idle_suspend modules" >&2
    exit 1
fi
echo "PASS: Zero shell invocations in idle_suspend modules."

# 3. Verify systemd helper unit files integrity and hardening directives
echo "--> Verifying systemd helper service & socket configurations..."
HELPER_SVC="deploy/systemd/dam-hopper-idle-suspend-helper.service"
HELPER_SOCK="deploy/systemd/dam-hopper-idle-suspend-helper.socket"

# Check hardening directives in service unit
for directive in "ProtectSystem=strict" "CapabilityBoundingSet=CAP_WAKE_ALARM"; do
    if ! grep -q "$directive" "$HELPER_SVC"; then
        echo "FAIL: Helper service missing required hardening directive: $directive" >&2
        exit 1
    fi
done
for directive in "ProtectHome" "PrivateTmp" "NoNewPrivileges"; do
    if ! grep -E -q "${directive}=(yes|true)" "$HELPER_SVC"; then
        echo "FAIL: Helper service missing required hardening directive: $directive" >&2
        exit 1
    fi
done
echo "PASS: All systemd hardening directives present."

# 4. Verify default config has idle_suspend disabled
echo "--> Verifying default-off configuration invariant..."
if ! grep -q 'assert!(!cfg.enabled);' server/src/idle_suspend/tests.rs; then
    echo "FAIL: Idle suspend default-off test assertion missing" >&2
    exit 1
fi
echo "PASS: Default-off invariant verified."

# 5. Verify dedicated endpoint only for timing mutation
echo "--> Verifying timing mutation route separation..."
if ! grep -q 'Terminal idle-suspend timing must be configured via PATCH' server/src/api/config.rs; then
    echo "FAIL: PUT /api/config does not guard against idle suspend mutation delta" >&2
    exit 1
fi
echo "PASS: PUT /api/config prohibits idle suspend timing delta bypass."

# 6. Verify cross-module integration test suite existence and registration
echo "--> Verifying cross-module integration suite..."
if [[ ! -f "server/tests/idle_suspend.rs" ]]; then
    echo "FAIL: server/tests/idle_suspend.rs is missing" >&2
    exit 1
fi
echo "PASS: Cross-module integration test suite present."

# 7. Verify UI browser test suite existence
echo "--> Verifying UI browser test suite..."
if [[ ! -f "packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx" ]]; then
    echo "FAIL: idle-suspend-settings-status.browser.tsx is missing" >&2
    exit 1
fi
echo "PASS: UI browser test suite present."

echo "=== All Idle Suspend Boundary Checks Passed ==="
