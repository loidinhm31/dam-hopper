# Code Review — Phase 10 Native diff/merge/blame (Cycle 3)

Score: **6.5/10**. C2, C3, W1 (core), W8 (selectFile + markResolved) fixed. **C1 NOT fixed**. Phase 10 not ready to close on C1 alone.

## Cycle 2 resolution check
| Item | Status | Evidence |
|---|---|---|
| C1 diff save baseline mtime / preserves edits / save path | **NOT FIXED** | DiffReviewController.kt:169 still `fileRepo.stat(...).mtime` at save time (CAS always passes); `catch -> 0L` fallback; no `res.conflict` handling; baseline (`_diffContent.modified`, hunks) not refreshed after save. File mtime 09:23 < cycle-2 report 09:26 -> untouched. Only the Save button wiring in WorkbenchScreen:677 + `isDirty` gate exist. `updateModifiedDraft` has zero callers -> Save unreachable. |
| C2 merge selectFile clears + selectSeq fence + Mark Resolved gated | FIXED | MergeConflictController.kt:91-129 clears result/allResolved/dirty/regions at select, `seq == selectSeq` guards writes + `finally`, rethrows Cancellation. MergeConflictScreen:117 `enabled = allResolved && !isMalformed && !isResolving && !isLoading`. |
| C3 loadConflicts try/catch | FIXED | MergeConflictController.kt:70-87 CancellationException rethrow, Throwable -> `_errorMessage` + clear list, finally clears loading. |
| W1 commit reveal vs worktree diff | FIXED (core), regressions below | Workbench effect skips when `current.commitHash != null`; `onInspectCommit` sets query synchronously before navigate. |
| W8 Cancellation rethrow + booleanOrNull | PARTIAL | selectFile rethrows; markResolved uses `booleanOrNull`. selectFile has no boolean parse (claim inaccurate). `discardHunk` still `jsonPrimitive?.toString()?.toBoolean()` (DiffReviewController.kt:140). |

## Critical
1. **C1 still open** (see table). Fix: capture mtime when loading diff (stat in `loadDiff` for non-commit query, store `baselineMtime`); `writeFile(target, path, snapshot, baselineMtime)`; on `res.conflict` -> error "file changed on disk"; on ok -> set baselineMtime=`res.newMtime`, update `_diffContent.modified`/baseline = snapshot, recompute `_isModifiedDirty = draft != snapshot` (already preserves intermediate edits); no `catch->0L`. Then wire a draft editor to `updateModifiedDraft` or delete draft/save code (YAGNI) + remove Save button. Add unit test with fake FileRepository.

## Warnings
- W-A Commit reveal pins Diff panel: after `onInspectCommit`, `current.commitHash != null` makes Workbench effect never load worktree diff again (no exit path; editor tab switch -> Diff stays on old commit diff). Add "close commit view" / reset query on non-reveal navigation.
- W-B Stale worktree diff: effect only reloads when `current.path != openPath`; after editing/saving/staging same file, re-entering DIFF shows pre-edit diff. Also effect key lacks worktree-change reload when path equal.
- W-C `onInspectCommit` passes `path = ""` when no active tab -> blank-path request.
- W-D `loadDiff` still unfenced (no seq/job cancel): stale worktree response can overwrite commit query's content while `activeQuery` says commit (revert enabled under wrong content). `recomputeRows` launches unordered on Default. (carried W3)
- W-E `discardHunk` boolean parse not `booleanOrNull` (W8 remnant).
- W-F Merge: `markResolved` doesn't self-guard `isLoading`/`isResolving` (UI-only gating); `selectFile` doesn't reset `_isMalformed`/ours/theirs/ancestor/original (stale panes while loading; Mark Resolved still safe via `allResolved=false`). `loadConflicts` finally clears `isLoading` while nested `selectFile` fetch still in flight -> spinner flicker; `loadConflicts` has no seq fence (overlapping loads).
- W-G `onResolved` in Workbench reads `conflictFiles` before async reload -> navigation after last resolve still never fires (carried W5).
- W-H Zero tests for MergeConflictController / DiffReviewController / BlameRepository (selectSeq fence, loadConflicts error path, commit-reveal guard, save CAS unverified by tests). Phase script 77/77 is grep-structural only.
- W-I Leftover commented-out `// EditorPanelScreen(...)` / `// DiffReviewScreen(...)` in WorkbenchScreen.kt:~651,~671 (carried W10).

## Suggestions
- Unused: `targetStore` in both controllers, `GitLineChange/lineChanges`, `CommitRevealRequest` coordinator, `NativeReviewSurfaces.kt` stub (carried).
- Dedupe identical `Sha256Digest.jvm.kt` / `.android.kt`.
- Hunk nav still counter-only (no scroll/highlight); Revert Hunk has no confirm.
- Blame cache epoch never advanced in prod (carried W2).

## Positives
Merge race fixed correctly (immediate clear + monotonic seq guarding data and loading flag); error paths surfaced to UI; Cancellation handled uniformly in merge controller; commit reveal guard is minimal and correct for the direct path.

## Validation
- `bash tests/test-phase-10-diff-merge-blame.sh` -> 77/77 PASS (structural).
- `cd native-app && ./gradlew --offline :shared:jvmTest --tests '*features.git*' --tests '*BlameValidatorAndCacheTest*'` -> BUILD SUCCESSFUL.
- Not run: full suite, assembleDebug, device/server runtime.

## Reviewed
features/git/{DiffReviewController,DiffReviewScreen,DiffModels,MergeConflictController,MergeConflictScreen}.kt; ui/screens/WorkbenchScreen.kt (effect ~390-406, panels ~650-700); features/files/FileRepository.kt (stat/writeFile); tests/test-phase-10-diff-merge-blame.sh.

## Unresolved
- Is in-diff editing in Phase 10 scope? If not, delete draft/save/Save-button (resolves C1 by removal); if yes, add editor UI + CAS fix.
- Should commit-diff view have explicit dismiss, or auto-reset when leaving DIFF panel?
