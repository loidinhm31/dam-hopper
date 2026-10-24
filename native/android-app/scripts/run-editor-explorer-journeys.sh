#!/usr/bin/env bash
set -euo pipefail

# Phase 08 Android Native Editor & File Explorer Journey Runner
# Executes real-server journeys on connected ARM64 device or x86_64 emulator.
# Enforces strict prerequisite verification and honest blocker reporting.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$NATIVE_APP_DIR/../.." && pwd)"

echo "=== DamHopper Phase 08 Editor Explorer Journey Runner ==="
echo "Working directory: $NATIVE_APP_DIR"

# 1. Check ADB availability
ADB="adb"
if ! command -v adb >/dev/null 2>&1; then
    if command -v adb.exe >/dev/null 2>&1; then
        ADB="adb.exe"
    elif [ -n "${ANDROID_HOME:-}" ] && [ -x "$ANDROID_HOME/platform-tools/adb.exe" ]; then
        ADB="$ANDROID_HOME/platform-tools/adb.exe"
    elif [ -n "${ANDROID_SDK_ROOT:-}" ] && [ -x "$ANDROID_SDK_ROOT/platform-tools/adb.exe" ]; then
        ADB="$ANDROID_SDK_ROOT/platform-tools/adb.exe"
    elif [ -x "/mnt/c/Users/loidi/AppData/Local/Android/Sdk/platform-tools/adb.exe" ]; then
        ADB="/mnt/c/Users/loidi/AppData/Local/Android/Sdk/platform-tools/adb.exe"
    elif [ -x "/c/Users/loidi/AppData/Local/Android/Sdk/platform-tools/adb.exe" ]; then
        ADB="/c/Users/loidi/AppData/Local/Android/Sdk/platform-tools/adb.exe"
    elif [ -x "C:/Users/loidi/AppData/Local/Android/Sdk/platform-tools/adb.exe" ]; then
        ADB="C:/Users/loidi/AppData/Local/Android/Sdk/platform-tools/adb.exe"
    elif [ -n "${USER:-}" ] && [ -x "/mnt/c/Users/$USER/AppData/Local/Android/Sdk/platform-tools/adb.exe" ]; then
        ADB="/mnt/c/Users/$USER/AppData/Local/Android/Sdk/platform-tools/adb.exe"
    else
        echo "[BLOCKED] ADB command not found in PATH or Android SDK platform-tools."
        echo "Physical hardware or emulator qualification requires Android SDK platform-tools."
        echo "GATE-C device journeys status: BLOCKED_PENDING_DEVICE"
        exit 2
    fi
fi

# 2. Check for attached devices
DEVICES=$($ADB devices 2>/dev/null | grep -v "List of devices attached" | grep -w "device" | awk '{print $1}' || true)
if [ -z "$DEVICES" ]; then
    echo "[BLOCKED] No connected Android devices or running emulators detected via adb."
    echo "To run device journeys:"
    echo "  1. Attach an ARM64 physical device via USB with USB debugging enabled, or"
    echo "  2. Launch an Android emulator (e.g., emulator -avd DamHopper_API35_x86_64)"
    echo "  3. Re-run $0"
    echo ""
    echo "Reporting GATE-C physical device status honestly: BLOCKED_PENDING_DEVICE"
    exit 2
fi

echo "[INFO] Detected device(s):"
echo "$DEVICES"
TARGET_DEVICE=$(echo "$DEVICES" | head -n 1)
echo "[INFO] Selecting target device: $TARGET_DEVICE"

# Capture device metadata
DEVICE_MODEL=$($ADB -s "$TARGET_DEVICE" shell getprop ro.product.model | tr -d '\r')
DEVICE_ABI=$($ADB -s "$TARGET_DEVICE" shell getprop ro.product.cpu.abi | tr -d '\r')
DEVICE_API=$($ADB -s "$TARGET_DEVICE" shell getprop ro.build.version.sdk | tr -d '\r')
DEVICE_PAGE_SIZE=$($ADB -s "$TARGET_DEVICE" shell getconf PAGE_SIZE 2>/dev/null | tr -d '\r' || echo "unknown")

echo "[DEVICE METADATA]"
echo "  Model: $DEVICE_MODEL"
echo "  ABI: $DEVICE_ABI"
echo "  API Level: $DEVICE_API"
echo "  Kernel Page Size: $DEVICE_PAGE_SIZE bytes"

# 3. Setup isolated disposable server fixtures and port forwarding
SERVER_PORT=4801
if [ -d "/mnt/c/Users/loidi/AppData/Local/Temp" ]; then
    RUN_ID="damhopper_e2e_$$-$(date +%s)"
    FIXTURE_DIR="/mnt/c/Users/loidi/AppData/Local/Temp/$RUN_ID"
    WIN_FIXTURE_DIR="C:/Users/loidi/AppData/Local/Temp/$RUN_ID"
    rm -rf "$FIXTURE_DIR" 2>/dev/null || true
