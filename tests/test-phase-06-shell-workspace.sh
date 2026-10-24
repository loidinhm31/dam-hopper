#!/usr/bin/env bash
set -euo pipefail

# TERMINAL Traditional Shell, Projects & Config Verification for Phase 06
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

echo "=== Suite 1: TERMINAL & Traditional Shell Invariants (C01-C02, NAV01) ==="
MODEL_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/model/WorkbenchModel.kt"
assert_contains "WorkbenchMode contains sole TERMINAL mode" 'enum class WorkbenchMode {' "$MODEL_FILE"
assert_contains "WorkbenchMode specifies TERMINAL" 'TERMINAL' "$MODEL_FILE"
assert_not_contains "WorkbenchMode forbids IDE mode" 'IDE' "$MODEL_FILE"
assert_contains "TerminalUsageMode specifies TRADITIONAL" 'TRADITIONAL' "$MODEL_FILE"
assert_not_contains "TerminalUsageMode forbids Runtime mode" 'RUNTIME' "$MODEL_FILE"
assert_contains "WorkbenchState enforces single content area" 'val singleContentArea: Boolean = true' "$MODEL_FILE"
assert_contains "WorkbenchState prohibits floating buttons" 'val allowFloatingButtons: Boolean = false' "$MODEL_FILE"

MANIFEST_FILE="native/android-app/androidApp/src/main/AndroidManifest.xml"
assert_contains "Manifest configures adjustResize for IME visibility" 'android:windowSoftInputMode="adjustResize"' "$MANIFEST_FILE"

SHARED_UI_DIR="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui"
if grep -rn "FloatingActionButton" "$SHARED_UI_DIR" 2>/dev/null; then
    echo "  [FAIL] FloatingActionButton found in shared UI"
    FAIL_COUNT=$((FAIL_COUNT + 1))
else
    echo "  [PASS] Zero FloatingActionButtons in shared UI"
    PASS_COUNT=$((PASS_COUNT + 1))
fi

echo "=== Suite 2: PanelRegistry & Single-Row Navigation ==="
PANEL_REGISTRY="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/navigation/PanelRegistry.kt"
assert_contains "PanelRegistry defines Terminal" 'WorkbenchPanel.TERMINAL' "$PANEL_REGISTRY"
assert_contains "PanelRegistry defines Files" 'WorkbenchPanel.FILES' "$PANEL_REGISTRY"
assert_contains "PanelRegistry defines Editor" 'WorkbenchPanel.EDITOR' "$PANEL_REGISTRY"
assert_contains "PanelRegistry defines Diff" 'WorkbenchPanel.DIFF' "$PANEL_REGISTRY"
assert_contains "PanelRegistry defines Merge" 'WorkbenchPanel.MERGE' "$PANEL_REGISTRY"
assert_contains "PanelRegistry defines Git" 'WorkbenchPanel.GIT' "$PANEL_REGISTRY"
assert_contains "PanelRegistry defines Workflow" 'WorkbenchPanel.WORKFLOW' "$PANEL_REGISTRY"
assert_contains "PanelRegistry defines Agents" 'WorkbenchPanel.AGENTS' "$PANEL_REGISTRY"
assert_contains "PanelRegistry defines Resources" 'WorkbenchPanel.RESOURCES' "$PANEL_REGISTRY"
assert_contains "PanelRegistry defines Ports" 'WorkbenchPanel.PORTS' "$PANEL_REGISTRY"
assert_contains "PanelRegistry defines Host Controls" 'WorkbenchPanel.SSH_HOST' "$PANEL_REGISTRY"
assert_contains "PanelRegistry defines Settings" 'WorkbenchPanel.SETTINGS' "$PANEL_REGISTRY"

NAV_ROW="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/navigation/PanelNavigationRow.kt"
assert_contains "PanelNavigationRow uses horizontalScroll" '.horizontalScroll(scrollState)' "$NAV_ROW"
assert_contains "PanelNavigationRow reveals active button" 'bringIntoView' "$NAV_ROW"

PANEL_HOST="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/navigation/PanelHost.kt"
assert_contains "PanelHost renders single content area" 'fun PanelHost(' "$PANEL_HOST"
assert_contains "PanelHost handles all 12 panels" 'WorkbenchPanel.SETTINGS -> settingsContent()' "$PANEL_HOST"

WORKBENCH_NAV="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/navigation/WorkbenchNavigation.kt"
assert_contains "WorkbenchNavigation handles back precedence" 'fun handleBackPress(): Boolean' "$WORKBENCH_NAV"
assert_contains "WorkbenchNavigation returns to TERMINAL on back" 'navigateTo(WorkbenchPanel.TERMINAL)' "$WORKBENCH_NAV"

echo "=== Suite 3: Workspace Repository & Wire Contracts ==="
WS_REPO="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceRepository.kt"
assert_contains "WorkspaceRepository calls /api/workspace/status" '/api/workspace/status' "$WS_REPO"
assert_contains "WorkspaceRepository calls /api/workspace" '/api/workspace' "$WS_REPO"
assert_contains "WorkspaceRepository calls /api/projects" '/api/projects' "$WS_REPO"
assert_contains "WorkspaceRepository encodes project path segment" 'ApiClient.encodePathSegment(project)' "$WS_REPO"
assert_contains "WorkspaceRepository calls /api/git worktrees" '/api/git/$encodedProject/worktrees' "$WS_REPO"
assert_contains "WorkspaceRepository calls /api/workspace/switch" '/api/workspace/switch' "$WS_REPO"
assert_contains "WorkspaceRepository invalidates targetStore on switch" 'targetStore?.invalidateWorkspace(' "$WS_REPO"
assert_contains "WorkspaceRepository deletes known workspace with JSON body" 'apiClient.deleteJson("/api/workspace/known", body)' "$WS_REPO"

