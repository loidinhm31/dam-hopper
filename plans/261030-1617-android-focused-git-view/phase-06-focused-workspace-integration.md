# Phase 06 — Atomic real-runtime and focused-host integration

## Context / overview
Priority P2. Status in-progress (implementation landed; open for W3 revocation late refresh fence, W4/W5 uncertainty and clean reload, W6 UI wiring). Effort unestimated. Owner: one **G2 sequential integration** owner at each stable task boundary.
Predecessors: implement-safe-rewrites AND render-graph-lanes. Successors: 07 only after06 task evidence complete.
Authority: [contracts](contracts.md), [acceptance matrix](acceptance-matrix.md), [accepted review triage](reports/review-triage.md), [source evidence](reports/coordinator-evidence.md), [Git](reports/git-contract-evidence.md), [safety](reports/workspace-safety-evidence.md). Source facts/static reasoning are not compiled/runtime evidence.

## Key insights
- Final host constructor changes are a coupled source set: runtime, existing controllers, shared hosts, Workbench bundle and all old/new focused tests must migrate together. One larger coherent task is safer than artificial broken mini-tasks.
- Runtime was intentionally absent02–04; only now can it instantiate every real final controller/host implementation.

## Functional / nonfunctional requirements
- Every final API provider/caller cutover in one compile-closed transaction, no legacy shim/fake host/no-op baseline adapter.
- Focused root/retention/graph/sections/details/read-only diff/back/input/guards/publication all integrated; old dormant shell remains unmounted. AC01–AC10.

## Architecture / data flow
ProjectWorkspaceState retains state02; VM creates GitWorkspaceRuntime only now with real WorkspaceGitSafety02 and completed03/04 controllers. Runtime implements GitHostPorts and constructs controllers with host=this; constructor initialization performs no requests/callbacks until bundle fully initialized. Real host delegates safety and coordinates refresh/current conflict state/reconciliation. Root passes exact retained runtime -> single ProjectWorkspaceScreen -> GitPanelScreen/Modals -> existing leaf UI; graph05 complete before import.

## Exact writable actions
Literal normalized repository-relative paths. Each task is atomic: stop its editor(s), then one verifier checks the coherent changed source set before completing the task. No successor starts from an unverified/broken predecessor.
| Action | File | Purpose |
|---|---|---|
| Create | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceRuntime.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceState.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitModalState.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPanelScreen.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitModalsHost.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitChangesController.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitBranchController.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitSyncController.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorktreeMutationController.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryController.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionController.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteActionController.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/LeasedPublishController.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitChangesView.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitBranchesWorktreesView.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorktreeDialogs.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryView.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitCommitRow.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitCommitDetailsDialog.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitControllersAndEligibilityTest.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitChangesBehaviorTest.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitSyncWorktreeSafetyTest.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionsTest.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteSafetyTest.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRewritePublicationTest.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceNavigationTest.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitFocusedIntegrationTest.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/FileScreensPhase08Test.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/GitWorkspaceRuntimeBindingTest.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitWireCutoverTest.kt` | Migrate same-task03 wire-smoke controller constructor to real host |
| Create | `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/FocusedGitRootSmokeTest.kt` | Single atomic final constructor/revoke/host/runtime/caller and active-root cutover |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitWireLiveSmoke.kt` | Migrate explicit03 smoke constructor caller in atomic host cutover |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitDiffLiveSmoke.kt` | Preserve completed03 diff API/current-scope smoke under integrated runtime |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitSyncLiveSmoke.kt` | Migrate explicit03 smoke constructor caller in atomic host cutover |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryQueryLiveSmoke.kt` | Migrate explicit04 smoke host/revoke caller under integrated runtime |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionsLiveSmoke.kt` | Migrate explicit04 smoke constructor caller in atomic host cutover |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteLiveSmoke.kt` | Migrate explicit04 rewrite/publication constructor callers atomically |

Delete files: none; obsolete members/calls deleted atomically inside listed files when their replacement is usable. No shims.

Read-only references:
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorkspaceGitSafety.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitOperationScope.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/DiffReviewController.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/DiffReviewScreen.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitGraphModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitGraphLayout.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitGraphLane.kt`

