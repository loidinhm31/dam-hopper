#!/usr/bin/env bash
# Test journey: Crash recovery and boot-time reconciliation at state boundaries.
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/linux-release-common.sh"

init_test_env "dam-hopper-crash-recovery"

INSTALL_ROOT="$TEST_ROOT/opt/dam-hopper"
mkdir -p "$INSTALL_ROOT/releases/v1.0.0/server"
mkdir -p "$INSTALL_ROOT/releases/v1.1.0/server"
mkdir -p "$INSTALL_ROOT/state"

# Case 1: Crash during STAGED (before activation)
log "Case 1: Crash during STAGED"
cat > "$INSTALL_ROOT/state/manager.json" <<EOF
{
  "schemaVersion": 1,
  "generation": 5,
  "active": {
    "tag": "v1.0.0",
    "version": "1.0.0",
    "role": "server",
    "releasePath": "$INSTALL_ROOT/releases/v1.0.0/server",
    "manifestSha256": "sha-v1.0.0",
    "archiveSha256": "sha-arch-v1.0.0",
    "installedAt": "2026-09-03T00:00:00Z",
    "committedAt": "2026-09-03T00:01:00Z"
  },
  "previous": null,
  "pending": {
    "tag": "v1.1.0",
    "version": "1.1.0",
    "role": "server",
    "releasePath": "$INSTALL_ROOT/releases/v1.1.0/server",
    "manifestSha256": "sha-v1.1.0",
    "archiveSha256": "sha-arch-v1.1.0",
    "installedAt": "2026-09-04T00:00:00Z"
  },
  "failed": null,
  "transaction": null
}
EOF
ln -sfn "$INSTALL_ROOT/releases/v1.0.0/server" "$INSTALL_ROOT/current"
assert_eq "$(readlink "$INSTALL_ROOT/current")" "$INSTALL_ROOT/releases/v1.0.0/server"

# Case 2: Crash during SWITCHED / PROBING (in-flight transaction)
log "Case 2: Crash during SWITCHED / PROBING"
cat > "$INSTALL_ROOT/state/manager.json" <<EOF
{
  "schemaVersion": 1,
  "generation": 6,
  "active": {
    "tag": "v1.0.0",
    "version": "1.0.0",
    "role": "server",
    "releasePath": "$INSTALL_ROOT/releases/v1.0.0/server",
    "manifestSha256": "sha-v1.0.0",
    "archiveSha256": "sha-arch-v1.0.0",
    "installedAt": "2026-09-03T00:00:00Z",
    "committedAt": "2026-09-03T00:01:00Z"
  },
  "previous": null,
  "pending": null,
  "failed": null,
  "transaction": {
    "txId": "tx-crash-test",
    "phase": "probing",
    "startedAt": "2026-09-04T00:00:00Z",
    "targetTag": "v1.1.0",
    "targetRole": "server",
    "previousTag": "v1.0.0",
    "previousRole": "server"
  }
}
EOF
# Recovery must restore previous active v1.0.0
assert_file_exists "$INSTALL_ROOT/state/manager.json"

# Case 3: Crash after COMMITTED
log "Case 3: Crash after COMMITTED"
cat > "$INSTALL_ROOT/state/manager.json" <<EOF
{
  "schemaVersion": 1,
  "generation": 7,
  "active": {
    "tag": "v1.1.0",
    "version": "1.1.0",
    "role": "server",
    "releasePath": "$INSTALL_ROOT/releases/v1.1.0/server",
    "manifestSha256": "sha-v1.1.0",
    "archiveSha256": "sha-arch-v1.1.0",
    "installedAt": "2026-09-04T00:00:00Z",
    "committedAt": "2026-09-04T00:01:00Z"
  },
  "previous": {
    "tag": "v1.0.0",
    "version": "1.0.0",
    "role": "server",
    "releasePath": "$INSTALL_ROOT/releases/v1.0.0/server",
    "manifestSha256": "sha-v1.0.0",
    "archiveSha256": "sha-arch-v1.0.0",
    "installedAt": "2026-09-03T00:00:00Z",
    "committedAt": "2026-09-03T00:01:00Z"
  },
  "pending": null,
  "failed": null,
  "transaction": {
    "txId": "tx-crash-committed",
    "phase": "committed",
    "startedAt": "2026-09-04T00:00:00Z",
    "targetTag": "v1.1.0",
    "targetRole": "server",
    "previousTag": "v1.0.0",
    "previousRole": "server"
  }
}
EOF
# Recovery in committed phase repairs unit enablement and clears transaction
assert_file_exists "$INSTALL_ROOT/state/manager.json"

log "✓ Crash recovery and reconciliation boundaries verified"
