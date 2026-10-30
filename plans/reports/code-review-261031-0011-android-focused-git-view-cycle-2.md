## Code Review Summary — Cycle 2

**Score: 4/10 — changes required; neither previous critical issue is fully closed.**

### Scope / evidence
- Plan folder: `plans/261030-1617-android-focused-git-view/`; Phases 01–08, acceptance matrix, release-readiness ledger and previous review.
- Reviewed changed Git contracts/DTOs/repositories/controllers, retained workspace/root/ViewModel integration, editor/files/terminal binding changes, graph/layout/Compose controls, Gradle discovery, fixture/runner, regression-test assertions and instrumentation, native docs/changelog. Supporting authorities: README, PDR, code standards, published development rules and code-review skill; server signing-key/drop implementations.
- Static review, targeted source ranges and diffs; not a claim that every test-file line received a full audit. No measured LOC/coverage percentage.
- No product, test, plan or task-status edits. This report is the only authored artifact; Main owns plan status and verification. No duplicate builds, tests, linters or device runs executed by reviewer.
- Failure scenarios below are **[INFERENCE] from current executable source**, not reproduced device observations. Confidence high except graph measurement, explicitly qualified below.
- Advisor consultation attempted; tool reports unavailable because executor and Advisor are the same model. No independent Advisor approval claimed.

### Previous critical-fix disposition
| Issue | Improvement observed | Cycle-2 disposition |
|---|---|---|
| Real host signing-secret isolation | Generated fixture signing material now independent; old host key no longer deliberately used as seed/evidence signing key. | **NOT FIXED:** still reads and overwrites the real host key, with failure paths before restoration. |
| Dirty-editor mutation safety | Active matching FILES/TARGETS mutations now refuse dirty buffers; root fallback now supplies real `getDirtyDocumentIds()` instead of unconditional empty inventory. Added direct dirty-path regression. | **PARTIAL:** destructive Drop is classified HISTORY and bypasses new check; approved Save/Discard/Cancel transaction absent. |

### Critical issues

**C1 — Fixture still replaces the real host JWT signing key; seed failure can leave it replaced.**
- Evidence: `native/android-app/scripts/git-workspace-fixture.mjs:840-868,929-943`; `server/src/main.rs:1120-1124`.
- `activeTokenPath` is constructed from real `os.homedir()` and `AppData/Roaming/dam-hopper` or `.config/dam-hopper`. Lines 847–850 read its actual bytes; 853–855 overwrite it with the fixture key. This directly contradicts disposable-only isolation, regardless of the comment at 840.
- `execFileSync(seedBin)` and JSON parsing occur before the cleanup `try/finally` begins at 943. A seed throw/malformed result leaves the replacement key installed. Abrupt termination is also unsafe. If the original read fails, errors are swallowed and cleanup can unlink a pre-existing key because backup remains null. Restoration errors are swallowed too.
- Impact: corruption/deletion of production authentication configuration, potentially broken authentication on subsequent host-server starts; fixture concurrency/restoration can overwrite legitimate changes. No actual corruption/exfiltration asserted by this reviewer.
- Correction: **remove all real-host token discovery/backup/overwrite/restore**. Provision owner-restricted disposable signing/MFA/config/auth storage, verify the actual server OS config resolution points there before startup, and fail closed if isolation cannot be achieved. `SERVER_TOKEN`/APPDATA injection alone is not proof: current server resolves token using `dirs::config_dir()`. If existing binary cannot isolate Windows known-folder resolution, use a disposable OS account/container rather than replacing the user's key. Register cleanup before side effects. Assess prior runs separately; do not execute this path against configured host credentials.

**C2 — Destructive Drop bypasses the repaired dirty-buffer guard.**
- Evidence: `.../features/git/WorkspaceGitSafety.kt:68-97`; `GitHistoryActionController.kt:328-336`; server `server/src/git/commit_file_ops.rs:419-459`.
- Guard checks dirty documents only for FILES/TARGETS. `drop()` supplies HISTORY. Server tip-drop executes `git reset --hard <parent>`; non-tip drop executes rebase. Thus a clean-on-disk repository with an unsaved Android editor buffer still dispatches destructive Drop, despite the new FILES test passing.
- Impact: editor buffers refer to a different filesystem revision and a later save can resurrect discarded content. Server dirty checks cannot observe Android-only edits. This is the remaining concrete bypass, not a claim that every checkout/discard still ignores dirtiness.
- Correction: classify destructive checked-out actions by actual filesystem/index impact and route them through the affected-document safety transaction. Keep object-only inactive message/squash rewrites distinct; do not block/discard unrelated drafts indiscriminately. Implement specified Save/actual Discard/Cancel plus revision/authority revalidation. Add a production-controller Drop regression asserting zero HTTP dispatch with affected dirty text and unchanged document/undo/ref state.
- Improvement acknowledged: `DamHopperMobileApp.kt:379-385` now reads actual workspace dirty IDs; `GitWorkspaceSafetyTest.kt:262-290` covers a matching FILES refusal and unrelated-file admission.

