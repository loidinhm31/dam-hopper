#!/usr/bin/env bash
# Test journey: Security, least-privilege, file modes, and secret isolation.
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/linux-release-common.sh"

init_test_env "dam-hopper-security"

# 1. Verify unit template security directives
API_UNIT="$REPO_ROOT/deploy/systemd/dam-hopper-api.service.in"
WEB_UNIT="$REPO_ROOT/deploy/systemd/dam-hopper-web.service.in"

assert_file_exists "$API_UNIT" "API service unit template must exist"
assert_file_exists "$WEB_UNIT" "Web service unit template must exist"

# Web service unit MUST run as unprivileged user dam-hopper-web
if ! grep -q "User=dam-hopper-web" "$WEB_UNIT"; then
    fail "Web unit template must run as User=dam-hopper-web"
fi

if ! grep -q "Group=dam-hopper-web" "$WEB_UNIT"; then
    fail "Web unit template must run as Group=dam-hopper-web"
fi

# Web service MUST have strict isolation settings
for directive in "ProtectSystem=strict" "ProtectHome=true" "PrivateTmp=true" "NoNewPrivileges=true"; do
    if ! grep -q "$directive" "$WEB_UNIT"; then
        fail "Web unit template missing security directive: $directive"
    fi
done

# API service unit runs as non-root user via @API_USER@ token
if grep -q "User=root" "$API_UNIT"; then
    fail "API unit template must not hardcode User=root (must use @API_USER@)"
fi
if ! grep -q "User=@API_USER@" "$API_UNIT"; then
    fail "API unit template must declare User=@API_USER@"
fi

# 2. Check for accidental leakage of secret/runtime files in release assets or repo
BUNDLE_DIR="$TEST_ROOT/bundle"
mkdir -p "$BUNDLE_DIR"
create_mock_release_bundle "v0.1.0" "$BUNDLE_DIR"

ARCHIVE_TAR="$BUNDLE_DIR/dam-hopper-v0.1.0-linux-x86_64-systemd.tar.gz"
assert_file_exists "$ARCHIVE_TAR"

# Verify archive does NOT contain sensitive files matching check_disallowed_files contract
check_archive_secrets() {
    local tar_file="$1"
    python3 - <<EOF
import tarfile, os, sys

def is_disallowed(path):
    lower = path.lower()
    base = os.path.basename(path).lower()
    return (
        base == ".env"
        or base.startswith(".env.")
        or base == "server.env"
        or base == "server-safety.env"
        or base == "dam-hopper.toml"
        or base == "config.toml"
        or base == "server-token"
        or lower.endswith(".sqlite")
        or lower.endswith(".sqlite-wal")
        or lower.endswith(".sqlite-shm")
        or lower.endswith(".db")
    )

with tarfile.open("$tar_file", "r:*") as tar:
    for member in tar.getmembers():
        if is_disallowed(member.name):
            sys.stderr.write(f"Forbidden file detected in archive: {member.name}\n")
            sys.exit(1)
EOF
}

check_archive_secrets "$ARCHIVE_TAR"

# Also check real built release archive if present
REAL_ARCHIVE="$(find "$REPO_ROOT/artifacts" -name "*.tar.gz" 2>/dev/null | head -n1 || true)"
if [[ -n "$REAL_ARCHIVE" && -f "$REAL_ARCHIVE" ]]; then
    log "Scanning built release archive: $REAL_ARCHIVE"
    check_archive_secrets "$REAL_ARCHIVE"
fi

# Verify scanner catches nested secrets in negative fixture tests
BAD_TAR="$TEST_ROOT/bad.tar.gz"
for nested in "config/.env" "app/.env.production" "data/sessions.sqlite" "secrets/server-safety.env"; do
    tar -czf "$BAD_TAR" -T /dev/null
    python3 -c "import tarfile; t=tarfile.open('$BAD_TAR','w:gz'); import io; t.addfile(tarfile.TarInfo('$nested'), io.BytesIO(b'bad')); t.close()"
    if check_archive_secrets "$BAD_TAR" 2>/dev/null; then
        fail "Security scanner failed to reject nested secret: $nested"
    fi
done

log "✓ Unit sandboxing, role identities, and secret exclusion verified"
