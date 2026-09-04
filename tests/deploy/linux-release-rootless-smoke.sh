#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"

API_BIN="${DAM_HOPPER_API_BIN:-}"
WEB_BIN="${DAM_HOPPER_WEB_BIN:-}"
RELEASE_VERSION="${DAM_HOPPER_RELEASE_VERSION:-0.1.0}"

resolve_binary() {
    local requested="$1"
    shift
    if [[ -n "$requested" ]]; then
        printf '%s\n' "$requested"
        return 0
    fi
    local candidate
    for candidate in "$@"; do
        if [[ -x "$candidate" ]]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    return 1
}

API_BIN="$(resolve_binary "$API_BIN" \
    "$REPO_ROOT/server/target/release/dam-hopper-server" \
    "$REPO_ROOT/server/target/debug/dam-hopper-server")" || {
    printf 'Error: dam-hopper-server binary is required; set DAM_HOPPER_API_BIN\n' >&2
    exit 1
}
WEB_BIN="$(resolve_binary "$WEB_BIN" \
    "$REPO_ROOT/server/target/release/dam-hopper-web" \
    "$REPO_ROOT/server/target/debug/dam-hopper-web")" || {
    printf 'Error: dam-hopper-web binary is required; set DAM_HOPPER_WEB_BIN\n' >&2
    exit 1
}

