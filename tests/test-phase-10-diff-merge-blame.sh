#!/usr/bin/env bash
set -euo pipefail

# Native Diff, Merge Conflict Resolution and Git Blame Verification for Phase 10
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

echo "=== Suite 1: Git Models & Cryptographic Hashes (E03, E04) ==="
DIFF_MODELS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/DiffModels.kt"
assert_contains "FileDiffContent wire model declared" "data class FileDiffContent(" "$DIFF_MODELS"
assert_contains "GitLineChange model declared" "data class GitLineChange(" "$DIFF_MODELS"
assert_contains "HunkInfo model declared" "data class HunkInfo(" "$DIFF_MODELS"
assert_contains "DiffLayoutMode enum declared" "enum class DiffLayoutMode" "$DIFF_MODELS"
assert_contains "DiffLineType enum declared" "enum class DiffLineType" "$DIFF_MODELS"
assert_contains "DiffRow layout representation declared" "data class DiffRow(" "$DIFF_MODELS"
assert_contains "DiscardHunkRequest wire model declared" "data class DiscardHunkRequest(" "$DIFF_MODELS"

MERGE_MODELS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/MergeConflictModels.kt"
assert_contains "ConflictFile wire model declared" "data class ConflictFile(" "$MERGE_MODELS"
assert_contains "ResolveConflictRequest wire model declared" "data class ResolveConflictRequest(" "$MERGE_MODELS"
assert_contains "ConflictRegion parsed model declared" "data class ConflictRegion(" "$MERGE_MODELS"
assert_contains "ConflictSide enum declared" "enum class ConflictSide" "$MERGE_MODELS"

BLAME_MODELS="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/BlameModels.kt"
assert_contains "GitBlameInput wire model declared" "data class GitBlameInput(" "$BLAME_MODELS"
assert_contains "GitBlameCommit wire model declared" "data class GitBlameCommit(" "$BLAME_MODELS"
assert_contains "GitBlameRange wire model declared" "data class GitBlameRange(" "$BLAME_MODELS"
assert_contains "GitBlameStatus enum declared" "enum class GitBlameStatus" "$BLAME_MODELS"
assert_contains "GitBlameResponse wire model declared" "data class GitBlameResponse(" "$BLAME_MODELS"
assert_contains "GIT_BLAME_MAX_BUFFER_BYTES 5 MiB threshold" "5L * 1024L * 1024L" "$BLAME_MODELS"
assert_contains "GIT_BLAME_DEBOUNCE_MS 250ms threshold" "250L" "$BLAME_MODELS"
assert_contains "BLAME_CACHE_MAX_ENTRIES 64 entries limit" "64" "$BLAME_MODELS"
assert_contains "BLAME_CACHE_MAX_BYTES 32 MiB budget" "32L * 1024L * 1024L" "$BLAME_MODELS"

SHA_EXPECT="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/crypto/Sha256Digest.kt"
assert_contains "SHA-256 expect declared" "expect fun computeSha256(" "$SHA_EXPECT"
assert_contains "SHA-256 string helper declared" "fun computeSha256(text: String)" "$SHA_EXPECT"
assert_contains "SHA-256 JVM actual" "actual fun computeSha256(" "native/android-app/shared/src/jvmMain/kotlin/dev/damhopper/nativeapp/core/crypto/Sha256Digest.jvm.kt"
assert_contains "SHA-256 Android actual" "actual fun computeSha256(" "native/android-app/shared/src/androidMain/kotlin/dev/damhopper/nativeapp/core/crypto/Sha256Digest.android.kt"

echo "=== Suite 2: Diff Engine, Layout & Baseline-Aware Hunk Operations (E03) ==="
DIFF_CALC="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/DiffCalculator.kt"
assert_contains "DiffCalculator declared" "object DiffCalculator" "$DIFF_CALC"
assert_contains "computeDiffRows declared" "fun computeDiffRows(" "$DIFF_CALC"
assert_contains "LcsDiffEngine declared" "object LcsDiffEngine" "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/LcsDiffEngine.kt"

DIFF_CTRL="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/DiffReviewController.kt"
assert_contains "DiffReviewController declared" "class DiffReviewController(" "$DIFF_CTRL"
assert_contains "loadDiff function declared" "fun loadDiff(" "$DIFF_CTRL"
assert_contains "discardHunk function declared" "suspend fun discardHunk(" "$DIFF_CTRL"
assert_contains "isDirtyBufferProvider guard declared" "isDirtyBufferProvider?.invoke(target, query.path)" "$DIFF_CTRL"
assert_contains "isModifiedDirty state tracked" "val isModifiedDirty: StateFlow<Boolean>" "$DIFF_CTRL"
assert_contains "nextHunk declared" "fun nextHunk()" "$DIFF_CTRL"
assert_contains "prevHunk declared" "fun prevHunk()" "$DIFF_CTRL"

echo "=== Suite 3: Merge Conflict Parser & Resolution (E03) ==="
PARSER_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/ConflictParser.kt"
assert_contains "ConflictParser declared" "object ConflictParser" "$PARSER_FILE"
assert_contains "parseConflictRegions declared" "fun parseConflictRegions(" "$PARSER_FILE"
assert_contains "hasMalformedConflicts declared" "fun hasMalformedConflicts(" "$PARSER_FILE"
assert_contains "hasRemainingConflicts declared" "fun hasRemainingConflicts(" "$PARSER_FILE"
assert_contains "acceptConflict declared" "fun acceptConflict(" "$PARSER_FILE"
assert_contains "acceptAll declared" "fun acceptAll(" "$PARSER_FILE"

