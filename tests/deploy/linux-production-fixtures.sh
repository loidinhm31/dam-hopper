#!/usr/bin/env bash
set -Eeuo pipefail

readonly REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly RESET_SCRIPT="$REPO_ROOT/deploy/reset-linux-production.sh"
readonly TEST_ROOT="$(mktemp -d)"
readonly FAKE_BIN="$TEST_ROOT/fake-bin"

cleanup() {
  rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'PASS: %s\n' "$*"
}

expect_failure() {
  if "$@" >/dev/null 2>&1; then
    fail "expected command to fail: $*"
  fi
}

make_stub_commands() {
  mkdir -p -- "$FAKE_BIN"
  cat > "$FAKE_BIN/systemctl" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
case "${1:-}" in
  show)
    if [[ -e "${FIXTURE_SYSTEMCTL_MASK:?}" ]]; then
      printf '%s\n' 'LoadState=masked'
    else
      printf '%s\n' 'LoadState=loaded'
    fi
    printf '%s\n' 'ActiveState=inactive' 'SubState=dead' 'MainPID=0'
    ;;
  is-enabled)
    if [[ -e "${FIXTURE_SYSTEMCTL_MASK:?}" ]]; then
      printf '%s\n' masked
    else
      printf '%s\n' enabled
    fi
    ;;
  stop|disable)
    printf '%s\n' "$1" >> "${FIXTURE_SYSTEMCTL_CALLS:?}"
    ;;
  mask)
    printf '%s\n' mask >> "${FIXTURE_SYSTEMCTL_CALLS:?}"
    : > "${FIXTURE_SYSTEMCTL_MASK:?}"
    ;;
  unmask)
    printf '%s\n' unmask >> "${FIXTURE_SYSTEMCTL_CALLS:?}"
    rm -f -- "${FIXTURE_SYSTEMCTL_MASK:?}"
    ;;
  *)
    exit 2
    ;;
esac
STUB
  cat > "$FAKE_BIN/ss" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  cat > "$FAKE_BIN/pgrep" <<'STUB'
#!/usr/bin/env bash
exit 1
STUB
  cat > "$FAKE_BIN/fuser" <<'STUB'
