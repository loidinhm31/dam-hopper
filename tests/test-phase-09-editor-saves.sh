#!/usr/bin/env bash
set -euo pipefail

# Native Editor Language Services and Safe Saves Verification for Phase 09
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

echo "=== Suite 1: File Tier Policy & Exact Boundaries (E01, M01) ==="
TIER_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/FileTierPolicy.kt"
assert_contains "FileTier enum declared" "enum class FileTier" "$TIER_FILE"
assert_contains "NORMAL tier defined" "NORMAL," "$TIER_FILE"
assert_contains "DEGRADED tier defined" "DEGRADED," "$TIER_FILE"
assert_contains "LARGE tier defined" "LARGE," "$TIER_FILE"
assert_contains "BINARY tier defined" "BINARY," "$TIER_FILE"
assert_contains "IMAGE tier defined" "IMAGE," "$TIER_FILE"
assert_contains "VIDEO tier defined" "VIDEO," "$TIER_FILE"
assert_contains "NORMAL_MAX_BYTES 1 MiB boundary" "1L * 1024L * 1024L" "$TIER_FILE"
assert_contains "DEGRADED_MAX_BYTES 5 MiB boundary" "5L * 1024L * 1024L" "$TIER_FILE"
assert_contains "LARGE_CHUNK_BYTES 64 KiB chunk size" "64L * 1024L" "$TIER_FILE"
assert_contains "determineTier function declared" "fun determineTier(" "$TIER_FILE"
assert_contains "isPreviewOnlyFile function declared" "fun isPreviewOnlyFile(" "$TIER_FILE"
assert_contains "decodeUtf8Safe helper declared" "fun decodeUtf8Safe(" "$TIER_FILE"

echo "=== Suite 2: Editor Models & In-Memory Session (E01) ==="
MODELS_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorModels.kt"
assert_contains "TextPosition declared" "data class TextPosition(" "$MODELS_FILE"
assert_contains "TextRange declared" "data class TextRange(" "$MODELS_FILE"
assert_contains "TextEdit declared" "data class TextEdit(" "$MODELS_FILE"
assert_contains "FindReplaceState declared" "data class FindReplaceState(" "$MODELS_FILE"
assert_contains "buildEditorTabKey declared" "fun buildEditorTabKey(" "$MODELS_FILE"
assert_contains "EditorTab declared" "data class EditorTab(" "$MODELS_FILE"
assert_contains "PersistedTabMetadata declared" "data class PersistedTabMetadata(" "$MODELS_FILE"

if ! grep -A 12 "data class PersistedTabMetadata" "$MODELS_FILE" | grep -q "content"; then
    echo "  [PASS] PersistedTabMetadata excludes dirty content"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo "  [FAIL] PersistedTabMetadata must exclude dirty content"
    FAIL_COUNT=$((FAIL_COUNT + 1))
fi

SESSION_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt"
assert_contains "EditorSession declared" "class EditorSession(" "$SESSION_FILE"
assert_contains "EditorSession tracks server mtime" "var serverMtime: Long? = initialMtime" "$SESSION_FILE"
assert_contains "EditorSession tracks saved content" "var savedContent: String = initialContent" "$SESSION_FILE"
assert_contains "EditorSession tracks submitted content" "var submittedContent: String? = null" "$SESSION_FILE"
assert_contains "EditorSession tracks dirty flag" "var isDirty: Boolean = (initialContent != savedContent)" "$SESSION_FILE"
assert_contains "EditorSession tracks model version" "var modelVersion: Long = 1L" "$SESSION_FILE"
assert_contains "EditorSession tracks edit epoch" "var editEpoch: Long = 1L" "$SESSION_FILE"
assert_contains "EditorSession beginSave captures snapshot" "fun beginSave(): Pair<String, Long>?" "$SESSION_FILE"
assert_contains "EditorSession completeSave preserves intermediate edits" "fun completeSave(" "$SESSION_FILE"
assert_contains "EditorSession abortSave clears submitted state" "fun abortSave()" "$SESSION_FILE"
assert_contains "EditorSession undo declared" "fun undo(): Boolean" "$SESSION_FILE"
assert_contains "EditorSession redo declared" "fun redo(): Boolean" "$SESSION_FILE"

echo "=== Suite 3: Safe Saves, CAS Conflict & Force Overwrite (E02) ==="
REPO_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt"
assert_contains "EditorRepository declared" "class EditorRepository(" "$REPO_FILE"
assert_contains "EditorRepository loadFile declared" "suspend fun loadFile(" "$REPO_FILE"
assert_contains "EditorRepository saveFile declared" "suspend fun saveFile(" "$REPO_FILE"
assert_contains "EditorRepository forceOverwrite declared" "suspend fun forceOverwrite(" "$REPO_FILE"
assert_contains "EditorSaveResult Conflict handled" "is EditorSaveResult.Conflict ->" "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabSaveCoordinator.kt"
assert_contains "EditorSaveResult UnknownOutcome on timeout" "catch (e: TimeoutCancellationException)" "$REPO_FILE"
assert_contains "Encrypted save requires Phase 11 session" "Encrypted save requires Phase 11 owner-bound crypto session" "$REPO_FILE"

