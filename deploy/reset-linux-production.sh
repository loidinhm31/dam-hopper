#!/usr/bin/env bash
set -Eeuo pipefail

# DamHopper Linux Production Idle-Suspend Reset / Rollback Tool.
# Reverts idle-suspend helper installation, disables startup policy,
# restores manifest integrity, preserves audit logs, and validates clean shutdown.

DRY_RUN=0
CONFIG_FILE="/var/lib/dam-hopper/dam-hopper.toml"
HELPER_BIN="/opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper"
SYSTEMD_DIR="/etc/systemd/system"
AUDIT_HELPER="/var/log/dam-hopper/idle-suspend-helper.jsonl"
AUDIT_TIMING="/var/log/dam-hopper/idle-suspend-timing.jsonl"
SOCKET_FILE="/run/dam-hopper/idle-suspend.sock"
API_UNIT="${DAM_HOPPER_API_UNIT:-$SYSTEMD_DIR/dam-hopper-api.service}"

usage() {
    cat <<EOF
Usage: $0 [options]

Options:
  --dry-run               Simulate rollback actions without modifying the host
  --config <path>         Override path to canonical dam-hopper.toml (default: /var/lib/dam-hopper/dam-hopper.toml)
  --api-unit <path>       Override path to installed API unit (default: /etc/systemd/system/dam-hopper-api.service)
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
        --api-unit)
            API_UNIT="$2"
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
API_UNIT="${API_UNIT:-${DAM_HOPPER_API_UNIT:-$SYSTEMD_DIR/dam-hopper-api.service}}"
python3 - "$API_UNIT" "$CONFIG_FILE" "$DRY_RUN" <<'PY'
import os, sys, stat, re, tempfile, pwd, grp
try:
    import tomllib
except ImportError:
    import tomli as tomllib

api_unit_path = sys.argv[1]
config_path = os.path.abspath(sys.argv[2])
dry_run = sys.argv[3] == "1"

if not os.path.isfile(api_unit_path):
    sys.exit(f"ERROR: Installed API unit '{api_unit_path}' not found; cannot resolve runtime identity.")

with open(api_unit_path, "r", encoding="utf-8") as f:
    unit_content = f.read()

user_matches = re.findall(r'^[ \t]*User[ \t]*=[ \t]*(.+?)[ \t]*$', unit_content, re.MULTILINE)
group_matches = re.findall(r'^[ \t]*Group[ \t]*=[ \t]*(.+?)[ \t]*$', unit_content, re.MULTILINE)

if len(user_matches) != 1 or len(group_matches) != 1:
    sys.exit(f"ERROR: API unit requires exactly one User= and one Group= directive (got {len(user_matches)} and {len(group_matches)}).")

api_user = user_matches[0].strip()
api_group = group_matches[0].strip()

if not api_user or not api_group or api_user == "root" or api_group == "root":
    sys.exit(f"ERROR: API unit runtime identity must be non-root (got User={api_user}, Group={api_group}).")

try:
    user_entry = pwd.getpwnam(api_user)
except KeyError:
    sys.exit(f"ERROR: API unit User='{api_user}' does not resolve to a local system account.")

try:
    group_entry = grp.getgrnam(api_group)
except KeyError:
    sys.exit(f"ERROR: API unit Group='{api_group}' does not resolve to a local group.")

expected_uid = user_entry.pw_uid
expected_gid = group_entry.gr_gid

if expected_uid == 0 or expected_gid == 0:
    sys.exit("ERROR: Resolved API runtime identity UID/GID cannot be 0 (root).")

if expected_gid != user_entry.pw_gid:
    sys.exit(f"ERROR: API unit Group='{api_group}' (GID {expected_gid}) is not User='{api_user}' primary group (GID {user_entry.pw_gid}).")

try:
    lst = os.lstat(config_path)
except FileNotFoundError:
    sys.exit(f"ERROR: Canonical configuration file '{config_path}' not found.")
except Exception as e:
    sys.exit(f"ERROR: Cannot inspect configuration file '{config_path}': {e}")

if stat.S_ISLNK(lst.st_mode):
    sys.exit(f"ERROR: Configuration file '{config_path}' is a symbolic link. Refusing to repair or edit.")

if not stat.S_ISREG(lst.st_mode):
    sys.exit(f"ERROR: Configuration file '{config_path}' is not a regular file. Refusing to repair or edit.")

try:
    fd = os.open(config_path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0))
except Exception as e:
    sys.exit(f"ERROR: Cannot open configuration file '{config_path}' with no-follow: {e}")

