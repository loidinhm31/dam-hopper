# Native Android Agent Hub Remediation — Cycle 4

## Score: 6/10 — changes requested

Automated suite is green by FinalTester's fresh report; technical acceptance remains incomplete. Important improvements: privacy-dialog suppression, retained-dirty save denial, qualified project-selection fences, upload selector cutover, command reconciliation and termination-version checks. Five critical invariant groups remain.

## Scope and evidence

Reviewed the working-tree remediation diff (21 Kotlin files, +453/-95 at initial inspection), surrounding production paths, prior Cycle 3 findings, PDR, standards, plan and binding C1–C10 contracts. Approx. 3,000 source/test lines inspected; not a full-repository audit. Loaded published development rules and code-review skill. LSP status: no language servers configured; source tracing used reads/search instead.

Paths below relative to `native/android-app/`:
- `common/`: `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`
- `android/`: `androidApp/src/main/kotlin/dev/damhopper/nativeapp/`

No product, plan, task-state or test changes. This report is the only reviewer-authored file. Per ownership constraints, no reviewer build/test/lint execution. Findings are source-backed; predicted runtime impacts are [INFERENCE], not reproduced device results.

## Critical issues (5)

### C-01 — Hub capability/navigation cutover remains incomplete

**Evidence:** `common/ui/screens/DamHopperMobileApp.kt:843-856,1180-1208,1246,1264`; `android/platform/workspace/NativeWorkspaceViewModel.kt:1311-1327,1964-1983,2050-2091`; `common/features/workspace/AgentHubModels.kt:17-30`; `common/ui/flow/AppFlowNavigation.kt:238-279`.

- With no project, the root always renders `AgentHubEmptyRoot`. Workspace Files/Editor actions merely select a panel on the first retained project workspace, if any. They neither create a workspace-scoped stage nor change the root branch. Fresh-login clicks do nothing; retained-state clicks can mutate an unrelated project's invisible panel. Dispatching a Workspace target is not implementing workspace access.
- Terminal row selection now supplies its project/worktree, but calls guarded `selectProject()` and immediately calls `selectSession()`/mutates panel/session state regardless of deferred consent. Cancelled/busy departure can therefore leave the original workspace's selection modified. On confirmation, `directSelectProject()` clears the prematurely assigned session.
- `incarnationExact` is passed by the rendered row but never consumed by its handler. No captured connection/socket/incarnation validation precedes row routing. Free-terminal rows still lack independent profile ownership; the renderer substitutes the active profile for a row from another connected server.

**Impact [INFERENCE]:** unusable projectless capabilities, wrong-owner/equal-ID routing, incorrect session after consent. **Correction:** wire a real workspace capability stage; use the existing verified-terminal activation/admission transaction for the captured qualified row, including free terminals. Do not mutate navigation or workspace state before consent and fresh validation. **C1/C2/C4/C8; high confidence.**

### C-02 — Missing identity still grants editable admission

**Evidence:** `common/features/editor/EditorContentLoader.kt:86-105`; `EditorTabsState.kt:374-415,430-466,637-669`; `EditorRepository.kt:115-129`.

The loader computes `hasVerifiedIdentity` but returns editable `Success` either way, substituting null for unsupported identity. Tabs still manufacture target/path/epoch-zero fallback keys and install editable NORMAL/DEGRADED documents. The save port only checks epoch when identity happens to exist; ordinary tab saves use `saveFile`, which does not execute that check.

**Impact [INFERENCE]:** aliases can obtain separate dirty buffers and identity-less baselines retain write authority. **Correction:** reject missing/invalid same-content-response identity before editable publication, or explicitly downgrade to a read-only representation. Require a qualified identity on every write path; never treat a fallback key as editable authority. **C4; high confidence.**

### C-03 — Reconnect authority is tracked by dirty alias IDs, not retained documents

**Evidence:** `common/features/workspace/ProjectWorkspaceState.kt:290-340,343-397,537-544`; `common/features/editor/EditorTabsState.kt:342-359,374-415,862-869,1059-1068`; `android/platform/workspace/NativeWorkspaceViewModel.kt:1574-1606`.

