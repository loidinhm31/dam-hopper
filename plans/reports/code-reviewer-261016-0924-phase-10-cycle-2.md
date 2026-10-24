# Code Review — Phase 10 Native diff/merge/blame (Cycle 2)

Score: **6/10**. 6 of 8 Cycle-1 items verified fixed. Diff-save claim FALSE. Merge/diff controllers still unfenced; new crash + wrong-file-resolve risks. Phase 10 NOT ready to close.

## Cycle 1 remediation check
| Item | Status |
|---|---|
| Revert maps to server `content.hunks`, fail closed | FIXED. `discardHunk` uses `serverHunks.getOrNull(i)?.index`, else failure. Server `HunkInfo.index == git2 hunk idx` (diff.rs:168). Rows tagged by overlap w/ server hunk ranges. |
| Blame cache key match + rebind | FIXED. Lookup/store same `cacheKey`; hit does `copy(snapshotId, modelVersion)`. BUT see W2 (stale across HEAD). |
| Blame invalidate on keystroke, 250ms debounce, fencing | FIXED. `lineAttributions=null` on each content change; `requestBlameDebounced` delay 250ms; callback checks showBlame + activeTabKey + modelVersion. Residual W6. |
| Diff engine cap + Dispatchers.Default | FIXED. `MAX_DP_CELLS=1_000_000L` (4 MB), `recomputeRows` on Default. Residual W7. |
| Diff save baseline-mtime aware, preserves intermediate edits | **NOT FIXED** (C1). |
| Merge nav + Ancestor pane/button + resolve without non-empty | FIXED. `< >` nav, Ancestor tab + "Base" button when present, `allResolved = !hasRemainingConflicts`. Residual W5. |
| CancellationException rethrown | PARTIAL. Done in BlameRepository, loadDiff, discardHunk, saveModified, markResolved. NOT in `selectFile` (catches Throwable) / `loadConflicts` (no catch at all). See C2/C3, W8. |
| Lone-CR line count | FIXED. `computeBufferLineCount` counts `\r`, `\r\n`, `\n` = server `normalize_buffer_content`; tested ("alpha\rbeta"=2). |

## Critical
1. **C1 `DiffReviewController.saveModified` not baseline-mtime-aware** (DiffReviewController.kt:169-170). Stats file *at save time* → CAS always passes → silently overwrites external changes since load. `catch → 0L` fallback hides stat failure. No `res.conflict` handling. After success baseline (`_diffContent.modified`) / hunks never refreshed → later `isModifiedDirty` compares vs stale baseline; no reload. Fix: capture mtime at `loadDiff` (or from stat at load), pass it, on `conflict` surface error, on ok reload diff + update baseline. Also: no UI path edits draft (`updateModifiedDraft` never called; `DiffReviewScreen` is read-only list) → Save button unreachable; either wire editor or drop dead code (YAGNI).
2. **C2 Merge: wrong-file resolve** (MergeConflictController.selectFile/markResolved + MergeConflictScreen:117). `selectFile` sets `_selectedFile=B` immediately but `resultContent/allResolved` keep file A until response; Mark Resolved enabled (only checks `allResolved && !malformed && !resolving`, not `isLoading`) → POSTs A's content to B's path then stages it. Also no request fencing: slow A response after B overwrites B pane. Fix: clear buffer state on select, per-select job cancel/request id, guard `markResolved` on `!isLoading` and content-owner == selectedFile.path.
3. **C3 `loadConflicts` has no `catch`** (MergeConflictController.kt:80-97; try/finally only). `ApiClient.get` throws on non-2xx/network (ApiClient:55-68,208); exception escapes `launch` in Workbench `rememberCoroutineScope` (no CoroutineExceptionHandler anywhere) → uncaught → app crash [INFERENCE: not run on device]. Auto-triggered on entering MERGE panel (WorkbenchScreen LaunchedEffect) for any project incl. non-git. `_errorMessage` never set here.

