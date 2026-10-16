#!/usr/bin/env bash
set -euo pipefail

# Preferences, Privacy, Notifications, and Lifecycle Invariant Test for Phase 17 (C02–C03, N01, V01)
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

echo "=== Suite 1: Settings and Preferences Models & Clamping ==="
SETTINGS_MODELS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsModels.kt"

assert_contains "WorkbenchPreferences declared" "data class WorkbenchPreferences(" "$SETTINGS_MODELS"
assert_contains "WorkbenchTheme declared" "enum class WorkbenchTheme" "$SETTINGS_MODELS"
assert_contains "CognitoModeStyle declared" "enum class CognitoModeStyle" "$SETTINGS_MODELS"
assert_contains "ExplorerLanguageFilter declared" "enum class ExplorerLanguageFilter" "$SETTINGS_MODELS"
assert_contains "PreferenceSourceStatus declared" "enum class PreferenceSourceStatus" "$SETTINGS_MODELS"
assert_contains "SettingsSourceTargetState declared" "data class SettingsSourceTargetState(" "$SETTINGS_MODELS"
assert_contains "SettingsImportResult declared" "data class SettingsImportResult(" "$SETTINGS_MODELS"
assert_contains "1 MiB import ceiling constant" "MAX_CONFIG_IMPORT_BYTES = 1024L * 1024L" "$SETTINGS_MODELS"
assert_contains "Font min bound constant" "const val FONT_MIN = 10" "$SETTINGS_MODELS"
assert_contains "Font max bound constant" "const val FONT_MAX = 32" "$SETTINGS_MODELS"
assert_contains "Scroll step clamp helper" "fun clampScrollStep" "$SETTINGS_MODELS"
assert_contains "TerminalAgentNotifications declared" "data class TerminalAgentNotifications(" "$SETTINGS_MODELS"

echo "=== Suite 2: Settings Repository, Multi-Source & TOML Import/Export ==="
SETTINGS_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsRepository.kt"
PREF_STORE="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/PreferencesStore.kt"
API_CLIENT="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ApiClient.kt"

assert_contains "PreferencesStore interface declared" "interface PreferencesStore" "$PREF_STORE"
assert_contains "SettingsRepository class declared" "class SettingsRepository(" "$SETTINGS_REPO"
assert_contains "updatePreferences declared" "fun updatePreferences(" "$SETTINGS_REPO"
assert_contains "switchPreferenceSource declared" "suspend fun switchPreferenceSource(" "$SETTINGS_REPO"
assert_contains "setSettingsTarget declared" "fun setSettingsTarget(" "$SETTINGS_REPO"
assert_contains "onProfileRemoved declared" "fun onProfileRemoved(" "$SETTINGS_REPO"
assert_contains "exportWorkspaceToml declared" "suspend fun exportWorkspaceToml(" "$SETTINGS_REPO"
assert_contains "importWorkspaceToml declared" "suspend fun importWorkspaceToml(" "$SETTINGS_REPO"
assert_contains "1 MiB size guard in import" "bytes.size > MAX_CONFIG_IMPORT_BYTES" "$SETTINGS_REPO"
assert_contains "Target generation validation check" "client.connection.generation != expectedGeneration" "$SETTINGS_REPO"
assert_contains "Export route path" '"/api/settings/export/workspace.toml"' "$SETTINGS_REPO"
assert_contains "Import route path" '"/api/settings/import/workspace.toml"' "$SETTINGS_REPO"
assert_contains "postToml declared in ApiClient" "suspend fun postToml(" "$API_CLIENT"

echo "=== Suite 3: Ephemeral Cognito Privacy Controller & Overlay ==="
PRIVACY_CTRL="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/security/PrivacyController.kt"
COGNITO_OVERLAY="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/CognitoOverlay.kt"
TERM_SESSION="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt"
TERM_INPUT="native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/terminal/TerminalInputController.kt"
EDITOR_SESSION="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt"
EDITOR_TABS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt"

assert_contains "PrivacyController declared" "class PrivacyController" "$PRIVACY_CTRL"
assert_contains "isMaskActive flow" "val isMaskActive: StateFlow<Boolean>" "$PRIVACY_CTRL"
assert_contains "activationChord flow" "val activationChord: StateFlow<String?>" "$PRIVACY_CTRL"
assert_contains "isInputAllowed declared" "fun isInputAllowed(): Boolean" "$PRIVACY_CTRL"
assert_contains "dismissWithChord declared" "fun dismissWithChord(" "$PRIVACY_CTRL"
assert_contains "dismissTouchEmergency declared" "fun dismissTouchEmergency()" "$PRIVACY_CTRL"
assert_contains "consumeTrailingRelease declared" "fun consumeTrailingRelease()" "$PRIVACY_CTRL"
assert_contains "CognitoOverlay composable declared" "fun CognitoOverlay(" "$COGNITO_OVERLAY"
assert_contains "Accessibility suppression while masked" "Modifier.semantics { invisibleToUser() }" "$COGNITO_OVERLAY"
assert_contains "Pointer event consumption in overlay" "event.changes.forEach { it.consume() }" "$COGNITO_OVERLAY"
assert_contains "TerminalSessionController input allowed check" "if (!isInputAllowed()) return" "$TERM_SESSION"
assert_contains "TerminalInputController input allowed check" "!sessionController.isInputAllowed()" "$TERM_INPUT"
assert_contains "EditorSession input allowed check" "if (isReadOnly || !isInputAllowed()) return" "$EDITOR_SESSION"
assert_contains "EditorTabsState isInputAllowed wired" "session.isInputAllowed = { isInputAllowed() }" "$EDITOR_TABS"
assert_contains "AndroidEditorSurface isInputAllowed check" "!isInputAllowed()" "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt"

