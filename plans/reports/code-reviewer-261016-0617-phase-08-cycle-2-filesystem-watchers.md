# Code Review — Phase 08 cycle 2 (post-remediation)

Plan: `plans/261015-1647-android-native-app/phase-08-filesystem-watchers-search-and-replace.md`
Prior: `code-reviewer-261016-0306-phase-08-filesystem-watchers.md` (4/10)

## Verdict: CHANGES REQUESTED — 6/10
Cycle-1 criticals: #2 (race) and #3 (modal crash) resolved; #1 and #4 resolved for the exact defect cited but residual High gaps remain. No confirmed Critical left; 1 potential data-loss High + several functional Highs block "done".

## Cycle-1 critical verification
| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Live events path match + watchOnly | PARTIAL | `FileTreeState.kt:87-98` watchOnly=true; `:145-155` handles `targetRelativePath` incl `"."`/empty root, `targetRelativeFrom`; matches server `ws.rs:3330-3418` (watch_only ⇒ empty snapshot + relative path). GAP: server watcher `NonRecursive` (`watcher.rs:191`), client subscribes only `path=""` ⇒ expanded subfolders never get live events. GAP: `observeConnectionState` (`:55-61`) rebinds only when `activeSubscription == null`; after socket replace the stale non-null sub is never rebound. |
| 2 | Subscribe/event race | CLOSED (code-read) | `FileTreeSubscription.kt:56-66` UNDISPATCHED collector + UNLIMITED channel before `request`; drain after `onSnapshot` filtered by subId; `FileTreeState.initTreeAndSubscription` subscribes before REST list; generation fence `@Volatile`; dispose/unsub paths cancel+close. No behavioral test proves it (see tests). |
| 3 | Modal uncaught crashes | CLOSED for crash | `FileModalsHost.kt` try/catch around all 4 mutations, shows `dialogError`, keeps dialog. Residual: timeouts silently swallowed (see H3). |
| 4 | Replace safety | MOSTLY | frozen spec: `FileScreens.kt:145-149,157-161` uses `res.query/res.caseSensitive`, `ReplacePreviewSummary` carries them; `applyBatch` `require(!isSearchTruncated)`; workspace scope maps `m.project` (`FederatedSearchCoordinator.kt:61-65`, test `testWorkspaceScopeSearchPreservesProjectIdentity`); REST fallback detects `"binary":true` stub (`FileRepository.kt:88`); CancellationException rethrown. Residual: lossy decode (H1), timeout/abort semantics (H3). |

## Critical
None confirmed.

## High
- **H1 Replace can corrupt files with invalid UTF-8 (potential data loss).** `FileRepository.readFile:63` `binaryBytes.decodeToString()` is permissive (U+FFFD). Server `detect_binary` only probes first 8192 B (`ops.rs:19,101-137`); invalid UTF-8 after that is reported `binary=false`. `applyBatch` then re-encodes + writes whole file ⇒ unrelated bytes destroyed. REST fallback (`apiClient.get` String) same. Fix: strict decode (`decodeToString(throwOnInvalidSequence=true)`, or `text.encodeToByteArray().contentEquals(bytes)` round-trip) ⇒ treat as binary/Failed, no write. Add regression test (bad byte past 8 KiB ⇒ zero writes).
- **H2 Live updates only cover root dir + no rebind on reconnect.** See #1. Decide: per-expanded-dir subscriptions (web `useFsSubscription` is per-path) or refetch-on-expand + visible "live updates root-only" state. Rebind: trigger on `Connected(socketRef)` identity change, not `activeSubscription == null`. Orphaned server subs after subscribe timeout are not reclaimed (delayed-subscribe step 7 of plan).
- **H3 Timeout is mishandled as cancellation.** `WsConnection.request`/`FsWriteCoordinator` use `withTimeout` ⇒ `TimeoutCancellationException` (a `CancellationException`). `readFile`/`executeFsOp`/`applyBatch`/`FileModalsHost` `catch (CancellationException){throw e}` ⇒ (a) one timed-out read/write aborts the whole `applyBatch`, discarding earlier per-file outcomes (violates "report exact changed/conflicted/failed", interrupted replace); (b) dialogs show no error. Convert `TimeoutCancellationException` to a failure at its owning boundary (catch it before the generic branch; keep parent cancellation). A timed-out `write_commit` may have landed: report indeterminate, don't retry blindly.
- **H4 Federation for non-active profiles targets wrong project.** `WorkbenchScreen` (`LaunchedEffect(profiles,…)`): `targetStore.getSnapshot(p.id, null, p.name).target` uses profile *display name* as `project`. PROJECT-scope search against other profiles will 404 → silent partial failure (H6). Resolve each profile's real project/workspace selection (or use WORKSPACE scope), don't invent a target.
- **H5 Dirty protection unwired.** `ReplaceCoordinator.isDirtyFile` default `{false}`; `WorkbenchScreen` passes none (grep: no dirty source anywhere in commonMain). Success criterion "preserves unsaved content" unmet. Gate Replace All until a dirty-buffer provider exists (Phase 09 contract) or wire one.
- **H6 Results/outcomes not surfaced.** `FederatedSearchResult.partialFailures` never rendered; `ReplaceBatchResult.outcomes` only shown as counts (`SearchReplaceView.kt:125-132`) ⇒ cannot see which files conflicted/failed; preview rows (`ReplacePreviewCard.kt:39-46`) show path only, no profile/project (equal paths across servers ambiguous; Key Insight). Filename/path search (`federatePathSearch`) has no UI entry.
- **H7 Test coverage does not prove cycle-1 fixes.** No test for TreeSubscriptionManager (early-event buffering, subId filter, dispose), `handleFsEvent` relative/`"."` mapping, WS `readFile`, successful/conflict `applyBatch` (frozen query, truncated, binary), FsWriteCoordinator ordering, FileModalsHost errors. `testFsEventAndOverflowHandlingDoNotCrash` passes trivially (`handleFsOverflow` sets `_error` before any async work). Static shell test (57) is string-presence only.

