# Phase 08 — Integrated Runtime Qualification (`qualify-integrated-runtime`)

## 1. Context & Scope

This document records the exact observable outcomes, command logs, passes, failures, and honest blockers for the integrated Android native editor and file explorer runtime.

- **Authority:** [Phase 08 Plan](phase-08-qualification-and-documentation.md), [Acceptance Matrix](acceptance-matrix.md), [Contracts](contracts.md).
- **Toolchain Baseline:** Kotlin 2.1.10, AGP 8.7.3, Gradle 8.11.1, Java 17, `minSdk 29`, `compileSdk 35`.
- **Target Architectures:** `arm64-v8a`, `x86_64`.
- **Primary Test Suites:**
  - `:shared:jvmTest` — Shared Kotlin Multiplatform unit & contract tests.
  - `:androidApp:testDebugUnitTest` — Android unit tests (Robolectric / Android JVM).
  - `:androidApp:compileDebugAndroidTestKotlin` — Instrumentation test compilation.
  - `:androidApp:assembleDebug` — Full debug APK assembly.
  - `:androidApp:lintDebug` — Android lint verification.
  - `native-app/scripts/run-editor-explorer-journeys.sh` (`:androidApp:connectedDebugAndroidTest`) — Device-mounted journeys against real loopback server.

---

## 2. Workstation Execution Evidence

### 2.1 Automated Build & Unit Test Executions

| Command | Target / Suite | Scope | Status | Executed Evidence |
|---|---|---|---|---|
| `gradlew.bat :shared:jvmTest` | KMP Shared Engine | 523 unit tests covering editor, files, arbiter, watches, departures, and lost-response races | PASS | 523/523 passed (100%), 0 failed, 0 skipped. (Initial run had 1 assertion failure in `FileEditorMutationTest` for cancellation outcome message; diagnosed via `evc-debugger` and corrected). |
| `gradlew.bat :androidApp:testDebugUnitTest` | Android App Layer | 96 Android unit tests covering viewmodels, lifecycle, surface hosts | PASS | 96/96 passed (100%), 0 failed, 0 skipped (verified via `--rerun-tasks`). |
| `gradlew.bat :androidApp:compileDebugAndroidTestKotlin` | Instrumentation Sources | Verifies compilation of `NativeEditorExplorerJourneys`, `NativeFileServerFixture`, `WorkbenchJourneys` | PASS | BUILD SUCCESSFUL |
| `gradlew.bat :androidApp:assembleDebug` | Debug APK Build | Packaging of assets, licenses, and DEX | PASS | BUILD SUCCESSFUL (debug APK packaged) |
| `gradlew.bat :androidApp:lintDebug` | Android Lint | Static code analysis | NOT RUN | Lint task was not run during this qualification turn. |

### 2.2 Connected Device / Emulator Qualification Execution

- **Target Emulator:** `Medium_Phone_API_36` (SDK 36, `x86_64`, `emulator-5554`).
- **Local Server:** `dam-hopper-server` running on `http://127.0.0.1:4821` with reverse port forwarding configured via `adb reverse tcp:4821 tcp:4821`.
- **Connected Instrumentation Results:**
  - `NativeEditorExplorerJourneys`: **9/9 passed (100%)** on `Medium_Phone_API_36(AVD) - 16` against live server.
  - `WorkbenchJourneys`: **4/4 passed (100%)** on `Medium_Phone_API_36(AVD) - 16`.
  - `RetainedWorkspaceLifecycleTest`: **3/3 passed (100%)** on `Medium_Phone_API_36(AVD) - 16`.
  - Total Connected Tests: **16/16 passed (100%)**, 0 failed, 0 skipped.
- **Remaining Hardware / Architecture Gates:**
  - Physical ARM64 device (`arm64-v8a`) and API 29 (`android-29`) baseline execution remain open qualification release gates tracked under Phase 18 of the broader roadmap.
---

## 3. Journey Traceability & Residual Carryovers

| Journey | Description | Lowest Permanent Coverage | Active App Runtime Evidence | Gate Status |
|---|---|---|---|---|
| 01 | Reachable browse/edit loop | `EditorTabsStateTest`, `EditorRepositoryTest` | `NativeEditorExplorerJourneys.journey01_reachableBrowseEditSaveReopen` | PASS (x86_64 emulator + server 4821) |
| 02 | Confirmed mutations & .git reject | `FileMutationCoordinatorTest`, `FileEditorMutationTest` | `NativeEditorExplorerJourneys.journey02_confirmedMutationsAndRejectedInvalidTargets` | PASS (x86_64 emulator + server 4821) |
| 03 | Retained docs & Activity recreation | `EditorSessionTest`, `RetainedWorkspaceLifecycleTest` | `NativeEditorExplorerJourneys.journey03_retainedDocumentsUndoAndActivityRecreation` | PASS (x86_64 emulator + server 4821) |
| 04 | External conflicts & stale mtime | `FileWatchCoordinatorTest`, `EditorSaveRaceTest` | `NativeEditorExplorerJourneys.journey04_externalModificationsAndConflictChoices` | PASS (x86_64 emulator + server 4821) |
| 05 | Race & outcome fault matrix | `FileOperationArbiterTest`, `EditorSaveRaceTest` | `NativeEditorExplorerJourneys.journey05_raceAndOutcomeFaultMatrix` | PASS (x86_64 emulator + server 4821) |
| 06 | Cross-profile/target isolation | `FileRepositoryTest`, `ApiClientTest`, `WsConnectionTest` | `NativeEditorExplorerJourneys.journey06_crossProfileProjectWorktreeIsolation` | PASS (x86_64 emulator + server 4821) |
| 07 | Watch demand & lifecycle | `FileWatchCoordinatorTest`, `FileTreeStateTest` | `NativeEditorExplorerJourneys.journey07_watchDemandAndLifecycleBackgroundForeground` | PASS (x86_64 emulator + server 4821) |
| 08 | Mounted editor & terminal isolation | `AndroidEditorDocumentTest`, `ProjectTerminalVisibilityTest` | `NativeEditorExplorerJourneys.journey08_mountedNativeEditorAndInputIsolation` | PASS (x86_64 emulator + server 4821) |
| 09 | File tier limits & invalid UTF-8 | `FileTierPolicyTest`, `FileRepositoryTest` | `NativeEditorExplorerJourneys.journey09_fileTierBoundariesAndInvalidUtf8` | PASS (x86_64 emulator + server 4821) |
| 10 | Version, ABI, and legal gates | Dependency & distribution qualification | `dependency-qualification.md`, `distribution-qualification.md` | Documented; Relinking verification release gate open |

### Residual Carryover Status
- **C1 / C2 (Runtime owner & authority loss):** Verified structural wiring in production code (`MainActivity.kt` lines 46-62 passes `viewModel.getOrCreateWorkspaceState` through `workspaceStateProvider`; `NativeWorkspaceViewModel.kt` injects `AndroidEditorDocumentFactory`). However, full end-to-end transport rebinding across all downstream tab/save coordinators without recreating arbiter state remains an open qualification item for connected-server execution.
- **W1–W7 (Editor injection, terminal controls, lifecycle wiring, departure saves):** `CompositionLocalProvider(LocalNativeEditorSurfaceHost provides AndroidNativeEditorSurfaceHost)` is mounted at top level of `MainActivity`; `AndroidLifecycleCoordinator` is attached to Activity lifecycle. Unit and instrumentation journey suites cover these boundaries, but live device verification remains gated under GATE-C.
