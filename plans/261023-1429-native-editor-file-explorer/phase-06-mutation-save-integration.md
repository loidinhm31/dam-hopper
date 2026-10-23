# Phase 06 — Sequential mutation save and identity integration

## Context and status
- Priority P2. Status pending; phase01 feasibility gates block downstream scheduling. Owner: Main (sole integration owner).
- Authority: [overview](plan.md), [contracts C1-C7](contracts.md), [acceptance matrix](acceptance-matrix.md).
- Evidence: [coordinator](reports/coordinator-evidence.md), [files/watchers](reports/files-watchers-evidence.md), [editor/widget](reports/editor-widget-evidence.md), [approved design](../reports/brainstorm-261023-1351-native-editor-file-explorer.md).
- Source anchors and current gaps in those evidence reports are read-only; this phase describes future changes, not observed success. Root for every literal path: `G:/ws/sharing/dam-hopper/`.

## Insights
Independent modules do not establish safe rename/delete vs save. Operations can time out after commit; existing protocol lacks durable operation IDs and directory identity proof. Integrate only after03/04/05 complete, with Main as sole integration owner.

## Requirements and architecture
Apply C4/C5 as a transaction across editor/tree/watch state, with exact-owner subtree reservations and dirty-resolution semantics. Unknown states persist/quarantine until sufficient server evidence; preserve original identity on failure/ambiguity. No new server schema or automatic retry.
- NFR: preserve existing KMP/platform boundary, PascalCase Kotlin naming, bounded memory/queues and target isolation; no avoidable per-edit full-text allocation. Secrets/contents excluded from logs; no durable draft persistence.
- Contracts apply in full; this phase may implement only its allocated slice. Frozen common signatures are read-only after phase02 unless coordinator revises affected task graph/callers first.

## Exact ownership and conflict prevention
- Task lists below expand every writable path; paths in JSON are normalized project-relative literals (no globs/directories). All other source, server, parent reports and related plans are read-only.
- Creation occurs only at first listed owner; later listed tasks receive Modify ownership after their dependency chain completes. Listed Delete actions remove only code made obsolete by this cutover.
- Main is the sole integration owner. Workers do not widen ownership or run builds/tests/formatters mid-flight; Main coordinates planned verification once the coherent dependency group lands.
- Concurrent scheduling is permitted only for phases03/04/05 after phase02; within each phase follow explicit task edges. Overlapping sequential ownership transfers below are intentional, never simultaneous.

## Ordered task implementation and related files

### `integrate-subtree-mutation-transactions` — Integrate dirty guards saves and confirmed path rekey
- [ ] <!-- evcrate-task:integrate-subtree-mutation-transactions --> Integrate dirty guards saves and confirmed path rekey
- Dependencies: `implement-incarnation-safe-tabs-saves`, `implement-focused-explorer-actions`, `bridge-shared-editor-presentation`.
- Exact writable files/actions:
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileOperationArbiter.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModalsHost.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileActionDialogs.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabSaveCoordinator.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinatorTest.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileOperationArbiterTest.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSaveRaceTest.kt`.
  - Create: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileEditorMutationTest.kt`.
- Ordered steps:
  1. Connect mutation coordinator to document dirty/close port and shared arbiter; reserve source+destination subtrees before prompt. Resolve existing save/unknown outcomes first; allow child-capability Save without mutex across prompt/network or self-deadlock.
  2. Freeze affected edits at final decision/dispatch, guard consent by revisions and restore focus on Cancel. Save must settle current dirty docs; destination open-tab collision resolved before send. No local discard until destructive action/explicit consent commits.
  3. On confirmed rename/move atomically rekey descendant sessions/tab keys/tree selection/expanded paths/watch demand while keeping native document/undo identity; invalidate old path callbacks. On rejection preserve everything.
  4. On confirmed/external delete make retained affected dirty docs unavailable, no accidental save-based recreation. Record original identity/operation for unknown outcomes; action UI blocks duplicate mutation/retry.
  5. Add deterministic save-vs-rename/move/delete descendants, a-vs-ab segment, dirty Save/Discard/Cancel, failed op, destination collision and callback rekey tests.
- Acceptance:
  - No in-flight conflicting save can write old/new subtree during mutation; unrelated owners/paths remain independent.
  - Only confirmed mutations publish identity; confirmed directory moves update every descendant coherently.
  - Dirty consent cannot erase newer edits; failures/cancel preserve buffers and local identity; remote deletion cannot recreate.
- Planned checks / observable evidence (not executed):
  - .\native-app\gradlew.bat -p native-app :shared:jvmTest --tests "dev.damhopper.nativeapp.features.files.FileEditorMutationTest" --tests "dev.damhopper.nativeapp.features.files.FileOperationArbiterTest" --tests "dev.damhopper.nativeapp.features.editor.EditorSaveRaceTest"; use deterministic latches at reservation/prompt/send/result boundaries.

