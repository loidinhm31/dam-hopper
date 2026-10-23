# Phase 02 — Freeze identity, document and repository boundaries

## Context and status
- Priority P2. Status pending; phase01 feasibility gates block downstream scheduling. Owner: Main (architecture/integration owner).
- Authority: [overview](plan.md), [contracts C1-C7](contracts.md), [acceptance matrix](acceptance-matrix.md).
- Evidence: [coordinator](reports/coordinator-evidence.md), [files/watchers](reports/files-watchers-evidence.md), [editor/widget](reports/editor-widget-evidence.md), [approved design](../reports/brainstorm-261023-1351-native-editor-file-explorer.md).
- Source anchors and current gaps in those evidence reports are read-only; this phase describes future changes, not observed success. Root for every literal path: `G:/ws/sharing/dam-hopper/`.

## Insights
Existing ProjectTargetRef owner assertions and ConnectionRef/SocketInstanceRef are reusable. FileRepository currently accepts mixed owners, decodes UTF-8 lossily and widens fallback. FsWriteCoordinator and fs:op do not coordinate. Shared document interfaces must freeze before disjoint workers touch core/widget callers.

## Requirements and architecture
Implement C1/C3/C4/C5 repository seams using existing transport, then freeze C2/C6 facades. Every changed public signature migrates dormant callers and affected tests here or assigns a precise downstream caller in the disjoint group. No duplicate file client or retained Activity. API names below are common Kotlin design choices, not guessed Sora calls.
- NFR: preserve existing KMP/platform boundary, PascalCase Kotlin naming, bounded memory/queues and target isolation; no avoidable per-edit full-text allocation. Secrets/contents excluded from logs; no durable draft persistence.
- Contracts apply in full; this phase may implement only its allocated slice. Frozen common signatures are read-only after phase02 unless coordinator revises affected task graph/callers first.

## Exact ownership and conflict prevention
- Task lists below expand every writable path; paths in JSON are normalized project-relative literals (no globs/directories). All other source, server, parent reports and related plans are read-only.
- Creation occurs only at first listed owner; later listed tasks receive Modify ownership after their dependency chain completes. Listed Delete actions remove only code made obsolete by this cutover.
- Main is the sole integration owner. Workers do not widen ownership or run builds/tests/formatters mid-flight; Main coordinates planned verification once the coherent dependency group lands.
- Concurrent scheduling is permitted only for phases03/04/05 after phase02; within each phase follow explicit task edges. Overlapping sequential ownership transfers below are intentional, never simultaneous.

## Ordered task implementation and related files

### `freeze-file-owner-and-operation-boundary` — Establish owner-safe bounded file and operation boundary
- [ ] <!-- evcrate-task:freeze-file-owner-and-operation-boundary --> Establish owner-safe bounded file and operation boundary
- Dependencies: `qualify-retained-native-document`.
- Exact writable files/actions:
  - Create: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceFileOwner.kt`.
  - Create: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileOperationOutcome.kt`.
  - Create: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileOperationArbiter.kt`.
  - Create: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileWatchContracts.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModels.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FsWriteCoordinator.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ApiClient.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsConnection.kt`.
  - Create: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/SocketBoundMessage.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeSubscription.kt` (socket-origin consumer migration only; full watcher work transfers to04).
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt` (local outcome caller migration only; actions/integration transfer to04/06).
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/ReplaceCoordinator.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt`.
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileRepositoryTest.kt`.
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/SearchAndReplaceTest.kt`.
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EncryptedSaveCoordinatorTest.kt`.
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/ApiClientTest.kt`.
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/WsConnectionTest.kt`.
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileTreeStateTest.kt` (repository construction/outcome fixture migration; watcher behavior transfers to04).
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepositoryTest.kt` (repository fixture/signature migration; loader coverage transfers to03).
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsStateTest.kt` (repository fixture/signature migration; tab coverage transfers to03).
  - Create: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileOperationArbiterTest.kt`.