echo "=== Suite 4: Multi-Tab State & Watcher Invalidation (E01, E02) ==="
TABS_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt"
assert_contains "EditorTabsState declared" "class EditorTabsState(" "$TABS_FILE"
assert_contains "EditorTabsState openTab declared" "suspend fun openTab(" "$TABS_FILE"
assert_contains "EditorTabsState selectTab declared" "fun selectTab(" "$TABS_FILE"
assert_contains "EditorTabsState closeTab declared" "fun closeTab(" "$TABS_FILE"
assert_contains "EditorTabsState saveTab declared" "suspend fun saveTab(" "$TABS_FILE"
assert_contains "EditorTabsState forceOverwriteTab declared" "suspend fun forceOverwriteTab(" "$TABS_FILE"
assert_contains "EditorTabsState reloadTab declared" "suspend fun reloadTab(" "$TABS_FILE"
assert_contains "isDirtyFile supplies ReplaceCoordinator" "fun isDirtyFile(target: ProjectTargetRef, path: String): Boolean" "$TABS_FILE"
assert_contains "handleRemoteFileModified clean reload" "suspend fun handleRemoteFileModified(" "$TABS_FILE"
assert_contains "dirty tab marked stale without overwriting" "it.copy(isStale = true)" "$TABS_FILE"

echo "=== Suite 5: Language Services & Multi-Dimensional Fencing (E01) ==="
LANG_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/LanguageService.kt"
assert_contains "LanguageService interface declared" "interface LanguageService {" "$LANG_FILE"
assert_contains "JsonLanguageService declared" "class JsonLanguageService(" "$LANG_FILE"
assert_contains "TsJsLanguageService declared" "class TsJsLanguageService(" "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/TsJsLanguageService.kt"
assert_contains "TypeScriptLanguageServiceAudit declared" "object TypeScriptLanguageServiceAudit {" "$LANG_FILE"
assert_contains "LanguageServiceCoordinator fences requests" "class LanguageServiceCoordinator {" "$LANG_FILE"
assert_contains "Multi-dimensional qualified request registration" "fun registerQualifiedRequest(" "$LANG_FILE"
assert_contains "Multi-dimensional qualified response validation" "fun isQualifiedResponseValid(" "$LANG_FILE"

echo "=== Suite 6: Workbench UI & Zero Floating Action Buttons Invariants (NAV-01, E01, M01) ==="
SCREEN_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorScreens.kt"
assert_contains "EditorPanelScreen declared" "fun EditorPanelScreen(" "$SCREEN_FILE"
assert_contains "LargeFileView declared" "fun LargeFileView(" "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/LargeFileView.kt"
assert_contains "BinaryHexView declared" "fun BinaryHexView(" "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/BinaryHexView.kt"
assert_contains "MarkdownPreviewView declared" "fun MarkdownPreviewView(" "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/MarkdownPreviewView.kt"
assert_contains "Mermaid rendering deferred banner" "Mermaid rendering deferred for this release" "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/MarkdownPreviewView.kt"
assert_contains "SaveConflictDialog declared" "fun SaveConflictDialog(" "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/SaveConflictDialog.kt"

# FAB Invariant check
assert_not_contains "Zero FloatingActionButton in EditorScreens" "FloatingActionButton" "$SCREEN_FILE"
assert_not_contains "Zero ExtendedFloatingActionButton in EditorScreens" "ExtendedFloatingActionButton" "$SCREEN_FILE"
assert_not_contains "Zero FloatingActionButton in EditorTopBar" "FloatingActionButton" "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTopBar.kt"

# WorkbenchScreen integration
WB_FILE="native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt"
assert_contains "WorkbenchScreen wires editorContent" "editorContent = {" "$WB_FILE"
assert_contains "WorkbenchScreen hosts EditorPanelScreen" "EditorPanelScreen(tabsState = editorTabsState!!)" "$WB_FILE"
assert_contains "WorkbenchScreen onOpenFile opens tab" "editorTabsState?.openTab(target, path)" "$WB_FILE"
assert_contains "WorkbenchScreen supplies isDirtyFile to ReplaceCoordinator" "editorTabsState?.isDirtyFile(target, path) ?: false" "$WB_FILE"

echo ""
echo "=== Phase 09 Invariant Verification Summary ==="
echo "Total assertions passed: $PASS_COUNT"
echo "Total assertions failed: $FAIL_COUNT"

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo "✅ Verification PASSED: All $PASS_COUNT assertions satisfied"
    exit 0
else
    echo "❌ Verification FAILED: $FAIL_COUNT assertions failed"
    exit 1
fi
