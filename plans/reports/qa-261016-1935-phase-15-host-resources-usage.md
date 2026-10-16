# QA Test Verification Report: Phase 15 — Host Resources Fleet & Usage Analytics

Date: 2026-10-16
Working Tree / Base Revision: `68c41f4b` (`feat(native-app): implement agent store, memory and imports (Phase 14)`) with Phase 15 host resources fleet and usage analytics implementation.
Scope: Full test suite verification for Phase 15 across shared Kotlin multiplatform JVM unit tests, Android unit tests (`debug` and `release`), Android `assembleDebug` build verification, and all 14 static invariant test suites (`tests/test-phase-02-foundation.sh` through `tests/test-phase-15-host-resources-usage.sh`).

---

## Test Results Overview

| Suite / Target | Type | Total Run | Passed | Failed | Skipped | Status | Execution Details |
|---|---|---|---|---|---|---|---|
| `:shared:jvmTest` | Automated unit tests | 266 | 266 | 0 | 0 | PASSED | 48 test classes, ~18.0s (`--rerun-tasks`) |
| `:androidApp:testDebugUnitTest` | Automated unit tests | 63 | 63 | 0 | 0 | PASSED | 14 test classes, ~15.5s (`--rerun-tasks`) |
| `:androidApp:testReleaseUnitTest` | Automated unit tests | 63 | 63 | 0 | 0 | PASSED | 14 test classes, ~15.5s (`--rerun-tasks`) |
| **Total Unit Test Executions** | — | **392** | **392** | **0** | **0** | **PASSED** | 100% pass rate (266 JVM + 63 Debug + 63 Release) |
| Invariant scripts (`test-phase-02..15.sh`) | Static structural assertions | 1033 | 1033 | 0 | 0 | PASSED | 14 phase suites, all exited with code 0 (~2.6s) |
| `:androidApp:assembleDebug` | Build verification | 55 tasks | 55 | 0 | 0 | PASSED | 55 executed via `--rerun-tasks`, ~14.0s |

---

## Detailed Suite Breakdown

### 1. `tests/test-phase-15-host-resources-usage.sh` (5 Suites / 80 Assertions)
- **Suite 1: Host Resource Models & DTOs (H01)** — 20/20 passed:
  - Enums & DTOs: `AvailabilityState`, `Availability`, `HostIdentity`, `MemorySnapshot`, `PressureInfo`, `MemoryPressure`, `CgroupMemory`, `ProcessMemory`, `ProcessInventory`, `MountContext`, `BatterySnapshot`, `HostResourceSnapshotV1`.
  - Metrics: `HostMetrics`, `CpuMetrics`, `MemoryMetrics`, `DiskMetrics`.
  - Alerts: `AlertState`, `AlertSeverity`, `AlertSummary`, `AlertIncident`.
- **Suite 2: Usage Models & DTOs (U01)** — 17/17 passed:
  - Range & Aggregates: `UsageRange`, `TokenAggregate`, `UsageTimeBucket`, `CollectorHealthSnapshot`, `UsageHealth`, `UsageSummaryResponse`.
  - Sessions & Deletion: `SessionRange`, `SessionTokens`, `SessionSummaryDto`, `SessionListResponse`, `SessionDetailResponse`, `DeleteUsageRequest`, default confirmation literal `"delete-usage-data"`.
  - Settings & Setup: `CodexExporterStatus`, `UsageSettingsResponse`, `SettingsPatchRequest`, `UsageSetupStatusResponse`.
