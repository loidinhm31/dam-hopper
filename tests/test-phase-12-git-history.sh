#!/usr/bin/env bash
set -euo pipefail

# Complete Git and Safe History Workflows Verification for Phase 12
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

echo "=== Suite 1: Git Models & Wire DTOs (G01, G02, G03) ==="
GIT_MODELS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitModels.kt"
assert_contains "VcsRoot wire model declared" "data class VcsRoot(" "$GIT_MODELS"
assert_contains "GitRootStatus model declared" "data class GitRootStatus(" "$GIT_MODELS"
assert_contains "GitBranch model declared" "data class GitBranch(" "$GIT_MODELS"
assert_contains "GitBranch isLocal property declared" "val isLocal: Boolean get() = !isRemote" "$GIT_MODELS"
assert_contains "BranchUpdateResult model declared" "data class BranchUpdateResult(" "$GIT_MODELS"
assert_contains "CreateBranchRequest model declared" "data class CreateBranchRequest(" "$GIT_MODELS"
assert_contains "CheckoutBranchRequest model declared" "data class CheckoutBranchRequest(" "$GIT_MODELS"
assert_contains "DeleteBranchRequest model declared" "data class DeleteBranchRequest(" "$GIT_MODELS"
assert_contains "GitDiffSummary model declared" "data class GitDiffSummary(" "$GIT_MODELS"
assert_contains "DiffFileEntry model declared" "data class DiffFileEntry(" "$GIT_MODELS"
assert_contains "StageFilesRequest model declared" "data class StageFilesRequest(" "$GIT_MODELS"
assert_contains "DiscardFileRequest model declared" "data class DiscardFileRequest(" "$GIT_MODELS"
assert_contains "CommitRequest model declared" "data class CommitRequest(" "$GIT_MODELS"
assert_contains "CommitResponse model declared" "data class CommitResponse(" "$GIT_MODELS"
assert_contains "AddWorktreeRequest model declared" "data class AddWorktreeRequest(" "$GIT_MODELS"
assert_contains "RemoveWorktreeRequest model declared" "data class RemoveWorktreeRequest(" "$GIT_MODELS"

HISTORY_MODELS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryModels.kt"
assert_contains "GitLogEntry model declared" "data class GitLogEntry(" "$HISTORY_MODELS"
assert_contains "GitCommitDetails model declared" "data class GitCommitDetails(" "$HISTORY_MODELS"
assert_contains "CommitMessageSnapshot model declared" "data class CommitMessageSnapshot(" "$HISTORY_MODELS"
assert_contains "EditCommitMessageRequest model declared" "data class EditCommitMessageRequest(" "$HISTORY_MODELS"
assert_contains "SquashCommitsRequest model declared" "data class SquashCommitsRequest(" "$HISTORY_MODELS"
assert_contains "CherryPickRequest model declared" "data class CherryPickRequest(" "$HISTORY_MODELS"
assert_contains "ResetRequest model declared" "data class ResetRequest(" "$HISTORY_MODELS"
assert_contains "FilePathsRequest model declared" "data class FilePathsRequest(" "$HISTORY_MODELS"
assert_contains "GitRecoveryInfo model declared" "data class GitRecoveryInfo(" "$HISTORY_MODELS"
assert_contains "GitActionResult model declared" "data class GitActionResult(" "$HISTORY_MODELS"

PUB_MODELS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPublicationModels.kt"
assert_contains "PublishSnapshot model declared" "data class PublishSnapshot(" "$PUB_MODELS"
assert_contains "PublishPreview model declared" "data class PublishPreview(" "$PUB_MODELS"
assert_contains "PublishResult model declared" "data class PublishResult(" "$PUB_MODELS"
assert_contains "PrepareLeasedPushRequest model declared" "data class PrepareLeasedPushRequest(" "$PUB_MODELS"
assert_contains "PublishLeasedPushRequest model declared" "data class PublishLeasedPushRequest(" "$PUB_MODELS"
assert_contains "GitOpTarget model declared" "data class GitOpTarget(" "$PUB_MODELS"
assert_contains "GitOpResult model declared" "data class GitOpResult(" "$PUB_MODELS"

REWRITE_MODELS="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteModels.kt"
assert_contains "SquashReceipt model declared" "data class SquashReceipt(" "$REWRITE_MODELS"

