# Phase 05 — Android native document and shared editor presentation

## Context and status
- Priority P2. Status pending; phase01 feasibility gates block downstream scheduling. Owner: AndroidEditor worker.
- Authority: [overview](plan.md), [contracts C1-C7](contracts.md), [acceptance matrix](acceptance-matrix.md).
- Evidence: [coordinator](reports/coordinator-evidence.md), [files/watchers](reports/files-watchers-evidence.md), [editor/widget](reports/editor-widget-evidence.md), [approved design](../reports/brainstorm-261023-1351-native-editor-file-explorer.md).
- Source anchors and current gaps in those evidence reports are read-only; this phase describes future changes, not observed success. Root for every literal path: `G:/ws/sharing/dam-hopper/`.

## Insights
AndroidEditorSurface currently stores its own StringBuilder/snapshots and contains another EditorSession, and attachView does not mount a widget. Shared NativeTextEditorView is a Compose TextField. Both must cut over to the single document contract, not coexist as editing authorities.

## Requirements and architecture
Implement qualified exact-version Sora mappings only; mount CodeEditor through AndroidView with Android-only dependencies injected through common UI slot/factory. Line numbers, syntax/plain-text fallback for unknown grammar, selection, undo/redo, in-file find and keyboard/IME are native. No rich media/Markdown/blame/TS service activation or encrypted-readiness claim.
- NFR: preserve existing KMP/platform boundary, PascalCase Kotlin naming, bounded memory/queues and target isolation; no avoidable per-edit full-text allocation. Secrets/contents excluded from logs; no durable draft persistence.
- Contracts apply in full; this phase may implement only its allocated slice. Frozen common signatures are read-only after phase02 unless coordinator revises affected task graph/callers first.

## Exact ownership and conflict prevention
- Task lists below expand every writable path; paths in JSON are normalized project-relative literals (no globs/directories). All other source, server, parent reports and related plans are read-only.
- Creation occurs only at first listed owner; later listed tasks receive Modify ownership after their dependency chain completes. Listed Delete actions remove only code made obsolete by this cutover.
- Main is the sole integration owner. Workers do not widen ownership or run builds/tests/formatters mid-flight; Main coordinates planned verification once the coherent dependency group lands.
- Concurrent scheduling is permitted only for phases03/04/05 after phase02; within each phase follow explicit task edges. Overlapping sequential ownership transfers below are intentional, never simultaneous.

## Ordered task implementation and related files

### `implement-android-native-document` — Replace model prototype with real retained native document
- [ ] <!-- evcrate-task:implement-android-native-document --> Replace model prototype with real retained native document
- Dependencies: `freeze-document-and-watch-facades`.
- Exact writable files/actions:
  - Modify: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt`.
  - Create: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocument.kt`.
  - Modify: `native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurfaceTest.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/platform/editor/EditorDocumentQualification.kt`.
  - Create: `native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocumentTest.kt`.
- Ordered steps:
  1. Implement EditorDocument/Factory using phase01-proven Content/undo and verified syntax APIs; remove CandidateEditorAdapter metadata-only model, Android duplicate EditorSession, StringBuilder/snapshot stacks and obsolete surface types/callers.
  2. Implement main-thread delta events, suppression of programmatic replacement, revision/save-point tracking, bounded native undo, read-only/focus policy and explicit immutable save snapshot. No full-text updates during recomposition.
  3. Separate retained document from Activity-bound CodeEditor binding; attach/detach preserves selection/scroll/undo, releases native widget/listeners/IME references, on final close releases document/native resources.
  4. Replace prototype model/string/license-assertion tests with behavior-focused native document/widget tests; transfer existing qualification test into permanent regression coverage, delete any duplicated throwaway proof only after equivalent coverage exists.
- Acceptance:
  - Mounted real CodeEditor and one native document implement frozen contract with no second text/undo stack or stale Activity.
  - Detach/rebind keeps undo/text/selection/scroll; true close releases resources and rejects late events.
  - Native grammar modules match qualified pin; unknown language is honest plain text, not semantic diagnostics.
- Planned checks / observable evidence (not executed):
  - .\native-app\gradlew.bat -p native-app :androidApp:testDebugUnitTest --tests "dev.damhopper.nativeapp.platform.editor.AndroidEditorSurfaceTest"; only use tests meaningful without device and preserve failures.
  - .\native-app\gradlew.bat -p native-app :androidApp:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.damhopper.nativeapp.platform.editor.AndroidEditorDocumentTest; measure real delta/replacement/undo/IME/detach behavior.

### `bridge-shared-editor-presentation` — Route shared editor presentation to injected native surface
- [ ] <!-- evcrate-task:bridge-shared-editor-presentation --> Route shared editor presentation to injected native surface
- Dependencies: `implement-android-native-document`.
- Exact writable files/actions:
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/NativeTextEditorView.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorScreens.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTopBar.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/LargeFileView.kt`.
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/SaveConflictDialog.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt`.
  - Modify: `native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/WorkbenchJourneys.kt`.
