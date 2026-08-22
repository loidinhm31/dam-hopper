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
if [[ -n "${FIXTURE_RESET_SS_ERROR:-}" ]]; then
  printf '%s\n' 'RTNETLINK answers: Invalid argument' >&2
  exit 0
fi
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
  local binary_hash unit_hash

  mkdir -p -- "$root/config" "$root/etc/systemd/system" "$install_root/bin" "$marker" "$runtime"
  chmod 755 "$root/opt" "$install_root" "$root/etc" "$root/etc/systemd" "$root/etc/systemd/system"
  chmod 700 "$root/config" "$runtime" "$marker"
  cp -- "$REPO_ROOT/deploy/systemd/dam-hopper.service" "$unit"
  printf 'fixture binary\n' > "$install_root/bin/dam-hopper-server"
  chmod 755 "$install_root/bin" "$install_root/bin/dam-hopper-server"
  chmod 644 "$unit"
  printf 'remove me\n' > "$runtime/old-state"
  printf '%s\n' 'MONGODB_URI=mongodb://fixture.invalid' 'MONGODB_DATABASE=dam_hopper' 'RUST_ENV=development' 'DAM_HOPPER_NO_AUTH=true' > "$env_source"
  chmod 600 "$env_source"

  binary_hash="$(sha256sum "$install_root/bin/dam-hopper-server" | awk '{print $1}')"
  unit_hash="$(sha256sum "$unit" | awk '{print $1}')"
  printf '%s\n' \
    'format=2' \
    'nonce=0123456789abcdef0123456789abcdef' \
    "binary_sha256=$binary_hash" \
    "unit_sha256=$unit_hash" > "$marker/manifest"
  printf '%s\n' '0123456789abcdef0123456789abcdef' > "$marker/nonce"
  chmod 600 "$marker/manifest" "$marker/nonce"
}

run_reset() {
  local root="$1" env_source="$2" input="$3"
  printf '%s\n' "$input" |
    env \
      DAM_HOPPER_RESET_FIXTURE_MODE=1 \
      DAM_HOPPER_RESET_FIXTURE_ROOT="$root" \
      FIXTURE_SYSTEMCTL_CALLS="$root/systemctl.calls" \
      FIXTURE_SYSTEMCTL_MASK="$root/systemctl.mask" \
      FIXTURE_RESET_SS_ERROR="${FIXTURE_RESET_SS_ERROR:-}" \
      PATH="$FAKE_BIN:$PATH" \
      "$RESET_SCRIPT" --env-file "$env_source"
}

run_runtime_only() {
  local root="$1" env_source="$2" input="$3"
  printf '%s\n' "$input" |
    env \
      DAM_HOPPER_RESET_FIXTURE_MODE=1 \
      DAM_HOPPER_RESET_FIXTURE_ROOT="$root" \
      FIXTURE_SYSTEMCTL_CALLS="$root/systemctl.calls" \
      FIXTURE_SYSTEMCTL_MASK="$root/systemctl.mask" \
      FIXTURE_RESET_SS_ERROR="${FIXTURE_RESET_SS_ERROR:-}" \
      PATH="$FAKE_BIN:$PATH" \
      "$RESET_SCRIPT" --env-file "$env_source" --runtime-only
}

run_runtime_only_existing_env() {
  local root="$1" input="$2"
  printf '%s\n' "$input" |
    env \
      DAM_HOPPER_RESET_FIXTURE_MODE=1 \
      DAM_HOPPER_RESET_FIXTURE_ROOT="$root" \
      FIXTURE_SYSTEMCTL_CALLS="$root/systemctl.calls" \
      FIXTURE_SYSTEMCTL_MASK="$root/systemctl.mask" \
      FIXTURE_RESET_SS_ERROR="${FIXTURE_RESET_SS_ERROR:-}" \
      PATH="$FAKE_BIN:$PATH" \
      "$RESET_SCRIPT" --runtime-only
}

make_stub_commands
unit_lines="$(awk '/^EnvironmentFile=/{print}' "$REPO_ROOT/deploy/systemd/dam-hopper.service")"
expected_unit_lines=$'EnvironmentFile=/home/loidinh/.config/dam-hopper/server.env\nEnvironmentFile=/home/loidinh/.config/dam-hopper/server-safety.env'
[[ "$unit_lines" == "$expected_unit_lines" ]] || fail "systemd EnvironmentFile ordering"
! grep -Fxq 'Environment=DAM_HOPPER_WEB_DIR=/opt/dam-hopper/web' "$REPO_ROOT/deploy/systemd/dam-hopper.service" ||
  fail "server-only systemd unit contains web directory assignment"
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
! grep -Fq 'DAM_HOPPER_WEB_DIR=' "$runtime/server-safety.env" || fail "server-only safety env contains web directory"
[[ "$(cat "$case_root/systemctl.calls")" == $'disable\nmask\nunmask' ]] || fail "systemd stop/disable/mask lifecycle"
pass "successful fixture reset recreates private runtime and safety overrides"

