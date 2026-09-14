#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"

UAT_DIR="/tmp/dam-hopper-uat"
API_PORT="4803"
WEB_PORT="4804"
API_HOST="0.0.0.0"
WEB_HOST="0.0.0.0"
NO_AUTH=0
CUSTOM_CONFIG=""
ENV_FILE=""
PUBLIC_HOST="${DAM_HOPPER_PUBLIC_HOST:-}"
USER_CORS="${DAM_HOPPER_CORS_ORIGINS:-}"

usage() {
    cat <<EOF
DamHopper UAT Environment Runner

Usage: $0 <command> [options]

Commands:
  start       Start UAT API server (default :4803) and Web host (default :4804)
  stop        Stop running UAT processes
  status      Show PID, port, and health status
  restart     Stop and start UAT processes
  logs        View logs (pass 'api' or 'web'; defaults to both)

Options:
  --config <file>     Path to dam-hopper.toml (default: /tmp/dam-hopper-uat/dam-hopper.toml)
  --env-file <file>   Path to env file with MONGODB_URI etc. (default: /tmp/dam-hopper-uat/uat.env)
  --api-port <port>   API server port (default: 4803)
  --web-port <port>   Web host port (default: 4804)
  --public-host <host> Public/Tailscale IP or hostname (e.g. 100.91.26.60)
  --cors-origins <url> Additional CORS origins (comma-separated, trailing slashes auto-cleaned)
  --no-auth           Run API server in development mode without authentication
  -h, --help          Show this help message
EOF
    exit 0
}
COMMAND="${1:-}"
if [[ -z "$COMMAND" || "$COMMAND" == "-h" || "$COMMAND" == "--help" ]]; then
    usage
fi
shift || true

while [[ $# -gt 0 ]]; do
    case "$1" in
        --api-port)
            API_PORT="$2"
            shift 2
            ;;
        --web-port)
            WEB_PORT="$2"
            shift 2
            ;;
        --no-auth)
            NO_AUTH=1
            shift
            ;;
        --config)
            CUSTOM_CONFIG="$2"
            shift 2
            ;;
        --env-file)
            ENV_FILE="$2"
            shift 2
            ;;
        --public-host)
            PUBLIC_HOST="$2"
            shift 2
            ;;
        --cors-origins)
            USER_CORS="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Error: Unknown argument '$1'" >&2
            exit 1
            ;;
    esac
done

API_BIN="$REPO_ROOT/server/target/release/dam-hopper-server"
WEB_BIN="$REPO_ROOT/server/target/release/dam-hopper-web"
WEB_DIST="$REPO_ROOT/apps/web/dist"

PID_SERVER="$UAT_DIR/server.pid"
PID_WEB="$UAT_DIR/web.pid"
LOG_SERVER="$UAT_DIR/server.log"
LOG_WEB="$UAT_DIR/web.log"
RUNTIME_CONFIG="$UAT_DIR/runtime-config.json"
UAT_CONFIG="${CUSTOM_CONFIG:-$UAT_DIR/dam-hopper.toml}"
check_prerequisites() {
    if [[ ! -x "$API_BIN" ]]; then
        echo "Error: API binary not found at $API_BIN. Run 'cargo build --release --bins' first." >&2
        exit 1
    fi
    if [[ ! -x "$WEB_BIN" ]]; then
        echo "Error: Web binary not found at $WEB_BIN. Run 'cargo build --release --bins' first." >&2
        exit 1
    fi
    if [[ ! -f "$WEB_DIST/index.html" ]]; then
        echo "Error: Web dist not found at $WEB_DIST. Run 'pnpm --filter @dam-hopper/web build' first." >&2
        exit 1
    fi
}

resolve_network_config() {
    local raw_cors="${USER_CORS:-${DAM_HOPPER_CORS_ORIGINS:-}}"
    local clean_user_cors=""
    if [[ -n "$raw_cors" ]]; then
        clean_user_cors=$(echo "$raw_cors" | sed -E 's|/+([,$])|\1|g' | sed -E 's|/+$||')
    fi

    if [[ -z "$PUBLIC_HOST" && -n "$clean_user_cors" ]]; then
        local candidate_host
        candidate_host=$(echo "$clean_user_cors" | grep -oE 'https?://[^/,:]+' | head -1 | sed -E 's|https?://||' || true)
        if [[ -n "$candidate_host" && "$candidate_host" != "localhost" && "$candidate_host" != "127.0.0.1" ]]; then
            PUBLIC_HOST="$candidate_host"
        fi
    fi

    local origins=("http://localhost:${WEB_PORT}" "http://127.0.0.1:${WEB_PORT}")
    if [[ -n "$PUBLIC_HOST" && "$PUBLIC_HOST" != "localhost" && "$PUBLIC_HOST" != "127.0.0.1" ]]; then
        origins+=("http://${PUBLIC_HOST}:${WEB_PORT}")
    fi
    if [[ -n "$clean_user_cors" ]]; then
        IFS=',' read -ra user_items <<< "$clean_user_cors"
        for item in "${user_items[@]}"; do
            item="$(echo "$item" | xargs)"
            item="${item%/}"
            if [[ -n "$item" ]]; then
                origins+=("$item")
            fi
        done
    fi

    local unique_origins=()
    local seen_str=" "
    for o in "${origins[@]}"; do
        if [[ "$seen_str" != *" $o "* ]]; then
            unique_origins+=("$o")
            seen_str+="$o "
        fi
    done

    FINAL_CORS=$(IFS=','; echo "${unique_origins[*]}")
    TARGET_API_HOST="${PUBLIC_HOST:-127.0.0.1}"
    FINAL_API_URL="http://${TARGET_API_HOST}:${API_PORT}"
}