- Ordered steps:
  1. Replace editing TextField and eager custom line gutter with injected common native-surface host; pass document handle and lightweight metadata, never content/onFullValueChange. Android implementation supplies mounted binding; platform imports stay Android-only.
  2. Route toolbar undo/redo/find/selection/dirty/close intents through the frozen phase02 `EditorSessionPorts.kt` (read-only here), never current EditorTab/EditorSession fields that phase03 removes concurrently. Show conflict Reload/Explicit overwrite/Cancel, unknown/unavailable states and save errors without losing text.
  3. Render range windows with consumed-offset navigation, bounded binary/media/invalid notices; focused mode hides preview/blame/unsupported encryption actions without deleting dormant modules.
  4. Migrate all shared public signature callers including dormant WorkbenchScreen and state-only WorkbenchJourneys to factory/owner/port-based metadata/close-guard APIs (including `LargeFileView.kt` range-window read model replacing `tab.content`). Do not mount WorkbenchScreen or claim its state-only instrumentation proves active UI. MainActivity injection lands phase07. Compilation is verified only after the merged 03/04/05 group.
  5. On panel visibility changes relinquish native focus/IME and block commands/input while hidden; new binding never replaces retained text on composition.
- Acceptance:
  - Editor toolbar and widget act on same authority; shared code has no Android imports or editable full-text Compose state.
  - Focused editor displays only approved features and complete empty/loading/error/disconnected/conflict/read-only notices.
  - Every changed common editor caller migrated without aliases/shims; dormant workbench remains unmounted.
- Planned checks / observable evidence (not executed):
  - After concurrent group merges, .\native-app\gradlew.bat -p native-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin; compilation is planned future evidence, not current result.
  - Final mounted UI cases verify native line numbers/syntax/plain text, find, selection, hidden-input rejection and read-only notice behavior; no static source/wiring assertions.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "implement-android-native-document",
    "title": "Replace model prototype with real retained native document",
    "blocked_by": [
      "freeze-document-and-watch-facades"
    ],
    "allowed_files": [
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt",
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocument.kt",
      "native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurfaceTest.kt",
      "native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/platform/editor/EditorDocumentQualification.kt",
      "native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocumentTest.kt"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "Mounted real CodeEditor and one native document implement frozen contract with no second text/undo stack or stale Activity.",
      "Detach/rebind keeps undo/text/selection/scroll; true close releases resources and rejects late events.",
      "Native grammar modules match qualified pin; unknown language is honest plain text, not semantic diagnostics."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :androidApp:testDebugUnitTest --tests \"dev.damhopper.nativeapp.platform.editor.AndroidEditorSurfaceTest\"; only use tests meaningful without device and preserve failures.",
      ".\\native-app\\gradlew.bat -p native-app :androidApp:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.damhopper.nativeapp.platform.editor.AndroidEditorDocumentTest; measure real delta/replacement/undo/IME/detach behavior."
    ]
  },
  {
    "id": "bridge-shared-editor-presentation",
    "title": "Route shared editor presentation to injected native surface",
    "blocked_by": [
      "implement-android-native-document"
    ],
    "allowed_files": [
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/NativeTextEditorView.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorScreens.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTopBar.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/LargeFileView.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/SaveConflictDialog.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt",
      "native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/WorkbenchJourneys.kt"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "Editor toolbar and widget act on same authority; shared code has no Android imports or editable full-text Compose state.",
      "Focused editor displays only approved features and complete empty/loading/error/disconnected/conflict/read-only notices.",
      "Every changed common editor caller migrated without aliases/shims; dormant workbench remains unmounted."
    ],
    "verification": [
      "After concurrent group merges, .\\native-app\\gradlew.bat -p native-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin; compilation is planned future evidence, not current result.",
      "Final mounted UI cases verify native line numbers/syntax/plain text, find, selection, hidden-input rejection and read-only notice behavior; no static source/wiring assertions."
    ]
  }
]
```

## Failure, rollback and security
Native undo/content feasibility must already be proven. Widget reattach is not allowed to reset document to a Compose snapshot. AAR packaging does not establish LGPL compliance; do not preserve old misleading dynamic-linkage comments/tests. Rollback is coordinated cutover, never a TextField production fallback.
- Preserve original target/buffers on failure; never use exception suppression, unconditional writes, blind retry, force_git bypass or remote inverse operations as rollback. Authentication/connection retirement revokes authority before UI transitions.
- Escalate missing writable path, unsupported native API, threshold change or severe safety defect to Main; keep gate blocked until explicit scoped revision. No automatic Git/dependency execution is authorized by this plan.

## Completion and next dependencies
Concurrent with03/04 after freeze. Phase06 waits for all three. Phase07 receives factory/surface host and transfers WorkbenchScreen ownership only after phase05 complete. Phase08 receives Android build/test files after all prior writers settle.
- Exit evidence: exact changed paths, behavioral check commands/results and blockers. Complete only on task acceptance plus coherent integrated evidence; planned command text is not a pass.

## Unresolved questions
- No new product decision. Phase01 feasibility and phase08 runtime/distribution gates remain evidence requirements; unresolved gates block readiness/release.
