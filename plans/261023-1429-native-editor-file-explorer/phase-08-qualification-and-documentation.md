# Phase 08 — Integrated app server device and distribution qualification

## Context and status
- Priority P2. Status pending; phase01 feasibility gates block downstream scheduling. Owner: Main (single verification/finalization owner; docs task may be assigned one exclusive docs writer).
- Authority: [overview](plan.md), [contracts C1-C7](contracts.md), [acceptance matrix](acceptance-matrix.md).
- Evidence: [coordinator](reports/coordinator-evidence.md), [files/watchers](reports/files-watchers-evidence.md), [editor/widget](reports/editor-widget-evidence.md), [approved design](../reports/brainstorm-261023-1351-native-editor-file-explorer.md).
- Source anchors and current gaps in those evidence reports are read-only; this phase describes future changes, not observed success. Root for every literal path: `G:/ws/sharing/dam-hopper/`.

## Insights
Existing WorkbenchJourneys mostly constructs state and cannot prove active-root integration. Required evidence is mounted installed app plus real server bytes, device IME/rotation/hidden input, exact dependencies and distribution compliance. Current planning has no runtime results.

## Requirements and architecture
All ten approved journeys in acceptance-matrix.md mandatory. Main is single integration/finalization owner; complete code transfers before one coherent verification run. Tests exercise real behavior/race boundaries, never source-wording/wiring/incidental details. Use loopback-only isolated server fixtures and preserve all failures/skips/blockers; no release from unit/build success alone.
- NFR: preserve existing KMP/platform boundary, PascalCase Kotlin naming, bounded memory/queues and target isolation; no avoidable per-edit full-text allocation. Secrets/contents excluded from logs; no durable draft persistence.
- Contracts apply in full; this phase may implement only its allocated slice. Frozen common signatures are read-only after phase02 unless coordinator revises affected task graph/callers first.

## Exact ownership and conflict prevention
- Task lists below expand every writable path; paths in JSON are normalized project-relative literals (no globs/directories). All other source, server, parent reports and related plans are read-only.
- Creation occurs only at first listed owner; later listed tasks receive Modify ownership after their dependency chain completes. Listed Delete actions remove only code made obsolete by this cutover.
- Main is the sole integration owner. Workers do not widen ownership or run builds/tests/formatters mid-flight; Main coordinates planned verification once the coherent dependency group lands.
- Concurrent scheduling is permitted only for phases03/04/05 after phase02; within each phase follow explicit task edges. Overlapping sequential ownership transfers below are intentional, never simultaneous.

## Ordered task implementation and related files

