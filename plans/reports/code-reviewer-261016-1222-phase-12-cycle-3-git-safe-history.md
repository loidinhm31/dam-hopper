# Code Review — Phase 12 Cycle 3 (Complete Git and safe history workflows)

Score: **6/10** — NOT accepted. C1, C3, C5 fixed. C2 mostly fixed (one repeat-error defect). **C4 still broken in practice, C6 partial, W1 fix ineffective for `& + # =`.**

## Scope
- Reviewed: `native-app/shared/src/commonMain/.../features/git/*` (Git* models/repos/controllers/views/dialogs), `WorkbenchScreen.kt` + `EditorTabsState.kt` diffs, 4 Phase 12 jvmTest classes, `tests/test-phase-12-git-history.sh`, server `git/types.rs`, `api/git.rs`, `git/repository.rs::undo_last_commit`.
- Plan updated: `plans/261015-1647-android-native-app/phase-12-complete-git-and-safe-history-workflows.md` (review status line).

## Cycle-2 criticals — verdict
| # | Verdict | Evidence |
|---|---|---|
| C1 wire DTO + sync error render | **FIXED** | `GitOpResult` = `projectName/operation/success/summary/error/durationMs/worktreePath/targetUnavailable` matches `GitOperationResultResponse` (flatten). `PublishResult.actualRemoteOid` matches. `GitPanelScreen` renders `syncController.error` + per-target banner. `testFetchAndPullWithExactServerWireJson` covers fetch/pull. Push wire not tested (low). |
| C2 outcomes retained | **MOSTLY FIXED** (see H2) | checkout/delete/update/prune/cherry-pick failures → `onError`/`actionErrorResult` → `GitErrorDialog` (message + recommendation + blockedReason). |
| C3 leased dialog | **FIXED** | `LeasedPushDialog`: dismiss + `onPublished` only when `res.isPublished`; controller maps stale-remote → `Blocked`, other → `Error`, both rendered with Close button. |
| C4 active-branch refresh | **NOT FIXED** (H1) | callback never runs; history not reloaded. |
| C5 Undo last commit | **FIXED** | "Undo Commit" in `GitChangesView` → `showUndoCommitDialog` → `GitConfirmSimpleDialog` → `undoLastCommit`; refresh changes/history/hook on ok, error dialog otherwise. Server guards (root/pushed/active-op) cover safety. |
| C6 invalidation hook | **PARTIAL** (H3, H4) | wired: commit, checkout, delete, update, prune, pull, cherry-pick, revert, reset, drop, undo, squash, edit-msg, leased push, create-branch, worktree add/remove. **Missing: cherry-pick-files, revert-files, drop-files. Discard fires prematurely/unconditionally.** |
| W1 query encoding | **INEFFECTIVE** (H5) | `encodeURLQueryComponent()` used but default leaves `& + = # /` raw. |
| Modularity | **PASS** (Git files) | max 198 LOC (`MergeConflictController`); new Git files ≤190; `EditorTabsState` 199. `WorkbenchScreen.kt` still **1000 LOC** (W2 unresolved, +128 wiring). |

