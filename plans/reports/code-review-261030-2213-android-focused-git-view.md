## Code Review Summary

**Score: 4/10 — changes required; implementation/acceptance not complete.**

### Scope and evidence
- Plan: `plans/261030-1617-android-focused-git-view/plan.md`, Phases 01–08; acceptance matrix and qualification/release reports.
- Reviewed changed production Git controllers/models/repositories/Compose hosts, retained workspace/editor/files/terminal binding changes, Android ViewModel/root/dormant workbench cutovers, Gradle smoke discovery, new fixture/runner/instrumentation, regression-test changes and documentation. Test review included boundary fixtures/assertions, not just test names.
- Supporting authorities: README, PDR, code standards, published development rules/code-review skill; current server Git/worktree/terminal contracts.
- Read-only product review. No product/test/plan/task-state edits; this report is the only authored artifact. No duplicate builds/tests run by reviewer.
- Static failure scenarios below are **[INFERENCE] from inspected executable paths**, not claims of reproduced device behavior. Confidence high unless qualified.

**Fresh execution evidence supplied by `FullSuiteValidation`:**
| Gate | Observed result |
|---|---|
| Shared JVM / Android Kotlin + instrumentation compilation | PASS, corrected `cmd.exe` invocation; some compile tasks up-to-date |
| `:shared:jvmTest --rerun-tasks` | 934 passed, 0 failed, 0 skipped |
| `:androidApp:testDebugUnitTest --rerun-tasks` | 231 passed, 0 failed, 0 skipped |
| Fixture `--self-test` | PASS, 12 logged PASS checkpoints; proxy mechanics use test upstream |
| Fixture `--smoke-current-server` | **FAIL, exit 1:** SQLite seed succeeded/server started; `/api/projects` readiness returned **401**; roots/oracle not reached, no success evidence JSON |
| Connected Android / ARM64 / API29 / visual qualification | Not established; hardware/device gates remain open |

No fresh lint/coverage measurement, APK assembly result or standalone six-class live-smoke result claimed by this reviewer. Initial malformed PowerShell Gradle invocation failed before corrected compile invocation; initial JVM task was up-to-date before forced execution.

### Critical issues

**C1 — Fixture imports the real host's JWT signing secret into test evidence and can write real user configuration.**
- `native/android-app/scripts/git-workspace-fixture.mjs:840-865,905-911`.
- Searches real HOME/APPDATA/XDG `dam-hopper/server-token`, reads the existing signing secret, seeds with it, then writes copies beneath the caller's evidence directory. Missing token causes a write under real `~/AppData/Roaming/dam-hopper`, outside the disposable fixture. Copies have no explicit restrictive file mode/ACL. This is not merely a disposable bearer token; copied signing material may belong to the developer's real server.
- Impact: sharing/archiving fixture evidence can expose a real signing key; running tests mutates real host configuration. No actual exfiltration asserted.
- Correction: generate independent cryptographically random signing/MFA material inside an owner-restricted disposable config root; ensure the server/seed resolve that same isolated root; never discover/read/write host credentials. Treat evidence directories from already executed runs as potentially sensitive and assess whether real keys require rotation.

**C2 — Production mutation guard does not protect active dirty editors.**
- `.../features/git/WorkspaceGitSafety.kt:68-85`; production fallback `.../ui/screens/DamHopperMobileApp.kt:372-379`.
- Dirty documents block only when `workspace.isAuthorityRetired == true`; ordinary active dirty buffers fall straight through to `dispatch()`. No Save/Discard/Cancel transaction, dirty revision snapshot, affected-path filtering or final dirty revalidation. Fallback root supplies `retainedDirtyDocsProvider = { emptyList() }` regardless of actual editor state.
- Impact: checkout, discard, pull, reset and file-changing history operations run while unsaved editor contents describe another filesystem revision. Server Git checks cannot see Android-only dirty documents; later save can reintroduce stale content. Retired clean workspaces also pass this guard.
- Correction: use the existing retained document/departure transaction for affected files/whole-target mutations, settle actual Save/Discard/Cancel, freeze/revalidate document revisions and live authority immediately before dispatch; object-only inactive rewrites must not indiscriminately discard active drafts. Remove the fake-empty production inventory.

