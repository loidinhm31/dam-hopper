#!/usr/bin/env bash
# deploy/remove-plugin-platform.sh
# Safe, audited manual removal of the retired Dam-Hopper plugin runner and platform.
# Default: inspection / dry-run. Requires --apply and explicit --scope system|user.
set -Eeuo pipefail

APPLY=0
SCOPE=""
TARGET_USER=""
PURGE_ACCOUNT=0

SYSTEMD_SYSTEM_DIR="${DAM_HOPPER_SYSTEMD_DIR:-/etc/systemd/system}"
TMPFILES_DIR="${DAM_HOPPER_TMPFILES_DIR:-/etc/dam-hopper/tmpfiles.d}"
RUNNER_STATE_DIR="${DAM_HOPPER_RUNNER_STATE_DIR:-/var/lib/dam-hopper-plugin-runner}"
RUNNER_SOCKET="/run/dam-hopper/plugin-runner.sock"
LOCK_FILE="${DAM_HOPPER_LOCK_FILE:-/var/lib/dam-hopper-manager/deploy.lock}"

usage() {
    cat <<'EOF'
Usage: remove-plugin-platform.sh --scope <system|user> [options]

Retires and cleans up the DamHopper plugin runner and platform.
By default runs in read-only inspection / DRY-RUN mode.

Required:
  --scope <system|user>   Scope of removal (system services or per-user services)

Options:
  --apply                 Execute removal actions (without this flag, dry-run only)
  --user <username>       Target user (required when --scope user)
  --purge-account         Remove auto-created dam-hopper-plugin-runner account/group
                          if no consumers remain (default: preserve as inert)
  -h, --help              Show this help message

Invariants:
  - Requires native release deployed (API/helper units must not reference plugin group/conf)
  - Acquires manager deployment lock during system mutation
  - Preserves user history, $HOME/.evcrate, shared IPC, and retained release archives
  - Idempotent: repeated runs succeed without error
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --apply)
            APPLY=1
            shift
            ;;
        --scope)
            if [[ $# -lt 2 ]]; then
                echo "Error: --scope requires argument 'system' or 'user'" >&2
                exit 1
            fi
            SCOPE="$2"
            shift 2
            ;;
        --user)
            if [[ $# -lt 2 ]]; then
                echo "Error: --user requires a username argument" >&2
                exit 1
            fi
            TARGET_USER="$2"
            shift 2
            ;;
        --purge-account)
            PURGE_ACCOUNT=1
            shift
            ;;
        --systemd-dir)
            SYSTEMD_SYSTEM_DIR="$2"
            shift 2
            ;;
        --tmpfiles-dir)
            TMPFILES_DIR="$2"
            shift 2
            ;;
        --state-dir)
            RUNNER_STATE_DIR="$2"
            shift 2
            ;;
        --socket-file)
            RUNNER_SOCKET="$2"
            shift 2
            ;;
        --lock-file)
            LOCK_FILE="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Error: Unknown argument '$1'" >&2
            usage
            exit 1
            ;;
    esac
done

if [[ -z "$SCOPE" ]]; then
    echo "Error: Missing required --scope <system|user> argument." >&2
    usage
    exit 1
fi

if [[ "$SCOPE" != "system" && "$SCOPE" != "user" ]]; then
    echo "Error: Invalid scope '$SCOPE'. Must be 'system' or 'user'." >&2
    exit 1
fi

if [[ "$SCOPE" == "user" && -z "$TARGET_USER" ]]; then
    echo "Error: --scope user requires --user <username>." >&2
    exit 1
fi

echo "=== DamHopper Plugin Platform Removal ==="
echo "Mode: $([[ $APPLY -eq 1 ]] && echo 'APPLY (mutating)' || echo 'DRY-RUN (read-only inspection)')"
echo "Scope: $SCOPE"

