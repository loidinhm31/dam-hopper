# Phase 03 — Shared documents bounded loading and safe saves

## Context and status
- Priority P2. Status: work cycle closed by user approval (2026-10-23; Cycle 4 review 8/10, zero Critical findings); full technical acceptance remains gated by W-P03-1..W-P03-4 and unresolved Phase 02 carryovers W1–W6. Owner: EditorCore worker.
- Authority: [overview](plan.md), [contracts C1-C7](contracts.md), [acceptance matrix](acceptance-matrix.md).
- Evidence: [coordinator](reports/coordinator-evidence.md), [files/watchers](reports/files-watchers-evidence.md), [editor/widget](reports/editor-widget-evidence.md), [approved design](../reports/brainstorm-261023-1351-native-editor-file-explorer.md).
- Historical source anchors in the evidence reports remain background; this phase's implementation and recorded verification are summarized in [Cycle 4 closure and downstream carryovers](#cycle-4-closure-and-downstream-carryovers). Work-cycle closure is not full technical acceptance. Root for every literal path: `G:/ws/sharing/dam-hopper/`.

## Insights
EditorSession currently duplicates text/undo; EditorTab content/saved/submitted strings mirror it. Existing submitted-save behavior correctly preserves newer edits but callback-by-key is unsafe. File ranges skip split UTF-8 bytes; binary preview can overread. Reuse metadata/race patterns, not competing authority.

## Requirements and architecture
Implement C1-C4 against frozen facade, with normal/degraded/range tiers and bounded retention. Implement (never edit) the frozen `EditorSessionPorts.kt` ports from phase02; phase04/05 consume only those ports. Common module remains platform-independent. Ingress load/reload and explicit save are the only full text transfers; in-file operations delegate to native document. Every success/error/diagnostic/listener completion fenced, including close/reopen and replaced socket.
- Concurrent-window compile note: removing EditorTab/EditorSession text fields breaks current phase05-owned readers (for example `LargeFileView.kt` reads `tab.content`) until phase05 lands its port-based migration. Workers never run whole-module checks mid-flight; every per-task command below runs only when Main verifies the merged 03/04/05 group. The deleted helpers' only callers (`EditorSession.kt`, `EditorSessionTest.kt`) are phase03-owned.
- NFR: preserve existing KMP/platform boundary, PascalCase Kotlin naming, bounded memory/queues and target isolation; no avoidable per-edit full-text allocation. Secrets/contents excluded from logs; no durable draft persistence.
- Contracts apply in full; this phase may implement only its allocated slice. Frozen common signatures are read-only after phase02 unless coordinator revises affected task graph/callers first.

## Exact ownership and conflict prevention
- Task lists below expand every writable path; paths in JSON are normalized project-relative literals (no globs/directories). All other source, server, parent reports and related plans are read-only.
- Creation occurs only at first listed owner; later listed tasks receive Modify ownership after their dependency chain completes. Listed Delete actions remove only code made obsolete by this cutover.
- Main is the sole integration owner. Workers do not widen ownership or run builds/tests/formatters mid-flight; Main coordinates planned verification once the coherent dependency group lands.
- Concurrent scheduling is permitted only for phases03/04/05 after phase02; within each phase follow explicit task edges. Overlapping sequential ownership transfers below are intentional, never simultaneous.

## Ordered task implementation and related files