echo "=== Suite 2: Git Repositories & Routing Integrity (G01, G02, G03) ==="
QUERY_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitQueryRepository.kt"
assert_contains "GitQueryRepository class declared" "class GitQueryRepository(" "$QUERY_REPO"
assert_contains "listRoots queries /api/git/{project}/roots" "/api/git/\$encodedProject/roots" "$QUERY_REPO"
assert_contains "listBranches queries /api/git/{project}/branches" "/api/git/\$encodedProject/branches" "$QUERY_REPO"
assert_contains "getLog queries /api/git/{project}/log" "/api/git/\$encodedProject/log" "$QUERY_REPO"
assert_contains "getLog passes messageQuery" "params[\"messageQuery\"] = it" "$QUERY_REPO"
assert_contains "getCommitDetails queries /commit/{hash}/details" "/api/git/\$encodedProject/commit/\$encodedHash/details" "$QUERY_REPO"
assert_contains "getCommitFiles queries /commit/{hash}/files" "/api/git/\$encodedProject/commit/\$encodedHash/files" "$QUERY_REPO"
assert_contains "getCommitFileDiff queries /commit/{hash}/diff" "/api/git/\$encodedProject/commit/\$encodedHash/diff" "$QUERY_REPO"
assert_contains "getDiffSummary queries /diff" "/api/git/\$encodedProject/diff" "$QUERY_REPO"
assert_contains "getUntracked queries /untracked" "/api/git/\$encodedProject/untracked" "$QUERY_REPO"
assert_contains "getFileDiff queries /diff/file" "/api/git/\$encodedProject/diff/file" "$QUERY_REPO"
assert_contains "getCommitMessage queries /commit/{hash}/message" "/api/git/\$encodedProject/commit/\$encodedHash/message" "$QUERY_REPO"

MUTATION_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitMutationRepository.kt"
assert_contains "GitMutationRepository class declared" "class GitMutationRepository(" "$MUTATION_REPO"
assert_contains "stage posts /stage" "/api/git/\$encodedProject/stage" "$MUTATION_REPO"
assert_contains "unstage posts /unstage" "/api/git/\$encodedProject/unstage" "$MUTATION_REPO"
assert_contains "discard posts /discard" "/api/git/\$encodedProject/discard" "$MUTATION_REPO"
assert_contains "discardHunk posts /discard-hunk" "/api/git/\$encodedProject/discard-hunk" "$MUTATION_REPO"
assert_contains "commit posts /commit" "/api/git/\$encodedProject/commit" "$MUTATION_REPO"
assert_contains "fetch posts /api/git/fetch" "/api/git/fetch" "$MUTATION_REPO"
assert_contains "pull posts /api/git/pull" "/api/git/pull" "$MUTATION_REPO"
assert_contains "push posts /api/git/push" "/api/git/push" "$MUTATION_REPO"

HIST_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryMutationRepository.kt"
assert_contains "GitHistoryMutationRepository declared" "class GitHistoryMutationRepository(" "$HIST_REPO"
assert_contains "cherryPick posts /cherry-pick" "/api/git/\$encodedProject/cherry-pick" "$HIST_REPO"
assert_contains "cherryPickFiles posts /cherry-pick-files" "/api/git/\$encodedProject/commit/\$encodedHash/cherry-pick-files" "$HIST_REPO"
assert_contains "reset posts /reset" "/api/git/\$encodedProject/reset" "$HIST_REPO"
assert_contains "undoLastCommit posts /undo-last-commit" "/api/git/\$encodedProject/undo-last-commit" "$HIST_REPO"
assert_contains "dropCommit posts /drop" "/api/git/\$encodedProject/commit/\$encodedHash/drop" "$HIST_REPO"
assert_contains "dropCommitFiles posts /drop-files" "/api/git/\$encodedProject/commit/\$encodedHash/drop-files" "$HIST_REPO"
assert_contains "revertCommit posts /revert" "/api/git/\$encodedProject/commit/\$encodedHash/revert" "$HIST_REPO"
assert_contains "revertCommitFiles posts /revert-files" "/api/git/\$encodedProject/commit/\$encodedHash/revert-files" "$HIST_REPO"
assert_contains "editCommitMessage posts /message" "/api/git/\$encodedProject/commit/\$encodedHash/message" "$HIST_REPO"
assert_contains "squashCommits posts /squash" "/api/git/\$encodedProject/squash" "$HIST_REPO"

BRANCH_WT_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitBranchWorktreeRepository.kt"
assert_contains "GitBranchWorktreeRepository declared" "class GitBranchWorktreeRepository(" "$BRANCH_WT_REPO"
assert_contains "createBranch posts /branches" "/api/git/\$encodedProject/branches" "$BRANCH_WT_REPO"
assert_contains "checkoutBranch posts /checkout" "/api/git/\$encodedProject/branches/checkout" "$BRANCH_WT_REPO"
assert_contains "deleteBranch deletes /branches" "/api/git/\$encodedProject/branches" "$BRANCH_WT_REPO"
assert_contains "updateBranch posts /update" "/api/git/\$encodedProject/branches/update" "$BRANCH_WT_REPO"
assert_contains "listWorktrees gets /worktrees" "/api/git/\$encodedProject/worktrees" "$BRANCH_WT_REPO"
assert_contains "addWorktree posts /worktrees" "/api/git/\$encodedProject/worktrees" "$BRANCH_WT_REPO"
assert_contains "removeWorktree deletes /worktrees" "/api/git/\$encodedProject/worktrees" "$BRANCH_WT_REPO"
assert_contains "pruneWorktrees posts /prune" "/api/git/\$encodedProject/worktrees/prune" "$BRANCH_WT_REPO"