runtime_only_root="$TEST_ROOT/runtime-only"
runtime_only_env="$TEST_ROOT/runtime-only-source"
runtime_only_suffix=".e""nv"
runtime_only_runtime="$runtime_only_root/config/dam-hopper"
mkdir -p -- "$runtime_only_root/config" "$runtime_only_root/etc/systemd/system" \
  "$runtime_only_runtime"
chmod 700 "$runtime_only_root/config" "$runtime_only_runtime"
printf '%s\n' preserve > "$runtime_only_runtime/old-state"
printf '%s\n' 'config=preserve' > "$runtime_only_runtime/dam-hopper.toml"
printf '%s\n' 'MONGODB_DATABASE=runtime-only-fixture' > "$runtime_only_env"
chmod 600 "$runtime_only_env"
run_runtime_only "$runtime_only_root" "$runtime_only_env" \
  "PREPARE $runtime_only_runtime" >/dev/null
[[ -e "$runtime_only_runtime/old-state" ]] ||
  fail "runtime-only preparation removed existing state"
[[ -e "$runtime_only_runtime/dam-hopper.toml" ]] ||
  fail "runtime-only preparation removed existing config"
cmp -s "$runtime_only_env" "$runtime_only_runtime/server$runtime_only_suffix" ||
  fail "runtime-only server environment was not copied wholesale"
[[ "$(stat -c '%a' "$runtime_only_runtime/server$runtime_only_suffix")" == 600 ]] ||
  fail "runtime-only server environment mode"
[[ "$(stat -c '%a' "$runtime_only_runtime/server-safety$runtime_only_suffix")" == 600 ]] ||
  fail "runtime-only safety environment mode"
pass "runtime-only preparation preserves existing runtime state"

printf '%s\n' \
  'RUST_ENV=production' \
  'ENVIRONMENT=production' \
  'DAM_HOPPER_NO_AUTH=false' \
  'HOME=/home/loidinh' \
  'XDG_CONFIG_HOME=/home/loidinh/.config' \
  'DAM_HOPPER_WEB_DIR=/opt/dam-hopper/web' \
  > "$runtime_only_runtime/server-safety$runtime_only_suffix"
chmod 600 "$runtime_only_runtime/server-safety$runtime_only_suffix"
run_runtime_only_existing_env "$runtime_only_root" \
  "PREPARE $runtime_only_runtime" >/dev/null
cmp -s "$runtime_only_env" "$runtime_only_runtime/server$runtime_only_suffix" ||
  fail "runtime-only existing environment was not preserved"
! grep -Fxq 'DAM_HOPPER_WEB_DIR=/opt/dam-hopper/web' \
  "$runtime_only_runtime/server-safety$runtime_only_suffix" ||
  fail "runtime-only existing environment retained the legacy web assignment"
pass "runtime-only repair reuses the existing server environment and removes legacy safety assignments"

runtime_only_error_root="$TEST_ROOT/runtime-only-listener-error"
runtime_only_error_env="$TEST_ROOT/runtime-only-listener-error-source"
runtime_only_error_runtime="$runtime_only_error_root/config/dam-hopper"
mkdir -p -- "$runtime_only_error_root/config" "$runtime_only_error_root/etc/systemd/system" \
  "$runtime_only_error_runtime"
chmod 700 "$runtime_only_error_root/config" "$runtime_only_error_runtime"
printf '%s\n' preserve > "$runtime_only_error_runtime/old-state"
printf '%s\n' 'KEY=value' > "$runtime_only_error_env"
chmod 600 "$runtime_only_error_env"
export FIXTURE_RESET_SS_ERROR=1
expect_failure run_runtime_only "$runtime_only_error_root" "$runtime_only_error_env" \
  "PREPARE $runtime_only_error_runtime"
unset FIXTURE_RESET_SS_ERROR
[[ ! -e "$runtime_only_error_runtime/server$runtime_only_suffix" ]] ||
  fail "runtime-only listener inspection error wrote environment"
pass "runtime-only preparation refuses listener inspection errors"

listener_error_root="$TEST_ROOT/listener-error"
listener_error_env="$TEST_ROOT/listener-error.env"
mkdir -p -- "$listener_error_root"
make_fixture "$listener_error_root" "$listener_error_env"
export FIXTURE_RESET_SS_ERROR=1
expect_failure run_reset "$listener_error_root" "$listener_error_env" \
  "PURGE $listener_error_root/config/dam-hopper"
unset FIXTURE_RESET_SS_ERROR
[[ -e "$listener_error_root/config/dam-hopper/old-state" ]] ||
  fail "listener inspection error mutated runtime"
