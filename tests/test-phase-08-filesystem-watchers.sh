#!/usr/bin/env bash
set -euo pipefail

# Filesystem Watchers, Search and Replace Verification for Phase 08
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

echo "=== Suite 1: Filesystem Models and REST Contracts (F01) ==="
MODELS_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModels.kt"
assert_contains "DirEntryDto defined" "data class DirEntryDto(" "$MODELS_FILE"
assert_contains "ListResponseDto defined" "data class ListResponseDto(" "$MODELS_FILE"
assert_contains "FileStatDto defined" "data class FileStatDto(" "$MODELS_FILE"
assert_contains "FsFileReadResult defined" "data class FsFileReadResult(" "$MODELS_FILE"
assert_contains "FileTreeNode defined" "data class FileTreeNode(" "$MODELS_FILE"
assert_contains "FileTreeNode isHidden property" "val isHidden: Boolean" "$MODELS_FILE"

REPO_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt"
assert_contains "FileRepository lists directory via REST" "suspend fun listDirectory(" "$REPO_FILE"
assert_contains "FileRepository calls /api/fs/list" '"/api/fs/list"' "$REPO_FILE"
assert_contains "FileRepository stats file" "suspend fun stat(" "$REPO_FILE"
assert_contains "FileRepository calls /api/fs/stat" '"/api/fs/stat"' "$REPO_FILE"
assert_contains "FileRepository reads file" "suspend fun readFile(" "$REPO_FILE"
assert_contains "FileRepository writes file with CAS" "suspend fun writeFile(" "$REPO_FILE"
assert_contains "FileRepository executes fs:op" "suspend fun executeFsOp(" "$REPO_FILE"

echo "=== Suite 2: File Tree State and Watcher Lifecycle (F01) ==="
TREE_STATE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt"
assert_contains "FileTreeState defines root StateFlow" "val root: StateFlow<FileTreeNode>" "$TREE_STATE"
assert_contains "FileTreeState supports toggleFolder" "fun toggleFolder(" "$TREE_STATE"
assert_contains "FileTreeState supports selectPath" "fun selectPath(" "$TREE_STATE"
assert_contains "FileTreeState supports hidden files" "val showHidden: StateFlow<Boolean>" "$TREE_STATE"
assert_contains "FileTreeState handles fs:event" "fun handleFsEvent(" "$TREE_STATE"
assert_contains "FileTreeState handles fs:overflow by re-subscribing" "fun handleFsOverflow(" "$TREE_STATE"
assert_contains "FileTreeState recovers after overflow" "refreshLoadedDirectories(" "$TREE_STATE"

SUBSCRIPTION_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeSubscription.kt"
assert_contains "FileTreeSubscription interface defined" "interface FileTreeSubscription" "$SUBSCRIPTION_FILE"
assert_contains "TreeSubscriptionManager manages subscriptions" "class TreeSubscriptionManager(" "$SUBSCRIPTION_FILE"
assert_contains "TreeSubscriptionManager pre-activates listener to close race" "wsConnection.incomingMessages" "$SUBSCRIPTION_FILE"
assert_contains "TreeSubscriptionManager dispatches FsEventMsg" "is ServerMsg.FsEventMsg -> if (msg.subId == subId) onEvent(msg.event)" "$SUBSCRIPTION_FILE"
assert_contains "TreeSubscriptionManager dispatches FsOverflow" "is ServerMsg.FsOverflow -> if (msg.subId == subId) onOverflow(msg.message)" "$SUBSCRIPTION_FILE"

echo "=== Suite 3: Mutating Operations and Sandbox Security (F01) ==="
MUTATION_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt"
assert_contains "FileMutationCoordinator defined" "class FileMutationCoordinator(" "$MUTATION_FILE"
assert_contains "Path traversal check strictly enforced" 'require(segments.none { it == ".." || it == "." })' "$MUTATION_FILE"
assert_contains "createFile supported" "suspend fun createFile(" "$MUTATION_FILE"
assert_contains "createDirectory supported" "suspend fun createDirectory(" "$MUTATION_FILE"
assert_contains "rename supported" "suspend fun rename(" "$MUTATION_FILE"
assert_contains "move supported" "suspend fun move(" "$MUTATION_FILE"
assert_contains "delete supported" "suspend fun delete(" "$MUTATION_FILE"