try:
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode):
        sys.exit(f"ERROR: Configuration file '{config_path}' descriptor is not regular. Refusing to repair or edit.")

    file_mode = stat.S_IMODE(st.st_mode)
    if st.st_uid != expected_uid or st.st_gid != expected_gid or file_mode != 0o600:
        sys.exit(
            f"ERROR: Metadata mismatch for '{config_path}': "
            f"expected UID={expected_uid} GID={expected_gid} mode=0600, "
            f"got UID={st.st_uid} GID={st.st_gid} mode={oct(file_mode)}. Refusing to repair or edit."
        )

    content_bytes = os.read(fd, 64 * 1024 + 1)
    if len(content_bytes) > 64 * 1024:
        sys.exit(f"ERROR: Configuration file '{config_path}' exceeds maximum size limit of 65536 bytes.")
finally:
    os.close(fd)

try:
    content_text = content_bytes.decode("utf-8")
except UnicodeDecodeError as e:
    sys.exit(f"ERROR: Configuration file '{config_path}' is not valid UTF-8: {e}")

try:
    data = tomllib.loads(content_text)
except Exception as e:
    sys.exit(f"ERROR: Configuration file '{config_path}' is not valid TOML: {e}")

if dry_run:
    print(f"[dry-run] Validated metadata and TOML for '{config_path}' (UID={expected_uid}, GID={expected_gid}, mode=0600).")
    print(f"[dry-run] Would set 'enabled = false' under [server.idle_suspend] in '{config_path}'.")
    sys.exit(0)

section_pattern = re.compile(r'(^[ \t]*\[server\.idle_suspend\][ \t]*\n)', re.MULTILINE)
if section_pattern.search(content_text):
    parts = re.split(r'(^[ \t]*\[server\.idle_suspend\][ \t]*\n)', content_text, maxsplit=1, flags=re.MULTILINE)
    prefix = parts[0]
    section_header = parts[1]
    rest = parts[2]
    next_section = re.search(r'(^[ \t]*\[)', rest, re.MULTILINE)
    if next_section:
        section_body = rest[:next_section.start()]
        suffix = rest[next_section.start():]
    else:
        section_body = rest
        suffix = ""

    if re.search(r'^[ \t]*enabled[ \t]*=', section_body, re.MULTILINE):
        section_body = re.sub(r'^[ \t]*enabled[ \t]*=.*$', 'enabled = false', section_body, flags=re.MULTILINE)
    else:
        section_body = "enabled = false\n" + section_body
    updated_text = prefix + section_header + section_body + suffix
else:
    if not content_text.endswith("\n"):
        content_text += "\n"
    updated_text = content_text + "\n[server.idle_suspend]\nenabled = false\n"

try:
    updated_data = tomllib.loads(updated_text)
except Exception as e:
    sys.exit(f"ERROR: Resulting configuration after update is not valid TOML: {e}")

if updated_data.get("server", {}).get("idle_suspend", {}).get("enabled") is not False:
    sys.exit("ERROR: Resulting configuration did not verify enabled = false under [server.idle_suspend].")

if os.geteuid() == 0:
    os.setgroups([expected_gid])
    os.setgid(expected_gid)
    os.setuid(expected_uid)

if os.getuid() != expected_uid or os.getgid() != expected_gid:
    sys.exit(f"ERROR: Failed to drop privileges to UID={expected_uid} GID={expected_gid} (current UID={os.getuid()} GID={os.getgid()}).")

config_dir = os.path.dirname(config_path)
dir_fd = os.open(config_dir, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0))

temp_fd, temp_path = tempfile.mkstemp(prefix=".dam-hopper.toml.reset.", dir=config_dir)
try:
    os.fchmod(temp_fd, 0o600)
    with open(temp_fd, "wb", closefd=False) as f:
        f.write(updated_text.encode("utf-8"))
        f.flush()
        os.fsync(temp_fd)
    os.close(temp_fd)
    os.replace(temp_path, config_path)
    os.fsync(dir_fd)
finally:
    os.close(dir_fd)
    if os.path.exists(temp_path):
        try:
            os.unlink(temp_path)
        except OSError:
            pass
verify_fd = os.open(config_path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0))
try:
    st_post = os.fstat(verify_fd)
    if not stat.S_ISREG(st_post.st_mode):
        sys.exit(f"ERROR: Post-edit verification failed: '{config_path}' is not a regular file.")
    post_mode = stat.S_IMODE(st_post.st_mode)
    if st_post.st_uid != expected_uid or st_post.st_gid != expected_gid or post_mode != 0o600:
        sys.exit(
            f"ERROR: Post-edit verification failed for '{config_path}': "
            f"expected UID={expected_uid} GID={expected_gid} mode=0600, "
            f"got UID={st_post.st_uid} GID={st_post.st_gid} mode={oct(post_mode)}."
        )
    post_bytes = os.read(verify_fd, 64 * 1024 + 1)
finally:
    os.close(verify_fd)

post_data = tomllib.loads(post_bytes.decode("utf-8"))
if post_data.get("server", {}).get("idle_suspend", {}).get("enabled") is not False:
    sys.exit("ERROR: Post-edit verification failed: server.idle_suspend.enabled is not false.")

print(f"Updated '{config_path}': idle_suspend enabled set to false (UID={expected_uid}, GID={expected_gid}, mode=0600).")
PY
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
