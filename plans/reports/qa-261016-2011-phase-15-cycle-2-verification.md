# QA Test Verification Report: Phase 15 — Host Resources Fleet & Usage Analytics (Cycle 2)

Date: 2026-10-16
Plan: `plans/261015-1647-android-native-app/plan.md`
Phase: `phase-15-host-resources-fleet-and-usage.md`
Base Revision: `68c41f4b` (`feat(native-app): implement agent store, memory and imports (Phase 14)`)
Scope: Cycle 2 remediation verification across shared Kotlin multiplatform JVM unit tests, Android unit tests (`debug` and `release`), Android `assembleDebug` build verification, and all 14 regression invariant test suites (`tests/test-phase-02-foundation.sh` through `tests/test-phase-15-host-resources-usage.sh`).

---

## Test Results Overview

| Suite / Target | Type | Total Run | Passed | Failed | Skipped | Status | Execution Details |
|---|---|---|---|---|---|---|---|
| `:shared:jvmTest` | Automated unit tests | 269 | 269 | 0 | 0 | PASSED | 48 test classes, ~18.9s (`--rerun-tasks`) |
| `:androidApp:testDebugUnitTest` | Automated unit tests | 63 | 63 | 0 | 0 | PASSED | 14 test classes, ~16.9s (`--rerun-tasks`) |
| `:androidApp:testReleaseUnitTest` | Automated unit tests | 63 | 63 | 0 | 0 | PASSED | 14 test classes, ~16.9s (`--rerun-tasks`) |
| **Total Unit Test Executions** | — | **395** | **395** | **0** | **0** | **PASSED** | 100% pass rate (269 JVM + 63 Debug + 63 Release) |
| Invariant scripts (`test-phase-02..15.sh`) | Static structural assertions | 1034 | 1034 | 0 | 0 | PASSED | 14 phase suites, all exited with code 0 (~2.1s) |
| `:androidApp:assembleDebug` | Build verification | 55 tasks | 55 | 0 | 0 | PASSED | 55 executed via `--rerun-tasks`, ~24.4s |

---

## Detailed Suite Breakdown

### 1. `:shared:jvmTest` (48 Test Classes / 269 Unit Tests)
- `ResourceStreamCoordinatorTest` (6 tests passed):
  - `testInitialStateAndInterestRegistration`: Validates consumer subscription and stream initialization.
  - `testForegroundBackgroundLifecycle`: Verifies pause/resume when entering and leaving foreground.
  - `testRevisionCommitAndDuplicateRejection`: Ensures duplicate and stale revision frames are discarded.
  - `testFailureOutcomeLatches`: Confirms terminal error latches (`AuthBlocked`, `RestOnly`) and retry counter progression.
  - `testCanUseResourceRestGate`: Validates REST fallback gating condition across lifecycle states.
  - `testIsCurrentOwnerWithRegistryValidation`: Validates connection owner validation against `ConnectionRegistry` state (missing profile, active generation, retired profile, advanced generation).
- `UsageControllerLoadingTest` (2 tests passed):
  - `testUsageControllerLoadsSummaryAndSessionsConcurrently`: Verifies concurrent summary and session loading without race conditions or dropped summary responses.
  - `testUpdateSettingsAndSetupMutations`: Validates settings and setup patch mutation flows and UI state reflection.
- `UsageRepositoryAndControllerTest` (3 tests passed):
  - `testSummaryParsingWithNullTokensPreserved`: Verifies non-zero and null token aggregate preservation.
  - `testSessionsListAndCursorPagination`: Validates cursor-based pagination over session summaries.
  - `testDeleteUsageRequiresConfirmationString`: Validates strict guard against accidental deletion without literal confirmation.
- `HostResourceModelsTest` (6 tests passed):
  - `testSnapshotDeserializationWithNullAndUnsupportedDistinction`: Validates distinction between null values and unsupported capability markers.
  - `testMetricsDeserialization`: Validates host metrics parsing.
  - `testAlertIncidentsDeserialization`: Validates alert JSON payload mappings.
  - `testSseDataEventOverflowRejection`: Validates oversized payload rejection.
  - `testSseByteProgressReporting`: Confirms byte progress emissions during streaming.
  - `testSseBoundedErrorBodyReading`: Verifies 4096-byte clamp on error streams.
- `HostResourceSseTest` (4 tests passed):
  - `testSsePreHeaderFiniteError`: Validates early HTTP error handling before SSE headers.
  - `testSseCommentBreaksPairingAdjacency`: Verifies comment line boundary handling.
  - `testSseStatusAndDataPairingRequirement`: Validates pairing requirements between status and data events.
  - `testUiConnectionReceiptLifecycle`: Tests lifecycle receipt notifications.
- Additional 43 regression test classes across crypto, transport, terminal, editor, files, git, and workflow domains: 248 tests passed.
- **Result**: 269 passed, 0 failed, 0 skipped.

