#!/usr/bin/env bash
set -euo pipefail

# Phase 18 Integrated Device Security & Performance Qualification Invariant Tests
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PASS_COUNT=0
FAIL_COUNT=0

assert_contains() {
    local desc="$1"
    local pattern="$2"
    local file="$3"
    if grep -Fq "$pattern" "$file"; then
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
    if ! grep -Fq "$pattern" "$file"; then
        echo "  [PASS] $desc"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo "  [FAIL] $desc (prohibited pattern '$pattern' found in $file)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

assert_file_exists() {
    local desc="$1"
    local file="$2"
    if [ -f "$file" ]; then
        echo "  [PASS] $desc"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo "  [FAIL] $desc (file '$file' does not exist)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

assert_executable() {
    local desc="$1"
    local file="$2"
    if [ -x "$file" ]; then
        echo "  [PASS] $desc"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo "  [FAIL] $desc (file '$file' is not executable)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

echo "=== Suite 1: Core Qualification Suites & Journeys ==="
OWNERSHIP_TEST="native/android-app/shared/src/commonTest/kotlin/dev/damhopper/nativeapp/OwnershipAndReplayTests.kt"
assert_file_exists "OwnershipAndReplayTests exists in commonTest" "$OWNERSHIP_TEST"
assert_contains "Profile isolation test declared" "fun testMultiServerProfileIsolationAndWatermarkRejection" "$OWNERSHIP_TEST"
assert_contains "UTF-8 chunk splitting test declared" "fun testTerminalReplayGateUtf8SplittingAcrossChunkBoundaries" "$OWNERSHIP_TEST"
assert_contains "Terminal replay ordering and duplicate test declared" "fun testTerminalReplayGateOrderingDuplicateAndOverlapSlicing" "$OWNERSHIP_TEST"
assert_contains "Clean SSE stream EOF test declared" "fun testResourceStreamCoordinatorCleanEofHandling" "$OWNERSHIP_TEST"
assert_contains "5s REST fallback interval test declared" "fun testHostResourceRestFallbackIntervalAlignedToFiveSeconds" "$OWNERSHIP_TEST"
assert_contains "UTC interval calculations and formatting test declared" "fun testUsageBoundsHelperUtcIntervalCalculationsAndFormatting" "$OWNERSHIP_TEST"
assert_contains "Crypto tamper rejection fail-closed test declared" "fun testCryptoEnvelopeTamperRejectionFailsClosed" "$OWNERSHIP_TEST"
assert_contains "Lifecycle state machine transitions test declared" "fun testLifecycleCoordinatorStateTransitionsAndRetirement" "$OWNERSHIP_TEST"

JOURNEYS_UNIT="native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/WorkbenchJourneysUnitTest.kt"
assert_file_exists "WorkbenchJourneysUnitTest exists in androidApp unit tests" "$JOURNEYS_UNIT"
assert_contains "Complete 12-panel journey test declared" "fun testCompleteTwelvePanelNavigationJourney" "$JOURNEYS_UNIT"
assert_contains "Top navigation row invariants test declared" "fun testSolitaryTopNavigationRowInvariants" "$JOURNEYS_UNIT"
assert_contains "Zero FABs across entire app test declared" "fun testZeroFloatingActionButtonsAcrossEntireRepository" "$JOURNEYS_UNIT"
assert_contains "Zero WebViews across entire app test declared" "fun testZeroWebViewsAcrossEntireApplication" "$JOURNEYS_UNIT"
assert_contains "Cognito privacy overlay input gating test declared" "fun testCognitoPrivacyOverlayInputGatingAndDismissal" "$JOURNEYS_UNIT"
assert_contains "Navigation stack hierarchical unwinding test declared" "fun testNavigationStackHierarchicalUnwinding" "$JOURNEYS_UNIT"

JOURNEYS_DEVICE="native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/WorkbenchJourneys.kt"
assert_file_exists "WorkbenchJourneys device instrumentation test exists in androidApp" "$JOURNEYS_DEVICE"
assert_contains "Instrumentation runner annotation present" "@RunWith(AndroidJUnit4::class)" "$JOURNEYS_DEVICE"
assert_contains "Device application context test declared" "fun testApplicationContextAndPackageIdentity" "$JOURNEYS_DEVICE"
assert_contains "Device workbench state invariants test declared" "fun testWorkbenchDeviceStateInvariants" "$JOURNEYS_DEVICE"
assert_contains "Complete 12-panel on-device journey declared" "fun testCompleteTwelvePanelJourneyOnDevice" "$JOURNEYS_DEVICE"
assert_contains "Cognito overlay on device runtime declared" "fun testCognitoPrivacyOverlayOnDeviceRuntime" "$JOURNEYS_DEVICE"

echo "=== Suite 2: Automation & Security Tooling ==="
DEVICE_SCRIPT="native/android-app/scripts/run-device-journeys.sh"
assert_file_exists "run-device-journeys.sh script exists" "$DEVICE_SCRIPT"
assert_executable "run-device-journeys.sh is executable" "$DEVICE_SCRIPT"
assert_contains "Script handles missing ADB" "ADB command not found in PATH" "$DEVICE_SCRIPT"
assert_contains "Script reports honest blocked status" "BLOCKED_PENDING_DEVICE" "$DEVICE_SCRIPT"
assert_contains "Script configures reverse port forwarding" "reverse tcp:4801 tcp:4801" "$DEVICE_SCRIPT"
assert_contains "Script executes connectedDebugAndroidTest" "connectedDebugAndroidTest" "$DEVICE_SCRIPT"

AUDIT_SCRIPT="native/android-app/scripts/audit-apk-security.sh"
assert_file_exists "audit-apk-security.sh script exists" "$AUDIT_SCRIPT"
assert_executable "audit-apk-security.sh is executable" "$AUDIT_SCRIPT"
assert_contains "Manifest allowBackup check present" "android:allowBackup=\"false\"" "$AUDIT_SCRIPT"
assert_contains "Manifest fullBackupContent check present" "android:fullBackupContent=\"false\"" "$AUDIT_SCRIPT"
assert_contains "Manifest adjustResize check present" "android:windowSoftInputMode=\"adjustResize\"" "$AUDIT_SCRIPT"
assert_contains "Release TLS-only network security check present" "cleartextTrafficPermitted=\"false\"" "$AUDIT_SCRIPT"
assert_contains "Debug loopback network security check present" "10.0.2.2" "$AUDIT_SCRIPT"
assert_contains "Secret leak pattern scan present" "BEGIN PRIVATE KEY" "$AUDIT_SCRIPT"
assert_contains "ABI filters check present" "arm64-v8a" "$AUDIT_SCRIPT"
assert_contains "16 KiB page size check present" "16 KiB" "$AUDIT_SCRIPT"

echo "=== Suite 3: Cross-Phase Residual Remediations ==="
STREAM_COORD="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourceStreamCoordinator.kt"
assert_contains "SSE stream clean EOF handling declared" "SSE stream completed (EOF)" "$STREAM_COORD"

HOST_CTRL="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostResourceController.kt"
assert_contains "REST fallback interval aligned to 5s" "REST_FALLBACK_INTERVAL_MS = 5_000L" "$HOST_CTRL"
assert_contains "HostResourceController implements LifecycleAware" ": LifecycleAware" "$HOST_CTRL"
assert_contains "onForeground lifecycle hook implemented" "override fun onForeground()" "$HOST_CTRL"
assert_contains "onBackground lifecycle hook implemented" "override fun onBackground()" "$HOST_CTRL"
assert_contains "onOwnerRetired lifecycle hook implemented" "override fun onOwnerRetired(" "$HOST_CTRL"

USAGE_MODELS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageModels.kt"
assert_contains "formatUtcDate helper declared in UsageBoundsHelper" "fun formatUtcDate(epochMs: Long): String" "$USAGE_MODELS"

USAGE_DIALOGS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageDialogs.kt"
assert_contains "Readable UTC bounds rendered in delete dialog" "UsageBoundsHelper.formatUtcDate(fromUtc)" "$USAGE_DIALOGS"
assert_contains "Completed UTC days explicitly labeled" "Completed UTC days [from, to):" "$USAGE_DIALOGS"

USAGE_SCREENS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageScreens.kt"
assert_contains "Dynamic model filter derivation from sessions" "val dynamicModels = remember(uiState.knownModels, uiState.sessions)" "$USAGE_SCREENS"

USAGE_SETTINGS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageSettingsSection.kt"
assert_contains "onUpdateSettings callback declared" "onUpdateSettings: (SettingsPatchRequest) -> Unit" "$USAGE_SETTINGS"
assert_contains "Collector enabled update wired" "onUpdateSettings(SettingsPatchRequest(enabled = !isCollectorActive))" "$USAGE_SETTINGS"
assert_contains "Retention presets wired" "detailRetentionDays = days" "$USAGE_SETTINGS"
assert_contains "Retry collector action wired" "retryCollector = true" "$USAGE_SETTINGS"

IDLE_CTRL="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/IdleConsentController.kt"
assert_contains "refreshStatus preserves action error parameter" "refreshStatus(preserveActionError: Boolean = false)" "$IDLE_CTRL"
assert_contains "requestForceSuspend preserves action error" "refreshStatus(preserveActionError = true)" "$IDLE_CTRL"

SSH_REPO="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/SshRepository.kt"
assert_contains "forgetCredential validates result.success" "if (!result.success) {" "$SSH_REPO"

THEME_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/NativeTheme.kt"
assert_contains "NativeTheme supports WorkbenchTheme parameter" "theme: WorkbenchTheme = WorkbenchTheme.DARK" "$THEME_FILE"
assert_contains "High contrast color scheme declared" "HighContrastColorScheme" "$THEME_FILE"

SETTINGS_MODELS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsModels.kt"
assert_contains "HIGH_CONTRAST theme enum variant declared" "HIGH_CONTRAST" "$SETTINGS_MODELS"

TERM_SCREENS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalScreens.kt"
assert_contains "TerminalPanelScreen accepts fontSize parameter" "fontSize: Int = 13" "$TERM_SCREENS"

EDITOR_SCREENS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorScreens.kt"
assert_contains "EditorPanelScreen accepts fontSize parameter" "fontSize: Int = 14" "$EDITOR_SCREENS"

EDITOR_VIEW="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/NativeTextEditorView.kt"
assert_contains "NativeTextEditorView accepts fontSize parameter" "fontSize: Int = 14" "$EDITOR_VIEW"

WORKBENCH_SCREEN="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt"
assert_contains "WorkbenchScreen wraps UI in NativeTheme with preferences theme" "NativeTheme(theme = workbenchPreferences.theme)" "$WORKBENCH_SCREEN"
assert_contains "TerminalPanelScreen passed terminalFontSize preference" "fontSize = workbenchPreferences.terminalFontSize" "$WORKBENCH_SCREEN"
assert_contains "EditorPanelScreen passed editorFontSize preference" "fontSize = workbenchPreferences.editorFontSize" "$WORKBENCH_SCREEN"

echo "=== Suite 4: Acceptance Ledger Updates ==="
LEDGER="docs/android-native-acceptance.md"
assert_contains "Phase 17 baseline section present in acceptance ledger" "7.20 Phase 17 Preferences, Privacy, Notifications and Lifecycle Baseline" "$LEDGER"
assert_contains "Phase 18 qualification baseline section present in acceptance ledger" "7.21 Phase 18 Integrated Device Security and Performance Qualification Baseline" "$LEDGER"
assert_contains "Phase 17 recorded in Gate Approvals" "Phase 17 (Preferences, Privacy, Notifications & Lifecycle):** **IMPLEMENTATION BASELINE RECORDED**" "$LEDGER"
assert_contains "GATE-C qualification status recorded in Gate Approvals" "GATE-C (Integrated Qualification):** **QUALIFICATION TOOLING & SUITES DELIVERED" "$LEDGER"

echo "=== Suite 5: Zero FABs and Zero WebViews in Phase 18 Production Files ==="
PHASE18_PROD_FILES=(
    "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourceStreamCoordinator.kt"
    "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostResourceController.kt"
    "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageModels.kt"
    "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageScreens.kt"
    "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageSettingsSection.kt"
    "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageDialogs.kt"
    "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/IdleConsentController.kt"
    "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/SshRepository.kt"
    "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/NativeTheme.kt"
    "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt"
)

for f in "${PHASE18_PROD_FILES[@]}"; do
    base=$(basename "$f")
    assert_not_contains "Zero FloatingActionButton in $base" "FloatingActionButton" "$f"
    assert_not_contains "Zero ExtendedFloatingActionButton in $base" "ExtendedFloatingActionButton" "$f"
    assert_not_contains "Zero WebView in $base" "android.webkit.WebView" "$f"
done

echo ""
echo "=== Phase 18 Invariant Test Results ==="
echo "Passed: $PASS_COUNT"
echo "Failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo "ALL PHASE 18 INVARIANT CHECKS PASSED"
    exit 0
else
    echo "PHASE 18 INVARIANT CHECKS FAILED"
    exit 1
fi
