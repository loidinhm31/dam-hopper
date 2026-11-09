# P07 — Integrate the active MainActivity and retained lifecycle

## Context links
[Overview](plan.md) | [Binding C1–C10](architecture-contracts.md) | [Ownership/transfers](execution-ownership.md) | [Acceptance matrix](acceptance-matrix.md) | [reports/android-evidence.md](reports/android-evidence.md) | [reports/design-dispositions.md](reports/design-dispositions.md) | [reports/local-api-smoke.md](reports/local-api-smoke.md)

## Overview
- Priority: P1 (safety-critical cutover); status: pending; effort: 24h.
- Owner: Integration07 (same single integration owner). Parallelization group: `S-3`.
- Prerequisite task IDs: `present-terminal-lifetime`, `preserve-settings-documents`, `preserve-private-platform-delivery`, `preserve-focused-git-safety`
- Authoring only. No product execution approved; no build/lint/tests/formatter while authoring or feature writers are active.

## Key evidence
RootContent currently owns active profile transport and three-stage navigation; cosmetic component tests cannot establish the new app journey. Existing ViewModel owns retirement readiness, runtime map, notification resolver, document factories and settings services; reuse all. Current notification route checks agent identity but Hub also needs authoritative terminal lifetime identity before selection. Dirty guard currently has target mutation ordering risk.

## Requirements
Functional: secure login -> default Agent Hub; project picker is nested not a mandatory stage. Hub spans already-connected observed runtimes only, not saved-profile connect-all/observation keepalive. Wire Settings/feed exact origin, project/worktree and file/capability selection, create uncertainty persistence, canonical document sharing, notification single-use activation and hierarchy Back. Await retirement before authority replacement, preserving dirty docs and qualified selections/pins while unavailable.
Nonfunctional: one active content stage/root/retained ownership; no alternate runtime/service/flags. Shared models/ports remain stable and branch code must not drift signatures. Process death retains minimal uncertain-create identity only; remote PTY survival != in-memory document retention != background notification delivery guarantee. Focused root and lifetime smoke/check/review complete sequentially before dependent admission; full integrated/device/human release matrix remains P08.

## Architecture and ports
Integration07 is exclusive owner of MainActivity, NativeWorkspaceViewModel, DamHopperMobileApp, AppFlow and shared port/theme changes after G-A barrier. Wire AgentHubPorts to existing AgentRuntimeHost/ConnectionRegistry/terminal coordinators/ProjectWorkspaceState; no new hub runtime or global poller. Reuse connected registry inventory without creating sockets or pinning runtimes merely to render rows. Root snapshot makes known/disconnected/unsupported/loading explicit and includes zero-session open project/worktree refs.
Hoist existing canonical holder lifetime ownership, not just map lookup, in current retained ViewModel workspace storage scoped by profile/endpoint/account/workspaceId/workspaceEpoch. Existing owner holds dirty recovery entries and sole native disposal authority; project/worktree/session aliases acquire leases and release only their own resources on close. ProjectWorkspaceState close cannot dispose a holder used by another alias. Wire final dirty save/discard/cancel guard with reachable cancelled/failed/busy state; retirement synchronously withdraws authority and keeps in-process dirty/undo recoverable through existing retained state and explicit authorized rebind, never process-death recovery. Owner token retires before exactly-once disposal, gated by zero aliases/views/dirty retention/in-flight snapshots/saves. P06 canonical replacement/view-lease rules remain binding across all retained workspaces. Await runtime teardown before replacement readiness. Notification activation retains exact owner/account/socket/agent, once-only intake, post-consent revalidation and fresh terminal identity before route commit; never pre-mutate targetStore.