- **Suite 3: Streaming, Pairing & Coordination (H01)** — 18/18 passed:
  - Coordination & Models: `ResourceSourceMode`, `ResourceConsumerKind`, `ProjectionFreshness`, `ResourceSourceState`.
  - Timers & Constraints: 10s initial data deadline (`10_000L`), 45s byte idle timeout (`45_000L`), max retry count 5 (`MAX_RETRY_COUNT = 5`), 60s stable live window (`STABLE_WINDOW_MS = 60_000L`).
  - Stream Lifecycle & Commits: `canUseResourceRest()`, `registerInterest()`, `commitRestPair()`.
  - Invariants & Revisions: Revision duplicate rejection (`newRev <= currentRev`), epoch switch check (`currentEpoch == data.serverEpoch`).
  - Failure Latching: `AUTH_UNAVAILABLE` latches `AuthBlocked`, `FRAME_TOO_LARGE` latches `RestOnly`.
  - SSE Protocol Bounding: Bounded error reading (`errorBytes < 4096`), data event overflow check (`MAX_DATA_EVENT_BYTES`), byte progress callback (`onByteProgress`).
- **Suite 4: Repositories & Controllers (H01, U01)** — 15/15 passed:
  - Repositories: `HostResourceRepository` (`/api/system/resources/v1/snapshot`, `/api/system/metrics`, `/api/system/resources/v1/alerts`).
  - Usage Repository: `UsageRepository` (`/api/usage/summary`, `/api/usage/health`, `/api/usage/settings`, `/api/usage/setup`, `/api/usage/sessions`, `/api/usage`).
  - Controllers: `HostResourceController`, `UsageController` (enforces `"delete-usage-data"` string validation and `queryGeneration++` fencing).
- **Suite 5: UI & Workbench Integration (H01, U01)** — 10/10 passed:
  - Composables: `FleetScreens`, `UsageScreens`, `ResourcesUnifiedPanelScreen`, `ResourcesSubProduct` enum.
  - Workbench wiring: `resourcesContent = { ... }` slot in `WorkbenchScreen`, `WorkbenchPanel.RESOURCES` back handler.
  - Zero-FAB & Zero-WebView: Zero `FloatingActionButton` and zero `WebView` in both host and usage feature files.

### 2. Invariant Regression Suites (`test-phase-02..14.sh` / 953 Assertions)
- `tests/test-phase-02-foundation.sh`: 47 passed, 0 failed (exit 0).
- `tests/test-phase-03-transport.sh`: 48 passed, 0 failed (exit 0).
- `tests/test-phase-04-profiles-auth.sh`: 57 passed, 0 failed (exit 0).
- `tests/test-phase-05-proof-gates.sh`: 66 passed, 0 failed (exit 0).
- `tests/test-phase-06-shell-workspace.sh`: 64 passed, 0 failed (exit 0).
- `tests/test-phase-07-terminal-agents.sh`: 45 passed, 0 failed (exit 0).
- `tests/test-phase-08-filesystem-watchers.sh`: 57 passed, 0 failed (exit 0).
- `tests/test-phase-09-editor-saves.sh`: 70 passed, 0 failed (exit 0).
- `tests/test-phase-10-diff-merge-blame.sh`: 77 passed, 0 failed (exit 0).
- `tests/test-phase-11-encrypted-transfers-media.sh`: 84 passed, 0 failed (exit 0).
- `tests/test-phase-12-git-history.sh`: 139 passed, 0 failed (exit 0).
- `tests/test-phase-13-workflow-plans.sh`: 100 passed, 0 failed (exit 0).
- `tests/test-phase-14-agent-store-memory.sh`: 99 passed, 0 failed (exit 0).
- **Subtotal Regression Invariants**: 953 passed, 0 failed.
- **Total Combined Invariants (02..15)**: 1033 passed, 0 failed across all 14 suites.

### 3. `:shared:jvmTest` (48 Test Classes / 266 Unit Tests)
- `HostResourceModelsTest` (6 tests passed):
  - `testSseBoundedErrorBodyReading`: Verifies 4096-byte clamp on error streams.
  - `testSseDataEventOverflowRejection`: Validates oversized payload rejection.
  - `testSseByteProgressReporting`: Confirms progress emissions during streaming.
  - `testAlertIncidentsDeserialization`: Validates alert JSON payload mappings.
  - `testMetricsDeserialization`: Validates host metrics parsing.
  - `testSnapshotDeserializationWithNullAndUnsupportedDistinction`: Validates distinction between null values and unsupported capability markers.
