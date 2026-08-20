#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly EXPECTED_USER="loidinh"
readonly EXPECTED_HOME="/home/loidinh"
readonly EXPECTED_REPO="/home/loidinh/WS/dam-hopper-ws/systemd-system-service"
readonly EXPECTED_BRANCH="feat/systemd-system-service"
readonly UNIT_ENV_RUNTIME_DIR="/home/loidinh/.config/dam-hopper"
readonly UNIT_NAME="dam-hopper.service"

SCRIPT_PATH="$(readlink -f -- "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd -- "$(dirname -- "$SCRIPT_PATH")/.." && pwd -P)"
FIXTURE_MODE=0
FIXTURE_ROOT=""
ENV_INPUT=""
DRY_RUN=0
TEMP_FILES=()
LOCK_FD=""
SYSTEMD_RUNTIME_MASKED=0
RESET_SUCCEEDED=0

die() {
  printf 'Refusing Linux production reset: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Guarded Linux production runtime reset.

Usage:
  deploy/reset-linux-production.sh --env-file PATH [--dry-run]

Options:
  --env-file PATH  dotenv source to copy after the runtime is recreated
  --dry-run        validate metadata only; do not prompt, use sudo, or mutate
  --help           show this help

The normal path requires an interactive terminal and the exact confirmation:
  PURGE /home/loidinh/.config/dam-hopper

Fixture mode is test-only and requires both:
  DAM_HOPPER_RESET_FIXTURE_MODE=1
  DAM_HOPPER_RESET_FIXTURE_ROOT=/absolute/temporary/root
USAGE
}

cleanup_temp() {
  local path
  for path in "${TEMP_FILES[@]}"; do
    rm -f -- "$path" 2>/dev/null || true
  done
  if (( SYSTEMD_RUNTIME_MASKED && RESET_SUCCEEDED )); then
    if ! sudo_cmd systemctl unmask --runtime "$UNIT_NAME" >/dev/null 2>&1; then
      printf '%s\n' "Warning: systemd runtime mask remains; unmask it before starting the service." >&2
    fi
  fi
  if [[ -n "$LOCK_FD" ]]; then
    flock -u "$LOCK_FD" 2>/dev/null || true
    exec {LOCK_FD}>&- 2>/dev/null || true
  fi
}
trap cleanup_temp EXIT

if [[ "${1:-}" == -- ]]; then shift; fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      [[ $# -ge 2 ]] || die "--env-file requires a path"
      ENV_INPUT="$2"
      shift 2
      ;;
    --env-file=*)
      ENV_INPUT="${1#*=}"
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

FIXTURE_ENV_MODE="${DAM_HOPPER_RESET_FIXTURE_MODE:-0}"
FIXTURE_ENV_ROOT="${DAM_HOPPER_RESET_FIXTURE_ROOT:-}"
case "$FIXTURE_ENV_MODE" in
  0)
    [[ -z "$FIXTURE_ENV_ROOT" ]] ||
      die "fixture root requires DAM_HOPPER_RESET_FIXTURE_MODE=1"
    ;;
  1)
    [[ -n "$FIXTURE_ENV_ROOT" ]] ||
      die "DAM_HOPPER_RESET_FIXTURE_MODE=1 requires DAM_HOPPER_RESET_FIXTURE_ROOT"
    ;;
  *)
    die "DAM_HOPPER_RESET_FIXTURE_MODE must be 0 or 1"
    ;;
esac

if [[ "$FIXTURE_ENV_MODE" == "1" ]]; then
  FIXTURE_MODE=1
  FIXTURE_ROOT="$(realpath -e -- "$FIXTURE_ENV_ROOT")" ||
    die "fixture root does not exist"
  [[ "$FIXTURE_ROOT" != "/" && "$FIXTURE_ROOT" != "$REPO_ROOT"* ]] ||
    die "fixture root must be outside the repository"
fi

USER_UID="$(id -u "$EXPECTED_USER" 2>/dev/null)" ||
  die "expected service user does not exist: $EXPECTED_USER"
USER_GID="$(id -g "$EXPECTED_USER" 2>/dev/null)" ||
  die "expected service group does not exist: $EXPECTED_USER"

if (( FIXTURE_MODE )); then
  RUNTIME_PARENT="$FIXTURE_ROOT/config"
  RUNTIME_DIR="$RUNTIME_PARENT/dam-hopper"
  INSTALL_ROOT="$FIXTURE_ROOT/opt/dam-hopper"
  UNIT_PATH="$FIXTURE_ROOT/etc/systemd/system/dam-hopper.service"
  ROOT_UID="$USER_UID"
  ROOT_GID="$USER_GID"
else
  RUNTIME_PARENT="/home/loidinh/.config"
  RUNTIME_DIR="$UNIT_ENV_RUNTIME_DIR"
  INSTALL_ROOT="/opt/dam-hopper"
  UNIT_PATH="/etc/systemd/system/dam-hopper.service"
  ROOT_UID=0
  ROOT_GID=0
fi

