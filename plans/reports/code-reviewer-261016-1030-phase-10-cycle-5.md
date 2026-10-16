# Phase 10 Review Cycle 5

Score: 9/10. Critical: none.

## Cycle 4 verification
| Item | Status | Evidence |
|---|---|---|
| C1 loadDiff stat `project` | done | DiffReviewController.kt:58 `mapOf("path","project" to target.project)` |
| C1 baselineMtime on current seq only | done | :72-73 inside `if (seq == loadDiffSeq)` |
| C1 saveModified uses baselineMtime + conflict check + reload | done | :150-160 expectedMtime, `res.conflict` fail, `loadDiff` after ok |
| C1 Screen isEditing guard/TextField/Save | done | `isEditing && !isReadOnly`, TextField bound to modifiedDraft/updateModifiedDraft, Save when `isDirty && onSaveModified != null` |
| W-A/W-B exitCommitDiff | done | controller :96, screen button when readOnly && commitHash != null; Workbench effect skips when commitHash != null |
| W-C blank activePath | done | Workbench :660 |
| W-E booleanOrNull | done | discardHunk |
| W-F markResolved guard / selectFile reset / loadConflictsSeq | done | markResolved :~154 guard; selectFile calls resetBufferState() sync; loadConflicts fenced |
| W-G onResolved | partial | Workbench :692-697 reads `conflictFiles` snapshot; works (pre-reload list incl. resolved file, size<=1 => navigate) but racy |

## Warnings
- W1 onResolved race: markResolved launches async loadConflicts, then onResolved reads conflictFiles. If reload finishes first, list excludes resolved file -> with exactly 1 remaining, navigates away wrongly (and reload failure -> empty list -> navigates). Fix: markResolved return remaining count / await load, or compute `remaining = files.filter{path != resolved}` before reload.
- W2 loadConflicts `finally` clears `isLoading` while nested selectFile fetch in flight (spinner flicker; markResolved still safe via `allResolved=false` after resetBufferState).
- W3 saveModified writes `query.path` with `target` only; `query.root` ignored (non-default root diff would write wrong file). Also `loadDiff` after save resets drafts typed during save-in-flight.
- W4 No unit tests for DiffReviewController / MergeConflictController (save CAS, seq fences, exitCommitDiff, markResolved re-entrancy). Phase script is structural grep only (77/77).
- W5 recomputeRows launches unordered on Dispatchers.Default; stale rows can overwrite newer.
- W6 stat failure swallowed -> baselineMtime null -> save fails "missing baseline" with no pre-surfaced reason.

## Suggestions
- Leftover commented `// DiffReviewScreen(...)`, `// EditorPanelScreen(...)` in WorkbenchScreen (~653, ~677).
- Revert Hunk no confirm; hunk nav counter-only (carried).
- Unused `targetStore` params; NativeReviewSurfaces stub; duplicate Sha256Digest (carried).

## Validation
- `bash tests/test-phase-10-diff-merge-blame.sh` -> 77/77 PASS
- `cd native-app && ./gradlew --offline :shared:compileKotlinJvm -q` -> success, no errors

## Unresolved questions
- Should onResolved nav be driven by controller-returned remaining count (preferred)?
- Is `root` param meaningful for FS write path?