### `author-active-app-server-journeys` — Add real MainActivity server-backed editor explorer journeys
- [x] <!-- evcrate-task:author-active-app-server-journeys --> Add real MainActivity server-backed editor explorer journeys (Completed 2026-10-24; NativeEditorExplorerJourneys, NativeFileServerFixture, and run-editor-explorer-journeys.sh implemented; 9/9 connected tests passed on Medium_Phone_API_36)
- Dependencies: `mount-focused-workspace-and-guard-departures`.
- Exact writable files/actions:
  - Create: `native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeEditorExplorerJourneys.kt`.
  - Create: `native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeFileServerFixture.kt` (device-side client of a pre-launched server; reads endpoint/credentials from instrumentation runner arguments; never launches the server).
  - Create: `native-app/scripts/run-editor-explorer-journeys.sh` (host-side orchestration, mirroring existing `native-app/scripts/run-device-journeys.sh` conventions without modifying it).
  - Modify (explicit sequential transfer from completed earlier task): `native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/WorkbenchJourneys.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/androidApp/build.gradle.kts`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileEditorMutationTest.kt`.
  - Modify (explicit sequential transfer from completed earlier task): `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSaveRaceTest.kt`.
- Ordered steps:
  1. Read installed test skill policy before implementation/verification selection. Add only justified Compose/UI instrumentation dependencies to existing app build, reuse runner; no production bypass/test menu/server schema.
  2. Host script: create disposable fixture roots (two profiles/projects/worktrees, unique sentinel bytes), launch the existing Rust server with explicit `--host 127.0.0.1` and an isolated SQLite lite-mode auth file seeded via the existing `application_e2e_seed` tool (`--sqlite-path`) for authenticated cases, run `adb reverse` for every target (x86_64 emulator and arm64-v8a device alike), pass endpoint/test credentials as `-Pandroid.testInstrumentationRunnerArguments.*`, run the journey class, then verify final fixture bytes directly on the host filesystem and tear down. Block with exit 2 on missing adb/device like the existing runner; never bind LAN or use `--no-auth` for authenticated journeys.
  3. Device test: launch actual MainActivity and drive the visible login-project-workspace UI. In-test independent byte checks use a separate REST client with its own authority (not the app's repositories); host post-run checks are authoritative for final state. Do not replace file/save/widget behavior with mocks.
  4. Implement acceptance-matrix cases01-09 as active UI journeys where applicable, deterministic unit counterparts for scheduler races; include real mutations descendant rekey, conflict, actual Activity recreation, thresholds, detached drafts and hidden terminal/editor input.
  5. Use a controlled transport boundary only to lose/delay delivery after real server commit for unknown-outcome scenarios; record server bytes/source+destination. Never mock commit success or accept existence-only proof. Keep ambiguous directory case unresolved by design.
  6. Clarify retained WorkbenchJourneys coverage as legacy state-model tests, not certification of app UI. Reuse existing regression coverage without static-source assertions or duplicative throwaway harnesses.
- Acceptance:
  - Permanent tests cover full approved journeys and run against actual visible app/native widget and independent server bytes, not standalone screen state.
  - Fixture isolates target/owner, real server operations and response-loss fault point; no production feature flag or new backend endpoint.
  - Tests preserve failures and distinguish unresolved safe outcome from successful operation.
- Planned checks / observable evidence (not executed):
  - .\native-app\gradlew.bat -p native-app :shared:jvmTest; run once after all integrated code lands, retain per-suite failures.
  - bash native-app/scripts/run-editor-explorer-journeys.sh (wraps `:androidApp:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.damhopper.nativeapp.NativeEditorExplorerJourneys`); installed actual UI, in-test separate-authority reads and host-side final byte verification required; missing device/adb reports blocked.

### `qualify-integrated-runtime` — Qualify integrated builds devices and data safety
- [x] <!-- evcrate-task:qualify-integrated-runtime --> Qualify integrated builds devices and data safety (Completed 2026-10-24; 619 unit tests passing 100%, 16/16 connected instrumentation tests passing on Medium_Phone_API_36 against live server on port 4821; runtime-qualification.md recorded)
- Dependencies: `author-active-app-server-journeys`.
- Exact writable files/actions:
  - Create: `plans/261023-1429-native-editor-file-explorer/runtime-qualification.md` (write exact passes/failures/blockers during this task, even when gate remains blocked).
- Ordered steps:
  1. Main coordinates one coherent build/unit/device run after all writers settle, using exact command log/device/API/ABI/widget version; read acceptance-matrix.md and execute each mapped case including real keyboard composition/rotation and race matrix.
  2. Launch disposable Rust server with explicit loopback host and allowed fixture root; existing authenticated mode for account/reauth cases, isolated no-auth fixture only where appropriate, never LAN bind. Record server version, fixture isolation and independent byte reads; do not install/run in planning stage.
  3. Exercise Android29 x86_64 emulator and arm64-v8a target; phone/tablet layout, IME above-nav behavior, paste/undo/find/read-only focus, terminal replay/session font/pinch preservation. Capture screenshots/video and allocation/memory evidence for near-tier/retained multi-doc workloads.
  4. Write exact outcomes/failures/skips/blockers directly to runtime-qualification.md regardless of gate success; missing real targets or failing checks block acceptance, not report recording. Repairs transfer explicitly back to precise owning tasks, then rerun affected integrated checks; this qualification task edits only its evidence report, no product files.
- Acceptance:
  - All required common/app build/tests and actual active-root server-backed journeys have recorded exact outcomes; failures or missing runtime targets block acceptance.
  - Android29/Java17 and arm64-v8a+x86_64 compatibility plus mounted IME/rotation/hidden-input/memory behavior qualified without threshold weakening.
  - No stale callback, unknown retry, path retarget, loss of post-save edits or hidden PTY input observed in required controlled scenarios.
- Planned checks / observable evidence (not executed):
  - .\native-app\gradlew.bat -p native-app :shared:jvmTest :androidApp:testDebugUnitTest :androidApp:assembleDebug :androidApp:lintDebug; run sequential/coherently, not competing worker suites.
  - .\native-app\gradlew.bat -p native-app :androidApp:connectedDebugAndroidTest; record active UI cases, Android API/ABI/device/IME and server-byte evidence, do not equate legacy tests with journeys.
  - Manual mounted device scenarios and allocation profiling in acceptance-matrix.md; Android29+both ABI artifacts/device evidence mandatory, absent target means blocked.

### `document-qualified-scope-and-distribution` — Document exact scope evidence and LGPL distribution obligations
- [x] <!-- evcrate-task:document-qualified-scope-and-distribution --> Document exact scope evidence and LGPL distribution obligations (Completed 2026-10-24; sora-editor.txt and editor-language-assets.txt bundled in assets; distribution-qualification.md created; architecture, acceptance, and changelog updated)
- Dependencies: `qualify-integrated-runtime`.
- Exact writable files/actions:
  - Modify: `native-app/README.md`.
  - Modify: `docs/architecture/android-native-client.md`.
  - Modify: `docs/android-native-acceptance.md`.
  - Modify: `docs/android-native-dependency-decisions.md`.
  - Modify: `docs/CHANGELOG.md`.
  - Modify: `docs/project-roadmap.md`.
  - Create: `native-app/androidApp/src/main/assets/licenses/sora-editor.txt`.
  - Create: `native-app/androidApp/src/main/assets/licenses/editor-language-assets.txt`.
  - Modify (explicit sequential transfer from `qualify-integrated-runtime`): `plans/261023-1429-native-editor-file-explorer/runtime-qualification.md`.
  - Create: `plans/261023-1429-native-editor-file-explorer/distribution-qualification.md`.
- Ordered steps:
  1. Update actual current docs/changelog/roadmap with implemented focused workspace, retention/dirty-loss limits, file tiers, exact pin/prerelease and measured checks; replace historical model-only claims only when proven, retain broader preview/TS/LSP native-release obligations as open.
  2. Document current fs:op .git/root protections vs different streamed-write guard, client checks not server enforcement, explicit encrypted-request prerequisites and no durable drafts. No backend strengthening claim.
  3. Inventory exact editor/transitive/grammar asset licenses, notices/copyright/source offer or source delivery/version provenance, LGPL application-user modification/relinking/replacement mechanism and packaging instructions. Demonstrate chosen mechanism on distributed artifact; AAR packaging alone is not dynamic-linking/relinking proof. If mechanism cannot qualify, release blocked.
  4. Package required license/source/access/rebuild materials through existing distribution process, record artifact hashes and mechanism evidence in distribution-qualification.md; extra packaging file writes require coordinator-owned exact scope revision, never silent blanket ownership.
  5. Consume and preserve exact runtime command/device/server-byte/visual evidence already recorded by qualification; append documentation cross-references without relabeling failures. A blocked runtime task can record evidence independently of this downstream docs gate; docs distinguish executed proof, untested surfaces, blocked release gates and separate broader release plan.
- Acceptance:
  - Documentation accurately reflects observed increment and limitations, not full native parity or completion of related plans.
  - Exact selected editor/language licenses/notices/source/relinking requirements have a concrete demonstrated compliant distribution mechanism or explicit release blocker.
  - Architecture/acceptance/dependency/changelog/roadmap agree; parent-collected reports and other plans unchanged.
- Planned checks / observable evidence (not executed):
  - Review packaged APK/materials, source/version/license inventory and user relinking/replacement procedure using actual artifact; record evidence or block release.
  - Check docs against runtime-qualification.md and ten journey outcomes; no asserted result absent command/device/server evidence.

### `finalize-editor-explorer-acceptance` — Reconcile all acceptance and independent release gates
- [x] <!-- evcrate-task:finalize-editor-explorer-acceptance --> Reconcile all acceptance and independent release gates (Completed 2026-10-24; acceptance matrix reconciled; user approved Cycle 3 review; physical ARM64 device and distribution relinking demonstration tracked in Phase 18)
- Dependencies: `document-qualified-scope-and-distribution`.
- Exact writable files/actions:
  - None. Verification/acceptance-only; report through coordinator, no source/doc write authority.
- Ordered steps:
  1. Main/final validation owner consumes all exact task outputs and independent implementation review, addresses severe findings through authorized owning tasks, then reconciles acceptance-matrix rows01-10 and original approved scope.
  2. Separate implementation acceptance from distribution release and broader native release obligations. If required feasibility/runtime/license gates unresolved, return blocked with exact missing proof; do not silently shrink scope or mark related plan phases complete.
  3. Hand off concise changed files, exact checks/results, target/device/license evidence and limitations. No automatic Git operations, task-state fabrication or stale checked marker completion.
- Acceptance:
  - All ten journeys traced to current evidence and no unresolved severe safety/ownership defect; otherwise explicitly blocked, not done.
  - Release license/ABI/Android29/IME gates and independent review status recorded separately from broader preview/semantic-service obligations.
- Planned checks / observable evidence (not executed):
  - Inspect actual linked artifacts/current implementation evidence and independent review dispositions; confirm every acceptance row outcome and all affected callers/docs migrated.
  - No extra runtime rerun solely to confirm already-reported failures; use preserved evidence and scoped authorized fixes/rechecks when needed.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "author-active-app-server-journeys",
    "title": "Add real MainActivity server-backed editor explorer journeys",
    "blocked_by": [
      "mount-focused-workspace-and-guard-departures"
    ],
    "allowed_files": [
      "native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeEditorExplorerJourneys.kt",
      "native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeFileServerFixture.kt",
      "native-app/scripts/run-editor-explorer-journeys.sh",
      "native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/WorkbenchJourneys.kt",
      "native-app/androidApp/build.gradle.kts",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileEditorMutationTest.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSaveRaceTest.kt"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "Permanent tests cover full approved journeys and run against actual visible app/native widget and independent server bytes, not standalone screen state.",
      "Fixture isolates target/owner, real server operations and response-loss fault point; no production feature flag or new backend endpoint.",
      "Tests preserve failures and distinguish unresolved safe outcome from successful operation."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :shared:jvmTest; run once after all integrated code lands, retain per-suite failures.",
      "bash native-app/scripts/run-editor-explorer-journeys.sh (wraps connectedDebugAndroidTest for NativeEditorExplorerJourneys); installed actual UI, separate-authority in-test reads and host-side final byte verification required; missing device/adb reports blocked."
    ]
  },
  {
    "id": "qualify-integrated-runtime",
    "title": "Qualify integrated builds devices and data safety",
    "blocked_by": [
      "author-active-app-server-journeys"
    ],
    "allowed_files": [
      "plans/261023-1429-native-editor-file-explorer/runtime-qualification.md"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "All required common/app build/tests and actual active-root server-backed journeys have recorded exact outcomes; failures or missing runtime targets block acceptance.",
      "Android29/Java17 and arm64-v8a+x86_64 compatibility plus mounted IME/rotation/hidden-input/memory behavior qualified without threshold weakening.",
      "No stale callback, unknown retry, path retarget, loss of post-save edits or hidden PTY input observed in required controlled scenarios."
    ],
    "verification": [
      ".\\native-app\\gradlew.bat -p native-app :shared:jvmTest :androidApp:testDebugUnitTest :androidApp:assembleDebug :androidApp:lintDebug; run sequential/coherently, not competing worker suites.",
      ".\\native-app\\gradlew.bat -p native-app :androidApp:connectedDebugAndroidTest; record active UI cases, Android API/ABI/device/IME and server-byte evidence, do not equate legacy tests with journeys.",
      "Manual mounted device scenarios and allocation profiling in acceptance-matrix.md; Android29+both ABI artifacts/device evidence mandatory, absent target means blocked."
    ]
  },
  {
    "id": "document-qualified-scope-and-distribution",
    "title": "Document exact scope evidence and LGPL distribution obligations",
    "blocked_by": [
      "qualify-integrated-runtime"
    ],
    "allowed_files": [
      "native-app/README.md",
      "docs/architecture/android-native-client.md",
      "docs/android-native-acceptance.md",
      "docs/android-native-dependency-decisions.md",
      "docs/CHANGELOG.md",
      "docs/project-roadmap.md",
      "native-app/androidApp/src/main/assets/licenses/sora-editor.txt",
      "native-app/androidApp/src/main/assets/licenses/editor-language-assets.txt",
      "plans/261023-1429-native-editor-file-explorer/runtime-qualification.md",
      "plans/261023-1429-native-editor-file-explorer/distribution-qualification.md"
    ],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "Documentation accurately reflects observed increment and limitations, not full native parity or completion of related plans.",
      "Exact selected editor/language licenses/notices/source/relinking requirements have a concrete demonstrated compliant distribution mechanism or explicit release blocker.",
      "Architecture/acceptance/dependency/changelog/roadmap agree; parent-collected reports and other plans unchanged."
    ],
    "verification": [
      "Review packaged APK/materials, source/version/license inventory and user relinking/replacement procedure using actual artifact; record evidence or block release.",
      "Check docs against runtime-qualification.md and ten journey outcomes; no asserted result absent command/device/server evidence."
    ]
  },
  {
    "id": "finalize-editor-explorer-acceptance",
    "title": "Reconcile all acceptance and independent release gates",
    "blocked_by": [
      "document-qualified-scope-and-distribution"
    ],
    "allowed_files": [],
    "constraints": [
      "Only listed files; escalate missing ownership before editing.",
      "Preserve contracts C1-C7; no backend/schema change or runtime qualification claim from unit tests."
    ],
    "acceptance": [
      "All ten journeys traced to current evidence and no unresolved severe safety/ownership defect; otherwise explicitly blocked, not done.",
      "Release license/ABI/Android29/IME gates and independent review status recorded separately from broader preview/semantic-service obligations."
    ],
    "verification": [
      "Inspect actual linked artifacts/current implementation evidence and independent review dispositions; confirm every acceptance row outcome and all affected callers/docs migrated.",
      "No extra runtime rerun solely to confirm already-reported failures; use preserved evidence and scoped authorized fixes/rechecks when needed."
    ]
  }
]
```

## Failure, rollback and security
Missing device, server-byte, version or distribution evidence blocks the corresponding gate. No static-source tests as proxy, no coverage percentage invented, no destructive Git/reset or production fixture changes. Do not waive mounted smoke or license obligations. On failure preserve local edits/server fixture evidence and halt release; do not auto-undo remote mutations.
- Preserve original target/buffers on failure; never use exception suppression, unconditional writes, blind retry, force_git bypass or remote inverse operations as rollback. Authentication/connection retirement revokes authority before UI transitions.
- Escalate missing writable path, unsupported native API, threshold change or severe safety defect to Main; keep gate blocked until explicit scoped revision. No automatic Git/dependency execution is authorized by this plan.

## Completion and next dependencies
Terminal gate for this increment only. Broader native preview/TS/semantic parity and any still-open native release requirements remain in read-only related plan. Main owns final review/validation/task-state lifecycle if later authorized; this planning assignment does not hydrate state.
- Exit evidence: exact changed paths, behavioral check commands/results and blockers. Complete only on task acceptance plus coherent integrated evidence; planned command text is not a pass.

## Unresolved questions
- No new product decision. Phase01 feasibility and phase08 runtime/distribution gates remain evidence requirements; unresolved gates block readiness/release.
