#!/usr/bin/env bash
# Test journey: Reset/rollback tool behavior and security invariants.
# Validates canonical default, metadata pre-checks, symlink refusal,
# identity-preserving atomic edit, dry-run safety, and TOML validity.
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/linux-release-common.sh"

init_test_env "dam-hopper-reset-smoke"

RESET_SCRIPT="$REPO_ROOT/deploy/reset-linux-production.sh"
assert_file_exists "$RESET_SCRIPT" "Reset script must exist"

# 1. Verify --help documents canonical default path
log "Testing reset script help output"
HELP_OUT="$("$RESET_SCRIPT" --help 2>&1 || true)"
if ! echo "$HELP_OUT" | grep -q -- "--config <path>.*default: /var/lib/dam-hopper/dam-hopper.toml"; then
    fail "Reset script --help must document canonical default /var/lib/dam-hopper/dam-hopper.toml"
fi

# 2. Setup mock environment for identity and config testing
MOCK_DIR="$TEST_ROOT/reset-mock"
mkdir -p "$MOCK_DIR"

CURRENT_USER="$(id -un)"
CURRENT_GROUP="$(id -gn)"
CURRENT_UID="$(id -u)"
CURRENT_GID="$(id -g)"

MOCK_UNIT="$MOCK_DIR/dam-hopper-api.service"
cat > "$MOCK_UNIT" <<EOF
[Unit]
Description=DamHopper API Server

[Service]
User=$CURRENT_USER
Group=$CURRENT_GROUP
EOF

export DAM_HOPPER_API_UNIT="$MOCK_UNIT"

# 3. Verify refusal when config file does not exist
log "Testing refusal on missing config file"
MISSING_CONFIG="$MOCK_DIR/nonexistent.toml"
if "$RESET_SCRIPT" --dry-run --config "$MISSING_CONFIG" 2>/dev/null; then
    fail "Reset script must fail when config file does not exist"
fi

# 4. Verify refusal on symbolic link config file
log "Testing refusal on symbolic link config"
REAL_CONFIG="$MOCK_DIR/real.toml"
LINK_CONFIG="$MOCK_DIR/link.toml"
cat > "$REAL_CONFIG" <<EOF
[server.idle_suspend]
enabled = true
EOF
chmod 0600 "$REAL_CONFIG"
ln -s "$REAL_CONFIG" "$LINK_CONFIG"

if "$RESET_SCRIPT" --dry-run --config "$LINK_CONFIG" 2>/dev/null; then
    fail "Reset script must refuse symbolic link config file"
fi
rm -f "$LINK_CONFIG" "$REAL_CONFIG"

# 5. Verify refusal on non-regular file (directory)
log "Testing refusal on directory config"
DIR_CONFIG="$MOCK_DIR/dir.toml"
mkdir -p "$DIR_CONFIG"
if "$RESET_SCRIPT" --dry-run --config "$DIR_CONFIG" 2>/dev/null; then
    fail "Reset script must refuse non-regular config file"
fi
rmdir "$DIR_CONFIG"

# 6. Verify refusal on metadata mismatch (wrong mode 0644 instead of 0600)
log "Testing refusal on mode mismatch"
WRONG_MODE_CONFIG="$MOCK_DIR/wrong_mode.toml"
cat > "$WRONG_MODE_CONFIG" <<EOF
[server.idle_suspend]
enabled = true
EOF
chmod 0644 "$WRONG_MODE_CONFIG"
if "$RESET_SCRIPT" --dry-run --config "$WRONG_MODE_CONFIG" 2>/dev/null; then
    fail "Reset script must refuse config with mode 0644 (requires 0600)"
fi
rm -f "$WRONG_MODE_CONFIG"

# 7. Verify --dry-run observation-only behavior
log "Testing dry-run observation-only invariance"
VALID_CONFIG="$MOCK_DIR/canonical.toml"
cat > "$VALID_CONFIG" <<EOF
[workspace]
name = "default"

[server.idle_suspend]
enabled = true
EOF
chmod 0600 "$VALID_CONFIG"
BEFORE_HASH="$(sha256sum "$VALID_CONFIG" | awk '{print $1}')"

DRY_RUN_OUT="$("$RESET_SCRIPT" --dry-run --config "$VALID_CONFIG")"
if ! echo "$DRY_RUN_OUT" | grep -q "Would set 'enabled = false' under \[server.idle_suspend\]"; then
    fail "Dry-run output missing expected notice"
fi

AFTER_HASH="$(sha256sum "$VALID_CONFIG" | awk '{print $1}')"
if [[ "$BEFORE_HASH" != "$AFTER_HASH" ]]; then
    fail "Dry run modified configuration file bytes"
fi

# 8. Verify live execution atomic update
log "Testing live atomic update and post-condition verification"
# In test environment, EUID is non-root, so we test the python logic directly
python3 - "$MOCK_UNIT" "$VALID_CONFIG" "0" <<'PY'
import sys, subprocess, os
# Directly invoke the python edit routine from the reset script
with open("./deploy/reset-linux-production.sh", "r") as f:
    script = f.read()

# Extract the python snippet between python3 - ... <<'PY' and PY
start = script.find("python3 - \"$API_UNIT\" \"$CONFIG_FILE\" \"$DRY_RUN\" <<'PY'")
if start == -1:
    sys.exit("Could not locate python script block in reset script")
start = script.find("\n", start) + 1
end = script.find("\nPY\n", start)
code = script[start:end]

proc = subprocess.run([sys.executable, "-", sys.argv[1], sys.argv[2], sys.argv[3]],
                      input=code, text=True, capture_output=True)
if proc.returncode != 0:
    sys.exit(f"Reset Python execution failed: {proc.stderr}\n{proc.stdout}")
print(proc.stdout)
PY

# Verify that enabled is now false
if ! grep -q "enabled = false" "$VALID_CONFIG"; then
    fail "Live reset did not update enabled = false"
fi

# Verify mode is 0600
FILE_MODE="$(stat -c "%a" "$VALID_CONFIG" 2>/dev/null || stat -f "%p" "$VALID_CONFIG")"
if [[ "$FILE_MODE" != "600" && "$FILE_MODE" != "100600" ]]; then
    fail "Live reset corrupted file permissions: $FILE_MODE"
fi

# Verify parseable TOML
python3 -c "
import tomllib
with open('$VALID_CONFIG', 'rb') as f:
    d = tomllib.load(f)
assert d['server']['idle_suspend']['enabled'] is False
assert d['workspace']['name'] == 'default'
"

log "✓ Reset script canonical default, refusal checks, dry-run safety, and atomic edit verified"