else
    FIXTURE_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t 'damhopper_e2e_fixture')
    WIN_FIXTURE_DIR="$FIXTURE_DIR"
fi
mkdir -p "$FIXTURE_DIR"
echo "[INFO] Isolated test fixture directory: $FIXTURE_DIR"

PROJ_A="$FIXTURE_DIR/demo-project-a"
PROJ_B="$FIXTURE_DIR/demo-project-b"
WIN_PROJ_A="$WIN_FIXTURE_DIR/demo-project-a"
WIN_PROJ_B="$WIN_FIXTURE_DIR/demo-project-b"
mkdir -p "$PROJ_A/src" "$PROJ_B/src"
printf "sentinel_bytes_alpha_12345\n" > "$PROJ_A/src/main.ts"
printf "sentinel_bytes_beta_67890\n" > "$PROJ_B/src/main.ts"
printf "doc 1 initial content\n" > "$PROJ_A/src/doc1.txt"
printf "doc 2 initial content\n" > "$PROJ_A/src/doc2.txt"
printf "conflict initial content\n" > "$PROJ_A/src/conflict.ts"
printf "race initial content\n" > "$PROJ_A/src/race.ts"
printf "common alpha content\n" > "$PROJ_A/common.ts"
printf "common beta content\n" > "$PROJ_B/common.ts"

# Write valid DamHopperConfigRaw TOML schema with [workspace] and [[projects]] array
SERVER_CONFIG="$FIXTURE_DIR/dam-hopper.toml"
cat <<EOF > "$SERVER_CONFIG"
[workspace]
name = "fixture-workspace"
root = "$WIN_FIXTURE_DIR"

[server]
host = "127.0.0.1"
port = $SERVER_PORT

[[projects]]
name = "demo-project-a"
path = "$WIN_PROJ_A"
type = "custom"

[[projects]]
name = "demo-project-b"
path = "$WIN_PROJ_B"
type = "custom"
EOF

SQLITE_AUTH_DB="$FIXTURE_DIR/auth.db"
WIN_SQLITE_AUTH_DB="$WIN_FIXTURE_DIR/auth.db"
SERVER_TOKEN="fixture-token-phase08-secret-$(date +%s)"

# Establish isolated config directory for server-token discovery
ISOLATED_CONFIG_DIR="$FIXTURE_DIR/config/dam-hopper"
mkdir -p "$ISOLATED_CONFIG_DIR"
echo -n "$SERVER_TOKEN" > "$ISOLATED_CONFIG_DIR/server-token"

# On Windows dirs::config_dir() resolves to %APPDATA%
ISOLATED_APPDATA_DIR="$FIXTURE_DIR/appdata/dam-hopper"
mkdir -p "$ISOLATED_APPDATA_DIR"
echo -n "$SERVER_TOKEN" > "$ISOLATED_APPDATA_DIR/server-token"

echo "[INFO] Seeding isolated SQLite lite-mode authentication..."
if command -v cargo >/dev/null 2>&1; then
    RUN_CARGO="cargo"
else
    RUN_CARGO="cmd.exe /c cargo"
fi

if [ "$RUN_CARGO" = "cmd.exe /c cargo" ]; then
    SEED_OUTPUT=$(cmd.exe /c "cargo run --manifest-path server/Cargo.toml --example application_e2e_seed -- --sqlite-path $WIN_SQLITE_AUTH_DB --server-token $SERVER_TOKEN --username admin")
else
    SEED_OUTPUT=$(cargo run --manifest-path server/Cargo.toml --example application_e2e_seed -- --sqlite-path "$SQLITE_AUTH_DB" --server-token "$SERVER_TOKEN" --username "admin")
fi

SEED_TOKEN=$(echo "$SEED_OUTPUT" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || true)
if [ -z "$SEED_TOKEN" ]; then
    echo "[ERROR] Failed to obtain signed bearer token from application_e2e_seed"
    echo "$SEED_OUTPUT"
    exit 1
fi
echo "[INFO] Successfully seeded admin user and generated test bearer token"

SERVER_PID=""
RUN_SUCCESS=0
cleanup() {
    echo "[INFO] Running cleanup..."
    $ADB -s "$TARGET_DEVICE" reverse --remove tcp:$SERVER_PORT 2>/dev/null || true
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "[INFO] Stopping server process $SERVER_PID..."
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    if [ "$RUN_SUCCESS" -eq 1 ]; then
        rm -rf "$FIXTURE_DIR" 2>/dev/null || true
    else
        echo "[WARN] Run did not succeed; preserving fixture directory for inspection: $FIXTURE_DIR"
    fi
}
trap cleanup EXIT INT TERM

echo "[INFO] Setting up loopback reverse port forwarding (port $SERVER_PORT)..."
$ADB -s "$TARGET_DEVICE" reverse tcp:$SERVER_PORT tcp:$SERVER_PORT