### Warnings — high priority

**W1 — Revocation does not fence the runtime's own refresh or late host effects.**
- `.../features/git/GitWorkspaceRuntime.kt:64-109,112-123,161-165`; `.../platform/workspace/NativeWorkspaceViewModel.kt:1359-1376,1405-1422` (Android source set).
- `refresh()` launches an untracked job in the long-lived VM scope. `revoke()` does not cancel/fence it or clear `_scope`; a delayed roots response can call `selectRoot/propagateScope` after revocation. Refresh always calls `presentation.revalidateAuthority()` even after roots errors. Every successful old mutation calls host refresh without event-scope admission.
- Safety's `connectionGetter` captures the original immutable `apiClient.connection`, not the currently admitted registry/workspace connection; `assertScopeMatchesBoundOwner` also allows null live connection and checks only generation, not live profile/retirement/root.
- Correction: explicit runtime binding/revocation epoch, runtime-owned child jobs, scope checks after every suspension/before every effect; fail closed on missing current authority. A revoked runtime must never reactivate controllers or shared presentation. ApiClient's registry fencing is helpful defense, not a substitute for host-state fencing.

**W2 — Dropped mutation acknowledgements are reported as rejection, not unknown outcome.**
- `.../features/git/WorkspaceGitSafety.kt:80-85`; `GitChangesController.kt:156-183,264-291`; `LeasedPublishController.kt:125-170`; `GitWorkspaceRuntime.kt:161-165`.
- Guard catches dispatch exceptions, including cancellation, into `Result.failure`. Controller failure branches emit `REJECTED`; outer `UNKNOWN` catches normally cannot observe dispatch transport failures. Runtime refreshes only `SUCCEEDED`; original-owner reconciliation is absent for unknown outcomes. Rewrite snapshots/old receipts can survive the generic failure path.
- Impact: an accepted commit/rewrite/publish with lost response appears rejected, inviting unsafe manual resend and leaving stale mutation baselines. No automatic retry found, but uncertainty semantics and required reconciliation are missing.
- Correction: propagate cancellation; distinguish pre-dispatch guard refusal, explicit domain rejection and post-dispatch uncertainty. Spend baselines/receipts on unknown acknowledgement and reconcile exact original owner without resend.

**W3 — Conflict/active-operation handling exists only as wire methods, not production safety/UI.**
- `.../features/git/GitQueryRepository.kt:129-155`; `GitWorkspaceRuntime.kt:83-109`; `WorkspaceGitSafety.kt:56-85`; `GitChangesController.kt:145-158`.
- Production searches found no conflict/operation query consumers beyond facade declarations. Runtime has no conflict/operation state, guard does not inspect either, stage-all includes conflicted rows, and recovery-terminal method has no production caller. Query failure/unknown states cannot block controls because no such state is loaded.
- Correction: current-owner conflict/operation discovery and explicit blocked/unknown/non-Git presentation; guard all relevant actions, expose exact-target Terminal handoff. Keep native resolve/continue/abort excluded.

**W4 — Core approved navigation is disconnected.**
- `.../features/git/GitChangesView.kt:22,72-119`: `onOpenFileDiff` never invoked; no row click or diff affordance, so Changes cannot enter diff review.
- `GitHistoryView.kt:149,177-190` versus `GitPanelScreen.kt:266-288`: Details uses the old direct dialog without `onOpenFileDiff`; the new `GitRoute.Details` branch has no production navigation producer. File click falls back to six lines of modified content, not the read-only diff route.
- `GitWorkspaceState.kt:54-56,91-100`: route is one value, not nested history; Diff Back always goes directly to Overview, not Details.
- `GitPanelScreen.kt:202-219` / supporting unchanged `GitBranchesWorktreesView.kt:142-166`: worktree list has Remove but no Open action; new switch port is used only during removal.
- Correction: wire real visible Changes/Details/Diff controls and nested Back state, and a guarded worktree Open action. Remove obsolete parallel dialog path rather than maintaining two inspection systems.