## Critical / High issues
- **H1 (C4) Checkout never updates history eligibility.** `GitPanelScreen` branch `onMutationSuccess` calls `branchController.refreshBranches { …historyController.updateScope(sc, active, active) }` then the Workbench `onMutationSuccess`, which calls `gitBranchController?.refreshBranches()`. `GitBranchController.refreshBranches` does `activeJob?.cancel()` → the callback-bearing job is cancelled before/while running; `onLoaded` never fires (controller's own `refreshBranches()` after checkout is also cancelled — 3 refreshes for one action). Even if it fired: `updateScope` only calls `loadHistory` when scope *changed*, so `entries` stay from the previous branch while `viewedBranch/activeBranch` are the new one → Reset/Drop/Revert/Drop-Files gated against the wrong list. `create-branch --checkout` (via `GitModalsHost`) has no history/active-branch update at all. Same for pull/commit: `loadHistory` not called from Workbench `onMutationSuccess`, so History tab is stale after commit/pull/checkout until manual search/load-more. Fix: single refresh path, e.g. `GitBranchController.refreshBranches` returns/awaits and a `GitPanel` coordinator does `refreshBranches().join(); historyController.onActiveBranchChanged(active)` (reloads history + clears selection); make `viewedBranch/activeBranch` `StateFlow`s; drop duplicate refresh in `onMutationSuccess`. Add test (checkout → `isViewingActiveBranch` true, entries reloaded).
- **H2 (C2 residual) Repeated identical failure is silent.** `GitModalsHost` shows error via `LaunchedEffect(modalState.actionErrorResult)`; `GitActionResult` is a data class and Branches-view `onError` never resets `modalState`. Second identical failure (same checkout blocked twice, dirty-worktree again) → equal state → effect not re-run → no dialog after the first dismissal. Fix: hold `pendingError` in `GitPanelScreen` (or hoist `onError` into host) and drop `modalState.actionErrorResult`, or reset it on `pendingError` dismissal.
- **H3 (C6) File-variant mutations bypass hook.** `GitCommitDetailsDialog` cherry-pick/revert/drop-files only set `statusMessage`; no `onMutationSuccess`, no history reload (drop-files rewrites history), no changes refresh, no error dialog. Dialog has no hook param (`onOpenFileDiff` param still unused). Drop Files still has no confirmation (W7).
- **H4 (C6) Discard hook fires immediately.** `GitChangesView`: `controller.discardFile(it); onMutationSuccess()` — hook runs before the async request completes and regardless of failure → blame epoch/diff reload race with the discard. Give `discardFile` an `onResult` and call hook on success only (as `commit` does).
- **H5 (W1) Query encoding still corrupts special paths.** Ran against ktor-http 3.1.0 jar: `encodeURLQueryComponent("/tmp/a&b+c=d e#f%g")` → `/tmp/a&b+c=d%20e#f%25g`; with `encodeFull = true` → `%2Ftmp%2Fa%26b%2Bc%3Dd%20e%23f%25g`. `&` splits params, `+` → space (server form decoding), `#` truncates as fragment. Affects undo/drop/revert `worktreePath`/`root`. Fix: `encodeURLQueryComponent(encodeFull = true)`, or better add `queryParams` to `ApiClient.postJson` (DRY with GET). Existing test asserts only `contains("worktreePath=")`; add a path with `&+#` case.

## Warnings
- W2 `WorkbenchScreen.kt` 1000 LOC; extract `rememberGitControllers` + `gitContent`/`onMutationSuccess` into `GitWorkbenchHost.kt`.
- W5 No in-flight guards: `GitHistoryActionController` (double Revert/Drop/Cherry-pick on repeat tap; confirm dialogs stay open until result), `GitBranchController`, `RemoveWorktreeDialog`, sync buttons. No scope fence after await in `GitHistoryActionController` (hook then runs against new scope — benign).
- W6 `removeWorktree` proceeds to DELETE after discovery even if scope changed; precheck compares raw path strings (no `normalizeProjectTargetPath`).
- W7 `GitCommitDetailsDialog` `catch (_: Exception) {}` swallows load errors + CancellationException; diff pane prints raw `modified`.
- W8 Dead code: `GitMutationRepository.discardHunk` (unused); `GitRepository` facade half-wrapped. `Result.success(false)` from `removeWorktree`/`pruneWorktrees` (`ok:false`) treated as success in `GitModalsHost`/`GitBranchesWorktreesView`.
- W9 Untracked capped at 500, no pagination.
- W11 No fileTree/editor refresh in Workbench hook (still relies on Phase 08 fs watcher); stage/unstage don't hit the hook (acceptable; blame unaffected).
- W12 Test gaps: no tests for push wire JSON, controller `onMutationSuccess` wiring, stale-remote dialog state, checkout→eligibility, repeat-error dialog, special-char query. Structural script (139/139) is pattern-grep only; it passed while H1/H3/H4/H5 exist — not behavior evidence.

## Suggestions
- One `GitMutationOutcome` sink (message/recommendation/blockedReason/recovery) fed by all controllers; remove per-view `onError`/`onMutationSuccess` plumbing (DRY).
- Surface `actualRemoteOid` (short) in stale-remote Blocked text.
- Live disposable-repo verification (plan step 8) still not performed.

## Positive
- All Git files <200 LOC; clean repository split; request/response models server-aligned.
- Leased push: no force fallback, snapshot branch/OID verified, scope captured, stale-remote keeps dialog open.
- Scope fencing after awaits in query/branch/changes/sync/leased controllers; Worktree removal precheck + fresh discovery.
- Undo-last-commit gated by confirm + server blocks; zero FABs; no TODO/FIXME in Phase 12 sources.

## Validation
| Command | Result |
|---|---|
| `cd native-app && ./gradlew --offline :shared:jvmTest --tests 'dev.damhopper.nativeapp.features.git.*'` | BUILD SUCCESSFUL; all listed Git* tests PASSED (tail), none FAILED |
| `bash tests/test-phase-12-git-history.sh` | 139 passed / 0 failed (structural only) |
| Java harness vs ktor-http 3.1.0 jar `encodeURLQueryComponent` (default vs `encodeFull=true`) | confirms H5 (runtime) |
| `wc -l` Git sources / WorkbenchScreen | Git ≤199; Workbench 1000 |
| Not run: androidApp tests, assembleDebug, live server journeys, Compose UI tests | n/a |
| H1/H2/H3/H4 | static code trace (not runtime) |

Metrics: type coverage n/a; line coverage not measured; lint not run; TODO/FIXME 0.

## Recommended actions (priority)
1. H1: single branch-refresh path + history reload + reactive active branch; test.
2. H2: lift pending error state out of `modalState`.
3. H3/H4: route file-variant results and discard through `onMutationSuccess` (on ok), history reload on drop-files, error dialog on failure.
4. H5: `encodeFull = true` / `queryParams` + special-char test.
5. W2 extract Workbench git host; W5 in-flight guards; live verification.

## Unresolved questions
- Show fetch/pull/push `summary`/`error` verbatim or sanitize (remote URLs/credential hints)?
- Is fs-watcher reconciliation accepted for file tree/editor invalidation, or must `onMutationSuccess` refresh explicitly?
- Should cherry-pick (and file-variant picks) require confirmation on a dirty worktree?
- Is the 200-LOC rule enforced for `WorkbenchScreen.kt` (pre-existing 872 LOC → 1000) or Git files only?