pass "reset refuses listener inspection errors instead of treating ports as free"

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
mkdir -p -- "$manifest_root/opt/dam-hopper/web"
printf '<!doctype html>\n' > "$manifest_root/opt/dam-hopper/web/other.html"
chmod 755 "$manifest_root/opt/dam-hopper/web"
chmod 644 "$manifest_root/opt/dam-hopper/web/other.html"
expect_failure run_reset "$manifest_root" "$manifest_env" "PURGE $manifest_root/config/dam-hopper"
[[ -e "$manifest_root/config/dam-hopper/old-state" ]] || fail "manifest mismatch mutated runtime"
pass "server-only install rejects unmanaged web assets before purge"

legacy_root="$TEST_ROOT/legacy-web"
legacy_env="$TEST_ROOT/legacy-web.env"
mkdir -p -- "$legacy_root"
make_fixture "$legacy_root" "$legacy_env"
legacy_install="$legacy_root/opt/dam-hopper"
legacy_marker="$legacy_install/.systemd-fresh-install"
mkdir -p -- "$legacy_install/web"
printf '<!doctype html>\n' > "$legacy_install/web/index.html"
chmod 755 "$legacy_install/web"
chmod 644 "$legacy_install/web/index.html"
legacy_web_hash="$(sha256sum "$legacy_install/web/index.html" | awk '{print $1}')"
printf '%s  ./index.html\n' "$legacy_web_hash" > "$legacy_marker/web.sha256"
printf '%s\n' \
  'format=1' \
  'nonce=0123456789abcdef0123456789abcdef' \
  "binary_sha256=$(sha256sum "$legacy_install/bin/dam-hopper-server" | awk '{print $1}')" \
  "unit_sha256=$(sha256sum "$legacy_root/etc/systemd/system/dam-hopper.service" | awk '{print $1}')" \
  'web_file_count=1' \
  'web_dir_count=1' > "$legacy_marker/manifest"
chmod 600 "$legacy_marker/manifest" "$legacy_marker/web.sha256"
run_reset "$legacy_root" "$legacy_env" "PURGE $legacy_root/config/dam-hopper" >/dev/null
[[ ! -e "$legacy_root/config/dam-hopper/old-state" ]] || fail "legacy web install reset was not accepted"
pass "legacy web-bearing install remains safely resettable"

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
wants="${FIXTURE_RUNNER_WANTS_PATH:?}"
unit="${FIXTURE_RUNNER_UNIT_PATH:?}"
if [[ -n "${FIXTURE_RUNNER_FAIL_COMMAND:-}" && "${1:-}" == "${FIXTURE_RUNNER_FAIL_COMMAND}" ]]; then
  printf '%s\n' "injected systemctl failure: $1" >&2
  exit 1
fi
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
      enable)
        mkdir -p -- "$(dirname -- "$wants")"
        ln -s -- "$unit" "$wants"
        : > "$enabled"
        ;;
      disable)
        rm -f -- "$enabled" "$wants"
        ;;
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
if [[ -n "${FIXTURE_RUNNER_SS_ERROR:-}" ]]; then
  printf '%s\n' 'RTNETLINK answers: Invalid argument' >&2
  exit 0
fi
if [[ -e "${FIXTURE_RUNNER_ACTIVE:?}" ]]; then
  printf '%s\n' 'LISTEN 0 128 0.0.0.0:4801 0.0.0.0:*'
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
runner_real_grep="$(type -P grep)"
cat > "$RUNNER_FAKE_BIN/grep" <<STUB
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "\${FIXTURE_RUNNER_GREP_ERROR:-0}" == 1 && "\$*" == *mongodb* ]]; then
  exit 2
fi
exec "$runner_real_grep" "\$@"
STUB
cat > "$RUNNER_FAKE_BIN/systemd-analyze" <<'STUB'
#!/usr/bin/env bash
if [[ "${FIXTURE_RUNNER_FAIL_COMMAND:-}" == systemd-analyze ]]; then
  printf '%s\n' 'injected systemd-analyze failure' >&2
  exit 1
fi
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
    FIXTURE_RUNNER_WANTS_PATH="$root/etc/systemd/system/multi-user.target.wants/dam-hopper.service" \
    FIXTURE_RUNNER_UNIT_PATH="$root/etc/systemd/system/dam-hopper.service" \
    FIXTURE_RUNNER_PROCESS="$root/process" \
    FIXTURE_RUNNER_DB_HOLDER="$root/db-holder" \
    FIXTURE_RUNNER_SS_ERROR="${FIXTURE_RUNNER_SS_ERROR:-}" \
    FIXTURE_RUNNER_FAIL_COMMAND="${FIXTURE_RUNNER_FAIL_COMMAND:-}" \
    FIXTURE_RUNNER_FAIL_AFTER_ENABLE="${FIXTURE_RUNNER_FAIL_AFTER_ENABLE:-0}" \
    FIXTURE_RUNNER_VALIDATE_UNIT="${FIXTURE_RUNNER_VALIDATE_UNIT:-0}" \
    PATH="$RUNNER_FAKE_BIN:$PATH" \
    "$RUNNER_SCRIPT" "$@"
}