## Medium
- Profile switch with `ws == null`: `LaunchedEffect(fileRepo,…)` returns early w/o clearing `fileTreeState`/coordinator ⇒ previous profile's tree stays visible under the new active profile.
- `FileTreeState.observeConnectionState` collector never cancelled on `dispose()` (leaks a coroutine per tree/project switch; body guarded by `isDisposed`).
- `handleFsOverflow` sets `_error="Watcher overflow recovered"` and never clears it; "Directory watcher offline" likewise sticky after later success.
- `onOpenFile = { _, _ -> navigate(EDITOR) }` (WorkbenchScreen) and `FileScreens` `onMatchClick` still discard qualified target+path (cycle-1 Medium, unchanged; Phase 09 dependency — record).
- Preview/search launches not epoch-fenced/cancellable: editing fields clears `replaceSummary` but an in-flight preview/search still publishes stale result; double-tap Confirm launches concurrent batches. Plan step 4 "per-target cancellation" unmet.
- Active→active profile switch overwrites `fileRepo` without `dispose()`; federation effect recreates `FileRepository` per non-active profile on every recompute (never disposed).
- Federated cap takes first 500 in profile order (starves later profiles) — unchanged.
- Replace CAS uses fresh-read mtime (`readResult.mtime ?: currentMtime`): protects read→write only, not preview→apply; server mtime is whole seconds. Acceptable (content re-verified) but document.
- Case-insensitive replace uses Kotlin `ignoreCase` vs server Rust regex `(?i)`; edge Unicode mismatch ⇒ "match no longer present" failures, fails closed.

## Low
- `TreeSubscriptionManager`: after `cancel`, already-buffered events can still be dispatched once (channel `close` vs `cancel`); use `earlyBuffer.cancel()` on teardown.
- `nextReqId` `synchronized` in commonMain — compiles for current JVM/Android targets only; prefer atomicfu/`AtomicLong` abstraction if iOS/Native added. Counter starts 1000; fine.
- `FileModalsHost`: no in-flight guard (double submit duplicates create); single shared `dialogError` across dialogs.
- Root project name starting with `.` makes `flattenVisibleNodes` hide root (edge).
- DRY leftovers from cycle 1 (federated content/path duplication, create file/dir duplication).

## Positive
- Race closure design is correct in shape; generation fencing + disposed flag + mutex-serialized resubscribe.
- Modal error handling consistent, preserves input, rethrows cancellation properly.
- Frozen search spec through preview→apply; fail-closed on truncation in coordinator (not only UI); literal replace.
- Request-id allocator moved to `WsConnection` and shared by all file coordinators (resolves collision class).
- Tree virtualized (flattened `LazyColumn`, per-row key), showHidden toggle, correct selection highlight.
- No Android-local FS use; no content logging; server stays authority.

## Plan success-criteria
| Criterion | Status |
|---|---|
| Actions reach captured target; stale watchers don't update others | Mostly (generation fence ok; rebind/H4 open) |
| Replace reports exact changed/conflicted/failed; preserves unsaved/remote newer | Not met (H1,H3,H5,H6) |
| Tree failures/overflow explicit w/o tearing terminals | Partial (explicit but sticky errors; root-only watch) |
| Verification by exercising consumer behavior | Not met (no runtime/device evidence, no WS-level tests) |
Plan todo list still unchecked; evidence ledger not updated.

## Validation executed
- `bash tests/test-phase-08-filesystem-watchers.sh` → 57/57 PASS.
- `./gradlew --offline :shared:jvmTest --tests 'dev.damhopper.nativeapp.features.files.*' --tests 'dev.damhopper.nativeapp.core.transport.*'` → BUILD SUCCESSFUL, 35 PASSED / 0 FAILED (tasks mostly up-to-date; not `--rerun-tasks`). Not re-run: full 194-unit suite, 384 assertions, assembleDebug (reported by Main; not re-derived).
- No device/runtime evidence exists; runtime watcher behavior unverified.

## Recommended actions
1. H1 strict UTF-8 decode + test. 2. H3 timeout vs cancellation + partial outcome preservation. 3. H2 rebind on socket identity + decide subfolder watch strategy. 4. H4 correct per-profile target. 5. H5 gate Replace All until dirty provider. 6. H6 render outcomes/partialFailures/qualified rows; add path-search entry. 7. H7 behavioral tests (fake WsConnection: events-before-snapshot, reconnect, applyBatch success/conflict/binary/timeout). 8. Fence preview/search/apply with epoch; disable Apply while running.

## Unresolved questions
- Subfolder live updates: per-expanded-dir subscriptions or root-only + refetch-on-expand (server non-recursive)?
- Federation: which project/workspace is authoritative for non-active profiles (profile name is not a project)? Should WORKSPACE scope be default for secondary profiles?
- Where will the authoritative dirty-buffer source live (Phase 09); gate Replace All until then?
- Should timed-out `write_commit` be reported as "indeterminate" with verify-by-stat?
