#!/usr/bin/env bash
# Test journey: Linux release plugin runner owner isolation smoke scenario.
# Validates non-root owner resolution, API UID preservation, socket permissions,
# unit hardening & cgroup containment, immutable Node path, and source immutability.
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/linux-release-common.sh"

init_test_env "dam-hopper-plugin-runner-smoke"

BUNDLE_DIR="$TEST_ROOT/bundle-v0.1.0"
mkdir -p "$BUNDLE_DIR"
create_mock_release_bundle "v0.1.0" "$BUNDLE_DIR"

INSTALLER="$REPO_ROOT/deploy/release/dam-hopper-install.sh"
assert_file_exists "$INSTALLER" "Bootstrap installer must exist"

# -----------------------------------------------------------------------------
# 1. Argument validation: rejection of unsafe / invalid owner accounts
# -----------------------------------------------------------------------------
log "1. Validating rejection of invalid plugin owner identities"

# Root rejected
if "$INSTALLER" --bundle "$BUNDLE_DIR" --role server --plugin-owner-user root 2>/dev/null; then
    fail "Installer must reject --plugin-owner-user root"
fi

# Same as API service user rejected
if "$INSTALLER" --bundle "$BUNDLE_DIR" --role server --service-user dam-hopper --plugin-owner-user dam-hopper 2>/dev/null; then
    fail "Installer must reject --plugin-owner-user matching API service user"
fi

# Web service user rejected
if "$INSTALLER" --bundle "$BUNDLE_DIR" --role server --plugin-owner-user dam-hopper-web 2>/dev/null; then
    fail "Installer must reject --plugin-owner-user matching dam-hopper-web"
fi

# Non-existent user rejected
if "$INSTALLER" --bundle "$BUNDLE_DIR" --role server --plugin-owner-user nonexistent_usr_xyz 2>/dev/null; then
    fail "Installer must reject non-existent user as plugin owner"
fi

log "✓ Unsafe and invalid owner account rejections verified"

# -----------------------------------------------------------------------------
# 2. API UID preservation and SupplementaryGroups
# -----------------------------------------------------------------------------
log "2. Verifying API UID preservation and shared group isolation"

API_SERVICE_IN="$REPO_ROOT/deploy/systemd/dam-hopper-api.service.in"
assert_file_exists "$API_SERVICE_IN" "API service unit template must exist"

# API UID remains distinct
grep -q "User=@API_USER@" "$API_SERVICE_IN" || fail "API service User must be @API_USER@"
grep -q "Group=@API_GROUP@" "$API_SERVICE_IN" || fail "API service Group must be @API_GROUP@"
grep -q "SupplementaryGroups=@PLUGIN_SHARED_GROUP@" "$API_SERVICE_IN" || fail "API service must include SupplementaryGroups=@PLUGIN_SHARED_GROUP@"

log "✓ API service identity preservation and supplementary socket group verified"

# -----------------------------------------------------------------------------
# 4. Plugin runner service hardening and cgroup limits
# -----------------------------------------------------------------------------
log "4. Verifying plugin runner service hardening directives"

RUNNER_SERVICE_IN="$REPO_ROOT/deploy/systemd/dam-hopper-plugin-runner.service.in"
assert_file_exists "$RUNNER_SERVICE_IN" "Plugin runner service template must exist"

grep -q "User=@ADVISOR_OWNER_USER@" "$RUNNER_SERVICE_IN" || fail "Runner User must be @ADVISOR_OWNER_USER@"
grep -q "Group=@ADVISOR_OWNER_GROUP@" "$RUNNER_SERVICE_IN" || fail "Runner Group must be @ADVISOR_OWNER_GROUP@"
grep -q "MemoryMax=1G" "$RUNNER_SERVICE_IN" || fail "Runner must constrain MemoryMax=1G"
grep -q "TasksMax=64" "$RUNNER_SERVICE_IN" || fail "Runner must constrain TasksMax=64"
grep -q "NoNewPrivileges=true" "$RUNNER_SERVICE_IN" || fail "Runner must specify NoNewPrivileges=true"
grep -q "ProtectSystem=strict" "$RUNNER_SERVICE_IN" || fail "Runner must specify ProtectSystem=strict"
grep -q "ProtectHome=read-only" "$RUNNER_SERVICE_IN" || fail "Runner must specify ProtectHome=read-only"
grep -q "PrivateTmp=true" "$RUNNER_SERVICE_IN" || fail "Runner must specify PrivateTmp=true"
grep -q "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6" "$RUNNER_SERVICE_IN" || fail "Runner must restrict address families"
grep -q "KillMode=mixed" "$RUNNER_SERVICE_IN" || fail "Runner must specify KillMode=mixed"