PUB_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPublishRepository.kt"
assert_contains "GitPublishRepository declared" "class GitPublishRepository(" "$PUB_REPO"
assert_contains "prepareLeasedPush posts /push/prepare" "/api/git/\$encodedProject/push/prepare" "$PUB_REPO"
assert_contains "publishLeasedPush posts /push/publish" "/api/git/\$encodedProject/push/publish" "$PUB_REPO"

GIT_REPO_FACADE="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitRepository.kt"
assert_contains "GitRepository facade class declared" "class GitRepository(" "$GIT_REPO_FACADE"
SYNC_CTRL="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitSyncController.kt"
assert_contains "GitSyncController declared" "class GitSyncController(" "$SYNC_CTRL"
assert_contains "fetch sends GitOpTarget" "val target = GitOpTarget(scope.project, scope.worktreePath)" "$SYNC_CTRL"
assert_contains "pull sends GitOpTarget" "val target = GitOpTarget(scope.project, scope.worktreePath)" "$SYNC_CTRL"

echo "=== Suite 3: History & Rewrite Controllers (G02) ==="
SCOPE_FILE="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitOperationScope.kt"
assert_contains "GitOperationScope declared" "data class GitOperationScope(" "$SCOPE_FILE"
assert_contains "GitOperationScope contains profileId" "val profileId: String" "$SCOPE_FILE"
assert_contains "GitOperationScope contains generation" "val generation: Long" "$SCOPE_FILE"
assert_contains "GitOperationScope contains project" "val project: String" "$SCOPE_FILE"

HIST_CTRL="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryController.kt"
assert_contains "GitHistoryController declared" "class GitHistoryController(" "$HIST_CTRL"
assert_contains "isViewingLocalBranch declared" "val isViewingLocalBranch: Boolean" "$HIST_CTRL"
assert_contains "isViewingActiveBranch declared" "val isViewingActiveBranch: Boolean" "$HIST_CTRL"
assert_contains "inspectCommit declared" "fun inspectCommit(" "$HIST_CTRL"
assert_contains "toggleCommitSelection declared" "fun toggleCommitSelection(" "$HIST_CTRL"

REWRITE_CTRL="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteActionController.kt"
assert_contains "GitRewriteActionController declared" "class GitRewriteActionController(" "$REWRITE_CTRL"
assert_contains "frozenMessageSnapshot declared" "val frozenMessageSnapshot:" "$REWRITE_CTRL"
assert_contains "lastSquashReceipt declared" "val lastSquashReceipt:" "$REWRITE_CTRL"
assert_contains "loadMessageSnapshot declared" "fun loadMessageSnapshot(" "$REWRITE_CTRL"
assert_contains "editCommitMessage declared" "fun editCommitMessage(" "$REWRITE_CTRL"
assert_contains "squashCommits declared" "fun squashCommits(" "$REWRITE_CTRL"

ACTION_CTRL="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionController.kt"
assert_contains "GitHistoryActionController declared" "class GitHistoryActionController(" "$ACTION_CTRL"
assert_contains "cherryPick declared" "fun cherryPick(" "$ACTION_CTRL"
assert_contains "revert declared" "fun revert(" "$ACTION_CTRL"
assert_contains "reset declared" "fun reset(" "$ACTION_CTRL"
assert_contains "drop declared" "fun drop(" "$ACTION_CTRL"
assert_contains "undoLastCommit declared" "fun undoLastCommit(" "$ACTION_CTRL"

echo "=== Suite 4: Worktree Mutation Controller & Prechecks (G01, G02) ==="
WT_CTRL="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorktreeMutationController.kt"
assert_contains "WorktreeMutationController declared" "class WorktreeMutationController(" "$WT_CTRL"
assert_contains "WorktreeRemovalPrecheck sealed class declared" "sealed class WorktreeRemovalPrecheck" "$WT_CTRL"
assert_contains "validateRemovalPrecheck declared" "fun validateRemovalPrecheck(" "$WT_CTRL"
assert_contains "isTargetDirty checked" "if (isTargetDirty(target))" "$WT_CTRL"
assert_contains "hasActiveTerminal checked" "if (hasActiveTerminal(target))" "$WT_CTRL"
assert_contains "addWorktree declared" "fun addWorktree(" "$WT_CTRL"
assert_contains "removeWorktree declared" "fun removeWorktree(" "$WT_CTRL"
assert_contains "pruneWorktrees declared" "fun pruneWorktrees(" "$WT_CTRL"