## Related files and ownership
Absolute source mapping: every project-relative literal below resolves under `G:/ws/sharing/dam-hopper/`; these are full source paths by that mapping. Runtime report paths listed Create are future evidence artifacts, not files authored during planning. No directory ownership or globs.
### Create (new files; not existing source)
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/AgentHubLifecycleTest.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/AgentHubRootJourneys.kt`

### Modify (existing files)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/AgentHubModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/AgentHubPorts.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/AgentHubContractsTest.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowState.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/VerifiedTerminalRoute.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectTargetStore.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/NativeTheme.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/Color.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/Type.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsInventoryCoordinator.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/RetainedTerminalAgentsCoordinator.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsActivationCoordinator.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigationTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AgentSettingsNavigationTest.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SimpleFlowJourneysTest.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModelTest.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/RuntimeIntegrationReadinessTest.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/RetainedTerminalAgentsIntegrationTest.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsActivationCoordinatorTest.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidPreferencesStore.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/lifecycle/AndroidLifecycleCoordinator.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceFileOwner.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsRecoverySupervisor.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/lifecycle/LifecycleCoordinator.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/GitWorkspaceRuntimeBindingTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/WsRecoverySupervisorTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceDepartureTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/RetainedWorkspaceLifecycleTest.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeTerminalAgentsJourneys.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeTerminalAgentsServerFixture.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/FocusedGitRootSmokeTest.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeGitWorkspaceJourneys.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/WorkbenchJourneys.kt`

### Create (coordinator-only completion receipts after stopped task/wave)
- `plans/261107-0305-android-agent-hub-redesign/reports/integrate-active-hub-root-completion.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/integrate-active-hub-root-evidence.json`
- `plans/261107-0305-android-agent-hub-redesign/reports/integrate-retained-lifetimes-completion.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/integrate-retained-lifetimes-evidence.json`

### Delete
- No whole-file deletions. Remove obsolete replaced methods/callers/navigation assertions inside the modified files; unrelated dormant feature code stays.

### Conflict and transfer rules
The task fences below are exhaustive writable authority. Within this phase, steps execute by their task dependencies. Shared sequential paths transfer `Contract01 -> Api02 -> owning Feature03/04/05/06 -> Integration07 -> Qualification08/docs` only where declared. G-A may read other slices but cannot write their files, common root, shared DTOs or ports. Any missing writable caller blocks the affected task until coordinator deliberately revises that task and reruns structural validation; no compatibility shim or unsanctioned edit. Ownership transfers only after predecessor stopped-wave checks, independent review and evidence-backed completion. Per-task report/evidence grants are coordinator-only after the worker stops. Exact per-path chain: [execution-ownership.md](execution-ownership.md).

## Numbered implementation steps by stable task ID
### integrate-active-hub-root
1. Replace active post-auth PROJECT_LIST/TERMINAL staging with Hub primary stage plus nested Open Project picker and Terminal/Files/Editor/Git. Remove obsolete replaced active navigation cases/tests, not unrelated dormant Workbench feature implementations.
2. Wire connected-owner snapshots/actions to current runtime/registry services without connect-all or observer keepalive. Preserve zero-session refs, unavailable pins and exact project/worktree selection. Root-empty state still exposes Open Project/Settings/feed.
3. Wire two-row adaptive chrome, actual inset/hinge admission, one rail/content host, capability visibility/cover, and theme typography/contrast using existing NativeTheme. No duplicate Projects and Files rails.
4. Wire retained Settings exact origin A/B/C and Notifications; implement Back precedence: platform IME, privacy consumes, modal, Settings/feed, LIFO sheets/Git detail, capability->terminal, navigator/departure. Never implicit logout/remote kill.
5. Route feed/OS/agent clicks through exact current resolver; pre/post consent checks include original owner/account/socket/agent and fresh terminal identity. Consume click once before route attempt, no stale login fallback or second consumption on rotation.
6. Update active AppFlow/unit journeys and registered retention tests to real Hub semantics, removing obsolete expectations rather than weakening coverage; keep branch interfaces intact.

