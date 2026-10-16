# QA Test & Qualification Report: Phase 18 — Integrated Device Security and Performance Qualification

Date: 2026-10-17  
Working Tree: `dam-hopper-android-native-app`  
Scope: Automated test suite verification for Phase 18 (Integrated device security and performance qualification, GATE-C).  
Disposition: **Host regression baseline PASSED; integrated device, security, and performance qualification remains OPEN (BLOCKED_PENDING_DEVICE)**.

---

## 1. Executive Summary

All automated host-side validation suites executed cleanly with a 100% pass rate:
- **Rust Native Tests (`cargo test`)**: 7/7 passed in 0.15s.
- **Gradle Unit Tests**: 474 total executions (392 unique unit tests across 57 shared classes and 17 Android classes) passed with 0 failures and 0 skips.
- **Android APK Assembly**: `:androidApp:assembleDebug` completed 55/55 actionable tasks in 17s.
- **Static Invariant Shell Suites**: 1,430/1,430 assertions passed across all 17 phase scripts (`tests/test-phase-02` through `test-phase-18`).
- **Security Audit Tool (`audit-apk-security.sh`)**: Script exited 0 with 11 reported passes; manifest, permissions, TLS, and secret leak checks verified. Static ABI/16 KiB alignment output remains unverified qualification evidence.
- **Device Journey Tool (`run-device-journeys.sh`)**: Exited cleanly with exit code 2 and honest status `BLOCKED_PENDING_DEVICE` (headless CI environment lacking Android platform-tools/ADB).

---

## 2. Test Execution & Results Overview

| Suite / Target | Suite Type | Total Executions | Unique Tests | Passed | Failed | Skipped | Wall Time | Status |
|---|---|---|---|---|---|---|---|---|
| `crypto-bridge` (`cargo test`) | Native Rust unit tests | 7 | 7 | 7 | 0 | 0 | 0.15s | PASSED |
| `:shared:jvmTest` | Multiplatform JVM tests | 310 | 310 | 310 | 0 | 0 | 22.4s | PASSED |
| `:androidApp:testDebugUnitTest` | Android debug unit tests | 82 | 82 | 82 | 0 | 0 | 16.3s | PASSED |
| `:androidApp:testReleaseUnitTest` | Android release unit tests | 82 | (release variant) | 82 | 0 | 0 | 15.6s | PASSED |
| **Subtotal (Unit Tests)** | **Unit & Contract Suites** | **481** | **399** | **481** | **0** | **0** | **54.5s** | **PASSED** |
| `:androidApp:assembleDebug` | Debug APK assembly | 55 tasks | 55 tasks | 55 | 0 | 0 | 17.5s | PASSED |
| `audit-apk-security.sh` | Manifest/TLS/Secret audit | 11 checks | 11 checks | 11 | 0 | 0 | 0.35s | PASSED* |
| `run-device-journeys.sh` | Device journey runner | 1 invocation | 1 invocation | 0 | 0 | 1 | 0.02s | BLOCKED (Exit 2) |
| Invariant scripts (`tests/*.sh`) | Static structural assertions | 1,430 | 1,430 | 1,430 | 0 | 0 | 2.65s | PASSED |

*\*Note on `audit-apk-security.sh`: Manifest security, backup exclusion, network TLS policies, and secret scan verified. ABI/16 KiB alignment check scanned host cargo target outputs rather than unpacked APK libraries; alignment qualification remains unverified.*

---

## 3. Detailed Suite Breakdown

### 3.1 Rust Crypto Bridge (`native-app/crypto-bridge`)
Command: `cargo test`  
Result: 7 passed; 0 failed; 0 ignored; finished in 0.15s.  
Verified tests:
- `tests::test_ciphertext_tamper_rejection`: AES-256-GCM ciphertext tampering fails closed.
- `tests::test_handle_store_lifecycle_and_double_close`: Atomic handle cleanup and safe double-close.
- `tests::test_envelope_roundtrip_and_tamper_rejection`: Full encrypt/decrypt roundtrip with header validation.
- `tests::test_envelope_metadata_max_and_separator_enforcement`: 64 KiB metadata limit and delimiter enforcement.
- `tests::test_malformed_message_handling`: Rejection of corrupted OPAQUE messages.
- `tests::test_wrong_password_rejection`: Rejection of invalid credentials during OPAQUE login.
- `tests::test_full_opaque_handshake_with_server_parity`: Ristretto255 OPAQUE PAKE registration and login handshake matching server cipher suite.

