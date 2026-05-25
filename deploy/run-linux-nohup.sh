#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${DAM_HOPPER_HOME:-$HOME/.config/dam-hopper}"
BIN_DIR="$APP_DIR/bin"
BIN_PATH="$BIN_DIR/dam-hopper-server"
CONFIG_FILE="$APP_DIR/server.conf"
PID_FILE="$APP_DIR/server.pid"
LOG_FILE="$APP_DIR/output.log"
BIN_SOURCE="${DAM_HOPPER_BIN:-}"

usage() {
  cat <<'USAGE'
Install and run DamHopper with nohup.

Usage:
  deploy/run-linux-nohup.sh <command> [options]

Commands:
  install       Copy dam-hopper-server to ~/.config/dam-hopper/bin/
  start         Start server with nohup
  stop          Stop server using ~/.config/dam-hopper/server.pid
  restart       install, stop, then start
  status        Show pid/log/config status

Options:
  --bin PATH    Source dam-hopper-server binary for install/restart

Config:
  ~/.config/dam-hopper/server.conf

Example:
  pnpm build:server
  deploy/run-linux-nohup.sh restart --bin server/target/release/dam-hopper-server
USAGE
}

COMMAND="${1:-}"
if [[ -z "$COMMAND" || "$COMMAND" == "-h" || "$COMMAND" == "--help" ]]; then
  usage
  exit 0
fi
shift || true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bin)
      BIN_SOURCE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

ensure_dirs() {
  install -d "$BIN_DIR"
}

write_default_config() {
  if [[ -f "$CONFIG_FILE" ]]; then
    return
  fi

  cat > "$CONFIG_FILE" <<'CONF'
# Optional. Omit to use defaults.workspace from ~/.config/dam-hopper/config.toml.
# DAM_HOPPER_WORKSPACE="/path/to/workspace"
DAM_HOPPER_HOST="127.0.0.1"
DAM_HOPPER_PORT="4800"
RUST_LOG="info"

# Optional MongoDB auth.
# MONGODB_URI="mongodb://localhost:27017"
# MONGODB_DATABASE="dam_hopper"
CONF
  chmod 0600 "$CONFIG_FILE"
}

resolve_source() {
  if [[ -n "$BIN_SOURCE" ]]; then
    return
  fi
  if [[ -x "server/target/release/dam-hopper-server" ]]; then
    BIN_SOURCE="server/target/release/dam-hopper-server"
  elif [[ -x "target/release/dam-hopper-server" ]]; then
    BIN_SOURCE="target/release/dam-hopper-server"
  else
    echo "Could not find dam-hopper-server. Run pnpm build:server or pass --bin PATH." >&2
    exit 1
  fi
}

install_binary() {
  ensure_dirs
  write_default_config
  resolve_source
  if [[ ! -x "$BIN_SOURCE" ]]; then
    echo "Binary is not executable: $BIN_SOURCE" >&2
    exit 1
  fi
  install -m 0755 "$BIN_SOURCE" "$BIN_PATH"
  echo "Installed: $BIN_PATH"
}

load_config() {
  write_default_config
  set -a
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  set +a
  : "${DAM_HOPPER_HOST:=127.0.0.1}"
  : "${DAM_HOPPER_PORT:=4800}"
}

running_pid() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

start_server() {
  ensure_dirs
  load_config
  if running_pid; then
    echo "DamHopper already running: pid $(cat "$PID_FILE")"
    return
  fi
  if [[ ! -x "$BIN_PATH" ]]; then
    echo "Installed binary not found: $BIN_PATH" >&2
    echo "Run: deploy/run-linux-nohup.sh install --bin server/target/release/dam-hopper-server" >&2
    exit 1
  fi

  local args=(--host "$DAM_HOPPER_HOST" --port "$DAM_HOPPER_PORT")
  if [[ -n "${DAM_HOPPER_WORKSPACE:-}" ]]; then
    args+=(--workspace "$DAM_HOPPER_WORKSPACE")
  fi

  nohup "$BIN_PATH" "${args[@]}" >> "$LOG_FILE" 2>&1 &
  echo "$!" > "$PID_FILE"
  echo "Started DamHopper: pid $(cat "$PID_FILE")"
  echo "Log: $LOG_FILE"
}

stop_server() {
  if ! running_pid; then
    echo "DamHopper is not running"
    rm -f "$PID_FILE"
    return
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid"
  for _ in $(seq 1 30); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "Stopped DamHopper"
      return
    fi
    sleep 0.2
  done
  echo "DamHopper did not stop gracefully; killing pid $pid"
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
}

status_server() {
  if running_pid; then
    echo "DamHopper running: pid $(cat "$PID_FILE")"
  else
    echo "DamHopper not running"
  fi
  echo "Binary: $BIN_PATH"
  echo "Config: $CONFIG_FILE"
  echo "Log: $LOG_FILE"
}

case "$COMMAND" in
  install)
    install_binary
    ;;
  start)
    start_server
    ;;
  stop)
    stop_server
    ;;
  restart)
    install_binary
    stop_server
    start_server
    ;;
  status)
    status_server
    ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    usage >&2
    exit 2
    ;;
esac