### integrate-retained-lifetimes
1. Wire existing retained owner as canonical holder lifetime owner into every workspaceStates/EditorTabsState factory, not only a shared map. Workspace/project aliases acquire explicit leases and release only their own listeners/exact view on close; retain dirty recovery access after authority retirement, fence stale callbacks and permit only explicit authorized rebind. Enforce zero alias/view/dirty/save disposal guard and final-dirty save/discard/cancel without unreachable retention. Different endpoint/account/epoch never aliases.
2. Bind unknown create admission/outcome storage before dispatch, restore minimal identity before enabling create after process launch. Rotation/background/reconnect never recreates; original epoch/incarnation remains until exact settlement; if proof cannot be obtained keep blocked explanatory state.
3. Reconcile local hidden/pinned terminal selections only with authoritative qualified inventory. Remote PTYs survive normal navigation/rotation/background; process-death dirty buffers are not recovered or advertised. Retire old authority synchronously, await runtime/socket teardown, then publish replacement readiness.
4. Attach/detach SAF/media/notification ports to Activity lifecycle without retained Activity/context leaks. Native document view cleanup uses P06 exact widget+lease tokens; old Activity/view detach cannot remove successor receipt/view state/input or dispose shared document. Retire media/watch/session-local resources without disposing another alias/dirty/in-flight native holder. Recheck target after pickers/consent; WS1006 stays honest unavailable/error, never suppressed.
5. Author actual MainActivity regressions in AgentHubRootJourneys/RetainedWorkspaceLifecycleTest: edit A/open B/close A tab and workspace/B undo+save, reverse order; final dirty close save/discard/cancel; close/reload during in-flight save; tier replacement to all aliases; late old-view detach after successor attach. Include rotation/background/process recreation, covered input, retirement dirty recovery and duplicate/stale notification race. Focused root/lifetime smoke executes at W08/W09 respectively before completion; full device/human matrix remains P08.

## Durable task contract
```evcrate-tasks
[
  {
    "id": "integrate-active-hub-root",
    "title": "Mount settled features in one active Hub root",
    "blocked_by": [
      "present-terminal-lifetime",
      "preserve-settings-documents",
      "preserve-private-platform-delivery",
      "preserve-focused-git-safety"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/VerifiedTerminalRoute.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/AgentHubModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/AgentHubPorts.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectTargetStore.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/NativeTheme.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/Color.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/Type.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsInventoryCoordinator.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/RetainedTerminalAgentsCoordinator.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsActivationCoordinator.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigationTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AgentSettingsNavigationTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/AgentHubContractsTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SimpleFlowJourneysTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModelTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/RuntimeIntegrationReadinessTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/RetainedTerminalAgentsIntegrationTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsActivationCoordinatorTest.kt",
      "plans/261107-0305-android-agent-hub-redesign/reports/integrate-active-hub-root-completion.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/integrate-active-hub-root-evidence.json"
    ],
    "constraints": [
      "Stay within this literal allowlist; escalate additional writes to integration owner before editing.",
      "Implementer authors tests but runs no checks. After every writer in this selected coherent wave stops, coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before evidence-backed completion or successor admission; no sibling-edit checks, no defer-to-P08 completion."
    ],
    "acceptance": [
      "MainActivity authenticates into one Hub with nested picker/capabilities, Settings/feed exact return and honest connected-owner inventory.",
      "No connects to all saved profiles or observer keepalive; no dormant OS activation.",
      "Back/notification route guards precede selection mutation and stale activation stays in place."
    ],
    "verification": [
      "At this task/wave stop barrier, coordinator runs applicable existing Gradle shared/app compilation and focused owned regression classes from acceptance-matrix command timing; record exact command, exit and assertions. No dependent future root/release work is required for this task's acceptance.",
      "Launch actual MainActivity, authenticate to owned fixture, observe default Hub and navigate nested picker/capabilities/Settings/feed/back; check stale click refusal. This focused root smoke uses completed features only and must finish before lifetime-integration admission, not await P08.",
      "Collect terminal implementation and passing independent review after stopped-wave checks; write exact results and reviewer provenance to plans/261107-0305-android-agent-hub-redesign/reports/integrate-active-hub-root-completion.md and current helper-schema evidence to plans/261107-0305-android-agent-hub-redesign/reports/integrate-active-hub-root-evidence.json. Smoke/review cannot be waived; failed or missing gates block completion. P08 separately repeats full integrated/live/device release suites."
    ]
  },
  {
    "id": "integrate-retained-lifetimes",
    "title": "Unify retained documents and process-safe terminal intent restoration",
    "blocked_by": [
      "integrate-active-hub-root"
    ],
    "allowed_files": [
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidPreferencesStore.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/lifecycle/AndroidLifecycleCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceFileOwner.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectTargetStore.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsRecoverySupervisor.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/lifecycle/LifecycleCoordinator.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/AgentHubLifecycleTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModelTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/GitWorkspaceRuntimeBindingTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/WsRecoverySupervisorTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceDepartureTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/RetainedWorkspaceLifecycleTest.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/AgentHubRootJourneys.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeTerminalAgentsJourneys.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeTerminalAgentsServerFixture.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/FocusedGitRootSmokeTest.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeGitWorkspaceJourneys.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/WorkbenchJourneys.kt",
      "plans/261107-0305-android-agent-hub-redesign/reports/integrate-retained-lifetimes-completion.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/integrate-retained-lifetimes-evidence.json"
    ],
    "constraints": [
      "Stay within this literal allowlist; escalate additional writes to integration owner before editing.",
      "Implementer authors tests but runs no checks. After every writer in this selected coherent wave stops, coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before evidence-backed completion or successor admission; no sibling-edit checks, no defer-to-P08 completion."
    ],
    "acceptance": [
      "Retained owner, not alias session/workspace, owns native disposal; surviving aliases retain undo/save after opposite close; final dirty choices remain reachable, save/reload and all-alias tier replacement are fenced, late old detach cannot damage successor. Retirement preserves recoverable in-process dirty state but revokes saves.",
      "Persisted ambiguous dispatch cannot disappear into replacement permission after process death.",
      "Input/resources/notification intake are bound to current owner and Activity lifecycle; unclean WS close is an honest failure state."
    ],
    "verification": [
      "At this task/wave stop barrier, coordinator runs applicable existing Gradle shared/app compilation and focused owned regression classes from acceptance-matrix command timing; record exact command, exit and assertions. No dependent future root/release work is required for this task's acceptance.",
      "Through actual MainActivity on ready device and owned fixture, perform A edit/B alias/A tab and workspace close/B undo+save (also reverse order), final dirty close choices, save/close/reload races, all-alias tier replacement and late old-view detach; observe retirement revoke/recoverable dirty state, rotation and restored unknown-create blocking. Full release/device matrix remains P08; missing device blocks this focused smoke.",
      "Collect terminal implementation and passing independent review after stopped-wave checks; write exact results and reviewer provenance to plans/261107-0305-android-agent-hub-redesign/reports/integrate-retained-lifetimes-completion.md and current helper-schema evidence to plans/261107-0305-android-agent-hub-redesign/reports/integrate-retained-lifetimes-evidence.json. Smoke/review cannot be waived; failed or missing gates block completion. P08 separately repeats full integrated/live/device release suites."
    ]
  }
]
```