MERGE_CTRL="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/MergeConflictController.kt"
assert_contains "MergeConflictController declared" "class MergeConflictController(" "$MERGE_CTRL"
assert_contains "loadConflicts declared" "fun loadConflicts(" "$MERGE_CTRL"
assert_contains "selectFile declared" "fun selectFile(" "$MERGE_CTRL"
assert_contains "acceptCurrentConflict declared" "fun acceptCurrentConflict(" "$MERGE_CTRL"
assert_contains "acceptAllConflicts declared" "fun acceptAllConflicts(" "$MERGE_CTRL"
assert_contains "markResolved declared" "suspend fun markResolved()" "$MERGE_CTRL"
assert_contains "Unresolved check before resolution" "Remaining unresolved conflict markers" "$MERGE_CTRL"

echo "=== Suite 4: Git Blame Validation, Cache & Reveal Nonce (E04) ==="
VALIDATOR_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/BlameValidator.kt"
assert_contains "BlameValidator declared" "object BlameValidator" "$VALIDATOR_FILE"
assert_contains "computeBufferLineCount declared" "fun computeBufferLineCount(" "$VALIDATOR_FILE"
assert_contains "isBufferOverLimit declared" "fun isBufferOverLimit(" "$VALIDATOR_FILE"
assert_contains "validateBlameResponse declared" "fun validateBlameResponse(" "$VALIDATOR_FILE"
assert_contains "Contiguous partition check" "Partition gap or overlap" "$VALIDATOR_FILE"
assert_contains "Line coverage check" "Partition covers" "$VALIDATOR_FILE"

CACHE_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/BlameCache.kt"
assert_contains "BlameCache declared" "class BlameCache(" "$CACHE_FILE"
assert_contains "BlameCacheKey multi-dimensional identity" "data class BlameCacheKey(" "$CACHE_FILE"
assert_contains "advanceTargetEpoch declared" "suspend fun advanceTargetEpoch(" "$CACHE_FILE"
assert_contains "retireOwner declared" "suspend fun retireOwner(" "$CACHE_FILE"

REPO_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/BlameRepository.kt"
assert_contains "BlameRepository declared" "class BlameRepository(" "$REPO_FILE"
assert_contains "requestBlameDebounced declared" "fun requestBlameDebounced(" "$REPO_FILE"
assert_contains "deriveLineAttributions declared" "fun deriveLineAttributions(" "$REPO_FILE"

REVEAL_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/CommitRevealRequest.kt"
assert_contains "CommitRevealRequest declared" "data class CommitRevealRequest(" "$REVEAL_FILE"
assert_contains "CommitRevealCoordinator declared" "class CommitRevealCoordinator" "$REVEAL_FILE"
assert_contains "consumeReveal validates owner and target" "fun consumeReveal(" "$REVEAL_FILE"

echo "=== Suite 5: UI Surfaces, Presentation & Zero FABs Invariant (NAV-01, E03, E04) ==="
DIFF_SCREEN="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/DiffReviewScreen.kt"
assert_contains "DiffReviewScreen composable declared" "fun DiffReviewScreen(" "$DIFF_SCREEN"
assert_not_contains "Zero FloatingActionButton in DiffReviewScreen" "FloatingActionButton" "$DIFF_SCREEN"
assert_not_contains "Zero ExtendedFloatingActionButton in DiffReviewScreen" "ExtendedFloatingActionButton" "$DIFF_SCREEN"

MERGE_SCREEN="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/MergeConflictScreen.kt"
assert_contains "MergeConflictScreen composable declared" "fun MergeConflictScreen(" "$MERGE_SCREEN"
assert_not_contains "Zero FloatingActionButton in MergeConflictScreen" "FloatingActionButton" "$MERGE_SCREEN"
assert_not_contains "Zero ExtendedFloatingActionButton in MergeConflictScreen" "ExtendedFloatingActionButton" "$MERGE_SCREEN"

assert_contains "EditorBlameGutter declared" "fun EditorBlameGutter(" "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorBlameGutter.kt"
assert_contains "NativeReviewSurfaces platform bridge declared" "class NativeReviewSurfaces(" "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/NativeReviewSurfaces.kt"

WB_SCREEN="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt"
assert_contains "WorkbenchScreen wires diffController" "var diffController by remember" "$WB_SCREEN"
assert_contains "WorkbenchScreen wires mergeController" "var mergeController by remember" "$WB_SCREEN"
assert_contains "WorkbenchScreen wires blameRepo" "var blameRepo by remember" "$WB_SCREEN"
assert_contains "WorkbenchScreen hosts DiffReviewScreen" "DiffReviewScreen(controller = diffController!!)" "$WB_SCREEN"
assert_contains "WorkbenchScreen hosts MergeConflictScreen" "MergeConflictScreen(" "$WB_SCREEN"
assert_contains "WorkbenchScreen hosts EditorPanelScreen with blame" "blameRepo = blameRepo" "$WB_SCREEN"

echo ""
echo "=== Phase 10 Invariant Verification Summary ==="
echo "Total assertions passed: $PASS_COUNT"
echo "Total assertions failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo "✅ Verification PASSED: All $PASS_COUNT assertions satisfied"
    exit 0
else
    echo "❌ Verification FAILED: $FAIL_COUNT assertions failed"
    exit 1
fi