Rebind captures only currently dirty `DocumentId`s, clears global retirement and reenables editing. A retained clean document is never reauthorized; editing it after reconnect makes it dirty without adding it to the deny set. A newly opened alias to a retained dirty canonical document likewise gets a new ID absent from the workspace-local deny set. The new save checks then permit either path without validating the old canonical baseline. Fresh-stat checks for the original dirty tabs do not repair these admission gaps.

Latest fence specifically rechecked after Main's handoff: generation checks before/after stat protect generation changes, but do not detect same-generation disconnect/reconnect ABA. An old request may suspend, authority retire, then rebind to a replacement repository/socket with the same generation; retirement is false again and the generation still matches, so the old response can remove the current deny entry. Capture a monotonic authority/retirement token and exact transport/socket identity, not just generation. The empty-dirty-tabs branch at lines 346–350 is also before any retirement check and unconditionally sets `_isAuthorityRetired=false`; invoking it on a retired clean workspace restores edit eligibility without authority. It must never independently unretire the owner. These gaps remain despite all three save entry points now checking the dirty-ID deny set.

**Impact [INFERENCE]:** stale retained baselines can regain write authority via clean-to-dirty edits, another alias or same-generation ABA, and an empty reauthorization call can undo retirement. **Correction:** make authorization a generation/retirement-token-fenced property of the canonical retained document, revoke all retained baselines on retirement, and require fresh exact identity before any alias may save. Preserve content/undo when verification fails; do not clear global retirement in an unauthoritative empty-work shortcut. **C4; high confidence.**

### C-04 — Deferred disposal still misses dirty replacement and actual in-flight save ownership

**Evidence:** `common/features/editor/EditorTabsState.kt:171-185,206-247,737-774,1258-1270`; `common/features/editor/EditorSession.kt:104-119`; `android/platform/editor/AndroidEditorDocument.kt:85-99,121-125`; `android/platform/editor/AndroidEditorSurface.kt:98-108`.

- Final discarded dirty documents are now marked and close when their view settles: a real improvement. But forced tier replacement never marks the replaced dirty document discarded. It is retained in `retiredDocuments`, while `canDispose` permanently rejects its dirtiness after its last view is gone.
- Forced prune now bypasses the registry's save lock. Native `canDispose` relies on `_inFlightSaveCount`, but `beginSaveTracking` has no production callers (only its declaration and an instrumented test). A forced close can dispose the exact document while an actual save is still suspended.
- Production surfaces release leases directly on the document, not through registry settlement. An already closed discarded document can remain strongly retained in `retiredDocuments` until another registry operation.

**Impact [INFERENCE]:** leaked native buffers/history and premature disposal relative to save completion. **Correction:** carry explicit discard authorization into exact-document replacement; attach real snapshot/save leases to the shared save lifecycle; settle retirement through every final lease/save release. Keep surviving aliases intact. **C4; high confidence.**

### C-07 — Fresh notification revalidation blocks the Android UI thread

**Evidence:** `android/platform/workspace/NativeWorkspaceViewModel.kt:824-848,2173-2185`; `common/ui/flow/AppFlowNavigation.kt:318-342`; `common/ui/screens/DamHopperMobileApp.kt:519-555` (root UI coroutine context); departure-dialog callbacks in `common/ui/screens/ProjectWorkspaceScreen.kt:522-525,534-538`.

`routeToTerminal` accepts a synchronous validator; the new implementation invokes `runBlocking { routeResolver.resolve(target) }`, which performs an HTTP terminal-list request. It executes once before the departure guard and again at commit, including the UI-driven post-consent continuation. An ordinary no-guard click now makes the original async fetch plus two blocking HTTP resolutions.

**Impact [INFERENCE]:** network latency/offline timeout freezes UI/input and can cause an ANR; a blocked main thread also cannot process ordinary lifecycle/UI cancellation promptly. Fresh inventory and captured incarnation are improvements, but do not justify blocking network I/O.

