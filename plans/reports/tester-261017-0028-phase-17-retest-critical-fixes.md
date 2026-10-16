# QA Test Verification Report: Phase 17 Re-run (Post Critical Fixes)

Date: 2026-10-17
Working Tree: `dam-hopper-android-native-app`
Plan: `phase-17-preferences-privacy-notifications-and-lifecycle`
Scope: Re-execution of full automated test suite after critical fixes wiring `PrivacyController.isInputAllowed()` into editor/terminal surfaces, IME dismissal, lifecycle profile retirement, and settings navigation.

---

## Sequential Thinking Analysis

1. **Scope Identification**: Critical fixes landed across `AndroidEditorSurface.kt`, `TerminalInputController.kt`, `WorkbenchScreen.kt`, and lifecycle coordination. Retest requires verification across 4 pillars: static shell invariants (16 suites), native Rust crypto bridge (`cargo test`), JVM/Android unit tests (`:shared:jvmTest`, `:androidApp:testDebugUnitTest`, `:androidApp:testReleaseUnitTest`), and debug build assembly (`:androidApp:assembleDebug`).
2. **Execution & Evidence Qualification**:
   - Shell invariants: 16 scripts executed sequentially with direct exit code 0; assertions verified per suite summing to 1,332 checks.
   - Crypto bridge: Cargo test ran 7 unit tests (7 passed, 0 failed) in 0.15s.
   - Gradle tasks: Executed with `--rerun-tasks` to ensure zero stale build cache hits. All completed successfully without task failures.
   - Input isolation & privacy paths: Code changes verified to intercept `setText`, `applyEdit`, `undo`, `redo`, `onHardwareKey`, `onImeCommitText`, `onImeDeleteBackward`, `pasteFromClipboard`.
3. **Qualification Boundaries**: Invariant scripts and JVM headless tests demonstrate contract adherence and regression safety. Runtime device verification (hardware keyboard, touchscreen emergency gestures, system notification tray & lock screen redaction) must be qualified on physical device under Phase 18.

---

## Test Results Overview

| Suite / Target | Type | Executed / Verified | Passed | Failed | Skipped | Status | Execution Wall Time |
|---|---|---|---|---|---|---|---|
| Invariant Suites (`test-phase-02..17.sh`) | Static AST/Pattern Checks | 1,332 assertions | 1,332 | 0 | 0 | PASSED | 2.38s |
| Crypto Bridge (`cargo test`) | Native Rust unit tests | 7 tests | 7 | 0 | 0 | PASSED | 0.15s |
| `:shared:jvmTest` | KMP JVM unit tests | 302 tests (56 classes) | 302 | 0 | 0 | PASSED | 27.7s (`--rerun-tasks`) |
| `:androidApp:testDebugUnitTest` | Android unit tests | 76 tests (16 classes) | 76 | 0 | 0 | PASSED | 19.5s (`--rerun-tasks`) |
| `:androidApp:testReleaseUnitTest` | Android unit tests | 76 tests (16 classes) | 76 | 0 | 0 | PASSED | 16.6s (`--rerun-tasks`) |
| `:androidApp:assembleDebug` | Android debug build | 55 tasks | 55 | 0 | 0 | PASSED | 19.9s (`--rerun-tasks`) |

- **Unit Test Execution Total**: 454 unit test executions across 72 test classes, 0 failures, 0 skipped.
- **Static Invariant Total**: 1,332 assertions across 16 phase suites, all exit code 0.

---

## Invariant Suites Detail (16 Suites / 1,332 Assertions / All Exit 0)

1. `test-phase-02-foundation.sh`: 47 passed (toolchain pins, manifest policies, no webview, package.json)
2. `test-phase-03-transport.sh`: 48 passed (core models, connection registry, wire protocol, SSE/WS)
3. `test-phase-04-profiles-auth.sh`: 57 passed (auth protocol v2, keystore vault, attempt tracker)
4. `test-phase-05-proof-gates.sh`: 66 passed (ConnectBot termlib, Sora Editor LGPL, OPAQUE crypto)
5. `test-phase-06-shell-workspace.sh`: 64 passed (single content area, zero FABs, panel registry)
6. `test-phase-07-terminal-agents.sh`: 45 passed (replay gate, session CRUD, agent status reducer)
7. `test-phase-08-filesystem-watchers.sh`: 57 passed (file tree, watcher events, search & replace)
8. `test-phase-09-editor-saves.sh`: 70 passed (file tier policy, CAS safe save, dirty state)
9. `test-phase-10-diff-merge-blame.sh`: 77 passed (LCS diff, 3-way merge, blame LRU cache)
10. `test-phase-11-encrypted-transfers-media.sh`: 84 passed (OPAQUE bridge, encrypted transfers)
11. `test-phase-12-git-history.sh`: 139 passed (commit details, CAS rewrite, leased publish)
12. `test-phase-13-workflow-plans.sh`: 100 passed (workflow DTOs, project plans bounded reads)
13. `test-phase-14-agent-store-memory.sh`: 99 passed (agent store, templates, project memory)
14. `test-phase-15-host-resources-usage.sh`: 81 passed (metrics streaming, pairing, usage tracking)
15. `test-phase-16-ports-tunnels-host-controls.sh`: 194 passed (port/tunnel CRUD, idle consent, SSH)
16. `test-phase-17-preferences-privacy-lifecycle.sh`: 104 passed (preference clamping, 1 MiB TOML guard, privacy input-blockers, notification sink redaction, lifecycle coordination)

---