### 3.2 Shared Kotlin Multiplatform JVM Tests (`:shared:jvmTest`)
Command: `./gradlew :shared:jvmTest --rerun-tasks`  
Result: 310 passed across 57 test classes; 0 failed; 0 skipped; execution time 22.4s.  
New Phase 18 Suite (`OwnershipAndReplayTests.kt` — 8 tests):
- `testMultiServerProfileIsolationAndWatermarkRejection`: Multi-server profile isolation and stale generation watermark rejection.
- `testTerminalReplayGateUtf8SplittingAcrossChunkBoundaries`: Multi-byte UTF-8 character splitting preserved across chunk boundaries without corruption.
- `testTerminalReplayGateOrderingDuplicateAndOverlapSlicing`: Monotonic sequence ordering, duplicate chunk discard, and overlap slicing in replay gate.
- `testResourceStreamCoordinatorCleanEofHandling`: Graceful SSE stream completion on clean EOF.
- `testHostResourceRestFallbackIntervalAlignedToFiveSeconds`: Demand-driven REST fallback polling exactly aligned to 5s.
- `testUsageBoundsHelperUtcIntervalCalculationsAndFormatting`: UTC midnight date interval calculations, readable UTC date formatting, and completed-days labeling.
- `testCryptoEnvelopeTamperRejectionFailsClosed`: Envelopes with tampered payload or metadata fail closed.
- `testLifecycleCoordinatorStateTransitionsAndRetirement`: State transitions (`FOREGROUND` -> `BACKGROUND` -> `DESTROYED`) and listener unregistration on profile retirement.

### 3.3 Android Unit Tests (`:androidApp:testDebugUnitTest` & `testReleaseUnitTest`)
Commands:
- `./gradlew :androidApp:testDebugUnitTest --rerun-tasks` (82 passed across 17 test classes in 16.3s)
- `./gradlew :androidApp:testReleaseUnitTest --rerun-tasks` (82 passed across 17 test classes in 15.6s)  
New Phase 18 Suite (`WorkbenchJourneysUnitTest.kt` — 6 tests):
- `testCompleteTwelvePanelNavigationJourney`: Sequential navigation through all 12 panels (`TERMINAL`, `FILES`, `EDITOR`, `DIFF`, `MERGE`, `GIT`, `WORKFLOW`, `AGENTS`, `RESOURCES`, `PORTS`, `SSH_HOST`, `SETTINGS`) preserving single content area.
- `testSolitaryTopNavigationRowInvariants`: Exactly one top icon + short text row; no secondary navigation dock or bottom navigation rail.
- `testZeroFloatingActionButtonsAcrossEntireRepository`: Zero `FloatingActionButton` or `ExtendedFloatingActionButton` across entire project.
- `testZeroWebViewsAcrossEntireApplication`: Zero `WebView` references in production source trees.
- `testCognitoPrivacyOverlayInputGatingAndDismissal`: Keyboard chord activation, input event gating on masked surfaces, and emergency triple-tap dismissal.
- `testNavigationStackHierarchicalUnwinding`: Back-stack precedence unwinding to TERMINAL root without navigation leaks.

### 3.4 Build Verification (`:androidApp:assembleDebug`)
Command: `./gradlew :androidApp:assembleDebug --rerun-tasks`  
Result: 55/55 actionable tasks executed successfully in 17.5s.  
Artifact produced: `native-app/androidApp/build/outputs/apk/debug/androidApp-debug.apk`.

---

## 4. Audit & Journey Script Results

### 4.1 APK Security Audit (`audit-apk-security.sh`)
Command: `./native-app/scripts/audit-apk-security.sh`  
Exit Code: 0 (11 checks passed).  
Verified Findings:
- **Manifest Backup Security**: `android:allowBackup="false"` and `android:fullBackupContent="false"` explicitly configured in `AndroidManifest.xml`.
- **IME Window Behavior**: `android:windowSoftInputMode="adjustResize"` declared on `MainActivity` ensuring single top panel navigation row remains visible when software keyboard is deployed.
- **Permissions Policy**: Declares required `android.permission.INTERNET` and `android.permission.POST_NOTIFICATIONS` (API 33+).
- **Data Extraction Rules**: `data_extraction_rules.xml` present and excludes root, file, database, sharedpref, and external storage from cloud-backup and device-transfer.
- **Network Security Configuration**:
  - Release config (`network_security_config.xml`): Strictly prohibits cleartext traffic (`cleartextTrafficPermitted="false"`) across all domains.
  - Debug config (`network_security_config_debug.xml`): Permits cleartext traffic strictly on development loopback (`10.0.2.2`, `127.0.0.1`, `localhost`).