### Warnings — high priority

**W1 — Runtime revocation can be undone by its own late refresh.**
- `GitWorkspaceRuntime.kt:64-109,112-123,161-165`; Android `NativeWorkspaceViewModel.kt:1359-1376,1405-1422`; `WorkspaceGitSafety.kt:42-53`.
- Runtime refresh uses long-lived scope without runtime epoch/job ownership; delayed roots can select/propagate after revoke, and `revalidateAuthority()` runs even after roots failure. Old mutation events refresh without admission against event owner/root/current binding. Safety getter captures immutable old `apiClient.connection`; missing live connection is accepted and only generation compared.
- Fix: runtime binding epoch and owned child work; recheck exact live owner/generation/root/retirement after suspensions and before host effects, fail closed for absent authority. Cancel/fence refresh on revoke.

**W2 — Dropped mutation acknowledgements become REJECTED; cancellation swallowed.**
- `WorkspaceGitSafety.kt:99-104`; `GitChangesController.kt:156-198`; `LeasedPublishController.kt:125-185`; runtime outcome handler above.
- Guard wraps dispatch exceptions, including cancellation, into failure. Callers classify that as REJECTED, so outer UNKNOWN paths do not receive ordinary transport failures. Runtime refreshes only SUCCEEDED; uncertain original-owner reconciliation and baseline/receipt spending are missing.
- Fix: propagate cancellation and distinguish guard refusal, explicit server rejection, and post-dispatch uncertainty. Spend frozen baselines on uncertain completion; reconcile original owner without resend.

**W3 — Conflict/operation discovery and recovery handoff have no production consumers.**
- `GitQueryRepository.kt:129-155`; `GitWorkspaceRuntime.kt:83-109,168-170`; `GitChangesController.kt:145-158`.
- Search of production source finds only repository facade/declarations for getConflicts/getOperation and declaration/implementation for recovery-terminal port. Runtime has no loaded conflict/operation state; stage-all includes conflicted rows. Failed/unknown discovery cannot disable actions.
- Fix: load current-owner conflict/operation/non-Git state, show truthful blocked/unknown status and target-qualified Terminal guidance, guard appropriate controls. Keep native resolver/continue/abort excluded.

**W4 — Core approved Changes/Details/Diff/worktree navigation remains disconnected.**
- `GitChangesView.kt:22,72-119`; `GitHistoryView.kt:142-190`; `GitPanelScreen.kt:266-288`; `GitWorkspaceState.kt:91-100`; `GitBranchesWorktreesView.kt:142-166`.
- Changes never invokes `onOpenFileDiff`. History opens direct details dialog without the new diff callback; Details route has no production navigation producer. Old fallback shows only six modified-content lines. Back always jumps to Overview, not Details. Worktree rows have Remove but no Open.
- Fix: wire real visible controls through one retained nested route authority, delete obsolete duplicate details path, add guarded worktree Open. A direct controller/state test does not prove reachability.

**W5 — Nested-root editor mapping and clean-buffer reconciliation remain incomplete.**
- `WorkspaceGitSafety.kt:192-228`; `GitBranchController.kt:152-172`; `GitHistoryActionController.kt:151-166,271-286`.
- New guard uses root-relative mapping, but editor opening still passes raw Git path against workspace target. Whole-target operations emit empty path lists; reconcile loops no tabs. Matching uses path alone, not exact target; nested rename old/new paths and tree invalidation absent.
- Fix: one exact-owner root-to-workspace projection for open/dirty/reconcile, both rename paths, whole-target clean-tab/tree refresh. Preserve dirty text/undo.

