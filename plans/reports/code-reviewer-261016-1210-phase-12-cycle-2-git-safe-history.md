# Code Review — Phase 12 Cycle 2 (Complete Git and safe history workflows)

Score: **5/10** — NOT accepted. Cycle-1 criticals mostly fixed; new/residual blockers remain.

## Scope
- Reviewed: `native-app/shared/src/commonMain/.../features/git/*` (Git* models, 5 repositories, 8 controllers, views/dialogs), `EditorTabsState.kt` diff, `WorkbenchScreen.kt` diff (+128), 4 Phase 12 jvmTest classes, `tests/test-phase-12-git-history.sh`; server contracts `server/src/api/git.rs`, `git_diff.rs`, `git/types.rs`.
- Plan updated: `plans/261015-1647-android-native-app/phase-12-complete-git-and-safe-history-workflows.md` (review status).

## Cycle-1 criticals — verification
| # | Item | Verdict |
|---|---|---|
| 1 | Worktree/root routing on all mutations | FIXED. All request models carry `worktreePath`/`root`; matches server bodies (`PathsBody`, `SinglePathBody`, `CommitBody`, `CherryPickBody`, `ResetBody`, `CommitFileOperationBody`, create/delete/checkout/update branch). Fetch/pull use `GitOpTarget`; push `PushRequest` matches `deny_unknown_fields` `PushBody`. |
| 2 | Wire alignment | FIXED for requests (delete `name`, undo/drop/revert query via `RootQuery`, update body, discardHunk via `DiscardHunkRequest`). **Response side NOT aligned for fetch/pull/push (see C1).** Query encoding defect (W1). |
| 3 | Serializable models replace interpolation | FIXED. |
| 4 | Worktree removal precheck | FIXED functionally: `isDirtyTarget`, fresh `listWorktrees`, root fallback via `onActiveWorktreeRemoved`. Gaps W6, W7. |
| 5 | Outcomes surfaced in UI | **PARTIAL — still failing** (C2, C3). |
| 6 | Scope fencing | MOSTLY. Controllers check `scope.matches` after await; `LeasedPublishController` binds `capturedScope`, double-confirm blocked by sync `Publishing` state. Gaps W3, W4. |
| 7 | Unreachable behaviors | PARTIAL. `selectViewedBranch`, oldest-first contiguous squash, file-variant actions in details dialog OK. **undo-last-commit has no UI caller (C5); active-branch eligibility goes stale (C4).** |
| 8 | Invalidation hooks | **PARTIAL** (C6). `blameCache.advanceTargetEpoch` + changes/branches refresh + diff reload exist but fire from few paths; fileTree refresh claimed but absent. |
| 9 | Test coverage | PARTIAL. Query/body assertions added for undo/drop/cherry-pick/delete/update; none for fetch/pull/push, revert*, *-files, checkout/create, root param, scope races, stale-remote UI. |