### `implement-document-backed-sessions` — Move shared sessions to one injected document authority
- [x] <!-- evcrate-task:implement-document-backed-sessions --> Move shared sessions to one injected document authority
- Dependencies: `freeze-document-and-watch-facades`.
- Exact writable files/actions:
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorModels.kt`.
  - Delete (obsolete shared competing authority/helper; migrate callers/tests): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorUndoManager.kt`.
  - Delete (obsolete shared competing authority/helper; migrate callers/tests): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorFindReplaceHelper.kt`.
  - Delete (obsolete shared competing authority/helper; migrate callers/tests): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorPositionHelper.kt`.
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSessionTest.kt`.
  - Create: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/TestEditorDocument.kt`.
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/security/PrivacyControllerTest.kt`.
- Ordered steps:
  1. Replace session StringBuilder and snapshot undo with injected EditorDocument; keep metadata/revision/mtime/owner only. Remove mirrored text/baseline/submitted fields from editable EditorTab and use bounded range metadata for read-only content.
  2. Delegate undo/redo/find/selection/replace and dirty save-point handling to document; listener deltas update lightweight flows once. Delete obsolete EditorUndoManager and string-based find/position helpers when their only production caller is removed; migrate helper-only tests to behavior.
  3. Supply faithful test-only document boundary double and migrate PrivacyControllerTest plus session tests; never ship a common production string editor or keep constructor shims.
  4. Implement finite retained-document budget policy agreed in interface-freeze; retain dirty/unresolved documents, evict only clean inactive documents or refuse further open explicitly. Release snapshots and document resources deterministically.
- Acceptance:
  - Shared session owns no competing text or undo; tab metadata changes do not snapshot full document.
  - Undo to save-point restores clean state; later edits after save remain dirty; read-only/privacy/input gates apply to all document commands.
  - Retention pressure cannot silently destroy dirty/unresolved edits; no process-death persistence claim.
- Planned checks / observable evidence (not executed):
  - .\native-app\gradlew.bat -p native-app :shared:jvmTest --tests "dev.damhopper.nativeapp.features.editor.EditorSessionTest" --tests "dev.damhopper.nativeapp.core.security.PrivacyControllerTest"; prove command delegation, save-point dirty and memory-pressure refusal using behavioral boundaries.
  - Inspect allocation tracing in final device gate for native document copies; unit double does not prove widget retention.

### `implement-bounded-tiered-loading` — Implement strict tiered loads and range boundaries
- [x] <!-- evcrate-task:implement-bounded-tiered-loading --> Implement strict tiered loads and range boundaries
- Dependencies: `implement-document-backed-sessions`.
- Exact writable files/actions:
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorContentLoader.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/FileTierPolicy.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorResults.kt`.
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepositoryTest.kt`.
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/FileTierPolicyTest.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EncryptedSaveCoordinatorTest.kt`.
- Ordered steps:
  1. Use bounded FileRepository ingress with actual byte checks before document publication; stat/read growth restats/reclassifies without whole-file load. Binary/media precedence yields bounded noneditable notice.
  2. Implement strict UTF-8 editable decode and bounded range carry/consumed/received offsets, previous-window metadata and EOF invalid-sequence handling; never skip/synthesize boundary bytes or assemble full large content.
  3. Preserve exact thresholds and encryptedRequested fail-closed; model load/range errors with operation IDs and classification, not editable replacement text.
  4. Expose results only through frozen EditorSessionPorts read models; do not edit phase05 presentation files (they migrate themselves against the same ports). Write behavior tests at cap-1/cap/cap+1, growth, malformed Base64/text and split UTF-8 positions.
- Acceptance:
  - <1MiB normal, 1-<5MiB degraded, >=5MiB read-only64KiB ranges; actual received bytes control publication.
  - Invalid UTF-8/binary/media/unavailable paths cannot save or trigger whole large read; fallback retains bounds and exact owner.
  - Range concatenation has no lost/duplicate split codepoint and bounded memory; old range requests cannot publish.
- Planned checks / observable evidence (not executed):
  - .\native-app\gradlew.bat -p native-app :shared:jvmTest --tests "dev.damhopper.nativeapp.features.editor.EditorRepositoryTest" --tests "dev.damhopper.nativeapp.features.editor.FileTierPolicyTest" --tests "dev.damhopper.nativeapp.features.editor.EncryptedSaveCoordinatorTest"; include growth and invalid text fixtures.

