# Code Review — Phase 10 (Cycle 4)

Score: **5/10**. W-E, W-A/B (exit path) done. C1 still functionally broken. W-F not implemented at all.

## Cycle 3 item verification
| Item | Status | Evidence |
|---|---|---|
| C1 mtime captured in loadDiff | **BROKEN** | DiffReviewController.kt:~58 `apiClient.get("/api/fs/stat", queryParams)` where queryParams = {path, worktreePath?, root?} — **no `project`**. Server `ProjectPathParams.project: String` required (server/src/api/fs.rs:70-74) -> 400 -> swallowed by `catch -> null` -> `baselineMtime=null`. |
| C1 saveModified uses baseline + `res.conflict` | partial | Code correct in shape (`expectedMtime = baselineMtime ?: 0L`, conflict check, baseline refresh). But with null baseline -> expected 0 -> server `current_mtime != 0` -> **Save always returns conflict**. |
| C1 baseline refreshed after save | done (see H2 for stale hunks) | `baselineMtime = res.newMtime`, `_diffContent.modified = snapshot`, dirty recomputed vs snapshot. |
| C1 Edit mode + Save button | done | DiffReviewScreen `isEditing` toggle, TextField -> `updateModifiedDraft`, Save shown when `isDirty && onSaveModified != null`; Workbench passes `saveModified(repo)`. |
| W-A/W-B exit commit | done | `exitCommitDiff()` + "Exit Commit" button (shown when readOnly && commitHash!=null); Workbench effect skips when commitHash set; `loadDiff` now has `loadDiffSeq` fence. |
| W-E discardHunk booleanOrNull | done | DiffReviewController.kt discardHunk uses `?.jsonPrimitive?.booleanOrNull ?: true`. |
| W-F markResolved guarded vs isLoading/isResolving | **NOT DONE** | markResolved checks only `_allResolved`, `_isMalformed`. UI-only gating (`MergeConflictScreen`). No re-entrancy guard (double tap = 2 POSTs). |
| W-F selectFile resets malformed/ours/theirs/ancestor | **NOT DONE** | selectFile resets only result, allResolved, dirty, regions. `_isMalformed`, `_oursContent`, `_theirsContent`, `_ancestorContent`, `_originalWorkdirContent` retained -> stale panes during load. |
| W-F loadConflicts seq fence | **NOT DONE** | No `loadSeq`; overlapping loads write `_conflictFiles`/`_errorMessage`/`_isLoading` unordered; finally clears loading while nested selectFile still in flight. |

## Critical
1. **C1 Save unusable.** Fix: stat via `FileRepository.stat(target, path)` (adds `project`) or add `"project" to target.project` to stat params; don't swallow failures — if stat fails, surface error and disable Save (no `?: 0L` fallback). Also assign `baselineMtime` only when `seq == loadDiffSeq` (currently written before fence by stale loads).

## Warnings
- W1 (=W-F) Merge controller items above all unimplemented (guard, resets, loadConflicts fence). Fix: in markResolved `if (_isLoading.value || _isResolving.value) return failure`; set `_isResolving` check-and-set before first suspend; selectFile call `resetBufferState()` + `_isMalformed=false`; add `loadSeq` fence mirroring selectSeq, and don't clear `_isLoading` in loadConflicts finally when nested selectFile launched.
- H2 After successful save, `_diffContent.hunks` (server hunks) are stale but Revert Hunk is re-enabled (`!isDirty`) and `discardHunk` sends `effectiveHunk.index` from stale list -> may revert wrong hunk (destructive). Fix: call `loadDiff(...)` after save success (refreshes hunks + mtime).
- W3 Save result ignored: Workbench `launch { diffController?.saveModified(repo) }` drops `Result`; conflict/error never shown. Surface in `_errorMessage` or return to screen.
- W4 `isEditing` is local to DiffReviewScreen, not reset on read-only transition: Edit -> reveal commit (read-only) keeps TextField shown with Edit/Done hidden; commit diff not viewable until Exit Commit. Fix: `if (isEditing && !isReadOnly)` / reset on isReadOnly.
- W5 `loadDiff` unconditionally resets `_modifiedDraft` — switching file/Exit Commit silently discards dirty draft.
- W6 W-B carried: Workbench effect reloads only if `current.path != openPath`; same-file re-entry shows stale diff after edits.
- W7 Zero unit tests for DiffReviewController/MergeConflictController (save CAS, seq fences untested); phase script 77/77 is structural grep only — it did not catch the missing `project` param.
- W8 `onInspectCommit` still passes `path = ""` when no active tab; `onResolved` still reads `conflictFiles` before async reload (never navigates).
- W9 Leftover commented `// DiffReviewScreen(...)`/`// EditorPanelScreen(...)` in WorkbenchScreen (~653, ~674).

## Suggestions
- Add fake-ApiClient/FileRepository tests: save success/conflict/stat-failure, exitCommitDiff, stale load fence, markResolved re-entrancy.
- Unused `targetStore` params, `NativeReviewSurfaces.kt` stub, duplicate Sha256Digest jvm/android (carried).
- Revert Hunk without confirm; hunk nav counter-only (carried).

## Positives
Exit-commit path minimal; loadDiffSeq fence correct for content/loading; Cancellation rethrown consistently; booleanOrNull parsing; baseline refresh preserves intermediate edits.

## Validation
- `bash tests/test-phase-10-diff-merge-blame.sh` -> 77/77 PASS (structural).
- `cd native-app && ./gradlew --offline :shared:jvmTest --tests '*features.git*' --tests '*BlameValidatorAndCacheTest*'` -> BUILD SUCCESSFUL.
- Not run: full suite, assembleDebug, device/server runtime.

## Reviewed
features/git/{DiffReviewController,DiffReviewScreen,MergeConflictController}.kt; ui/screens/WorkbenchScreen.kt (394-409, 651-699); features/files/{FileRepository,FsWriteCoordinator}.kt; server/src/api/fs.rs (stat params), server/src/fs/ops.rs (mtime CAS).

## Unresolved
- Was W-F intentionally deferred? Source shows no changes for it.