- Ordered steps:
  1. Introduce structured logical owner/authority values and owner checks at FileRepository construction and before/after IO. Account identity source (gate): server-returned `AuthSession.user` from the authenticated `AuthStatus.Authenticated` session (`features/profiles/AuthState.kt:45`), combined with normalized `ServerProfile.baseUrl` and profile ID; never `ServerProfile.username` or display labels alone. Loopback `--no-auth` dev sessions report a constant `dev-user`; treat as a valid account only for that endpoint. If implementation finds `user` absent/unstable for a supported auth path, stop and escalate a design revision; do not invent identity or silently disable all writes.
  2. Add transport-origin socket envelope/observer and expected-socket dispatch seam to existing WsConnection, preserving unrelated exported signatures and single existing runtime. Atomically bind expected socket, captured writer and request correlation against replacement under existing transport serialization; never defer an unguarded writer lookup/send after the check or wait for server response inside dispatch serialization. Migrate FileRepository, FsWriteCoordinator and FileTreeSubscription plus listed test fixtures; origin stamped at dispatch, not sampled after buffering. No wire/schema change, compatibility alias or unrelated transport rewrite. If exported signatures must change, re-scope every caller first.
  3. Implement bounded byte helper on existing ApiClient retaining auth/redaction/redirect/current-owner behavior; file reads always offset+len and enforce encoded/decoded/received bounds before strict decode. Preserve mixed wire casing and existing binary markers.
  4. Define phase-aware NotSubmitted/Rejected/Confirmed/Unknown local outcomes; classify before op/commit dispatch conservatively, retain cancellation uncertainty. Keep wire DTOs unchanged and stream order begin/chunk/commit.
  5. Implement retained target-scoped segment-aware reservation primitive with child-save capability, pending/quarantined tokens and nonblocking prompts; expose watch-demand/event contracts, no full watcher implementation yet.
  6. Migrate all changed direct production consumers now: EditorRepository, FileMutationCoordinator, dormant ReplaceCoordinator/WorkbenchScreen; migrate every repository-constructor/result test fixture in FileRepositoryTest, FileTreeStateTest, EditorRepositoryTest, EditorTabsStateTest, SearchAndReplaceTest and EncryptedSaveCoordinatorTest before the phase02 compile/test gate. Later phases receive behavior ownership, not a deferred broken signature migration. Keep unrelated transfer/search implementation unchanged. Record identity/signature/caller map in interface-freeze.md.
- Acceptance:
  - Cross-owner API/WS/target requests reject; bounded fallback cannot produce editable lossy or oversize text.
  - Operation outcome distinguishes no mutating submission, definite rejection, confirmed result and ambiguous dispatch without new server messages.
  - Path/subtree reservations do not serialize unrelated owners or confuse a with ab; existing changed callers compile together after the freeze group.
  - File event origin and expected-socket dispatch are transport-qualified; old events cannot be relabeled, and replacement between check/writer selection/queue/dispatch cannot redirect file actions to new socket. Identified changed production/test callers compile before02 gate; implementation must audit actual full caller set.
- Planned checks / observable evidence (not executed):
  - .\native-app\gradlew.bat -p native-app :shared:jvmTest --tests "dev.damhopper.nativeapp.features.files.FileRepositoryTest" --tests "dev.damhopper.nativeapp.features.files.SearchAndReplaceTest" --tests "dev.damhopper.nativeapp.features.files.FileOperationArbiterTest" --tests "dev.damhopper.nativeapp.core.transport.ApiClientTest" --tests "dev.damhopper.nativeapp.core.transport.WsConnectionTest" --tests "dev.damhopper.nativeapp.features.terminal.TerminalSessionControllerTest" --tests "dev.damhopper.nativeapp.features.terminal.TerminalReplayGateTest" --tests "dev.damhopper.nativeapp.features.terminal.TerminalReplayRenderingTest"; all test sources must compile, including later phase fixture consumers. Terminal suites guard the shared WsConnection dispatch change against PTY regressions.
  - Use protocol behavior tests for payload casing, stream order, old-socket/reused-subId origin and replacement between authority check/writer selection/queue/dispatch; no redirect to new writer, conservative submission classification and no source-string assertions.