### `integrate-unknown-outcome-reconciliation` — Reconcile uncertain saves and source destination mutations
- [ ] <!-- evcrate-task:integrate-unknown-outcome-reconciliation --> Reconcile uncertain saves and source destination mutations
- Dependencies: `integrate-subtree-mutation-transactions`.
- Exact writable files/actions:
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FsWriteCoordinator.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileOperationOutcome.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabSaveCoordinator.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModalsHost.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileEditorMutationTest.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSaveRaceTest.kt`.
- Ordered steps:
  1. Carry local phase/op/captured owner/path/submitted baseline through cancellation/disconnect; precommit failure is not postcommit unknown. Mark uncertain before mutating send attempt, never infer unsent from generic transport exception.
  2. On exact-owner reconnect reconcile current server metadata/bytes for unknown save; recognize submitted bytes as observed baseline only when safely established, keep newer edits dirty and conflicting remote bytes unresolved. No retry before reconciliation.
  3. For create/rename/move/delete probe original source AND destination and loaded parent listings using captured pre-op evidence. Handle late matching result only on original valid authority. Do not infer operation identity from existence or equal mtime/content alone when external writers can reproduce it.
  4. Retain reservation/original local path/buffers and explicit unresolved UI if protocol cannot prove outcome. Allow informed local departure/discard without asserting remote failure or lifting owner quarantine; never automatically retarget/recreate/retry.
  5. Add postcommit-timeout, disconnect-at-each-stage, lost mutation result with recovered source/destination, external recreation/collision and ambiguous-directory tests.
- Acceptance:
  - Unknown result never becomes ordinary retryable failure or a successful rekey based on existence alone.
  - Recovered submitted save baseline preserves edits made after submission; old-socket/tab callbacks cannot settle a new operation.
  - Ambiguous directory mutation remains visibly unresolved/quarantined with buffers preserved and no duplicate dispatch.
- Planned checks / observable evidence (not executed):
  - .\native-app\gradlew.bat -p native-app :shared:jvmTest --tests "dev.damhopper.nativeapp.features.files.FileEditorMutationTest" --tests "dev.damhopper.nativeapp.features.editor.EditorSaveRaceTest"; inject actual boundary transport ambiguity rather than mocking coordinator success.
  - Final real-server journey drops/loses response after committed save/op and reads both source/destination and bytes; report unavoidable ambiguous outcomes as unresolved, not passes.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "integrate-subtree-mutation-transactions",
    "title": "Integrate dirty guards saves and confirmed path rekey",
    "blocked_by": [
      "implement-incarnation-safe-tabs-saves",
      "implement-focused-explorer-actions",
      "bridge-shared-editor-presentation"
    ],
    "allowed_files": [
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileOperationArbiter.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModalsHost.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileActionDialogs.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabSaveCoordinator.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinatorTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileOperationArbiterTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSaveRaceTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileEditorMutationTest.kt"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "No in-flight conflicting save can write old/new subtree during mutation; unrelated owners/paths remain independent.",
      "Only confirmed mutations publish identity; confirmed directory moves update every descendant coherently.",
      "Dirty consent cannot erase newer edits; failures/cancel preserve buffers and local identity; remote deletion cannot recreate."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.files.FileEditorMutationTest\" --tests \"dev.damhopper.nativeapp.features.files.FileOperationArbiterTest\" --tests \"dev.damhopper.nativeapp.features.editor.EditorSaveRaceTest\"; use deterministic latches at reservation/prompt/send/result boundaries."
    ]
  },
  {
    "id": "integrate-unknown-outcome-reconciliation",
    "title": "Reconcile uncertain saves and source destination mutations",
    "blocked_by": [
      "integrate-subtree-mutation-transactions"
    ],
    "allowed_files": [
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FsWriteCoordinator.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileOperationOutcome.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabSaveCoordinator.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModalsHost.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileEditorMutationTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSaveRaceTest.kt"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "Unknown result never becomes ordinary retryable failure or a successful rekey based on existence alone.",
      "Recovered submitted save baseline preserves edits made after submission; old-socket/tab callbacks cannot settle a new operation.",
      "Ambiguous directory mutation remains visibly unresolved/quarantined with buffers preserved and no duplicate dispatch."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.files.FileEditorMutationTest\" --tests \"dev.damhopper.nativeapp.features.editor.EditorSaveRaceTest\"; inject actual boundary transport ambiguity rather than mocking coordinator success.",
      "Final real-server journey drops/loses response after committed save/op and reads both source/destination and bytes; report unavoidable ambiguous outcomes as unresolved, not passes."
    ]
  }
]
```

## Failure, rollback and security
This is sequential ownership transfer, not a fourth concurrent worker. Protocol may make some unknown directory operations permanently ambiguous; safe unresolved state is required behavior, not fake recovery. Rollback never destroys retained buffers/quarantine or issues inverse remote mutations automatically.
- Preserve original target/buffers on failure; never use exception suppression, unconditional writes, blind retry, force_git bypass or remote inverse operations as rollback. Authentication/connection retirement revokes authority before UI transitions.
- Escalate missing writable path, unsupported native API, threshold change or severe safety defect to Main; keep gate blocked until explicit scoped revision. No automatic Git/dependency execution is authorized by this plan.

## Completion and next dependencies
Both tasks complete before phase07 mounts workspace. Main receives files explicitly from03/04 plus stable widget05; no parallel writers. Phase08 actual integration tests follow07. Frozen interface edits require coordinator review, not ad hoc worker changes.
- Exit evidence: exact changed paths, behavioral check commands/results and blockers. Complete only on task acceptance plus coherent integrated evidence; planned command text is not a pass.

## Unresolved questions
- No new product decision. Phase01 feasibility and phase08 runtime/distribution gates remain evidence requirements; unresolved gates block readiness/release.