**Correction:** reuse the existing verified-route flow: consent first, launch cancellable suspending authoritative resolution, then perform immediate non-suspending owner/socket/instance admission and atomic route commit. Remove `runBlocking`; surface post-consent refusal rather than reporting a silently abandoned deferred route as success. **C7/C8; high confidence.**

## Warnings (4)

1. **W-01 — Hub presentation state only partially qualified.** `NativeWorkspaceViewModel.kt:1185-1186,1300-1305,1330-1331,1357-1358,2012-2024`. New `profile:id` keys improve cross-profile pruning, but raw-ID compatibility checks and snapshot projections discard qualification; incarnation is absent. Hiding a row on B clears A's active session when raw IDs match; reopening still selects only a raw ID. Reuse existing structured terminal presentation identity and exact routing, not a second partially qualified representation.
2. **W-02 — Uncertain-create owner/settlement remains incomplete.** `TerminalModels.kt:213-222`; `TerminalRepository.kt:110-147`. UUIDs, free-terminal replacement blocking and narrower refusal statuses are improvements. `accountUser` is never populated; persisted endpoint is not consulted in admission; null storage still bypasses reservations. Any decodable 2xx metadata clears the record before checking response ID, positive incarnation and originating epoch. Retain uncertainty until exact original success/refusal is proven, and bind persistence/admission to the authenticated logical owner.
3. **W-06 — Tier replacement still performs duplicate session reconstruction.** `EditorTabsState.kt:296-339,1270-1319`. `replaceDocumentAtomic` synchronously reconstructs matching sessions via listeners; the caller then closes/rebuilds its own aliases again, rotating incarnations twice and performing full-content reads. The O(1) `serverMtime` change fixes the earlier extra mtime serialization. Retain one canonical successor publication path and reuse loaded content.
4. **W-08 — Regression coverage does not exercise remaining production failures.** `AgentHubLifecycleTest.kt:372-413` validates direct registry disposal, not actual surface release/save settlement or dirty replacement. `ProjectWorkspaceStateTest.kt:365-430` exercises a dirty alias plus `rebindAuthority`, not real transport replacement, clean-to-dirty reconnect, another alias or authority change during stat. `EditorTabsStateTest.kt:88-109,113-153` still expects editable admission with missing identity. Add targeted negative production-boundary tests; suite pass is not proof of these contracts.

## Previous-finding disposition / contracts

- C-01 partial; C-02 incomplete; C-03 partial; C-04 partial; C-07 new blocking-I/O regression while improving freshness/exact routing.
- C-05 privacy-dialog source gap addressed: `ProjectWorkspaceScreen.kt:473-624` suppresses both separate departure windows while the explicit mask is active; pending intent retained. Runtime/IME/TalkBack proof remains open.
- C-06 exact worktree filtering/creation retained in `ProjectTerminalScreen.kt:512-521,1628-1635`; no new defect found in inspected excerpts.
- C-08 named picker/SelectProjectTarget/OpenZeroSessionProject callbacks now capture and compare generation, endpoint and authenticated account before flow/store commit (`NativeWorkspaceViewModel.kt:1892-1950`; `DamHopperMobileApp.kt:1009-1043`). The separate Hub row path remains covered by C-01.
- W-03 source gap addressed for ordinary inventory decoding: termination epoch is adopted only when version header equals `1` (`TerminalRepository.kt:47-63`).
- W-04 command rename/delete merge repaired for represented ordinary primitive commands (`RemoteConfigEditor.kt:687-699`).
- W-05 duplicate populated upload selectors removed (`TransferCoordinator.kt:68-77`); changed test asserts DTO null selectors, not exact serialized bytes.
- W-07 evidence labels/product-flow descriptions improved in `live-api-qualification.md`, PDR and standards. Product claims of working projectless capabilities still exceed C-01 source reality.
- C1/C2/C4/C7/C8 acceptance incomplete above. C3/C5/C6 reviewed changes improve compliance; no blanket full-contract certification. C9 historical wave/process compliance not re-audited. C10 physical-device/live-isolated gates remain unproven.

## Reviewed files