echo "=== Suite 5: Leased Publication Safety Gate (G03) ==="
LEASED_CTRL="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/LeasedPublishController.kt"
assert_contains "LeasedPublishController declared" "class LeasedPublishController(" "$LEASED_CTRL"
assert_contains "LeasedPublishState sealed class declared" "sealed class LeasedPublishState" "$LEASED_CTRL"
assert_contains "prepareWithReceipt declared" "fun prepareWithReceipt(" "$LEASED_CTRL"
assert_contains "prepare declared" "fun prepare(" "$LEASED_CTRL"
assert_contains "confirmPublish declared" "fun confirmPublish(" "$LEASED_CTRL"
assert_contains "cancel declared" "fun cancel(" "$LEASED_CTRL"
assert_contains "snapshot branch and sourceOid match check" "if (snap.branch != branch || snap.sourceOid != sourceOid)" "$LEASED_CTRL"
assert_contains "stale-remote handling" "res.isStaleRemote" "$LEASED_CTRL"

echo "=== Suite 6: Native Presentation & Zero FABs Invariant (NAV-01, G01) ==="
CHANGES_VIEW="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitChangesView.kt"
HIST_VIEW="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryView.kt"
COMMIT_ROW="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitCommitRow.kt"
BRANCHES_VIEW="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitBranchesWorktreesView.kt"
PANEL_SCREEN="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPanelScreen.kt"
MODALS_HOST="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitModalsHost.kt"
WORKBENCH_SCREEN="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt"
DETAILS_DIALOG="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitCommitDetailsDialog.kt"
assert_contains "GitCommitDetailsDialog declared" "fun GitCommitDetailsDialog(" "$DETAILS_DIALOG"
assert_not_contains "Zero FloatingActionButton in GitCommitDetailsDialog" "FloatingActionButton" "$DETAILS_DIALOG"
assert_not_contains "Zero ExtendedFloatingActionButton in GitCommitDetailsDialog" "ExtendedFloatingActionButton" "$DETAILS_DIALOG"
ERROR_DIALOG="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitErrorDialog.kt"
assert_contains "GitErrorDialog declared" "fun GitErrorDialog(" "$ERROR_DIALOG"
assert_not_contains "Zero FloatingActionButton in GitErrorDialog" "FloatingActionButton" "$ERROR_DIALOG"
assert_not_contains "Zero ExtendedFloatingActionButton in GitErrorDialog" "ExtendedFloatingActionButton" "$ERROR_DIALOG"

assert_contains "GitPanelScreen declared" "fun GitPanelScreen(" "$PANEL_SCREEN"
assert_contains "GitPanelSection enum declared" "enum class GitPanelSection" "$PANEL_SCREEN"
assert_contains "WorkbenchScreen provides gitContent" "gitContent = {" "$WORKBENCH_SCREEN"
assert_contains "GitModalsHost declared" "fun GitModalsHost(" "$MODALS_HOST"

assert_not_contains "Zero FloatingActionButton in GitChangesView" "FloatingActionButton" "$CHANGES_VIEW"
assert_not_contains "Zero ExtendedFloatingActionButton in GitChangesView" "ExtendedFloatingActionButton" "$CHANGES_VIEW"
assert_not_contains "Zero FloatingActionButton in GitHistoryView" "FloatingActionButton" "$HIST_VIEW"
assert_not_contains "Zero ExtendedFloatingActionButton in GitHistoryView" "ExtendedFloatingActionButton" "$HIST_VIEW"
assert_not_contains "Zero FloatingActionButton in GitCommitRow" "FloatingActionButton" "$COMMIT_ROW"
assert_not_contains "Zero ExtendedFloatingActionButton in GitCommitRow" "ExtendedFloatingActionButton" "$COMMIT_ROW"
assert_not_contains "Zero FloatingActionButton in GitBranchesWorktreesView" "FloatingActionButton" "$BRANCHES_VIEW"
assert_not_contains "Zero ExtendedFloatingActionButton in GitBranchesWorktreesView" "ExtendedFloatingActionButton" "$BRANCHES_VIEW"
assert_not_contains "Zero FloatingActionButton in GitPanelScreen" "FloatingActionButton" "$PANEL_SCREEN"
assert_not_contains "Zero ExtendedFloatingActionButton in GitPanelScreen" "ExtendedFloatingActionButton" "$PANEL_SCREEN"

echo ""
echo "=== Phase 12 Invariant Verification Summary ==="
echo "Total assertions passed: $PASS_COUNT"
echo "Total assertions failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo "✅ Verification PASSED: All $PASS_COUNT assertions satisfied"
    exit 0
else
    echo "❌ Verification FAILED: $FAIL_COUNT assertion(s) failed"
    exit 1
fi