assert_runner_systemctl_calls() {
  local expected="$1" actual
  actual="$(<"$runner_root/systemctl.calls")"
  [[ "$actual" == "$expected" ]] || fail "unexpected systemd call sequence"
}

runner_root="$TEST_ROOT/runner"
runner_env_suffix=".e""nv"
runner_runtime="$runner_root/config/dam-hopper"
runner_stage_record="$runner_root/config/.dam-hopper-linux-production-stage"
mkdir -p -- "$runner_root/config" "$runner_root/opt" \
  "$runner_root/etc/systemd/system" "$runner_root/staging" \
  "$runner_root/source/bin" "$runner_runtime"
chmod 700 "$runner_root/config" "$runner_runtime"
chmod 755 "$runner_root/opt" "$runner_root/etc" "$runner_root/etc/systemd" \
  "$runner_root/etc/systemd/system" "$runner_root/source" "$runner_root/source/bin"
printf '%s\n' 'fixture production binary' > "$runner_root/source/bin/dam-hopper-server"
chmod 755 "$runner_root/source/bin/dam-hopper-server"
printf '%s\n' 'MONGODB_DATABASE=fixture' > "$runner_runtime/server$runner_env_suffix"
printf '%s\n' \
  'RUST_ENV=production' 'ENVIRONMENT=production' 'DAM_HOPPER_NO_AUTH=false' \
  'HOME=/home/loidinh' 'XDG_CONFIG_HOME=/home/loidinh/.config' > "$runner_runtime/server-safety$runner_env_suffix"
chmod 600 "$runner_runtime/server$runner_env_suffix" "$runner_runtime/server-safety$runner_env_suffix"
: > "$runner_root/systemctl.calls"

runner_build_output="$(runner_command "$runner_root" build)"
runner_stage="$(sed -n 's/^staging_dir=//p' <<< "$runner_build_output")"
[[ -n "$runner_stage" && -d "$runner_stage" ]] || fail "runner build did not retain staging"
[[ "$(stat -c '%a' "$runner_stage")" == 700 ]] || fail "runner stage mode"
test -f "$runner_stage/manifest" || fail "runner stage manifest"
[[ "$(find "$runner_stage" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)" == $'bin\ndam-hopper.service\nmanifest\nnonce' ]] ||
  fail "runner stage contains unexpected UI or metadata assets"
grep -Fxq 'format=2' "$runner_stage/manifest" || fail "runner stage marker format"
pass "runner build creates a restrictive hash-checked stage"
expect_failure runner_command "$runner_root" build --install-deps
pass "runner rejects the removed dependency-install option"

export FIXTURE_RUNNER_GREP_ERROR=1
expect_failure runner_command "$runner_root" build
unset FIXTURE_RUNNER_GREP_ERROR
pass "runner refuses staged-tree scanner errors"
printf 'binary-prefix\0mongodb://fixture-user:fixture-password@fixture.invalid/db\0' > \
  "$runner_root/source/bin/dam-hopper-server"
expect_failure runner_command "$runner_root" build
printf '%s\n' 'fixture production binary' > "$runner_root/source/bin/dam-hopper-server"
chmod 755 "$runner_root/source/bin/dam-hopper-server"
pass "runner refuses credential-bearing binary content"
printf '%s\n' '-----BEGIN OPENSSH PRIVATE KEY-----' > \
  "$runner_root/source/bin/dam-hopper-server"
runner_command "$runner_root" build >/dev/null
printf '%s\n' 'fixture production binary' > "$runner_root/source/bin/dam-hopper-server"
chmod 755 "$runner_root/source/bin/dam-hopper-server"
pass "runner permits private-key header markers without key material"
printf '%s\n' \
  '-----BEGIN OPENSSH PRIVATE KEY-----' \
  '0123456789012345678901234567890123456789' \
  '-----END OPENSSH PRIVATE KEY-----' > \
  "$runner_root/source/bin/dam-hopper-server"
expect_failure runner_command "$runner_root" build
printf '%s\n' 'fixture production binary' > "$runner_root/source/bin/dam-hopper-server"
chmod 755 "$runner_root/source/bin/dam-hopper-server"
pass "runner refuses embedded private-key material"
runner_build_output="$(runner_command "$runner_root" build)"
runner_stage="$(sed -n 's/^staging_dir=//p' <<< "$runner_build_output")"
[[ -n "$runner_stage" && -d "$runner_stage" ]] || fail "runner rebuild did not retain staging"