### `freeze-document-and-watch-facades` — Freeze document factory events and integration signatures
- [ ] <!-- evcrate-task:freeze-document-and-watch-facades --> Freeze document factory events and integration signatures
- Dependencies: `freeze-file-owner-and-operation-boundary`.
- Exact writable files/actions:
  - Create: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorDocument.kt`.
  - Create: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSessionPorts.kt`.
  - Create: `plans/261023-1429-native-editor-file-explorer/interface-freeze.md`.
- Ordered steps:
  1. Define common EditorDocument/Factory/event/view-state/save-snapshot contract backed by verified phase01 mapping; UI dispatcher ownership, source-token suppression, revision ordering, undo save-points, replace-reset, detach/close and native memory-budget hooks explicit.
  2. Publish exact immutable identity/load/save/range/watch-demand/mutation bridge inputs and outputs already supplied by previous task; include owner/incarnation/request/revision fencing and one document authority. Do not invent language APIs; link version proof.
  3. In `EditorSessionPorts.kt`, freeze every editor port consumed across the concurrent group: post-cutover tab read model (metadata + bounded range window, no content/saved/submitted strings), session command port (document handle, undo/redo/find/selection delegation), close intent (Save/Discard/Cancel with captured revisions), conflict choice (Reload/Explicit overwrite/Cancel), save outcome view (NotSubmitted/Rejected/Confirmed/Unknown), and the dirty-guard port used by explorer mutations. Phase03 implements these; phase04/05 consume only these ports, never current EditorTab/EditorSession fields.
  4. Freeze signatures and enumerate callsite transfers for phases03/04/05 in interface-freeze.md. Core owns sessions/tabs/load/save, explorer owns subscriptions/tree/actions, widget owns platform document/shared presentation/Workbench compile bridge. Missing required symbols or undecided native APIs block this task.
  5. Choose one finite memory/undo budget from qualification measurements, keep approved remote tiers unchanged; define clean-only eviction/refuse-open behavior. Avoid full text in Compose tab state and diagnostic edit callbacks.
- Acceptance:
  - All common facade signatures/data ownership/threading/event suppression and detach semantics are concrete and documented; native mapping qualified.
  - EditorSessionPorts.kt freezes every tab/session/close/conflict/outcome/dirty-guard port that phases04/05 consume; no worker codes against fields phase03 is removing.
  - 03/04/05 have exclusive literal file sets and no need to edit another worker or frozen contract; API change stops/replans affected workers.
