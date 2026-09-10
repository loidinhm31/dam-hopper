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
HELPER_SVC_IN="deploy/systemd/dam-hopper-idle-suspend-helper.service.in"
HELPER_SOCK="deploy/systemd/dam-hopper-idle-suspend-helper.socket"
HELPER_SOCK_IN="deploy/systemd/dam-hopper-idle-suspend-helper.socket.in"

# Check existence of helper service and socket files + templates
for file in "$HELPER_SVC" "$HELPER_SVC_IN" "$HELPER_SOCK" "$HELPER_SOCK_IN"; do
    if [[ ! -f "$file" ]]; then
        echo "FAIL: Required helper systemd unit or template missing: $file" >&2
        exit 1
    fi
done

# Check hardening directives in service unit and template
for unit_file in "$HELPER_SVC" "$HELPER_SVC_IN"; do
    for directive in "ProtectSystem=strict" "CapabilityBoundingSet=CAP_WAKE_ALARM"; do
        if ! grep -q "$directive" "$unit_file"; then
            echo "FAIL: $unit_file missing required hardening directive: $directive" >&2
            exit 1
        fi
    done
    for directive in "ProtectHome" "PrivateTmp" "NoNewPrivileges"; do
        if ! grep -E -q "${directive}=(yes|true)" "$unit_file"; then
            echo "FAIL: $unit_file missing required hardening directive: $directive" >&2
            exit 1
        fi
    done
    for flag in "--socket /run/dam-hopper/idle-suspend.sock" "--enrolled-pid-file /run/dam-hopper/server.pid"; do
        if ! grep -q -- "$flag" "$unit_file"; then
            echo "FAIL: $unit_file missing required flag: $flag" >&2
            exit 1
        fi
    done
done
echo "PASS: All systemd helper hardening directives and flags present in units and templates."
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

# 8. Verify protected force-suspend route registration with body limit
echo "--> Verifying force-suspend route registration and body limit..."
if ! grep -q '/api/system/idle-suspend/v1/force-suspend' server/src/api/router.rs; then
    echo "FAIL: force-suspend route not registered in server/src/api/router.rs" >&2
    exit 1
fi
if ! grep -q 'RequestBodyLimitLayer::new(16 \* 1024)' server/src/api/router.rs; then
    echo "FAIL: force-suspend route missing 16 KiB RequestBodyLimitLayer" >&2
    exit 1
fi
echo "PASS: force-suspend route registered with 16 KiB body limit."

# 9. Verify helper execution domain accepts zero while automatic timing enforces minimum
echo "--> Verifying wake duration domain and bounds enforcement..."
if ! grep -q 'pub const MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS: u64 = 60;' server/src/config/schema.rs; then
    echo "FAIL: Automatic minimum quiet period not 60s in server/src/config/schema.rs" >&2
    exit 1
fi
if ! grep -q 'pub const MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS: u64 = 60;' server/src/config/schema.rs; then
    echo "FAIL: Automatic minimum wake duration not 60s in server/src/config/schema.rs" >&2
    exit 1
fi
if ! grep -q 'pub fn validate_suspend_wake_seconds(wake_after_seconds: u64)' server/src/idle_suspend/protocol.rs; then
    echo "FAIL: validate_suspend_wake_seconds missing from protocol.rs" >&2
    exit 1
fi
echo "PASS: Automatic timing minimums (60s) and execution wake domain verified."

# 10. Verify server audit asset permissions and security policy
echo "--> Verifying server audit security invariants..."
if ! grep -q 'O_NOFOLLOW' server/src/idle_suspend/server_audit.rs; then
    echo "FAIL: Server audit missing O_NOFOLLOW protection" >&2
    exit 1
fi
if ! grep -q '0o600' server/src/idle_suspend/server_audit.rs; then
    echo "FAIL: Server audit missing mode 0600 permissions" >&2
    exit 1
fi
echo "PASS: Server audit mode 0600 and O_NOFOLLOW verified."

# 11. Verify UI ForceSleepDialog component and test existence
echo "--> Verifying UI ForceSleepDialog components..."
if [[ ! -f "packages/ui/src/components/organisms/ForceSleepDialog.tsx" ]]; then
    echo "FAIL: ForceSleepDialog.tsx is missing" >&2
    exit 1
fi
if [[ ! -f "packages/ui/src/components/organisms/ForceSleepDialog.test.tsx" ]]; then
    echo "FAIL: ForceSleepDialog.test.tsx is missing" >&2
    exit 1
fi
echo "PASS: UI ForceSleepDialog component and tests present."

# 12. Verify no arbitrary shell/command execution in force-suspend handler
echo "--> Verifying zero generic shell or command execution in api/idle_suspend.rs..."
if grep -rn -E 'Command::new' server/src/api/idle_suspend.rs 2>/dev/null; then
    echo "FAIL: Found Command::new in server/src/api/idle_suspend.rs" >&2
    exit 1
fi
echo "PASS: Zero Command::new in server/src/api/idle_suspend.rs."

# 13. Verify API server PIDFile configuration and lifecycle hooks
echo "--> Verifying API service PID file configuration and lifecycle hooks..."
API_SVC="deploy/systemd/dam-hopper-api.service"
API_SVC_IN="deploy/systemd/dam-hopper-api.service.in"
for api_file in "$API_SVC" "$API_SVC_IN"; do
    if [[ ! -f "$api_file" ]]; then
        echo "FAIL: API systemd unit or template missing: $api_file" >&2
        exit 1
    fi
    if ! grep -q 'PIDFile=/run/dam-hopper/server.pid' "$api_file"; then
        echo "FAIL: $api_file missing PIDFile directive" >&2
        exit 1
    fi
    if ! grep -q "echo \$MAINPID > /run/dam-hopper/server.pid" "$api_file"; then
        echo "FAIL: $api_file missing ExecStartPost PID file write hook" >&2
        exit 1
    fi
    if ! grep -q "ExecStopPost=.*/rm -f /run/dam-hopper/server.pid" "$api_file"; then
        echo "FAIL: $api_file missing ExecStopPost PID file cleanup hook" >&2
        exit 1
    fi
done
echo "PASS: API service PIDFile and lifecycle hooks verified in unit and template."

# 14. Verify release manager lifecycle integration for helper unit
echo "--> Verifying release manager lifecycle integration for helper service..."
if ! grep -q 'HELPER_SERVICE_UNIT' server/src/linux_release/constants.rs; then
    echo "FAIL: HELPER_SERVICE_UNIT not defined in linux_release/constants.rs" >&2
    exit 1
fi
if ! grep -q 'HELPER_SERVICE_UNIT' server/src/linux_release/stage_units.rs; then
    echo "FAIL: HELPER_SERVICE_UNIT not staged in linux_release/stage_units.rs" >&2
    exit 1
fi
if ! grep -q 'systemctl_start(HELPER_SERVICE_UNIT)' server/src/linux_release/activate.rs; then
    echo "FAIL: HELPER_SERVICE_UNIT not started in linux_release/activate.rs" >&2
    exit 1
fi
if ! grep -q 'HELPER_SERVICE_UNIT' server/src/linux_release/status.rs; then
    echo "FAIL: HELPER_SERVICE_UNIT not inspected in linux_release/status.rs" >&2
    exit 1
fi
echo "PASS: Release manager helper unit staging, activation, and status verified."

echo "=== All Idle Suspend Boundary Checks Passed ==="