# -----------------------------------------------------------------------------
# 1. Protected path validation helper
# -----------------------------------------------------------------------------
assert_safe_path() {
    local target="$1"
    # Never allow removal of root, system dirs, home, advisor history, or shared runtime
    case "$target" in
        */.evcrate*|*advisor-history*|*/releases/*|/run/dam-hopper|/run/dam-hopper/idle-suspend.sock|/run/dam-hopper/server.pid|/|/home|/root|/var|/var/lib|/etc|/opt|/usr)
            echo "FATAL: Refusing removal of protected path: '$target'" >&2
            exit 1
            ;;
    esac
}

# -----------------------------------------------------------------------------
# 2. Scope checks and prerequisites
# -----------------------------------------------------------------------------
if [[ "$SCOPE" == "system" ]]; then
    if [[ "$APPLY" -eq 1 && "${EUID:-$(id -u)}" -ne 0 && "${DAM_HOPPER_ALLOW_NON_ROOT:-0}" -ne 1 ]]; then
        echo "Error: System scope apply requires root privileges (EUID 0)." >&2
        exit 1
    fi

    # Prerequisite: Check that API and helper units do NOT reference obsolete plugin runner / group
    for check_unit in "$SYSTEMD_SYSTEM_DIR/dam-hopper-api.service" "$SYSTEMD_SYSTEM_DIR/dam-hopper-idle-suspend-helper.service"; do
        if [[ -f "$check_unit" ]]; then
            if grep -q "dam-hopper-plugin-runner.conf" "$check_unit" 2>/dev/null; then
                echo "Error: Unit '$check_unit' still references 'dam-hopper-plugin-runner.conf'." >&2
                echo "Deploy native release before retiring plugin platform." >&2
                exit 1
            fi
            if grep -q "dam-hopper-plugins" "$check_unit" 2>/dev/null; then
                echo "Error: Unit '$check_unit' still references 'dam-hopper-plugins' supplementary group." >&2
                echo "Deploy native release before retiring plugin platform." >&2
                exit 1
            fi
        fi
    done

    # Transaction lock acquisition for mutating system operations
    if [[ "$APPLY" -eq 1 ]]; then
        mkdir -p "$(dirname "$LOCK_FILE")" 2>/dev/null || true
        exec 200>"$LOCK_FILE"
        if ! flock -n 200; then
            echo "Error: Could not acquire release manager deployment lock ($LOCK_FILE)." >&2
            echo "Another release or deployment operation is in progress." >&2
            exit 1
        fi
    fi

elif [[ "$SCOPE" == "user" ]]; then
    # Detect user DBus / systemd availability
    if command -v systemctl >/dev/null 2>&1; then
        if ! systemctl --user list-units >/dev/null 2>&1; then
            echo "Notice: User systemd bus is unavailable for target session." >&2
            echo "Skipping active unit control; proceeding with file allowlist inspection only." >&2
        fi
    fi
fi

# -----------------------------------------------------------------------------
# 3. Path allowlist definition
# -----------------------------------------------------------------------------
SYSTEM_ALLOWLIST=(
    "$SYSTEMD_SYSTEM_DIR/dam-hopper-plugin-runner.service"
    "$SYSTEMD_SYSTEM_DIR/multi-user.target.wants/dam-hopper-plugin-runner.service"
    "$TMPFILES_DIR/dam-hopper-plugin-runner.conf"
    "/etc/tmpfiles.d/dam-hopper-plugin-runner.conf"
    "$RUNNER_SOCKET"
    "$RUNNER_STATE_DIR/plugins"
    "$RUNNER_STATE_DIR/packages"
    "$RUNNER_STATE_DIR/journal"
    "$RUNNER_STATE_DIR/registry-v1.json"
)

# -----------------------------------------------------------------------------
# 4. Service stop and disable
# -----------------------------------------------------------------------------
if [[ "$SCOPE" == "system" ]]; then
    if [[ "$SYSTEMD_SYSTEM_DIR" == "/etc/systemd/system" && "${DAM_HOPPER_ALLOW_NON_ROOT:-0}" -ne 1 ]] && command -v systemctl >/dev/null 2>&1; then
        RUNNER_UNIT="dam-hopper-plugin-runner.service"
        if systemctl is-active --quiet "$RUNNER_UNIT" 2>/dev/null; then
            echo "--> Found active unit: $RUNNER_UNIT"
            if [[ "$APPLY" -eq 1 ]]; then
                echo "Stopping $RUNNER_UNIT..."
                systemctl stop "$RUNNER_UNIT"
                if systemctl is-active --quiet "$RUNNER_UNIT" 2>/dev/null; then
                    echo "Error: Failed to stop $RUNNER_UNIT." >&2
                    exit 1
                fi
            else
                echo "[DRY-RUN] Would stop $RUNNER_UNIT"
            fi
        fi

        if systemctl is-enabled --quiet "$RUNNER_UNIT" 2>/dev/null; then
            echo "--> Unit $RUNNER_UNIT is enabled"
            if [[ "$APPLY" -eq 1 ]]; then
                echo "Disabling $RUNNER_UNIT..."
                systemctl disable "$RUNNER_UNIT" 2>/dev/null || true
            else
                echo "[DRY-RUN] Would disable $RUNNER_UNIT"
            fi
        fi
    fi

    # -------------------------------------------------------------------------
    # 5. Remove allowlisted system artifacts
    # -------------------------------------------------------------------------
    echo "--> Processing system path allowlist..."
    for item in "${SYSTEM_ALLOWLIST[@]}"; do
        assert_safe_path "$item"
        if [[ -e "$item" || -L "$item" ]]; then
            # Verify it is not a symlink to a protected destination
            if [[ -L "$item" ]]; then
                target_dest="$(readlink -f "$item" || true)"
                assert_safe_path "$target_dest"
            fi

            if [[ "$APPLY" -eq 1 ]]; then
                echo "Removing: $item"
                rm -rf -- "$item"
            else
                echo "[DRY-RUN] Would remove: $item"
            fi
        fi
    done

    # Remove state directory if empty or runner-only
    if [[ -d "$RUNNER_STATE_DIR" ]]; then
        assert_safe_path "$RUNNER_STATE_DIR"
        # Only remove if directory has no unexpected files
        remaining_count=$(find "$RUNNER_STATE_DIR" -mindepth 1 2>/dev/null | wc -l)
        if [[ "$remaining_count" -eq 0 ]]; then
            if [[ "$APPLY" -eq 1 ]]; then
                echo "Removing empty runner state directory: $RUNNER_STATE_DIR"
                rmdir "$RUNNER_STATE_DIR" 2>/dev/null || true
            else
                echo "[DRY-RUN] Would remove empty runner state directory: $RUNNER_STATE_DIR"
            fi
        else
            echo "Notice: Non-plugin contents remain in $RUNNER_STATE_DIR; leaving intact."
        fi
    fi

    # Systemd daemon reload and reset-failed
    if [[ "$APPLY" -eq 1 && "$SYSTEMD_SYSTEM_DIR" == "/etc/systemd/system" && "${DAM_HOPPER_ALLOW_NON_ROOT:-0}" -ne 1 && $(command -v systemctl 2>/dev/null) ]]; then
        systemctl daemon-reload || true
        systemctl reset-failed dam-hopper-plugin-runner.service 2>/dev/null || true
    fi

    # Verify absence
    if [[ "$SYSTEMD_SYSTEM_DIR" == "/etc/systemd/system" && "${DAM_HOPPER_ALLOW_NON_ROOT:-0}" -ne 1 ]] && command -v systemctl >/dev/null 2>&1; then
        if systemctl list-unit-files dam-hopper-plugin-runner.service 2>/dev/null | grep -q "dam-hopper-plugin-runner"; then
            if [[ "$APPLY" -eq 1 ]]; then
                echo "Warning: Unit file still visible in systemd after removal." >&2
            fi
        else
            echo "✓ Verified absence: dam-hopper-plugin-runner.service"
        fi
    fi

elif [[ "$SCOPE" == "user" ]]; then
    USER_HOME="$(getent passwd "$TARGET_USER" 2>/dev/null | cut -d: -f6 || true)"
    if [[ -z "$USER_HOME" || ! -d "$USER_HOME" ]]; then
        echo "Error: Cannot resolve valid home directory for user '$TARGET_USER'" >&2
        exit 1
    fi
    USER_SYSTEMD_DIR="$USER_HOME/.config/systemd/user"
    USER_RUNNER_UNIT="$USER_SYSTEMD_DIR/dam-hopper-plugin-runner.service"
    USER_WANTS="$USER_SYSTEMD_DIR/default.target.wants/dam-hopper-plugin-runner.service"

    for u_item in "$USER_RUNNER_UNIT" "$USER_WANTS"; do
        assert_safe_path "$u_item"
        if [[ -e "$u_item" || -L "$u_item" ]]; then
            if [[ "$APPLY" -eq 1 ]]; then
                echo "Removing user unit: $u_item"
                rm -f -- "$u_item"
            else
                echo "[DRY-RUN] Would remove user unit: $u_item"
            fi
        fi
    done
fi

# -----------------------------------------------------------------------------
# 6. Account preservation / purge policy
# -----------------------------------------------------------------------------
RUNNER_USER="dam-hopper-plugin-runner"
RUNNER_GROUP="dam-hopper-plugins"

if id "$RUNNER_USER" >/dev/null 2>&1; then
    if [[ "$PURGE_ACCOUNT" -eq 1 && "$APPLY" -eq 1 ]]; then
        echo "--> Checking account consumers for '$RUNNER_USER'..."
        if pgrep -u "$RUNNER_USER" >/dev/null 2>&1; then
            echo "Warning: Processes still running under '$RUNNER_USER'; refusing account deletion." >&2
        else
            echo "Purging dedicated runner account '$RUNNER_USER'..."
            userdel "$RUNNER_USER" 2>/dev/null || true
            if getent group "$RUNNER_GROUP" >/dev/null 2>&1; then
                groupdel "$RUNNER_GROUP" 2>/dev/null || true
            fi
            echo "✓ Purged runner account and group."
        fi
    else
        echo "Notice: Preserving '$RUNNER_USER' and '$RUNNER_GROUP' as inert remainder."
        echo "  (Pass explicit --purge-account to delete once all consumers are absent)"
    fi
fi

echo "=== Plugin Platform Removal Complete ==="
exit 0
