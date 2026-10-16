# Code Review — Phase 14 Agent Store imports + memory (Cycle 2)

Plan: `plans/261015-1647-android-native-app/phase-14-agent-store-imports-and-memory.md`. Prior: `code-reviewer-261016-1700-phase-14-agent-store.md` (5/10).

## Score: 7/10

Cycle-1 criticals fixed at UI level (C1) / mostly (C2); W1, W2, W3(review), W4(partial), W7(a,c) verified fixed in code. 0 data-corrupting criticals left, but the C1 fix introduced a Save lock-out after any error, import in-flight race re-opened by W1 fix, absorb UI semantically wrong. Phase NOT closable: no real-server runtime proof (plan step 7), plan/docs ledger not updated by Main.

## Scope
- Files: `features/agents/*` (13 files, ~3.8k LOC; esp. AgentMemoryController/Screens, AgentImportController, AgentStoreController, AgentDistributionMatrixView, AgentStoreModals, AgentStoreScreens), `WorkbenchScreen.kt` diff, `AgentControllersFencingAndDraftTest.kt`, server `distributor.rs` (absorb/unship), `api/agent_import.rs` (confirm/cleanup).
- Focus: verify C1,C2,W1,W2,W3,W4,W7; security, perf, architecture, YAGNI/KISS/DRY.

## Fix verification

| ID | Verdict | Evidence |
|---|---|---|
| C1 | Fixed in UI; controller not self-defending | `loadMemory` clears content + `loadedProject/Agent=null` on non-same target (l.118-133); Save gated `isTargetLoaded && !isLoading && error==null` (`AgentMemoryScreens.kt:111-116`). `saveMemory()`/`savePreviewAsMemory()` (l.301,337) have NO `loadedProject==selectedProject` guard → invariant lives only in a composable. See H1, M1. |
| C2 | Mostly fixed | Non-empty list + target present → draft kept (test `testSetProjectsPreservesDirtyDraft`); target gone+dirty+next exists → `pendingTargetSwitch`. Gaps: empty list drops dirty draft silently (l.97-98 else branch; transient `projects=emptyList()` on workspace switch, `WorkbenchScreen.kt:1135`); dispatch only on `LaunchedEffect(projects)` (H2). |
| W1 | Fixed | `setSource`/`resetScan`/`retire` reset `isScanning/isImporting`; test `testImportSourceChangeResetsIsScanning`. |
| W2 | Fixed | View banner (`AgentStoreScreens.kt:226`, suppressed while a dialog shows it) + `errorMessage` in `DeleteConfirmDialog`, `CellActionDialog`, `ShipItemDialog`. |
| W3 | Fixed (review), semantics flawed | Cell tap → `openCellActionModal` → `CellActionDialog`; buttons `enabled=!isMutating`. But absorb action is wrong (M2). |
| W4 | Partial | absorb, force-unship, `scanProjects` + `ProjectScanResultsDialog` wired. `getItem`, `listProjectMemory` repo methods still have 0 callers (dead; YAGNI or wire). |
| W7 | (a) fixed, (c) fixed, (b) partial, (d) regressed | key = category:name:relativePath; `cleanup` default `false`, derived from captured source; `confirmImport`/`startScan` guarded. See H3, M3. |

## Critical
None new/open. (Cycle-1 C1/C2 downgraded to residual items above.)

## High (warnings, should fix before phase close)

H1. **Save permanently disabled after any error** — `AgentMemoryScreens.kt:116` gates on `state.error == null`, but `error` is a shared field set by failed save (`saveMemory` onFailure), failed template preview, and failed load; `updateContent` never clears it and the error box (l.213) has no dismiss. After one transient save failure the user cannot retry Save; only way out is switching target (discarding draft behind a confirm). Regression from C1 fix. Fix: separate `loadError` from `actionError`; gate Save on `loadedTarget == selected && !isLoading && loadError == null`; clear `actionError` in `updateContent`/on retry. Add test: save fails → content edited → `saveMemory` still allowed.

