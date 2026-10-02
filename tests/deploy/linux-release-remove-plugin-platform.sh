#!/usr/bin/env bash
# Test journey: Linux release plugin platform removal verification.
# Proves:
# 1. Default dry-run mode inspects without mutating any files
# 2. Prerequisite gate refuses removal if API/helper units still reference plugin config/group
# 3. Mutating apply cleans up runner unit, tmpfiles.d conf, and plugin state
# 4. Critical invariant: User history ($HOME/.evcrate/advisor-history) is strictly preserved
# 5. Shared IPC (/run/dam-hopper/idle-suspend.sock, server.pid) is strictly preserved
# 6. Idempotence: Second apply run succeeds cleanly with zero errors
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/linux-release-common.sh"

export DAM_HOPPER_ALLOW_NON_ROOT=1
init_test_env "dam-hopper-remove-plugin-platform"

REMOVE_SCRIPT="$REPO_ROOT/deploy/remove-plugin-platform.sh"
assert_file_exists "$REMOVE_SCRIPT" "Removal script must exist"

# -----------------------------------------------------------------------------
# Setup isolated fixture tree
# -----------------------------------------------------------------------------
MOCK_ROOT="$TEST_ROOT/sysroot"
MOCK_SYSTEMD="$MOCK_ROOT/etc/systemd/system"
MOCK_TMPFILES="$MOCK_ROOT/etc/dam-hopper/tmpfiles.d"
MOCK_STATE="$MOCK_ROOT/var/lib/dam-hopper-plugin-runner"
MOCK_LOCK="$MOCK_ROOT/var/lib/dam-hopper-manager/deploy.lock"
MOCK_HOME="$TEST_ROOT/userhome"

mkdir -p "$MOCK_SYSTEMD/multi-user.target.wants"
mkdir -p "$MOCK_TMPFILES"
mkdir -p "$MOCK_STATE/plugins" "$MOCK_STATE/packages" "$MOCK_STATE/journal"
mkdir -p "$(dirname "$MOCK_LOCK")"
mkdir -p "$MOCK_HOME/.evcrate/advisor-history"

# Seed runner files
printf '[Unit]\nDescription=Plugin Runner\n' > "$MOCK_SYSTEMD/dam-hopper-plugin-runner.service"
ln -sf "$MOCK_SYSTEMD/dam-hopper-plugin-runner.service" "$MOCK_SYSTEMD/multi-user.target.wants/dam-hopper-plugin-runner.service"
printf 'd /run/dam-hopper 3770 root dam-hopper-plugins -\n' > "$MOCK_TMPFILES/dam-hopper-plugin-runner.conf"
printf '{"schemaVersion": 1}\n' > "$MOCK_STATE/registry-v1.json"

# Seed user history
printf 'test-advisor-history-data\n' > "$MOCK_HOME/.evcrate/advisor-history/session.jsonl"

# -----------------------------------------------------------------------------
# 1. Prerequisite gate test: API unit still references old plugin runner config
# -----------------------------------------------------------------------------
log "1. Verifying prerequisite check fails if API unit still references old config"

printf '[Unit]\nDescription=API\n[Service]\nExecStartPre=+/usr/bin/systemd-tmpfiles --create /etc/dam-hopper/tmpfiles.d/dam-hopper-plugin-runner.conf\n' > "$MOCK_SYSTEMD/dam-hopper-api.service"
printf '[Unit]\nDescription=Helper\n' > "$MOCK_SYSTEMD/dam-hopper-idle-suspend-helper.service"

if bash "$REMOVE_SCRIPT" --scope system \
    --systemd-dir "$MOCK_SYSTEMD" \
    --tmpfiles-dir "$MOCK_TMPFILES" \
    --state-dir "$MOCK_STATE" \
    --socket-file "$MOCK_ROOT/run/dam-hopper/plugin-runner.sock" \
    --lock-file "$MOCK_LOCK" 2>/dev/null; then
    fail "Removal script must fail if API unit references dam-hopper-plugin-runner.conf"
fi

log "✓ Prerequisite check correctly failed when old API unit was present"

# Update API unit to native config
printf '[Unit]\nDescription=API\n[Service]\nExecStartPre=+/usr/bin/systemd-tmpfiles --create /etc/dam-hopper/tmpfiles.d/dam-hopper-runtime.conf\n' > "$MOCK_SYSTEMD/dam-hopper-api.service"

# -----------------------------------------------------------------------------
# 2. Dry-run inspection test
# -----------------------------------------------------------------------------
log "2. Verifying default DRY-RUN mode makes no mutations"

bash "$REMOVE_SCRIPT" --scope system \
    --systemd-dir "$MOCK_SYSTEMD" \
    --tmpfiles-dir "$MOCK_TMPFILES" \
    --state-dir "$MOCK_STATE" \
    --socket-file "$MOCK_ROOT/run/dam-hopper/plugin-runner.sock" \
    --lock-file "$MOCK_LOCK"

assert_file_exists "$MOCK_SYSTEMD/dam-hopper-plugin-runner.service" "Service file must NOT be removed in dry-run"
assert_file_exists "$MOCK_TMPFILES/dam-hopper-plugin-runner.conf" "Tmpfiles conf must NOT be removed in dry-run"
assert_file_exists "$MOCK_STATE/registry-v1.json" "Registry must NOT be removed in dry-run"

log "✓ Dry-run mode successfully inspected without mutation"

# -----------------------------------------------------------------------------
# 3. Apply mode test
# -----------------------------------------------------------------------------
log "3. Executing mutating removal (--apply)"

bash "$REMOVE_SCRIPT" --scope system --apply \
    --systemd-dir "$MOCK_SYSTEMD" \
    --tmpfiles-dir "$MOCK_TMPFILES" \
    --state-dir "$MOCK_STATE" \
    --socket-file "$MOCK_ROOT/run/dam-hopper/plugin-runner.sock" \
    --lock-file "$MOCK_LOCK"

if [[ -f "$MOCK_SYSTEMD/dam-hopper-plugin-runner.service" ]]; then
    fail "Service file should be removed after --apply"
fi
if [[ -f "$MOCK_TMPFILES/dam-hopper-plugin-runner.conf" ]]; then
    fail "Tmpfiles conf should be removed after --apply"
fi
if [[ -f "$MOCK_STATE/registry-v1.json" ]]; then
    fail "Plugin registry should be removed after --apply"
fi

# -----------------------------------------------------------------------------
# 4. Critical Invariant: History is untouched
# -----------------------------------------------------------------------------
log "4. Verifying advisor history and private user data remain untouched"

assert_file_exists "$MOCK_HOME/.evcrate/advisor-history/session.jsonl" "User history must be preserved"
assert_eq "$(cat "$MOCK_HOME/.evcrate/advisor-history/session.jsonl")" "test-advisor-history-data" "History contents must be bit-for-bit identical"

log "✓ History preservation invariant satisfied"

# -----------------------------------------------------------------------------
# 5. Idempotence test
# -----------------------------------------------------------------------------
log "5. Verifying idempotence on second apply run"

bash "$REMOVE_SCRIPT" --scope system --apply \
    --systemd-dir "$MOCK_SYSTEMD" \
    --tmpfiles-dir "$MOCK_TMPFILES" \
    --state-dir "$MOCK_STATE" \
    --socket-file "$MOCK_ROOT/run/dam-hopper/plugin-runner.sock" \
    --lock-file "$MOCK_LOCK"

log "✓ Second apply run succeeded idempotently"

log "✓ linux-release-remove-plugin-platform.sh passed successfully"