MARKER_DIR="$INSTALL_ROOT/.systemd-fresh-install"
LOCK_PATH="$RUNTIME_PARENT/.dam-hopper-reset.lock"
MANIFEST="$MARKER_DIR/manifest"
NONCE_FILE="$MARKER_DIR/nonce"
WEB_MANIFEST="$MARKER_DIR/web.sha256"
BIN_DIR="$INSTALL_ROOT/bin"
WEB_DIR="$INSTALL_ROOT/web"
BINARY_PATH="$BIN_DIR/dam-hopper-server"
UNIT_SOURCE="$REPO_ROOT/deploy/systemd/dam-hopper.service"
PID_FILE="$RUNTIME_DIR/server.pid"
PID_START_FILE="$RUNTIME_DIR/server.pid.start"
NOHUP_BIN="$RUNTIME_DIR/bin/dam-hopper-server"
NOHUP_PID=""
SOURCE_HASH=""
SOURCE_IDENTITY=""
SOURCE_SNAPSHOT=""
SOURCE_UID=""
SOURCE_GID=""
SOURCE_MODE=""
SOURCE_BYTES=""

require_commands() {
  local command_name
  local commands=(
    awk cat chmod cmp cp find flock git id install kill mkdir mktemp mv pgrep readlink realpath
    rm seq sha256sum sleep sort ss stat systemctl tr uname wc
  )
  if (( ! FIXTURE_MODE )); then
    commands+=(fuser sudo systemd-analyze)
  else
    commands+=(fuser)
  fi
  for command_name in "${commands[@]}"; do
    command -v "$command_name" >/dev/null 2>&1 ||
      die "required command is unavailable: $command_name"
  done
}

sudo_cmd() {
  if (( FIXTURE_MODE )); then
    "$@"
  else
    sudo -n "$@"
  fi
}

stat_meta() {
  stat -c '%u:%g:%a:%s' -- "$1"
}

sudo_stat_meta() {
  sudo_cmd stat -c '%u:%g:%a:%s' -- "$1"
}

assert_owner_mode() {
  local path="$1" expected_uid="$2" expected_gid="$3" expected_mode="$4"
  [[ -e "$path" && ! -L "$path" ]] || return 1
  [[ "$(stat_meta "$path")" == "$expected_uid:$expected_gid:$expected_mode:"* ]]
}

assert_sudo_owner_mode() {
  local path="$1" expected_uid="$2" expected_gid="$3" expected_mode="$4"
  sudo_cmd test -e "$path" || return 1
  sudo_cmd test ! -L "$path" || return 1
  [[ "$(sudo_stat_meta "$path")" == "$expected_uid:$expected_gid:$expected_mode:"* ]]
}

assert_identity() {
  [[ "$(uname -s)" == "Linux" ]] || die "this workflow supports Linux only"
  [[ "$(id -un)" == "$EXPECTED_USER" ]] ||
    die "run as $EXPECTED_USER, not $(id -un)"
  if (( ! FIXTURE_MODE )); then
    [[ "${HOME:-}" == "$EXPECTED_HOME" ]] ||
      die "HOME must be $EXPECTED_HOME"
  fi
  [[ "$REPO_ROOT" == "$EXPECTED_REPO" ]] ||
    die "repository path must be $EXPECTED_REPO"
  [[ "$(git -C "$REPO_ROOT" branch --show-current)" == "$EXPECTED_BRANCH" ]] ||
    die "checkout must be on $EXPECTED_BRANCH"
}

assert_runtime_boundary() {
  [[ -d "$RUNTIME_PARENT" && ! -L "$RUNTIME_PARENT" ]] ||
    die "runtime parent is missing or a symlink: $RUNTIME_PARENT"
  assert_owner_mode "$RUNTIME_PARENT" "$USER_UID" "$USER_GID" "700" ||
    die "runtime parent ownership/mode is not private: $RUNTIME_PARENT"

  if [[ -e "$RUNTIME_DIR" || -L "$RUNTIME_DIR" ]]; then
    [[ -d "$RUNTIME_DIR" && ! -L "$RUNTIME_DIR" ]] ||
      die "runtime target is not a real directory: $RUNTIME_DIR"
    assert_owner_mode "$RUNTIME_DIR" "$USER_UID" "$USER_GID" "700" ||
      die "runtime target ownership/mode is not private: $RUNTIME_DIR"
    local links foreign
    links="$(find "$RUNTIME_DIR" -xdev -type l -print -quit)"
    [[ -z "$links" ]] || die "runtime target contains a symlink"
    foreign="$(find "$RUNTIME_DIR" -xdev \( ! -uid "$USER_UID" -o ! -gid "$USER_GID" \) -print -quit)"
    [[ -z "$foreign" ]] || die "runtime target contains a non-user-owned entry"
  fi
}

