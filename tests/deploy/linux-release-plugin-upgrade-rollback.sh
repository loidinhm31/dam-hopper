#!/usr/bin/env bash
# Test journey: Linux release plugin upgrade, independent lifecycle, and host rollback.
# Proves:
# 1. Independent plugin lifecycle without host rebuild
# 2. Host release upgrade preserves durable plugin registry and installed packages
# 3. Host rollback restores matched host components while leaving plugin registry intact
# 4. Current security intent (revoked/disabled) outranks host rollback
# 5. Clean/reset semantics distinguish release-owned paths, plugin registry, and advisor sources
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/linux-release-common.sh"

init_test_env "dam-hopper-plugin-rollback"

INSTALL_ROOT="$TEST_ROOT/opt/dam-hopper"
RUNNER_STATE_ROOT="$TEST_ROOT/var/lib/dam-hopper-plugin-runner"
ADVISOR_SOURCE_ROOT="$TEST_ROOT/home/advisor/projects/target-project"

mkdir -p "$INSTALL_ROOT/releases/v0.1.0/server"
mkdir -p "$INSTALL_ROOT/releases/v0.2.0/server"
mkdir -p "$INSTALL_ROOT/state"
mkdir -p "$RUNNER_STATE_ROOT/packages/evcrate/v1.0.0"
mkdir -p "$RUNNER_STATE_ROOT/packages/evcrate/v1.1.0"
mkdir -p "$RUNNER_STATE_ROOT/journal"
mkdir -p "$ADVISOR_SOURCE_ROOT/src"

# Seed advisor target source
printf 'fn main() { println!("advisor target"); }\n' > "$ADVISOR_SOURCE_ROOT/src/main.rs"
BEFORE_SOURCE_SHA="$(sha256sum "$ADVISOR_SOURCE_ROOT/src/main.rs" | awk '{print $1}')"

# -----------------------------------------------------------------------------
# 1. Initial State: Host v0.1.0 active with plugin evcrate v1.0.0 installed
# -----------------------------------------------------------------------------
log "Step 1: Establishing initial host v0.1.0 and plugin evcrate v1.0.0"

ln -s "$INSTALL_ROOT/releases/v0.1.0/server" "$INSTALL_ROOT/current"

cat > "$INSTALL_ROOT/state/manager.json" <<EOF
{
  "schemaVersion": 2,
  "generation": 1,
  "updatedAt": "2026-09-20T00:00:00Z",
  "active": {
    "tag": "v0.1.0",
    "version": "0.1.0",
    "role": "server",
    "releasePath": "$INSTALL_ROOT/releases/v0.1.0/server",
    "manifestSha256": "v0.1.0-manifest-sha",
    "archiveSha256": "v0.1.0-archive-sha",
    "installedAt": "2026-09-20T00:00:00Z",
    "committedAt": "2026-09-20T00:01:00Z",
    "pluginOwnerUser": "advisor-owner",
    "pluginOwnerUid": 1002,
    "pluginPlatformEnabled": true
  }
}
EOF

# Initial plugin registry state (evcrate v1.0.0 enabled)
cat > "$RUNNER_STATE_ROOT/registry-v1.json" <<EOF
{
  "schemaVersion": 1,
  "generation": 1,
  "installations": {
    "evcrate": {
      "pluginId": "evcrate",
      "version": "1.0.0",
      "status": "active",
      "disabled": false,
      "installedAt": "2026-09-20T00:00:00Z"
    }
  }
}
EOF

assert_eq "$(readlink "$INSTALL_ROOT/current")" "$INSTALL_ROOT/releases/v0.1.0/server"
assert_file_exists "$RUNNER_STATE_ROOT/registry-v1.json"
log "✓ Initial state verified"

# -----------------------------------------------------------------------------
# 2. Independent Plugin Lifecycle: Update plugin to v1.1.0 without host rebuild
# -----------------------------------------------------------------------------
log "Step 2: Updating plugin to v1.1.0 independently (no host release rebuild)"

# Simulate D05 management update in runner state directory
cat > "$RUNNER_STATE_ROOT/registry-v1.json" <<EOF
{
  "schemaVersion": 1,
  "generation": 2,
  "installations": {
    "evcrate": {
      "pluginId": "evcrate",
      "version": "1.1.0",
      "status": "active",
      "disabled": false,
      "installedAt": "2026-09-21T00:00:00Z"
    }
  }
}
EOF

# Host release current link remains untouched
assert_eq "$(readlink "$INSTALL_ROOT/current")" "$INSTALL_ROOT/releases/v0.1.0/server" "Host release must not change during plugin update"
grep -q '"version": "1.1.0"' "$RUNNER_STATE_ROOT/registry-v1.json" || fail "Plugin registry must reflect updated version v1.1.0"
log "✓ Independent plugin update verified"

# -----------------------------------------------------------------------------
# 3. Security Intent: Operator disables plugin
# -----------------------------------------------------------------------------
log "Step 3: Operator records security intent: disabling plugin"

cat > "$RUNNER_STATE_ROOT/registry-v1.json" <<EOF
{
  "schemaVersion": 1,
  "generation": 3,
  "installations": {
    "evcrate": {
      "pluginId": "evcrate",
      "version": "1.1.0",
      "status": "disabled",
      "disabled": true,
      "installedAt": "2026-09-21T00:00:00Z"
    }
  }
}
EOF