## Ordered steps / task IDs
### mount-focused-git-host
1. Acquire all literal files only after evidence-complete mainline04 and graph05. Refresh complete caller search before edits; if a new caller is found, parent revises this one atomic task's literal scope before coding, not an alias/default constructor.
2. Add REQUIRED host:GitHostPorts third constructor parameter to changes/branch/sync/history-action/rewrite/leased; WorktreeMutationController becomes (repository,coroutineScope,host). Add real revoke() token/coroutine invalidation to all controllers consumed by runtime, not an empty placeholder. History constructor unchanged but revoke implemented here. Every old/new focused test constructor in the allowed set migrates to a real host adapter/production WorkspaceGitSafety boundary (legitimate IO boundary doubles allowed, never fake passing guard).
3. Implement GitWorkspaceRuntime(owner,connection,repository,presentation,safety,coroutineScope):GitHostPorts,AutoCloseable with completed controllers, root/current status/conflicts/operation and distinct viewed/checkout identities. Constructors cannot call host until bundle init complete. Implement real refresh/event/guard/editor/handoff methods; no host skeleton, no loop/poll/offline retry. Use exact02 safety, current03 queries and04 result/receipt semantics. Revoke invalidates every job/confirmation/preview/layout and records unresolved original-owner outcomes.
4. Add ProjectWorkspaceState.gitRuntime/bindGitRuntime and WorkspacePanel.GIT atomically with every enum consumer/active host. Add RetainedRootServices.gitHostPorts only with its real VM implementation and root caller; VM keeps one bundle per exact owner/current generation, immutable repos and account gate02. No MainActivity widening or fallback owner.
5. Replace WorktreeRemovalPrecheck caller shape with real suspend preflight and final discovery/scope/dirty checks; replace synchronous constructor lambdas and onActiveWorktreeRemoved callbacks in ALL leaf/modal/Workbench/mixed tests now. Unknown inventory blocks, absent/stale/main/locked/bare/unavailable/changed mapping refuses; send projected path; active target must guarded switch away first. Guard all checkout/file-changing/pull/history/discard actions immediately around dispatch; object-only rewrites do not unnecessarily discard dirty buffers.
6. Replace GitPanelScreen(runtime,state) and GitModalsHost(runtime,state), add capturedScope to GitModalState, migrate every producer/consumer and leaf success callback to one actual host outcome path. Root toolbar/sections display target/root/checked-out/viewed separately; entry/foreground/manual/completed mutation refresh. No stale success/error/prepared lease under another owner/ref/root; equal errors have event identity.
7. Add Git tab and single content branch. Back order respects existing Settings/feed/cover, modal, nested diff/details, then guarded workspace departure; hidden terminal/editor input closed. State section/ref/search/viewport/selection/routes survives panels/rotation, editor remains sole text authority and mapping clean-only reconciles.
8. Add memoized graph geometry to transferred GitHistoryView/GitCommitRow only now (both04/05 complete), keyed OID lazy rows/ref labels/accessible touch actions. Filtered search bypasses graph and squash. No layout in draw.
9. WorkbenchScreen adds required gitWorkspace:ProjectWorkspaceState (source search no current callers); consumes its exact runtime/state, removes old private controller/diff bundle creation and scope effects. Mismatched workbench target/connection shows unavailable context; do not synthesize second owner. Its prior03 read-only diff API already compiles; reuse rather than resurrect old save/draft callback. Preserve unrelated dormant panels.
10. Migrate every constructor caller in existing mixed and prior03/04 regression tests in this task; add production host integration/navigation tests and FocusedGitRootSmokeTest using installed Compose/ActivityScenario and mandatory real server/profile args. No dependency on future NativeGitWorkspaceJourneys/runner. Stop all editing, run task-local compile/scoped tests/S-ROOT/review AND additional Q1. Missing runtime/device prerequisite blocks this task, never fake success or deferred evidence.
10a. Migrate all six standalone *LiveSmoke classes from03/04 with the final constructors/current host runtime in THIS task. Re-run :shared:jvmGitSmoke with --tests for each exact six class names under mandatory isolated real fixture; they are additional to deterministic :shared:jvmTest/Q1 and same-task device S-ROOT. Q1/default tests require NO external server env; never move mandatory live methods back into regular classes or copy default discovery exclusion into jvmGitSmoke.

