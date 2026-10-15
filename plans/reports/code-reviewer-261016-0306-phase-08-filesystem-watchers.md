# Code Review — Phase 08 Filesystem watchers, search and replace

Date: 2026-10-16 | Reviewer: Phase08Reviewer | Plan: `plans/261015-1647-android-native-app/phase-08-filesystem-watchers-search-and-replace.md`

## Verdict: REQUEST CHANGES — score 4/10

Static/unit gates green, but watcher path, subscription race, replace identity and UI crash paths fail phase success criteria. Tests do not exercise watcher/write-protocol/fencing behavior, so green != proven.

## Scope
- Files (all `native-app/shared/src/commonMain/.../features/files/`): FileModels, FileRepository, FsWriteCoordinator, FileTreeSubscription, FileTreeState, FileTreeHelpers, FileMutationCoordinator, SearchModels, SearchRepository, FederatedSearchCoordinator, ReplaceModels, ReplaceCoordinator, FileScreens, FilesTopBar, FileTreeItemView, SearchReplaceView, FileActionDialogs, FileModalsHost; `ui/screens/WorkbenchScreen.kt` diff (+52).
- Tests: FileRepositoryTest, FileTreeStateTest, SearchAndReplaceTest, FileScreensPhase08Test, tests/test-phase-08-filesystem-watchers.sh.
- Server contracts cross-checked: `server/src/api/ws.rs` (do_fs_subscribe, pump_fs_events, do_fs_read, do_fs_op, write_begin/chunk/commit), `server/src/api/fs.rs` (search), `server/src/fs/watcher.rs`, `packages/ui/src/hooks/use-fs-subscription.ts`.

## Critical
1. **Live events never match tree nodes.** `FileTreeState.resubscribeLocked` subscribes `watchOnly=false`. Server (`pump_fs_events`, test `fs_event_pump_preserves_absolute_paths_and_watch_only_target_identity`) then emits ABSOLUTE `event.path` and NO `targetRelativePath` (only set when watchOnly). `handleFsEvent` uses `targetRelativePath ?: path.trim('/')` → `home/u/proj/src/a.rs` → `findNode` null → no refresh, ever. Also non-watchOnly sends a full recursive `tree_snapshot` that is discarded (perf waste). Fix: `watchOnly=true` (empty snapshot, relative paths incl. `"."`) or relativize absolute path against target root. Note server watcher is NON-recursive (`watcher.rs:191`) → one root subscription only covers depth-1; expanded subfolders need per-directory subscriptions (web hook subscribes per path).
2. **Subscription/event race not closed.** (a) `initTreeAndSubscription` REST-lists root BEFORE subscribing and ignores `onSnapshot` → changes between list and subscribe lost. (b) `TreeSubscriptionManager.subscribe` starts collecting `incomingMessages` (SharedFlow, replay=0, `WsConnection.kt:61`) only after `subIdDeferred` completes; server starts pump right after snapshot → early `fs:event`/`fs:overflow` dropped. Comment "Pre-activate event listener" is inaccurate. Fix: attach collector (UNDISPATCHED / `onSubscription`) before sending request, buffer events by sub_id, reconcile baseline (snapshot or list-after-subscribe), then drain; repeat on overflow/reconnect.
3. **UI coroutines crash app on mutation failure.** `FileModalsHost` launches `mutationCoordinator.createFile/rename/delete…` with no try/catch. `sanitizePath`/name `require()` throws IAE; `wsConnection.request` throws timeout/ConnectionOwnerError. Uncaught in composition scope = process crash. `FsOpOutcome` is ignored so server rejections never shown. Fix: catch non-cancellation errors, surface in dialog/tree error state.
4. **Replace can write wrong content/target.**
   - `FileScreens` passes live `searchQuery`/`caseSensitive` text fields to `applyBatch`, not the query/options of the completed search (`searchResult.query` unused). Edit field after search → replace applies different text to previously enumerated files. Need immutable search spec carried into preview/apply.
   - `SearchRepository` WORKSPACE scope ignores `SearchMatchDto.project`; all matches are tagged `binding.target` (active project) → replace would read/write path in the wrong project. Latent only because UI uses PROJECT scope, but API is public.
   - REST read fallback in `FileRepository.readFile` (on any WS throw) treats server's `{"binary":true,"mime":..}` JSON stub as file text (`fs.rs:248`) and sets `isBinary=false` → replace can overwrite a binary file with the stub if the search string occurs in the stub.