: > "$runner_root/systemctl.calls"
runner_auto_install_output="$(runner_command "$runner_root" install)"
[[ -d "$runner_root/opt/dam-hopper/.systemd-fresh-install" ]] || fail "automatic runner install marker"
[[ ! -e "$runner_root/opt/dam-hopper/web" ]] || fail "server-only install copied web assets"
[[ ! -e "$runner_root/systemctl.active" ]] || fail "automatic install started the service"
assert_runner_systemctl_calls $'daemon-reload\nenable'
pass "runner installs the recorded retained stage without --staging"

printf '%s\n' "ROLLBACK $runner_root/opt/dam-hopper" |
  runner_command "$runner_root" rollback --confirm >/dev/null
[[ ! -e "$runner_root/opt/dam-hopper" && ! -e "$runner_root/etc/systemd/system/dam-hopper.service" ]] ||
  fail "automatic-install rollback left installed assets"
[[ ! -e "$runner_stage_record" && ! -L "$runner_stage_record" ]] ||
  fail "automatic-stage record survived rollback"
pass "rollback clears the automatic-stage record"

legacy_runner_root="$TEST_ROOT/runner-legacy"
legacy_runner_runtime="$legacy_runner_root/config/dam-hopper"
mkdir -p -- "$legacy_runner_root/config" "$legacy_runner_root/opt" \
  "$legacy_runner_root/etc/systemd/system" "$legacy_runner_root/staging" \
  "$legacy_runner_root/source/bin" "$legacy_runner_runtime"
chmod 700 "$legacy_runner_root/config" "$legacy_runner_runtime"
chmod 755 "$legacy_runner_root/opt" "$legacy_runner_root/etc" "$legacy_runner_root/etc/systemd" \
  "$legacy_runner_root/etc/systemd/system" "$legacy_runner_root/source" "$legacy_runner_root/source/bin"
cp -- "$runner_root/source/bin/dam-hopper-server" "$legacy_runner_root/source/bin/dam-hopper-server"
printf '%s\n' 'MONGODB_DATABASE=fixture' > "$legacy_runner_runtime/server$runner_env_suffix"
printf '%s\n' \
  'RUST_ENV=production' 'ENVIRONMENT=production' 'DAM_HOPPER_NO_AUTH=false' \
  'HOME=/home/loidinh' 'XDG_CONFIG_HOME=/home/loidinh/.config' > "$legacy_runner_runtime/server-safety$runner_env_suffix"
chmod 600 "$legacy_runner_runtime/server$runner_env_suffix" "$legacy_runner_runtime/server-safety$runner_env_suffix"
: > "$legacy_runner_root/systemctl.calls"
legacy_runner_build_output="$(runner_command "$legacy_runner_root" build)"
legacy_runner_stage="$(sed -n 's/^staging_dir=//p' <<< "$legacy_runner_build_output")"
runner_command "$legacy_runner_root" install --staging "$legacy_runner_stage" >/dev/null
legacy_runner_install="$legacy_runner_root/opt/dam-hopper"
legacy_runner_marker="$legacy_runner_install/.systemd-fresh-install"
mkdir -p -- "$legacy_runner_install/web"
printf '%s\n' '<!doctype html>' > "$legacy_runner_install/web/index.html"
chmod 755 "$legacy_runner_install/web"
chmod 644 "$legacy_runner_install/web/index.html"
legacy_runner_web_hash="$(sha256sum "$legacy_runner_install/web/index.html" | awk '{print $1}')"
printf '%s  ./index.html\n' "$legacy_runner_web_hash" > "$legacy_runner_marker/web.sha256"
printf '%s\n' \
  'format=1' \
  "nonce=$(cat "$legacy_runner_marker/nonce")" \
  "binary_sha256=$(sha256sum "$legacy_runner_install/bin/dam-hopper-server" | awk '{print $1}')" \
  "unit_sha256=$(sha256sum "$legacy_runner_root/etc/systemd/system/dam-hopper.service" | awk '{print $1}')" \
  'web_file_count=1' \
  'web_dir_count=1' > "$legacy_runner_marker/manifest"
chmod 600 "$legacy_runner_marker/manifest" "$legacy_runner_marker/web.sha256"
expect_failure runner_command "$legacy_runner_root" status
runner_command "$legacy_runner_root" rollback --dry-run >/dev/null
printf '%s\n' "ROLLBACK $legacy_runner_install" |
  runner_command "$legacy_runner_root" rollback --confirm >/dev/null
[[ ! -e "$legacy_runner_install" ]] || fail "legacy runner rollback left web-bearing assets"
pass "legacy runner install remains rollback-compatible"

printf '%s\n%s\n' "$runner_stage" "$runner_stage" > "$runner_stage_record"
chmod 600 "$runner_stage_record"
expect_failure runner_command "$runner_root" install
pass "runner refuses an ambiguous automatic stage record"
rm -f -- "$runner_stage_record"
expect_failure runner_command "$runner_root" install
pass "runner refuses automatic install when the retained stage record is missing"
expect_failure runner_command "$runner_root" install --staging ""
pass "runner refuses an explicitly empty staging override"
expect_failure runner_command "$runner_root" install --staging=
pass "runner refuses an explicitly empty equals staging override"