## Critical Fixes Verification & Input Isolation

- **Editor Surface Input Gating (`AndroidEditorSurface.kt`)**:
  - `isInputAllowed: () -> Boolean` hook integrated into interface and implementation.
  - Checked at entrance of `setText(text, modelVersion)`, `applyEdit(edit)`, `undo()`, and `redo()`.
  - Blocks content modification whenever `PrivacyController.isMaskActive` is true.
- **Terminal Input Gating (`TerminalInputController.kt`)**:
  - `sessionController.isInputAllowed()` evaluated before forwarding input.
  - Intercepts `onHardwareKey`, `onImeCommitText`, `onImeDeleteBackward`, and `pasteFromClipboard`.
  - Rejects keystrokes, IME commits, and clipboard paste while privacy mask active.
- **Workbench UI Integration (`WorkbenchScreen.kt`)**:
  - Privacy mask activation triggers `keyboardController?.hide()` and `focusManager.clearFocus(force = true)` via `LaunchedEffect(isMaskActive)`.
  - Prevents stale IME soft keyboard or active cursor from accepting phantom touches.
  - Wires `lifecycleCoordinator.onProfileRetired(id)` and `settingsRepository.onProfileRemoved(id)` during profile deletion.

---

## Unit Test Coverage Breakdown

### Phase 17 Shared Tests (`dev/damhopper/nativeapp/`):
- `PrivacyControllerTest` (8 tests):
  - Inactive on initialization.
  - Activation freezes chord and blocks input.
  - Exact dismissal chord matching vs invalid chord rejection.
  - Emergency triple-tap touch dismissal within 800ms.
  - Trailing release consumption preventing stuck modifiers.
  - Lifecycle reset clearing mask state.
  - Terminal input isolation under privacy mask (`TerminalSessionController`).
  - Editor input isolation under privacy mask (`EditorSession`).
- `SettingsRepositoryTest` (6 tests):
  - Bounds clamping for tab size (2..8), line height (1.0..2.5), scrollback (1,000..100,000).
  - Target source independence (`LOCAL_DEVICE`, `GLOBAL_REMOTE`, `WORKSPACE_REMOTE`).
  - Source switching lifecycle.
  - 1 MiB boundary enforcement on TOML config import (`MAX_CONFIG_IMPORT_BYTES = 1_048_576L`).
  - Reactive `Flow` update on preference changes.
  - Profile removal cleanup without memory leak.
- `LifecycleCoordinatorTest` (3 tests):
  - State transitions (`FOREGROUND`, `BACKGROUND_RETAINED`, `PROCESS_RECREATION`).
  - Listener unregistration.
  - Exception isolation during listener callbacks.
- `NotificationSinkTest` (3 tests):
  - 4 notification channels configured (`TERMINAL_ATTENTION`, `TRANSFERS`, `SESSION_ALERTS`, `SYSTEM_HEALTH`).
  - Public notification redaction for private payloads.
  - Cancellation of profile-scoped notifications on profile retirement.

### Phase 17 AndroidApp Tests:
- `SettingsPreferencesPhase17Test` (8 tests per debug/release variant = 16 executions):
  - Authoritative panel registration for `SETTINGS`.
  - Zero `FloatingActionButton` / `ExtendedFloatingActionButton` in settings & privacy UI.
  - Zero `WebView` or browser engine components in settings & privacy UI.
  - Ephemeral memory-backed Cognito state.
  - Lifecycle state transitions.
  - Notification channels and deep-link intent keys (`EXTRA_TARGET_PROFILE_ID`, `EXTRA_TARGET_GENERATION`).
  - SharedPreferences key namespace validation.
  - 1 MiB import ceiling constant validation.

---

## Rust Crypto Bridge (`damhopper_crypto_bridge`)
- Command: `cargo test` in `native-app/crypto-bridge`
- Results: 7 passed, 0 failed, 0 ignored in 0.15s:
  - `test_ciphertext_tamper_rejection`
  - `test_handle_store_lifecycle_and_double_close`
  - `test_envelope_roundtrip_and_tamper_rejection`
  - `test_envelope_metadata_max_and_separator_enforcement`
  - `test_malformed_message_handling`
  - `test_wrong_password_rejection`
  - `test_full_opaque_handshake_with_server_parity`

---

## Build Status
- **Android assembleDebug**: `BUILD SUCCESSFUL in 19s` (55 actionable tasks executed).
- Zero compilation errors.
- Clean DEX compilation and packaging.

---

## Critical Issues
- None blocking automated test execution or debug APK assembly.

---

## Pending Physical Device Qualification (Phase 18 Gate)
The following runtime capabilities are verified at contract/mock level in unit tests and require physical device qualification under Phase 18:
1. Live AndroidView/Termux-view and Sora Editor input freeze during physical touch/hardware keyboard interactions.
2. OS-level notification manager delivery, user permission request dialogs (API 33+ POST_NOTIFICATIONS), and notification action clicks.
3. Lock screen notification redaction fidelity across vendor-specific Android distributions.
4. Real Android Storage Access Framework (SAF) document picker integration for TOML config import/export.
5. OS-initiated background process death and subsequent activity recreation with live WebSocket reconnect.

---

## Recommendations
1. Include all untracked Phase 17 files in the final git staging prior to Phase 18 hand-off.
2. In Phase 18 qualification, execute explicit automated UI tests (Espresso/Robolectric or device runner) testing IME composition state during Cognito mask toggle.

---

## Unresolved Questions
- None blocking test execution or verification hand-off.
