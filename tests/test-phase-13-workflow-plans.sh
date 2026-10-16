#!/usr/bin/env bash
set -euo pipefail

# Workflow Tracking and Project Plans Invariant Test for Phase 13 (W01, W02)
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

echo "=== Suite 1: Workflow Models & DTO Contracts (W01) ==="
WF_MODELS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowModels.kt"
assert_contains "ItemKind enum declared" "enum class ItemKind" "$WF_MODELS"
assert_contains "ItemStatus enum declared" "enum class ItemStatus" "$WF_MODELS"
assert_contains "SessionStatus enum declared" "enum class SessionStatus" "$WF_MODELS"
assert_contains "ResourceLinkType enum declared" "enum class ResourceLinkType" "$WF_MODELS"
assert_contains "ResourceObservedState enum declared" "enum class ResourceObservedState" "$WF_MODELS"
assert_contains "WorkflowSource enum declared" "enum class WorkflowSource" "$WF_MODELS"
assert_contains "ItemDto declared" "data class ItemDto(" "$WF_MODELS"
assert_contains "SessionDto declared" "data class SessionDto(" "$WF_MODELS"
assert_contains "LinkDto declared" "data class LinkDto(" "$WF_MODELS"
assert_contains "NoteDto declared" "data class NoteDto(" "$WF_MODELS"
assert_contains "EventDto declared with nullable target" "val target: WorkflowTargetDto? = null" "$WF_MODELS"
assert_contains "WorkflowOverviewDto declared" "data class WorkflowOverviewDto(" "$WF_MODELS"
assert_contains "WorkflowEventsDto declared" "data class WorkflowEventsDto(" "$WF_MODELS"
assert_contains "PurgeDto declared" "data class PurgeDto(" "$WF_MODELS"
assert_contains "MutationDto declared" "data class MutationDto<T>(" "$WF_MODELS"
assert_contains "TombstoneDto declared" "data class TombstoneDto(" "$WF_MODELS"
assert_contains "CreateItemRequest declared" "data class CreateItemRequest(" "$WF_MODELS"
assert_contains "PatchItemRequest declared" "data class PatchItemRequest(" "$WF_MODELS"
assert_contains "PatchItemRequestSerializer custom serializer declared" "object PatchItemRequestSerializer : KSerializer<PatchItemRequest>" "$WF_MODELS"
assert_contains "DeleteItemRequest declared" "data class DeleteItemRequest(" "$WF_MODELS"
assert_contains "CreateSessionRequest declared" "data class CreateSessionRequest(" "$WF_MODELS"
assert_contains "EndSessionRequest declared" "data class EndSessionRequest(" "$WF_MODELS"
assert_contains "AbandonSessionRequest declared" "data class AbandonSessionRequest(" "$WF_MODELS"
assert_contains "LinkResourceRequest declared" "data class LinkResourceRequest(" "$WF_MODELS"
assert_contains "UnlinkResourceRequest declared" "data class UnlinkResourceRequest(" "$WF_MODELS"
assert_contains "CreateNoteRequest declared" "data class CreateNoteRequest(" "$WF_MODELS"
assert_contains "DeleteNoteRequest declared" "data class DeleteNoteRequest(" "$WF_MODELS"
assert_contains "PurgeHistoryRequest declared" "data class PurgeHistoryRequest(" "$WF_MODELS"
assert_contains "WorkflowDomainHelpers object declared" "object WorkflowDomainHelpers" "$WF_MODELS"
assert_contains "Hierarchy validation helper" "fun isValidParentKind(" "$WF_MODELS"
assert_contains "Status transition helper" "fun isValidStatusTransition(" "$WF_MODELS"
assert_contains "Tracked tasks progress format helper" "fun formatTrackedTasksProgress(" "$WF_MODELS"
assert_contains "Exact in_progress enum spelling" "@SerialName(\"in_progress\")" "$WF_MODELS"
assert_contains "Exact canceled enum spelling" "@SerialName(\"canceled\")" "$WF_MODELS"

