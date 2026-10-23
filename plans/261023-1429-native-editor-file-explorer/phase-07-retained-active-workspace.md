# Phase 07 — Retained active workspace terminal and guarded navigation

## Context and status
- Priority P2. Status pending; phase01 feasibility gates block downstream scheduling. Owner: Main (sole host/runtime integration owner).
- Authority: [overview](plan.md), [contracts C1-C7](contracts.md), [acceptance matrix](acceptance-matrix.md).
- Evidence: [coordinator](reports/coordinator-evidence.md), [files/watchers](reports/files-watchers-evidence.md), [editor/widget](reports/editor-widget-evidence.md), [approved design](../reports/brainstorm-261023-1351-native-editor-file-explorer.md).
- Source anchors and current gaps in those evidence reports are read-only; this phase describes future changes, not observed success. Root for every literal path: `G:/ws/sharing/dam-hopper/`.

## Insights
Active root renders only current ProjectTerminalScreen. MainActivity fields and remember navigation recreate on rotation; local screen controller maps close on composition exit. System Back and terminal Projects clear navigation/session before feature guards. Correct retention must include runtime ownership, not only remember panel state.

## Requirements and architecture
Implement C7 without mounting monolithic WorkbenchScreen. Retain non-Activity profiles/auth/transport/nav/docs/tree/terminal state; release widgets per Activity lifecycle and retained owners only on true close. One header + inline Terminal/Files/Editor row above IME, one visible area on phones/tablets. Every input activation path visibility-gated.
- NFR: preserve existing KMP/platform boundary, PascalCase Kotlin naming, bounded memory/queues and target isolation; no avoidable per-edit full-text allocation. Secrets/contents excluded from logs; no durable draft persistence.
- Contracts apply in full; this phase may implement only its allocated slice. Frozen common signatures are read-only after phase02 unless coordinator revises affected task graph/callers first.

## Exact ownership and conflict prevention
- Task lists below expand every writable path; paths in JSON are normalized project-relative literals (no globs/directories). All other source, server, parent reports and related plans are read-only.
- Creation occurs only at first listed owner; later listed tasks receive Modify ownership after their dependency chain completes. Listed Delete actions remove only code made obsolete by this cutover.
- Main is the sole integration owner. Workers do not widen ownership or run builds/tests/formatters mid-flight; Main coordinates planned verification once the coherent dependency group lands.
- Concurrent scheduling is permitted only for phases03/04/05 after phase02; within each phase follow explicit task edges. Overlapping sequential ownership transfers below are intentional, never simultaneous.

## Ordered task implementation and related files

### `retain-native-workspace-runtime` — Retain non-Activity runtime documents and navigation
- [ ] <!-- evcrate-task:retain-native-workspace-runtime --> Retain non-Activity runtime documents and navigation
- Dependencies: `integrate-unknown-outcome-reconciliation`.
- Exact writable files/actions:
  - Modify: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt`.
  - Create: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt`.
  - Modify: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/lifecycle/AndroidLifecycleCoordinator.kt`.
  - Create: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowState.kt`.
  - Create: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt`.
  - Create: `native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/RetainedWorkspaceLifecycleTest.kt`.
- Ordered steps:
  1. Create ViewModel retained runtime owner for existing registry/profile repository/preferences/auth/transport/navigation and per-logical-owner workspace stores; applicationContext services only. Initialize once, bind new Activity lifecycle/view surface separately, close truly onCleared/explicit resolved workspace destroy.
  2. Lift composition-scoped client/repository reconstruction out of DamHopperMobileApp into retained binding state. Generation/socket retirement detaches documents immediately; exact-owner reconnect reconciles before writes, another owner gets independent store.
  3. Introduce ProjectWorkspaceState with local active panel, document/tree/watch owners, selected PTY and departure intent. Inject Android document factory/surface host produced in05; do not stash widgets/Activity in state.
  4. Forward background/foreground watch/input lifecycle; Activity onDestroy during configuration change only detaches adapter/widgets. Forced auth/transport loss revokes writes first and retains detached drafts reachable on reauth/original-owner recovery.
  5. Retain route/project/session on actual Activity recreation; implement lifecycle tests that recreate host rather than merely recomposing a state object.
- Acceptance:
  - Rotation retains profile runtime, logical owner, panel/tree/document/undo and route without stale Activity/native widget references.
  - Forced auth loss keeps original detached buffers while routing auth; exact-owner reconnect reconciles, other profile cannot adopt drafts.
  - True owner close releases resources exactly once; configuration change does not destroy store.
- Planned checks / observable evidence (not executed):
  - .\native-app\gradlew.bat -p native-app :shared:jvmTest --tests "dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceStateTest"; verify exact-owner detach/rebind and lifecycle policy.
  - .\native-app\gradlew.bat -p native-app :androidApp:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.damhopper.nativeapp.RetainedWorkspaceLifecycleTest; actual MainActivity recreation and widget/resource evidence required.

### `retain-current-terminal-panel` — Retain current terminal and gate every activation path
- [ ] <!-- evcrate-task:retain-current-terminal-panel --> Retain current terminal and gate every activation path
- Dependencies: `retain-native-workspace-runtime`.
- Exact writable files/actions:
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt`.
  - Create: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt`.
  - Create: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/ProjectTerminalVisibilityTest.kt`.