H2. **New memory controller can miss `setProjects`** — `WorkbenchScreen.kt:579` `LaunchedEffect(projects)` keyed only on `projects`; controller is replaced in the connect effect (l.296-310) *before* `projects = projs` (l.317). If the new list `equals` the previous one (profile/baseUrl re-run that doesn't pass through the disconnected branch, same project set) `mutableStateOf` structural equality → no recomposition → effect not relaunched → new controller has `projects=[]`, no target, empty editor until list changes. Fix: call `amCtrl.setProjects(projs.map{it.name})` explicitly right after assignment (cheap now that `setProjects` is non-destructive; add equal-list early-out to skip duplicate `loadTemplates`), or key effect on `(projects, agentMemoryController)` and clear `projects` first. The cycle-1 "duplicate call" removal caused this.

H3. **Stale import confirm result lands in new state** — `confirmImport` (`AgentImportController.kt:226-263`) captures no revision; only `isRetired` checked. `setSource`/`resetScan` now reset `isImporting=false` (W1 fix), so user can switch source/scan again while confirm is in flight; late result then sets `importResults/importError` and, for REPO+allSuccess, nulls `capturedScan` of the *new* scan, and `isImporting=false` clobbers a newer op. Fix: capture `val rev = scanRevision`; apply state only `if (rev == scanRevision)`; still invoke `onSuccess` (store changed) when anySuccess. No test covers it.

## Medium

M1. Controller-level guards missing (defense in depth): `saveMemory`/`savePreviewAsMemory` must refuse unless `loadedProject==selectedProject && loadedAgent==selectedAgent && !isLoading`; `loadMemory` for same target with dirty draft overwrites on success (no caller today, but public). `saveMemory` has unused `val stillMatches` (dead). `savePreviewAsMemory` button ungated and overwrites dirty editor without confirm (W8 b, unresolved, not in remediation scope).

M2. **Absorb action contradicts server** — `distributor.rs:216-258`: absorb moves a *non-symlink project-local* item into the store, fails if store item already exists or item is already a symlink. `CellActionDialog` offers Absorb only when cell is *shipped* (item is in the store by definition; catalog items always exist) → always fails with "already exists in store"/"already a symlink". Label "Convert to Project-Local Copy" for symlink cells describes behavior the server does not have. Fix: remove from matrix dialog; expose absorb from `ProjectScanResultsDialog` for unmanaged project-local items (where it is valid), with accurate copy ("Move into central store and replace with symlink").

M3. REPO partial import: server runs `cleanup_import` after any per-item results (only skips on HTTP error, `agent_import.rs:76-82`), yet `capturedScan` is retained unless `allSuccess` (`AgentImportController.kt:250`) → Import button stays enabled, retry hits "Source directory does not exist". Null `capturedScan` for REPO on any successful response (keep `importResults` for display); only keep it on transport/API failure.

M4. Force Unship on a copy discards user modifications (server `unship` force skips `content_differs` guard) with no extra warning; show copy only after a non-forced attempt fails with "modified", or add destructive-warning text.

M5. Empty project list silently discards dirty memory draft (see C2 row); no in-flight invalidation either (`readOpRevision` not bumped, `isLoading` can stay true). Decide: keep draft with banner "workspace changed", or prompt.

M6. Regression tests are weak in places: `testImportDuplicateItemNamesRelativePathDeduplication` only asserts two key strings differ (not selection/select-all behavior); `testMemorySaveBlockedWhenTargetLoading` asserts state, not the gating. No tests for H1/H2/H3, empty-list C2 branch, or confirm-path stale results. Timing via `Thread.sleep`/wall-clock `waitUntil` on a real `HttpServer` → flake risk.

## Low / suggestions
- L1. `profileId`/`generation` ctor params in all 3 controllers still never read (owner enforced by instance + `retire()` only); `isRetired`/op counters plain `var` (not volatile). `resetScan` lacks `isRetired` guard.
- L2. Cycle-1 S7 unaddressed: `scanError` may echo `repoUrl` with embedded credentials; scrub userinfo.
- L3. Cycle-1 W6/W9/W10 untouched (uncertain-result reconcile, silent stale matrix/health, sequential matrix+health fetch, full `loadStore` after each mutation). Acceptable to defer only with explicit user-approved descope in ledger.
- L4. DRY: 5 near-identical mutation fold blocks in `AgentStoreController` (ship/unship/absorb/bulk/delete) → one `runMutation{}` helper, also place for in-flight guard (controller has none for overlapping mutations; UI only disables buttons).
- L5. `AgentStoreScreens.kt` 584 LOC (under 800 docs.maxLoc); modularization done for matrix + modals, good.
- L6. Server `import_confirm_handler` still does `remove_dir_all` on client-supplied path when `cleanup=true` (pre-existing, out of diff) — raise separately.

## Positive
- Clean opaque-state fencing: `loadedProject/loadedAgent` identity cleanly models "which target does `content` belong to".
- `cleanup` derived from captured source, default flipped to `false`; local-dir imports never request deletion (test verifies wire body).
- Matrix cell mutations now go through explicit reviewed dialog, per-state actions (ship symlink/copy vs unship/force).
- 0 FloatingActionButton, 0 WebView, no logging of secrets in `features/agents`.
- Retired controllers explicitly `retire()`d on replace/disconnect.

## Validation
| Command | Result |
|---|---|
| `bash tests/test-phase-14-agent-store-memory.sh` (reviewer run) | 99 passed / 0 failed (static grep assertions; cannot detect H1-H3) |
| `cd native-app && ./gradlew :shared:jvmTest --offline -q` (reviewer run) | exit 0 (no failures; quiet mode, likely partly up-to-date — count not independently read: build/ dir blocked by tool policy) |
| `:androidApp:testDebugUnitTest :androidApp:testReleaseUnitTest`, `assembleDebug`, 13-suite regression (953) | Reported by Main, NOT re-run |
| Real-server runtime exercise (plan step 7) | NOT performed — blocker for acceptance |

H1–H3, M2, M3 found by code trace; not executed.

## Recommended actions (priority)
1. H1 split error fields + retry Save + test.
2. H2 explicit `setProjects` on new controller (+ equal-list early-out).
3. H3 revision-fence `confirmImport` result; M3 clear REPO capturedScan after any response.
4. M2 move absorb to project-scan results, fix labels; M1 controller-side save guard.
5. Run plan step 7 against a temp server (symlink/copy/force-unship/import REPO partial, memory save-failure retry); update ledger/docs.

## Plan update
Phase-14 file: status → in review cycle 2, 7/10; todo list updated (C1/C2/W1 marked done-with-residuals; new H1-H3 added).

## Unresolved questions
1. Is absorb intended to be reachable from matrix cells, or only for unmanaged items from project scan (server semantics imply latter)?
2. On empty project list (workspace switch), should dirty memory draft be kept or silently dropped (draft identity lacks workspace)?
3. Are W6/W9/W10/getItem/listProjectMemory approved for descope, or required for phase close?
4. Exact `:shared:jvmTest` count (252 per Main) not independently confirmed.
