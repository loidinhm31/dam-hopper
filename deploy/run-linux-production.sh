#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly EXPECTED_USER="loidinh"
readonly EXPECTED_HOME="/home/loidinh"
readonly EXPECTED_REPO="/home/loidinh/WS/dam-hopper-ws/systemd-system-service"
readonly EXPECTED_BRANCH="feat/systemd-system-service"
readonly UNIT_NAME="dam-hopper.service"
readonly UNIT_SOURCE_RELATIVE="deploy/systemd/dam-hopper.service"
readonly ENV_SUFFIX=".e""nv"
readonly SERVER_ENV_NAME="server${ENV_SUFFIX}"
readonly SAFETY_ENV_NAME="server-safety${ENV_SUFFIX}"

SCRIPT_PATH="$(readlink -f -- "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd -- "$(dirname -- "$SCRIPT_PATH")/.." && pwd -P)"
COMMAND=""
DRY_RUN=0
INSTALL_DEPS=0
ROLLBACK_CONFIRMED=0
STAGE_INPUT=""
FIXTURE_MODE=0
FIXTURE_ROOT=""
LOCK_FD=""
STAGE_DIR=""
INSTALL_TMP=""
UNIT_TMP=""
TEMP_DIRS=()

FIXTURE_ENV_MODE="${DAM_HOPPER_PRODUCTION_FIXTURE_MODE:-0}"
FIXTURE_ENV_ROOT="${DAM_HOPPER_PRODUCTION_FIXTURE_ROOT:-}"
case "$FIXTURE_ENV_MODE" in
  0)
    [[ -z "$FIXTURE_ENV_ROOT" ]] || {
      printf '%s\n' "Refusing Linux production runner: fixture root requires fixture mode" >&2
      exit 1
    }
    ;;
  1)
    [[ -n "$FIXTURE_ENV_ROOT" ]] || {
      printf '%s\n' "Refusing Linux production runner: fixture mode requires a fixture root" >&2
      exit 1
    }
    FIXTURE_MODE=1
    FIXTURE_ROOT="$(realpath -e -- "$FIXTURE_ENV_ROOT")" || {
      printf '%s\n' "Refusing Linux production runner: fixture root does not exist" >&2
      exit 1
    }
    [[ "$FIXTURE_ROOT" != "/" && "$FIXTURE_ROOT" != "$REPO_ROOT" &&
      "$FIXTURE_ROOT" != "$REPO_ROOT"/* ]] || {
      printf '%s\n' "Refusing Linux production runner: fixture root must be outside the repository" >&2
      exit 1
    }
    ;;
  *)
    printf '%s\n' "Refusing Linux production runner: fixture mode must be 0 or 1" >&2
    exit 1
    ;;
esac

USER_UID="$(id -u "$EXPECTED_USER" 2>/dev/null)" || {
  printf '%s\n' "Refusing Linux production runner: expected service user does not exist" >&2
  exit 1
}
USER_GID="$(id -g "$EXPECTED_USER" 2>/dev/null)" || {
  printf '%s\n' "Refusing Linux production runner: expected service group does not exist" >&2
  exit 1
}

if (( FIXTURE_MODE )); then
  RUNTIME_PARENT="$FIXTURE_ROOT/config"
  RUNTIME_DIR="$RUNTIME_PARENT/dam-hopper"
  INSTALL_PARENT="$FIXTURE_ROOT/opt"
  INSTALL_ROOT="$INSTALL_PARENT/dam-hopper"
  UNIT_PARENT="$FIXTURE_ROOT/etc/systemd/system"
  UNIT_PATH="$UNIT_PARENT/$UNIT_NAME"
  ROOT_UID="$USER_UID"
  ROOT_GID="$USER_GID"
  STAGE_PARENT="${DAM_HOPPER_PRODUCTION_STAGE_PARENT:-$FIXTURE_ROOT/staging}"
else
  RUNTIME_PARENT="$EXPECTED_HOME/.config"
  RUNTIME_DIR="$RUNTIME_PARENT/dam-hopper"
  INSTALL_PARENT="/opt"
  INSTALL_ROOT="/opt/dam-hopper"
  UNIT_PARENT="/etc/systemd/system"
  UNIT_PATH="$UNIT_PARENT/$UNIT_NAME"
  ROOT_UID=0
  ROOT_GID=0
  STAGE_PARENT="${DAM_HOPPER_PRODUCTION_STAGE_PARENT:-${TMPDIR:-/tmp}}"
fi

LOCK_PATH="$RUNTIME_PARENT/.dam-hopper-linux-production.lock"
MARKER_DIR="$INSTALL_ROOT/.systemd-fresh-install"
MANIFEST="$MARKER_DIR/manifest"
NONCE_FILE="$MARKER_DIR/nonce"
WEB_MANIFEST="$MARKER_DIR/web.sha256"
BIN_DIR="$INSTALL_ROOT/bin"
WEB_DIR="$INSTALL_ROOT/web"
BINARY_PATH="$BIN_DIR/dam-hopper-server"
UNIT_SOURCE="$REPO_ROOT/$UNIT_SOURCE_RELATIVE"

if (( FIXTURE_MODE )); then
  FIXTURE_SOURCE="${DAM_HOPPER_PRODUCTION_FIXTURE_SOURCE:-$FIXTURE_ROOT/source}"
  BUILD_BINARY="$FIXTURE_SOURCE/bin/dam-hopper-server"
  BUILD_WEB="$FIXTURE_SOURCE/web"
else
  BUILD_BINARY="$REPO_ROOT/server/target/release/dam-hopper-server"
  BUILD_WEB="$REPO_ROOT/apps/web/dist"
fi

die() {
  printf 'Refusing Linux production runner: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Guarded Linux production build/install/start workflow.

Usage:
  deploy/run-linux-production.sh build [--install-deps] [--dry-run]
  deploy/run-linux-production.sh install --staging PATH [--dry-run]
  deploy/run-linux-production.sh start [--dry-run]
  deploy/run-linux-production.sh status
  deploy/run-linux-production.sh rollback [--confirm] [--dry-run]

Commands are explicit. Build is unprivileged and prints a retained staging
directory. Install enables the unit but never starts it. Start validates the
installed evidence and starts without rebuilding. Rollback preserves user
runtime state and requires the exact confirmation:
  ROLLBACK /opt/dam-hopper

Fixture mode is test-only and requires both:
  DAM_HOPPER_PRODUCTION_FIXTURE_MODE=1
  DAM_HOPPER_PRODUCTION_FIXTURE_ROOT=/absolute/temporary/root
USAGE
}

sudo_cmd() {
  if (( FIXTURE_MODE )); then
    "$@"
  else
    sudo -n "$@"
  fi
}

cleanup() {
  local status=$?
  trap - EXIT
  local path
  for path in "${TEMP_DIRS[@]}"; do
    rm -rf -- "$path" 2>/dev/null || true
  done
  if [[ -n "$INSTALL_TMP" ]]; then
    sudo_cmd rm -rf -- "$INSTALL_TMP" 2>/dev/null || true
  fi
  if [[ -n "$UNIT_TMP" ]]; then
    sudo_cmd rm -f -- "$UNIT_TMP" 2>/dev/null || true
  fi
  if [[ -n "$LOCK_FD" ]]; then
    flock -u "$LOCK_FD" 2>/dev/null || true
    exec {LOCK_FD}>&- 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT

parse_args() {
  if [[ "${1:-}" == -- ]]; then shift; fi
  [[ $# -gt 0 ]] || { usage >&2; exit 2; }
  case "$1" in
    build|install|start|status|rollback) COMMAND="$1"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown or missing command: $1" ;;
  esac
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) DRY_RUN=1; shift ;;
      --install-deps)
        [[ "$COMMAND" == build ]] || die "--install-deps is valid only for build"
        INSTALL_DEPS=1; shift ;;
      --staging)
        [[ "$COMMAND" == install && $# -ge 2 ]] || die "--staging requires a path"
        STAGE_INPUT="$2"; shift 2 ;;
      --staging=*)
        [[ "$COMMAND" == install ]] || die "--staging is valid only for install"
        STAGE_INPUT="${1#*=}"; shift ;;
      --confirm)
        [[ "$COMMAND" == rollback ]] || die "--confirm is valid only for rollback"
        ROLLBACK_CONFIRMED=1; shift ;;
      --help|-h) usage; exit 0 ;;
      *) die "unknown option: $1" ;;
    esac
  done
  if [[ "$COMMAND" == install && -z "$STAGE_INPUT" && ! $DRY_RUN -eq 1 ]]; then
    die "install requires --staging PATH"
  fi
  if [[ "$COMMAND" == rollback && $DRY_RUN -eq 0 && $ROLLBACK_CONFIRMED -eq 0 ]]; then
    die "rollback requires --confirm; use --dry-run to inspect without mutation"
  fi
}

stat_meta() { stat -c '%u:%g:%a' -- "$1"; }
sudo_stat_meta() { sudo_cmd stat -c '%u:%g:%a' -- "$1"; }

assert_owner_mode() {
  local path="$1" expected_uid="$2" expected_gid="$3" expected_mode="$4"
  [[ -e "$path" && ! -L "$path" ]] || return 1
  [[ "$(stat_meta "$path")" == "$expected_uid:$expected_gid:$expected_mode" ]]
}

assert_sudo_owner_mode() {
  local path="$1" expected_uid="$2" expected_gid="$3" expected_mode="$4"
  sudo_cmd test -e "$path" || return 1
  sudo_cmd test ! -L "$path" || return 1
  [[ "$(sudo_stat_meta "$path")" == "$expected_uid:$expected_gid:$expected_mode" ]]
}

assert_identity() {
  [[ "$(uname -s)" == Linux ]] || die "this workflow supports Linux only"
  [[ "$(id -un)" == "$EXPECTED_USER" ]] || die "run as $EXPECTED_USER, not $(id -un)"
  if (( ! FIXTURE_MODE )); then
    [[ "${HOME:-}" == "$EXPECTED_HOME" ]] || die "HOME must be $EXPECTED_HOME"
  fi
  [[ "$REPO_ROOT" == "$EXPECTED_REPO" ]] || die "repository path must be $EXPECTED_REPO"
  [[ "$(git -C "$REPO_ROOT" branch --show-current)" == "$EXPECTED_BRANCH" ]] ||
    die "checkout must be on $EXPECTED_BRANCH"
}

require_commands() {
  local command_name
  local commands=(
    awk bash cat chmod cmp cp find flock git grep id install kill mkdir mktemp mv
    od pgrep readlink realpath rm rmdir sha256sum sleep sort stat systemctl tee tr uname wc
  )
  case "$COMMAND" in
    build) commands+=(env jq pnpm) ;;
    install|start|rollback) commands+=(fuser ss sudo systemd-analyze) ;;
    status) commands+=(fuser ss sudo) ;;
  esac
  if (( FIXTURE_MODE )); then
    local filtered=()
    for command_name in "${commands[@]}"; do
      [[ "$command_name" == sudo ]] || filtered+=("$command_name")
    done
    commands=("${filtered[@]}")
  fi
  for command_name in "${commands[@]}"; do
    command -v "$command_name" >/dev/null 2>&1 || die "required command is unavailable: $command_name"
  done
}

assert_runtime_parent() {
  [[ -d "$RUNTIME_PARENT" && ! -L "$RUNTIME_PARENT" ]] ||
    die "runtime parent is missing or a symlink: $RUNTIME_PARENT"
  assert_owner_mode "$RUNTIME_PARENT" "$USER_UID" "$USER_GID" 700 ||
    die "runtime parent ownership/mode is not private: $RUNTIME_PARENT"
}

acquire_workflow_lock() {
  (( DRY_RUN )) && return 0
  assert_runtime_parent
  [[ ! -L "$LOCK_PATH" ]] || die "workflow lock path is a symlink"
  exec {LOCK_FD}>>"$LOCK_PATH" || die "could not open workflow lock"
  chmod 600 -- "$LOCK_PATH" || die "could not secure workflow lock"
  assert_owner_mode "$LOCK_PATH" "$USER_UID" "$USER_GID" 600 ||
    die "workflow lock ownership/mode is ambiguous"
  flock -n "$LOCK_FD" || die "another Linux production workflow is already running"
}

authenticate_sudo() {
  (( FIXTURE_MODE )) && return 0
  sudo -v || die "authenticated interactive sudo is required; no mutation was performed"
}

validate_unit_contract() {
  local unit_file="$1"
  [[ -f "$unit_file" && ! -L "$unit_file" ]] || return 1
  local expected_first="EnvironmentFile=/home/loidinh/.config/dam-hopper/server${ENV_SUFFIX}"
  local expected_second="EnvironmentFile=/home/loidinh/.config/dam-hopper/${SAFETY_ENV_NAME}"
  mapfile -t environment_files < <(awk '/^EnvironmentFile=/{print}' "$unit_file")
  [[ "${#environment_files[@]}" -eq 2 ]] || return 1
  [[ "${environment_files[0]}" == "$expected_first" ]] || return 1
  [[ "${environment_files[1]}" == "$expected_second" ]] || return 1
  [[ "${environment_files[0]}" != EnvironmentFile=-* &&
    "${environment_files[1]}" != EnvironmentFile=-* ]] || return 1
  local required_line
  local required_lines=(
    'User=loidinh' 'Group=loidinh' 'WorkingDirectory=/home/loidinh'
    'Environment=HOME=/home/loidinh'
    'Environment=XDG_CONFIG_HOME=/home/loidinh/.config'
    'Environment=DAM_HOPPER_WEB_DIR=/opt/dam-hopper/web'
    'Environment=RUST_ENV=production'
    'ExecStart=/opt/dam-hopper/bin/dam-hopper-server --config /home/loidinh/.config/dam-hopper/dam-hopper.toml --host 127.0.0.1 --port 4801'
    'Restart=on-failure' 'KillSignal=SIGTERM' 'UMask=0077'
    'NoNewPrivileges=true' 'StandardOutput=journal' 'StandardError=journal'
  )
  for required_line in "${required_lines[@]}"; do
    grep -Fxq -- "$required_line" "$unit_file" || return 1
  done
  ! grep -Eq '(^|[[:space:]])(--no-auth|DAM_HOPPER_NO_AUTH=)' "$unit_file"
}

validate_runtime_contract() {
  assert_runtime_parent
  [[ -d "$RUNTIME_DIR" && ! -L "$RUNTIME_DIR" ]] ||
    die "Phase 01 runtime directory is missing or a symlink"
  assert_owner_mode "$RUNTIME_DIR" "$USER_UID" "$USER_GID" 700 ||
    die "Phase 01 runtime directory ownership/mode is invalid"
  assert_owner_mode "$RUNTIME_DIR/$SERVER_ENV_NAME" "$USER_UID" "$USER_GID" 600 ||
    die "server environment file ownership/mode is invalid"
  assert_owner_mode "$RUNTIME_DIR/$SAFETY_ENV_NAME" "$USER_UID" "$USER_GID" 600 ||
    die "safety environment file ownership/mode is invalid"
  local expected_safety actual_safety
  expected_safety="$(printf '%s\n' \
    'RUST_ENV=production' 'ENVIRONMENT=production' 'DAM_HOPPER_NO_AUTH=false' \
    'HOME=/home/loidinh' 'XDG_CONFIG_HOME=/home/loidinh/.config' \
    'DAM_HOPPER_WEB_DIR=/opt/dam-hopper/web')"
  actual_safety="$(<"$RUNTIME_DIR/$SAFETY_ENV_NAME")"
  [[ "$actual_safety" == "$expected_safety" ]] || die "safety environment assignments are invalid"
}

validate_build_inputs() {
  [[ -f "$BUILD_BINARY" && ! -L "$BUILD_BINARY" && -x "$BUILD_BINARY" ]] ||
    die "release server binary is missing or not executable: $BUILD_BINARY"
  [[ -d "$BUILD_WEB" && ! -L "$BUILD_WEB" ]] ||
    die "production web directory is missing or a symlink: $BUILD_WEB"
  [[ -f "$BUILD_WEB/index.html" && ! -L "$BUILD_WEB/index.html" ]] ||
    die "production web index is missing"
  [[ -z "$(find "$BUILD_WEB" -xdev -type l -print -quit)" ]] || die "production web tree contains a symlink"
  [[ -z "$(find "$BUILD_WEB" -xdev -type f -name '*[[:space:]]*' -print -quit)" ]] ||
    die "production web tree contains an ambiguous whitespace filename"
  validate_unit_contract "$UNIT_SOURCE" || die "repository systemd unit contract is invalid"
}

scan_sensitive_tree() {
  local root="$1" sensitive_path
  sensitive_path="$(find "$root" -xdev -type f \( \
    -name '[.]e[n]v' -o -name '[.]e[n]v.*' -o -name '*.pem' -o -name '*.key' -o \
    -iname '*credential*' -o -iname '*secret*' \
  \) -print -quit)"
  [[ -z "$sensitive_path" ]] || die "staged tree contains a sensitive filename"
  if grep -R -I -E -l \
    'BEGIN [A-Z0-9 ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|mongodb(\+srv)?://[^[:space:]]+' \
    "$root" >/dev/null 2>&1; then
    die "staged tree contains a credential-bearing value"
  fi
}

run_shell_quality_gate() {
  bash -n "$REPO_ROOT/deploy/reset-linux-production.sh"
  bash -n "$REPO_ROOT/deploy/run-linux-production.sh"
  if command -v shellcheck >/dev/null 2>&1; then
    shellcheck "$REPO_ROOT/deploy/reset-linux-production.sh" "$REPO_ROOT/deploy/run-linux-production.sh"
  else
    printf '%s\n' "shellcheck=not-installed (bash syntax gate passed)" >&2
  fi
}

run_repository_check() {
  local check_log
  check_log="$(mktemp)" || die "could not create the repository check log"
  TEMP_DIRS+=("$check_log")
  if env -u VITE_DAM_HOPPER_SERVER_URL pnpm check 2>&1 | tee "$check_log"; then
    printf '%s\n' "repository_check=passed"
    return 0
  fi
  if grep -Fq -- "A public key has been found, but no private key." "$check_log"; then
    printf '%s\n' "repository_check=known-native-signing-prerequisite; focused server/web gates continue" >&2
    return 0
  fi
  die "pnpm check failed outside the documented native signing prerequisite"
}

run_build_gate() {
  if (( FIXTURE_MODE )); then
    validate_build_inputs
    return 0
  fi
  if (( INSTALL_DEPS )); then pnpm install --frozen-lockfile; fi
  run_repository_check
  pnpm lint
  pnpm test
  pnpm --filter @dam-hopper/ui test
  pnpm --filter @dam-hopper/ui exec tsc -p tsconfig.json --noEmit
  pnpm build:server
  env -u VITE_DAM_HOPPER_SERVER_URL pnpm build
  run_shell_quality_gate
  jq empty "$REPO_ROOT/package.json"
  validate_build_inputs
}

manifest_value() {
  local manifest_file="$1" key="$2"
  sudo_cmd awk -F= -v key="$key" \
    '$1 == key { value = substr($0, index($0, "=") + 1); count++ }
     END { if (count != 1) exit 1; print value }' "$manifest_file"
}

local_manifest_value() {
  local manifest_file="$1" key="$2"
  awk -F= -v key="$key" \
    '$1 == key { value = substr($0, index($0, "=") + 1); count++ }
     END { if (count != 1) exit 1; print value }' "$manifest_file"
}

validate_manifest_format() {
  local manifest_file="$1" prefix="$2" contents line keys expected_keys
  contents="$(cat "$manifest_file")" || return 1
  [[ "$(printf '%s\n' "$contents" | awk 'NF { count++ } END { print count + 0 }')" == 6 ]] || return 1
  while IFS= read -r line; do
    [[ "$line" =~ ^[A-Za-z0-9_]+=[^[:space:]]+$ ]] || return 1
  done <<< "$contents"
  keys="$(awk -F= '/^[A-Za-z0-9_]+=/{print $1}' "$manifest_file" | LC_ALL=C sort)"
  expected_keys="$(printf '%s\n' binary_sha256 format nonce unit_sha256 web_dir_count web_file_count | LC_ALL=C sort)"
  [[ "$keys" == "$expected_keys" ]] || return 1
  local format nonce binary_hash unit_hash file_count dir_count
  format="$(local_manifest_value "$manifest_file" format)" || return 1
  nonce="$(local_manifest_value "$manifest_file" nonce)" || return 1
  binary_hash="$(local_manifest_value "$manifest_file" binary_sha256)" || return 1
  unit_hash="$(local_manifest_value "$manifest_file" unit_sha256)" || return 1
  file_count="$(local_manifest_value "$manifest_file" web_file_count)" || return 1
  dir_count="$(local_manifest_value "$manifest_file" web_dir_count)" || return 1
  [[ "$format" == 1 && "$nonce" =~ ^[a-f0-9]{32}$ ]] || return 1
  [[ "$binary_hash" =~ ^[a-f0-9]{64}$ && "$unit_hash" =~ ^[a-f0-9]{64}$ ]] || return 1
  [[ "$file_count" =~ ^[0-9]+$ && "$dir_count" =~ ^[0-9]+$ ]] || return 1
  [[ "$prefix" == stage || "$prefix" == installed ]] || return 1
}

verify_isolated_unit() {
  (( FIXTURE_MODE )) && return 0
  local verify_root true_path target
  verify_root="$(mktemp -d "${TMPDIR:-/tmp}/dam-hopper-systemd-verify.XXXXXX")" ||
    die "could not create isolated systemd verification root"
  TEMP_DIRS+=("$verify_root")
  true_path="$(type -P true)" || die "could not resolve an executable true command"
  mkdir -p -- \
    "$verify_root/etc/systemd/system" \
    "$verify_root/home/loidinh/.config/dam-hopper" \
    "$verify_root/home/loidinh" \
    "$verify_root/opt/dam-hopper/bin"
  for target in \
    basic.target local-fs-pre.target local-fs.target multi-user.target network-online.target \
    network.target paths.target shutdown.target slices.target sockets.target swap.target \
    sysinit.target timers.target umount.target; do
    printf '%s\n' '[Unit]' > "$verify_root/etc/systemd/system/$target"
  done
  install -m 644 -- "$STAGE_DIR/dam-hopper.service" \
    "$verify_root/etc/systemd/system/dam-hopper.service"
  install -m 755 -- "$true_path" \
    "$verify_root/opt/dam-hopper/bin/dam-hopper-server"
  : > "$verify_root/home/loidinh/.config/dam-hopper/$SERVER_ENV_NAME"
  : > "$verify_root/home/loidinh/.config/dam-hopper/$SAFETY_ENV_NAME"
  chmod 600 "$verify_root/home/loidinh/.config/dam-hopper/$SERVER_ENV_NAME" \
    "$verify_root/home/loidinh/.config/dam-hopper/$SAFETY_ENV_NAME"
  systemd-analyze --root="$verify_root" verify \
    "$verify_root/etc/systemd/system/dam-hopper.service" >/dev/null
}

create_stage() {
  [[ -d "$STAGE_PARENT" && ! -L "$STAGE_PARENT" ]] ||
    die "staging parent is missing or a symlink: $STAGE_PARENT"
  local parent_canonical
  parent_canonical="$(realpath -e -- "$STAGE_PARENT")" || die "staging parent is unavailable"
  [[ "$parent_canonical" != "$REPO_ROOT" && "$parent_canonical" != "$REPO_ROOT"/* ]] ||
    die "staging parent must be outside the repository"
  STAGE_DIR="$(mktemp -d "$parent_canonical/dam-hopper-production-stage.XXXXXX")" ||
    die "could not create unique staging directory"
  chmod 700 -- "$STAGE_DIR"
  TEMP_DIRS+=("$STAGE_DIR")
  mkdir -m 755 -- "$STAGE_DIR/bin" "$STAGE_DIR/web"
  install -m 755 -- "$BUILD_BINARY" "$STAGE_DIR/bin/dam-hopper-server"
  cp -a -- "$BUILD_WEB/." "$STAGE_DIR/web/"
  find "$STAGE_DIR/web" -type d -exec chmod 755 {} +
  find "$STAGE_DIR/web" -type f -exec chmod 644 {} +
  install -m 644 -- "$UNIT_SOURCE" "$STAGE_DIR/dam-hopper.service"

  local nonce binary_hash unit_hash web_file_count web_dir_count
  local manifest_tmp nonce_tmp
  nonce="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  binary_hash="$(sha256sum -- "$STAGE_DIR/bin/dam-hopper-server" | awk '{print $1}')"
  unit_hash="$(sha256sum -- "$STAGE_DIR/dam-hopper.service" | awk '{print $1}')"
  web_file_count="$(find "$STAGE_DIR/web" -type f | wc -l)"
  web_dir_count="$(find "$STAGE_DIR/web" -type d | wc -l)"
  (cd "$STAGE_DIR/web" &&
    LC_ALL=C find . -type f -exec sha256sum -- {} + | LC_ALL=C sort) > "$STAGE_DIR/web.sha256"
  chmod 600 -- "$STAGE_DIR/web.sha256"
  manifest_tmp="$(mktemp "$STAGE_DIR/.manifest.XXXXXX")"
  nonce_tmp="$(mktemp "$STAGE_DIR/.nonce.XXXXXX")"
  printf '%s\n' \
    'format=1' "nonce=$nonce" "binary_sha256=$binary_hash" \
    "unit_sha256=$unit_hash" "web_file_count=$web_file_count" \
    "web_dir_count=$web_dir_count" > "$manifest_tmp"
  printf '%s\n' "$nonce" > "$nonce_tmp"
  chmod 600 -- "$manifest_tmp" "$nonce_tmp"
  mv -T -- "$manifest_tmp" "$STAGE_DIR/manifest"
  mv -T -- "$nonce_tmp" "$STAGE_DIR/nonce"
  scan_sensitive_tree "$STAGE_DIR"
  verify_stage
  TEMP_DIRS=()
}

verify_stage() {
  [[ -n "$STAGE_DIR" && -d "$STAGE_DIR" && ! -L "$STAGE_DIR" ]] || return 1
  assert_owner_mode "$STAGE_DIR" "$USER_UID" "$USER_GID" 700 || return 1
  local expected_root actual_root
  expected_root="$(printf '%s\n' bin dam-hopper.service manifest nonce web web.sha256 | LC_ALL=C sort)"
  actual_root="$(find "$STAGE_DIR" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" || return 1
  [[ "$actual_root" == "$expected_root" ]] || return 1
  assert_owner_mode "$STAGE_DIR/bin" "$USER_UID" "$USER_GID" 755 || return 1
  assert_owner_mode "$STAGE_DIR/bin/dam-hopper-server" "$USER_UID" "$USER_GID" 755 || return 1
  assert_owner_mode "$STAGE_DIR/web" "$USER_UID" "$USER_GID" 755 || return 1
  assert_owner_mode "$STAGE_DIR/dam-hopper.service" "$USER_UID" "$USER_GID" 644 || return 1
  assert_owner_mode "$STAGE_DIR/manifest" "$USER_UID" "$USER_GID" 600 || return 1
  assert_owner_mode "$STAGE_DIR/nonce" "$USER_UID" "$USER_GID" 600 || return 1
  assert_owner_mode "$STAGE_DIR/web.sha256" "$USER_UID" "$USER_GID" 600 || return 1
  [[ -z "$(find "$STAGE_DIR" -xdev -type l -print -quit)" ]] || return 1
  validate_manifest_format "$STAGE_DIR/manifest" stage || return 1
  [[ "$(<"$STAGE_DIR/nonce")" == "$(local_manifest_value "$STAGE_DIR/manifest" nonce)" ]] || return 1
  local actual_binary_hash actual_unit_hash
  actual_binary_hash="$(sha256sum -- "$STAGE_DIR/bin/dam-hopper-server" | awk '{print $1}')"
  actual_unit_hash="$(sha256sum -- "$STAGE_DIR/dam-hopper.service" | awk '{print $1}')"
  [[ "$actual_binary_hash" == "$(local_manifest_value "$STAGE_DIR/manifest" binary_sha256)" ]] || return 1
  [[ "$actual_unit_hash" == "$(local_manifest_value "$STAGE_DIR/manifest" unit_sha256)" ]] || return 1
  local file_count dir_count
  file_count="$(local_manifest_value "$STAGE_DIR/manifest" web_file_count)"
  dir_count="$(local_manifest_value "$STAGE_DIR/manifest" web_dir_count)"
  [[ "$file_count" -eq "$(find "$STAGE_DIR/web" -type f | wc -l)" ]] || return 1
  [[ "$dir_count" -eq "$(find "$STAGE_DIR/web" -type d | wc -l)" ]] || return 1
  [[ -z "$(find "$STAGE_DIR/web" -type d ! -perm 0755 -print -quit)" ]] || return 1
  [[ -z "$(find "$STAGE_DIR/web" -type f ! -perm 0644 -print -quit)" ]] || return 1
  local manifest_paths actual_paths
  manifest_paths="$(mktemp)"
  actual_paths="$(mktemp)"
  TEMP_DIRS+=("$manifest_paths" "$actual_paths")
  awk '{print $2}' "$STAGE_DIR/web.sha256" | LC_ALL=C sort > "$manifest_paths"
  (cd "$STAGE_DIR/web" && find . -type f -printf './%P\n' | LC_ALL=C sort) > "$actual_paths"
  cmp -s -- "$manifest_paths" "$actual_paths" || return 1
  (cd "$STAGE_DIR/web" && sha256sum --check "$STAGE_DIR/web.sha256" >/dev/null) || return 1
  validate_unit_contract "$STAGE_DIR/dam-hopper.service" || return 1
  scan_sensitive_tree "$STAGE_DIR"
  verify_isolated_unit
  rm -f -- "$manifest_paths" "$actual_paths"
}

build_command() {
  acquire_workflow_lock
  if (( DRY_RUN )); then
    validate_unit_contract "$UNIT_SOURCE" || die "repository systemd unit contract is invalid"
    printf '%s\n' "Build dry run complete; no commands, staging, or filesystem mutation were performed."
    return 0
  fi
  run_build_gate
  create_stage
  printf 'staging_dir=%s\n' "$STAGE_DIR"
  printf '%s\n' "Build and staging complete; install was not attempted and the unit was not started."
}

assert_sudo_directory() {
  local path="$1" expected_uid="$2" expected_gid="$3" expected_mode="$4"
  sudo_cmd test -d "$path" || return 1
  sudo_cmd test ! -L "$path" || return 1
  [[ "$(sudo_stat_meta "$path")" == "$expected_uid:$expected_gid:$expected_mode" ]]
}

validate_stage_input() {
  [[ -n "$STAGE_INPUT" ]] || die "install requires --staging PATH"
  [[ ! -L "$STAGE_INPUT" ]] || die "staging path must not be a symlink"
  STAGE_DIR="$(realpath -e -- "$STAGE_INPUT")" || die "staging path does not exist"
  verify_stage || die "staging manifest, inventory, ownership, or unit verification failed"
}

assert_port_free() {
  local port="$1" listeners
  listeners="$(sudo_cmd ss -Hln "sport = :$port" 2>/dev/null)" || return 1
  [[ -z "$listeners" ]]
}

assert_no_exact_processes() {
  local processes status=0
  processes="$(sudo_cmd pgrep -x dam-hopper-server 2>/dev/null)" || status=$?
  (( status == 0 || status == 1 )) || return 1
  [[ -z "$processes" ]]
}

assert_no_database_holders() {
  [[ -d "$RUNTIME_DIR" && ! -L "$RUNTIME_DIR" ]] || return 0
  local database_path status=0 database_paths
  database_paths="$(sudo_cmd find "$RUNTIME_DIR" -xdev -type f \( \
    -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' \
  \) -print)" || return 1
  while IFS= read -r database_path; do
    [[ -n "$database_path" ]] || continue
    status=0
    sudo_cmd fuser -s "$database_path" >/dev/null 2>&1 || status=$?
    case "$status" in
      0) return 1 ;;
      1) ;;
      *) return 1 ;;
    esac
  done <<< "$database_paths"
}

preflight_install_targets() {
  validate_runtime_contract
  assert_sudo_directory "$INSTALL_PARENT" "$ROOT_UID" "$ROOT_GID" 755 ||
    die "install parent ownership/mode is invalid: $INSTALL_PARENT"
  assert_sudo_directory "$UNIT_PARENT" "$ROOT_UID" "$ROOT_GID" 755 ||
    die "unit parent ownership/mode is invalid: $UNIT_PARENT"
  if sudo_cmd test -e "$INSTALL_ROOT" || sudo_cmd test -L "$INSTALL_ROOT"; then
    die "install root already exists; unknown/pre-existing assets will not be overwritten"
  fi
  if sudo_cmd test -e "$UNIT_PATH" || sudo_cmd test -L "$UNIT_PATH"; then
    die "systemd unit already exists; unknown/pre-existing asset will not be overwritten"
  fi
  assert_no_exact_processes || die "an exact DamHopper process already owns runtime"
  assert_port_free 4800 || die "port 4800 is occupied or cannot be inspected"
  assert_port_free 4801 || die "port 4801 is occupied or cannot be inspected"
  assert_no_database_holders || die "a runtime database is already held by a process"
}

prepare_install_tree() {
  INSTALL_TMP="$(sudo_cmd mktemp -d -p "$INSTALL_PARENT" '.dam-hopper-install.XXXXXX')" ||
    die "could not create privileged temporary install tree"
  sudo_cmd chmod 700 -- "$INSTALL_TMP"
  sudo_cmd install -d -o "$ROOT_UID" -g "$ROOT_GID" -m 755 \
    "$INSTALL_TMP/bin" "$INSTALL_TMP/web"
  sudo_cmd install -d -o "$ROOT_UID" -g "$ROOT_GID" -m 700 \
    "$INSTALL_TMP/.systemd-fresh-install"
  sudo_cmd install -o "$ROOT_UID" -g "$ROOT_GID" -m 755 \
    "$STAGE_DIR/bin/dam-hopper-server" "$INSTALL_TMP/bin/dam-hopper-server"
  sudo_cmd cp -a -- "$STAGE_DIR/web/." "$INSTALL_TMP/web/"
  sudo_cmd chown -R "$ROOT_UID:$ROOT_GID" -- "$INSTALL_TMP/web"
  sudo_cmd find "$INSTALL_TMP/web" -type d -exec chmod 755 {} +
  sudo_cmd find "$INSTALL_TMP/web" -type f -exec chmod 644 {} +
  sudo_cmd install -o "$ROOT_UID" -g "$ROOT_GID" -m 600 \
    "$STAGE_DIR/manifest" "$INSTALL_TMP/.systemd-fresh-install/manifest"
  sudo_cmd install -o "$ROOT_UID" -g "$ROOT_GID" -m 600 \
    "$STAGE_DIR/nonce" "$INSTALL_TMP/.systemd-fresh-install/nonce"
  sudo_cmd install -o "$ROOT_UID" -g "$ROOT_GID" -m 600 \
    "$STAGE_DIR/web.sha256" "$INSTALL_TMP/.systemd-fresh-install/web.sha256"
  UNIT_TMP="$(sudo_cmd mktemp -p "$UNIT_PARENT" '.dam-hopper.service.XXXXXX')" ||
    die "could not create privileged temporary unit"
  sudo_cmd install -o "$ROOT_UID" -g "$ROOT_GID" -m 644 \
    "$STAGE_DIR/dam-hopper.service" "$UNIT_TMP"
  sudo_cmd chmod 755 -- "$INSTALL_TMP"
}

manifest_value_installed() {
  local key="$1"
  sudo_cmd awk -F= -v key="$key" \
    '$1 == key { value = substr($0, index($0, "=") + 1); count++ }
     END { if (count != 1) exit 1; print value }' "$MANIFEST"
}

verify_web_manifest_paths() {
  local contents line relative manifest_paths actual_paths
  contents="$(sudo_cmd cat "$WEB_MANIFEST")" || return 1
  manifest_paths="$(mktemp)"
  actual_paths="$(mktemp)"
  TEMP_DIRS+=("$manifest_paths" "$actual_paths")
  TEMP_DIRS+=("${manifest_paths}.sorted" "${actual_paths}.sorted")
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[a-f0-9]{64}[[:space:]]+([^[:space:]]+)$ ]] || return 1
    relative="${BASH_REMATCH[1]}"
    [[ "$relative" == ./* && "$relative" != *"/../"* &&
      "$relative" != ../* && "$relative" != /* ]] || return 1
    printf '%s\n' "$relative" >> "$manifest_paths"
  done <<< "$contents"
  (cd "$WEB_DIR" && sudo_cmd find . -type f -printf './%P\n' | LC_ALL=C sort) > "$actual_paths" || return 1
  LC_ALL=C sort -- "$manifest_paths" > "${manifest_paths}.sorted"
  LC_ALL=C sort -- "$actual_paths" > "${actual_paths}.sorted"
  cmp -s -- "${manifest_paths}.sorted" "${actual_paths}.sorted" || return 1
  (cd "$WEB_DIR" && sudo_cmd sha256sum --check "$WEB_MANIFEST" >/dev/null) || return 1
}

verify_installed_manifest() {
  assert_sudo_directory "$INSTALL_ROOT" "$ROOT_UID" "$ROOT_GID" 755 || return 1
  assert_sudo_directory "$MARKER_DIR" "$ROOT_UID" "$ROOT_GID" 700 || return 1
  assert_sudo_owner_mode "$MANIFEST" "$ROOT_UID" "$ROOT_GID" 600 || return 1
  assert_sudo_owner_mode "$NONCE_FILE" "$ROOT_UID" "$ROOT_GID" 600 || return 1
  assert_sudo_owner_mode "$WEB_MANIFEST" "$ROOT_UID" "$ROOT_GID" 600 || return 1
  assert_sudo_directory "$BIN_DIR" "$ROOT_UID" "$ROOT_GID" 755 || return 1
  assert_sudo_directory "$WEB_DIR" "$ROOT_UID" "$ROOT_GID" 755 || return 1
  assert_sudo_owner_mode "$BINARY_PATH" "$ROOT_UID" "$ROOT_GID" 755 || return 1
  assert_sudo_owner_mode "$UNIT_PATH" "$ROOT_UID" "$ROOT_GID" 644 || return 1
  local expected_root actual_root expected_marker actual_marker
  expected_root="$(printf '%s\n' .systemd-fresh-install bin web | LC_ALL=C sort)"
  actual_root="$(sudo_cmd find "$INSTALL_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" || return 1
  [[ "$actual_root" == "$expected_root" ]] || return 1
  expected_marker="$(printf '%s\n' manifest nonce web.sha256 | LC_ALL=C sort)"
  actual_marker="$(sudo_cmd find "$MARKER_DIR" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" || return 1
  [[ "$actual_marker" == "$expected_marker" ]] || return 1
  [[ "$(sudo_cmd find "$BIN_DIR" -mindepth 1 -maxdepth 1 -printf '%f\n')" == dam-hopper-server ]] || return 1
  local manifest_lines malformed_manifest_lines installed_keys expected_installed_keys format
  manifest_lines="$(sudo_cmd awk 'NF { count++ } END { print count + 0 }' "$MANIFEST")" || return 1
  [[ "$manifest_lines" == 6 ]] || return 1
  malformed_manifest_lines="$(sudo_cmd awk 'NF && $0 !~ /^[A-Za-z0-9_]+=[^[:space:]]+$/ { print "invalid"; exit }' "$MANIFEST")" || return 1
  [[ -z "$malformed_manifest_lines" ]] || return 1
  installed_keys="$(sudo_cmd awk -F= '/^[A-Za-z0-9_]+=/{print $1}' "$MANIFEST" | LC_ALL=C sort)" || return 1
  expected_installed_keys="$(printf '%s\n' binary_sha256 format nonce unit_sha256 web_dir_count web_file_count | LC_ALL=C sort)"
  [[ "$installed_keys" == "$expected_installed_keys" ]] || return 1
  format="$(manifest_value_installed format)" || return 1
  [[ "$format" == 1 ]] || return 1
  local nonce actual_nonce binary_hash unit_hash actual_hash file_count dir_count
  nonce="$(manifest_value_installed nonce)" || return 1
  [[ "$nonce" =~ ^[a-f0-9]{32}$ ]] || return 1
  actual_nonce="$(sudo_cmd cat "$NONCE_FILE")" || return 1
  [[ "$nonce" == "$actual_nonce" ]] || return 1
  binary_hash="$(manifest_value_installed binary_sha256)" || return 1
  unit_hash="$(manifest_value_installed unit_sha256)" || return 1
  actual_hash="$(sudo_cmd sha256sum -- "$BINARY_PATH" | awk '{print $1}')" || return 1
  [[ "$binary_hash" == "$actual_hash" ]] || return 1
  actual_hash="$(sudo_cmd sha256sum -- "$UNIT_PATH" | awk '{print $1}')" || return 1
  [[ "$unit_hash" == "$actual_hash" ]] || return 1
  file_count="$(manifest_value_installed web_file_count)" || return 1
  dir_count="$(manifest_value_installed web_dir_count)" || return 1
  [[ "$file_count" =~ ^[0-9]+$ && "$dir_count" =~ ^[0-9]+$ ]] || return 1
  [[ "$file_count" -eq "$(sudo_cmd find "$WEB_DIR" -type f | wc -l)" ]] || return 1
  [[ "$dir_count" -eq "$(sudo_cmd find "$WEB_DIR" -type d | wc -l)" ]] || return 1
  [[ -z "$(sudo_cmd find "$INSTALL_ROOT" -type l -print -quit)" ]] || return 1
  [[ -z "$(sudo_cmd find "$WEB_DIR" -type d ! -uid "$ROOT_UID" -print -quit)" ]] || return 1
  [[ -z "$(sudo_cmd find "$WEB_DIR" -type d ! -gid "$ROOT_GID" -print -quit)" ]] || return 1
  [[ -z "$(sudo_cmd find "$WEB_DIR" -type d ! -perm 0755 -print -quit)" ]] || return 1
  [[ -z "$(sudo_cmd find "$WEB_DIR" -type f ! -uid "$ROOT_UID" -print -quit)" ]] || return 1
  [[ -z "$(sudo_cmd find "$WEB_DIR" -type f ! -gid "$ROOT_GID" -print -quit)" ]] || return 1
  [[ -z "$(sudo_cmd find "$WEB_DIR" -type f ! -perm 0644 -print -quit)" ]] || return 1
  [[ -z "$(sudo_cmd find "$WEB_DIR" -mindepth 1 ! -type f ! -type d -print -quit)" ]] || return 1
  verify_web_manifest_paths || return 1
  validate_unit_contract "$UNIT_PATH" || return 1
}

install_command() {
  validate_stage_input
  if (( DRY_RUN )); then
    preflight_install_targets
    printf '%s\n' "Install dry run passed; no sudo mutation, enable, or start was performed."
    return 0
  fi
  validate_runtime_contract
  acquire_workflow_lock
  validate_stage_input
  authenticate_sudo
  preflight_install_targets
  prepare_install_tree
  sudo_cmd mv -T -- "$INSTALL_TMP" "$INSTALL_ROOT"
  INSTALL_TMP=""
  sudo_cmd mv -T -- "$UNIT_TMP" "$UNIT_PATH"
  UNIT_TMP=""
  verify_installed_manifest || die "installed assets failed marker verification; no start was attempted"
  if (( ! FIXTURE_MODE )); then sudo_cmd systemd-analyze verify "$UNIT_PATH" >/dev/null; fi
  sudo_cmd systemctl daemon-reload
  sudo_cmd systemctl enable "$UNIT_NAME"
  printf '%s\n' "Install complete. The unit was enabled but not started; run start after reviewing status."
}

read_systemd_state() {
  local properties key value
  properties="$(sudo_cmd systemctl show --no-pager \
    --property=LoadState,ActiveState,SubState,MainPID "$UNIT_NAME" 2>/dev/null)" || return 1
  SYSTEMD_LOAD_STATE=""
  SYSTEMD_ACTIVE_STATE=""
  SYSTEMD_SUB_STATE=""
  SYSTEMD_MAIN_PID=""
  while IFS='=' read -r key value; do
    case "$key" in
      LoadState) SYSTEMD_LOAD_STATE="$value" ;;
      ActiveState) SYSTEMD_ACTIVE_STATE="$value" ;;
      SubState) SYSTEMD_SUB_STATE="$value" ;;
      MainPID) SYSTEMD_MAIN_PID="$value" ;;
    esac
  done <<< "$properties"
  [[ "$SYSTEMD_LOAD_STATE" == loaded || "$SYSTEMD_LOAD_STATE" == masked ]] || return 1
  [[ "$SYSTEMD_MAIN_PID" =~ ^[0-9]+$ ]]
}

read_systemd_enabled_state() {
  local status=0
  SYSTEMD_ENABLED_STATE="$(sudo_cmd systemctl is-enabled "$UNIT_NAME" 2>/dev/null)" || status=$?
  (( status == 0 || status == 1 || status == 4 )) || return 1
  [[ "$SYSTEMD_ENABLED_STATE" == enabled || "$SYSTEMD_ENABLED_STATE" == disabled ||
    "$SYSTEMD_ENABLED_STATE" == masked ]]
}

assert_loopback_listener() {
  local port="$1" listeners
  listeners="$(sudo_cmd ss -Hln "sport = :$port" 2>/dev/null)" || return 1
  [[ "$listeners" =~ 127\.0\.0\.1:$port ]] || return 1
  [[ ! "$listeners" =~ 0\.0\.0\.0:$port ]] || return 1
  [[ ! "$listeners" =~ :::${port} ]] || return 1
}

preflight_start() {
  validate_runtime_contract
  verify_installed_manifest || die "installed marker, asset, or unit verification failed"
  read_systemd_state || die "systemd unit state is unavailable or ambiguous"
  [[ "$SYSTEMD_ACTIVE_STATE" == inactive || "$SYSTEMD_ACTIVE_STATE" == failed ]] ||
    die "systemd unit is already active or transitioning"
  [[ "$SYSTEMD_MAIN_PID" == 0 ]] || die "systemd MainPID is not zero"
  read_systemd_enabled_state || die "systemd enablement state is unavailable or ambiguous"
  [[ "$SYSTEMD_ENABLED_STATE" == enabled ]] || die "systemd unit is not enabled"
  assert_no_exact_processes || die "an exact DamHopper process already exists"
  assert_port_free 4800 || die "port 4800 is occupied or cannot be inspected"
  assert_port_free 4801 || die "port 4801 is occupied or cannot be inspected"
  assert_no_database_holders || die "a runtime database is already held by a process"
}

verify_effective_process() {
  (( FIXTURE_MODE )) && return 0
  local pid="$SYSTEMD_MAIN_PID" actual_identity proc_exe expected_exe cmdline first_arg
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  actual_identity="$(sudo_cmd stat -c '%u:%g' -- "/proc/$pid")" || return 1
  [[ "$actual_identity" == "$USER_UID:$USER_GID" ]] || return 1
  proc_exe="$(sudo_cmd readlink -f -- "/proc/$pid/exe")" || return 1
  expected_exe="$(sudo_cmd readlink -f -- "$BINARY_PATH")" || return 1
  [[ "$proc_exe" == "$expected_exe" ]] || return 1
  cmdline="$(tr '\0' '\n' < "/proc/$pid/cmdline")" || return 1
  first_arg="${cmdline%%$'\n'*}"
  [[ "$first_arg" == "$BINARY_PATH" ]]
}

start_command() {
  if (( DRY_RUN )); then
    preflight_start
    printf '%s\n' "Start dry run passed; no systemd start or other mutation was performed."
    return 0
  fi
  validate_runtime_contract
  acquire_workflow_lock
  authenticate_sudo
  preflight_start
  sudo_cmd systemctl start "$UNIT_NAME" || die "systemd start failed"
  local attempt
  for attempt in $(seq 1 50); do
    read_systemd_state && [[ "$SYSTEMD_ACTIVE_STATE" == active && "$SYSTEMD_MAIN_PID" != 0 ]] && break
    sleep 0.2
  done
  read_systemd_state || die "systemd state unavailable after start"
  [[ "$SYSTEMD_ACTIVE_STATE" == active ]] || die "unit did not become active"
  [[ "$SYSTEMD_MAIN_PID" =~ ^[1-9][0-9]*$ ]] || die "unit MainPID is not a nonzero PID"
  verify_effective_process || die "effective service process identity is not loidinh/dam-hopper-server"
  assert_loopback_listener 4801 || die "service is not listening only on loopback 127.0.0.1:4801"
  assert_port_free 4800 || die "legacy port 4800 is occupied"
  printf 'active=1\nmain_pid=%s\nuid=%s\ngid=%s\nlistener=127.0.0.1:4801\n' \
    "$SYSTEMD_MAIN_PID" "$USER_UID" "$USER_GID"
}

status_command() {
  if ! verify_installed_manifest 2>/dev/null; then
    printf '%s\n' "installed=invalid"
    return 1
  fi
  read_systemd_state || die "systemd unit state is unavailable or ambiguous"
  read_systemd_enabled_state || die "systemd enablement state is unavailable or ambiguous"
  printf 'installed=valid\nenabled=%s\nload_state=%s\nactive_state=%s\nsub_state=%s\nmain_pid=%s\n' \
    "$SYSTEMD_ENABLED_STATE" "$SYSTEMD_LOAD_STATE" "$SYSTEMD_ACTIVE_STATE" \
    "$SYSTEMD_SUB_STATE" "$SYSTEMD_MAIN_PID"
}

confirm_rollback() {
  if (( ! FIXTURE_MODE )) && { [[ ! -t 0 ]] || [[ ! -t 1 ]]; }; then
    die "interactive rollback confirmation is required"
  fi
  local expected="ROLLBACK $INSTALL_ROOT" confirmation
  printf 'This removes only marker-backed installed assets under %s. Type %s to continue: ' \
    "$INSTALL_ROOT" "$expected" >&2
  IFS= read -r confirmation || die "rollback confirmation was not supplied"
  [[ "$confirmation" == "$expected" ]] || die "rollback confirmation did not match; nothing was removed"
}

preflight_rollback() {
  verify_installed_manifest || die "rollback marker, manifest, ownership, or content verification failed"
  read_systemd_state || die "systemd unit state is unavailable or ambiguous"
  case "$SYSTEMD_ACTIVE_STATE" in
    active|activating|deactivating|reloading|inactive|failed) ;;
    *) die "unexpected systemd active state: $SYSTEMD_ACTIVE_STATE" ;;
  esac
}

revalidate_stopped() {
  read_systemd_state || die "post-stop systemd state is unavailable or ambiguous"
  [[ "$SYSTEMD_ACTIVE_STATE" == inactive || "$SYSTEMD_ACTIVE_STATE" == failed ]] ||
    die "systemd unit is still active"
  [[ "$SYSTEMD_MAIN_PID" == 0 ]] || die "systemd MainPID is not zero"
  assert_no_exact_processes || die "an exact DamHopper process still exists"
  assert_port_free 4800 || die "port 4800 is occupied or cannot be inspected"
  assert_port_free 4801 || die "port 4801 is occupied or cannot be inspected"
  assert_no_database_holders || die "a runtime database is still held by a process"
}

remove_installed_assets() {
  sudo_cmd rm -f -- "$UNIT_PATH"
  sudo_cmd rm -f -- "$BINARY_PATH"
  sudo_cmd rmdir -- "$BIN_DIR"
  sudo_cmd find "$WEB_DIR" -mindepth 1 -delete
  sudo_cmd rmdir -- "$WEB_DIR"
  sudo_cmd find "$MARKER_DIR" -mindepth 1 -delete
  sudo_cmd rmdir -- "$MARKER_DIR"
  sudo_cmd rmdir -- "$INSTALL_ROOT"
  sudo_cmd systemctl daemon-reload
}

rollback_command() {
  if (( DRY_RUN )); then
    preflight_rollback
    printf '%s\n' "Rollback dry run passed; marker-backed assets and user runtime were unchanged."
    return 0
  fi
  confirm_rollback
  acquire_workflow_lock
  authenticate_sudo
  preflight_rollback
  if [[ "$SYSTEMD_ACTIVE_STATE" == active || "$SYSTEMD_ACTIVE_STATE" == activating ||
    "$SYSTEMD_ACTIVE_STATE" == deactivating || "$SYSTEMD_ACTIVE_STATE" == reloading ]]; then
    sudo_cmd systemctl stop "$UNIT_NAME" || die "systemd stop failed"
  fi
  sudo_cmd systemctl disable "$UNIT_NAME" || die "systemd disable failed"
  revalidate_stopped
  verify_installed_manifest || die "installed assets changed during rollback stop; nothing was removed"
  remove_installed_assets
  printf '%s\n' "Rollback complete. Installed assets were removed; user runtime state was preserved."
}

main() {
  parse_args "$@"
  require_commands
  assert_identity
  case "$COMMAND" in
    build) build_command ;;
    install) install_command ;;
    start) start_command ;;
    status) status_command ;;
    rollback) rollback_command ;;
    *) die "unsupported command: $COMMAND" ;;
  esac
}

main "$@"