- Ordered steps:
  1. Extract current screen controller/session maps, scope, queues, active selection, font/view state into retained ProjectTerminalState. Keep existing VtTerminalSurface/atomic snapshots/replay/owner/session incarnation/FIFO geometry behavior; never use old workbench terminal.
  2. Refactor current project header to allow shared workspace header while keeping Projects/font/Diag/New Terminal actions, session controls, font10..32sp and font+4sp metrics/pinch behavior. No duplicate project header or second nav surface.
  3. Audit and migrate every isPanelActive=true assignment, including reconnect/replay/attach/reselection/reactivation, to derived panelVisible && foreground && current-authority input policy. All keyboard/paste/IME paths check same policy; hidden editor/terminal clear focus without destroying PTY/doc.
  4. Keep terminal output/session state bounded and retained across Files/Editor panels; unmount/release Android surface without killing remote PTY. Add behavior tests for hidden reconnect/replay/session change attempts and FIFO return.
- Acceptance:
  - Current terminal PTY/session/replay/atomic snapshot/font/pinch/scroll behavior preserved across panel switches and rotation.
  - Hidden terminal accepts no keyboard/paste/IME even when session attach/replay/reconnect completes; visible editor alone accepts edits.
  - No hidden input surface or newer activation branch bypasses visibility gate.
- Planned checks / observable evidence (not executed):
  - .\native-app\gradlew.bat -p native-app :shared:jvmTest --tests "dev.damhopper.nativeapp.features.terminal.ProjectTerminalVisibilityTest" --tests "dev.damhopper.nativeapp.features.terminal.TerminalReplayGateTest" --tests "dev.damhopper.nativeapp.features.terminal.TerminalReplayRenderingTest" --tests "dev.damhopper.nativeapp.features.terminal.TerminalSessionControllerTest" --tests "dev.damhopper.nativeapp.features.terminal.TerminalPresentationPolicyTest"; behavior, not assignment-source assertions.
  - Final mounted UI IME/paste/reconnect journey confirms hidden PTY receives no input while same session survives.