# 4. Launch isolated server using valid environment
echo "[INFO] Starting isolated DamHopper server on loopback 127.0.0.1:$SERVER_PORT..."
if [ "$RUN_CARGO" = "cmd.exe /c cargo" ]; then
    cmd.exe /c "set APPDATA=$WIN_FIXTURE_DIR\appdata && set DAM_HOPPER_LITE_MODE=true && set DAM_HOPPER_AUTH_SQLITE_PATH=$WIN_SQLITE_AUTH_DB && cargo run --manifest-path server/Cargo.toml --bin dam-hopper-server -- --config $WIN_FIXTURE_DIR/dam-hopper.toml --host 127.0.0.1 --port $SERVER_PORT" > "$FIXTURE_DIR/server.log" 2>&1 &
    SERVER_PID=$!
else
    APPDATA="$FIXTURE_DIR/appdata" \
    XDG_CONFIG_HOME="$FIXTURE_DIR/config" \
    DAM_HOPPER_LITE_MODE=true \
    DAM_HOPPER_AUTH_SQLITE_PATH="$SQLITE_AUTH_DB" \
    cargo run --manifest-path server/Cargo.toml --bin dam-hopper-server -- \
        --config "$SERVER_CONFIG" \
        --host 127.0.0.1 \
        --port $SERVER_PORT > "$FIXTURE_DIR/server.log" 2>&1 &
    SERVER_PID=$!
fi

# Wait for server readiness and verify child PID + authenticated fixture response
echo "[INFO] Awaiting server readiness on port $SERVER_PORT..."
SERVER_READY=0
for i in $(seq 1 60); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "[ERROR] Server process died prematurely"
        break
    fi
    if curl -s -f -H "Authorization: Bearer $SEED_TOKEN" "http://127.0.0.1:$SERVER_PORT/api/fs/stat?project=demo-project-a&path=src/main.ts" >/dev/null 2>&1; then
        SERVER_READY=1
        break
    fi
    sleep 1
done

if [ "$SERVER_READY" -ne 1 ]; then
    echo "[ERROR] Server failed to become ready on http://127.0.0.1:$SERVER_PORT within timeout"
    cat "$FIXTURE_DIR/server.log" 2>/dev/null || true
    exit 1
fi
echo "[INFO] Server is healthy and responding to requests"

# 5. Execute instrumentation test suite with individually passed runner arguments
echo "[INFO] Running NativeEditorExplorerJourneys on target device..."
cd "$NATIVE_APP_DIR"

export ANDROID_SERIAL="$TARGET_DEVICE"
if [ -f "./gradlew.bat" ] && command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c "set ANDROID_SERIAL=$TARGET_DEVICE && gradlew.bat :androidApp:connectedDebugAndroidTest \
        -Pandroid.testInstrumentationRunnerArguments.class=dev.damhopper.nativeapp.NativeEditorExplorerJourneys \
        -Pandroid.testInstrumentationRunnerArguments.serverUrl=http://127.0.0.1:$SERVER_PORT \
        -Pandroid.testInstrumentationRunnerArguments.authToken=$SEED_TOKEN \
        -Pandroid.testInstrumentationRunnerArguments.primaryProject=demo-project-a \
        -Pandroid.testInstrumentationRunnerArguments.secondaryProject=demo-project-b"
else
    ./gradlew :androidApp:connectedDebugAndroidTest \
        -Pandroid.testInstrumentationRunnerArguments.class=dev.damhopper.nativeapp.NativeEditorExplorerJourneys \
        -Pandroid.testInstrumentationRunnerArguments.serverUrl="http://127.0.0.1:$SERVER_PORT" \
        -Pandroid.testInstrumentationRunnerArguments.authToken="$SEED_TOKEN" \
        -Pandroid.testInstrumentationRunnerArguments.primaryProject="demo-project-a" \
        -Pandroid.testInstrumentationRunnerArguments.secondaryProject="demo-project-b"
fi

# 6. Verify host filesystem post-run authoritative state
if [ ! -f "$PROJ_A/src/main.ts" ]; then
    echo "[ERROR] Expected primary project file was removed or missing: $PROJ_A/src/main.ts"
    exit 1
fi
FINAL_A_BYTES=$(cat "$PROJ_A/src/main.ts")
echo "[HOST VERIFICATION] Primary project fixture verified: $FINAL_A_BYTES"

if [ ! -f "$PROJ_B/src/main.ts" ]; then
    echo "[ERROR] Secondary project file missing: $PROJ_B/src/main.ts"
    exit 1
fi
FINAL_B_BYTES=$(cat "$PROJ_B/src/main.ts")
if [ "$FINAL_B_BYTES" != "sentinel_bytes_beta_67890" ]; then
    echo "[ERROR] Secondary project sentinel was corrupted or overwritten: $FINAL_B_BYTES"
    exit 1
fi
echo "[HOST VERIFICATION] Secondary project cross-target isolation verified untouched"

RUN_SUCCESS=1
echo "[PASS] Device journey instrumentation tests executed successfully on $DEVICE_MODEL."