printf '%s\n' "$runner_stage" > "$runner_stage_record"
chmod 644 "$runner_stage_record"
expect_failure runner_command "$runner_root" install
pass "runner refuses an automatic stage record with broad permissions"
rm -f -- "$runner_stage_record"
ln -s -- "$runner_stage" "$runner_stage_record"
expect_failure runner_command "$runner_root" install
pass "runner refuses a symlinked automatic stage record"
rm -f -- "$runner_stage_record"

: > "$runner_root/systemctl.calls"

runner_wants_dir="$runner_root/etc/systemd/system/multi-user.target.wants"
runner_preexisting_wants="$runner_wants_dir/dam-hopper.service"
runner_preexisting_target="$runner_root/preexisting-dam-hopper.service"
mkdir -p -- "$runner_wants_dir"
printf '%s\n' preexisting > "$runner_preexisting_target"
ln -s -- "$runner_preexisting_target" "$runner_preexisting_wants"
expect_failure runner_command "$runner_root" install --staging "$runner_stage"
[[ -L "$runner_preexisting_wants" && "$(readlink -- "$runner_preexisting_wants")" == "$runner_preexisting_target" ]] ||
  fail "pre-existing enablement link was changed"
assert_runner_systemctl_calls ""
rm -f -- "$runner_preexisting_wants" "$runner_preexisting_target"
pass "runner refuses pre-existing systemd enablement links"

runner_sibling_wants="$runner_wants_dir/other.service"
printf '%s\n' sibling > "$runner_sibling_wants"
: > "$runner_root/systemctl.calls"
export FIXTURE_RUNNER_FAIL_AFTER_ENABLE=1
expect_failure runner_command "$runner_root" install --staging "$runner_stage"
unset FIXTURE_RUNNER_FAIL_AFTER_ENABLE
[[ ! -e "$runner_root/opt/dam-hopper" && ! -e "$runner_root/etc/systemd/system/dam-hopper.service" &&
  ! -e "$runner_preexisting_wants" && -e "$runner_sibling_wants" ]] ||
  fail "post-install cleanup changed an unrelated enablement sibling"
assert_runner_systemctl_calls $'daemon-reload\nenable\ndisable\ndaemon-reload'
pass "runner cleans transaction-created enablement after post-install failure"

: > "$runner_root/systemctl.calls"
export FIXTURE_RUNNER_FAIL_AFTER_ENABLE=1
export FIXTURE_RUNNER_FAIL_COMMAND=disable
expect_failure runner_command "$runner_root" install --staging "$runner_stage"
unset FIXTURE_RUNNER_FAIL_AFTER_ENABLE
unset FIXTURE_RUNNER_FAIL_COMMAND
[[ -e "$runner_root/opt/dam-hopper" && -e "$runner_root/etc/systemd/system/dam-hopper.service" &&
  -L "$runner_preexisting_wants" && -e "$runner_sibling_wants" ]] ||
  fail "disable failure did not retain partial install evidence"
assert_runner_systemctl_calls $'daemon-reload\nenable'
rm -f -- "$runner_preexisting_wants" "$runner_sibling_wants"
rm -rf -- "$runner_root/opt/dam-hopper" "$runner_root/etc/systemd/system/dam-hopper.service"
pass "runner retains partial assets when enablement disable fails"

: > "$runner_root/systemctl.calls"
export FIXTURE_RUNNER_FAIL_COMMAND=systemd-analyze
export FIXTURE_RUNNER_VALIDATE_UNIT=1
expect_failure runner_command "$runner_root" install --staging "$runner_stage"
unset FIXTURE_RUNNER_FAIL_COMMAND
unset FIXTURE_RUNNER_VALIDATE_UNIT
[[ ! -e "$runner_root/opt/dam-hopper" && ! -e "$runner_root/etc/systemd/system/dam-hopper.service" ]] ||
  fail "systemd verification failure left partial install assets: $(find "$runner_root/opt" "$runner_root/etc/systemd/system" -mindepth 1 -maxdepth 4 -print 2>/dev/null | sort)"
assert_runner_systemctl_calls $'daemon-reload'
pass "runner cleans a partial install after systemd verification failure"

: > "$runner_root/systemctl.calls"
export FIXTURE_RUNNER_FAIL_COMMAND=enable
expect_failure runner_command "$runner_root" install --staging "$runner_stage"
unset FIXTURE_RUNNER_FAIL_COMMAND
[[ ! -e "$runner_root/opt/dam-hopper" && ! -e "$runner_root/etc/systemd/system/dam-hopper.service" ]] ||
  fail "enable failure left partial install assets: $(find "$runner_root/opt" "$runner_root/etc/systemd/system" -mindepth 1 -maxdepth 4 -print 2>/dev/null | sort)"
