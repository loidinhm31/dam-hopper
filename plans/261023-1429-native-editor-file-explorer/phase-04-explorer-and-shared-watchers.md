# Phase 04 — Explorer actions and shared watch demand

## Context and status
- Priority P2. Status pending; phase01 feasibility gates block downstream scheduling. Owner: Explorer worker.
- Authority: [overview](plan.md), [contracts C1-C7](contracts.md), [acceptance matrix](acceptance-matrix.md).
- Evidence: [coordinator](reports/coordinator-evidence.md), [files/watchers](reports/files-watchers-evidence.md), [editor/widget](reports/editor-widget-evidence.md), [approved design](../reports/brainstorm-261023-1351-native-editor-file-explorer.md).
- Source anchors and current gaps in those evidence reports are read-only; this phase describes future changes, not observed success. Root for every literal path: `G:/ws/sharing/dam-hopper/`.

## Insights
Server subscriptions are nonrecursive and overflow drops them. Current root-only watch and unlimited early queue miss expanded folders and socket retirement. Existing virtualized tree/dialogs reusable; focused Files must hide dormant project-wide search UI without deleting its module.

## Requirements and architecture
Implement C5/C6, lazy hidden-file tree, refresh/selection/create file/folder/rename/move/confirmed delete/copy remote path and loading/empty/disconnected/unavailable/errors. Initial mutation UI uses frozen document guard port; cross-feature transaction wired sequentially in phase06. No drag/drop, transfer or broad workbench mount.
- NFR: preserve existing KMP/platform boundary, PascalCase Kotlin naming, bounded memory/queues and target isolation; no avoidable per-edit full-text allocation. Secrets/contents excluded from logs; no durable draft persistence.
- Contracts apply in full; this phase may implement only its allocated slice. Frozen common signatures are read-only after phase02 unless coordinator revises affected task graph/callers first.

## Exact ownership and conflict prevention
- Task lists below expand every writable path; paths in JSON are normalized project-relative literals (no globs/directories). All other source, server, parent reports and related plans are read-only.
- Creation occurs only at first listed owner; later listed tasks receive Modify ownership after their dependency chain completes. Listed Delete actions remove only code made obsolete by this cutover.
- Main is the sole integration owner. Workers do not widen ownership or run builds/tests/formatters mid-flight; Main coordinates planned verification once the coherent dependency group lands.
- Concurrent scheduling is permitted only for phases03/04/05 after phase02; within each phase follow explicit task edges. Overlapping sequential ownership transfers below are intentional, never simultaneous.

## Ordered task implementation and related files

### `implement-shared-directory-watchers` — Implement demand-shared watches with ordered listing recovery
- [ ] <!-- evcrate-task:implement-shared-directory-watchers --> Implement demand-shared watches with ordered listing recovery
- Dependencies: `freeze-document-and-watch-facades`.
- Exact writable files/actions:
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeSubscription.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt`.
  - Create: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinator.kt`.
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileTreeStateTest.kt`.
  - Create: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinatorTest.kt`.
- Ordered steps:
  1. Implement one reference-counted nonrecursive subscription per owner/socket/directory for root, expanded dirs and document parent demand. Subscribe before list, listener before subscribe; origin-qualified cleanup and captured target-relative routing.
  2. Replace unlimited early channel with finite event count+byte bounds; attach request/subscription incarnation/socket/owner to every event. Baseline invalidation on overflow or missing relative routing cannot silently drop changes.
  3. Track listing request epochs/event watermarks; replay newer buffered changes or refetch when incomplete, never overwrite newer changes with delayed listing. Dedupe open-parent and expanded-dir consumers.
  4. On server/client overflow recreate dropped subscription then refetch loaded dirs/open-doc metadata. Pause background; on foreground/socket replacement restore demand and reconcile, ignoring retired callbacks. Preserve selected/expanded/scroll model state.
- Acceptance:
  - Nested events update all demanded directories/open parents without duplicate subscriptions; collapsed tree releases only its reference.
  - Delayed list/early event/reused subId on new socket cannot corrupt baseline; overflow invalidates and recreates.
  - Queues and event history finite; background/foreground reconciliation current before writes enabled.
- Planned checks / observable evidence (not executed):
  - .\native-app\gradlew.bat -p native-app :shared:jvmTest --tests "dev.damhopper.nativeapp.features.files.FileTreeStateTest" --tests "dev.damhopper.nativeapp.features.files.FileWatchCoordinatorTest"; control event/list order, subId reuse, finite buffer overflow and lifecycle transitions.

