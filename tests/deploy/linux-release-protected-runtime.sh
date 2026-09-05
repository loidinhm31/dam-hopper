#!/usr/bin/env bash
set -Eeuo pipefail

# This script is intentionally fail-closed. The hooks are administrator-owned
# snapshot/reboot drivers supplied by the protected Fedora runner; they are not
# production fault flags and are never packaged into a release.

BUNDLE_DIR=""
MANAGER_BIN=""
NEXT_BUNDLE_DIR="${DAM_HOPPER_PROTECTED_NEXT_BUNDLE:-}"

usage() {
    cat <<'EOF'
Usage: linux-release-protected-runtime.sh --bundle-dir <release-assets> [options]

Options:
  --bundle-dir <dir>  Directory containing release-manifest.json and archive
  --manager-bin <bin> Manager binary used for the protected run
  --next-bundle-dir <dir>
                      Second release bundle for upgrade and rollback coverage

Required protected-runner environment:
  DAM_HOPPER_PROTECTED_SNAPSHOT=1
  DAM_HOPPER_PROTECTED_RESET_HOOK   root-owned executable snapshot resetter
  DAM_HOPPER_PROTECTED_CRASH_HOOK   root-owned executable boundary killer
  DAM_HOPPER_PROTECTED_REBOOT_HOOK  root-owned executable reboot orchestrator
  DAM_HOPPER_PROTECTED_MIGRATION_HOOK root-owned executable format-2 fixture driver
EOF
    exit 2
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --bundle-dir) BUNDLE_DIR="${2:?missing value for --bundle-dir}"; shift 2 ;;
        --manager-bin) MANAGER_BIN="${2:?missing value for --manager-bin}"; shift 2 ;;
        --next-bundle-dir) NEXT_BUNDLE_DIR="${2:?missing value for --next-bundle-dir}"; shift 2 ;;
        -h|--help) usage ;;
        *) printf 'Unknown argument: %s\n' "$1" >&2; usage ;;
    esac
done

if [[ "${DAM_HOPPER_PROTECTED_SNAPSHOT:-}" != "1" ]]; then
    printf 'Error: DAM_HOPPER_PROTECTED_SNAPSHOT=1 is required; refusing non-disposable host\n' >&2
    exit 1
fi
if [[ "${EUID}" -ne 0 ]]; then
    printf 'Error: protected runtime must run as root\n' >&2
    exit 1
fi

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
MANAGER_BIN="${MANAGER_BIN:-$REPO_ROOT/server/target/release/dam-hopper}"