## Compile-dependency closure (planned, not observed)
This is the ONLY runtime-introduction/host-constructor/revoke/property cutover. Literal set includes every final provider plus source-mapped production callers: Workbench creates old controller bundle, GitPanel calls GitModals and leafs, root/VM expose retained services, workspace/screen consume GIT enum, and mixed+new03/04 tests instantiate controllers. All replacements and required host implementations land atomically; no runtime02 references them.03 scope/diff and04 receipt cutovers are already compile-verified. FocusedGitRootSmokeTest is created here, so smoke does not depend on07. One task is intentionally larger because splitting these interfaces without shims leaves the shared source set broken.
All six prior03/04 standalone *LiveSmoke constructor callers are included in this atomic boundary and executed through the existing01 explicit jvmGitSmoke task after migration. Regular deterministic tests and fullQ1 remain independently runnable with live-server env absent; this phase does not edit shared Gradle configuration or introduce a new test-task filter.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "mount-focused-git-host",
    "title": "Atomically wire real runtime, all guarded constructors/callers and active Git host",
    "blocked_by": [
      "implement-safe-rewrites",
      "render-graph-lanes"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceRuntime.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitModalState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPanelScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitModalsHost.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitChangesController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitBranchController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitSyncController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorktreeMutationController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteActionController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/LeasedPublishController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitChangesView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitBranchesWorktreesView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorktreeDialogs.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitCommitRow.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitCommitDetailsDialog.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitControllersAndEligibilityTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitChangesBehaviorTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitSyncWorktreeSafetyTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionsTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteSafetyTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRewritePublicationTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceNavigationTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitFocusedIntegrationTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/FileScreensPhase08Test.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/GitWorkspaceRuntimeBindingTest.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/FocusedGitRootSmokeTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitWireCutoverTest.kt"
      ,"native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitWireLiveSmoke.kt"
      ,"native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitDiffLiveSmoke.kt"
      ,"native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitSyncLiveSmoke.kt"
      ,"native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryQueryLiveSmoke.kt"
      ,"native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionsLiveSmoke.kt"
      ,"native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteLiveSmoke.kt"
    ],
    "constraints": [
      "Only listed literal files writable. Change every affected caller atomically; no compatibility shim, fake host, no-op implementation or verification waiver.",
      "Stop editing before verification. Compile, scoped behavioral tests, real smoke and passing review must be evidenced at this task boundary before completion/dependents; Q1 after06 is additional, not a deferred prerequisite gate."
    ],
    "acceptance": [
      "Runtime is introduced only with every consumed final constructor/revoke/property/method and every production/test caller migrated in this task; no future or fake host dependency.",
      "Real active single workspace exposes Git/three sections/nested review/Back/input/toolbar; owner/root/checked-out/viewed distinct and retained editor/terminal/Git state preserved.",
      "Full host adapter uses real02 safety for destructive actions/all-owner dirty+fresh terminal+discovery, clean-only reconciliation, actual async removal and current operation gates; old duplicate Workbench bundle removed.",
      "Unfiltered memoized graph integrates, search flat/no squash; both rewrite publications receipt-bound; stale events/previews/unknown outcomes cannot authorize another owner."
    ],
    "verification": [
      "& .\\native\\android-app\\gradlew.bat -p native/android-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin",
      "After editors terminate, run & .\\native\\android-app\\gradlew.bat -p native/android-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.git.GitFocusedIntegrationTest\" --tests \"dev.damhopper.nativeapp.features.git.GitWorkspaceNavigationTest\" --tests \"dev.damhopper.nativeapp.features.git.GitChangesBehaviorTest\" --tests \"dev.damhopper.nativeapp.features.git.GitSyncWorktreeSafetyTest\" --tests \"dev.damhopper.nativeapp.features.git.GitHistoryActionsTest\" --tests \"dev.damhopper.nativeapp.features.git.GitRewriteSafetyTest\" --tests \"dev.damhopper.nativeapp.features.git.GitRewritePublicationTest\" --tests \"dev.damhopper.nativeapp.features.git.GitControllersAndEligibilityTest\"; require all scoped behavior assertions pass.",
      "Real S-ROOT smoke: use existing current-server/seed helper and mandatory secure profile/server runner args; run :androidApp:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.damhopper.nativeapp.FocusedGitRootSmokeTest (new class owned in this task). It launches real MainActivity, clicks Git/three sections/read-only diff/Back and guarded Cancel, observes correct requests/retained state/unchanged PTY. No later07 class/runner required; missing device/server blocks, not skip. Run Q1 additionally after this atomic cutover; also run :androidApp:testDebugUnitTest for FileScreensPhase08Test and GitWorkspaceRuntimeBindingTest.",
      "After atomic constructor migration, run :shared:jvmGitSmoke --tests \"dev.damhopper.nativeapp.features.git.GitWireLiveSmoke\" --tests \"dev.damhopper.nativeapp.features.git.GitDiffLiveSmoke\" --tests \"dev.damhopper.nativeapp.features.git.GitSyncLiveSmoke\" --tests \"dev.damhopper.nativeapp.features.git.GitHistoryQueryLiveSmoke\" --tests \"dev.damhopper.nativeapp.features.git.GitHistoryActionsLiveSmoke\" --tests \"dev.damhopper.nativeapp.features.git.GitRewriteLiveSmoke\" with mandatory isolated current-server fixture. Default Q1 remains deterministic with live env absent.",
      "Obtain passing scoped implementation review and record actual compile/tests/smoke/review reports before completing this task; no dependency on later06 or07 source."
    ]
  }
]
```

- [ ] <!-- evcrate-task:mount-focused-git-host --> Atomically wire real runtime, all guarded constructors/callers and active Git host (open for W3/W4/W5/W6)

## Ownership / transfers / concurrency
Mainline01 ->02 ->03 ->04 ->06 is serialized. Graph05 alone may overlap02/03/04 after evidence-complete additive01. Every repeated writable has a transitive blocked_by ordering. No worker verification over half-edited active sources; one verifier serializes Gradle/device checks at stable boundaries, even when graph editing is independently eligible. Preserve unrelated user/other-plan changes.

## Acceptance / future checks
After editors terminate, compile complete source sets, run scoped tests and the same-task real-root smoke, get passing review, and run Q1 additionally. Later Q2–Q6 broaden integrated ten-AC/real-Git/hardware qualification, never substitute for this task evidence. Device absence may block06 smoke honestly; no later prerequisite cycle is created.

## Risks / security / failure / rollback
Serialize all overlapping mainline files and related recovery/sidebar/editor root/doc writers. No actual local/remote PTY recreation/move/kill, no document/undo replacement. Guard callbacks and runtime constructor init cannot dispatch while incomplete. Unknown accepted mutations retain original authority and reconcile/no replay. Roll back installed client artifact only.

## Next / unresolved
No product decision unresolved. Required task compile/tests/smoke/review and later current-server/device/release evidence remain future gates, never waived by this plan. Parent owns final review/validation and execution authorization.