**W5 — Root-relative editor mapping and clean-buffer reconciliation incomplete.**
- `.../features/git/WorkspaceGitSafety.kt:173-208`; `GitWorkspaceContracts.kt:24-42`; `GitBranchController.kt:152-172`; `GitHistoryActionController.kt:148-166,268-286`.
- Editor opens raw Git-root-relative path against the workspace target; the tested `gitWorkspaceRelativePath` helper has no production consumer. Nested `lib/foo.kt` under root `nested` opens workspace `lib/foo.kt`, not `nested/lib/foo.kt`.
- Checkout/reset/revert/cherry-pick send empty affected-path lists, so successful FILES events reload no clean documents. Reconciliation matches only path, not full tab target; nested old/new rename mapping and tree invalidation absent.
- Correction: one exact-owner/root-to-workspace projection for open/dirty/reconcile, both rename paths, clean-tab and tree reconciliation of whole-target mutations; retain dirty text and undo.

**W6 — Native graph lacks usable measured row geometry.**
- `.../features/git/GitCommitRow.kt:39-45`; `GitGraphLane.kt:39-48`.
- Canvas gets width-only `defaultMinSize`, no height, and is a child of a non-height-constrained Row. **[INFERENCE, medium-high confidence]** it can measure to zero height, collapsing ancestry. Even with height supplied, row vertical padding leaves gaps between clipped edge segments across successive rows.
- Correction: share explicit row height/full-height graph placement with content; eliminate graph-boundary padding gaps. Require actual mounted Compose measurement/rendering plus phone/tablet ancestry screenshot checks, not only coordinate-helper tests.

**W7 — Retained Git state is largely disconnected from UI; refresh destroys viewed identity.**
- `.../features/git/GitWorkspaceState.kt:29-45,62-88`; `GitHistoryView.kt:32-48,142`; `GitWorkspaceRuntime.kt:96-107`.
- Retained selected OIDs/search/viewport have no production UI writers/readers; list uses composition-owned default LazyColumn state. Entry refresh sets viewed branch to checked-out branch, so tab return/foreground/mutation can lose an intentionally viewed inactive ref. Controllers themselves are replaced on connection generation changes, losing search/selection while separate retained fields stay unused.
- Correction: one retained presentation authority, per-section viewport restoration and explicit branch metadata refresh preserving viewed canonical ref. Avoid duplicate state stores.

**W8 — Terminal binding token does not implement the promised fencing.**
- `.../ui/screens/ProjectTerminalScreen.kt:340,354-361,529-570,628-634,750-800,861-866,887-912`; `.../features/terminal/TerminalAttachQueue.kt:71-82`.
- `surfaceEpoch` starts at 1 and never advances; drain ignores token owner/surface epoch. Stream checks compare the captured repository/connection against itself rather than the currently installed retained binding. Post-write results invoke old callbacks without rechecking binding.
- Stale attach requests explicitly call `controller.failAttach()` after `isCurrent()` becomes false; captured `replayGeneration` is never used. An old queue can fence the same controller's newer replay gate. Passing unit tests cover stale exception/cancellation but not this stale-success/late-connect branch.
- Correction: retained monotonic binding epoch/current-token admission at every callback, stream admission, attach and write result; stale queue performs no gate mutation. Preserve controller/surface/offset identity.

