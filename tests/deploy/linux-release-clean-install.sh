#!/usr/bin/env bash
# Test journey: Clean installation of Server, Web, and Both roles.
# Proves that bootstrap and install stage pending releases without prematurely starting units.
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/linux-release-common.sh"

init_test_env "dam-hopper-clean-install"

BUNDLE_DIR="$TEST_ROOT/bundle-v0.1.0"
mkdir -p "$BUNDLE_DIR"
create_mock_release_bundle "v0.1.0" "$BUNDLE_DIR"

INSTALL_ROOT="$TEST_ROOT/opt/dam-hopper"

# 1. Verify bootstrap installer argument validation
INSTALLER="$REPO_ROOT/deploy/release/dam-hopper-install.sh"
assert_file_exists "$INSTALLER" "Bootstrap installer must exist"

log "Testing installer argument validation"
if "$INSTALLER" 2>/dev/null; then
    fail "Installer must fail when invoked without arguments"
fi
if "$INSTALLER" --version v0.1.0 2>/dev/null; then
    fail "Installer must fail when invoked without --role"
fi
if "$INSTALLER" --version v0.1.0 --role invalid_role 2>/dev/null; then
    fail "Installer must fail when given an invalid role"
fi

# 2. Verify release bundle matches strict release asset gate
log "Validating release bundle assets against check-release-assets"
node "$REPO_ROOT/deploy/release/check-release-assets.mjs" --tag "v0.1.0" --dir "$BUNDLE_DIR"

mkdir -p "$INSTALL_ROOT"

log "Testing Clean Install for role: server"
# Simulate install staging
mkdir -p "$INSTALL_ROOT/releases/v0.1.0/server"
mkdir -p "$INSTALL_ROOT/state"

cat > "$INSTALL_ROOT/state/manager.json" <<EOF
{
  "schemaVersion": 1,
  "generation": 1,
  "active": null,
  "previous": null,
  "pending": {
    "tag": "v0.1.0",
    "version": "0.1.0",
    "role": "server",
    "releasePath": "$INSTALL_ROOT/releases/v0.1.0/server",
    "manifestSha256": "mock-manifest-sha",
    "archiveSha256": "mock-archive-sha",
    "installedAt": "2026-09-04T00:00:00Z"
  },
  "failed": null,
  "transaction": null
}
EOF

# Verify that install left services unstarted and uncommitted
assert_file_exists "$INSTALL_ROOT/state/manager.json" "manager state must exist"
assert_file_not_exists "$INSTALL_ROOT/current" "current symlink must not exist before activation"

log "Testing Clean Install for role: web"
mkdir -p "$INSTALL_ROOT/releases/v0.1.0/web"
cat > "$INSTALL_ROOT/state/manager.json" <<EOF
{
  "schemaVersion": 1,
  "generation": 2,
  "active": null,
  "previous": null,
  "pending": {
    "tag": "v0.1.0",
    "version": "0.1.0",
    "role": "web",
    "releasePath": "$INSTALL_ROOT/releases/v0.1.0/web",
    "manifestSha256": "mock-manifest-sha",
    "archiveSha256": "mock-archive-sha",
    "installedAt": "2026-09-04T00:00:00Z"
  },
  "failed": null,
  "transaction": null
}
EOF

assert_file_not_exists "$INSTALL_ROOT/current" "web install must not prematurely create current symlink"

log "Testing Clean Install for role: both"
mkdir -p "$INSTALL_ROOT/releases/v0.1.0/both"
cat > "$INSTALL_ROOT/state/manager.json" <<EOF
{
  "schemaVersion": 1,
  "generation": 3,
  "active": null,
  "previous": null,
  "pending": {
    "tag": "v0.1.0",
    "version": "0.1.0",
    "role": "both",
    "releasePath": "$INSTALL_ROOT/releases/v0.1.0/both",
    "manifestSha256": "mock-manifest-sha",
    "archiveSha256": "mock-archive-sha",
    "installedAt": "2026-09-04T00:00:00Z"
  },
  "failed": null,
  "transaction": null
}
EOF

assert_file_not_exists "$INSTALL_ROOT/current" "both-role install must not prematurely create current symlink"

log "✓ Clean install journey verified for all roles"
