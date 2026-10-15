#!/usr/bin/env bash
set -euo pipefail

# Foundation & Security Verification for Phase 02 (Gradle KMP Android foundation)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PASS_COUNT=0
FAIL_COUNT=0

assert_eq() {
    local desc="$1"
    local expected="$2"
    local actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo "  [PASS] $desc"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo "  [FAIL] $desc (expected '$expected', got '$actual')"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

assert_contains() {
    local desc="$1"
    local pattern="$2"
    local file="$3"
    if grep -q "$pattern" "$file"; then
        echo "  [PASS] $desc"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo "  [FAIL] $desc (pattern '$pattern' not found in $file)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

assert_not_contains() {
    local desc="$1"
    local pattern="$2"
    local file="$3"
    if ! grep -q "$pattern" "$file"; then
        echo "  [PASS] $desc"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo "  [FAIL] $desc (prohibited pattern '$pattern' found in $file)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

echo "=== Suite 1: Wrapper and Toolchain Pins ==="
WRAPPER_PROPS="native-app/gradle/wrapper/gradle-wrapper.properties"
assert_contains "Wrapper URL pins Gradle 8.11.1-bin" "gradle-8.11.1-bin.zip" "$WRAPPER_PROPS"
assert_contains "Wrapper pins official distribution SHA-256" "distributionSha256Sum=f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6" "$WRAPPER_PROPS"

CATALOG="native-app/gradle/libs.versions.toml"
assert_contains "Catalog pins AGP 8.7.3" 'agp = "8.7.3"' "$CATALOG"
assert_contains "Catalog pins Kotlin 2.1.10" 'kotlin = "2.1.10"' "$CATALOG"
assert_contains "Catalog pins Compose Multiplatform 1.7.3" 'compose = "1.7.3"' "$CATALOG"
assert_contains "Catalog pins Coroutines 1.10.1" 'coroutines = "1.10.1"' "$CATALOG"
assert_contains "Catalog pins Ktor 3.1.0" 'ktor = "3.1.0"' "$CATALOG"

echo "=== Suite 2: Architecture & Shell Invariants ==="
SHARED_BUILD="native-app/shared/build.gradle.kts"
assert_contains "Shared module configures androidTarget with JVM 17" "jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)" "$SHARED_BUILD"
assert_contains "Shared module configures jvm target with JVM 17" "jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)" "$SHARED_BUILD"
assert_contains "Shared module enforces minSdk 29" "minSdk = 29" "$SHARED_BUILD"

ANDROID_BUILD="native-app/androidApp/build.gradle.kts"
assert_contains "Android module configures minSdk 29" "minSdk = 29" "$ANDROID_BUILD"
assert_contains "Android module configures compileSdk 35" "compileSdk = 35" "$ANDROID_BUILD"
assert_contains "Android module configures ABI filters arm64-v8a and x86_64" 'setOf("arm64-v8a", "x86_64")' "$ANDROID_BUILD"

MODEL_FILE="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/model/WorkbenchModel.kt"
assert_contains "WorkbenchPanel includes TERMINAL" 'TERMINAL("Terminal", "TERM")' "$MODEL_FILE"
assert_contains "WorkbenchPanel includes FILES" 'FILES("Files", "FS")' "$MODEL_FILE"
assert_contains "WorkbenchPanel includes EDITOR" 'EDITOR("Editor", "EDIT")' "$MODEL_FILE"
assert_contains "WorkbenchPanel includes DIFF" 'DIFF("Diff", "DIFF")' "$MODEL_FILE"
assert_contains "WorkbenchPanel includes MERGE" 'MERGE("Merge", "MRG")' "$MODEL_FILE"
assert_contains "WorkbenchPanel includes GIT" 'GIT("Git", "GIT")' "$MODEL_FILE"
assert_contains "WorkbenchPanel includes WORKFLOW" 'WORKFLOW("Workflow", "FLOW")' "$MODEL_FILE"
assert_contains "WorkbenchPanel includes AGENTS" 'AGENTS("Agents", "AGNT")' "$MODEL_FILE"
assert_contains "WorkbenchPanel includes RESOURCES" 'RESOURCES("Resources", "RES")' "$MODEL_FILE"
assert_contains "WorkbenchPanel includes PORTS" 'PORTS("Ports", "PORT")' "$MODEL_FILE"
assert_contains "WorkbenchPanel includes SSH_HOST" 'SSH_HOST("Host Controls", "HOST")' "$MODEL_FILE"
assert_contains "WorkbenchPanel includes SETTINGS" 'SETTINGS("Settings", "SET")' "$MODEL_FILE"

echo "=== Suite 3: Security & Manifest Policies ==="
MANIFEST="native-app/androidApp/src/main/AndroidManifest.xml"
assert_contains "Manifest disallows application backup" 'android:allowBackup="false"' "$MANIFEST"
assert_contains "Manifest disallows fullBackupContent" 'android:fullBackupContent="false"' "$MANIFEST"
assert_contains "Manifest configures dataExtractionRules" 'android:dataExtractionRules="@xml/data_extraction_rules"' "$MANIFEST"
assert_contains "Manifest configures adjustResize for IME visibility" 'android:windowSoftInputMode="adjustResize"' "$MANIFEST"
assert_contains "Manifest configures networkSecurityConfig" 'android:networkSecurityConfig="@xml/network_security_config"' "$MANIFEST"

MAIN_NET_CONFIG="native-app/androidApp/src/main/res/xml/network_security_config.xml"
assert_contains "Main network security config sets cleartextTrafficPermitted=false" '<base-config cleartextTrafficPermitted="false">' "$MAIN_NET_CONFIG"
assert_not_contains "Main network security config strictly disallows cleartext" 'cleartextTrafficPermitted="true"' "$MAIN_NET_CONFIG"

DEBUG_NET_CONFIG="native-app/androidApp/src/debug/res/xml/network_security_config.xml"
assert_contains "Debug network security config permits local development loopback" '<domain includeSubdomains="true">10.0.2.2</domain>' "$DEBUG_NET_CONFIG"

EXTRACTION_RULES="native-app/androidApp/src/main/res/xml/data_extraction_rules.xml"
assert_contains "Data extraction rules configure cloud-backup" '<cloud-backup>' "$EXTRACTION_RULES"
assert_contains "Data extraction rules configure device-transfer" '<device-transfer>' "$EXTRACTION_RULES"
assert_contains "Data extraction rules exclude root domain" 'domain="root" path="."' "$EXTRACTION_RULES"
assert_contains "Data extraction rules exclude file domain" 'domain="file" path="."' "$EXTRACTION_RULES"
assert_contains "Data extraction rules exclude database domain" 'domain="database" path="."' "$EXTRACTION_RULES"
assert_contains "Data extraction rules exclude sharedpref domain" 'domain="sharedpref" path="."' "$EXTRACTION_RULES"
assert_contains "Data extraction rules exclude external domain" 'domain="external" path="."' "$EXTRACTION_RULES"

echo "=== Suite 4: Prohibited Dependencies & Web Engine Exclusion ==="
WEBVIEW_OCCURRENCES=$(grep -rn "WebView" native-app/shared/src/ native-app/androidApp/src/main/ 2>/dev/null || true)
if [ -z "$WEBVIEW_OCCURRENCES" ]; then
    echo "  [PASS] Zero WebView occurrences in native-app source code"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo "  [FAIL] WebView occurrences detected in native-app source code: $WEBVIEW_OCCURRENCES"
    FAIL_COUNT=$((FAIL_COUNT + 1))
fi

TAURI_OCCURRENCES=$(grep -rn "tauri" native-app/shared/ native-app/androidApp/ 2>/dev/null || true)
if [ -z "$TAURI_OCCURRENCES" ]; then
    echo "  [PASS] Zero Tauri occurrences in native-app source code"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo "  [FAIL] Tauri occurrences detected in native-app source code: $TAURI_OCCURRENCES"
    FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo "=== Suite 5: Package.json Scripts Invariant ==="
assert_contains "package.json provides native-app:test" '"native-app:test":' "package.json"
assert_contains "package.json provides native-app:test:android" '"native-app:test:android":' "package.json"
assert_contains "package.json provides native-app:assembleDebug" '"native-app:assembleDebug":' "package.json"
assert_contains "package.json preserves existing android:dev Tauri script" '"android:dev":' "package.json"
assert_not_contains "package.json does not hardcode user-specific paths" '/home/loidinh' "package.json"

echo "============================================="
echo "Total assertions passed: $PASS_COUNT"
echo "Total assertions failed: $FAIL_COUNT"
if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "Phase 02 Foundation verification FAILED!"
    exit 1
fi
echo "Phase 02 Foundation verification PASSED (100%)"
