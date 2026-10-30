# Phase 02 — Retained transport binding and real workspace safety

## Context / overview
Priority P2. Status in-progress (implementation landed; open for W3 late refresh fence, W4/W5 affected-document transaction, W7/W8 lifecycle rebinding). Effort unestimated. Owner: one **G1 serialized mainline** owner at each stable task boundary.
Predecessors: freeze-git-client-contracts. Successors: 03; graph05 may independently progress.
Authority: [contracts](contracts.md), [acceptance matrix](acceptance-matrix.md), [accepted review triage](reports/review-triage.md), [source evidence](reports/coordinator-evidence.md), [Git](reports/git-contract-evidence.md), [safety](reports/workspace-safety-evidence.md). Source facts/static reasoning are not compiled/runtime evidence.

## Key insights
- F2 source: ProjectTerminalScreen448–455 returns existing controller before471–553 callback installation;664–708 collectors have no binding token. Rebind methods alone cannot fix that.
- Parent/child immutable constructor collaborators and synthetic account fallback require narrow actual caller repair.

## Functional / nonfunctional requirements
- Preserve exact retained user state, reinstall current callbacks for existing AND new controllers, scope output/write/attach/recovery by current binding token.
- Real safety/presentation only; no forward runtime or future constructor references. Whole-target guard and hidden/retired dirty+fresh terminal authority. AC01/06/07/08.

## Architecture / data flow
VM constructs immutable new repositories retaining same-owner arbiter -> ProjectWorkspaceState explicitly rebinds editor/tree/mutation/terminal consumers while revoked -> screen reinstalls current callbacks on retained controller -> validated authority re-enabled. Separate WorkspaceGitSafety operates existing workspace/flow/target-store/repository interfaces;02 has no Git runtime construction.

## Exact writable actions
Literal normalized repository-relative paths. Each task is atomic: stop its editor(s), then one verifier checks the coherent changed source set before completing the task. No successor starts from an unverified/broken predecessor.
| Action | File | Purpose |
|---|---|---|
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAttachQueue.kt` | Fence stale admission/success/failure/cancel before touching retained current replay gate |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAttachQueueBindingTest.kt` | Old queue completion/cancellation cannot close new binding replay/input gate |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Modify | `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/RetainedGitTransportTest.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalScreenBindingTest.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/ProjectTerminalVisibilityTest.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Create | `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/GitWorkspaceRuntimeBindingTest.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Create | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceState.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Create | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorkspaceGitSafety.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceDepartureTest.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/GitWorkspaceSafetyTest.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigationTest.kt` | Atomic retained binding/caller migration or real workspace safety/presentation |

Delete files: none; obsolete members/calls deleted atomically inside listed files when their replacement is usable. No shims.

Read-only references:
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinator.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectTargetStore.kt`
- `plans/261028-1659-android-connection-recovery-lifecycle/plan.md`

## Ordered steps / task IDs
### rebind-workspace-transports
1. Include every active caller in this task: retained consumers, ProjectWorkspaceState, VM, root and targeted tests. Require actual newConnection in workspace rebindAuthority; remove generation1 fallback. VM creates fresh immutable file/editor/terminal repositories with retained same-owner FileOperationArbiter; editor rebind replaces save coordinator/hooks, epoch-fences loads/ranges/saves without replacing document/session/undo.
2. FileTreeState retires old watchCoordinator/socket collectors/subscriptions and renews demands on new repository while retaining tree presentation; FileMutationCoordinator fences old dialog/jobs and preserves unresolved/quarantine state. Old completed requests cannot reopen retired authority.
3. ProjectTerminalState rebindTransports plus TerminalSessionController.rebindTransport preserve identical controller/surface/VT engine/grid/scrollback/accepted lastSeenOffset/incarnation/reading state/drafts. Invalidate attachment queues, sinks and queued outbound writes; no controller/surface close/removeSessionLocal merely for generation update. Existing incarnation reset behavior remains server-authoritative.
4. Fix ProjectTerminalScreen's early-return path: obtain/create controller, THEN call one real installCurrentControllerBinding routine for existing and new controllers before return. Reinstall resize, raw input, current cover/input predicate, recovery and reattach closures on same-owner generation change AND tab/surface reattachment. Do not clear callbacks without reinstalling them.
5. Capture binding=(complete owner/current ConnectionRef, repository identity, controller identity/incarnation, monotonically advancing attachment/surface epoch). Before collection dispatch to handleLiveChunk/handleBufferReplay/handleExit/handleLagged/handleProcessRestarted, queue admission/drain/result, resize, attach connect/send/result, recovery callbacks and post-await state writes, require captured binding still current. Cancellation alone is insufficient. QueuedWrite adds REQUIRED binding token, and its screen/visibility-test constructors migrate here. Epoch changes on surface reattachment even at same generation. Stale events do not mutate the retained grid or new-view banner/history. An already-sent write can be uncertain but never resent under new binding.
5a. Source-backed narrow queue closure: TerminalAttachQueue25–35/60–83/92–94 currently begins/fails the retained controller gate even when the old request's isCurrent is false. Keep queue constructor/method signatures unchanged, but use its per-request captured generation/binding predicate before EVERY admission/success/failure/cancel effect, including beginAttach, fenceIfLatest and cancellation failAttach. A stale old queue cannot close/reopen the new binding's replay/input gate. Current failure still closes only its own admitted gate; successful send alone never marks replay ready. TerminalAttachQueueBindingTest covers old pending/connect/send/error/cancel after a fresh same-controller binding and confirms current replay/input gates and accepted bytes remain intact. No broader attach/recovery redesign.
6. GitWorkspaceRuntimeBindingTest at02 tests existing workspace owner/transport retention, not a nonexistent GitWorkspaceRuntime or future host constructor. Root owner key includes verified effectiveAccountUser and complete connection/endpoint/target equality. Missing account revokes authority; no dev-user/authenticated-user adoption. Scope this to workspace ownership, not authentication redesign.
7. Test the actual shared screen installer used by the production early-return and creation paths (internal non-Composable binding routine extracted inside ProjectTerminalScreen if needed for JVM testing), not only rebindTransport. Existing/new controller tests cover input/resize/recovery/reattach and delayed old chunks/attach/write callbacks, unchanged grid/offset/draft/identity. New helper and all callers land atomically in this task; no source-string assertions. Stop editor, compile/tests/smoke/review before completion.