resolve_env_source() {
  [[ -n "$ENV_INPUT" ]] || die "--env-file is required"
  [[ ! -L "$ENV_INPUT" ]] || die "dotenv source must not be a symlink"
  ENV_SOURCE="$(realpath -e -- "$ENV_INPUT")" ||
    die "dotenv source does not exist: $ENV_INPUT"
  [[ -f "$ENV_SOURCE" && ! -L "$ENV_SOURCE" ]] ||
    die "dotenv source must be a regular file"
  case "$ENV_SOURCE" in
    "$RUNTIME_DIR"|"$RUNTIME_DIR"/*)
      die "dotenv source must be outside the purge target"
      ;;
  esac
  [[ "$ENV_SOURCE" != "$LOCK_PATH" ]] ||
    die "dotenv source must not be the workflow lock"

  local metadata mode_bits
  metadata="$(stat_meta "$ENV_SOURCE")" || die "cannot stat dotenv source"
  IFS=: read -r SOURCE_UID SOURCE_GID SOURCE_MODE SOURCE_BYTES <<< "$metadata"
  [[ "$SOURCE_UID" == "$USER_UID" ]] || die "dotenv source is not user-owned"
  [[ "$SOURCE_MODE" =~ ^[0-7]+$ ]] || die "dotenv source mode is invalid"
  mode_bits=$((8#$SOURCE_MODE))
  (( (mode_bits & 077) == 0 )) ||
    die "dotenv source is group/world accessible"
  [[ -r "$ENV_SOURCE" ]] || die "dotenv source is not readable"
  SOURCE_HASH="$(sha256sum -- "$ENV_SOURCE" | awk '{print $1}')" ||
    die "cannot hash dotenv source"
  SOURCE_IDENTITY="$(stat -c '%d:%i' -- "$ENV_SOURCE")" ||
    die "cannot identify dotenv source"
}

validate_unit_contract() {
  [[ -f "$UNIT_SOURCE" && ! -L "$UNIT_SOURCE" ]] ||
    die "repository systemd unit is missing or a symlink"
  local expected_first="EnvironmentFile=$UNIT_ENV_RUNTIME_DIR/server.env"
  local expected_second="EnvironmentFile=$UNIT_ENV_RUNTIME_DIR/server-safety.env"
  mapfile -t environment_files < <(awk '/^EnvironmentFile=/{print}' "$UNIT_SOURCE")
  [[ "${#environment_files[@]}" -eq 2 ]] ||
    die "systemd unit must contain exactly two mandatory EnvironmentFile entries"
  [[ "${environment_files[0]}" == "$expected_first" ]] ||
    die "systemd unit must load server.env first"
  [[ "${environment_files[1]}" == "$expected_second" ]] ||
    die "systemd unit must load server-safety.env second"
  [[ "${environment_files[0]}" != EnvironmentFile=-* &&
    "${environment_files[1]}" != EnvironmentFile=-* ]] ||
    die "systemd environment files must be mandatory"
}

acquire_workflow_lock() {
  (( DRY_RUN )) && return 0
  [[ ! -L "$LOCK_PATH" ]] || die "workflow lock path is a symlink"
  exec {LOCK_FD}>>"$LOCK_PATH" || die "could not open workflow lock"
  local lock_canonical lock_identity
  lock_canonical="$(realpath -e -- "$LOCK_PATH")" || die "workflow lock path is unavailable"
  [[ "$lock_canonical" == "$LOCK_PATH" ]] ||
    die "workflow lock path is not canonical"
  lock_identity="$(stat -c '%d:%i' -- "$LOCK_PATH")" ||
    die "could not identify workflow lock"
  [[ "$lock_identity" != "$SOURCE_IDENTITY" ]] ||
    die "dotenv source collides with workflow lock"
  chmod 600 -- "$LOCK_PATH" || die "could not secure workflow lock"
  assert_owner_mode "$LOCK_PATH" "$USER_UID" "$USER_GID" "600" ||
    die "workflow lock ownership/mode is ambiguous"
  flock -n "$LOCK_FD" || die "another Linux production workflow is already running"
}

snapshot_env_source() {
  local snapshot_hash
  SOURCE_SNAPSHOT="$(mktemp /tmp/dam-hopper-reset-env.XXXXXX)" ||
    die "could not create dotenv snapshot"
  TEMP_FILES+=("$SOURCE_SNAPSHOT")
  chmod 600 -- "$SOURCE_SNAPSHOT" || die "could not secure dotenv snapshot"
  cp -- "$ENV_SOURCE" "$SOURCE_SNAPSHOT" || die "could not snapshot dotenv source"
  snapshot_hash="$(sha256sum -- "$ENV_SOURCE" | awk '{print $1}')" ||
    die "could not rehash dotenv source"
  [[ "$snapshot_hash" == "$SOURCE_HASH" ]] ||
    die "dotenv source changed before purge"
  cmp -s -- "$ENV_SOURCE" "$SOURCE_SNAPSHOT" ||
    die "dotenv source changed during snapshot"
  assert_owner_mode "$SOURCE_SNAPSHOT" "$USER_UID" "$USER_GID" "600" ||
    die "dotenv snapshot ownership/mode is invalid"
}

print_preflight() {
  local runtime_state="absent" runtime_meta="-"
  if [[ -e "$RUNTIME_DIR" ]]; then
    runtime_state="present"
    runtime_meta="$(stat_meta "$RUNTIME_DIR")"
  fi
  printf '%s\n' "Read-only Linux production reset preflight"
  printf 'repository=%s branch=%s user=%s\n' "$REPO_ROOT" "$EXPECTED_BRANCH" "$EXPECTED_USER"
  printf 'dotenv-source=%s owner=%s:%s mode=%s bytes=%s\n' \
    "$ENV_SOURCE" "$SOURCE_UID" "$SOURCE_GID" "$SOURCE_MODE" "$SOURCE_BYTES"
  printf 'purge-target=%s state=%s metadata=%s\n' "$RUNTIME_DIR" "$runtime_state" "$runtime_meta"
  printf '%s\n' "excluded=/opt/dam-hopper /etc/systemd/system repositories project .dam-hopper external MongoDB"
  if (( FIXTURE_MODE )); then
    printf '%s\n' "mode=fixture-only"
  else
    printf '%s\n' "mode=production; sudo/systemd state checks are deferred until confirmation"
  fi
}

authenticate_sudo() {
  (( FIXTURE_MODE )) && return 0
  if ! sudo -v; then
    die "authenticated interactive sudo is required; authenticate sudo and rerun; no cleanup was performed"
  fi
}

manifest_value() {
  local key="$1" value count
  count=0
  value=""
  while IFS= read -r line; do
    if [[ "$line" == "$key="* ]]; then
      value="${line#*=}"
      count=$((count + 1))
    fi
  done < <(sudo_cmd cat "$MANIFEST")
  [[ "$count" -eq 1 ]] || return 1
  printf '%s' "$value"
}

verify_web_manifest_paths() {
  local contents line relative entries=0 manifest_paths_file actual_paths_file
  local sorted_manifest_paths sorted_actual_paths
  contents="$(sudo_cmd cat "$WEB_MANIFEST")" || return 1
  manifest_paths_file="$(mktemp)" || return 1
  TEMP_FILES+=("$manifest_paths_file")
  : > "$manifest_paths_file"
  if [[ -n "$contents" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" =~ ^[a-f0-9]{64}[[:space:]]+([^[:space:]]+)$ ]] || return 1
      relative="${BASH_REMATCH[1]}"
      [[ "$relative" == ./* && "$relative" != *"/../"* &&
        "$relative" != ../* && "$relative" != /* ]] || return 1
      printf '%s\n' "$relative" >> "$manifest_paths_file"
      entries=$((entries + 1))
    done <<< "$contents"
  fi
  actual_paths_file="$(mktemp)" || return 1
  TEMP_FILES+=("$actual_paths_file")
  (cd -- "$WEB_DIR" && sudo_cmd find . -type f -printf './%P\n') > "$actual_paths_file" || return 1
  sorted_manifest_paths="$(LC_ALL=C sort -- "$manifest_paths_file")" || return 1
  sorted_actual_paths="$(LC_ALL=C sort -- "$actual_paths_file")" || return 1
  [[ "$sorted_manifest_paths" == "$sorted_actual_paths" ]] || return 1
  WEB_MANIFEST_ENTRIES="$entries"
}

verify_root_marker() {
  assert_sudo_owner_mode "$INSTALL_ROOT" "$ROOT_UID" "$ROOT_GID" "755" || return 1
  sudo_cmd test -d "$INSTALL_ROOT" || return 1
  assert_sudo_owner_mode "$MARKER_DIR" "$ROOT_UID" "$ROOT_GID" "700" || return 1
  sudo_cmd test -d "$MARKER_DIR" || return 1
  assert_sudo_owner_mode "$MANIFEST" "$ROOT_UID" "$ROOT_GID" "600" || return 1
  assert_sudo_owner_mode "$NONCE_FILE" "$ROOT_UID" "$ROOT_GID" "600" || return 1
  assert_sudo_owner_mode "$WEB_MANIFEST" "$ROOT_UID" "$ROOT_GID" "600" || return 1
  assert_sudo_owner_mode "$BIN_DIR" "$ROOT_UID" "$ROOT_GID" "755" || return 1
  assert_sudo_owner_mode "$WEB_DIR" "$ROOT_UID" "$ROOT_GID" "755" || return 1
  assert_sudo_owner_mode "$BINARY_PATH" "$ROOT_UID" "$ROOT_GID" "755" || return 1
  assert_sudo_owner_mode "$UNIT_PATH" "$ROOT_UID" "$ROOT_GID" "644" || return 1

  local expected_root actual_root expected_marker actual_marker
  expected_root="$(printf '%s\n' .systemd-fresh-install bin web | LC_ALL=C sort)"
  actual_root="$(sudo_cmd find "$INSTALL_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" || return 1
  [[ "$actual_root" == "$expected_root" ]] || return 1
  expected_marker="$(printf '%s\n' manifest nonce web.sha256 | LC_ALL=C sort)"
  actual_marker="$(sudo_cmd find "$MARKER_DIR" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" || return 1
  [[ "$actual_marker" == "$expected_marker" ]] || return 1
  [[ "$(sudo_cmd find "$BIN_DIR" -mindepth 1 -maxdepth 1 -printf '%f\n')" == "dam-hopper-server" ]] || return 1

  local keys expected_keys format nonce actual_nonce binary_hash unit_hash
  local web_file_count web_dir_count actual_web_files actual_web_dirs actual_hash
  local manifest_lines malformed_manifest_lines
  manifest_lines="$(sudo_cmd awk 'NF { count++ } END { print count + 0 }' "$MANIFEST")" || return 1
  [[ "$manifest_lines" == "6" ]] || return 1
  malformed_manifest_lines="$(sudo_cmd awk 'NF && $0 !~ /^[A-Za-z0-9_]+=[^[:space:]]+$/ { print "invalid"; exit }' "$MANIFEST")" || return 1
  [[ -z "$malformed_manifest_lines" ]] || return 1
  keys="$(sudo_cmd awk -F= '/^[A-Za-z0-9_]+=/{print $1}' "$MANIFEST" | LC_ALL=C sort)" || return 1
  expected_keys="$(printf '%s\n' binary_sha256 format nonce unit_sha256 web_dir_count web_file_count | LC_ALL=C sort)"
  [[ "$keys" == "$expected_keys" ]] || return 1
  format="$(manifest_value format)" || return 1
  [[ "$format" == "1" ]] || return 1
  nonce="$(manifest_value nonce)" || return 1
  [[ "$nonce" =~ ^[a-f0-9]{32}$ ]] || return 1
  actual_nonce="$(sudo_cmd cat "$NONCE_FILE")" || return 1
  [[ "$actual_nonce" == "$nonce" ]] || return 1
  binary_hash="$(manifest_value binary_sha256)" || return 1
  unit_hash="$(manifest_value unit_sha256)" || return 1
  [[ "$binary_hash" =~ ^[a-f0-9]{64}$ && "$unit_hash" =~ ^[a-f0-9]{64}$ ]] || return 1
  actual_hash="$(sudo_cmd sha256sum -- "$BINARY_PATH" | awk '{print $1}')" || return 1
  [[ "$actual_hash" == "$binary_hash" ]] || return 1
  actual_hash="$(sudo_cmd sha256sum -- "$UNIT_PATH" | awk '{print $1}')" || return 1
  [[ "$actual_hash" == "$unit_hash" ]] || return 1

  web_file_count="$(manifest_value web_file_count)" || return 1
  web_dir_count="$(manifest_value web_dir_count)" || return 1
  [[ "$web_file_count" =~ ^[0-9]+$ && "$web_dir_count" =~ ^[0-9]+$ ]] || return 1
  actual_web_files="$(sudo_cmd find "$WEB_DIR" -type f | wc -l)" || return 1
  actual_web_dirs="$(sudo_cmd find "$WEB_DIR" -type d | wc -l)" || return 1
  [[ "$actual_web_files" -eq "$web_file_count" && "$actual_web_dirs" -eq "$web_dir_count" ]] || return 1
  [[ -z "$(sudo_cmd find "$WEB_DIR" -mindepth 1 ! -type f ! -type d -print -quit)" ]] || return 1
  [[ -z "$(sudo_cmd find "$INSTALL_ROOT" -type l -print -quit)" ]] || return 1
  [[ -z "$(sudo_cmd find "$WEB_DIR" -type d ! -uid "$ROOT_UID" -print -quit)" ]] || return 1
  [[ -z "$(sudo_cmd find "$WEB_DIR" -type d ! -gid "$ROOT_GID" -print -quit)" ]] || return 1
  [[ -z "$(sudo_cmd find "$WEB_DIR" -type d ! -perm 0755 -print -quit)" ]] || return 1
  [[ -z "$(sudo_cmd find "$WEB_DIR" -type f ! -uid "$ROOT_UID" -print -quit)" ]] || return 1
  [[ -z "$(sudo_cmd find "$WEB_DIR" -type f ! -gid "$ROOT_GID" -print -quit)" ]] || return 1
  [[ -z "$(sudo_cmd find "$WEB_DIR" -type f ! -perm 0644 -print -quit)" ]] || return 1
  verify_web_manifest_paths || return 1
  [[ "$WEB_MANIFEST_ENTRIES" -eq "$web_file_count" ]] || return 1
  (cd "$WEB_DIR" && sudo_cmd sha256sum --check "$WEB_MANIFEST" >/dev/null) || return 1
}

read_systemd_state() {
  local allow_masked="${1:-0}" properties key value
  properties="$(sudo_cmd systemctl show --no-pager --property=LoadState,ActiveState,SubState,MainPID "$UNIT_NAME" 2>/dev/null)" || return 1
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
  if [[ "$SYSTEMD_LOAD_STATE" != "loaded" ]]; then
    [[ "$allow_masked" == 1 && "$SYSTEMD_LOAD_STATE" == "masked" ]] || return 1
  fi
  [[ "$SYSTEMD_MAIN_PID" =~ ^[0-9]+$ ]]
}

read_systemd_enabled_state() {
  local allow_masked="${1:-0}" status=0
  SYSTEMD_ENABLED_STATE="$(sudo_cmd systemctl is-enabled "$UNIT_NAME" 2>/dev/null)" || status=$?
  (( status == 0 || status == 1 || (allow_masked == 1 && status == 4) )) || return 1
  [[ "$SYSTEMD_ENABLED_STATE" == "enabled" || "$SYSTEMD_ENABLED_STATE" == "disabled" ]] && return 0
  [[ "$allow_masked" == 1 && "$SYSTEMD_ENABLED_STATE" == "masked" ]]
}

listener_present() {
  local port="$1" listeners
  listeners="$(sudo_cmd ss -Hln "sport = :$port" 2>/dev/null)" || return 2
  [[ -z "$listeners" ]]
}

database_holders_present() {
  local runtime_dir="${1:-$RUNTIME_DIR}"
  [[ -d "$runtime_dir" ]] || return 1
  local database_paths database_path status
  database_paths="$(sudo_cmd find "$runtime_dir" -xdev -type f \( -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' \) -print)" || return 2
  while IFS= read -r database_path; do
    [[ -n "$database_path" ]] || continue
    status=0
    sudo_cmd fuser -s "$database_path" >/dev/null 2>&1 || status=$?
    case "$status" in
      0) return 0 ;;
      1) ;;
      *) return 2 ;;
    esac
  done <<< "$database_paths"
  return 1
}

assert_no_exact_processes() {
  local processes status=0
  processes="$(sudo_cmd pgrep -x dam-hopper-server 2>/dev/null)" || status=$?
  (( status == 0 || status == 1 )) || return 1
  [[ -z "$processes" ]]
}

read_proc_start_ticks() {
  awk '{print $22}' "/proc/$1/stat"
}

pid_identity_is_valid() {
  local pid="$1" actual_uid proc_exe expected_exe cmdline first_arg recorded_start proc_start
  kill -0 "$pid" 2>/dev/null || return 1
  [[ -f "$NOHUP_BIN" && ! -L "$NOHUP_BIN" ]] || return 2
  actual_uid="$(stat -c '%u' -- "/proc/$pid")" || return 2
  [[ "$actual_uid" == "$USER_UID" ]] || return 2
  proc_exe="$(readlink -f -- "/proc/$pid/exe")" || return 2
  expected_exe="$(readlink -f -- "$NOHUP_BIN")" || return 2
  [[ "$proc_exe" == "$expected_exe" ]] || return 2
  cmdline="$(tr '\0' '\n' < "/proc/$pid/cmdline")" || return 2
  first_arg="${cmdline%%$'\n'*}"
  [[ "$first_arg" == "$NOHUP_BIN" ]] || return 2
  [[ -f "$PID_START_FILE" && ! -L "$PID_START_FILE" ]] || return 2
  assert_owner_mode "$PID_START_FILE" "$USER_UID" "$USER_GID" "600" || return 2
  recorded_start="$(<"$PID_START_FILE")"
  proc_start="$(read_proc_start_ticks "$pid")" || return 2
  [[ "$recorded_start" =~ ^[0-9]+$ && "$proc_start" =~ ^[0-9]+$ ]] || return 2
  [[ "$recorded_start" == "$proc_start" ]]
}

identify_nohup_pid() {
  NOHUP_PID=""
  if [[ ! -e "$PID_FILE" && ! -L "$PID_FILE" ]]; then
    return 0
  fi
  [[ -f "$PID_FILE" && ! -L "$PID_FILE" ]] || die "legacy PID file is not a regular file"
  assert_owner_mode "$PID_FILE" "$USER_UID" "$USER_GID" "600" ||
    die "legacy PID file ownership/mode is ambiguous"
  local pid="$(<"$PID_FILE")"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || die "legacy PID file is not a single numeric PID"
  if ! kill -0 "$pid" 2>/dev/null; then
    printf '%s\n' "legacy PID file is stale; it will be removed inside the exact purge target"
    return 0
  fi
  pid_identity_is_valid "$pid" ||
    die "legacy PID identity is ambiguous; no process was signaled"
  NOHUP_PID="$pid"
}

stop_nohup_pid() {
  [[ -n "$NOHUP_PID" ]] || return 0
  if ! kill -0 "$NOHUP_PID" 2>/dev/null; then
    return 0
  fi
  pid_identity_is_valid "$NOHUP_PID" ||
    die "legacy PID identity changed before stop; no process was signaled"
  kill -TERM "$NOHUP_PID" || die "could not stop the identified legacy process"
  local attempt
  for attempt in $(seq 1 50); do
    kill -0 "$NOHUP_PID" 2>/dev/null || return 0
    sleep 0.2
  done
  pid_identity_is_valid "$NOHUP_PID" ||
    die "legacy PID identity changed during graceful stop"
  kill -KILL "$NOHUP_PID" || die "could not terminate the identified legacy process"
  for attempt in $(seq 1 25); do
    kill -0 "$NOHUP_PID" 2>/dev/null || return 0
    sleep 0.2
  done
  die "identified legacy process did not stop"
}

stop_and_disable_systemd() {
  read_systemd_state || die "systemd unit state is unavailable or ambiguous"
  read_systemd_enabled_state || die "systemd enablement state is unavailable or ambiguous"
  case "$SYSTEMD_ACTIVE_STATE" in
    active|activating|deactivating|reloading)
      sudo_cmd systemctl stop "$UNIT_NAME" || die "systemd stop failed"
      ;;
    inactive|failed) ;;
    *) die "unexpected systemd active state: $SYSTEMD_ACTIVE_STATE" ;;
  esac
  if [[ "$SYSTEMD_ENABLED_STATE" == "enabled" ]]; then
    sudo_cmd systemctl disable "$UNIT_NAME" || die "systemd disable failed"
  fi
  sudo_cmd systemctl mask --runtime "$UNIT_NAME" || die "systemd runtime mask failed"
  SYSTEMD_RUNTIME_MASKED=1
}

assert_stopped_and_unowned() {
  local runtime_dir="${1:-$RUNTIME_DIR}"
  read_systemd_state 1 || die "post-stop systemd state is unavailable or ambiguous"
  [[ "$SYSTEMD_ACTIVE_STATE" == "inactive" || "$SYSTEMD_ACTIVE_STATE" == "failed" ]] ||
    die "systemd unit is still active"
  [[ "$SYSTEMD_MAIN_PID" == "0" ]] || die "systemd MainPID is not zero"
  read_systemd_enabled_state 1 || die "post-stop systemd enablement is unavailable or ambiguous"
  [[ "$SYSTEMD_ENABLED_STATE" == "masked" ]] || die "systemd unit is not masked during purge"
  assert_no_exact_processes || die "an exact DamHopper process still exists"
  listener_present 4800 || die "port 4800 is still occupied or cannot be inspected"
  listener_present 4801 || die "port 4801 is still occupied or cannot be inspected"
  local holder_status=0
  database_holders_present "$runtime_dir" || holder_status=$?
  case "$holder_status" in
    0) die "a SQLite database is still held by a process" ;;
    1) ;;
    *) die "SQLite holder inspection was ambiguous" ;;
  esac
}

confirm_purge() {
  if (( ! FIXTURE_MODE )) && { [[ ! -t 0 ]] || [[ ! -t 1 ]]; }; then
    die "interactive terminal confirmation is required"
  fi
  local expected="PURGE $RUNTIME_DIR" confirmation
  printf 'This removes exactly %s and recreates it. Type %s to continue: ' \
    "$RUNTIME_DIR" "$expected" >&2
  IFS= read -r confirmation || die "confirmation was not supplied"
  [[ "$confirmation" == "$expected" ]] || die "typed confirmation did not match; nothing was purged"
}

write_atomic_env_files() {
  local runtime_dir="$1"
  local server_env="$runtime_dir/server.env"
  local safety_env="$runtime_dir/server-safety.env"
  local tmp source_file="$SOURCE_SNAPSHOT"
  [[ -f "$source_file" && ! -L "$source_file" ]] ||
    die "dotenv snapshot is unavailable"

  tmp="$(mktemp "$runtime_dir/.server.env.XXXXXX")"
  TEMP_FILES+=("$tmp")
  cp -- "$source_file" "$tmp" || die "could not copy dotenv snapshot"
  chmod 600 -- "$tmp" || die "could not set server.env mode"
  cmp -s -- "$source_file" "$tmp" || die "dotenv copy verification failed"
  mv -T -- "$tmp" "$server_env" || die "could not install server.env atomically"

  tmp="$(mktemp "$runtime_dir/.server-safety.env.XXXXXX")"
  TEMP_FILES+=("$tmp")
  printf '%s\n' \
    'RUST_ENV=production' \
    'ENVIRONMENT=production' \
    'DAM_HOPPER_NO_AUTH=false' \
    'HOME=/home/loidinh' \
    'XDG_CONFIG_HOME=/home/loidinh/.config' \
    'DAM_HOPPER_WEB_DIR=/opt/dam-hopper/web' > "$tmp"
  chmod 600 -- "$tmp" || die "could not set server-safety.env mode"
  mv -T -- "$tmp" "$safety_env" || die "could not install server-safety.env atomically"
}

validate_runtime_env_files() {
  local runtime_dir="$1"
  local server_env="$runtime_dir/server.env"
  local safety_env="$runtime_dir/server-safety.env"
  assert_owner_mode "$server_env" "$USER_UID" "$USER_GID" "600" ||
    die "server.env ownership/mode is invalid"
  assert_owner_mode "$safety_env" "$USER_UID" "$USER_GID" "600" ||
    die "server-safety.env ownership/mode is invalid"
  cmp -s -- "$SOURCE_SNAPSHOT" "$server_env" || die "server.env is not a wholesale copy"
  local expected actual
  expected="$(printf '%s\n' \
    'RUST_ENV=production' \
    'ENVIRONMENT=production' \
    'DAM_HOPPER_NO_AUTH=false' \
    'HOME=/home/loidinh' \
    'XDG_CONFIG_HOME=/home/loidinh/.config' \
    'DAM_HOPPER_WEB_DIR=/opt/dam-hopper/web')"
  actual="$(<"$safety_env")"
  [[ "$actual" == "$expected" ]] || die "server-safety.env assignments are invalid"
}

validate_systemd_env_parsing() {
  (( FIXTURE_MODE )) && return 0
  local log_file
  log_file="$(mktemp)"
  if ! systemd-analyze verify "$UNIT_SOURCE" >"$log_file" 2>&1; then
    rm -f -- "$log_file"
    die "systemd rejected the unit or generated environment files; no values were displayed"
  fi
  rm -f -- "$log_file"
}

purge_and_recreate_runtime() {
  local runtime_name="${RUNTIME_DIR##*/}"
  local relative_runtime_dir="./$runtime_name"
  local canonical_parent expected_parent_identity parent_fd parent_fd_path
  local opened_parent_identity expected_runtime_path created_runtime_identity
  local existing_runtime_identity current_parent_identity
  local created_runtime_path runtime_fd runtime_fd_path opened_runtime_identity
  [[ "$runtime_name" == "dam-hopper" ]] ||
    die "runtime target basename is unexpected"
  canonical_parent="$(realpath -e -- "$RUNTIME_PARENT")" ||
    die "runtime parent changed before purge"
  [[ "$canonical_parent" == "$RUNTIME_PARENT" ]] ||
    die "runtime parent is not canonical"
  expected_parent_identity="$(stat -c '%d:%i' -- "$canonical_parent")" ||
    die "could not identify runtime parent"
  exec {parent_fd}<"$RUNTIME_PARENT" || die "could not open runtime parent"
  parent_fd_path="/proc/self/fd/$parent_fd"
  opened_parent_identity="$(stat -Lc '%d:%i' -- "$parent_fd_path")" ||
    die "could not identify opened runtime parent"
  [[ "$opened_parent_identity" == "$expected_parent_identity" ]] ||
    die "runtime parent changed before purge"
  [[ "$(stat -Lc '%u:%g:%a' -- "$parent_fd_path")" == "$USER_UID:$USER_GID:700" ]] ||
    die "opened runtime parent ownership/mode is not private"
  cd -P -- "$parent_fd_path" || die "could not anchor runtime parent"
  [[ "$(stat -c '%d:%i' -- .)" == "$expected_parent_identity" ]] ||
    die "runtime parent anchor changed before purge"

  if [[ -e "$relative_runtime_dir" || -L "$relative_runtime_dir" ]]; then
    [[ -d "$relative_runtime_dir" && ! -L "$relative_runtime_dir" ]] ||
      die "runtime target changed before purge"
    assert_owner_mode "$relative_runtime_dir" "$USER_UID" "$USER_GID" "700" ||
      die "runtime target changed ownership/mode before purge"
    existing_runtime_identity="$(stat -c '%d:%i' -- "$relative_runtime_dir")" ||
      die "could not identify existing runtime directory"
  else
    existing_runtime_identity=""
  fi
  current_parent_identity="$(stat -c '%d:%i' -- "$RUNTIME_PARENT")" ||
    die "runtime parent changed before final state gate"
  [[ "$current_parent_identity" == "$expected_parent_identity" ]] ||
    die "runtime parent changed before final state gate"
  assert_stopped_and_unowned "$relative_runtime_dir"
  current_parent_identity="$(stat -c '%d:%i' -- "$RUNTIME_PARENT")" ||
    die "runtime parent changed during final state gate"
  [[ "$current_parent_identity" == "$expected_parent_identity" ]] ||
    die "runtime parent changed during final state gate"
  if [[ -n "$existing_runtime_identity" ]]; then
    [[ -d "$relative_runtime_dir" && ! -L "$relative_runtime_dir" ]] ||
      die "runtime target changed during final state gate"
    assert_owner_mode "$relative_runtime_dir" "$USER_UID" "$USER_GID" "700" ||
      die "runtime target ownership/mode changed during final state gate"
    [[ "$(stat -c '%d:%i' -- "$relative_runtime_dir")" == "$existing_runtime_identity" ]] ||
      die "runtime target changed during final state gate"
    rm -rf --one-file-system -- "$relative_runtime_dir" || die "runtime purge failed"
  fi
  [[ ! -e "$relative_runtime_dir" && ! -L "$relative_runtime_dir" ]] ||
    die "runtime target was not removed"
  mkdir -m 700 -- "$relative_runtime_dir" || die "runtime directory recreation failed"
  assert_owner_mode "$relative_runtime_dir" "$USER_UID" "$USER_GID" "700" ||
    die "recreated runtime directory ownership/mode is invalid"
  expected_runtime_path="$canonical_parent/$runtime_name"
  created_runtime_identity="$(stat -c '%d:%i' -- "$relative_runtime_dir")" ||
    die "could not identify recreated runtime directory"
  created_runtime_path="$(realpath -e -- "$relative_runtime_dir")" ||
    die "recreated runtime directory is not canonical"
  [[ "$created_runtime_path" == "$expected_runtime_path" ]] ||
    die "recreated runtime directory escaped the anchored parent"
  exec {runtime_fd}<"$relative_runtime_dir" ||
    die "could not open recreated runtime directory"
  runtime_fd_path="/proc/self/fd/$runtime_fd"
  opened_runtime_identity="$(stat -Lc '%d:%i' -- "$runtime_fd_path")" ||
    die "could not identify opened runtime directory"
  [[ "$opened_runtime_identity" == "$created_runtime_identity" ]] ||
    die "recreated runtime directory changed before env write"
  cd -P -- "$runtime_fd_path" || die "could not anchor recreated runtime directory"
  [[ "$(stat -c '%d:%i' -- .)" == "$created_runtime_identity" ]] ||
    die "recreated runtime directory anchor changed"
  write_atomic_env_files "."
  validate_runtime_env_files "."
  validate_systemd_env_parsing
  exec {runtime_fd}<&-
  exec {parent_fd}<&-
}

main() {
  require_commands
  assert_identity
  assert_runtime_boundary
  resolve_env_source
  validate_unit_contract
  print_preflight
  if (( DRY_RUN )); then
    printf '%s\n' "Dry run complete; no sudo, systemd, confirmation, or filesystem mutation was performed."
    return 0
  fi

  confirm_purge
  authenticate_sudo
  acquire_workflow_lock
  snapshot_env_source
  verify_root_marker || die "root marker/manifest verification failed; retain /opt assets and marker"
  identify_nohup_pid
  stop_and_disable_systemd
  stop_nohup_pid
  assert_stopped_and_unowned
  verify_root_marker || die "root marker changed after stop; retain all installed assets"
  purge_and_recreate_runtime
  RESET_SUCCEEDED=1
  printf '%s\n' "Linux production runtime reset complete. Environment contents were not displayed."
}

main "$@"