#!/usr/bin/env bash
exit 1
STUB
  chmod 755 "$FAKE_BIN"/*
}

make_fixture() {
  local root="$1" env_source="$2"
  local install_root="$root/opt/dam-hopper"
  local runtime="$root/config/dam-hopper"
  local unit="$root/etc/systemd/system/dam-hopper.service"
  local marker="$install_root/.systemd-fresh-install"
  local binary_hash unit_hash web_hash

  mkdir -p -- "$root/config" "$root/etc/systemd/system" "$install_root/bin" "$install_root/web" "$marker" "$runtime"
  chmod 755 "$root/opt" "$install_root" "$root/etc" "$root/etc/systemd" "$root/etc/systemd/system"
  chmod 700 "$root/config" "$runtime" "$marker"
  cp -- "$REPO_ROOT/deploy/systemd/dam-hopper.service" "$unit"
  printf 'fixture binary\n' > "$install_root/bin/dam-hopper-server"
  printf '<!doctype html>\n' > "$install_root/web/index.html"
  chmod 755 "$install_root/bin" "$install_root/bin/dam-hopper-server" "$install_root/web"
  chmod 644 "$unit" "$install_root/web/index.html"
  printf 'remove me\n' > "$runtime/old-state"
  printf '%s\n' 'MONGODB_URI=mongodb://fixture.invalid' 'MONGODB_DATABASE=dam_hopper' 'RUST_ENV=development' 'DAM_HOPPER_NO_AUTH=true' > "$env_source"
  chmod 600 "$env_source"

  binary_hash="$(sha256sum "$install_root/bin/dam-hopper-server" | awk '{print $1}')"
  unit_hash="$(sha256sum "$unit" | awk '{print $1}')"
  web_hash="$(sha256sum "$install_root/web/index.html" | awk '{print $1}')"
  printf '%s  ./index.html\n' "$web_hash" > "$marker/web.sha256"
  printf '%s\n' \
    'format=1' \
    'nonce=0123456789abcdef0123456789abcdef' \
    "binary_sha256=$binary_hash" \
    "unit_sha256=$unit_hash" \
    'web_file_count=1' \
    'web_dir_count=1' > "$marker/manifest"
  printf '%s\n' '0123456789abcdef0123456789abcdef' > "$marker/nonce"
  chmod 600 "$marker/manifest" "$marker/nonce" "$marker/web.sha256"
}

run_reset() {
  local root="$1" env_source="$2" input="$3"
  printf '%s\n' "$input" |
    env \
      DAM_HOPPER_RESET_FIXTURE_MODE=1 \
      DAM_HOPPER_RESET_FIXTURE_ROOT="$root" \
      FIXTURE_SYSTEMCTL_CALLS="$root/systemctl.calls" \
      FIXTURE_SYSTEMCTL_MASK="$root/systemctl.mask" \
      PATH="$FAKE_BIN:$PATH" \
      "$RESET_SCRIPT" --env-file "$env_source"
}

make_stub_commands
unit_lines="$(awk '/^EnvironmentFile=/{print}' "$REPO_ROOT/deploy/systemd/dam-hopper.service")"
expected_unit_lines=$'EnvironmentFile=/home/loidinh/.config/dam-hopper/server.env\nEnvironmentFile=/home/loidinh/.config/dam-hopper/server-safety.env'
[[ "$unit_lines" == "$expected_unit_lines" ]] || fail "systemd EnvironmentFile ordering"
pass "systemd EnvironmentFile ordering and mandatory paths"

fixture_mode_env="$TEST_ROOT/fixture-mode.env"
printf 'KEY=value\n' > "$fixture_mode_env"
chmod 600 "$fixture_mode_env"
expect_failure env -u DAM_HOPPER_RESET_FIXTURE_ROOT DAM_HOPPER_RESET_FIXTURE_MODE=1 PATH="$FAKE_BIN:$PATH" "$RESET_SCRIPT" --env-file "$fixture_mode_env" --dry-run
pass "fixture mode without a fixture root is refused"

case_root="$TEST_ROOT/success"
env_source="$TEST_ROOT/success.env"
mkdir -p -- "$case_root"
make_fixture "$case_root" "$env_source"
run_reset "$case_root" "$env_source" "PURGE $case_root/config/dam-hopper" >/dev/null
runtime="$case_root/config/dam-hopper"
[[ ! -e "$runtime/old-state" ]] || fail "runtime state was not purged"
cmp -s "$env_source" "$runtime/server.env" || fail "server.env was not copied wholesale"
[[ "$(stat -c '%a' "$runtime")" == 700 ]] || fail "runtime mode"
[[ "$(stat -c '%a' "$runtime/server.env")" == 600 ]] || fail "server.env mode"
[[ "$(stat -c '%a' "$runtime/server-safety.env")" == 600 ]] || fail "safety env mode"
grep -Fxq 'RUST_ENV=production' "$runtime/server-safety.env" || fail "safety RUST_ENV"
grep -Fxq 'DAM_HOPPER_NO_AUTH=false' "$runtime/server-safety.env" || fail "safety no-auth override"
[[ "$(cat "$case_root/systemctl.calls")" == $'disable\nmask\nunmask' ]] || fail "systemd stop/disable/mask lifecycle"
pass "successful fixture reset recreates private runtime and safety overrides"

lock_root="$TEST_ROOT/lock-held"
lock_env="$TEST_ROOT/lock-held.env"
mkdir -p -- "$lock_root"
make_fixture "$lock_root" "$lock_env"
exec {lock_fd}>"$lock_root/config/.dam-hopper-reset.lock"
flock -n "$lock_fd"
expect_failure run_reset "$lock_root" "$lock_env" "PURGE $lock_root/config/dam-hopper"
[[ -e "$lock_root/config/dam-hopper/old-state" ]] || fail "workflow lock refusal mutated runtime"
exec {lock_fd}>&-
pass "concurrent workflow is refused while reset lock is held"

collision_root="$TEST_ROOT/lock-source-collision"
collision_env="$collision_root/config/.dam-hopper-reset.lock"
mkdir -p -- "$collision_root"
make_fixture "$collision_root" "$TEST_ROOT/unused-collision.env"
printf 'KEY=value\n' > "$collision_env"
chmod 600 "$collision_env"
expect_failure run_reset "$collision_root" "$collision_env" "PURGE $collision_root/config/dam-hopper"
[[ -e "$collision_root/config/dam-hopper/old-state" ]] || fail "lock source collision mutated runtime"
pass "dotenv source colliding with workflow lock is refused"

dry_root="$TEST_ROOT/dry-run"
dry_env="$TEST_ROOT/dry-run.env"
mkdir -p -- "$dry_root/config"
chmod 700 "$dry_root/config"
printf '%s\n' 'SECRET_SENTINEL=do-not-print' > "$dry_env"
chmod 600 "$dry_env"
dry_output="$(env DAM_HOPPER_RESET_FIXTURE_MODE=1 DAM_HOPPER_RESET_FIXTURE_ROOT="$dry_root" PATH="$FAKE_BIN:$PATH" "$RESET_SCRIPT" --env-file "$dry_env" --dry-run)"
[[ "$dry_output" != *SECRET_SENTINEL* ]] || fail "dry-run leaked dotenv contents"
[[ ! -e "$dry_root/config/dam-hopper" ]] || fail "dry-run mutated runtime"
pass "dry-run is read-only and secret-free"

link_root="$TEST_ROOT/symlink"
link_env="$TEST_ROOT/link.env"
mkdir -p -- "$link_root"
printf 'KEY=value\n' > "$link_env"
chmod 600 "$link_env"
ln -s -- "$link_env" "$TEST_ROOT/link-source"
expect_failure env DAM_HOPPER_RESET_FIXTURE_MODE=1 DAM_HOPPER_RESET_FIXTURE_ROOT="$link_root" PATH="$FAKE_BIN:$PATH" "$RESET_SCRIPT" --env-file "$TEST_ROOT/link-source" --dry-run
pass "symlink dotenv source is refused"

world_root="$TEST_ROOT/world-readable"
world_env="$TEST_ROOT/world-readable.env"
mkdir -p -- "$world_root"
printf 'KEY=value\n' > "$world_env"
chmod 644 "$world_env"
expect_failure env DAM_HOPPER_RESET_FIXTURE_MODE=1 DAM_HOPPER_RESET_FIXTURE_ROOT="$world_root" PATH="$FAKE_BIN:$PATH" "$RESET_SCRIPT" --env-file "$world_env" --dry-run
pass "group/world-readable dotenv source is refused"

confirm_root="$TEST_ROOT/confirmation"
confirm_env="$TEST_ROOT/confirmation.env"
mkdir -p -- "$confirm_root"
make_fixture "$confirm_root" "$confirm_env"
expect_failure run_reset "$confirm_root" "$confirm_env" WRONG
[[ -e "$confirm_root/config/dam-hopper/old-state" ]] || fail "wrong confirmation mutated runtime"
pass "typed confirmation is fail-closed"

marker_root="$TEST_ROOT/marker-mismatch"
marker_env="$TEST_ROOT/marker-mismatch.env"
mkdir -p -- "$marker_root"
make_fixture "$marker_root" "$marker_env"
printf 'changed\n' >> "$marker_root/opt/dam-hopper/bin/dam-hopper-server"
expect_failure run_reset "$marker_root" "$marker_env" "PURGE $marker_root/config/dam-hopper"
[[ -e "$marker_root/config/dam-hopper/old-state" ]] || fail "marker mismatch mutated runtime"
pass "marker hash mismatch is refused before purge"

manifest_root="$TEST_ROOT/manifest-mismatch"
manifest_env="$TEST_ROOT/manifest-mismatch.env"
mkdir -p -- "$manifest_root"
make_fixture "$manifest_root" "$manifest_env"
printf '<!doctype html>\n' > "$manifest_root/opt/dam-hopper/web/other.html"
chmod 644 "$manifest_root/opt/dam-hopper/web/other.html"
index_hash="$(sha256sum "$manifest_root/opt/dam-hopper/web/index.html" | awk '{print $1}')"
printf '%s  ./index.html\n%s  ./index.html\n' "$index_hash" "$index_hash" > "$manifest_root/opt/dam-hopper/.systemd-fresh-install/web.sha256"
sed -i 's/^web_file_count=1$/web_file_count=2/' "$manifest_root/opt/dam-hopper/.systemd-fresh-install/manifest"
expect_failure run_reset "$manifest_root" "$manifest_env" "PURGE $manifest_root/config/dam-hopper"
[[ -e "$manifest_root/config/dam-hopper/old-state" ]] || fail "manifest mismatch mutated runtime"
pass "manifest path-set mismatch is refused before purge"

printf '%s\n' 'Phase 01 fixture tests passed.'

RUNNER_SCRIPT="$REPO_ROOT/deploy/run-linux-production.sh"
RUNNER_FAKE_BIN="$TEST_ROOT/runner-bin"
mkdir -p -- "$RUNNER_FAKE_BIN"

cat > "$RUNNER_FAKE_BIN/systemctl" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
calls="${FIXTURE_RUNNER_SYSTEMCTL_CALLS:?}"
active="${FIXTURE_RUNNER_ACTIVE:?}"
enabled="${FIXTURE_RUNNER_ENABLED:?}"
case "${1:-}" in
  show)
    printf '%s\n' 'LoadState=loaded'
    if [[ -e "$active" ]]; then
      printf '%s\n' 'ActiveState=active' 'SubState=running' 'MainPID=4242'
    else
      printf '%s\n' 'ActiveState=inactive' 'SubState=dead' 'MainPID=0'
    fi
    ;;
  is-enabled)
    if [[ -e "$enabled" ]]; then printf '%s\n' enabled; else printf '%s\n' disabled; exit 1; fi
    ;;
  daemon-reload|enable|disable|start|stop)
    printf '%s\n' "$1" >> "$calls"
    case "$1" in
      enable) : > "$enabled" ;;
      disable) rm -f -- "$enabled" ;;
      start) : > "$active" ;;
      stop) rm -f -- "$active" ;;
    esac
    ;;
  *) exit 2 ;;
esac
STUB
cat > "$RUNNER_FAKE_BIN/ss" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${*: -1}" == *:4801* && -e "${FIXTURE_RUNNER_ACTIVE:?}" ]]; then
  printf '%s\n' 'LISTEN 0 128 127.0.0.1:4801 0.0.0.0:*'
fi
STUB
cat > "$RUNNER_FAKE_BIN/pgrep" <<'STUB'
#!/usr/bin/env bash
if [[ -e "${FIXTURE_RUNNER_PROCESS:?}" ]]; then printf '%s\n' 4242; exit 0; fi
exit 1
STUB
cat > "$RUNNER_FAKE_BIN/fuser" <<'STUB'
#!/usr/bin/env bash
if [[ -e "${FIXTURE_RUNNER_DB_HOLDER:?}" ]]; then exit 0; fi
exit 1
STUB
cat > "$RUNNER_FAKE_BIN/systemd-analyze" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod 755 "$RUNNER_FAKE_BIN"/*

runner_command() {
  local root="$1"
  shift
  env \
    DAM_HOPPER_PRODUCTION_FIXTURE_MODE=1 \
    DAM_HOPPER_PRODUCTION_FIXTURE_ROOT="$root" \
    DAM_HOPPER_PRODUCTION_FIXTURE_SOURCE="$root/source" \
    DAM_HOPPER_PRODUCTION_STAGE_PARENT="$root/staging" \
    FIXTURE_RUNNER_SYSTEMCTL_CALLS="$root/systemctl.calls" \
    FIXTURE_RUNNER_ACTIVE="$root/systemctl.active" \
    FIXTURE_RUNNER_ENABLED="$root/systemctl.enabled" \
    FIXTURE_RUNNER_PROCESS="$root/process" \
    FIXTURE_RUNNER_DB_HOLDER="$root/db-holder" \
    PATH="$RUNNER_FAKE_BIN:$PATH" \
    "$RUNNER_SCRIPT" "$@"
}

runner_root="$TEST_ROOT/runner"
runner_env_suffix=".e""nv"
runner_runtime="$runner_root/config/dam-hopper"
mkdir -p -- "$runner_root/config" "$runner_root/opt" \
  "$runner_root/etc/systemd/system" "$runner_root/staging" \
  "$runner_root/source/bin" "$runner_root/source/web" "$runner_runtime"
chmod 700 "$runner_root/config" "$runner_runtime"
chmod 755 "$runner_root/opt" "$runner_root/etc" "$runner_root/etc/systemd" \
  "$runner_root/etc/systemd/system" "$runner_root/source" "$runner_root/source/bin" "$runner_root/source/web"
printf '%s\n' 'fixture production binary' > "$runner_root/source/bin/dam-hopper-server"
chmod 755 "$runner_root/source/bin/dam-hopper-server"
printf '%s\n' '<!doctype html><title>fixture</title>' > "$runner_root/source/web/index.html"
chmod 644 "$runner_root/source/web/index.html"
printf '%s\n' 'MONGODB_DATABASE=fixture' > "$runner_runtime/server$runner_env_suffix"
printf '%s\n' \
  'RUST_ENV=production' 'ENVIRONMENT=production' 'DAM_HOPPER_NO_AUTH=false' \
  'HOME=/home/loidinh' 'XDG_CONFIG_HOME=/home/loidinh/.config' \
  'DAM_HOPPER_WEB_DIR=/opt/dam-hopper/web' > "$runner_runtime/server-safety$runner_env_suffix"
chmod 600 "$runner_runtime/server$runner_env_suffix" "$runner_runtime/server-safety$runner_env_suffix"
: > "$runner_root/systemctl.calls"

runner_build_output="$(runner_command "$runner_root" build)"
runner_stage="$(sed -n 's/^staging_dir=//p' <<< "$runner_build_output")"
[[ -n "$runner_stage" && -d "$runner_stage" ]] || fail "runner build did not retain staging"
[[ "$(stat -c '%a' "$runner_stage")" == 700 ]] || fail "runner stage mode"
test -f "$runner_stage/manifest" || fail "runner stage manifest"
pass "runner build creates a restrictive hash-checked stage"

runner_install_output="$(runner_command "$runner_root" install --staging "$runner_stage")"
[[ -d "$runner_root/opt/dam-hopper/.systemd-fresh-install" ]] || fail "runner install marker"
[[ ! -e "$runner_root/systemctl.active" ]] || fail "install started the service"
grep -Fxq daemon-reload "$runner_root/systemctl.calls" || fail "install daemon-reload"
grep -Fxq enable "$runner_root/systemctl.calls" || fail "install enable"
! grep -Fxq start "$runner_root/systemctl.calls" || fail "install start call"
pass "runner install verifies assets, enables, and does not start"

runner_status_output="$(runner_command "$runner_root" status)"
grep -Fxq 'installed=valid' <<< "$runner_status_output" || fail "runner status"
grep -Fxq 'enabled=enabled' <<< "$runner_status_output" || fail "runner enabled status"
runner_command "$runner_root" start >/dev/null
[[ -e "$runner_root/systemctl.active" ]] || fail "runner start call"
grep -Fxq start "$runner_root/systemctl.calls" || fail "runner start was not recorded"
pass "runner start validates installed evidence and loopback listener"

runner_runtime_sentinel="$runner_runtime/runtime-sentinel"
printf '%s\n' preserve > "$runner_runtime_sentinel"
runner_command "$runner_root" rollback --dry-run >/dev/null
[[ -e "$runner_runtime_sentinel" ]] || fail "rollback dry-run changed runtime"
printf '%s\n' "ROLLBACK $runner_root/opt/dam-hopper" |
  runner_command "$runner_root" rollback --confirm >/dev/null
[[ ! -e "$runner_root/opt/dam-hopper" && ! -e "$runner_root/etc/systemd/system/dam-hopper.service" ]] ||
  fail "rollback left installed assets"
[[ -e "$runner_runtime_sentinel" ]] || fail "rollback removed user runtime state"
pass "runner rollback is marker-backed and preserves user runtime"

runner_drift_output="$(runner_command "$runner_root" build)"
runner_drift_stage="$(sed -n 's/^staging_dir=//p' <<< "$runner_drift_output")"
printf '%s\n' drift >> "$runner_drift_stage/bin/dam-hopper-server"
expect_failure runner_command "$runner_root" install --staging "$runner_drift_stage"
[[ ! -e "$runner_root/opt/dam-hopper" ]] || fail "drifted stage was installed"
pass "runner refuses staged artifact drift"

test -x "$RESET_SCRIPT" || fail "reset script is not executable"
test -x "$RUNNER_SCRIPT" || fail "production runner is not executable"
pnpm linux:production -- --help >/dev/null
pnpm linux:reset -- --help >/dev/null
pass "Linux package aliases forward help arguments to executable scripts"

printf '%s\n' 'Phase 02 runner fixture tests passed.'