- `ResourceStreamCoordinatorTest` (5 tests passed):
  - `testForegroundBackgroundLifecycle`: Verifies pause/resume when entering background.
  - `testCanUseResourceRestGate`: Validates REST fallback gating condition.
  - `testFailureOutcomeLatches`: Confirms terminal error latches (`AuthBlocked`, `RestOnly`).
  - `testRevisionCommitAndDuplicateRejection`: Ensures duplicate and stale revision frames are discarded.
  - `testInitialStateAndInterestRegistration`: Validates consumer subscription and startup.
- `UsageRepositoryAndControllerTest` (3 tests passed):
  - `testSummaryParsingWithNullTokensPreserved`: Verifies non-zero/null token aggregate preservation.
  - `testDeleteUsageRequiresConfirmationString`: Validates strict guard against accidental deletion without literal confirmation.
  - `testSessionsListAndCursorPagination`: Validates cursor-based pagination over session summaries.
- `HostResourceSseTest` (4 tests passed):
  - `testSsePreHeaderFiniteError`: Validates early HTTP error handling before SSE headers.
  - `testSseCommentBreaksPairingAdjacency`: Verifies comment line boundary handling.
  - `testSseStatusAndDataPairingRequirement`: Validates pairing requirements between status and data events.
  - `testUiConnectionReceiptLifecycle`: Tests lifecycle receipt notifications.
- Additional 44 regression test classes across crypto, transport, terminal, editor, files, git, and workflow domains: 248 tests passed.
- **Result**: 266 passed, 0 failed, 0 skipped.

### 4. `:androidApp:testDebugUnitTest` & `:androidApp:testReleaseUnitTest` (14 Classes / 63 Tests Each / 126 Executions Total)
- `HostResourcesPhase15Test` (7 tests passed in debug, 7 passed in release):
  - `testResourcesSubProducts`: Verifies `ResourcesSubProduct` enum values and labels.
  - `testResourceConsumerKindsCompleteness`: Confirms all consumer kinds are represented.
  - `testDeleteUsageConfirmationDefault`: Verifies default confirmation literal string.
  - `testResourcesPanelRegisteredInAuthoritativeRegistry`: Confirms `WorkbenchPanel.RESOURCES` is registered in authoritative panel registry.
  - `testResourceSourceModesCompleteness`: Confirms full coverage of resource source modes.
  - `testZeroWebViewOrBrowserEngineInHostFeaturesUi`: Asserts no WebView or browser engine usage in host and usage screens.
  - `testZeroFloatingActionButtonsInHostFeaturesUi`: Asserts zero `FloatingActionButton` components in host and usage screens.
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

### 5. `:androidApp:assembleDebug`
- Status: BUILD SUCCESSFUL (55/55 actionable tasks executed with `--rerun-tasks`, ~14.0s).
- Packaging checks: zero asset packaging collisions, JNI ABI bindings intact.

---

## Evidence & Limitations

1. **Sandboxed Build Outputs**:
   - Access to intermediate XML test result files under `native-app/shared/build/test-results/` and direct filesystem access to generated APK files under `native-app/androidApp/build/outputs/apk/debug/` was blocked by the tool sandbox policy (`build/` in `.evcrateignore`).
   - All test counts and task execution results are grounded in authoritative Gradle plain console execution logs (`--console=plain --rerun-tasks`).
2. **Device / Physical Execution**:
   - Verification executed in JVM unit test and Gradle build compilation environments.
   - Physical device / emulator verification for Compose 60fps frame rendering under SSE streaming workloads and physical hardware back button gestures remains recommended for end-to-end device qualification.

---

## Unresolved Questions

- None blocking automated test validation.