- [ ] <!-- evcrate-task:integrate-active-hub-root --> Mount settled features in one active Hub root
- [ ] <!-- evcrate-task:integrate-retained-lifetimes --> Unify retained documents and process-safe terminal intent restoration

## Behavior acceptance and qualification
Each task's acceptance/verification arrays are binding at its own stopped coherent-wave completion barrier; the coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before helper evidence-backed completion and dependent admission. Implementers run no checks, and no coordinator checks occur while any sibling writer edits. P01–P06 prove component/provider behavior through settled ports, not unimplemented future MainActivity/release wiring; P07 proves its focused active-root/lifetime behavior sequentially. P08 alone repeats full integrated/live/device/human release suites. Tests alone are not smoke. Missing required runtime/device prerequisites block the affected gate; source-only authoring cannot claim runtime success. Record failures/skips/blockers distinctly; no fabricated pass or waiver.

## Risks, privacy, security, failure and rollback
Risk: integration of all root authorities is sequential, not another G-A branch. No leaf can edit shared root/ports to bypass this barrier. Privacy: persisted intent contains no command/output/secret; media/notification/SAF ports use current owner and generic public version. Failure: retirement/rebind interruption leaves unavailable authority and preserved dirty buffers, never fallback selection. Rollback: withdraw active Hub binding before reverting its prerequisite signatures; preserve persisted uncertain creates, remote PTYs and in-memory buffers. No global profile/cache reset.

## Downstream barrier
integrate-active-hub-root stops/checks/reviews/evidence-completes alone at W08 before integrate-retained-lifetimes admission. Lifetime task then stops/checks/reviews/evidence-completes at W09, with its own ready-device runtime smoke; it cannot await P08 to qualify itself. P08 full release gates start only after both completed integrations. No checks while any writer edits; failures reopen explicitly scoped repair before a fresh stopped-wave check.

## Unresolved questions
None for product design. User confirmed adaptive navigator and all already-connected profiles; no saved-profile auto-connect/keepalive. [Final validation](reports/final-plan-validation.md) preserves C1-C10, task contracts and ownership unchanged. Device/WS/auth/crypto-fixture checks remain explicit implementation gates, not observed passes.