All 21 changed Kotlin files:
- `android/platform/editor/AndroidEditorDocument.kt`
- `android/platform/workspace/NativeWorkspaceViewModel.kt`
- `androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/AgentHubLifecycleTest.kt`
- `common/features/editor/{EditorContentLoader,EditorDocument,EditorRepository,EditorSession,EditorTabsState}.kt`
- `common/features/files/TransferCoordinator.kt`
- `common/features/settings/RemoteConfigEditor.kt`
- `common/features/terminal/{TerminalModels,TerminalRepository}.kt`
- `common/features/workspace/{AgentHubModels,ProjectWorkspaceState}.kt`
- `common/ui/flow/AppFlowNavigation.kt`
- `common/ui/screens/{DamHopperMobileApp,ProjectTerminalScreen,ProjectWorkspaceScreen}.kt`
- `shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/TestEditorDocument.kt`
- `shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/TransferCoordinatorTest.kt`
- `shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt`

Supporting inspected sources: `common/features/workspace/{WorkspaceFileOwner,ProjectTargetStore}.kt`, `common/features/editor/EditorTabSaveCoordinator.kt`, `common/features/terminal/TerminalPresentationPolicy.kt`, `android/platform/editor/AndroidEditorSurface.kt`, `shared/src/jvmTest/.../features/editor/EditorTabsStateTest.kt`, `shared/src/jvmTest/.../ui/flow/AppFlowNavigationTest.kt`; relevant RemoteConfigEditorTest/TerminalLifetimeContractTest search excerpts. Requirements/evidence: README, docs PDR/standards, redesign plan/architecture contracts, Cycle 3 review, both remediation tester reports, live API qualification report.

## Validation commands/results

**Reviewer:** `git diff --stat -- native/android-app`, `git diff -- native/android-app` and static file/search inspection only; no builds, tests, formatters or linters. No configured LSP. Build-result glob was denied by installed `build/` access policy; did not circumvent it.

**Reported fresh integrated evidence, not reviewer-executed:** [FinalTester report](final-tester-261108-1158-android-agent-hub-remediation.md:20-42):

```text
cmd.exe /c gradlew.bat --no-parallel -Dkotlin.daemon.jvmargs="-Xmx6144m" -Dorg.gradle.jvmargs="-Xmx6144m" :shared:jvmTest :androidApp:testDebugUnitTest --rerun-tasks
```

Reported BUILD SUCCESSFUL, 44 tasks executed; shared 1,044/1,044 across 111 suites, Android 256/256 across 31 suites; total **1,300 passed, 0 failed/errors/skipped**. Includes the retained-dirty save gate and final-discard view-lease tests. Earlier 11:48 report recorded one shared failure plus Android test compilation failure; final report explicitly supersedes these after repairs/removal of the unbuildable draft test. The intermediate 1,301 target is not the final actual count.

No fresh lint, packaging, instrumented execution, live dual-server or physical-device evidence inspected for this remediation. Type/test coverage percentages unavailable; pass rate is not coverage.

## Suggestions / recommended actions

1. Correct the five critical groups before technical acceptance; preserve exact ownership and failure visibility rather than adding ambient fallbacks.
2. Add focused regressions for missing identity, projectless rendered capability clicks, cross-profile/free-terminal equal IDs, delayed/cancelled row routing, clean-to-dirty and new-alias reconnect, forced dirty replacement and real suspended-save disposal, slow post-consent notification requests.
3. Consolidate the three identical target owner comparisons using the existing captured-owner contract, and the two replacement reconstruction paths using the existing registry listener. Avoid adding coordinators or widening scope.
4. Keep plan administrative closure distinct from technical acceptance; update residual dispositions/qualification docs through Main's owner. No reviewer plan/task-state edits, per assignment.

## Unresolved questions / evidence

No unresolved product-design question. Remaining evidence: real device privacy dismissal/IME/hardware input/TalkBack, instrumented lifecycle journeys, live isolated multi-server/PTY behavior, real process-death uncertain-create restoration. Green headless suites do not close these C10 gates.