### `implement-incarnation-safe-tabs-saves` — Fence tabs reloads diagnostics and submitted saves
- [x] <!-- evcrate-task:implement-incarnation-safe-tabs-saves --> Fence tabs reloads diagnostics and submitted saves
- Dependencies: `implement-bounded-tiered-loading`.
- Exact writable files/actions:
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabSaveCoordinator.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorDiagnosticsManager.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt`.
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsStateTest.kt`.
  - Create: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSaveRaceTest.kt`.
- Ordered steps:
  1. Allocate retained monotonic incarnations and per-operation watermarks; capture owner/socket/session/revision for open/reload/range/save/errors/diagnostics and listener removal. Existing open focuses tab; replacement tab never receives old callback.
  2. Integrate document save-point, one explicit submitted bytes snapshot, conditional observed-mtime writes and phase-aware outcomes. Use arbiter exact-path reservation already frozen; Unknown holds quarantine and buffer for phase06 reconciliation.
  3. Implement conflict Reload/Explicit overwrite/Cancel, fresh-stat conditional overwrite and discard-revision guard; edits during save remain dirty and begin/chunk precommit failure is not postcommit unknown.
  4. Implement safe close intent API (Save/Discard/Cancel) instead of destructive close callbacks; snapshot/revision preconditions consumed later by shared dialogs and workspace guard. Clean external changes reload only if still clean/current; dirty changes stale, remote deletion unavailable.
  5. Disable active per-edit full-text semantic snapshots; retain any dormant diagnostic completion fencing/cancellation without claiming TS/LSP parity. Changed session/save signatures stay behind frozen EditorSessionPorts; no edits to phase05-owned UI callers.
- Acceptance:
  - Every async success/error/state cleanup rejects stale owner/socket/tab incarnation/operation/revision.
  - Close/reopen during load/save/reload/range, edit-during-save, socket replacement and failed close-save preserve current buffers.
  - Normal conflict never overwrites; explicit overwrite can conflict again; Unknown never auto-retries or clears local edits.
- Planned checks / observable evidence (not executed):
  - .\native-app\gradlew.bat -p native-app :shared:jvmTest --tests "dev.damhopper.nativeapp.features.editor.EditorTabsStateTest" --tests "dev.damhopper.nativeapp.features.editor.EditorSaveRaceTest"; deterministically schedule close/reopen, later-edit and old-socket callbacks.
  - After phase03/04/05 merge, Main runs integrated common compile/tests once; no parallel worker whole-tree suites.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "implement-document-backed-sessions",
    "title": "Move shared sessions to one injected document authority",
    "blocked_by": [
      "freeze-document-and-watch-facades"
    ],
    "allowed_files": [
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorModels.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorUndoManager.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorFindReplaceHelper.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorPositionHelper.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSessionTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/TestEditorDocument.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/security/PrivacyControllerTest.kt"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "Shared session owns no competing text or undo; tab metadata changes do not snapshot full document.",
      "Undo to save-point restores clean state; later edits after save remain dirty; read-only/privacy/input gates apply to all document commands.",
      "Retention pressure cannot silently destroy dirty/unresolved edits; no process-death persistence claim."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.editor.EditorSessionTest\" --tests \"dev.damhopper.nativeapp.core.security.PrivacyControllerTest\"; prove command delegation, save-point dirty and memory-pressure refusal using behavioral boundaries.",
      "Inspect allocation tracing in final device gate for native document copies; unit double does not prove widget retention."
    ]
  },
  {
    "id": "implement-bounded-tiered-loading",
    "title": "Implement strict tiered loads and range boundaries",
    "blocked_by": [
      "implement-document-backed-sessions"
    ],
    "allowed_files": [
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorContentLoader.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/FileTierPolicy.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorResults.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepositoryTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/FileTierPolicyTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EncryptedSaveCoordinatorTest.kt"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "<1MiB normal, 1-<5MiB degraded, >=5MiB read-only64KiB ranges; actual received bytes control publication.",
      "Invalid UTF-8/binary/media/unavailable paths cannot save or trigger whole large read; fallback retains bounds and exact owner.",
      "Range concatenation has no lost/duplicate split codepoint and bounded memory; old range requests cannot publish."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.editor.EditorRepositoryTest\" --tests \"dev.damhopper.nativeapp.features.editor.FileTierPolicyTest\" --tests \"dev.damhopper.nativeapp.features.editor.EncryptedSaveCoordinatorTest\"; include growth and invalid text fixtures."
    ]
  },
  {
    "id": "implement-incarnation-safe-tabs-saves",
    "title": "Fence tabs reloads diagnostics and submitted saves",
    "blocked_by": [
      "implement-bounded-tiered-loading"
    ],
    "allowed_files": [
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabSaveCoordinator.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorDiagnosticsManager.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsStateTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSaveRaceTest.kt"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "Every async success/error/state cleanup rejects stale owner/socket/tab incarnation/operation/revision.",
      "Close/reopen during load/save/reload/range, edit-during-save, socket replacement and failed close-save preserve current buffers.",
      "Normal conflict never overwrites; explicit overwrite can conflict again; Unknown never auto-retries or clears local edits."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.editor.EditorTabsStateTest\" --tests \"dev.damhopper.nativeapp.features.editor.EditorSaveRaceTest\"; deterministically schedule close/reopen, later-edit and old-socket callbacks.",
      "After phase03/04/05 merge, Main runs integrated common compile/tests once; no parallel worker whole-tree suites."
    ]
  }
]
```