echo "=== Suite 2: Workflow Repository & REST Contracts (W01) ==="
WF_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowRepository.kt"
assert_contains "WorkflowRepository class declared" "class WorkflowRepository(" "$WF_REPO"
assert_contains "getOverview method declared" "suspend fun getOverview(): Result<WorkflowOverviewResult>" "$WF_REPO"
assert_contains "Overview 404 detection for unavailable feature" "if (e.status == 404) {" "$WF_REPO"
assert_contains "Overview unavailable message declared" "Workflow tracking is unavailable for this profile." "$WF_REPO"
assert_contains "getEvents method declared" "suspend fun getEvents(" "$WF_REPO"
assert_contains "createItem method declared" "suspend fun createItem(" "$WF_REPO"
assert_contains "patchItem method declared" "suspend fun patchItem(" "$WF_REPO"
assert_contains "deleteItem method declared" "suspend fun deleteItem(" "$WF_REPO"
assert_contains "createSession method declared" "suspend fun createSession(" "$WF_REPO"
assert_contains "endSession method declared" "suspend fun endSession(" "$WF_REPO"
assert_contains "abandonSession method declared" "suspend fun abandonSession(" "$WF_REPO"
assert_contains "linkResource method declared" "suspend fun linkResource(" "$WF_REPO"
assert_contains "unlinkResource method declared" "suspend fun unlinkResource(" "$WF_REPO"
assert_contains "createNote method declared" "suspend fun createNote(" "$WF_REPO"
assert_contains "deleteNote method declared" "suspend fun deleteNote(" "$WF_REPO"
assert_contains "purgeHistory method declared" "suspend fun purgeHistory(" "$WF_REPO"
assert_contains "UUID v4 generation helper" "fun generateUuid(): String" "$WF_REPO"

echo "=== Suite 3: Project Plans Models & DTOs (W02) ==="
PLAN_MODELS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/ProjectPlanModels.kt"
assert_contains "PlanConstants declared" "object PlanConstants" "$PLAN_MODELS"
assert_contains "64 KiB MAX_DOCUMENT_BYTES ceiling declared" "const val MAX_DOCUMENT_BYTES = 64 * 1024" "$PLAN_MODELS"
assert_contains "PlanStatus enum declared" "enum class PlanStatus" "$PLAN_MODELS"
assert_contains "Exact in-progress plan status spelling" "@SerialName(\"in-progress\")" "$PLAN_MODELS"
assert_contains "Exact cancelled plan status spelling" "@SerialName(\"cancelled\")" "$PLAN_MODELS"
assert_contains "PlanAuthority enum declared" "enum class PlanAuthority" "$PLAN_MODELS"
assert_contains "PlanDocumentState enum declared" "enum class PlanDocumentState" "$PLAN_MODELS"
assert_contains "PlanFolderKind enum declared" "enum class PlanFolderKind" "$PLAN_MODELS"
assert_contains "PlanFolderState enum declared" "enum class PlanFolderState" "$PLAN_MODELS"
assert_contains "FilePlan declared" "data class FilePlan(" "$PLAN_MODELS"
assert_contains "FilePlanPhase declared" "data class FilePlanPhase(" "$PLAN_MODELS"
assert_contains "ReportedStatus declared" "data class ReportedStatus(" "$PLAN_MODELS"
assert_contains "PlanCompletion declared" "data class PlanCompletion(" "$PLAN_MODELS"
assert_contains "PlanFoldersResponse declared" "data class PlanFoldersResponse(" "$PLAN_MODELS"
assert_contains "SelectedPlanResponse declared" "data class SelectedPlanResponse(" "$PLAN_MODELS"

echo "=== Suite 4: Project Plans Repository & Bounded Document Reads (W02) ==="
PLAN_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/ProjectPlansRepository.kt"
assert_contains "ProjectPlansRepository class declared" "class ProjectPlansRepository(" "$PLAN_REPO"
assert_contains "getPlanFolders endpoint call" "\"/api/plans/folders\"" "$PLAN_REPO"
assert_contains "getSelectedPlan endpoint call" "\"/api/plans\"" "$PLAN_REPO"
assert_contains "planPath camelCase query parameter" "\"planPath\" to planPath" "$PLAN_REPO"
assert_contains "Path traversal checking rejects segment .." "it == \"..\"" "$PLAN_REPO"
assert_contains "Absolute path checking rejects /" "normalized.startsWith(\"/\")" "$PLAN_REPO"
assert_contains "External URL rejection" "normalized.startsWith(\"https://\")" "$PLAN_REPO"
assert_contains "Bounded read uses MAX_DOCUMENT_BYTES" "val maxBytes = PlanConstants.MAX_DOCUMENT_BYTES" "$PLAN_REPO"
assert_contains "Oversize result on exceeding bound" "PlanDocumentReadResult.Oversize(byteSize)" "$PLAN_REPO"

