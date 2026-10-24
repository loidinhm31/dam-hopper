# Phase 01 — Pinned widget and retained document feasibility

## Context and status
- Priority P2. Status complete (2026-10-23; user-approved close-out; x86_64/API 36, 2/2 instrumentation tests); Phase 02 may proceed. API 29 (`android-29`), `arm64-v8a`, and LGPL-2.1 distribution compliance remain Phase 08 release gates. Owner: Qualification owner (Main-designated, sequential).
- Authority: [overview](plan.md), [contracts C1-C7](contracts.md), [acceptance matrix](acceptance-matrix.md).
- Evidence: [coordinator](reports/coordinator-evidence.md), [files/watchers](reports/files-watchers-evidence.md), [editor/widget](reports/editor-widget-evidence.md), [approved design](../reports/brainstorm-261023-1351-native-editor-file-explorer.md).
- Qualification evidence: [dependency qualification](dependency-qualification.md) records the resolved artifact graph and successful debug assembly; [document qualification](document-qualification.md) records the native document/widget behavior and 2/2 API 36 x86_64 instrumentation result. API 29/arm64-v8a device execution and LGPL-2.1 distribution remain Phase 08 gates. Root for every literal path: `G:/ws/sharing/dam-hopper/`.
- Close-out: User approved Phase 01 with noted issues after Cycle 3; Main reports the Cycle 3 fixes were verified in the final connected run recorded in [document qualification](document-qualification.md). The reviewer disposition remains “changes requested,” not a reviewer pass.


## Insights
Sora Editor `0.23.4` and its Java language artifact resolve on the pinned graph; executable qualification proves native `Content`/undo retention and widget reattachment across Activity recreation on x86_64/API 36 (2/2 tests). API 29 and arm64-v8a device execution plus LGPL distribution remain Phase 08 gates; retention/memory budgets remain provisional pending integrated device profiling.

## Requirements and architecture
Phase 01 feasibility gate is satisfied; Phase 02 may proceed. Preserve Java17, minSdk29, arm64-v8a/x86_64 and exact prerelease 0.23.4. The proof qualifies a minimum real syntax grammar plus honest plain-text unsupported mode, native undo/save-point retention without Activity references and required IME/document operations. API 29/arm64-v8a runtime and LGPL distribution are Phase 08 gates. No guessed module coordinates/signatures or per-edit full-text allocation.
- NFR: preserve existing KMP/platform boundary, PascalCase Kotlin naming, bounded memory/queues and target isolation; no avoidable per-edit full-text allocation. Secrets/contents excluded from logs; no durable draft persistence.
- Contracts apply in full; this phase may implement only its allocated slice. Frozen common signatures are read-only after phase02 unless coordinator revises affected task graph/callers first.

## Exact ownership and conflict prevention
- Task lists below expand every writable path; paths in JSON are normalized project-relative literals (no globs/directories). All other source, server, parent reports and related plans are read-only.
- Creation occurs only at first listed owner; later listed tasks receive Modify ownership after their dependency chain completes. Listed Delete actions remove only code made obsolete by this cutover.
- Main is the sole integration owner. Workers do not widen ownership or run builds/tests/formatters mid-flight; Main coordinates planned verification once the coherent dependency group lands.
- Concurrent scheduling is permitted only for phases03/04/05 after phase02; within each phase follow explicit task edges. Overlapping sequential ownership transfers below are intentional, never simultaneous.

## Ordered task implementation and related files

### `qualify-pinned-editor-artifacts` — Resolve exact pinned editor and language artifacts
- [x] <!-- evcrate-task:qualify-pinned-editor-artifacts --> Resolve exact pinned editor and language artifacts (completed 2026-10-23; exact graph resolved and debug assembly successful)
- Dependencies: none; entry feasibility gate.
- Exact writable files/actions:
  - Modify: `native-app/gradle/libs.versions.toml`.
  - Modify: `native-app/androidApp/build.gradle.kts`.
  - Create: `plans/261023-1429-native-editor-file-explorer/dependency-qualification.md`.