echo "=== Suite 4: Notification Sink & Privacy Redaction ==="
NOTIF_SINK="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/notifications/NotificationSink.kt"
ANDROID_NOTIF_SINK="native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/notifications/AndroidNotificationSink.kt"

assert_contains "NotificationSink interface declared" "interface NotificationSink" "$NOTIF_SINK"
assert_contains "NotificationChannelId enum declared" "enum class NotificationChannelId" "$NOTIF_SINK"
assert_contains "channel_terminal_attention declared" "channel_terminal_attention" "$NOTIF_SINK"
assert_contains "channel_transfers declared" "channel_transfers" "$NOTIF_SINK"
assert_contains "channel_idle_suspend declared" "channel_idle_suspend" "$NOTIF_SINK"
assert_contains "AndroidNotificationSink declared" "class AndroidNotificationSink(" "$ANDROID_NOTIF_SINK"
assert_contains "Lockscreen privacy visibility set" "Notification.VISIBILITY_PRIVATE" "$ANDROID_NOTIF_SINK"
assert_contains "Public generic notification set" "setPublicVersion(publicNotification)" "$ANDROID_NOTIF_SINK"
assert_contains "Profile notifications cancellation" "fun cancelNotificationsForProfile(" "$ANDROID_NOTIF_SINK"
assert_contains "Deep link EXTRA_TARGET_PROFILE_ID" "EXTRA_TARGET_PROFILE_ID" "$ANDROID_NOTIF_SINK"
assert_contains "Deep link EXTRA_TARGET_GENERATION" "EXTRA_TARGET_GENERATION" "$ANDROID_NOTIF_SINK"
assert_contains "AndroidManifest declares POST_NOTIFICATIONS" 'android.permission.POST_NOTIFICATIONS' "native-app/androidApp/src/main/AndroidManifest.xml"
assert_contains "NotificationsView checks areNotificationsEnabled" "areNotificationsEnabled" "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/NotificationsView.kt"

echo "=== Suite 5: Lifecycle Coordination & Process Recreation ==="
LIFECYCLE_COORD="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/lifecycle/LifecycleCoordinator.kt"
ANDROID_LIFECYCLE="native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/lifecycle/AndroidLifecycleCoordinator.kt"
ANDROID_PREFS="native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidPreferencesStore.kt"
WORKBENCH_SCREEN="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt"

assert_contains "LifecycleCoordinator declared" "class LifecycleCoordinator" "$LIFECYCLE_COORD"
assert_contains "LifecycleAware interface declared" "interface LifecycleAware" "$LIFECYCLE_COORD"
assert_contains "LifecycleState enum declared" "enum class LifecycleState" "$LIFECYCLE_COORD"
assert_contains "AndroidLifecycleCoordinator declared" "class AndroidLifecycleCoordinator(" "$ANDROID_LIFECYCLE"
assert_contains "DefaultLifecycleObserver implemented" ": DefaultLifecycleObserver" "$ANDROID_LIFECYCLE"
assert_contains "AndroidPreferencesStore declared" "class AndroidPreferencesStore(" "$ANDROID_PREFS"
assert_contains "Preferences key constant" "damhopper_workbench_preferences" "$ANDROID_PREFS"
assert_contains "Source target key constant" "damhopper_settings_source_target" "$ANDROID_PREFS"
assert_contains "WorkbenchScreen registers LifecycleAware" "val listener = object : LifecycleAware" "$WORKBENCH_SCREEN"
assert_contains "WorkbenchScreen onProfileRetired calls onProfileRemoved" "settingsRepository.onProfileRemoved" "$WORKBENCH_SCREEN"

echo "=== Suite 6: UI Presentation & Workbench Invariants ==="
SETTINGS_SCREENS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsScreens.kt"
WORKBENCH_SCREEN="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt"
MAIN_ACTIVITY="native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt"
SETTINGS_DIR="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings"

assert_contains "SettingsScreens declared" "fun SettingsScreens(" "$SETTINGS_SCREENS"
assert_contains "WorkbenchScreen integrates SettingsScreens" "SettingsScreens(" "$WORKBENCH_SCREEN"
assert_contains "WorkbenchScreen integrates CognitoOverlay" "CognitoOverlay(" "$WORKBENCH_SCREEN"
assert_contains "MainActivity adds lifecycle observer" "lifecycle.addObserver(lifecycleCoordinator)" "$MAIN_ACTIVITY"
assert_contains "MainActivity handles deep links" "handleDeepLink(intent)" "$MAIN_ACTIVITY"

# Check Zero FABs and Zero WebViews in Settings features directory
for f in $(find "$SETTINGS_DIR" -name "*.kt"); do
    assert_not_contains "Zero FloatingActionButton in $(basename "$f")" "FloatingActionButton" "$f"
    assert_not_contains "Zero ExtendedFloatingActionButton in $(basename "$f")" "ExtendedFloatingActionButton" "$f"
    assert_not_contains "Zero WebView in $(basename "$f")" "android.webkit.WebView" "$f"
done

echo ""
echo "=== Phase 17 Invariant Test Results ==="
echo "Passed: $PASS_COUNT"
echo "Failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "TEST SUITE FAILED"
    exit 1
fi
echo "ALL PHASE 17 INVARIANT CHECKS PASSED"