assert_runner_systemctl_calls $'daemon-reload\ndaemon-reload'
pass "runner cleans a partial install after enable failure"

: > "$runner_root/systemctl.calls"
runner_install_output="$(runner_command "$runner_root" install --staging "$runner_stage")"
[[ -d "$runner_root/opt/dam-hopper/.systemd-fresh-install" ]] || fail "runner install marker"
[[ ! -e "$runner_root/opt/dam-hopper/web" ]] || fail "runner install copied web assets"
[[ "$(find "$runner_root/opt/dam-hopper/.systemd-fresh-install" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)" == $'manifest\nnonce' ]] ||
  fail "runner install marker contains web metadata"
[[ ! -e "$runner_root/systemctl.active" ]] || fail "install started the service"
assert_runner_systemctl_calls $'daemon-reload\nenable'
! grep -Fxq start "$runner_root/systemctl.calls" || fail "install start call"
pass "runner install verifies assets, enables, and does not start"

runner_status_output="$(runner_command "$runner_root" status)"
grep -Fxq 'installed=valid' <<< "$runner_status_output" || fail "runner status"
grep -Fxq 'enabled=enabled' <<< "$runner_status_output" || fail "runner enabled status"

legacy_unit="$TEST_ROOT/legacy-dam-hopper.service"
current_unit="$TEST_ROOT/current-dam-hopper.service"
cp -- "$runner_root/etc/systemd/system/dam-hopper.service" "$current_unit"
sed '/^EnvironmentFile=/d' "$current_unit" > "$legacy_unit"
cp -- "$legacy_unit" "$runner_root/etc/systemd/system/dam-hopper.service"
legacy_unit_hash="$(sha256sum "$legacy_unit" | cut -d' ' -f1)"
sed -i "s/^unit_sha256=.*/unit_sha256=$legacy_unit_hash/" \
  "$runner_root/opt/dam-hopper/.systemd-fresh-install/manifest"
expect_failure runner_command "$runner_root" status
runner_command "$runner_root" rollback --dry-run >/dev/null
cp -- "$current_unit" "$runner_root/etc/systemd/system/dam-hopper.service"
current_unit_hash="$(sha256sum "$current_unit" | cut -d' ' -f1)"
sed -i "s/^unit_sha256=.*/unit_sha256=$current_unit_hash/" \
  "$runner_root/opt/dam-hopper/.systemd-fresh-install/manifest"
pass "rollback accepts marker-backed legacy unit while start/status enforce current contract"

export FIXTURE_RUNNER_SS_ERROR=1
expect_failure runner_command "$runner_root" start --dry-run
unset FIXTURE_RUNNER_SS_ERROR
pass "runner refuses listener inspection errors instead of treating them as free ports"
: > "$runner_root/systemctl.calls"
runner_command "$runner_root" start >/dev/null
[[ -e "$runner_root/systemctl.active" ]] || fail "runner start call"
assert_runner_systemctl_calls start
pass "runner start validates installed evidence and wildcard listener"

runner_foreign_target="$runner_root/foreign-dam-hopper.service"
printf '%s\n' foreign > "$runner_foreign_target"
rm -f -- "$runner_wants_dir/dam-hopper.service"
ln -s -- "$runner_foreign_target" "$runner_wants_dir/dam-hopper.service"
if printf '%s\n' "ROLLBACK $runner_root/opt/dam-hopper" |
  runner_command "$runner_root" rollback --confirm >/dev/null 2>&1; then
  fail "rollback accepted a foreign enablement link"
fi
[[ -L "$runner_wants_dir/dam-hopper.service" ]] || fail "rollback removed a foreign enablement link"
[[ "$(readlink -- "$runner_wants_dir/dam-hopper.service")" == "$runner_foreign_target" ]] ||
  fail "rollback changed a foreign enablement link"
rm -f -- "$runner_wants_dir/dam-hopper.service"
ln -s -- "$runner_root/etc/systemd/system/dam-hopper.service" \
  "$runner_wants_dir/dam-hopper.service"
pass "rollback refuses a foreign enablement link"

runner_runtime_sentinel="$runner_runtime/runtime-sentinel"
printf '%s\n' preserve > "$runner_runtime_sentinel"
runner_command "$runner_root" rollback --dry-run >/dev/null
[[ -e "$runner_runtime_sentinel" ]] || fail "rollback dry-run changed runtime"
printf '%s\n' "ROLLBACK $runner_root/opt/dam-hopper" |
  runner_command "$runner_root" rollback --confirm >/dev/null
[[ ! -e "$runner_root/opt/dam-hopper" && ! -e "$runner_root/etc/systemd/system/dam-hopper.service" ]] ||
  fail "rollback left installed assets"