- Ordered steps:
  1. Inspect version-tag source/POM/AAR APIs during authorized implementation; record exact symbols, language-module coordinates/assets/licenses, Java/minSdk/desugaring requirements and transitive dependencies in dependency-qualification.md.
  2. Declare only verified io.github.Rosemoe.sora-editor:editor:0.23.4 and required verified grammar artifacts in existing catalog/app build; no upgrade, phantom language artifact, runtime service or ABI narrowing. Also declare the minimal instrumentation host needed by the next task: existing catalog `androidx.test:core` (ActivityScenario) as androidTestImplementation, plus Compose UI test (`ui-test-junit4` androidTest, `ui-test-manifest` debugImplementation for its ComponentActivity host) at coordinates verified against the pinned Compose 1.7.3 toolchain. Record each justification; nothing else.
  3. Resolve the actual selected graph and assemble it; record commands/results, prerelease acceptance risk and blockers separately from device evidence. If any required dependency cannot qualify, block subsequent tasks and request explicit design revision.
- Acceptance:
  - Exact editor pin/casing and language source-to-artifact mapping documented with resolved graph; no invented version APIs.
  - Project Android29/Java17/ABI baseline unchanged; unresolved artifact/API compatibility blocks downstream.
  - Minimal justified androidTest/Compose test host resolves with the pinned toolchain; no MainActivity mount or extra manifest needed for isolated widget recreation.
- Qualification evidence (2026-10-23):
  - `.\native-app\gradlew.bat -p native-app :androidApp:dependencyInsight --configuration debugRuntimeClasspath --dependency editor` — successful; exact pinned editor and language artifacts resolve. Full graph and commands: [dependency qualification](dependency-qualification.md).
  - `.\native-app\gradlew.bat -p native-app :androidApp:assembleDebug` — `BUILD SUCCESSFUL`; see [dependency qualification](dependency-qualification.md).

### `qualify-retained-native-document` — Prove native Content undo and widget reattachment
- [x] <!-- evcrate-task:qualify-retained-native-document --> Prove native Content undo and widget reattachment (completed 2026-10-23; x86_64/API 36, 2/2 instrumentation tests passed)
- Dependencies: `qualify-pinned-editor-artifacts`.
- Exact writable files/actions:
  - Create: `native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/platform/editor/EditorDocumentQualification.kt`.
  - Create: `plans/261023-1429-native-editor-file-explorer/document-qualification.md`.
- Ordered steps:
  1. Using the resolved exact artifact, build a mounted test-only native CodeEditor scenario using real Content/undo and approved grammar; record exact API mapping for C2, including save-point dirty tracking and source suppression.
  2. Detach/release widget and listeners, recreate the host Activity via ActivityScenario (ComponentActivity host from ui-test-manifest; no MainActivity mount, no new manifest), attach the retained native document to the new widget. Prove committed text, undo/redo history, cursor/selection and scroll survive without a retained Activity or second buffer/undo stack. Active IME composition is deterministically finished or cancelled before detach (framework tears down the InputConnection); prove no duplicated or lost text across that boundary. Uncommitted composition surviving recreation is NOT required.
  3. Measure document/undo/snapshot memory on near-1MiB and near-5MiB fixtures; record feasible finite retention/undo budget and native release behavior. Establish whether chunked snapshot/hash/range primitives meet no per-edit full-copy contract.
  4. Record qualification evidence and supported API signatures in document-qualification.md. Any inability to retain required document authority or native language capability blocks phase02; no TextField fallback, silent tier change or presumed success.
- Acceptance:
  - Executable evidence shows one native document/undo authority can reattach across Activity/widget lifecycle without stale listeners/Activity ownership.
  - Required commands, incremental deltas, explicit replacement/reset, save snapshot, read-only enforcement and native syntax/plain-text mode have version-specific feasible mappings; unresolved items explicitly block.