echo "=== Suite 5: Controllers, UI Surfaces, and Invariants (NAV01, B01, B02) ==="
WF_CTRL="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowController.kt"
assert_contains "WorkflowController declared" "class WorkflowController(" "$WF_CTRL"
assert_contains "CAS conflict warning preservation" "Item was modified remotely. Your draft was preserved." "$WF_CTRL"
assert_contains "Generation fencing updateContext" "fun updateContext(" "$WF_CTRL"

PLAN_CTRL="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/ProjectPlansController.kt"
assert_contains "ProjectPlansController declared" "class ProjectPlansController(" "$PLAN_CTRL"
assert_contains "handleBack hierarchical navigation" "fun handleBack(): Boolean" "$PLAN_CTRL"
assert_contains "updateTarget method declared" "fun updateTarget(" "$PLAN_CTRL"
assert_contains "Auto open plan on PLAN kind folder" "selectPlan(response.path)" "$PLAN_CTRL"

PANEL_SCREEN="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowPanelScreen.kt"
assert_contains "WorkflowSubProduct enum declared" "enum class WorkflowSubProduct" "$PANEL_SCREEN"
assert_contains "WorkflowPanelScreen Composable declared" "fun WorkflowPanelScreen(" "$PANEL_SCREEN"
assert_not_contains "Zero FABs in WorkflowPanelScreen" "FloatingActionButton" "$PANEL_SCREEN"

WF_SCREENS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowScreens.kt"
assert_not_contains "Zero FABs in WorkflowScreens" "FloatingActionButton" "$WF_SCREENS"
assert_not_contains "Zero WebView in WorkflowScreens" "WebView" "$WF_SCREENS"
assert_not_contains "Zero hardcoded timestamps in WorkflowScreens" "2026-10-16T12:00:00" "$WF_SCREENS"

WF_MODALS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowModals.kt"
assert_not_contains "Zero FABs in WorkflowModals" "FloatingActionButton" "$WF_MODALS"
assert_not_contains "Zero WebView in WorkflowModals" "WebView" "$WF_MODALS"
assert_contains "Purge dialog workspace-wide title" "Purge All Workspace History" "$WF_MODALS"

WF_SESSIONS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowSessionsAndEventsView.kt"
assert_not_contains "Zero FABs in WorkflowSessionsAndEventsView" "FloatingActionButton" "$WF_SESSIONS"
assert_not_contains "Zero WebView in WorkflowSessionsAndEventsView" "WebView" "$WF_SESSIONS"
PLAN_SCREENS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/ProjectPlanScreens.kt"
assert_not_contains "Zero FABs in ProjectPlanScreens" "FloatingActionButton" "$PLAN_SCREENS"
assert_not_contains "Zero WebView in ProjectPlanScreens" "WebView" "$PLAN_SCREENS"
assert_not_contains "No auto-open LaunchedEffect in ProjectPlanScreens" "LaunchedEffect(foldersResp" "$PLAN_SCREENS"
assert_contains "MarkdownPreviewView used for plan markdown rendering" "MarkdownPreviewView(" "$PLAN_SCREENS"

WORKBENCH_SCREEN="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt"
assert_contains "WorkflowPanelScreen wired into PanelHost" "workflowContent = {" "$WORKBENCH_SCREEN"
assert_contains "WorkflowPanelScreen instance invocation" "WorkflowPanelScreen(" "$WORKBENCH_SCREEN"
assert_contains "WorkflowSubProduct conditional back handler in WorkbenchScreen" "workflowActiveSubProduct == WorkflowSubProduct.PROJECT_PLANS" "$WORKBENCH_SCREEN"

echo ""
echo "=== Static Assertion Summary ==="
echo "  Total Passed: $PASS_COUNT"
echo "  Total Failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "FAILED: Static invariant checks did not satisfy Phase 13 requirements."
    exit 1
fi

echo "ALL STATIC INVARIANTS PASSED SUCCESSFULLY!"