## Cycle 4 closure and downstream carryovers

- **Disposition:** Work cycle closed by user approval on 2026-10-23 after Cycle 4 review scored 8/10 with zero Critical findings. Cycle 1 critical findings C1–C3 and later critical findings C01–C05 are closed and regression-tested. These are review-finding labels, not a claim that all contracts C1–C7 have full technical acceptance.
- **Recorded verification:** `:shared:jvmTest` passed 458/458 tests, including 45 tests across the seven Phase 03 test classes; `:shared:compileDebugKotlinAndroid` and `:androidApp:compileDebugKotlin` succeeded. These are recorded Cycle 4 results, not checks run during this documentation update; they do not establish native runtime or release qualification.
- **W-P03-1 — retention:** 64 MiB / 8-document / 2-degraded admission and eviction remain gated to the Phase 05/06 retention gate. The DEGRADED 50-undo cap is wired.
- **W-P03-2 — document events/UI:** remove remaining EditorTab full-text mirroring and per-edit `getText()` snapshots; attach a DocumentEvent flow collector to publish `openTabs` metadata. Gated to Phase 05 UI/caller migration.
- **W-P03-3 — unknown save:** preserve the arbiter reservation token, submitted snapshot, and original stage/opId quarantine through save reconciliation. Gated to Phase 06 mutation/save integration.
- **W-P03-4 — completion fencing:** add open/reload/range error watermarks and disposed-session save cleanup fencing. Gated to Phase 06 save/mutation integration.
- **Phase 02 carryovers:** W1–W6 remain open until their assigned Phase 04/05/06 gates settle; Phase 03 closure does not resolve them. Full technical acceptance remains gated on downstream correction and evidence for all carryovers.

## Failure, rollback and security

A test document double proves coordination only, never native IME/undo memory. Do not repair stale callbacks by broad exception suppression. Rollback preserves detached buffers and unknown reservations; no automatic draft retarget/retry. Per-edit diagnostics copying is incompatible with selected contract.
- Preserve original target/buffers on failure; never use exception suppression, unconditional writes, blind retry, force_git bypass or remote inverse operations as rollback. Authentication/connection retirement revokes authority before UI transitions.
- Escalate missing writable path, unsupported native API, threshold change or severe safety defect to Main; keep gate blocked until explicit scoped revision. No automatic Git/dependency execution is authorized by this plan.

## Completion and next dependencies
Work cycle closed by user approval on 2026-10-23; full technical acceptance remains gated by the carryovers recorded above. Phase 05 owns remaining UI/caller migration and document-event publication; Phase 05/06 jointly settle retention; Phase 06 owns unknown-save and completion-fencing integration. Phases 04–08 remain pending. Recorded focused JVM and Android compile results are not integrated runtime/device or release qualification.
- Exit evidence: source changes and recorded verification are listed above. Planned command text is not a pass; downstream carryover acceptance and coherent integration evidence remain required.

## Unresolved questions
- No new product decision. W-P03-1..W-P03-4 and Phase 02 W1–W6 remain open downstream gates; acceptance/readiness requires their assigned Phase 04/05/06 corrections and evidence. Phase 01 feasibility is qualified on x86_64/API 36; Phase 08 runtime/device/distribution gates, including API 29, arm64-v8a, and LGPL-2.1 compliance, remain open.