### `implement-focused-explorer-actions` — Expose complete inline touch explorer actions
- [ ] <!-- evcrate-task:implement-focused-explorer-actions --> Expose complete inline touch explorer actions
- Dependencies: `implement-shared-directory-watchers`.
- Exact writable files/actions:
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileScreens.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FilesTopBar.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileActionDialogs.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModalsHost.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeHelpers.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeItemView.kt`.
  - Create: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinatorTest.kt`.
- Ordered steps:
  1. Add focused explorer mode/actions without a second nav row or FAB: lazy expand, hidden toggle, refresh, selection, file/folder create, rename, explicit destination move, confirmed delete, copy remote path. Use platform clipboard through existing Compose boundary, preserve server/target relative semantics.
  2. Hide search/replace/transfer entry points only for focused workspace; dormant components remain available to existing Workbench caller. Reuse virtualized rows and inline dialogs.
  3. Wire the frozen operation/outcome ports and the dirty-guard port from phase02 `EditorSessionPorts.kt` (read-only here) and local phase-aware outcome presentation; definite failures retain inputs/identity, Unknown shows unresolved state without retry. Full editor identity transaction belongs to phase06, not optimistic path updates.
  4. Give every operation loading/disconnected/unavailable/validation/server-reject states; retain dialog state on error/rotation through retained action state, and explicitly confirm deletion before dispatch.
- Acceptance:
  - All approved explorer actions have touch-friendly reachable inline UI; focused Files exposes no project-wide search/transfer.
  - Definite failure keeps tree/tab identity and dialog input; no optimistic path rekey before confirmed server success.
  - Root/protected paths remain rejected with visible error; no force_git bypass.
- Planned checks / observable evidence (not executed):
  - .\native-app\gradlew.bat -p native-app :shared:jvmTest --tests "dev.damhopper.nativeapp.features.files.FileMutationCoordinatorTest"; verify create/move validation, confirmation, definite reject and unresolved outcome presentation.
  - Final active-root device journey exercises clipboard remote path, hidden files, empty/disconnected states and real server mutation bytes.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "implement-shared-directory-watchers",
    "title": "Implement demand-shared watches with ordered listing recovery",
    "blocked_by": [
      "freeze-document-and-watch-facades"
    ],
    "allowed_files": [
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeSubscription.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinator.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileTreeStateTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinatorTest.kt"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "Nested events update all demanded directories/open parents without duplicate subscriptions; collapsed tree releases only its reference.",
      "Delayed list/early event/reused subId on new socket cannot corrupt baseline; overflow invalidates and recreates.",
      "Queues and event history finite; background/foreground reconciliation current before writes enabled."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.files.FileTreeStateTest\" --tests \"dev.damhopper.nativeapp.features.files.FileWatchCoordinatorTest\"; control event/list order, subId reuse, finite buffer overflow and lifecycle transitions."
    ]
  },
  {
    "id": "implement-focused-explorer-actions",
    "title": "Expose complete inline touch explorer actions",
    "blocked_by": [
      "implement-shared-directory-watchers"
    ],
    "allowed_files": [
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileScreens.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FilesTopBar.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileActionDialogs.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModalsHost.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeHelpers.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeItemView.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinatorTest.kt"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "All approved explorer actions have touch-friendly reachable inline UI; focused Files exposes no project-wide search/transfer.",
      "Definite failure keeps tree/tab identity and dialog input; no optimistic path rekey before confirmed server success.",
      "Root/protected paths remain rejected with visible error; no force_git bypass."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.files.FileMutationCoordinatorTest\"; verify create/move validation, confirmation, definite reject and unresolved outcome presentation.",
      "Final active-root device journey exercises clipboard remote path, hidden files, empty/disconnected states and real server mutation bytes."
    ]
  }
]
```

## Failure, rollback and security
No recursive watcher assumption or refetch-only recovery after dropped subscription. Watcher state never grants write authority itself. Client path validation improves UX, not server security. Rollback detaches demand cleanly from origin sockets; retain uncertain mutation state and dirty buffers.
- Preserve original target/buffers on failure; never use exception suppression, unconditional writes, blind retry, force_git bypass or remote inverse operations as rollback. Authentication/connection retirement revokes authority before UI transitions.
- Escalate missing writable path, unsupported native API, threshold change or severe safety defect to Main; keep gate blocked until explicit scoped revision. No automatic Git/dependency execution is authorized by this plan.

## Completion and next dependencies
Concurrent with phases03/05 after phase02. Phase06 takes mutation/tree/dialog state only after all three complete. Phase07 consumes stable watch-demand and lifecycle ports. No edits to editor/widget files from this phase.
- Exit evidence: exact changed paths, behavioral check commands/results and blockers. Complete only on task acceptance plus coherent integrated evidence; planned command text is not a pass.

## Unresolved questions
- No new product decision. Phase01 feasibility and phase08 runtime/distribution gates remain evidence requirements; unresolved gates block readiness/release.
