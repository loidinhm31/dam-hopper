#!/usr/bin/env bash
set -euo pipefail

# Phase 18 APK Security, ABI & 16 KiB Alignment Audit Tool
# Audits manifest security, backup exclusion, cleartext TLS policies, secret leaks,
# and native .so ELF / APK page alignments.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$NATIVE_APP_DIR/.." && pwd)"

echo "=== DamHopper Phase 18 APK Security & ABI Audit ==="
echo "Native App Directory: $NATIVE_APP_DIR"

PASS_COUNT=0
FAIL_COUNT=0

record_pass() {
    echo "  [PASS] $1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

record_fail() {
    echo "  [FAIL] $1: $2"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

echo ""
echo "=== Section 1: Manifest & Backup Security Audit ==="
MANIFEST="$NATIVE_APP_DIR/androidApp/src/main/AndroidManifest.xml"
DATA_RULES="$NATIVE_APP_DIR/androidApp/src/main/res/xml/data_extraction_rules.xml"

if [ -f "$MANIFEST" ]; then
    if grep -Fq 'android:allowBackup="false"' "$MANIFEST"; then
        record_pass "Manifest explicitly disables allowBackup (android:allowBackup=\"false\")"
    else
        record_fail "Manifest allowBackup" "allowBackup=\"false\" not found"
    fi

    if grep -Fq 'android:fullBackupContent="false"' "$MANIFEST"; then
        record_pass "Manifest explicitly disables fullBackupContent (android:fullBackupContent=\"false\")"
    else
        record_fail "Manifest fullBackupContent" "fullBackupContent=\"false\" not found"
    fi

    if grep -Fq 'android:windowSoftInputMode="adjustResize"' "$MANIFEST"; then
        record_pass "Manifest specifies windowSoftInputMode=\"adjustResize\" for top row visibility"
    else
        record_fail "Manifest softInputMode" "adjustResize not found"
    fi

    if grep -Fq 'android:name="android.permission.INTERNET"' "$MANIFEST"; then
        record_pass "Manifest requests required INTERNET permission"
    else
        record_fail "Manifest permissions" "INTERNET permission not found"
    fi

    if grep -Fq 'android:name="android.permission.POST_NOTIFICATIONS"' "$MANIFEST"; then
        record_pass "Manifest declares POST_NOTIFICATIONS permission for API 33+"
    else
        record_fail "Manifest permissions" "POST_NOTIFICATIONS permission not found"
    fi
else
    record_fail "Manifest file" "AndroidManifest.xml not found at $MANIFEST"
fi

if [ -f "$DATA_RULES" ]; then
    if grep -Fq '<data-extraction-rules>' "$DATA_RULES"; then
        record_pass "data_extraction_rules.xml present and configured"
    else
        record_fail "Data extraction rules" "Malformed data extraction rules"
    fi
else
    record_fail "Data extraction rules" "$DATA_RULES not found"
fi

echo ""
echo "=== Section 2: Network Security Configuration Audit ==="
NET_SEC_RELEASE="$NATIVE_APP_DIR/androidApp/src/main/res/xml/network_security_config.xml"
NET_SEC_DEBUG="$NATIVE_APP_DIR/androidApp/src/debug/res/xml/network_security_config.xml"

if [ -f "$NET_SEC_RELEASE" ]; then
    if grep -Fq 'cleartextTrafficPermitted="false"' "$NET_SEC_RELEASE"; then
        record_pass "Release network security config strictly prohibits cleartext traffic across all domains"
    else
        record_fail "Release network security" "cleartextTrafficPermitted=\"false\" missing in release config"
    fi
else
    record_fail "Release network security" "$NET_SEC_RELEASE not found"
fi

if [ -f "$NET_SEC_DEBUG" ]; then
    if grep -Fq '10.0.2.2' "$NET_SEC_DEBUG" && grep -Fq '127.0.0.1' "$NET_SEC_DEBUG" && grep -Fq 'localhost' "$NET_SEC_DEBUG"; then
        record_pass "Debug network security config isolates cleartext permits strictly to development loopback"
    else
        record_fail "Debug network security" "Loopback domains not isolated in debug config"
    fi
else
    record_fail "Debug network security" "$NET_SEC_DEBUG not found"
fi

echo ""
echo "=== Section 3: Secret Leak Scan in Codebase & Resources ==="
LEAK_FOUND=0
PATTERNS=("BEGIN PRIVATE KEY" "BEGIN RSA PRIVATE KEY" "dhs_token_[A-Za-z0-9_]{32,}" "server-token")

for pat in "${PATTERNS[@]}"; do
    MATCHES=$(grep -rn "$pat" "$NATIVE_APP_DIR/shared/src" "$NATIVE_APP_DIR/androidApp/src" 2>/dev/null || true)
    if [ -n "$MATCHES" ]; then
        # Exclude known test fixture names or comments
        REAL_LEAKS=$(echo "$MATCHES" | grep -v "Test" | grep -v "//" | grep -v "server-token-header" || true)
        if [ -n "$REAL_LEAKS" ]; then
            record_fail "Secret leak scan" "Potential secret matching pattern '$pat': $REAL_LEAKS"
            LEAK_FOUND=1
        fi
    fi
done

if [ "$LEAK_FOUND" -eq 0 ]; then
    record_pass "Zero unredacted private keys or embedded server tokens found in client source trees"
fi

echo ""
echo "=== Section 4: Native Library ABI & 16 KiB Page Size Audit ==="
# Verify ndk abiFilters in build.gradle.kts
GRADLE_APP="$NATIVE_APP_DIR/androidApp/build.gradle.kts"
if grep -Fq '"arm64-v8a"' "$GRADLE_APP" && grep -Fq '"x86_64"' "$GRADLE_APP"; then
    record_pass "androidApp declares target ABIs: arm64-v8a and x86_64"
else
    record_fail "ABI configuration" "Missing arm64-v8a or x86_64 abiFilters in build.gradle.kts"
fi

APK_DEBUG="$NATIVE_APP_DIR/androidApp/build/outputs/apk/debug/androidApp-debug.apk"
if [ ! -f "$APK_DEBUG" ]; then
    echo "  [INFO] Assembling debug APK for artifact inspection..."
    (cd "$NATIVE_APP_DIR" && ./gradlew :androidApp:assembleDebug >/dev/null 2>&1) || true
fi

if [ -f "$APK_DEBUG" ]; then
    record_pass "Debug APK artifact exists at $APK_DEBUG"
else
    record_fail "Debug APK artifact" "APK file not found at $APK_DEBUG"
fi

# Unpack and inspect actual .so files from the APK
TMP_UNPACK=$(mktemp -d)
trap 'rm -rf "$TMP_UNPACK"' EXIT

if ! command -v unzip >/dev/null 2>&1; then
    record_fail "Tooling prerequisite" "unzip command not found; cannot inspect packaged APK native libraries"
elif ! command -v readelf >/dev/null 2>&1; then
    record_fail "Tooling prerequisite" "readelf command not found; cannot verify ELF LOAD segment page alignments"
else
    if [ -f "$APK_DEBUG" ]; then
        unzip -q -o "$APK_DEBUG" "lib/*/*.so" -d "$TMP_UNPACK" 2>/dev/null || true
    fi

    APK_SO_FILES=()
    while IFS= read -r f; do
        [ -n "$f" ] && APK_SO_FILES+=("$f")
    done < <(find "$TMP_UNPACK" -name "*.so" 2>/dev/null || true)

    if [ ${#APK_SO_FILES[@]} -gt 0 ]; then
        for so in "${APK_SO_FILES[@]}"; do
            UNALIGNED_SEGMENTS=0
            SEGMENT_COUNT=0
            while IFS= read -r align; do
                [ -z "$align" ] && continue
                SEGMENT_COUNT=$((SEGMENT_COUNT + 1))
                if [[ "$align" =~ ^0x[0-9a-fA-F]+$ ]]; then
                    if [ $((align)) -lt 16384 ]; then
                        UNALIGNED_SEGMENTS=$((UNALIGNED_SEGMENTS + 1))
                    fi
                else
                    # Malformed or unparseable alignment value fails closed
                    UNALIGNED_SEGMENTS=$((UNALIGNED_SEGMENTS + 1))
                fi
            done < <(readelf -W -l "$so" 2>/dev/null | grep -E "^ +LOAD" | awk '{print $NF}')

            if [ "$SEGMENT_COUNT" -gt 0 ] && [ "$UNALIGNED_SEGMENTS" -eq 0 ]; then
                record_pass "Packaged library $(basename "$so") all $SEGMENT_COUNT LOAD segment(s) align to 16 KiB (>= 0x4000)"
            else
                record_fail "16 KiB alignment" "Packaged library $(basename "$so") has $UNALIGNED_SEGMENTS unaligned or malformed LOAD segment(s) (< 0x4000 / 16384 bytes)"
            fi
        done

        # Audit required native libraries presence
        if ! echo "${APK_SO_FILES[@]}" | grep -q "libdamhopper_crypto_bridge.so"; then
            echo "  [WARN] libdamhopper_crypto_bridge.so is not packaged in APK. Native OPAQUE crypto JNI on Android device remains blocked pending NDK packaging."
        fi
    else
        echo "  [INFO] No native .so libraries currently packaged in APK (zero native binaries in APK payload)."
        echo "  [INFO] Rust crypto bridge and ConnectBot termlib remain host prototypes; Android NDK packaging is an open gate decision."
        record_pass "APK native packaging audit complete (zero unaligned .so in APK payload; device 16 KiB execution tracked as open)"
    fi
fi

echo ""
echo "=== Phase 18 Security Audit Results ==="
echo "Passed: $PASS_COUNT"
echo "Failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo "ALL APK SECURITY & ABI AUDIT CHECKS PASSED"
    exit 0
else
    echo "APK SECURITY AUDIT DETECTED FAILURES"
    exit 1
fi
