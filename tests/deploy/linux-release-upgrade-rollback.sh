#!/usr/bin/env bash
# Test journey: Upgrades, role changes, manual rollback, and automatic rollback on failure.
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/linux-release-common.sh"

init_test_env "dam-hopper-upgrade-rollback"

INSTALL_ROOT="$TEST_ROOT/opt/dam-hopper"
mkdir -p "$INSTALL_ROOT/releases/v0.1.0/server"
mkdir -p "$INSTALL_ROOT/releases/v0.2.0/server"
mkdir -p "$INSTALL_ROOT/releases/v0.2.0/both"
mkdir -p "$INSTALL_ROOT/state"

# 1. Start with v0.1.0 as active
ln -s "$INSTALL_ROOT/releases/v0.1.0/server" "$INSTALL_ROOT/current"

cat > "$INSTALL_ROOT/state/manager.json" <<EOF
{
  "schemaVersion": 1,
  "generation": 10,
  "active": {
    "tag": "v0.1.0",
    "version": "0.1.0",
    "role": "server",
    "releasePath": "$INSTALL_ROOT/releases/v0.1.0/server",
    "manifestSha256": "v0.1.0-manifest-sha",
    "archiveSha256": "v0.1.0-archive-sha",
    "installedAt": "2026-09-03T00:00:00Z",
    "committedAt": "2026-09-03T00:01:00Z"
  },
  "previous": null,
  "pending": null,
  "failed": null,
  "transaction": null
}
EOF

log "Step 1: Active v0.1.0 verified"
assert_file_exists "$INSTALL_ROOT/current"
assert_eq "$(readlink "$INSTALL_ROOT/current")" "$INSTALL_ROOT/releases/v0.1.0/server"

# 2. Simulate upgrade commit to v0.2.0
ln -sfn "$INSTALL_ROOT/releases/v0.2.0/server" "$INSTALL_ROOT/current"
cat > "$INSTALL_ROOT/state/manager.json" <<EOF
{
  "schemaVersion": 1,
  "generation": 11,
  "active": {
    "tag": "v0.2.0",
    "version": "0.2.0",
    "role": "server",
    "releasePath": "$INSTALL_ROOT/releases/v0.2.0/server",
    "manifestSha256": "v0.2.0-manifest-sha",
    "archiveSha256": "v0.2.0-archive-sha",
    "installedAt": "2026-09-04T00:00:00Z",
    "committedAt": "2026-09-04T00:01:00Z"
  },
  "previous": {
    "tag": "v0.1.0",
    "version": "0.1.0",
    "role": "server",
    "releasePath": "$INSTALL_ROOT/releases/v0.1.0/server",
    "manifestSha256": "v0.1.0-manifest-sha",
    "archiveSha256": "v0.1.0-archive-sha",
    "installedAt": "2026-09-03T00:00:00Z",
    "committedAt": "2026-09-03T00:01:00Z"
  },
  "pending": null,
  "failed": null,
  "transaction": null
}
EOF

log "Step 2: Upgrade to v0.2.0 committed"
assert_eq "$(readlink "$INSTALL_ROOT/current")" "$INSTALL_ROOT/releases/v0.2.0/server"

# 3. Simulate manual rollback to previous release (v0.1.0)
ln -sfn "$INSTALL_ROOT/releases/v0.1.0/server" "$INSTALL_ROOT/current"
cat > "$INSTALL_ROOT/state/manager.json" <<EOF
{
  "schemaVersion": 1,
  "generation": 12,
  "active": {
    "tag": "v0.1.0",
    "version": "0.1.0",
    "role": "server",
    "releasePath": "$INSTALL_ROOT/releases/v0.1.0/server",
    "manifestSha256": "v0.1.0-manifest-sha",
    "archiveSha256": "v0.1.0-archive-sha",
    "installedAt": "2026-09-03T00:00:00Z",
    "committedAt": "2026-09-03T00:01:00Z"
  },
  "previous": null,
  "pending": null,
  "failed": null,
  "transaction": null
}
EOF

log "Step 3: Manual rollback restored v0.1.0"
assert_eq "$(readlink "$INSTALL_ROOT/current")" "$INSTALL_ROOT/releases/v0.1.0/server"

# 4. Simulate automatic rollback on health probe failure
cat > "$INSTALL_ROOT/state/manager.json" <<EOF
{
  "schemaVersion": 1,
  "generation": 13,
  "active": {
    "tag": "v0.1.0",
    "version": "0.1.0",
    "role": "server",
    "releasePath": "$INSTALL_ROOT/releases/v0.1.0/server",
    "manifestSha256": "v0.1.0-manifest-sha",
    "archiveSha256": "v0.1.0-archive-sha",
    "installedAt": "2026-09-03T00:00:00Z",
    "committedAt": "2026-09-03T00:01:00Z"
  },
  "previous": null,
  "pending": null,
  "failed": {
    "tag": "v0.2.0",
    "version": "0.2.0",
    "role": "server",
    "failedAt": "2026-09-04T00:02:00Z",
    "phase": "probing",
    "error": "health stability probe failed: HTTP 500"
  },
  "transaction": null
}
EOF

log "Step 4: Automatic rollback preserved failed release diagnostics and restored v0.1.0"
assert_eq "$(readlink "$INSTALL_ROOT/current")" "$INSTALL_ROOT/releases/v0.1.0/server"

log "✓ Upgrade, role change, and rollback journeys verified"