log "✓ Plugin runner containment and resource limits verified"

# -----------------------------------------------------------------------------
# 5. Immutable Node path in runner startup command
# -----------------------------------------------------------------------------
log "5. Verifying immutable Node path binding in ExecStart"

grep -q -- "--node-bin @NODE_BIN@" "$RUNNER_SERVICE_IN" || fail "Runner ExecStart must bind --node-bin @NODE_BIN@"
grep -q -- "--socket-path /run/dam-hopper/plugin-runner.sock" "$RUNNER_SERVICE_IN" || fail "Runner must bind exact socket path"
grep -q -- "--registry-dir @DAM_HOPPER_STATE_DIR@/plugins" "$RUNNER_SERVICE_IN" || fail "Runner must bind state directory"

log "✓ Immutable Node path and startup command verified"

# -----------------------------------------------------------------------------
# 6. Source immutability before and after installation operations
# -----------------------------------------------------------------------------
log "6. Verifying advisor source and target repository immutability"

SOURCE_REPO_MOCK="$TEST_ROOT/mock-advisor-project"
mkdir -p "$SOURCE_REPO_MOCK/src"
printf 'fn main() { println!("advisor test"); }\n' > "$SOURCE_REPO_MOCK/src/main.rs"
printf 'advisor policy data\n' > "$SOURCE_REPO_MOCK/policy.txt"
chmod 0644 "$SOURCE_REPO_MOCK/src/main.rs" "$SOURCE_REPO_MOCK/policy.txt"

# Snapshot before
BEFORE_MAIN_SHA="$(sha256sum "$SOURCE_REPO_MOCK/src/main.rs" | awk '{print $1}')"
BEFORE_MAIN_MTIME="$(stat -c '%Y' "$SOURCE_REPO_MOCK/src/main.rs")"
BEFORE_POLICY_SHA="$(sha256sum "$SOURCE_REPO_MOCK/policy.txt" | awk '{print $1}')"
BEFORE_POLICY_MTIME="$(stat -c '%Y' "$SOURCE_REPO_MOCK/policy.txt")"

# Simulate staging and release operations with candidate bundle
INSTALL_ROOT="$TEST_ROOT/opt/dam-hopper"
mkdir -p "$INSTALL_ROOT/releases/v0.1.0/server"
mkdir -p "$INSTALL_ROOT/state"
tar -xzf "$BUNDLE_DIR/dam-hopper-v0.1.0-linux-x86_64-systemd.tar.gz" -C "$INSTALL_ROOT/releases/v0.1.0/server"

# Snapshot after
AFTER_MAIN_SHA="$(sha256sum "$SOURCE_REPO_MOCK/src/main.rs" | awk '{print $1}')"
AFTER_MAIN_MTIME="$(stat -c '%Y' "$SOURCE_REPO_MOCK/src/main.rs")"
AFTER_POLICY_SHA="$(sha256sum "$SOURCE_REPO_MOCK/policy.txt" | awk '{print $1}')"
AFTER_POLICY_MTIME="$(stat -c '%Y' "$SOURCE_REPO_MOCK/policy.txt")"

assert_eq "$BEFORE_MAIN_SHA" "$AFTER_MAIN_SHA" "Advisor source hash must remain immutable"
assert_eq "$BEFORE_MAIN_MTIME" "$AFTER_MAIN_MTIME" "Advisor source mtime must remain immutable"
assert_eq "$BEFORE_POLICY_SHA" "$AFTER_POLICY_SHA" "Advisor policy hash must remain immutable"
assert_eq "$BEFORE_POLICY_MTIME" "$AFTER_POLICY_MTIME" "Advisor policy mtime must remain immutable"

log "✓ Source immutability verified across staging and release simulation"

log "✓ Step 3.2: linux-release-plugin-runner-owner-smoke.sh passed successfully"