## Warnings (High)
- **Dirty blocking not wired.** `isDirtyFile` defaults `{false}` and WorkbenchScreen passes none; no editor dirty source exists. Success criterion "preserves unsaved content" unmet end-to-end (needs a dirty-buffer registry contract before Phase 09).
- **Federation not delivered in app.** WorkbenchScreen builds bindings from the active profile only and `replaceCoordinator` provider returns repo only for active profile. "all-connected-profiles" and equal-path-across-servers never exercised; result rows show `path:line:col` with no profile/project label (Key Insight violated).
- **Preview never displayed.** `replaceSummary` only gates the Replace All button; per-file counts, dirty-blocked files, truncation not rendered. Confirmation is blind.
- **No rebind/reconnect handling.** FileTreeState never observes `WsConnection.state`; after socket replacement the server subscription is gone and tree silently stops updating. Subscribe/overflow re-subscribe failures swallowed (`catch (_: Throwable)`) — no explicit error state (success criterion: surface overflow/failure state).
- **Write-result waiter race (probabilistic).** `FsWriteCoordinator` creates `async { incomingMessages.first{…} }` after `write_ack` with default start, then sends chunk+commit; collector may register after `fs:write_result` (no replay). Register waiter before commit (UNDISPATCHED/CompletableDeferred keyed by write_id in correlator).
- **req_id allocator per FileRepository (starts 1000)**, not per WsConnection. Repo is recreated on profile re-select while WsConnection persists; `WsRequestCorrelator.register` overwrites duplicate ids → hung/misrouted requests. Other Phase 09+ repos will collide. Move allocator to WsConnection.
- **Stale collapsed folders.** Events only refresh expanded/root dirs; re-expanding a previously loaded collapsed dir (`toggleFolder` with non-empty children) shows stale data. Invalidate children or refetch on expand.
- **No request epochs** on `loadDirectory`/`refreshDirectoryIfLoaded`/`refreshLoadedDirectories`: concurrent listings last-writer-wins; per-event refetch with no coalescing (burst = N list calls). `subscriptionGeneration` is non-volatile plain `ULong` read cross-thread.
- **Cancellation swallowed.** `catch (e: Throwable)` in `readFile`, `applyBatch`, FederatedSearch swallows `CancellationException`; cancelling a batch loses all partial outcomes (next `ensureActive` throws) — contradicts "report exact changed/failed files" for interrupted replace.
- `dispose()` (repo and FileTreeState) cancels collectors but repo path sends no `fs:unsubscribe_tree`; no disposed flag so in-flight `resubscribeLocked` can create a subscription after dispose. Profile-switch path (WorkbenchScreen:130) replaces `fileRepo` without disposing old repo.
- Federated per-profile `max=500` then `take(500)` in profile order → first profile starves others; cap is correct but unfair. Server returns ≤1 match/line so counts understate.

## Warnings (Medium)
- No `showHidden` toggle anywhere in UI (`setShowHidden` unused) → hidden files permanently hidden; plan requires hidden-file decorations.
- `FileTreeNodeRow` passes parent's `isSelected` to all children (highlights wrong rows); whole tree rendered inside one `LazyColumn` `item{}` → no virtualization for large expanded trees (network expansion is lazy, rendering is not).
- `onOpenFile` in WorkbenchScreen drops target+path and just navigates to EDITOR — contradicts "qualified resource route, not ambient selection".
- Client validation weak: `sanitizePath` substring `".."` rejects legit names like `a..b`, while name `".."`/`"."`/backslash/NUL pass for create/rename; root (`""`) delete/rename selectable (server rejects). Server stays authority; still add client guards.
- Replace: "match no longer present" is reported as `SkippedDirty` (mislabel); `applyBatch` doesn't itself enforce `isSearchTruncated` (UI-only guard). Server mtime is seconds → CAS blind to same-second remote edits (server limitation; disclose in docs).
- `unexpected response` errors interpolate whole `ServerMsg` (`"$response"`) — avoid body content in diagnostics.
- Plan step 6: only tree invalidated after mutations; editor/Git invalidation hooks absent (Phase 09/12 dependency, document).