**W9 — Editor transport fencing runs too late and misses failure/overwrite branches.**
- `.../features/editor/EditorTabsState.kt:298-344,356-380,486-499,636-680,767-831`; supporting `EditorTabSaveCoordinator.kt:27-68`.
- Load/range/reload epoch checks cover only Success; retired Error/TargetUnavailable can change current tab state. `saveTab` checks epoch after save coordinator has already called `session.completeSave` and tab transforms; force-overwrite has no transport-epoch fence.
- Correction: capture binding per operation, gate every completion effect before session/tab mutation, including failures/force-overwrite. Rebinding should settle/restart current loading state instead of leaving discarded successful loads permanently loading.

**W10 — Q2 device runner cannot work even once hardware becomes available.**
- `native/android-app/scripts/run-git-workspace-journeys.sh:132-184`; `git-workspace-fixture.mjs:939-1002`.
- Calls finite `--smoke-current-server`, whose `finally` stops proxy/server, then runs connected tests against the stopped ports. `AUTH_TOKEN` remains `""`; evidence file is merely located, never parsed or securely passed. Fixed ports, first-device fallback and no server process assignment further contradict required isolation/exact serial behavior.
- Correction: genuine owned fixture service lifetime spanning instrumentation, protected credential handoff, exact requested device, fresh ports, readiness + cleanup with owned PIDs. Live fixture failure currently blocks before any device evidence; fresh tester observed 401.

**W11 — Qualification tests do not execute the required mounted journeys; some cannot pass logically.**
- `.../androidTest/.../FocusedGitRootSmokeTest.kt:24-84`; `NativeGitWorkspaceJourneys.kt:88-168,205-252,343-382,427-453,561-578,624-636,727-742`.
- Directly invokes navigation/state/controllers with synthetic profile IDs and no-op WebSocket doubles; does not seed/import the real authenticated root profile or click actual Compose controls. Rotation/IME/terminal-grid/dirty-dialog/graph/render assertions claimed in comments are absent. These doubles are test-only, but cannot satisfy real acceptance.
- Journey01 expects Diff → Details while production Back returns Overview. Journey05 invokes rewrite without loading required snapshot, so expects success from a guaranteed `No frozen snapshot` refusal. Journey04 loads snapshot on a different branch from the signed target. Drop-ack test checks existence, not exact dispatch count/external accepted outcome; secondary test never selects a secondary root.
- Correction: real profile/session bootstrap and real WebSocket; click mounted root controls, explicit operation waits, per-action independent oracle and denied-path assertions; isolate mutable Git fixtures between tests. Keep unit doubles separate and accurately labeled.

### Warnings — medium priority

**W12 — Graph work is quadratic on the UI thread and draw allocates needlessly.**
- `.../features/git/GitHistoryView.kt:44-50`; `GitGraphLayout.kt:92,198-202`; `GitGraphLane.kt:35,73,77-85,99-115`.
- Every row filters/scans all edges: O(VE), quadratic even for a long linear history; entire accumulated history is recomputed synchronously during composition. No loaded-history cap. Canvas allocates dash arrays/effect, coordinate data objects, Paths and Strokes each draw, despite documented cached-primitive intent.
- Correction: index edges by source, materialize row segments during routing, compute changed layouts off main with binding admission, cache immutable draw geometry/palette/dash objects. No performance numbers asserted without measurement.

**W13 — Confirmation/error state is not uniformly scope/ref-bound.**
- `.../features/git/GitChangesView.kt:37,172-184`; supporting `GitBranchesWorktreesView.kt:35,173-185`; `GitModalsHost.kt:12-24,224-225`; `GitRewriteActionController.kt:47-65,84-101`.
- Local discard/delete confirmations capture only path/branch name, surviving root scope changes. Confirm uses the controller's new scope. Rewrite snapshot loads lack request/ref sequence and do not clear the previous snapshot while loading; old hash/ref responses can populate current submission. Error dismissal clears only local `pendingError`, leaving equal modal error state unchanged; same error may not reappear.
- Discard additionally invokes `onMutationSuccess()` immediately after dispatch, including failure. Controller-level completion fix does not close this UI callsite.
- Correction: one owner/root/ref/request-bound confirmation/error authority, one actual completion event path, current snapshot identity validation before submit; spend obsolete dialogs and receipts. Do not simply hide errors.

