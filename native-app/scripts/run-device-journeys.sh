#!/usr/bin/env bash
set -euo pipefail

# Phase 18 Android Device Journey Runner
# Executes real-server journeys on connected ARM64 device or x86_64 emulator.
# Enforces strict prerequisite verification and honest blocker reporting.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$NATIVE_APP_DIR/.." && pwd)"

echo "=== DamHopper Phase 18 Device Journey Runner ==="
echo "Working directory: $NATIVE_APP_DIR"

# 1. Check ADB availability
if ! command -v adb >/dev/null 2>&1; then
    echo "[BLOCKED] ADB command not found in PATH."
    echo "Physical hardware or emulator qualification requires Android SDK platform-tools."
    echo "GATE-C device journeys status: BLOCKED_PENDING_DEVICE"
    exit 2
fi

# 2. Check for attached devices
DEVICES=$(adb devices 2>/dev/null | grep -v "List of devices attached" | grep -w "device" | awk '{print $1}' || true)
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
DEVICE_MODEL=$(adb -s "$TARGET_DEVICE" shell getprop ro.product.model | tr -d '\r')
DEVICE_ABI=$(adb -s "$TARGET_DEVICE" shell getprop ro.product.cpu.abi | tr -d '\r')
DEVICE_API=$(adb -s "$TARGET_DEVICE" shell getprop ro.build.version.sdk | tr -d '\r')
DEVICE_PAGE_SIZE=$(adb -s "$TARGET_DEVICE" shell getconf PAGE_SIZE 2>/dev/null | tr -d '\r' || echo "unknown")

echo "[DEVICE METADATA]"
echo "  Model: $DEVICE_MODEL"
echo "  ABI: $DEVICE_ABI"
echo "  API Level: $DEVICE_API"
echo "  Kernel Page Size: $DEVICE_PAGE_SIZE bytes"

# 3. Setup isolated disposable server fixtures and port forwarding
echo "[INFO] Setting up loopback reverse port forwarding (port 4801)..."
adb -s "$TARGET_DEVICE" reverse tcp:4801 tcp:4801

cleanup() {
    echo "[INFO] Cleaning up adb reverse mappings..."
    adb -s "$TARGET_DEVICE" reverse --remove-all || true
}
trap cleanup EXIT

# 4. Execute instrumentation test suite
echo "[INFO] Running Android instrumentation journeys on target device..."
cd "$NATIVE_APP_DIR"

./gradlew :androidApp:connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.class=dev.damhopper.nativeapp.WorkbenchJourneys

echo "[PASS] Device journey instrumentation tests executed successfully on $DEVICE_MODEL."
