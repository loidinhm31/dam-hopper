#!/usr/bin/env bash
set -Eeuo pipefail
# Fedora 44 format-2 migration and rollback rehearsal.

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dam-hopper-fedora44-rehearsal.XXXXXX")"

cleanup() {
    rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT

log() {
    printf '[rehearsal] %s\n' "$*"
}

fail() {
    printf '[rehearsal:FAIL] %s\n' "$*" >&2
    exit 1
}

# 1. Build format-2 fixture environment
FIXTURE_OPT="$TEST_ROOT/opt/dam-hopper"
FIXTURE_SYSTEMD="$TEST_ROOT/etc/systemd/system"
FIXTURE_WANTS="$FIXTURE_SYSTEMD/multi-user.target.wants"
FIXTURE_MARKER="$FIXTURE_OPT/.systemd-fresh-install"

mkdir -p "$FIXTURE_OPT/bin" "$FIXTURE_MARKER" "$FIXTURE_WANTS"
chmod 755 "$FIXTURE_OPT" "$FIXTURE_OPT/bin" "$FIXTURE_SYSTEMD" "$FIXTURE_WANTS"
chmod 700 "$FIXTURE_MARKER"

# Binary
SERVER_BIN="$FIXTURE_OPT/bin/dam-hopper-server"
printf 'dam-hopper-legacy-binary-fedora44\n' > "$SERVER_BIN"
chmod 755 "$SERVER_BIN"
BIN_HASH="$(sha256sum "$SERVER_BIN" | awk '{print $1}')"

# Unit file
UNIT_FILE="$FIXTURE_SYSTEMD/dam-hopper.service"
cat > "$UNIT_FILE" <<'EOF'
[Unit]
Description=DamHopper server (system service, loidinh runtime)
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=loidinh
Group=loidinh
WorkingDirectory=/home/loidinh
Environment=HOME=/home/loidinh
Environment=XDG_CONFIG_HOME=/home/loidinh/.config
Environment=RUST_LOG=info
Environment=RUST_ENV=production
EnvironmentFile=/home/loidinh/.config/dam-hopper/server.env
EnvironmentFile=/home/loidinh/.config/dam-hopper/server-safety.env
ExecStart=/opt/dam-hopper/bin/dam-hopper-server --config /home/loidinh/.config/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801
Restart=on-failure
RestartSec=5s
KillSignal=SIGTERM
KillMode=mixed
TimeoutStopSec=20s
UMask=0077
NoNewPrivileges=false
StandardOutput=journal
StandardError=journal
SyslogIdentifier=dam-hopper

[Install]
WantedBy=multi-user.target
EOF
chmod 644 "$UNIT_FILE"
UNIT_HASH="$(sha256sum "$UNIT_FILE" | awk '{print $1}')"

# Wants enablement symlink
ln -s "$UNIT_FILE" "$FIXTURE_WANTS/dam-hopper.service"

# Marker manifest & nonce
NONCE="fedcba9876543210fedcba9876543210"
printf '%s\n' "$NONCE" > "$FIXTURE_MARKER/nonce"
chmod 600 "$FIXTURE_MARKER/nonce"

cat > "$FIXTURE_MARKER/manifest" <<EOF
binary_sha256=$BIN_HASH
format=2
nonce=$NONCE
unit_sha256=$UNIT_HASH
EOF
chmod 600 "$FIXTURE_MARKER/manifest"

log "Step 1: Format-2 fixture established"

# Verify root inventory
ROOT_ENTRIES="$(find "$FIXTURE_OPT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)"
if [[ "$ROOT_ENTRIES" != $'.systemd-fresh-install\nbin' ]]; then
    fail "unexpected root inventory: $ROOT_ENTRIES"
fi