[[ -e "$runner_runtime_sentinel" ]] || fail "rollback removed user runtime state"
[[ ! -e "$runner_wants_dir/dam-hopper.service" && ! -L "$runner_wants_dir/dam-hopper.service" ]] ||
  fail "rollback left the enablement link"
assert_runner_systemctl_calls $'start\nstop\ndisable\ndaemon-reload'
pass "runner rollback is marker-backed and preserves user runtime"

runner_drift_output="$(runner_command "$runner_root" build)"
runner_drift_stage="$(sed -n 's/^staging_dir=//p' <<< "$runner_drift_output")"
printf '%s\n' drift >> "$runner_drift_stage/bin/dam-hopper-server"
expect_failure runner_command "$runner_root" install --staging "$runner_drift_stage"
[[ ! -e "$runner_root/opt/dam-hopper" ]] || fail "drifted stage was installed"
pass "runner refuses staged artifact drift"

JOURNAL_CHECK_SCRIPT="$REPO_ROOT/scripts/phase-03-journal-check.sh"
journal_fixture_root="$TEST_ROOT/journal-check"
journal_fake_bin="$journal_fixture_root/bin"
journal_source="$journal_fixture_root/journal.txt"
journal_token_file="$journal_fixture_root/token"
mkdir -p -- "$journal_fake_bin"
cat > "$journal_fake_bin/sudo" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${1:-}" == -v ]]; then
  exit 0
fi
exec "$@"
STUB
cat > "$journal_fake_bin/journalctl" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${FIXTURE_JOURNAL_RC:-0}" != 0 ]]; then
  exit "$FIXTURE_JOURNAL_RC"
fi
cat "${FIXTURE_JOURNAL_SOURCE:?}"
STUB
journal_real_rg="$(type -P rg)" || fail "rg is unavailable for journal fixtures"
cat > "$journal_fake_bin/rg" <<STUB
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "\${FIXTURE_RG_ERROR:-0}" == 1 && "\$*" == *mongodb* ]]; then
  exit 2
fi
exec "$journal_real_rg" "\$@"
STUB
chmod 755 "$journal_fake_bin"/*
printf '%s\n' 'fixture-token' > "$journal_token_file"
chmod 600 "$journal_token_file"
printf '%s\n' 'Disposing all PTY sessions' 'Server shutdown complete' > "$journal_source"
journal_check_env=(
  PATH="$journal_fake_bin:$PATH"
  PHASE03_JOURNAL_TOKEN_PATH="$journal_token_file"
  FIXTURE_JOURNAL_SOURCE="$journal_source"
)
journal_check_output="$(env "${journal_check_env[@]}" bash "$JOURNAL_CHECK_SCRIPT")" ||
  fail "journal helper rejected a passing fixture"
grep -Fxq 'journal_read=1' <<< "$journal_check_output" || fail "journal helper read flag"
grep -Fxq 'journal_dispose=1' <<< "$journal_check_output" || fail "journal helper dispose flag"
grep -Fxq 'journal_shutdown=1' <<< "$journal_check_output" || fail "journal helper shutdown flag"
grep -Fxq 'journal_secret_scan=1' <<< "$journal_check_output" || fail "journal helper secret flag"
pass "journal helper passes clean bounded fixture"

printf '%s\n' 'startup only' > "$journal_source"
expect_failure env "${journal_check_env[@]}" bash "$JOURNAL_CHECK_SCRIPT"
pass "journal helper rejects missing lifecycle markers"

printf '%s\n' 'Disposing all PTY sessions' 'Server shutdown complete' > "$journal_source"
export FIXTURE_JOURNAL_RC=1
expect_failure env "${journal_check_env[@]}" bash "$JOURNAL_CHECK_SCRIPT"
unset FIXTURE_JOURNAL_RC
pass "journal helper rejects journal read failures"

expect_failure env \
  PATH="$journal_fake_bin:$PATH" \
  PHASE03_JOURNAL_TOKEN_PATH="$journal_fixture_root/missing-token" \
  FIXTURE_JOURNAL_SOURCE="$journal_source" \
  bash "$JOURNAL_CHECK_SCRIPT"
pass "journal helper rejects unavailable token inspection"

export FIXTURE_RG_ERROR=1
expect_failure env "${journal_check_env[@]}" bash "$JOURNAL_CHECK_SCRIPT"
unset FIXTURE_RG_ERROR
pass "journal helper rejects scanner errors"

test -x "$RESET_SCRIPT" || fail "reset script is not executable"
test -x "$RUNNER_SCRIPT" || fail "production runner is not executable"
test -x "$JOURNAL_CHECK_SCRIPT" || fail "journal helper is not executable"
pnpm linux:production -- --help >/dev/null
pnpm linux:reset -- --help >/dev/null
pass "Linux package aliases forward help arguments to executable scripts"

printf '%s\n' 'Phase 02 runner fixture tests passed.'