- **Secret Leak Scan**: Scanned source trees and resources; zero unredacted private keys, passwords, or embedded tokens detected.
- **Critical QA Audit Observation**: Section 4 ABI/16 KiB alignment output is not credible qualification evidence. The script reported `0x0000000000000000` alignment and scanned cargo host target directories (picking up host proc-macros like `libserde_derive...so`) rather than cross-compiled Android NDK binaries inside the APK. True 16 KiB ELF alignment and execution remain UNVERIFIED pending physical device/emulator testing.

### 4.2 Device Journey Runner (`run-device-journeys.sh`)
Command: `./native-app/scripts/run-device-journeys.sh`  
Exit Code: 2 (`BLOCKED_PENDING_DEVICE`).  
Output:
```
=== DamHopper Phase 18 Device Journey Runner ===
Working directory: /home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app
[BLOCKED] ADB command not found in PATH.
Physical hardware or emulator qualification requires Android SDK platform-tools.
GATE-C device journeys status: BLOCKED_PENDING_DEVICE
```
Status: Device journey execution cleanly and honestly blocked. No synthetic pass was fabricated.

---

## 5. Summary of Verified Invariant Suites (Phases 02–18)

All 17 invariant test scripts in `./tests/` were executed directly and verified at 100% pass rate:

| Phase Suite Script | Focus / Contract Area | Assertions Passed | Assertions Failed | Exit Code | Elapsed | Status |
|---|---|---|---|---|---|---|
| `test-phase-02-foundation.sh` | Toolchain pins, Gradle KMP architecture, manifest, 0 WebViews | 47 | 0 | 0 | 1.22s | PASSED |
| `test-phase-03-transport.sh` | Owner-bound transport, ConnectionRef, serial WS writer | 48 | 0 | 0 | 0.07s | PASSED |
| `test-phase-04-profiles-auth.sh` | Multi-server profiles, Keystore vault, attempt tracker | 57 | 0 | 0 | 0.08s | PASSED |
| `test-phase-05-proof-gates.sh` | Terminal/Editor candidate pins, OPAQUE crypto bridge | 66 | 0 | 0 | 0.09s | PASSED |
| `test-phase-06-shell-workspace.sh` | TERMINAL/Traditional shell, 12-panel row, 0 FABs | 64 | 0 | 0 | 0.07s | PASSED |
| `test-phase-07-terminal-agents.sh` | Terminal session CRUD, replay gate, agent status reducer | 45 | 0 | 0 | 0.07s | PASSED |
| `test-phase-08-filesystem-watchers.sh` | File tree state, watcher subscriptions, CAS replace | 57 | 0 | 0 | 0.08s | PASSED |
| `test-phase-09-editor-saves.sh` | 3-tier file size policy, safe-save coordinator, multi-tab | 70 | 0 | 0 | 0.09s | PASSED |
| `test-phase-10-diff-merge-blame.sh` | LCS diff, 3-way merge editor, debounced git blame LRU | 77 | 0 | 0 | 0.09s | PASSED |
| `test-phase-11-encrypted-transfers-media.sh` | OPAQUE file transfers, media streaming, SAF interface | 84 | 0 | 0 | 0.10s | PASSED |
| `test-phase-12-git-history.sh` | Git safe history, branch/worktree, leased publication | 139 | 0 | 0 | 0.13s | PASSED |
| `test-phase-13-workflow-plans.sh` | Workflow CRUD, plan folder browser, 64 KiB read cap | 100 | 0 | 0 | 0.11s | PASSED |
| `test-phase-14-agent-store-memory.sh` | Agent store catalog, memory templates, scan imports | 99 | 0 | 0 | 0.11s | PASSED |
| `test-phase-15-host-resources-usage.sh` | Host resources SSE, usage analytics, UTC range dialogs | 81 | 0 | 0 | 0.09s | PASSED |
| `test-phase-16-ports-tunnels-host-controls.sh` | Ports, Cloudflared tunnels, sleep consent, SSH keys | 194 | 0 | 0 | 0.36s | PASSED |
| `test-phase-17-preferences-privacy-lifecycle.sh` | Cognito mask, multi-source preferences, notifications | 104 | 0 | 0 | 0.16s | PASSED |
| `test-phase-18-device-qualification.sh` | Core journeys, security tooling, Phase 15-17 remediations | 98 | 0 | 0 | 0.12s | PASSED |
| **TOTAL** | **Comprehensive Regression Invariants** | **1,430** | **0** | **0** | **3.10s** | **100% PASSED** |