WRITE_COORD="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FsWriteCoordinator.kt"
assert_contains "FsWriteCoordinator handles 3-step write protocol" "class FsWriteCoordinator(" "$WRITE_COORD"
assert_contains "FsWriteBegin with expectedMtime" "expectedMtime = expectedMtime" "$WRITE_COORD"
assert_contains "FsWriteChunk with Base64" "ClientMsg.FsWriteChunk(" "$WRITE_COORD"
assert_contains "FsWriteCommit" "ClientMsg.FsWriteCommit(" "$WRITE_COORD"
assert_contains "Listens for FsWriteResult" "filterIsInstance<ServerMsg.FsWriteResult>()" "$WRITE_COORD"

echo "=== Suite 4: Search Repository and Multi-Profile Federation (F02) ==="
SEARCH_REPO="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/SearchRepository.kt"
assert_contains "SearchRepository content search" "suspend fun searchContent(" "$SEARCH_REPO"
assert_contains "SearchRepository path search" "suspend fun searchPaths(" "$SEARCH_REPO"
assert_contains "SearchRepository default cap 200" "const val DEFAULT_MAX_MATCHES = 200" "$SEARCH_REPO"
assert_contains "SearchRepository federated cap 500" "const val MAX_FEDERATED_CAP = 500" "$SEARCH_REPO"

FEDERATED_SEARCH="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FederatedSearchCoordinator.kt"
assert_contains "FederatedSearchCoordinator defined" "class FederatedSearchCoordinator(" "$FEDERATED_SEARCH"
assert_contains "FederatedSearchCoordinator caps matches at 500" "allMatches.take(maxAggregate)" "$FEDERATED_SEARCH"
assert_contains "FederatedSearchCoordinator records partial failures" "partialFailures.add(" "$FEDERATED_SEARCH"

echo "=== Suite 5: Replace Coordinator and Safe CAS Replacement (F02) ==="
REPLACE_COORD="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/ReplaceCoordinator.kt"
assert_contains "ReplaceCoordinator defined" "class ReplaceCoordinator(" "$REPLACE_COORD"
assert_contains "Literal replacement without regex expansion" "fun replaceLiteral(" "$REPLACE_COORD"
assert_contains "ReplaceCoordinator preview" "suspend fun preview(" "$REPLACE_COORD"
assert_contains "ReplaceCoordinator batch execution" "suspend fun applyBatch(" "$REPLACE_COORD"
assert_contains "Pre-write dirty editor check" "isDirtyFile(file.target, file.path)" "$REPLACE_COORD"
assert_contains "CAS conflict detection" "ReplaceFileOutcome.Conflict" "$REPLACE_COORD"
assert_contains "Skipped dirty files outcome" "ReplaceFileOutcome.SkippedDirty" "$REPLACE_COORD"

echo "=== Suite 6: Workbench Presentation & UI Invariants (NAV-01 & F01) ==="
SCREENS_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileScreens.kt"
assert_contains "FilesPanelScreen defined" "fun FilesPanelScreen(" "$SCREENS_FILE"
assert_contains "FilesSubTab Explorer and SearchReplace" "enum class FilesSubTab" "$SCREENS_FILE"

assert_not_contains "Zero FloatingActionButtons in Files UI" "FloatingActionButton" "$SCREENS_FILE"
assert_not_contains "Zero ExtendedFloatingActionButtons in Files UI" "ExtendedFloatingActionButton" "$SCREENS_FILE"

WORKBENCH_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt"
assert_contains "WorkbenchScreen wires filesContent" "filesContent = {" "$WORKBENCH_FILE"
assert_contains "WorkbenchScreen hosts FilesPanelScreen" "FilesPanelScreen(" "$WORKBENCH_FILE"

echo ""
echo "=== Phase 08 Invariant Verification Summary ==="
echo "Total assertions passed: $PASS_COUNT"
echo "Total assertions failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "❌ Verification FAILED: $FAIL_COUNT assertion(s) unmet"
    exit 1
else
    echo "✅ Verification PASSED: All $PASS_COUNT assertions satisfied"
    exit 0
fi