setup_uat_environment() {
    mkdir -p "$UAT_DIR"

    # Write UAT runtime config pointing web host to UAT API server
    cat > "$RUNTIME_CONFIG" <<EOF
{
  "schemaVersion": 1,
  "role": "both",
  "releaseVersion": "0.3.1",
  "profileId": "00000000-0000-4000-8000-000000000001",
  "apiUrl": "${FINAL_API_URL}"
}
EOF

    # Write minimal UAT dam-hopper.toml if not present
    if [[ ! -f "$UAT_CONFIG" ]]; then
        cat > "$UAT_CONFIG" <<EOF
[workspace]
name = "uat-workspace"

[server.idle_suspend]
enabled = false
automatic_policy = "empty-fleet"
quiet_period_seconds = 900
wake_after_seconds = 600
EOF
    fi
}

is_running() {
    local pid_file="$1"
    if [[ -f "$pid_file" ]]; then
        local pid
        pid="$(cat "$pid_file" 2>/dev/null || true)"
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

start_services() {
    check_prerequisites

    # Load environment variables if provided or present in UAT_DIR
    if [[ -n "$ENV_FILE" ]]; then
        if [[ ! -f "$ENV_FILE" ]]; then
            echo "Error: Env file '$ENV_FILE' not found" >&2
            exit 1
        fi
        echo "Loading environment from: $ENV_FILE"
        set -a
        # shellcheck disable=SC1090
        . "$ENV_FILE"
        set +a
    elif [[ -f "$UAT_DIR/uat.env" ]]; then
        echo "Loading environment from: $UAT_DIR/uat.env"
        set -a
        # shellcheck disable=SC1090
        . "$UAT_DIR/uat.env"
        set +a
    fi

    resolve_network_config
    setup_uat_environment
    echo "API Server Port : ${API_PORT}"
    echo "Web Host Port   : ${WEB_PORT}"
    echo "Public Host     : ${PUBLIC_HOST:-(loopback only)}"
    echo "API URL (Web)   : ${FINAL_API_URL}"
    echo "CORS Origins    : ${FINAL_CORS}"

    if is_running "$PID_SERVER"; then
        echo "API server already running (PID $(cat "$PID_SERVER"))"
    else
        local auth_args=()
        if [[ $NO_AUTH -eq 1 ]]; then
            auth_args+=("--no-auth")
        fi

        DAM_HOPPER_CORS_ORIGINS="${FINAL_CORS}" \
        "$API_BIN" \
            --config "$UAT_CONFIG" \
            --host "$API_HOST" \
            --port "$API_PORT" \
            "${auth_args[@]}" \
            > "$LOG_SERVER" 2>&1 &
        echo $! > "$PID_SERVER"
        echo "✓ Started API server (PID $!, listening on ${API_HOST}:${API_PORT})"
    fi

    # 2. Start Web Host
    if is_running "$PID_WEB"; then
        echo "Web host already running (PID $(cat "$PID_WEB"))"
    else
        "$WEB_BIN" \
            --root "$WEB_DIST" \
            --host "$WEB_HOST" \
            --port "$WEB_PORT" \
            --runtime-config "$RUNTIME_CONFIG" \
            --release-version "0.3.1" \
            > "$LOG_WEB" 2>&1 &
        echo $! > "$PID_WEB"
        echo "✓ Started Web host (PID $!, listening on ${WEB_HOST}:${WEB_PORT})"
    fi

    echo ""
    echo "================================================="
    echo "UAT Web Interface : http://localhost:${WEB_PORT}"
    echo "UAT API Endpoint  : http://localhost:${API_PORT}"
    echo "Logs Directory    : ${UAT_DIR}/"
    echo "================================================="
}

stop_services() {
    echo "=== Stopping DamHopper UAT Environment ==="
    local stopped=0

    if is_running "$PID_SERVER"; then
        local pid
        pid="$(cat "$PID_SERVER")"
        echo "Stopping API server (PID $pid)..."
        kill "$pid" 2>/dev/null || true
        rm -f "$PID_SERVER"
        stopped=1
    fi

    if is_running "$PID_WEB"; then
        local pid
        pid="$(cat "$PID_WEB")"
        echo "Stopping Web host (PID $pid)..."
        kill "$pid" 2>/dev/null || true
        rm -f "$PID_WEB"
        stopped=1
    fi

    if [[ $stopped -eq 0 ]]; then
        echo "No UAT services were running."
    else
        echo "✓ UAT services stopped."
    fi
}

status_services() {
    echo "=== DamHopper UAT Environment Status ==="
    if is_running "$PID_SERVER"; then
        echo "API Server : RUNNING (PID $(cat "$PID_SERVER"), listening on :${API_PORT})"
    else
        echo "API Server : STOPPED"
    fi

    if is_running "$PID_WEB"; then
        echo "Web Host   : RUNNING (PID $(cat "$PID_WEB"), listening on :${WEB_PORT})"
    else
        echo "Web Host   : STOPPED"
    fi
}

logs_services() {
    local target="${1:-all}"
    case "$target" in
        api|server)
            tail -n 50 -f "$LOG_SERVER"
            ;;
        web)
            tail -n 50 -f "$LOG_WEB"
            ;;
        *)
            tail -n 50 -f "$LOG_SERVER" "$LOG_WEB"
            ;;
    esac
}

case "$COMMAND" in
    start)
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        stop_services
        sleep 1
        start_services
        ;;
    status)
        status_services
        ;;
    logs)
        logs_services "${1:-all}"
        ;;
    *)
        echo "Error: Unknown command '$COMMAND'" >&2
        usage
        ;;
esac