### `mount-focused-workspace-and-guard-departures` — Mount focused panels and guard every destructive departure
- [ ] <!-- evcrate-task:mount-focused-workspace-and-guard-departures --> Mount focused panels and guard every destructive departure
- Dependencies: `retain-current-terminal-panel`.
- Exact writable files/actions:
  - Create: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt`.
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigationTest.kt`.
  - Create: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceDepartureTest.kt`.
- Ordered steps:
  1. Mount focused Files/Editor/current Terminal in active selected project route, inject retained state and native host; file open selects Editor. One header/nav row above keyboard, one visible content phone/tablet, no FAB or unrelated workbench panels.
  2. Implement single retained departure guard for tab close and workspace leave: capture intended action/dirty revisions, Save/Discard/Cancel; Save waits for confirmed latest saves and no newer edits. Integrate existing shared editor close intents, preserve route/session on Cancel/failure/Unknown.
  3. Route terminal Projects, system Back/finish, profile/project switches, deep link owner change and root fallback nav through guard BEFORE nav mutation/selectSession(null). Coalesce concurrent exits; background/auth forced transitions revoke authority and retain drafts rather than await impossible Save.
  4. Migrate active navigation callers and preserve top-level login/projects/workspace hierarchy. Returning to retained original owner exposes detached drafts and unresolved operation state. Do not invent automatic durable recovery or silently evict old owner buffers.
  5. Finish all active caller migrations and add departure tests including failed save, edit-after-save, cancelled close, forced auth and deep-link switch.
- Acceptance:
  - Installed active app exposes complete browse/manage/edit loop with exactly one visible panel and single inline navigation row.
  - Every voluntary destructive path including System Back resolves dirty state before clearing project/session; save failure/Unknown never loses draft.
  - Forced authority loss prevents writes immediately and leaves recoverable in-memory detached buffers under exact owner.
- Planned checks / observable evidence (not executed):
  - .\native-app\gradlew.bat -p native-app :shared:jvmTest --tests "dev.damhopper.nativeapp.ui.flow.AppFlowNavigationTest" --tests "dev.damhopper.nativeapp.features.workspace.WorkspaceDepartureTest"; save failure and post-snapshot edit must block commit.
  - Phase08 launches real MainActivity and uses visible navigation/Back/Projects/deep-link/auth flows; a standalone state test is insufficient.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "retain-native-workspace-runtime",
    "title": "Retain non-Activity runtime documents and navigation",
    "blocked_by": [
      "integrate-unknown-outcome-reconciliation"
    ],
    "allowed_files": [
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt",
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/lifecycle/AndroidLifecycleCoordinator.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowState.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt",
      "native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/RetainedWorkspaceLifecycleTest.kt"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "Rotation retains profile runtime, logical owner, panel/tree/document/undo and route without stale Activity/native widget references.",
      "Forced auth loss keeps original detached buffers while routing auth; exact-owner reconnect reconciles, other profile cannot adopt drafts.",
      "True owner close releases resources exactly once; configuration change does not destroy store."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceStateTest\"; verify exact-owner detach/rebind and lifecycle policy.",
      ".\\native-app\\gradlew.bat -p native-app :androidApp:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.damhopper.nativeapp.RetainedWorkspaceLifecycleTest; actual MainActivity recreation and widget/resource evidence required."
    ]
  },
  {
    "id": "retain-current-terminal-panel",
    "title": "Retain current terminal and gate every activation path",
    "blocked_by": [
      "retain-native-workspace-runtime"
    ],
    "allowed_files": [
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/ProjectTerminalVisibilityTest.kt"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "Current terminal PTY/session/replay/atomic snapshot/font/pinch/scroll behavior preserved across panel switches and rotation.",
      "Hidden terminal accepts no keyboard/paste/IME even when session attach/replay/reconnect completes; visible editor alone accepts edits.",
      "No hidden input surface or newer activation branch bypasses visibility gate."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.terminal.ProjectTerminalVisibilityTest\" --tests \"dev.damhopper.nativeapp.features.terminal.TerminalReplayGateTest\" --tests \"dev.damhopper.nativeapp.features.terminal.TerminalReplayRenderingTest\" --tests \"dev.damhopper.nativeapp.features.terminal.TerminalSessionControllerTest\" --tests \"dev.damhopper.nativeapp.features.terminal.TerminalPresentationPolicyTest\"; behavior, not assignment-source assertions.",
      "Final mounted UI IME/paste/reconnect journey confirms hidden PTY receives no input while same session survives."
    ]
  },
  {
    "id": "mount-focused-workspace-and-guard-departures",
    "title": "Mount focused panels and guard every destructive departure",
    "blocked_by": [
      "retain-current-terminal-panel"
    ],
    "allowed_files": [
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt",
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigationTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceDepartureTest.kt"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "Installed active app exposes complete browse/manage/edit loop with exactly one visible panel and single inline navigation row.",
      "Every voluntary destructive path including System Back resolves dirty state before clearing project/session; save failure/Unknown never loses draft.",
      "Forced authority loss prevents writes immediately and leaves recoverable in-memory detached buffers under exact owner."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.ui.flow.AppFlowNavigationTest\" --tests \"dev.damhopper.nativeapp.features.workspace.WorkspaceDepartureTest\"; save failure and post-snapshot edit must block commit.",
      "Phase08 launches real MainActivity and uses visible navigation/Back/Projects/deep-link/auth flows; a standalone state test is insufficient."
    ]
  }
]
```

## Failure, rollback and security
Main alone owns sequential host/runtime/terminal changes. Do not keep hidden widgets mounted merely to preserve state/input; separate document/controller lifetime. Forced navigation never destroys dirty buffers. Rollback restores active-root terminal only as coherent unreleased cutover while preserving quarantined state; no backend/PTy kill operations.
- Preserve original target/buffers on failure; never use exception suppression, unconditional writes, blind retry, force_git bypass or remote inverse operations as rollback. Authentication/connection retirement revokes authority before UI transitions.
- Escalate missing writable path, unsupported native API, threshold change or severe safety defect to Main; keep gate blocked until explicit scoped revision. No automatic Git/dependency execution is authorized by this plan.

## Completion and next dependencies
All tasks sequential. Phase08 owns actual-app tests/build/license/docs after07 completes. Prior tests are planned checks, not permission to run during this planning assignment. No broader native release gate is satisfied by reachability alone.
- Exit evidence: exact changed paths, behavioral check commands/results and blockers. Complete only on task acceptance plus coherent integrated evidence; planned command text is not a pass.

## Unresolved questions
- No new product decision. Phase01 feasibility and phase08 runtime/distribution gates remain evidence requirements; unresolved gates block readiness/release.