- Planned checks / observable evidence (not executed):
  - Review interface-freeze.md against C1-C7 and actual direct callers before scheduling; no unsupported symbol names or unstated threading.
  - Compile frozen common declarations with migrated repository callers using .\native-app\gradlew.bat -p native-app :shared:compileKotlinJvm; record failures honestly, no downstream start if contract unresolved.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "freeze-file-owner-and-operation-boundary",
    "title": "Establish owner-safe bounded file and operation boundary",
    "blocked_by": [
      "qualify-retained-native-document"
    ],
    "allowed_files": [
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceFileOwner.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileOperationOutcome.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileOperationArbiter.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileWatchContracts.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModels.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FsWriteCoordinator.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ApiClient.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsConnection.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/SocketBoundMessage.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeSubscription.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/ReplaceCoordinator.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileRepositoryTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/SearchAndReplaceTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EncryptedSaveCoordinatorTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/ApiClientTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/WsConnectionTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileTreeStateTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepositoryTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsStateTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileOperationArbiterTest.kt"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "Cross-owner API/WS/target requests reject; bounded fallback cannot produce editable lossy or oversize text.",
      "Operation outcome distinguishes no mutating submission, definite rejection, confirmed result and ambiguous dispatch without new server messages.",
      "Path/subtree reservations do not serialize unrelated owners or confuse a with ab; existing changed callers compile together after the freeze group.",
      "File event origin and expected-socket dispatch are transport-qualified; old events cannot be relabeled, and replacement between check/writer selection/queue/dispatch cannot redirect file actions to new socket. Identified changed production/test callers compile before02 gate; implementation must audit actual full caller set."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.files.FileRepositoryTest\" --tests \"dev.damhopper.nativeapp.features.files.SearchAndReplaceTest\" --tests \"dev.damhopper.nativeapp.features.files.FileOperationArbiterTest\" --tests \"dev.damhopper.nativeapp.core.transport.ApiClientTest\" --tests \"dev.damhopper.nativeapp.core.transport.WsConnectionTest\" --tests \"dev.damhopper.nativeapp.features.terminal.TerminalSessionControllerTest\" --tests \"dev.damhopper.nativeapp.features.terminal.TerminalReplayGateTest\" --tests \"dev.damhopper.nativeapp.features.terminal.TerminalReplayRenderingTest\"; all test sources must compile, including later phase fixture consumers; terminal suites guard shared WsConnection dispatch.",
      "Use protocol behavior tests for payload casing, stream order, old-socket/reused-subId origin and replacement between authority check/writer selection/queue/dispatch; no redirect to new writer, conservative submission classification and no source-string assertions."
    ]
  },
  {
    "id": "freeze-document-and-watch-facades",
    "title": "Freeze document factory events and integration signatures",
    "blocked_by": [
      "freeze-file-owner-and-operation-boundary"
    ],
    "allowed_files": [
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorDocument.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSessionPorts.kt",
      "plans/261023-1429-native-editor-file-explorer/interface-freeze.md"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "All common facade signatures/data ownership/threading/event suppression and detach semantics are concrete and documented; native mapping qualified.",
      "EditorSessionPorts.kt freezes every tab/session/close/conflict/outcome/dirty-guard port that phases04/05 consume; no worker codes against fields phase03 is removing.",
      "03/04/05 have exclusive literal file sets and no need to edit another worker or frozen contract; API change stops/replans affected workers."
    ],
    "verification": [
      "Review interface-freeze.md against C1-C7 and actual direct callers before scheduling; no unsupported symbol names or unstated threading.",
      "Compile frozen common declarations with migrated repository callers using .\\native-app\\gradlew.bat -p native-app :shared:compileKotlinJvm; record failures honestly, no downstream start if contract unresolved."
    ]
  }
]
```

## Failure, rollback and security
No architecture guessing delegated to concurrent workers. Frozen signatures are a handoff boundary, not a shim layer. Backend .git mutation/write discrepancy is preserved/documented, not strengthened here. Cancellation cannot release quarantined reservations. If freeze changes, stop affected workers and re-author exact caller/ownership edges before restart.
- Preserve original target/buffers on failure; never use exception suppression, unconditional writes, blind retry, force_git bypass or remote inverse operations as rollback. Authentication/connection retirement revokes authority before UI transitions.
- Escalate missing writable path, unsupported native API, threshold change or severe safety defect to Main; keep gate blocked until explicit scoped revision. No automatic Git/dependency execution is authorized by this plan.

## Completion and next dependencies
After both phase01/02 gates settle, phases03/04/05 are the sole concurrent group. Their code may converge before integrated compilation; no worker runs competing whole-tree checks mid-flight. Main owns group integration and future checks.
- Exit evidence: exact changed paths, behavioral check commands/results and blockers. Complete only on task acceptance plus coherent integrated evidence; planned command text is not a pass.

## Unresolved questions
- No new product decision. Phase01 feasibility and phase08 runtime/distribution gates remain evidence requirements; unresolved gates block readiness/release.