API_CLIENT="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ApiClient.kt"
assert_contains "ApiClient implements patchJson" 'suspend fun patchJson(path: String, body: String)' "$API_CLIENT"
assert_contains "ApiClient implements deleteJson" 'suspend fun deleteJson(path: String, body: String)' "$API_CLIENT"
assert_contains "ApiClient implements encodePathSegment" 'fun encodePathSegment(segment: String): String' "$API_CLIENT"

echo "=== Suite 4: ProjectTargetStore Fencing & Target States ==="
TARGET_STORE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectTargetStore.kt"
assert_contains "ProjectTargetStore tracks workspace revision" 'val workspaceRevisionByProfile: Map<String, Long>' "$TARGET_STORE"
assert_contains "ProjectTargetStore provides invalidateWorkspace" 'fun invalidateWorkspace(profileId: ProfileId?, newConfigPath: String?)' "$TARGET_STORE"
assert_contains "ProjectTargetStore provides selectTarget" 'fun selectTarget(' "$TARGET_STORE"
assert_contains "ProjectTargetStore provides markTargetUnavailable" 'fun markTargetUnavailable(' "$TARGET_STORE"
assert_contains "ProjectTargetStore fails closed on unavailable targets" 'isExplicitlyUnavailable -> false to "Target unavailable"' "$TARGET_STORE"
assert_contains "ProjectTargetStore builds structured projectScopeKey" 'fun projectScopeKey(' "$TARGET_STORE"

TARGET_MODELS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceModels.kt"
assert_contains "ProjectWorktree defines isSelectable" 'val isSelectable: Boolean get() = isAvailable && !isPrunable' "$TARGET_MODELS"
assert_contains "ProjectWorktree computes statusLabel" 'val statusLabel: String' "$TARGET_MODELS"
assert_contains "ProjectTargetSnapshot builds structured collision-safe key" 'fun buildStructuredTargetKey(' "$TARGET_MODELS"

echo "=== Suite 5: Remote Config & Conflict-Aware Lossless Editor ==="
CONFIG_REPO="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigRepository.kt"
assert_contains "RemoteConfigRepository gets full config" 'suspend fun getFullConfig()' "$CONFIG_REPO"
assert_contains "RemoteConfigRepository updates full config" 'suspend fun updateFullConfig(fullJson: String)' "$CONFIG_REPO"
assert_contains "RemoteConfigRepository patches project" 'suspend fun patchProject(projectName: String, patchJson: String)' "$CONFIG_REPO"
assert_contains "RemoteConfigRepository updates global UI" 'suspend fun updateGlobalUi(preferences: UiPreferences)' "$CONFIG_REPO"

CONFIG_EDITOR="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditor.kt"
assert_contains "RemoteConfigEditor tracks dirty state" 'isDirty = isDirty' "$CONFIG_EDITOR"
assert_contains "RemoteConfigEditor preserves user draft on refresh" 'conflictingServerJson = newServerJson' "$CONFIG_EDITOR"
assert_contains "RemoteConfigEditor provides discardDraft" 'fun discardDraft()' "$CONFIG_EDITOR"
assert_contains "RemoteConfigEditor provides saveFullConfig" 'suspend fun saveFullConfig()' "$CONFIG_EDITOR"

echo "=== Suite 6: Phase 06 UI & Modals Verification ==="
SCREENS_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceScreens.kt"
assert_contains "ProjectTargetPickerModal implemented" 'fun ProjectTargetPickerModal(' "$SCREENS_FILE"
assert_contains "WorkspaceSwitcherModal implemented" 'fun WorkspaceSwitcherModal(' "$SCREENS_FILE"
assert_contains "WorkspaceSwitchWarningDialog warns about PTY disposal" 'DISPOSES ALL active terminal sessions' "$SCREENS_FILE"

CONFIG_SCREEN="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigScreen.kt"
assert_contains "RemoteConfigScreen displays conflict alert" 'External Conflict Detected' "$CONFIG_SCREEN"
assert_contains "RemoteConfigScreen provides discard and overwrite options" 'Discard Local Draft' "$CONFIG_SCREEN"
assert_contains "RemoteConfigScreen edits UI preferences" 'Global UI Preferences' "$CONFIG_SCREEN"

HEADER_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/WorkbenchHeader.kt"
assert_contains "WorkbenchHeader includes targetLabel" 'targetLabel: String? = null' "$HEADER_FILE"
assert_contains "WorkbenchHeader includes onOpenTargetPicker" 'onOpenTargetPicker: (() -> Unit)? = null' "$HEADER_FILE"
assert_contains "WorkbenchHeader includes onOpenWorkspaceSwitcher" 'onOpenWorkspaceSwitcher: (() -> Unit)? = null' "$HEADER_FILE"

echo ""
echo "=== Phase 06 Shell & Workspace Summary ==="
echo "Total assertions passed: $PASS_COUNT"
echo "Total assertions failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "ERROR: Phase 06 shell and workspace invariants verification failed."
    exit 1
fi

echo "SUCCESS: All Phase 06 shell and workspace invariants verified."
exit 0