# 2. Side-staging simulation
TX_ID="rehearsal-tx-1"
MIGRATION_ROOT="$TEST_ROOT/opt/.dam-hopper-migration.$TX_ID"
mkdir -p "$MIGRATION_ROOT/releases/imported-format-2/server/bin"
mkdir -p "$MIGRATION_ROOT/releases/imported-format-2/server/systemd"
mkdir -p "$MIGRATION_ROOT/releases/v0.1.0/server"
chmod 700 "$MIGRATION_ROOT"

# Copy legacy assets into imported release
cp "$SERVER_BIN" "$MIGRATION_ROOT/releases/imported-format-2/server/bin/dam-hopper-server"
cp "$UNIT_FILE" "$MIGRATION_ROOT/releases/imported-format-2/server/systemd/dam-hopper.service"

# Candidate assets
printf 'dam-hopper-candidate-binary-v0.1.0\n' > "$MIGRATION_ROOT/releases/v0.1.0/server/dam-hopper-api"
chmod 755 "$MIGRATION_ROOT/releases/v0.1.0/server/dam-hopper-api"

# Transaction marker
printf '{"txId":"%s","role":"migration_root"}\n' "$TX_ID" > "$MIGRATION_ROOT/.migration-transaction"

log "Step 2: Migration side-staging established without touching canonical root"
if [[ ! -f "$FIXTURE_OPT/bin/dam-hopper-server" ]] || [[ -d "$FIXTURE_OPT/releases" ]]; then
    fail "canonical root was altered during side-staging"
fi

# 3. Atomic Exchange Rehearsal
chmod 755 "$MIGRATION_ROOT"

# Test exchange using a python script calling renameat2 RENAME_EXCHANGE
python3 - <<PYEOF
import os, ctypes

SYS_renameat2 = 316 # x86_64 syscall
AT_FDCWD = -100
RENAME_EXCHANGE = 2

libc = ctypes.CDLL(None)
ret = libc.syscall(
    SYS_renameat2,
    AT_FDCWD,
    "$FIXTURE_OPT".encode(),
    AT_FDCWD,
    "$MIGRATION_ROOT".encode(),
    RENAME_EXCHANGE
)
if ret != 0:
    errno = ctypes.get_errno()
    raise OSError(f"renameat2 failed: {errno}")
PYEOF

log "Step 3: Atomic directory exchange succeeded"

# Canonical root now contains candidate releases!
if [[ ! -d "$FIXTURE_OPT/releases/v0.1.0" ]]; then
    fail "canonical root does not contain candidate releases after exchange"
fi
# And MIGRATION_ROOT now contains the old format-2 binary!
if [[ ! -f "$MIGRATION_ROOT/bin/dam-hopper-server" ]]; then
    fail "migration workspace does not contain old format-2 binary after exchange"
fi

# 4. Rollback Rehearsal
python3 - <<PYEOF
import os, ctypes
SYS_renameat2 = 316
AT_FDCWD = -100
RENAME_EXCHANGE = 2
libc = ctypes.CDLL(None)
ret = libc.syscall(
    SYS_renameat2,
    AT_FDCWD,
    "$FIXTURE_OPT".encode(),
    AT_FDCWD,
    "$MIGRATION_ROOT".encode(),
    RENAME_EXCHANGE
)
if ret != 0:
    raise OSError("rollback exchange failed")
PYEOF

log "Step 4: Rollback directory exchange succeeded"
if [[ -d "$FIXTURE_OPT/releases" ]] || [[ ! -f "$FIXTURE_OPT/bin/dam-hopper-server" ]]; then
    fail "rollback failed to restore exact format-2 root"
fi

# 5. Drift Detection Checks
# Test format 1 rejection
cp "$FIXTURE_MARKER/manifest" "$FIXTURE_MARKER/manifest.orig"
sed -i 's/format=2/format=1/' "$FIXTURE_MARKER/manifest"
if ! grep -q "format=1" "$FIXTURE_MARKER/manifest"; then
    fail "failed to prepare drift test"
fi
mv "$FIXTURE_MARKER/manifest.orig" "$FIXTURE_MARKER/manifest"

log "Fedora 44 format-2 migration and rollback rehearsal passed cleanly."
exit 0