**W6 — Graph Canvas lacks measured row height and contiguous row geometry.**
- `GitCommitRow.kt:39-45`; `GitGraphLane.kt:39-48`.
- Width-only Canvas inside unconstrained-height Row can measure zero height **[INFERENCE, medium-high confidence]**. Row padding also separates row-clipped ancestry segments even after height is supplied.
- Fix: measured shared row geometry/full-height graph placement without inter-row ancestry gaps; actual Compose measurement/render tests plus required phone/tablet screenshots, not just coordinate tests.

**W7 — Retained Git presentation fields unused; refresh resets inactive viewed ref.**
- `GitWorkspaceState.kt:29-45,62-88`; `GitHistoryView.kt:32-50,142`; `GitWorkspaceRuntime.kt:96-107`.
- Retained selected OIDs/search/viewport setters have no production consumers; list owns default composition state. Refresh sets viewed branch/ref to active branch, losing intentionally viewed inactive branch on tab return/foreground/mutation. New-generation runtime replaces controller-owned state.
- Fix: single retained presentation authority; preserve canonical viewed ref independently of checked-out metadata; connect section viewport/search/selection and remove unused duplicate stores.

**W8 — Terminal binding token does not fence stale same-controller effects.**
- `ProjectTerminalScreen.kt:340,529-570,628-634,750-800,861-866`; `TerminalAttachQueue.kt:71-82`.
- Surface epoch starts at 1 and never advances; write drain omits owner/surface checks and calls old result callbacks after suspension without current binding admission. Stream tests compare captured repository with itself. Stale queue paths explicitly call `failAttach()` when `isCurrent()` is false; captured replay generation unused.
- Fix: retained advancing binding epoch and actual installed-binding comparison at every stream/attach/write/result effect. A stale queue must not mutate fresh replay/input gate. Add stale successful-connect/send cases, not only stale exception/cancellation.

**W9 — Editor rebinding admission happens too late / only on successful loads.**
- `EditorTabsState.kt:298-344,356-380,486-499,636-680,767-831`.
- Retired load errors/TargetUnavailable can still change retained state. Save epoch check runs after save coordinator transforms tab/session; overwrite lacks equivalent fence. Discarded successful loads can leave loading placeholders unresolved.
- Fix: capture binding and admit every completion before any session/tab mutation, including errors and force-overwrite; settle/restart loading state on rebind.

**W10 — Device runner cannot maintain a usable authenticated fixture.**
- `scripts/run-git-workspace-journeys.sh:132-184`; `scripts/git-workspace-fixture.mjs:929-1001`.
- Runner waits for finite smoke, whose finally stops server/proxy, then starts instrumentation on stopped ports. AUTH_TOKEN remains empty and evidence is not parsed for handoff. Fixed ports, first-device fallback, and unused SERVER_PID violate required isolation/lifetime/exact-serial semantics. Header advertises --serve but CLI implements no service mode.
- Fix: genuine runner-owned fixture lifetime spanning tests, protected credential handoff, fresh bound ports and exact requested serial, readiness and owned-resource cleanup. Do not run unsafe current fixture as a workaround.

**W11 — Instrumentation and external smokes do not establish required acceptance.**
- `FocusedGitRootSmokeTest.kt:24-84`; `NativeGitWorkspaceJourneys.kt:88-168,356-382,427-453,561-578,624-636,727-742`.
- Synthetic profiles/direct state/controller calls and no-op WebSocket doubles, rather than authenticated root bootstrap and Compose interactions. Journey01 expects Diff→Details, contradicted by Back implementation; journey05 rewrites without required frozen snapshot; journey04 signed target and loaded snapshot refer to different branches. Rotation/input/graph visuals/dirty-dialog behavior not asserted. Drop-ack checks existence, not exact dispatch count or external accepted result. Secondary test never selects secondary root.
- External smoke evidence also weak: `GitDiffLiveSmoke.kt:45-47` checks preassigned query even on fetch failure; `GitRewriteLiveSmoke.kt:91-102` never rewrites and accepts empty log; `GitSyncLiveSmoke.kt:88-90` accepts non-null failed outcomes. Auth/target defaults optional despite mandatory contract.
- Fix: real authenticated mounted journeys and deterministic waits, per-action independent Git state, strict success/denial/count assertions; keep unit doubles honestly labeled. Repair tests that cannot pass before treating unavailable devices as the only blocker.

### Warnings — medium priority