**W14 — Completion/release documentation overstates source behavior and qualification.**
- `docs/architecture/android-native-client.md:309-313,328-338`; `plans/261030-1617-android-focused-git-view/reports/release-readiness.md:25,33-42,51,65-68`; `phase-07-live-qualification.md:55-66,141-150`; overview `plan.md:4,13,23-30,61-63`.
- H2 claims a monotonic event identity absent from `GitMutationEvent`; H4 claims completed-only invalidation contradicted by Changes UI. Handoff/open/retention claims exceed production wiring. Current-server PASS evidence is not reproducible in fresh validation (401). Phase07 qualification tasks marked complete despite explicit criterion that absent hardware blocks completion; overview simultaneously says complete and implementation pending/future evidence. Unchecked task lists remain in several phases.
- Correction: Main/plan owner reconcile implementation versus exercised proof versus blocked qualification, retain historical results with provenance, remove nonexistent component names and unauthorized tablet multi-pane expectation. Do not convert compilation or fixture-only self-test into AC01–AC10 passes. This reviewer intentionally did not change task tracking.

### Positive observations
- No new production WebView/local Git execution or blind-force publication path observed. Shared/platform separation and API29 baseline preserved.
- Explicit owner/root scope, canonical refs, typed wire DTO cutover, exact receipt-bound prepare/publish and read-only diff direction are appropriate foundations.
- Graph algorithm uses OID parent relationships rather than adjacency; tests cover non-topological/missing-parent cases. Default deterministic suite and explicit live-smoke discovery separated cleanly.
- Fresh 1,165 deterministic tests pass; valuable regression coverage, but not evidence for disconnected UI or live/device acceptance.

### Suggestions / recommended order
1. Contain host-secret fixture issue; repair real workspace authority/dirty transaction and unknown-outcome protocol before exposing further Git mutations.
2. Finish root/ref/binding fencing and editor/terminal completion admission; reconcile clean files/tree using exact nested-root mapping.
3. Wire actual user journeys and measured graph row geometry; consolidate retained route/search/viewport/error state instead of parallel legacy paths.
4. Repair isolated authenticated fixture/service lifecycle, strengthen six live smokes (mandatory auth/target, no empty-history success, assert actual operation/independent Git state). `GitDiffLiveSmoke.kt:45-47` only checks assigned query even when fetch fails; `GitRewriteLiveSmoke.kt:91-102` never rewrites; `GitHistoryActionsLiveSmoke.kt:91-95` can pass without an action; sync smoke asserts non-null rather than success.
5. Add focused denied/race regressions that exercise real production host callbacks, plus genuine mounted Compose/Android journeys. Main should run affected deterministic gates once after fixes, then six authenticated external smokes and Q1/Q2–Q6 on the required devices. Do not suppress existing tests or treat unavailable hardware as a pass.
6. Reduce repetitive mutation plumbing after semantics are correct: controllers repeat near-identical try/guard/event/error blocks hundreds of lines long, already diverging on stale callbacks and unknown outcome. Prefer a small explicit common admission/outcome function, not a new framework.

### Metrics / unresolved evidence
- Type coverage: not applicable as TS percentage; Kotlin compilation passed in tester gate.
- Test coverage percentage: not measured. Deterministic tests: 934 shared + 231 Android passing, 0 skipped.
- Lint issue count: not measured. No new lint result claimed.
- Remaining evidence: exact failed smoke auth/config resolution, real authenticated six-smoke runs, mounted UI/rotation/input/visual tests, emulator + physical ARM64/API29/form-factor/security release gates. Product decisions are not the blocker; implementation and qualification defects are.