## Warnings
- W1 **Commit inspect from blame clobbered**: `onInspectCommit` calls `loadDiff(commit)` then `navigateTo(DIFF)`; Workbench `LaunchedEffect(activePanel…)` then fires `loadDiff(path)` (working tree) → `_activeQuery` overwritten, two unfenced in-flight loads, last response wins → commit diff may never display. Fix: skip effect when query already set / pass pending commit target / fence by request id.
- W2 **Blame cache stale across HEAD change**: key has `headOid=null,rootId="."`, epoch never advanced in prod (`advanceTargetEpoch`/`retireOwner` only in tests). After commit/checkout (terminal), unchanged buffer returns pre-commit attribution ("Not Committed") until LRU eviction. Fix: advance epoch on git/fs change events or include server head in validation (re-validate `baseCommitOid`).
- W3 `loadDiff` unfenced: no job cancel/request id; older response/`finally{_isLoading=false}` can overwrite newer. `recomputeRows` launches unordered on Default → older rows can overwrite newer (`setLayoutMode`, drafts).
- W4 Hunk nav only changes counter: no scroll/highlight; "Revert Hunk" destructive w/ no confirm/preview of target hunk. Revert has no revision guard vs workdir drift since load (server re-diffs HEAD↔workdir; index may shift).
- W5 Merge: selected conflict index has no visual/scroll focus in Result TextField; `BOTH_THEIRS_FIRST` not exposed; `hasRemainingConflicts = contains("<<<<<<<")` blocks files legitimately containing that literal. `onResolved` in Workbench reads `conflictFiles` right after `markResolved`, but list reloads async (`loadConflicts` launch) → value stale, never navigates (was "navigate after every file"; now effectively never).
- W6 `requestBlameDebounced`: outer `launch` + later `mutex` registration is order-unsafe on multi-thread dispatcher (older job may cancel newer → no gutter until next edit; fence prevents stale display). `inFlightJobs` never pruned. Works on Main in practice.
- W7 Cap fallback (>1000×1000 mid-region) emits interleaved DELETE/ADD per index — correct but low-quality diff; no test for it. Truncated >10k-line preview still revert-enabled.
- W8 `selectFile` `catch (Throwable)` swallows CancellationException; `markResolved/discardHunk` use `jsonPrimitive.toString().toBoolean()` (`"true"` ok but use `booleanOrNull`).
- W9 Test gap: no tests for hunk mapping/fail-closed revert, BlameRepository cache hit/rebind/debounce/fence, MAX_DP cap, merge stale-file races. Phase script (77 asserts) is grep-structural.
- W10 Leftover commented code `// EditorPanelScreen(...)`, `// DiffReviewScreen(...)` in WorkbenchScreen.kt:650,671. Unrelated reformatting of Replace buttons in EditorScreens.kt:109-111.

## Suggestions
- Dedupe `Sha256Digest.jvm.kt`/`.android.kt` (byte-identical) into shared source set.
- `NativeReviewSurfaces.kt` dead stub; `CommitRevealCoordinator/Request` still unused in prod; `targetStore` unused in both controllers; `GitLineChange`/`lineChanges` unused.
- `isBufferOverLimit` allocates full byte array per call; compute UTF-8 length w/o copy.
- Blame gutter renders N `Text`s, no virtualization; 18.dp vs line height 18.sp misalign on wrap.
- `acceptConflict` normalizes lone CR→LF/CRLF outside region.

## Positives
Hunk revert fail-closed + dirty-buffer guards; lone-CR parity w/ server verified against `normalize_buffer_content`; blame fence logic correct on current-state reads; cache bounded LRU; diff memory now bounded; zero FABs; no content logging.

## Validation
- `bash tests/test-phase-10-diff-merge-blame.sh` → 77/77 PASS (structural).
- `cd native-app && ./gradlew --offline :shared:jvmTest --tests '*features.git*' --tests '*BlameValidatorAndCacheTest*'` → BUILD SUCCESSFUL, all PASSED.
- Not run: full suite, assembleDebug, device/server runtime.

## Reviewed
features/git/{DiffModels,DiffCalculator,LcsDiffEngine,DiffReviewController,DiffReviewScreen,ConflictParser,MergeConflictController,MergeConflictScreen}.kt; features/editor/{BlameCache,BlameRepository,BlameValidator,EditorBlameGutter,EditorScreens,EditorTopBar,NativeTextEditorView}.kt; ui/screens/WorkbenchScreen.kt; server git/diff.rs (hunk idx), git/blame.rs (normalize); tests listed above.

## Unresolved
- Is diff-pane editing in Phase 10 scope? If yes, UI missing; if no, delete draft/save code.
- Where should blame epoch advance (fs watcher vs git status events)?
- Does Workbench scope have a global exception handler (none found in repo) — confirm C3 on device.