### Phase 18 Invariant Suite Details (`test-phase-18-device-qualification.sh`)
- **Suite 1: Core Qualification Suites & Journeys (22 assertions)**: Verifies presence of `OwnershipAndReplayTests.kt`, `WorkbenchJourneysUnitTest.kt`, and `WorkbenchJourneys.kt` instrumentation tests.
- **Suite 2: Automation & Security Tooling (16 assertions)**: Verifies `run-device-journeys.sh` and `audit-apk-security.sh` scripts, permissions, backup flags, and secret leak scanning.
- **Suite 3: Cross-Phase Residual Remediations (27 assertions)**:
  - Clean EOF handling and 5s REST fallback in `ResourceStreamCoordinator` / `HostResourceController`.
  - Dynamic model filter derivation and retention controls in `UsageScreens` / `UsageSettingsSection`.
  - Formatted UTC dates in `UsageDialogs`.
  - Action error preservation on refresh in `IdleConsentController`.
  - SSH credential forget failure validation in `SshRepository`.
  - Theme switching and font size wiring into `TerminalPanelScreen` and `EditorPanelScreen`.
- **Suite 4: Acceptance Ledger Updates (4 assertions)**: Verifies acceptance ledger records for Phase 17 and Phase 18.
- **Suite 5: Strict UI Invariants in Phase 18 Files (29 assertions)**: Zero `FloatingActionButton`, zero `ExtendedFloatingActionButton`, zero `WebView` across all 10 production files touched in Phase 18.

---

## 6. Status of GATE-C Qualification & Open Limitations

### 6.1 GATE-C Disposition
**QUALIFICATION TOOLING & SUITES DELIVERED (Device Signoff Pending)**.

Automated host regression tests and contract assertions are 100% verified. Full physical qualification cannot be claimed from host CI alone:

### 6.2 Open Device Limitations
1. **Physical ARM64 Device Execution**: Requires connected physical hardware via USB with Android SDK platform-tools (`adb`) to execute `run-device-journeys.sh` and verify live JNI bindings on actual hardware.
2. **16 KiB Kernel Page Size Runtime Proof**: Static alignment output in `audit-apk-security.sh` scanned host target directories; actual execution under 16 KiB page size kernel requires a physical 16 KiB device or Android 15 emulator with 16 KiB pages enabled.
3. **IME & Visual Window Invariants**: `windowSoftInputMode="adjustResize"` and single top panel row visibility under hardware keyboard / IME must be visually inspected and signed off by human review on device.
4. **Deferred Network Fault Injection**: Live WebSocket reconnect status reconciliation, physical proxy buffering, and server admission limit denial under network delay/packet loss remain open for physical testbed validation.

---

## 7. Recommendations & Next Steps

1. **Refactor `audit-apk-security.sh` Section 4**: Update native library inspection to extract `.so` files directly from the packaged `androidApp-debug.apk` (`unzip -p ... lib/arm64-v8a/*.so`) rather than searching `crypto-bridge/target` on the host, and parse `readelf -lW` `LOAD` headers accurately.
2. **Provision Physical Device Testbed**: Connect an ARM64 Android device (or launch Android 15 16 KiB emulator) with `adb` installed in PATH to run `run-device-journeys.sh` and complete on-device instrumentation tests (`connectedDebugAndroidTest`).
3. **Capture Human Visual Evidence**: Record redacted full-app screenshots of top navigation row behavior with software keyboard open across phone and tablet form factors before proceeding to Phase 19 (Signed APK Release).

---

## 8. Unresolved Questions

- None blocking automated host verification. Physical device execution and visual signoff are scheduled for physical testbed deployment.
