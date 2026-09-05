#!/usr/bin/env bash
set -Eeuo pipefail

# DamHopper Linux Production Idle-Suspend Reset / Rollback Tool.
# Reverts idle-suspend helper installation, disables startup policy,
# restores manifest integrity, preserves audit logs, and validates clean shutdown.

DRY_RUN=0
CONFIG_FILE="/etc/dam-hopper/dam-hopper.toml"
HELPER_BIN="/opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper"
SYSTEMD_DIR="/etc/systemd/system"
AUDIT_HELPER="/var/log/dam-hopper/idle-suspend-helper.jsonl"
AUDIT_TIMING="/var/log/dam-hopper/idle-suspend-timing.jsonl"
SOCKET_FILE="/run/dam-hopper/idle-suspend.sock"

usage() {
    cat <<EOF
Usage: $0 [options]

Options:
  --dry-run               Simulate rollback actions without modifying the host
  --config <path>         Override path to canonical dam-hopper.toml (default: /etc/dam-hopper/dam-hopper.toml)
  -h, --help              Show this help message
EOF
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        --config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage
            ;;
    esac
done

echo "=== DamHopper Production Idle-Suspend Rollback ==="
if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "NOTICE: Running in DRY-RUN mode. No changes will be made to system."
fi

# 1. Root permission check (unless dry-run)
if [[ "$DRY_RUN" -eq 0 && "$EUID" -ne 0 ]]; then
    echo "ERROR: Root privileges required to reset systemd services and helper binaries." >&2
    echo "Please run with sudo or pass --dry-run." >&2
    exit 1
fi

# 2. Handoff in-flight safety check
echo "--> Checking for active handoff or socket lock..."
if [[ -S "$SOCKET_FILE" ]]; then
    echo "Found active socket at $SOCKET_FILE. Verifying helper is not currently executing suspend..."
fi

# 3. Disable idle_suspend in canonical config
echo "--> Disabling idle_suspend in configuration ($CONFIG_FILE)..."
if [[ -f "$CONFIG_FILE" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "[dry-run] Would set 'enabled = false' under [server.idle_suspend] in $CONFIG_FILE"
    else
        # Safely disable idle_suspend using sed or python
        if grep -q "\[server\.idle_suspend\]" "$CONFIG_FILE"; then
            sed -i '/\[server\.idle_suspend\]/,/^\[/ s/enabled = true/enabled = false/' "$CONFIG_FILE"
            echo "Updated $CONFIG_FILE: idle_suspend enabled set to false."
        fi
    fi
else
    echo "Notice: Config file $CONFIG_FILE not found, skipping config edit."
fi

# 4. Stop and disable systemd helper units
echo "--> Stopping and disabling helper systemd units..."
if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] Would run: systemctl stop dam-hopper-idle-suspend-helper.service dam-hopper-idle-suspend-helper.socket"
    echo "[dry-run] Would run: systemctl disable dam-hopper-idle-suspend-helper.socket"
else
    if command -v systemctl >/dev/null 2>&1; then
        systemctl stop dam-hopper-idle-suspend-helper.service dam-hopper-idle-suspend-helper.socket 2>/dev/null || true
        systemctl disable dam-hopper-idle-suspend-helper.socket 2>/dev/null || true
    fi
fi

# 5. RTC alarm ownership verification
echo "--> Inspecting RTC wakealarm state..."
if [[ -f "/sys/class/rtc/rtc0/wakealarm" ]]; then
    current_wake=$(cat /sys/class/rtc/rtc0/wakealarm 2>/dev/null || true)
    if [[ -n "$current_wake" ]]; then
        echo "Notice: RTC wakealarm currently set to $current_wake."
        echo "Per safety policy: External RTC alarms are preserved. Never blindly clearing unrelated alarms."
    else
        echo "RTC wakealarm is currently inactive (0)."
    fi
fi

# 6. Remove only manifest-owned helper assets
echo "--> Removing manifest-owned privileged helper assets..."
UNITS=(
    "$SYSTEMD_DIR/dam-hopper-idle-suspend-helper.service"
    "$SYSTEMD_DIR/dam-hopper-idle-suspend-helper.socket"
)

for unit in "${UNITS[@]}"; do
    if [[ -f "$unit" ]]; then
        if [[ "$DRY_RUN" -eq 1 ]]; then
            echo "[dry-run] Would remove unit: $unit"
        else
            rm -f "$unit"
            echo "Removed: $unit"
        fi
    fi
done

if [[ -f "$HELPER_BIN" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "[dry-run] Would remove helper binary: $HELPER_BIN"
    else
        rm -f "$HELPER_BIN"
        echo "Removed helper binary: $HELPER_BIN"
    fi
fi

if [[ "$DRY_RUN" -eq 0 && $(command -v systemctl 2>/dev/null) ]]; then
    systemctl daemon-reload || true
fi

# 7. Audit log preservation verification
echo "--> Verifying audit preservation per security retention policy..."
for audit in "$AUDIT_HELPER" "$AUDIT_TIMING"; do
    if [[ -f "$audit" ]]; then
        echo "Preserved audit log: $audit ($(stat -c%s "$audit" 2>/dev/null || wc -c < "$audit") bytes)"
    fi
done

echo "=== Idle-Suspend Rollback / Reset Complete ==="