### 2. `:androidApp:testDebugUnitTest` & `:androidApp:testReleaseUnitTest` (14 Classes / 63 Tests Each / 126 Executions Total)
- `HostResourcesPhase15Test` (7 tests passed in debug, 7 passed in release):
  - `testResourcesPanelRegisteredInAuthoritativeRegistry`: Confirms `WorkbenchPanel.RESOURCES` is registered in authoritative panel registry.
  - `testZeroFloatingActionButtonsInHostFeaturesUi`: Asserts zero `FloatingActionButton` components in host and usage screens.
  - `testZeroWebViewOrBrowserEngineInHostFeaturesUi`: Asserts no WebView or browser engine usage in host and usage screens.
  - `testResourceSourceModesCompleteness`: Confirms full coverage of resource source modes.
  - `testResourceConsumerKindsCompleteness`: Confirms full coverage of resource consumer kinds.
  - `testResourcesSubProducts`: Verifies `ResourcesSubProduct` enum values (`FLEET`, `USAGE`).
  - `testDeleteUsageConfirmationDefault`: Verifies default confirmation literal string `"delete-usage-data"`.
- Regression test classes (56 tests passed per variant = 112 passed across debug and release):
  - `AgentStorePhase14Test` (6 tests)
  - `FileScreensPhase08Test` (4 tests)
  - `ManifestSecurityTest` (4 tests)
  - `WorkbenchShellPhase06Test` (6 tests)
  - `WorkflowPhase13Test` (4 tests)
  - `OpaqueClientBridgeTest` (5 tests)
  - `AndroidEditorSurfaceTest` (6 tests)
  - `AndroidMediaClientTest` (5 tests)
  - `AndroidDocumentStorageTest` (2 tests)
  - `AndroidProfileMetadataStoreTest` (3 tests)
  - `AndroidTerminalSurfaceTest` (6 tests)
  - `TerminalInputControllerTest` (2 tests)
  - `AndroidCredentialVaultTest` (3 tests)
- **Result**: 63 passed (Debug), 63 passed (Release) = 126 test executions, 0 failed, 0 skipped.

### 3. `:androidApp:assembleDebug`
- Status: BUILD SUCCESSFUL (55/55 actionable tasks executed with `--rerun-tasks`, ~24.4s).
- ABI packaging: zero asset packaging collisions, JNI ABI bindings intact.

### 4. Invariant Regression Suites (`test-phase-02..15.sh` / 1034 Assertions)
- `tests/test-phase-02-foundation.sh`: 47 passed, 0 failed (exit 0)
- `tests/test-phase-03-transport.sh`: 48 passed, 0 failed (exit 0)
- `tests/test-phase-04-profiles-auth.sh`: 57 passed, 0 failed (exit 0)
- `tests/test-phase-05-proof-gates.sh`: 66 passed, 0 failed (exit 0)
- `tests/test-phase-06-shell-workspace.sh`: 64 passed, 0 failed (exit 0)
- `tests/test-phase-07-terminal-agents.sh`: 45 passed, 0 failed (exit 0)
- `tests/test-phase-08-filesystem-watchers.sh`: 57 passed, 0 failed (exit 0)
- `tests/test-phase-09-editor-saves.sh`: 70 passed, 0 failed (exit 0)
- `tests/test-phase-10-diff-merge-blame.sh`: 77 passed, 0 failed (exit 0)
- `tests/test-phase-11-encrypted-transfers-media.sh`: 84 passed, 0 failed (exit 0)
- `tests/test-phase-12-git-history.sh`: 139 passed, 0 failed (exit 0)
- `tests/test-phase-13-workflow-plans.sh`: 100 passed, 0 failed (exit 0)
- `tests/test-phase-14-agent-store-memory.sh`: 99 passed, 0 failed (exit 0)
- `tests/test-phase-15-host-resources-usage.sh`: 81 passed, 0 failed (exit 0)
- **Total Invariants Across All 14 Suites**: 1034 passed, 0 failed.

---

## Cycle 2 Remediation & Advisor Findings Status

1. **Usage summary loading race**: Decoupled `summaryGeneration` and `sessionsGeneration` in `UsageController.kt`. Concurrently loading summary and sessions verified in `UsageControllerLoadingTest`.
2. **Fabricated zeros eliminated**: `UsageScreens.kt` and `FleetScreens.kt` preserve `--` indicators and display degraded/unsupported status warnings instead of implying observed zero values. Mount point defaults to `--` instead of root `/`.
3. **Usage settings/setup/health/retention/exporter flows**: Rendered in `UsageSettingsSection.kt` and wired into `UsageScreens.kt`; mutation methods `updateSettings` and `updateSetup` tested against HTTP endpoints.
4. **Range deletion bounds validation**: `UsageDeleteDialog.kt` enforces day range bounds (`1..1825` days, up to 5 years retention) with explicit error text and `"delete-usage-data"` confirmation guard.
5. **Demand & foreground lifecycle**: `FleetScreens.kt` unregisters view demand on disposal (`onDispose { u1(); u2(); u3() }`); `WorkbenchScreen.kt` controls foreground state (`setForeground(isResActive)`).
6. **Retry budget reset**: `ResourceStreamTimers.kt` arms stable live window only when `stableWindowJob` is inactive, preventing continuous restarts on periodic ~5s frames.
7. **Connection registry owner check**: `ResourceStreamCoordinator.isCurrentOwner()` validates against non-null registry entries; missing profile correctly returns `false`. Verified in `ResourceStreamCoordinatorTest.testIsCurrentOwnerWithRegistryValidation`.
8. **Thread-safe state mutation**: `UsageController.kt` converted all state assignments to atomic `_uiState.update { ... }`.

---

## Unresolved Questions

- None blocking automated test execution or build verification. Physical device execution remains recommended for Compose frame rate benchmarks and physical hardware back button gestures under streaming workloads.