## Critical Issues
- **C1 — Fetch/pull/push response DTO mismatch (G01).** `GitOpResult` (`GitPublicationModels.kt`) requires `project`, `success`, optional `message`. Server `GitOperationResultResponse` (`server/src/api/git.rs:41`, flatten of `GitOperationResult` in `git/types.rs:121`) emits `projectName`, `operation`, `success`, `summary`, `error`, `durationMs`, `worktreePath?`, `targetUnavailable?`. `ProtocolJson` has `ignoreUnknownKeys` but no aliases → `project` missing ⇒ `MissingFieldException` on every fetch/pull/push; error text (`summary`/`error`) lost even if fixed. Compounded: `GitSyncController.error` is never rendered (`GitPanelScreen` collects only `lastOpResults`/`lastSquashReceipt`) → silent failure. No test covers these endpoints (why it slipped). Fix: `@SerialName("projectName") project`, `summary`/`error` fields (display `error ?: summary`), add fixture test with real server JSON, render `syncController.error`, disable buttons while `isLoading`.
- **C2 — Mutation outcomes dropped in UI (Cycle-1 #5 residual).**
  - `GitBranchesWorktreesView.kt:110,117,67`: `checkoutBranch(...) {}`, `updateBranch(...) {}`, `pruneWorktrees {}`; delete branch `deleteBranch(...) {}` (line ~120 in dialog). Blocked/dirty/checked-out-elsewhere/conflict results (with `recommendation`) never shown; successful checkout does not call `onMutationSuccess`.
  - `GitPanelScreen.kt:108-114` cherry-pick: only `if (res.ok)`; failure/conflict ignored, no confirmation either.
  - `GitModalsHost` pending-error dialog shows `recommendation ?: message` (drops message/`blockedReason`/`recovery`); `GitModalState.actionErrorResult` unused.
- **C3 — Leased publish abort invisible (G03).** `LeasedPushDialog.kt` `confirmPublish { onPublished(it); onDismiss() }` closes the dialog for *every* result incl. `stale-remote`/`rejected`/`auth-required`; `Blocked`/`Error` states never displayed and `onPublished` runs history reload + invalidation as though published. User cannot see that the lease aborted. Fix: dismiss/invalidate only when `res.isPublished`; keep dialog open for non-success.
- **C4 — Stale active-branch eligibility (G02).** `GitHistoryController.activeBranch` set only in `updateScope`; after checkout/create-with-checkout/worktree changes nothing updates it (`refreshBranches()` has no callback in `onMutationSuccess`/controller). `isViewingActiveBranch` then gates Reset/Drop/Drop-Files on the wrong branch. Server preconditions limit blast radius (HEAD-based ops with a hash), but UI offers destructive actions for a branch that is no longer checked out. Also `viewedBranch`/`activeBranch` are plain `var`s read in composition (works only because loading flows recompose). Fix: derive active from `GitBranchController.branches`/StateFlow, expose as state.
- **C5 — Undo-last-commit unreachable.** `GitHistoryActionController.undoLastCommit` has zero UI callers (grep). Plan success criterion: all baseline routed actions reachable.
- **C6 — Invalidation not wired on most mutation paths (Phase 12 step 7, plan #8).** `onMutationSuccess` is not invoked for: commit, discard, stage/unstage, checkout/delete/update branch, pull, push/fetch (only `changesController.refreshChanges()`), file-variant pick/revert/drop in `GitCommitDetailsDialog` (also no history reload after history-rewriting `drop-files`). `FileTreeState.refresh()`/editor reload are not called anywhere in the hook; relies on Phase 08 fs watcher events (not guaranteed; overflow). No authoritative refresh after failed/ambiguous result (exception, `conflict=true`, partial cherry-pick) — plan step 7 requires it.

## Warnings
- W1 `GitHistoryMutationRepository.buildQuery` uses `encodePathSegment` for query values (Ktor path encoder leaves `& + = ;` unescaped [INFERENCE from Ktor `VALID_PATH_PART`, not run]) → a worktree path containing `+`/`&` corrupts target resolution for drop/revert/undo. Query repo uses `parameter(k,v)`. DRY: add `queryParams` to `ApiClient.postJson`.
- W2 `WorkbenchScreen.kt` is now exactly 1000 LOC (+128 git wiring); breaches <200 LOC modularity. Extract `GitControllers` holder / `rememberGitControllers` + `gitContent` into `GitWorkbenchHost.kt`. Other new files ≤198 LOC OK.
- W3 `LeasedPublishController.prepare` has no job/epoch fence: `cancel()` during `Preparing` then late response flips state to `Ready`; concurrent prepares race. `prepareWithReceipt` ignores `receipt.scope` (does not require `receipt.scope.matches(activeScope)`); only branch/oid equality guards it.
- W4 `confirmPublish`: if scope changes mid-publish, result is dropped (state reset to Idle, `onComplete` skipped) although push may have occurred.
- W5 No in-flight guards: `GitHistoryActionController` (double Revert/Drop/Cherry-pick via repeat tap; confirm dialogs stay open until result), `GitBranchController`, `RemoveWorktreeDialog`, sync buttons. Double revert creates a second revert.
- W6 `removeWorktree` proceeds to DELETE after the discovery re-fetch even if `scope` no longer matches (ApiClient owner fence is the only guard). `isDirtyTarget`/`hasActiveTerminal` compare raw `worktreePath` strings, not `normalizeProjectTargetPath` (trailing slash/`.` mismatch → missed block).
- W7 `GitCommitDetailsDialog`: `catch (_: Exception) {}` swallows load errors and `CancellationException`; file-variant destructive Drop Files has no confirmation; `onOpenFileDiff` param unused; diff pane prints raw `modified` content, not a diff.
- W8 Dead/duplicate code: `GitMutationRepository.discardHunk` (unused; `DiffReviewController` has own wire), `GitRepository` facade half-wrapped (callers mix `repository.stage` and `repository.mutation.discard`), `GitModalState.actionErrorResult`.
- W9 Untracked list capped at first 500 (`getUntracked(...,0,500)`), no pagination UI.
- W10 `GitSquashDialog` names `selectedHashes.lastOrNull()` "oldest" — list is oldest-first, so it loads the *newest* commit's message for the template. Harmless to safety (hashes sent oldest-first match server `squash_commits`), misleading.

## Suggestions
- Add tests: fetch/pull/push with real server JSON; revert/revert-files/cherry-pick-files/drop-files/checkout/create payloads incl. `root`; encoded query with `&`/`+` path; stale-remote keeps dialog; late prepare after `cancel()`; double-tap history action; checkout → eligibility; scope change mid-removal.
- Single `GitMutationOutcome` surface (snackbar/dialog host) that all controllers feed; include `message`, `recommendation`, `blockedReason`, `recovery`.
- Make structural script (`tests/test-phase-12-git-history.sh`, 136 grep assertions) non-evidence for behavior; it passed while C1–C3 exist.
- Live-server verification (plan step 8) still not performed.

## Positive
- All new files <200 LOC; clean split query/mutation/history/branch/publish repositories.
- Request models fully serializable, server-aligned; `deleteJson` DELETE-with-body and `RootQuery` POST routes handled.
- Squash: contiguous, oldest-first, signature-consent flow keyed on server `signature-consent-required`.
- Leased push never falls back to force; snapshot branch/source OID verified; zero FABs.
- Scope fencing (`GitOperationScope.matches`) consistently applied after awaits.

## Validation
| Command | Result |
|---|---|
| `cd native-app && ./gradlew --offline :shared:cleanJvmTest :shared:jvmTest --tests 'dev.damhopper.nativeapp.features.git.Git*'` | BUILD SUCCESSFUL; Git* tests listed PASSED, none FAILED (tail of output; first run also BUILD SUCCESSFUL) |
| `bash tests/test-phase-12-git-history.sh` | 136 passed / 0 failed (structural pattern checks only) |
| Static review vs `server/src/api/git.rs`, `git_diff.rs`, `git/types.rs` | C1 mismatch confirmed by source (not by runtime) |
| Not run: androidApp tests, assembleDebug, live server journeys | n/a |

Metrics: Type coverage n/a; line coverage not measured; lint not run; TODO/FIXME in Phase 12 sources: 0.

## Recommended actions (priority)
1. C1 fix `GitOpResult` + test + render sync errors.
2. C2/C3 surface all outcomes; keep leased dialog open unless published; route all mutation successes through `onMutationSuccess` and refresh on failed/ambiguous results.
3. C4 reactive active branch; C5 undo-last-commit entry with confirm.
4. W1 query encoding; W3/W5 job+in-flight fences; W2 extract Workbench git host.
5. Live disposable-repo verification (plan step 8), then update plan todos.

## Unresolved questions
- Should fetch/pull/push per-target `summary`/`error` text be shown verbatim or sanitized (may contain remote URLs/credentials hints)?
- Is fs-watcher reconciliation accepted as the mechanism for file tree/editor invalidation, or must explicit refresh be in `onMutationSuccess`?
- Should cherry-pick (and file-variant picks) require confirmation on a dirty worktree?
