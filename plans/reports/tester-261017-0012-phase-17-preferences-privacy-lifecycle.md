# QA Test Verification Report: Phase 17 — Preferences, Privacy, Notifications, and Lifecycle

Date: 2026-10-17
Working Tree: `dam-hopper-android-native-app`
Scope: Automated test suite verification for Phase 17 (C02–C03, N01, V01): shared Kotlin Multiplatform JVM unit tests, Android unit tests (`debug` and `release`), crypto bridge tests, Android `assembleDebug` APK build, and 16 static invariant shell suites (`tests/test-phase-02-foundation.sh` through `tests/test-phase-17-preferences-privacy-lifecycle.sh`).

---

## Test Results Overview

| Suite / Target | Type | Total Run | Passed | Failed | Skipped | Status | Execution Details |
|---|---|---|---|---|---|---|---|
| `:shared:jvmTest` | Automated unit tests | 302 | 302 | 0 | 0 | PASSED | 56 test classes, execution time: 36.4s |
| `:androidApp:testDebugUnitTest` | Automated unit tests | 76 | 76 | 0 | 0 | PASSED | 16 test classes |
| `:androidApp:testReleaseUnitTest` | Automated unit tests | 76 | 76 | 0 | 0 | PASSED | 16 test classes |
| **Total Unit Test Executions** | — | **454** | **454** | **0** | **0** | **PASSED** | Combined Gradle run wall time: 54s (`--rerun-tasks`) |
| Crypto Bridge (`cargo test`) | Native Rust unit tests | 7 | 7 | 0 | 0 | PASSED | `damhopper_crypto_bridge` (0.16s wall time) |
| Invariant scripts (`test-phase-02..17.sh`) | Static structural assertions | 1,327 | 1,327 | 0 | 0 | PASSED | 16 phase suites, all confirmed direct exit code 0 (2.47s total) |
| `:androidApp:assembleDebug` | Android build verification | 55 tasks | 55 | 0 | 0 | PASSED | 55/55 actionable tasks executed with `--rerun-tasks` in 21s |

---

## Detailed Suite Breakdown

### 1. `tests/test-phase-17-preferences-privacy-lifecycle.sh` (6 Suites / 99 Assertions / Direct Exit Code 0)
- **Suite 1: Settings and Preferences Models & Clamping (C02, C03)** — 12/12 passed:
  - Enums: `WorkbenchTheme`, `CognitoModeStyle`, `ExplorerLanguageFilter`, `TerminalFontSize`, `EditorFontSize`, `SettingsTargetSource`.
  - Models: `WorkbenchPreferences` with bounds clamping (tab size 2..8, line height 1.0..2.5, scrollback 1,000..100,000), `RemotePreferencesPatch`.
  - Wire mappings: `@SerialName` tags for TOML/JSON serialization.
- **Suite 2: Settings Repository, Multi-Source & TOML Import/Export (C02, C03)** — 13/13 passed:
  - `SettingsRepository` and `PreferencesStore` contract adherence.
  - Multi-source routing: `SettingsTargetSource.LOCAL_DEVICE`, `GLOBAL_REMOTE`, `WORKSPACE_REMOTE`.
  - TOML import 1 MiB boundary (`MAX_CONFIG_IMPORT_BYTES = 1_048_576L`).
  - Safe import/export via SAF interfaces and non-destructive profile retirement.
- **Suite 3: Ephemeral Cognito Privacy Controller & Overlay (C02, C03)** — 14/14 passed:
  - `PrivacyController` ephemeral state (no disk persistence, reset on launch).
  - Terminal & Sora Editor dispatch input-blocking when mask active.
  - Emergency touch dismissal gesture (3 taps within 800ms).
  - Configurable mask styles: `OPAQUE_OBSCURATION`, `BLURRED_CONTENT`.
- **Suite 4: Notification Sink & Privacy Redaction (N01)** — 11/11 passed:
  - `NotificationSink` channels: `AGENT_STATUS`, `SESSION_ALERTS`, `TRANSFERS`, `SYSTEM_HEALTH`.
  - Public notification redaction (mask sensitive terminal/file content on lock screen).
  - Profile-scoped notification retirement cancellation.
  - Deep-link key routing: `target_panel`, `target_profile_id`, `target_session_id`.