## Suggestions (Low)
- DRY: `FederatedSearchCoordinator` content/path paths ~70 duplicated lines; `searchContent`/`searchPaths` duplicate param building; `FileMutationCoordinator` create file/dir duplicated; three dialogs duplicate card skeleton; parent-path computation duplicated in FileModalsHost; `trim('/').trim()` repeated in helpers. Drop `Result.success(Pair(..))` wrapper.
- `FileRepository.nextReqId` uses `synchronized(Mutex)` — use an atomic counter.
- `SearchRepository` ↔ `FederatedSearchCoordinator` circular `this` dependency; pass a function.
- Query text travels in URL query string (`q=`): contract-fixed, note in security doc.
- Reduce `FsWriteCoordinator` error mapping: all begin failures become `ConnectionOwnerError(UNAVAILABLE)` (PATH_REJECTED/TOO_LARGE misclassified).

## Positive
- No Android-local filesystem usage; all paths project-relative and sent to server sandbox; `profileId` never on wire (`ProjectTargetRef.toServerPayload`); no content logging found.
- Target qualification carried on `FileTreeNode`, `QualifiedSearchMatch`, `ReplaceFilePreview` (profileId+target+path); preview groups by Triple.
- 3-step write protocol shape correct vs server (begin→ack, chunk seq0 eof, commit→result keyed by write_id; CAS via `expected_mtime`; conflict flag mapped to `Conflict` outcome).
- Request correlation via `WsRequestCorrelator` (req_id; bounded in-flight; socket-bound) used for subscribe/read/op/write_begin.
- Literal, regex-free replace (`replaceLiteral`) tested for `$`, `\`, emoji; Replace All disabled when results truncated; 500 cap + truncation flag present; partial failures per profile isolated; overflow → resubscribe + refetch without touching terminals.
- Lazy per-directory loading (network); sort dirs first; mutation errors in tree are node-local.
- Modularity: every file < 200 LOC (max 194, FileRepository).

## Plan success-criteria check
| Criterion | Status |
|---|---|
| Actions reach captured target; stale watchers don't update other targets | Partial (generation fence exists; rebind/epochs missing) |
| Replace reports exact changed/conflicted/failed; preserves unsaved/remote newer | Partial (dirty unwired, stale query, cancellation loses outcomes) |
| Tree failure/overflow explicit state w/o terminal teardown | Partial (no teardown, but errors swallowed; no explicit overflow/subscribe-failure state) |
| Verification by exercising consumer behavior | Not met (no runtime/device evidence, watcher behavior untested) |
Todo list in phase file remains unchecked; evidence ledger not updated.

## Validation executed
- `bash tests/test-phase-08-filesystem-watchers.sh` → 57/57 PASS (string-presence only; does not prove watcher/write correctness).
- `./gradlew --offline :shared:jvmTest --tests 'dev.damhopper.nativeapp.features.files.*' --rerun-tasks` (pipefail, log redirected) → `BUILD SUCCESSFUL`, exit 0. Main's reported 192 unit / 384 static assertions not re-derived (build dir reads blocked).
- Test-gap: `testFsEventAndOverflowHandlingDoNotCrash` asserts only `error == null` with no WS; no tests for subscription, events, generation fencing, write protocol, search cap, dirty-race, target equal-path. Required new tests: events immediately after snapshot; write_result before waiter; overflow/reconnect; late subscribe response after target switch; workspace matches from two projects; edited search controls before replace; real dirty editor; cancellation partial outcome.

## Recommended actions (priority)
1. Fix event path (watchOnly=true or root-relativize) + per-expanded-dir subscriptions; close subscribe race (buffer-then-reconcile); add rebind on socket change.
2. Wrap UI mutation/replace calls; show errors; guard root/`.`/`..`.
3. Freeze search spec (query, case, scope, per-match project target) into results → preview → apply; render preview; fix workspace `project` mapping; remove or harden REST fallback binary stub.
4. Introduce dirty-buffer provider contract and wire (or explicitly gate Replace All until Phase 09); wire multi-profile bindings + profile label in results.
5. Move req_id allocator to WsConnection; register write-result waiter before commit; rethrow CancellationException; return partial replace result on cancel.
6. Add behavioral tests listed above; add showHidden toggle, selection fix, virtualization; DRY cleanups.
7. After fixes, record runtime/device evidence per execution guide; tick plan todos.

## Unresolved questions
- Should Android subscribe per expanded directory (like web `useFsSubscription`) or rely on root-only + refetch-on-expand given server's non-recursive watcher?
- Is multi-profile federation expected in Phase 08 UI, or only coordinator-level proof (plan says all-connected-profiles)?
- Where will the authoritative dirty-buffer source live (Phase 09 editor)? Gate Replace All until then?
- Is `/api/fs/read` REST fallback required at all, given binary stub and missing mtime/binary flags?