- Qualification evidence (2026-10-23):
  - `.\native-app\gradlew.bat -p native-app :androidApp:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.damhopper.nativeapp.platform.editor.EditorDocumentQualification` — `BUILD SUCCESSFUL`, 2/2 passed on x86_64/API 36; full outcomes: [document qualification](document-qualification.md).
- API 29 (`android-29`) x86_64 and `arm64-v8a` device execution, plus LGPL-2.1 distribution compliance, are user-approved Phase 08 gates and do not block this Phase 01 feasibility close-out. This technique qualification is not the final active-root journey; retention/memory budgets remain provisional pending integrated-device profiling.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "qualify-pinned-editor-artifacts",
    "title": "Resolve exact pinned editor and language artifacts",
    "blocked_by": [],
    "allowed_files": [
      "native-app/gradle/libs.versions.toml",
      "native-app/androidApp/build.gradle.kts",
      "plans/261023-1429-native-editor-file-explorer/dependency-qualification.md"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "Exact editor pin/casing and language source-to-artifact mapping documented with resolved graph; no invented version APIs.",
      "Project Android29/Java17/ABI baseline unchanged; unresolved artifact/API compatibility blocks downstream.",
      "Minimal justified androidTest/Compose test host resolves with the pinned toolchain; no MainActivity mount or extra manifest needed for isolated widget recreation."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :androidApp:dependencyInsight --configuration debugRuntimeClasspath --dependency editor",
      ".\\native-app\\gradlew.bat -p native-app :androidApp:assembleDebug; record resolved language graph and any compatibility failures, not merely POM existence."
    ]
  },
  {
    "id": "qualify-retained-native-document",
    "title": "Prove native Content undo and widget reattachment",
    "blocked_by": [
      "qualify-pinned-editor-artifacts"
    ],
    "allowed_files": [
      "native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/platform/editor/EditorDocumentQualification.kt",
      "plans/261023-1429-native-editor-file-explorer/document-qualification.md"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "Executable evidence shows one native document/undo authority can reattach across Activity/widget lifecycle without stale listeners/Activity ownership.",
      "Required commands, incremental deltas, explicit replacement/reset, save snapshot, read-only enforcement and native syntax/plain-text mode have version-specific feasible mappings; unresolved items explicitly block."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :androidApp:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.damhopper.nativeapp.platform.editor.EditorDocumentQualification; execute on the available x86_64 API 36 target and report the exact result; API 29 and arm64-v8a device execution remain Phase 08 gates.",
      "Record mounted IME/selection/undo and memory evidence; this technique qualification is not the final active-root journey."
    ]
  }
]
```

## Failure, rollback and security
Failure stops design, not acceptance reduction. Do not infer dynamic relinking from AAR packaging. New editor dependencies are normal `implementation` dependencies used by phase05/07; the licensing gate blocks **distribution release**, not the build variant (no debug-only dependency scheme). A failed proof leaves existing app terminal behavior unchanged; remove only obsolete proof scaffolding after equivalent permanent regression coverage exists.
- Preserve original target/buffers on failure; never use exception suppression, unconditional writes, blind retry, force_git bypass or remote inverse operations as rollback. Authentication/connection retirement revokes authority before UI transitions.
- Escalate missing writable path, unsupported native API, threshold change or severe safety defect to Main; keep gate blocked until explicit scoped revision. No automatic Git/dependency execution is authorized by this plan.

## Completion and next dependencies
Phase 02 may begin: both tasks completed 2026-10-23 with the exact artifact/dependency and API 36 x86_64 native-document qualification evidence linked above. API 29/arm64-v8a device execution and LGPL-2.1 distribution remain Phase 08 gates; no downstream runtime or release qualification is implied.
- Exit evidence: qualification records contain exact paths and executed outcomes; Phase 01 completion is limited to its feasibility scope and does not satisfy Phase 08 device/distribution gates.

## Unresolved questions
- No remaining Phase 01 feasibility blocker for Phase 02. Phase 08 still requires API 29 (`android-29`) x86_64 and arm64-v8a device execution plus LGPL-2.1 distribution compliance; integrated app/server qualification remains outstanding.