### guard-workspace-targets
1. Add complete GitWorkspaceState logical section/routes/ref/search/OIDs/viewport/modal state; retain it per ProjectWorkspaceState. Keep WorkspacePanel enum unchanged until06, and do not declare gitRuntime/bindGitRuntime or instantiate any future Git controller.
2. Add real WorkspaceGitSafety with explicit immutable logical owner and current-transport getters, existing flow/store/workspace/dirty inventory providers. It implements withMutationGuard/preflightRemoval/requestWorktreeSwitch/openWorkspaceFile/clean-only reconcile operations, not the full GitHostPorts refresh/controller adapter (that adapter belongs06). No unused fake success methods; safety tests execute these production methods.
3. Add suspend AppFlowNavigation.requestWorkspaceTarget using caller-owned coroutine + existing one-shot departure guard. After Save/actual Discard/Cancel, revalidate dirty revisions, exact owner/connection and fresh discovery, then one UI-dispatcher flow/store commit. Remove pre-guard store mutation. Never use notification/verified-terminal shortcuts, move/kill old PTY or send pending action to fallback root.
4. VM aggregates all retained exact logical-owner dirty documents including retired. Fresh TerminalRepository.listDetailed uses current owner transport; marker first, legacy project+normalized segment cwd containment only when marker absent; unknown/inventory error blocks. Refuse vanished/main/locked/bare/unavailable/changed mapping target and revalidate after awaits. Delete dispatch later03/06 cannot bypass these guards.
5. Dirty Discard must actually settle captured retained documents through editor authority; Save failure/changed revision blocks, cancellation spends continuation. Map nested-root paths once for dirty/editor operations and reconcile only clean buffers.02 safety binds its own exact owner;03 scope enrichment updates its owner comparison/test callers atomically.