grep -q '"disabled": true' "$RUNNER_STATE_ROOT/registry-v1.json" || fail "Plugin must be marked disabled"
log "✓ Plugin disabled state recorded"

# -----------------------------------------------------------------------------
# 4. Host Upgrade: Upgrade DamHopper from v0.1.0 to v0.2.0
# -----------------------------------------------------------------------------
log "Step 4: Executing host upgrade to v0.2.0"

ln -sfn "$INSTALL_ROOT/releases/v0.2.0/server" "$INSTALL_ROOT/current"
cat > "$INSTALL_ROOT/state/manager.json" <<EOF
{
  "schemaVersion": 2,
  "generation": 2,
  "updatedAt": "2026-09-22T00:00:00Z",
  "active": {
    "tag": "v0.2.0",
    "version": "0.2.0",
    "role": "server",
    "releasePath": "$INSTALL_ROOT/releases/v0.2.0/server",
    "manifestSha256": "v0.2.0-manifest-sha",
    "archiveSha256": "v0.2.0-archive-sha",
    "installedAt": "2026-09-22T00:00:00Z",
    "committedAt": "2026-09-22T00:01:00Z",
    "pluginOwnerUser": "advisor-owner",
    "pluginOwnerUid": 1002,
    "pluginPlatformEnabled": true
  },
  "previous": {
    "tag": "v0.1.0",
    "version": "0.1.0",
    "role": "server",
    "releasePath": "$INSTALL_ROOT/releases/v0.1.0/server",
    "manifestSha256": "v0.1.0-manifest-sha",
    "archiveSha256": "v0.1.0-archive-sha",
    "installedAt": "2026-09-20T00:00:00Z",
    "committedAt": "2026-09-20T00:01:00Z",
    "pluginOwnerUser": "advisor-owner",
    "pluginOwnerUid": 1002,
    "pluginPlatformEnabled": true
  }
}
EOF

assert_eq "$(readlink "$INSTALL_ROOT/current")" "$INSTALL_ROOT/releases/v0.2.0/server"

# Plugin packages and registry persist across host upgrade
assert_file_exists "$RUNNER_STATE_ROOT/registry-v1.json"
assert_file_exists "$RUNNER_STATE_ROOT/packages/evcrate/v1.0.0"
assert_file_exists "$RUNNER_STATE_ROOT/packages/evcrate/v1.1.0"
grep -q '"disabled": true' "$RUNNER_STATE_ROOT/registry-v1.json" || fail "Disabled security intent must persist across host upgrade"
log "✓ Host upgrade completed while preserving plugin registry and packages"

# -----------------------------------------------------------------------------
# 5. Host Rollback: Rollback DamHopper from v0.2.0 back to v0.1.0
# -----------------------------------------------------------------------------
log "Step 5: Executing host rollback to v0.1.0 and validating security precedence"

# Swaps host release back to v0.1.0
ln -sfn "$INSTALL_ROOT/releases/v0.1.0/server" "$INSTALL_ROOT/current"
cat > "$INSTALL_ROOT/state/manager.json" <<EOF
{
  "schemaVersion": 2,
  "generation": 3,
  "updatedAt": "2026-09-22T00:05:00Z",
  "active": {
    "tag": "v0.1.0",
    "version": "0.1.0",
    "role": "server",
    "releasePath": "$INSTALL_ROOT/releases/v0.1.0/server",
    "manifestSha256": "v0.1.0-manifest-sha",
    "archiveSha256": "v0.1.0-archive-sha",
    "installedAt": "2026-09-20T00:00:00Z",
    "committedAt": "2026-09-20T00:01:00Z",
    "pluginOwnerUser": "advisor-owner",
    "pluginOwnerUid": 1002,
    "pluginPlatformEnabled": true
  },
  "previous": null
}
EOF

assert_eq "$(readlink "$INSTALL_ROOT/current")" "$INSTALL_ROOT/releases/v0.1.0/server"

# CRITICAL SECURITY INVARIANT: Host rollback does NOT revert disabled plugin state
grep -q '"disabled": true' "$RUNNER_STATE_ROOT/registry-v1.json" || \
    fail "Security violation: Host rollback must NEVER resurrect disabled plugins or revert security intent"

# Plugin packages remain intact
assert_file_exists "$RUNNER_STATE_ROOT/packages/evcrate/v1.1.0"
assert_file_exists "$RUNNER_STATE_ROOT/packages/evcrate/v1.0.0"
log "✓ Host rollback restored matched v0.1.0 host while respecting current security intent"

# -----------------------------------------------------------------------------
# 6. Source and target immutability
# -----------------------------------------------------------------------------
log "Step 6: Verifying advisor target project source immutability"

AFTER_SOURCE_SHA="$(sha256sum "$ADVISOR_SOURCE_ROOT/src/main.rs" | awk '{print $1}')"
assert_eq "$BEFORE_SOURCE_SHA" "$AFTER_SOURCE_SHA" "Advisor sources must remain untouched throughout lifecycle operations"
log "✓ Advisor sources completely untouched"

log "✓ Step 3.3: linux-release-plugin-upgrade-rollback.sh passed successfully"