- **Suite 5: Lifecycle Coordination & Process Recreation (V01)** — 8/8 passed:
  - `LifecycleCoordinator` state tracking: `FOREGROUND`, `BACKGROUND_RETAINED`, `PROCESS_RECREATION`.
  - Listener dispatch and demand pause for SSE/watchers/media.
  - Android SharedPreferences fallback store with exact keys.
- **Suite 6: UI Presentation & Invariants (NAV01, C02, C03, N01, V01)** — 41/41 passed:
  - `SettingsScreens` wiring into `WorkbenchScreen`.
  - `CognitoOverlay` integration over terminal and editor viewports.
  - Invariant checks across 11 files in `dev/damhopper/nativeapp/features/settings`: 0 `FloatingActionButton`, 0 `ExtendedFloatingActionButton`, 0 `WebView`.

### 2. Static Invariant Regression Suites (`test-phase-02..16.sh` / 1,228 Assertions / All Direct Exit Code 0)
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
- `tests/test-phase-16-ports-tunnels-host-controls.sh`: 194 passed, 0 failed (exit 0)
- **Regression Invariants Subtotal (02..16)**: 1,228 passed, 0 failed.
- **Grand Total Static Invariants (02..17)**: **1,327 passed, 0 failed across all 16 suites** (all confirmed direct exit code 0).

### 3. Shared JVM Unit Tests (`:shared:jvmTest` / 56 Classes / 302 Tests)
- `SettingsRepositoryTest` (6 tests passed):
  - `testWorkbenchPreferencesClamping`: Tab size (2..8), line height, scrollback clamping.
  - `testSettingsTargetIndependence`: Local device preferences separate from remote targets.
  - `testSwitchPreferenceSourceLifecycle`: Dynamic switching between local, global remote, workspace remote.
  - `testImportWorkspaceTomlEnforces1MiBBoundary`: Enforces 1,048,576-byte ceiling on TOML config import.
  - `testUpdateLocalPreferencesModifiesFlowAndStore`: Reactive Flow propagation on preference mutation.
  - `testOnProfileRemovedRetainsSnapshotAndClearsTarget`: Cleanup on profile deletion without memory leak.
- `PrivacyControllerTest` (8 tests passed):
  - `testInitialMemoryStateIsInactive`: Inactive on init.
  - `testActivationFreezesChordAndBlocksInput`: Activation engages input freeze.
  - `testTouchEmergencyDismissal`: Triple tap within 800ms clears mask.
  - `testTerminalInputIsolationUnderPrivacyMask`: Terminal keystroke drop under privacy mask.
  - `testEditorInputIsolationUnderPrivacyMask`: Sora Editor input drop under privacy mask.
  - `testDismissalRequiresExactMatchingChord`: Rejects partial or invalid unlock sequences.
  - `testTrailingReleaseConsumption`: Consumes residual key-up events after unlock.
  - `testLifecycleResetCleansUpState`: Clears active mask on background/reset.
- `LifecycleCoordinatorTest` (3 tests passed):
  - `testLifecycleTransitionsAndListenerCallbacks`: State propagation across foreground/background.
  - `testUnregisterListener`: Listener removal safety.
  - `testFaultTolerantListenerDispatch`: Exception isolation across listener callbacks.
- `NotificationSinkTest` (3 tests passed):
  - `testNotificationChannels`: Channel registration.
  - `testNotificationPostingAndPublicRedaction`: Redaction of private details from public payload.
  - `testCancelNotificationsForProfileOnRetirement`: Profile tear-down notification cleanup.
- Additional 52 regression test classes (Phase 02–16 domains): 282 tests passed.
- **Result**: 302 passed, 0 failed, 0 skipped.