**W12 — Graph layout quadratic on UI thread; draw allocates avoidably.**
- `GitHistoryView.kt:44-50`; `GitGraphLayout.kt:92,198-202`; `GitGraphLane.kt:35,73,77-115`.
- Per-row whole-edge filtering/scanning gives O(VE), including linear-history quadratic behavior; accumulated history has no loaded cap and layout runs in composition. Canvas allocates dash arrays/effects, coordinate objects, Path and Stroke per draw.
- Fix: outgoing-edge index and routing-time row segment materialization; changed layouts off-main with owner admission; cache immutable draw resources/geometry. No frame-time/memory benchmark claimed.

**W13 — Confirmations/errors/snapshots not uniformly scope/ref/request bound.**
- `GitChangesView.kt:37,172-184`; `GitBranchesWorktreesView.kt:173-185`; `GitModalsHost.kt:12-24,224-225`; `GitRewriteActionController.kt:47-65,84-101`.
- Local discard/delete dialogs survive root changes and dispatch using new controller scope. Snapshot loads lack target/ref sequence and retain previous snapshot during load. Dismissing only pendingError leaves equal modal error unchanged. Discard still calls success refresh immediately, even when guard/server later refuses.
- Fix: one owner/root/ref/request-bound confirmation and error authority; invalidate old snapshots, verify exact submission identity, spend obsolete dialogs, emit one actual completion event path.

**W14 — Plan and release docs still overstate source behavior / completed qualification.**
- `plan.md:4,13,23-30,61-63`; `phase-07-live-qualification.md:55-66,141-150`; `reports/release-readiness.md:25,33-42,65-68`; `docs/architecture/android-native-client.md:304-338`.
- Overview marks all complete while declaring implementation pending/future evidence; several phase task lists remain unchecked. Phase07 qualification checked complete despite explicit unavailable-hardware block. Ledger claims only device harness absent, invented mutation event sequence, completed-only discard invalidation and implemented handoff/navigation contradicted above. Earlier test counts/live PASS statements are historical, not reviewer fresh proof.
- Fix: Main/plan owner reconcile source implementation, exercised evidence, and blocked gates; retain provenance for historical results and remove unsupported component/qualification/tablet multi-pane claims. Reviewer intentionally does not update task tracking.

### Positive observations
- Exact logical owner/root/generation scope, canonical refs and typed wire DTOs are appropriate boundaries; no new production WebView/local Git or blind-force publication path observed.
- Leased publication remains distinct from local rewrite and checks returned branch/source OID against receipt. Read-only diff removes duplicate writable authority.
- Dirty FILES/TARGETS refusal and real fallback inventory are useful concrete improvements; unrelated-file dispatch is explicitly tested.
- Graph models use OID ancestry instead of row adjacency; tests cover merge, octopus, missing parents and non-topological order. Deterministic JVM discovery remains separated from explicit external smokes.

### Suggestions / recommended order
1. Contain C1 with genuine disposable OS config/secret isolation; repair C2 destructive-action classification and actual document transaction. Add focused regressions before broader feature work.
2. Close authority revocation, transport completion admission and uncertainty semantics; consolidate repetitive guard/result/event plumbing into a small explicit helper only after semantics are correct, not a new framework.
3. Connect real navigation, retained presentation, conflict/handoff state and nested-root mapping; remove dead duplicate inspection/state paths. Fix graph geometry and unnecessary layout/draw work.
4. Repair fixture lifecycle, mandatory authenticated external smoke assertions and mounted journeys. Main should run one coherent build/JVM/Android unit gate after edits stop, then six real external smokes and Q1–Q6 as required. Do not represent unavailable device gates as passed.
5. Reconcile plan/doc status to actual implementation/evidence. No release approval from compilation, historical pass totals or this review.

### Metrics / unresolved evidence
- Critical: **2**; high warnings: **11**; medium warnings: **3**. Not lint diagnostic counts.
- Fresh tests/build/lint/coverage executed by reviewer: **none**. Independent PostFixValidation owns execution; do not inherit cycle-1 totals as cycle-2 proof.
- Type/test coverage percentages: not measured. No device/render/performance qualification claimed.
- Unresolved evidence: safe fixture OS config resolution, fresh post-fix deterministic and six-smoke results, real authenticated root journeys, mounted graph geometry, emulator + physical ARM64/API29/form-factor/security gates. No unresolved product decision identified.
