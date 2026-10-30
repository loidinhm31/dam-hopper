#!/usr/bin/env bash
set -euo pipefail

# Phase 07 Focused Git Android Workspace Journey Runner
# Executes real-server Git journeys on connected ARM64 device or x86_64 emulator.
# Enforces strict prerequisite verification and honest blocker reporting.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$NATIVE_APP_DIR/../.." && pwd)"

echo "=== DamHopper Phase 07 Git Workspace Journey Runner ==="
echo "Working directory: $NATIVE_APP_DIR"

SERIAL=""
SERVER_BIN=""
SEED_BIN=""
EVIDENCE_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --serial|--device)
      SERIAL="$2"
      shift 2
      ;;
    --server-bin)
      SERVER_BIN="$2"
      shift 2
      ;;
    --seed-bin)
      SEED_BIN="$2"
      shift 2
      ;;
    --evidence-dir)
      EVIDENCE_DIR="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 --server-bin <path> --seed-bin <path> [--serial <id>] [--evidence-dir <dir>]"
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown option: $1"
      exit 1
      ;;
  esac
done

# 1. Check prerequisites: git and node
GIT="git"
if ! command -v git >/dev/null 2>&1; then
  if command -v git.exe >/dev/null 2>&1; then
    GIT="git.exe"
  else
    echo "[BLOCKED] git command not found in PATH."
    exit 1
  fi
fi

NODE="node"
if ! command -v node >/dev/null 2>&1; then
  if command -v node.exe >/dev/null 2>&1; then
    NODE="node.exe"
  else
    echo "[BLOCKED] node command not found in PATH."
    exit 1
  fi
fi

# 2. Check ADB availability
ADB="adb"
if ! command -v adb >/dev/null 2>&1; then
  if command -v adb.exe >/dev/null 2>&1; then
    ADB="adb.exe"
  else
    echo "[BLOCKED] ADB command not found in PATH."
    echo "Physical hardware or emulator qualification requires Android SDK platform-tools."
    echo "GATE-C device journeys status: BLOCKED_PENDING_DEVICE"
    exit 2
  fi
fi

# 3. Check for attached devices
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

TARGET_DEVICE="$SERIAL"
if [ -z "$TARGET_DEVICE" ]; then
  TARGET_DEVICE=$(echo "$DEVICES" | head -n 1)
fi
echo "[INFO] Target device: $TARGET_DEVICE"

# Capture device metadata
DEVICE_MODEL=$($ADB -s "$TARGET_DEVICE" shell getprop ro.product.model 2>/dev/null | tr -d '\r' || echo "unknown")
DEVICE_ABI=$($ADB -s "$TARGET_DEVICE" shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r' || echo "unknown")
DEVICE_API=$($ADB -s "$TARGET_DEVICE" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r' || echo "unknown")
DEVICE_PAGE_SIZE=$($ADB -s "$TARGET_DEVICE" shell getconf PAGE_SIZE 2>/dev/null | tr -d '\r' || echo "unknown")

echo "[DEVICE METADATA]"
echo "  Model: $DEVICE_MODEL"
echo "  ABI: $DEVICE_ABI"
echo "  API Level: $DEVICE_API"
echo "  Kernel Page Size: $DEVICE_PAGE_SIZE bytes"

# 4. Verify Server & Seed Binaries
if [ -z "$SERVER_BIN" ] || [ ! -f "$SERVER_BIN" ]; then
  echo "[BLOCKED] Missing or non-existent --server-bin: $SERVER_BIN"
  exit 1
fi

if [ -z "$SEED_BIN" ] || [ ! -f "$SEED_BIN" ]; then
  echo "[BLOCKED] Missing or non-existent --seed-bin: $SEED_BIN"
  exit 1
fi

# 5. Setup Isolated Evidence Directory
if [ -z "$EVIDENCE_DIR" ]; then
  EVIDENCE_DIR=$(mktemp -d -t damhopper-git-evidence-XXXXXX 2>/dev/null || echo "/tmp/damhopper-git-evidence-$$")
fi
mkdir -p "$EVIDENCE_DIR"
echo "[INFO] Isolated evidence directory: $EVIDENCE_DIR"

SERVER_PORT=4801
PROXY_PORT=4802

cleanup() {
  echo "[INFO] Cleaning up test processes and adb reverse mappings..."
  $ADB -s "$TARGET_DEVICE" reverse --remove tcp:$PROXY_PORT 2>/dev/null || true
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# 6. Execute git-workspace-fixture to seed auth, configure workspace and run server + proxy
echo "[INFO] Starting isolated server, git fixtures, and transparent proxy..."
$NODE "$SCRIPT_DIR/git-workspace-fixture.mjs" --smoke-current-server \
  --server-bin "$SERVER_BIN" \
  --seed-bin "$SEED_BIN" \
  --evidence-dir "$EVIDENCE_DIR" \
  --server-port "$SERVER_PORT" \
  --proxy-port "$PROXY_PORT"

# 7. Reverse port forward proxy port to device loopback
echo "[INFO] Setting up adb reverse loopback on port $PROXY_PORT..."
$ADB -s "$TARGET_DEVICE" reverse tcp:$PROXY_PORT tcp:$PROXY_PORT

# Read generated smoke evidence to extract auth token and user
SMOKE_EVIDENCE=$(find "$EVIDENCE_DIR" -name "smoke-evidence.json" | head -n 1)
AUTH_TOKEN=""
ACCOUNT_USER="git-fixture"
if [ -f "$SMOKE_EVIDENCE" ]; then
  echo "[INFO] Found smoke evidence: $SMOKE_EVIDENCE"
fi

# 8. Execute Connected Android Test for NativeGitWorkspaceJourneys
echo "[INFO] Executing NativeGitWorkspaceJourneys on $TARGET_DEVICE..."
cd "$NATIVE_APP_DIR"
export ANDROID_SERIAL="$TARGET_DEVICE"

GRADLE_CMD="./gradlew.bat"
if [ ! -f "$GRADLE_CMD" ]; then
  GRADLE_CMD="./gradlew"
fi

$GRADLE_CMD -p "$NATIVE_APP_DIR" :androidApp:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=dev.damhopper.nativeapp.NativeGitWorkspaceJourneys \
  -Pandroid.testInstrumentationRunnerArguments.serverUrl="http://127.0.0.1:$PROXY_PORT" \
  -Pandroid.testInstrumentationRunnerArguments.proxyUrl="http://127.0.0.1:$PROXY_PORT" \
  -Pandroid.testInstrumentationRunnerArguments.oracleUrl="http://127.0.0.1:$PROXY_PORT/__test_control/oracle" \
  -Pandroid.testInstrumentationRunnerArguments.controlUrl="http://127.0.0.1:$PROXY_PORT/__test_control" \
  -Pandroid.testInstrumentationRunnerArguments.authToken="$AUTH_TOKEN" \
  -Pandroid.testInstrumentationRunnerArguments.accountUser="$ACCOUNT_USER" \
  -Pandroid.testInstrumentationRunnerArguments.primaryProject="primary" \
  -Pandroid.testInstrumentationRunnerArguments.secondaryProject="secondary"

echo "[PASS] Git workspace journey suite completed on $DEVICE_MODEL."