### 4. Android Unit Tests (`:androidApp:testDebugUnitTest` & `testReleaseUnitTest` / 16 Classes / 76 Tests Each / 152 Executions Total)
- `SettingsPreferencesPhase17Test` (8 tests passed per variant = 16 executions):
  - `testSettingsPanelRegisteredInAuthoritativeRegistry`: Verifies `SETTINGS` panel registration in `PanelRegistry`.
  - `testZeroFloatingActionButtonsInSettingsAndPrivacyUi`: Invariant check ensuring 0 FABs across settings/privacy UI.
  - `testZeroWebViewOrBrowserEngineInSettingsAndPrivacyUi`: Invariant check ensuring 0 WebViews in settings/privacy UI.
  - `testEphemeralMemoryOnlyCognitoState`: Verifies Cognito mask state is purely memory-backed.
  - `testLifecycleTransitions`: Validates Android lifecycle state transitions.
  - `testNotificationChannelsAndDeepLinkKeys`: Confirms 4 notification channels and deep-link routing keys.
  - `testAndroidPreferencesStoreKeys`: Validates SharedPreferences storage keys.
  - `testMaxConfigImportBytesCeiling`: Validates 1 MiB boundary constant.
- Regression test classes (68 tests passed per variant = 136 executions across 15 classes):
  - `PortsAndHostControlsPhase16Test` (5 tests)
  - `HostResourcesPhase15Test` (7 tests)
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
- **Result**: 76 passed (Debug), 76 passed (Release) = 152 test executions, 0 failed, 0 skipped.

### 5. Crypto Bridge Unit Tests (`cargo test` / 7 Tests)
- `test_handle_store_lifecycle_and_double_close`: PASSED
- `test_envelope_roundtrip_and_tamper_rejection`: PASSED
- `test_ciphertext_tamper_rejection`: PASSED
- `test_envelope_metadata_max_and_separator_enforcement`: PASSED
- `test_malformed_message_handling`: PASSED
- `test_wrong_password_rejection`: PASSED
- `test_full_opaque_handshake_with_server_parity`: PASSED
- **Result**: 7 passed, 0 failed, 0 ignored in 0.16s.

### 6. Android Build Verification (`:androidApp:assembleDebug`)
- Build succeeded: 55/55 actionable tasks executed with `--rerun-tasks` in 21s.
- Clean DEX merging, packaging completed without asset or manifest collisions.
- Note: Build emitted standard Gradle 8.11 deprecation warnings regarding future Gradle 9.0 compatibility. APK artifact inspection was blocked by environment ignore policy, so device installation was not executed.

---

## Coverage Metrics
- Line / branch / function coverage instrumentation is not configured in this Gradle build setup; metrics rely on unit test assertion density (454 unit test executions across 72 test classes) and static AST/grep invariant checking (1,327 assertions across 16 suites).

---

## Performance Metrics
- Unit test suite execution time: 54.2s (clean `--rerun-tasks` multi-task run).
- Android assembleDebug execution time: 21.8s (clean `--rerun-tasks`).
- Shell invariant assertion suites (16 suites): 2.47s total wall time.
- Crypto bridge tests (`cargo test`): 0.16s total wall time.
- Slow tests identified: None exceeding test runner threshold; longest task is Kotlin multiplatform JVM compilation (~15s).

---

## Build Status
- **Success**: Build succeeded across all targets.
- **Warnings**: Gradle deprecation warnings for Gradle 9.0 compatibility (standard upstream plugins).

---

## Critical Issues
- None blocking unit test execution or debug APK assembly.

---

## Pending Runtime Qualification
- Unit tests validate contracts and component logic in mocked/headless JVM environments; the following runtime behaviors require physical device qualification (deferred to Phase 18):
  1. Live AndroidView/Termux-view and Sora Editor input freeze under actual touch/hardware keyboard interaction.
  2. OS-level notification posting, user permission dialog flow, and deep-link intent routing from notification clicks.
  3. Real Android Storage Access Framework (SAF) document picker integration for TOML config import/export.
  4. Android OS background process termination and activity recreation survival with live WebSocket connections.

---

## Recommendations
1. Establish automated code coverage reporting (e.g. Kover or Jacoco) for multiplatform shared code.
2. Add Robolectric or AndroidX instrumentation tests for `AndroidNotificationSink` to test notification manager interaction.

---

## Unresolved Questions
- None blocking automated test validation.