TEST_ROOT="$(mktemp -d -t dam-hopper-rootless-smoke-XXXXXXXX)"
chmod 0700 "$TEST_ROOT"
API_PID=""
WEB_PID=""
cleanup() {
    set +e
    [[ -n "$API_PID" ]] && kill -TERM "$API_PID" 2>/dev/null || true
    [[ -n "$WEB_PID" ]] && kill -TERM "$WEB_PID" 2>/dev/null || true
    [[ -n "$API_PID" ]] && wait "$API_PID" 2>/dev/null || true
    [[ -n "$WEB_PID" ]] && wait "$WEB_PID" 2>/dev/null || true
    rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT INT TERM

read -r API_PORT WEB_PORT < <(python3 - <<'PY'
import socket
ports = []
for _ in range(2):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    ports.append(str(sock.getsockname()[1]))
    sock.close()
print(*ports)
PY
)

WEB_ROOT="$TEST_ROOT/web"
HOME_ROOT="$TEST_ROOT/home"
WORKSPACE_ROOT="$TEST_ROOT/workspace"
mkdir -p "$WEB_ROOT" "$HOME_ROOT/.config" "$WORKSPACE_ROOT"
printf '<!doctype html><html><body>rootless-smoke</body></html>\n' > "$WEB_ROOT/index.html"
cat > "$TEST_ROOT/runtime-config.json" <<EOF
{"schemaVersion":1,"role":"web","releaseVersion":"${RELEASE_VERSION}","profileId":"c7325e68-07e1-4e44-8d96-b333a4658cf9"}
EOF
cat > "$TEST_ROOT/dam-hopper.toml" <<EOF
[workspace]
name = "rootless-smoke"
root = "${WORKSPACE_ROOT}"

[server]
session_db_path = "${TEST_ROOT}/sessions.db"
EOF

wait_for_http() {
    local url="$1"
    local expected_status="$2"
    local attempt
    for attempt in $(seq 1 120); do
        if python3 - "$url" "$expected_status" <<'PY'
import sys
import urllib.request
try:
    with urllib.request.urlopen(sys.argv[1], timeout=0.5) as response:
        raise SystemExit(0 if response.status == int(sys.argv[2]) else 1)
except Exception:
    raise SystemExit(1)
PY
        then
            return 0
        fi
        sleep 0.1
done
    printf 'Timed out waiting for %s\n' "$url" >&2
    if [[ -f "$TEST_ROOT/web.log" ]]; then
        printf '%s\n' '--- web.log ---' >&2
        cat "$TEST_ROOT/web.log" >&2
    fi
    if [[ -f "$TEST_ROOT/api.log" ]]; then
        printf '%s\n' '--- api.log ---' >&2
        cat "$TEST_ROOT/api.log" >&2
    fi
    return 1
}

printf 'Starting rootless web host (%s)\n' "$WEB_BIN"
"$WEB_BIN" \
    --root "$WEB_ROOT" \
    --host 127.0.0.1 \
    --port "$WEB_PORT" \
    --runtime-config "$TEST_ROOT/runtime-config.json" \
    --release-version "$RELEASE_VERSION" \
    >"$TEST_ROOT/web.log" 2>&1 &
WEB_PID=$!
wait_for_http "http://127.0.0.1:${WEB_PORT}/__dam-hopper/health" 200

python3 - "$WEB_PORT" "$RELEASE_VERSION" <<'PY'
import json
import sys
import urllib.error
import urllib.request

port, version = sys.argv[1:]
base = f"http://127.0.0.1:{port}"

def request(path, method="GET", headers=None):
    req = urllib.request.Request(base + path, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=3) as response:
            headers = {k.lower(): v for k, v in response.headers.items()}
            return response.status, headers, response.read()
    except urllib.error.HTTPError as error:
        headers = {k.lower(): v for k, v in error.headers.items()}
        return error.code, headers, error.read()
status, headers, body = request("/__dam-hopper/health")
assert status == 200
health = json.loads(body)
assert health == {"schemaVersion": 1, "status": "ok", "version": version, "role": "web"}
assert headers.get("cache-control") == "no-store"

status, headers, body = request("/__dam-hopper/runtime-config.json")
assert status == 200
runtime = json.loads(body)
assert runtime["schemaVersion"] == 1
assert "role" not in runtime and "allowedWebOrigins" not in runtime
assert headers.get("cache-control") == "no-store"

status, headers, body = request("/index.html")
assert status == 200 and b"rootless-smoke" in body
assert headers.get("cache-control") == "no-cache"

status, headers, body = request("/index.html", method="HEAD")
assert status == 200 and body == b""
assert int(headers.get("content-length", 0)) > 0

status, _, body = request("/dashboard", headers={"Accept": "text/html"})
assert status == 200 and b"rootless-smoke" in body

status, _, _ = request("/../etc/passwd")
assert status == 404
status, _, _ = request("/__dam-hopper/unknown")
assert status == 404
status, headers, _ = request("/index.html", method="POST")
assert status == 405 and headers.get("allow") == "GET, HEAD"
PY

kill -TERM "$WEB_PID"
set +e
wait "$WEB_PID"
WEB_EXIT=$?
set -e
WEB_PID=""
if [[ "$WEB_EXIT" -ne 0 && "$WEB_EXIT" -ne 143 ]]; then
    printf 'Web host did not terminate cleanly (exit %s)\n' "$WEB_EXIT" >&2
    exit 1
fi

printf 'Starting rootless API server (%s)\n' "$API_BIN"
env -u MONGODB_URI -u MONGODB_DATABASE \
    HOME="$HOME_ROOT" XDG_CONFIG_HOME="$HOME_ROOT/.config" RUST_ENV=development ENVIRONMENT=development RUST_LOG=error \
    "$API_BIN" \
    --config "$TEST_ROOT/dam-hopper.toml" \
    --workspace "$WORKSPACE_ROOT" \
    --host 127.0.0.1 \
    --port "$API_PORT" \
    --no-auth \
    >"$TEST_ROOT/api.log" 2>&1 &
API_PID=$!
wait_for_http "http://127.0.0.1:${API_PORT}/api/health" 200

python3 - "$API_PORT" <<'PY'
import json
import sys
import urllib.request

url = f"http://127.0.0.1:{sys.argv[1]}/api/health"
with urllib.request.urlopen(url, timeout=3) as response:
    assert response.status == 200
    payload = json.loads(response.read())
assert payload["schemaVersion"] == 1
assert payload["status"] == "ok"
assert payload["role"] == "api"
PY

kill -TERM "$API_PID"
set +e
wait "$API_PID"
API_EXIT=$?
set -e
API_PID=""
if [[ "$API_EXIT" -ne 0 && "$API_EXIT" -ne 143 ]]; then
    printf 'API server did not terminate cleanly (exit %s)\n' "$API_EXIT" >&2
    exit 1
fi

printf 'Rootless API/web process smoke passed (ports %s/%s)\n' "$API_PORT" "$WEB_PORT"