require_hook() {
    local name="$1"
    local hook="${!name:-}"
    if [[ -z "$hook" || "$hook" != /* || ! -f "$hook" || -L "$hook" || ! -x "$hook" ]]; then
        printf 'Error: %s must be an absolute root-owned executable hook\n' "$name" >&2
        exit 1
    fi
    local owner mode
    owner="$(stat -c '%u' "$hook")"
    mode="$(stat -c '%a' "$hook")"
    if [[ "$owner" != 0 || "$mode" != 755 ]]; then
        printf 'Error: %s must be root-owned with mode 0755\n' "$name" >&2
        exit 1
    fi
    printf '%s\n' "$hook"
}

RESET_HOOK="$(require_hook DAM_HOPPER_PROTECTED_RESET_HOOK)"
CRASH_HOOK="$(require_hook DAM_HOPPER_PROTECTED_CRASH_HOOK)"
REBOOT_HOOK="$(require_hook DAM_HOPPER_PROTECTED_REBOOT_HOOK)"
MIGRATION_HOOK="$(require_hook DAM_HOPPER_PROTECTED_MIGRATION_HOOK)"

if [[ -z "$BUNDLE_DIR" || ! -d "$BUNDLE_DIR" || -L "$BUNDLE_DIR" ]]; then
    printf 'Error: release bundle directory is missing or linked: %s\n' "$BUNDLE_DIR" >&2
    exit 1
fi
if [[ ! -f "$BUNDLE_DIR/release-manifest.json" ]]; then
    printf 'Error: bundle has no release-manifest.json: %s\n' "$BUNDLE_DIR" >&2
    exit 1
fi
ARCHIVE_PATH="$(python3 - "$BUNDLE_DIR/release-manifest.json" <<'PY'
import json
import pathlib
import sys
manifest_path = pathlib.Path(sys.argv[1])
manifest = json.loads(manifest_path.read_text())
archive = manifest["archive"]["name"]
if "/" in archive or "\\" in archive or archive in (".", ".."):
    raise SystemExit("manifest archive name is not a basename")
print(manifest_path.parent / archive)
PY
)"
if [[ ! -f "$ARCHIVE_PATH" || -L "$ARCHIVE_PATH" ]]; then
    printf 'Error: bundle archive is missing or linked: %s\n' "$ARCHIVE_PATH" >&2
    exit 1
fi
if [[ ! -x "$MANAGER_BIN" || -L "$MANAGER_BIN" ]]; then
    printf 'Error: manager binary is missing or not a regular executable: %s\n' "$MANAGER_BIN" >&2
    exit 1
fi

TEST_ROOT="$(mktemp -d -t dam-hopper-protected-runtime-XXXXXXXX)"
chmod 0700 "$TEST_ROOT"
trap 'rm -rf -- "$TEST_ROOT"' EXIT INT TERM

run_manager() {
    "$MANAGER_BIN" "$@" >>"$TEST_ROOT/manager.log" 2>&1
}

manager_json() {
    "$MANAGER_BIN" status --json
}

reset_snapshot() {
    local scenario="$1"
    "$RESET_HOOK" "$scenario"
}

assert_pending() {
    local expected_tag="$1"
    local expected_role="$2"
    local status_path="$3"
    python3 - "$expected_tag" "$expected_role" "$status_path" <<'PY'
import json
import sys
state = json.load(open(sys.argv[3]))
record = state["state"]["pending"]
assert record["tag"] == sys.argv[1]
assert record["role"] == sys.argv[2]
assert state["state"]["active"] is None
PY
}

assert_active() {
    local expected_tag="$1"
    local expected_role="$2"
    local status_path="$3"
    python3 - "$expected_tag" "$expected_role" "$status_path" <<'PY'
import json
import sys
state = json.load(open(sys.argv[3]))
record = state["state"]["active"]
assert record["tag"] == sys.argv[1]
assert record["role"] == sys.argv[2]
assert state["state"]["pending"] is None
assert state["state"]["transaction"] is None
PY
}

status_json() {
    manager_json >"$TEST_ROOT/status.json"
}

assert_identity() {
    local unit="$1"
    local expected_user="$2"
    local expected_group="$3"
    local actual_user actual_group
    actual_user="$(systemctl show "$unit" -p User --value)"
    actual_group="$(systemctl show "$unit" -p Group --value)"
    if [[ "$actual_user" != "$expected_user" || "$actual_group" != "$expected_group" ]]; then
        printf 'Error: %s identity is %s:%s, expected %s:%s\n' \
            "$unit" "$actual_user" "$actual_group" "$expected_user" "$expected_group" >&2
        return 1
    fi
}

assert_unit_active() {
    local unit="$1"
    systemctl is-active --quiet "$unit"
}

assert_unit_inactive() {
    local unit="$1"
    if systemctl is-active --quiet "$unit"; then
        printf 'Error: %s is active before explicit activation\n' "$unit" >&2
        return 1
    fi
}

assert_health() {
    local port="$1"
    local expected_version="$2"
    python3 - "$port" "$expected_version" <<'PY'
import json
import sys
import urllib.request
with urllib.request.urlopen(f"http://127.0.0.1:{sys.argv[1]}/api/health", timeout=5) as response:
    assert response.status == 200
    body = json.loads(response.read())
assert body["status"] == "ok"
assert body["version"] == sys.argv[2]
assert body["role"] == "api"
PY
}
assert_web_health() {
    local expected_version="$1"
    python3 - "$expected_version" <<'PY'
import json
import sys
import urllib.request
with urllib.request.urlopen("http://127.0.0.1:4802/__dam-hopper/health", timeout=5) as response:
    assert response.status == 200
    body = json.loads(response.read())
assert body == {
    "schemaVersion": 1,
    "status": "ok",
    "version": sys.argv[1],
    "role": "web",
}
PY
}

assert_port_free() {
    local port="$1"
    python3 - "$port" <<'PY'
import socket
import sys
sock = socket.socket()
sock.settimeout(0.5)
try:
    sock.connect(("127.0.0.1", int(sys.argv[1])))
except OSError:
    raise SystemExit(0)
raise SystemExit("port is unexpectedly listening")
PY
}

run_clean_install() {
    local role="$1"
    local tag="$2"
    reset_snapshot "clean-${role}"
    run_manager install --bundle "$BUNDLE_DIR" --role "$role"
    status_json
    assert_pending "$tag" "$role" "$TEST_ROOT/status.json"
    assert_unit_inactive dam-hopper-api.service
    assert_unit_inactive dam-hopper-web.service
    assert_port_free 4800
    assert_port_free 4801
    assert_port_free 4802
    run_manager start
    status_json
    assert_active "$tag" "$role" "$TEST_ROOT/status.json"
    if [[ "$role" == server || "$role" == both ]]; then
        assert_unit_active dam-hopper-api.service
        assert_health 4801 "${tag#v}"
    fi
    if [[ "$role" == web || "$role" == both ]]; then
        assert_unit_active dam-hopper-web.service
        assert_identity dam-hopper-web.service dam-hopper-web dam-hopper-web
        assert_web_health "${tag#v}"
    fi
}

if [[ -n "$NEXT_BUNDLE_DIR" ]]; then
    NEXT_TAG="$(python3 - "$NEXT_BUNDLE_DIR/release-manifest.json" <<'PY'
import json
import sys
print(json.loads(open(sys.argv[1]).read())["release"]["tag"])
PY
)"
fi
CURRENT_TAG="$(python3 - "$BUNDLE_DIR/release-manifest.json" <<'PY'
import json
import sys
print(json.loads(open(sys.argv[1]).read())["release"]["tag"])
PY
)"

run_clean_install server "$CURRENT_TAG"
run_clean_install web "$CURRENT_TAG"
run_clean_install both "$CURRENT_TAG"

if [[ -z "$NEXT_BUNDLE_DIR" || ! -d "$NEXT_BUNDLE_DIR" || -L "$NEXT_BUNDLE_DIR" ]]; then
    printf 'Error: DAM_HOPPER_PROTECTED_NEXT_BUNDLE is required for upgrade and rollback coverage\n' >&2
    exit 1
fi

reset_snapshot upgrade
run_manager install --bundle "$BUNDLE_DIR" --role server
run_manager start
status_json
assert_active "$CURRENT_TAG" server "$TEST_ROOT/status.json"
OLD_PID="$(systemctl show dam-hopper-api.service -p MainPID --value)"
assert_health 4801 "${CURRENT_TAG#v}"
run_manager install --bundle "$NEXT_BUNDLE_DIR" --role server
status_json
assert_pending "$NEXT_TAG" server "$TEST_ROOT/status.json"
NEW_PENDING_PID="$(systemctl show dam-hopper-api.service -p MainPID --value)"
[[ "$OLD_PID" == "$NEW_PENDING_PID" ]]
run_manager start
status_json
assert_active "$NEXT_TAG" server "$TEST_ROOT/status.json"
assert_health 4801 "${NEXT_TAG#v}"
run_manager role set both --bundle "$NEXT_BUNDLE_DIR"
run_manager start
status_json
assert_active "$NEXT_TAG" both "$TEST_ROOT/status.json"
assert_unit_active dam-hopper-api.service
assert_unit_active dam-hopper-web.service
assert_web_health "${NEXT_TAG#v}"
run_manager rollback
status_json
assert_active "$CURRENT_TAG" server "$TEST_ROOT/status.json"
assert_health 4801 "${CURRENT_TAG#v}"

# Crash boundaries are driven externally by a root-owned observer which kills
# the real manager after the named durable boundary. Recovery must reconcile.
for boundary in STAGED PENDING QUIESCED SWITCHED PROBING COMMITTED; do
    reset_snapshot "crash-${boundary,,}"
    set +e
    "$CRASH_HOOK" "$MANAGER_BIN" "$BUNDLE_DIR" server "$boundary" >>"$TEST_ROOT/crash.log" 2>&1
    crash_status=$?
    set -e
    [[ "$crash_status" -ne 0 ]] || {
        printf 'Error: crash hook did not report the injected manager termination at %s\n' "$boundary" >&2
        exit 1
    }
    run_manager recover
    status_json
    python3 - "$boundary" "$TEST_ROOT/status.json" <<'PY'
import json
import sys

boundary, path = sys.argv[1:]
state = json.load(open(path))
envelope = state["state"]
assert envelope["schemaVersion"] == 1
if boundary == "COMMITTED":
    assert envelope["active"] is not None
else:
    assert envelope["transaction"] is None or envelope["latestFailure"] is not None
PY
done

# Reboot cases are delegated to the protected runner's snapshot-aware driver;
# it must return only after the host has booted and manager state is readable.
for reboot_case in pre-activation pre-switch post-switch post-commit; do
    reset_snapshot "reboot-${reboot_case}"
    "$REBOOT_HOOK" "$MANAGER_BIN" "$BUNDLE_DIR" server "$reboot_case"
    status_json
    python3 - "$reboot_case" "$TEST_ROOT/status.json" <<'PY'
import json
import sys
state = json.load(open(sys.argv[2]))
assert "state" in state and state["state"]["schemaVersion"] == 1
PY
done

# Exact format-2 takeover is a separate host fixture. The hook owns only the
# disposable fixture and returns a nonzero result on any preflight drift.
reset_snapshot migration
"$MIGRATION_HOOK" prepare
run_manager install --bundle "$BUNDLE_DIR" --role server
run_manager start
status_json
assert_active "$CURRENT_TAG" server "$TEST_ROOT/status.json"
"$MIGRATION_HOOK" verify
"$MIGRATION_HOOK" cleanup

# Unit identity and sandbox checks are made against the installed units and
# effective process metadata, not source text alone.
assert_identity dam-hopper-api.service root root
assert_identity dam-hopper-web.service dam-hopper-web dam-hopper-web
systemd-analyze security dam-hopper-web.service --no-pager >/dev/null

printf 'Protected Fedora 44 release runtime passed for %s (upgrade %s)\n' "$CURRENT_TAG" "$NEXT_TAG"