## Compile-dependency closure (planned, not observed)
Task1 owns added/changed rebind and QueuedWrite definitions AND all source-mapped callers (workspace/root/VM/screen/visibility tests), so there is no intermediate call to a future rebind method. Task2 adds fully implemented presentation/safety using existing GitOperationScope fields and its independently verified bound WorkspaceFileOwner, never scope.owner before03 introduces it. GitHostPorts remains interface-only; the full host adapter/runtime is deferred06. No runtime property, GIT enum branch or future controller API is referenced.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "rebind-workspace-transports",
    "title": "Atomically rebind retained consumers and reinstall screen transport callbacks",
    "blocked_by": [
      "freeze-git-client-contracts"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAttachQueue.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAttachQueueBindingTest.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/RetainedGitTransportTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalScreenBindingTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/ProjectTerminalVisibilityTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/GitWorkspaceRuntimeBindingTest.kt"
    ],
    "constraints": [
      "Only listed literal files writable. Change every affected caller atomically; no compatibility shim, fake host, no-op implementation or verification waiver.",
      "Stop editing before verification. Compile, scoped behavioral tests, real smoke and passing review must be evidenced at this task boundary before completion/dependents; Q1 after06 is additional, not a deferred prerequisite gate."
    ],
    "acceptance": [
      "All production/test rebind and QueuedWrite callers migrate atomically; same verified owner/new generation retains editor documents/undo and terminal controller/surface/grid/scrollback/offset/incarnation/drafts.",
      "Existing and new same-incarnation controllers both receive fresh resize/raw input/recovery/reattach callbacks; captured binding tokens reject stale chunks/buffer/exit/lag/restart/attach/write/results after generation or surface reattachment.",
      "TerminalAttachQueue admission/success/failure/cancel checks captured current generation/binding before controller gate effects; an old queue cannot failAttach or reopen the fresh retained binding.",
      "Missing verified user fails closed; immutable file/editor repositories per generation and shared arbiter/quarantine preserved; no remote PTY create/kill/restart/move."
    ],
    "verification": [
      "& .\\native\\android-app\\gradlew.bat -p native/android-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin",
      "After editors terminate, run & .\\native\\android-app\\gradlew.bat -p native/android-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.workspace.RetainedGitTransportTest\" --tests \"dev.damhopper.nativeapp.features.terminal.TerminalScreenBindingTest\" --tests \"dev.damhopper.nativeapp.features.terminal.ProjectTerminalVisibilityTest\" --tests \"dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceStateTest\"; require all scoped behavior assertions pass.",
      "Smoke: run :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.terminal.TerminalScreenBindingTest.sameIncarnationScreenRebindSmoke\" using the actual screen callback installer with production retained controller/surface and boundary transport fixture; send input, resize/recovery, then deliver old/new binding events and observe unchanged grid/accepted offset plus current-only writes. Also run :androidApp:testDebugUnitTest --tests \"dev.damhopper.nativeapp.platform.workspace.GitWorkspaceRuntimeBindingTest\".",
      "Run :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.terminal.TerminalAttachQueueBindingTest\"; smoke stale old-queue send/error/cancel after fresh same-controller replay admission, verify current gate/bytes/input authority unchanged.",
      "Obtain passing scoped implementation review and record actual compile/tests/smoke/review reports before completing this task; no dependency on later06 or07 source."
    ]
  },
  {
    "id": "guard-workspace-targets",
    "title": "Implement real retained Git state and whole-workspace safety without runtime",
    "blocked_by": [
      "rebind-workspace-transports"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorkspaceGitSafety.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceDepartureTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/GitWorkspaceSafetyTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigationTest.kt"
    ],
    "constraints": [
      "Only listed literal files writable. Change every affected caller atomically; no compatibility shim, fake host, no-op implementation or verification waiver.",
      "Stop editing before verification. Compile, scoped behavioral tests, real smoke and passing review must be evidenced at this task boundary before completion/dependents; Q1 after06 is additional, not a deferred prerequisite gate."
    ],
    "acceptance": [
      "GitWorkspaceState is complete logical state only; WorkspaceGitSafety provides real exact-owner dirty/save/discard/revalidation/target-switch/removal/editor mapping logic, with no future controller dependency.",
      "All-retained exact-owner dirty docs including retired, fresh qualified terminal inventory and discovery guard switching/removal; unknown states fail closed and flow/store commit only after revalidation.",
      "No GitWorkspaceRuntime or WorkspacePanel.GIT reference introduced here; real runtime and exposure are atomically06."
    ],
    "verification": [
      "& .\\native\\android-app\\gradlew.bat -p native/android-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin",
      "After editors terminate, run & .\\native\\android-app\\gradlew.bat -p native/android-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.workspace.GitWorkspaceSafetyTest\" --tests \"dev.damhopper.nativeapp.features.workspace.WorkspaceDepartureTest\" --tests \"dev.damhopper.nativeapp.ui.flow.AppFlowNavigationTest\"; require all scoped behavior assertions pass.",
      "Smoke: run :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.workspace.GitWorkspaceSafetyTest.guardedTargetTransitionSmoke\" with production flow/workspace/safety objects, retained dirty document, save/cancel/discard and fresh terminal/discovery HTTP boundary fixtures; verify no premature flow/store commit or PTY request.",
      "Obtain passing scoped implementation review and record actual compile/tests/smoke/review reports before completing this task; no dependency on later06 or07 source."
    ]
  }
]
```

- [ ] <!-- evcrate-task:rebind-workspace-transports --> Atomically rebind retained consumers and reinstall screen transport callbacks (open for W7/W8 lifecycle rebinding corrections)
- [ ] <!-- evcrate-task:guard-workspace-targets --> Implement real retained Git state and whole-workspace safety without runtime (open for W3/W4/W5 safety and reconciliation corrections)

## Ownership / transfers / concurrency
Mainline01 ->02 ->03 ->04 ->06 is serialized. Graph05 alone may overlap02/03/04 after evidence-complete additive01. Every repeated writable has a transitive blocked_by ordering. No worker verification over half-edited active sources; one verifier serializes Gradle/device checks at stable boundaries, even when graph editing is independently eligible. Preserve unrelated user/other-plan changes.

## Acceptance / future checks
Each02 task runs its own listed compile/JVM/Android unit + real binder/safety consumer smoke + passing review before the next starts. Binder smoke tests execute production screen installer without needing future NativeGitWorkspaceJourneys; actual mounted account/server/rotation/device qualification remains additional07. No source fixture in later phase is a prerequisite to02 checks.

## Risks / security / failure / rollback
Recovery-plan exact overlapping writer includes ProjectTerminalScreen.kt, ProjectTerminalState.kt, TerminalSessionController.kt, VM/root/workspace and tests: coordinator serializes claims before02. No broad terminal protocol/recovery redesign. Same-generation surface reattach also fences old work. Preserve drafts/user state; current callbacks never imply replay completion until real gate ready. Rollback installed client only; never recreate/kill/move remote PTYs.

## Next / unresolved
No product decision unresolved. Required task compile/tests/smoke/review and later current-server/device/release evidence remain future gates, never waived by this plan. Parent owns final review/validation and execution authorization.
