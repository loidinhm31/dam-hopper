---
title: "Android-first native workbench in native-app"
description: "Build a native Android TERMINAL/Traditional workbench with one panel-navigation row, no floating buttons, and explicit HTML/Mermaid preview exceptions."
status: in-progress
priority: P2
effort: unestimated
branch: feat/android-native-app
tags: [feature, frontend, android, kotlin, compose, auth]
created: 2026-10-15
---

# Android Native App — Implementation Plan

**Implementation in progress; Phase 01 baseline frozen and Phase 02 foundation verified.** Root: `native-app/`; Kotlin/Compose shared state + native Android widgets. Remote existing Rust server. Android10+/minSdk29, ARM64 device+x86_64 emulator, signed private APK. No Tauri/WebView/browser engine or local PTY/Git/agents.

User approved all current non-browser workbench families. Embedded interactive HTML and rendered Mermaid browser previews alone are deferred for this release; remaining editor/language/diff/merge/blame/encrypted-save parity stays mandatory. Desktop implementation/Play/browser debug/local SSH forwarding are excluded; existing web/Tauri hosts remain.

**Workspace restriction:** TERMINAL mode + Traditional terminal only; no IDE/Runtime mode or mode switchers. All included panels use one horizontally scrollable, single-line button row; no floating buttons/FABs or second navigation surface.

## Workspace and handoff

- Worktree: `/home/loidinh/WS/worktrees/dam-hopper-android-native-app`; branch above. Base: `d897a91f76a07ec819a50ffc2756cb69327b2fe3` (server0.13.2/protocol2 baseline). Original checkout changes untouched.
- [User decisions](./research/decision-context.md) · [proposed architecture](../../docs/architecture/android-native-client.md) · [scope/acceptance ledger](./scope-and-acceptance.md).
- [Contracts/modules](./contracts-and-modules.md) · [execution guide and dependency graph](./execution-guide.md) · [Android research](./research/android-platform-research.md) · [extended contracts](./research/extended-workbench-contracts.md).
- Phase 01 completed 2026-10-15 19:51:53 +07:00; Phase 02 completed 2026-10-15 20:38:00 +07:00; Phase 03 completed 2026-10-15 21:44:52 +07:00; Phase 04 completed 2026-10-15 22:45:00 +07:00; Phase 05 prototype-verified 2026-10-15 23:35:00 +07:00; Phase 06 completed 2026-10-16 00:50:00 +07:00; Phase 07 completed 2026-10-16 02:20:00 +07:00; Phase 08 completed 2026-10-16 (Cycle 2 user approved 6/10 with documented open limitations); Phase 09 completed 2026-10-16 07:24:21 +07:00 (user approved with documented open limitations); Phase 10 completed 2026-10-16 09:48:17 +07:00 (user approved score 9/10, all 246 unit tests and 531 assertions passed); Phase 11 completed 2026-10-16 (user approved Cycle 2 review, 282 automated test executions, 615 static assertions, clean assembleDebug APK); Phase 12 and Phase 17 unblocked. Native dependency/editor-service/crypto gates precede dependent implementation. Pass this explicit plan path to later agents; active-plan helper could not persist without EVCRATE_SESSION_ID.

## Phases

| # | Phase | Status | Progress | Depends on |
| --- | --- | --- | --- | --- |
| 01 | [Scope baseline and contract freeze](./phase-01-scope-baseline-and-contract-freeze.md) | completed (2026-10-15 19:51 +07:00) | 100% | — |
| 02 | [Gradle KMP Android foundation](./phase-02-gradle-kmp-android-foundation.md) | completed (2026-10-15 20:38 +07:00) | 100% | 01 |
| 03 | [Contracts ownership and live transport](./phase-03-contracts-ownership-and-live-transport.md) | completed (2026-10-15 21:44:52 +07:00) | 100% | 02 |
| 04 | [Profiles authentication MFA and credential vault](./phase-04-profiles-auth-mfa-and-credential-vault.md) | completed (2026-10-15 22:45:00 +07:00) | 100% | 03 |
| 05 | [Native terminal editor and crypto proof gates](./phase-05-native-terminal-editor-and-crypto-proof-gates.md) | completed (prototype-verified 2026-10-15 23:35:00 +07:00) | 100% prototype/contracts (runtime qualification open under Phase 18) | 04 |
| 06 | [TERMINAL Traditional shell projects and configuration](./phase-06-adaptive-shell-projects-worktrees-and-config.md) | completed (2026-10-16 00:50:00 +07:00) | 100% | 04 |
| 07 | [Terminal sessions replay input and agents](./phase-07-terminal-sessions-replay-input-and-agents.md) | completed (2026-10-16 02:20:00 +07:00) | 100% | 05, 06 |
| 08 | [Filesystem watchers search and replace](./phase-08-filesystem-watchers-search-and-replace.md) | completed (2026-10-16) | 100% | 06 |
| 09 | [Native editor language services and safe saves](./phase-09-native-editor-language-services-and-safe-saves.md) | completed (2026-10-16 07:24:21 +07:00) | 100% | 05, 08 |
| 10 | [Native diff merge and blame](./phase-10-native-diff-merge-and-blame.md) | completed (2026-10-16 09:48:17 +07:00) | 100% | 09 |
| 11 | [Encrypted transfers media and Android storage](./phase-11-encrypted-transfers-media-and-storage.md) | completed (2026-10-16) | 100% | 05, 09 |
| 12 | [Complete Git and safe history workflows](./phase-12-complete-git-and-safe-history-workflows.md) | pending | 0% | 06, 10 |
| 13 | [Workflow tracking and project plans](./phase-13-workflow-tracking-and-project-plans.md) | pending | 0% | 07, 09 |
| 14 | [Agent Store imports and memory](./phase-14-agent-store-imports-and-memory.md) | pending | 0% | 09 |
| 15 | [Host resources fleet and usage](./phase-15-host-resources-fleet-and-usage.md) | pending | 0% | 06 |
| 16 | [Ports tunnels idle consent and host controls](./phase-16-ports-tunnels-idle-consent-and-host-controls.md) | pending | 0% | 06 |
| 17 | [Preferences privacy notifications and lifecycle](./phase-17-preferences-privacy-notifications-and-lifecycle.md) | pending | 0% | 07, 11, 13, 14, 15, 16 |
| 18 | [Integrated device security and performance qualification](./phase-18-integrated-device-security-and-performance-qualification.md) | pending | 0% | 12, 17 |
| 19 | [Signed APK release and operational handoff](./phase-19-signed-apk-release-and-operational-handoff.md) | pending | 0% | 18 |

## Release gates

- **A /01–02:** complete source/behavior/device/server ledger and reproducible compatible toolchain/app launch.
- **B /05:** actual native terminal/IME/replay, retained editor/language-service path and exact OPAQUE ABI/interop proof. No fake fallback or silent parity reduction.
- **C /18:** every included ledger row passes real authenticated-server/native-device acceptance, security/ABI/performance and human visual review.
- **D /19:** signed release install/upgrade, licenses/provenance/docs and unchanged existing-product safety gates.

## Unresolved decisions and stop rules

Exact dependency pins/licenses, native JSON/TS realization, crypto ABI proof and named-hardware budgets are Phase01–05 deliverables, not presumed facts. Failed retained requirements block dependents/release until design resolution or explicit user scope change. No new server LSP/render service/updater/privileged executor assumed. Future browser-preview parity and Linux/Windows releases need separate decisions.

## Validation Summary

**Validated:** 2026-10-15. **Questions asked:** 4. [Binding answers](./validation-answers.md).
- TERMINAL + Traditional only; one panel-navigation row; no floating buttons or alternative modes.
- Row docked at top below server/project header; icon + short text buttons; horizontal scrolling, no wrapping/More menu.
- Row stays visible while software keyboard is open.
- One content area on phones, tablets and foldables; selected panel replaces terminal visually while controllers/sessions stay alive. No wide-screen terminal/panel docking.
- [x] Record scope restriction and presentation decisions in plan/design/acceptance artifacts.
- [ ] Resolve Phase01–05 dependency/language-service/crypto/device gates before dependent implementation (Phase 01 baseline frozen; Phase 02 foundation verified; Phase 03 contracts & transport verified; Phase 04 profiles, auth & vault verified; Phase 05 prototype & crypto gates verified; Phase 06 implementation verified; Phase 07 host contracts & remediations verified 2026-10-16; Phase 08 filesystem watchers and search/replace verified and user-approved 2026-10-16; Phase 09 native editor language services and safe saves verified and user-approved 2026-10-16 07:24:21 +07:00; Phase 10 native diff merge and blame verified and completed 2026-10-16 09:48:17 +07:00 [user approved score 9/10, 246 unit tests and 531 assertions passed]; Phase 11 completed 2026-10-16 [user approved Cycle 2 review, 282 automated test executions, 615 static assertions, clean assembleDebug APK]; Phase 12 and Phase 17 unblocked; GATE-A dynamic device launch, GATE-B hardware/LSP qualification, Phase 06 physical IME/device acceptance, Phase 07 physical terminal rendering/device acceptance, and Phase 11 device/live server qualification pending Phase 18).

## Phase 01 Completion Record

- **Completed:** 2026-10-15 19:51:53 +07:00
- **Status:** 100% complete
- **Validation:** User-approved review score 9.5/10; 4/4 test suites passed per assignment record. Documentation baseline and contract freeze completed; no native runtime qualification claimed.
- **Deliverables:** Baseline documentation and contract freeze recorded in `docs/android-native-acceptance.md`, `native-app/README.md`, and `docs/system-architecture.md`.
- **Handoff:** Phase 01 scope baseline and contract freeze complete. Phase 02 (Gradle KMP Android foundation) was handed off and completed.

## Phase 02 Completion Record

- **Completed:** 2026-10-15 20:38:00 +07:00
- **Status:** 100% complete
- **Validation:** Reviewed & verified (Cycle 2 remediations verified, score: 9.2/10). All automated test suites passed: 9/9 unit tests (5 in `:shared:jvmTest`, 4 in `:androidApp:testDebugUnitTest`), 4/4 `:androidApp:testReleaseUnitTest`, and 41/41 static assertion checks in `tests/test-phase-02-foundation.sh`. Debug APK builds cleanly (`assembleDebug`, minSdk 29, compileSdk 35, ABI `arm64-v8a` + `x86_64`), release manifest verified (`processReleaseManifest`).
- **Deliverables:**
  - Pinned Gradle KMP two-module project (`:shared` multiplatform targeting Android + JVM 17; `:androidApp` application module).
  - Pinned toolchain versions: Gradle 8.11.1 wrapper with SHA-256 verification, AGP 8.7.3, Kotlin 2.1.10, Jetpack Compose Multiplatform 1.7.3, Ktor 3.1.0, Coroutines 1.10.1.
  - Network security policy: Release traffic strictly TLS-only (`cleartextTrafficPermitted="false"` across all domains); local development cleartext loopback (`10.0.2.2`, `127.0.0.1`, `localhost`) isolated strictly to `src/debug/res/xml/network_security_config.xml`.
  - Android manifest and backup security: `allowBackup="false"`, `fullBackupContent="false"`, `dataExtractionRules` excluding cloud-backup and device-transfer paths, `windowSoftInputMode="adjustResize"`.
  - UI & Presentation invariants: Material 3 dark workbench theme, single top horizontal panel-navigation row, zero FABs, 12 authoritative panels (`terminal`, `files`, `editor`, `diff`, `merge`, `git`, `workflow`, `agents`, `resources`, `ports`, `ssh_host`, `settings`), zero WebView / zero browser engine dependencies.
  - Top-level `package.json` lifecycle scripts: `native-app:test`, `native-app:test:android`, `native-app:assembleDebug`, while preserving existing `android:*` scripts.
- **Handoff:** Phase 02 foundation verified and closed. Phase 03 (Contracts ownership and live transport) is unblocked. (Note: physical/emulator runtime launch evidence for GATE-A device signoff remains open pending test device attachment).

## Phase 03 Completion Record

- **Completed:** 2026-10-15 21:44:52 +07:00
- **Status:** 100% complete
- **Validation:** Review score 8.8/10 per `plans/reports/code-review-261015-2200-phase-03-remediation-cycle-2.md`; socket fencing fixes reported implemented by Main. 100% automated test pass rate across 38/38 unit tests (30 in `:shared:jvmTest`, 4 in `:androidApp:testDebugUnitTest`, 4 in `:androidApp:testReleaseUnitTest`) and 95 static assertions (48 Phase 03 shell assertions in `tests/test-phase-03-transport.sh`, 47 Phase 02 foundation regression checks in `tests/test-phase-02-foundation.sh`). `assembleDebug` builds cleanly (106 actionable tasks verified up-to-date).
- **Deliverables:**
  - Generation-fenced `ConnectionRef` & `ConnectionRegistry` with monotonic watermark ABA protection across profile deletion/re-creation and lifecycle retirement listeners.
  - Polymorphic `WireMessages` (`ServerMsg` / `ClientMsg`) with `kind` discriminator, resilient fallback handling (`ServerMsg.Unknown`), snake_case field mapping, unsigned 64-bit integer bounds, and profile ID wire stripping (`ProjectTargetRef`).
  - Robust `ApiClient` with Ktor HTTP engine, structured concurrency preservation (`CancellationException` propagation), `ApiRequestError` handling, `Retry-After` header parsing, and strict regex redaction of tokens and passwords across `https?` and `wss?` schemes.
  - `WsConnection` with origin-less query-token handshake (`/ws?token=`), close code mapping (`4403`, `4401`, `1013`, `4001`), clean cancellation handling on disconnect, and exact-socket `host:uiConnection` receipt tracking.
  - Socket Fencing and Teardown Hardening in `WsConnection.kt`:
    1. Post-handshake assertion: `registry?.assertCurrentOwner(connection, "WsConnection.connect post-handshake")` called before session activation, immediately closing session if retired during handshake.
    2. `SocketInstanceRef` fencing: `activeSocketRef` checked in `handleCloseReason(reason, socketRef)` and `handleSocketFailure(t, socketRef)` ensuring stale socket callbacks cannot tear down new sessions.
    3. `CancellationException` cleanly rethrown in `connect()` catch block preserving structured concurrency.
  - `SerializedWsWriter` with atomic Mutex-guarded JSON-header/binary frames and `PROTOCOL_ERROR` abort on partial send failure.
  - `WsRequestCorrelator` with timeout unregistration and bounded capacity (max 256 in-flight requests).
  - `HostResourceSseClient` with 256 KiB data cap, 4 KiB status cap, and strict status-data adjacency pairing reset on SSE comments.
  - `AndroidHttpClientFactory` / `PlatformHttpEngine.android.kt` with pinned OkHttp timeouts and explicitly disabled HTTP/SSL redirects (`followRedirects(false)`, `followSslRedirects(false)`).
- **Handoff:** Phase 03 contracts ownership and live transport verified and closed. Phase 04 (Profiles authentication MFA and credential vault) is unblocked. (Note: Implementation reported complete by Main with 38 unit tests, 95 static assertions, and verified socket fencing in `WsConnection.kt`. Live-daemon lifecycle qualification and Android GATE-A device evidence remain tracked under open qualification gates; Phase 04 proceeds as an unblocked gate decision).

## Phase 04 Completion Record

- **Completed:** 2026-10-15 22:45:00 +07:00
- **Status:** 100% complete
- **Validation:** Review score 8.5/10 per `plans/reports/code-review-261015-2226-phase-04-profiles-auth.md`. Critical finding CRIT-1 addressed via `AndroidProfileMetadataStore` storing profile metadata in Android SharedPreferences (`damhopper_server_profiles`), with constant/serialization/source checks in `AndroidProfileMetadataStoreTest`. 100% automated test pass rate across 60 unique QA baseline unit tests (53 in `:shared:jvmTest`, 7 in `:androidApp:testDebugUnitTest`; 67 total executions including `:androidApp:testReleaseUnitTest`) and 149 static assertions (54 Phase 04 assertions in `tests/test-phase-04-profiles-auth.sh`, 48 Phase 03 assertions in `tests/test-phase-03-transport.sh`, 47 Phase 02 assertions in `tests/test-phase-02-foundation.sh`; 216 total automated checks). `assembleDebug` builds cleanly (55 actionable tasks executed).
- **Deliverables:**
  - Multi-server profile lifecycle management via `ProfileRepository`, `ServerProfile`, `ProfileMetadataStore`, and `AndroidProfileMetadataStore` persisting profiles across app restarts.
  - Strict URL normalization and validation preventing authority credentials, query parameters, and fragments, with explicit debug loopback host recognition (`localhost`, `127.0.0.1`, `::1`, `10.0.2.2`).
  - Frozen protocol versioning (`authProtocol: 2`, `workbenchProtocol: 2`), standard `AuthErrorCodes` (`ACCOUNT_DISABLED`, `MFA_REQUIRED`, `INCOMPATIBLE_PROTOCOL`), and complete `[REDACTED]` string masking for secrets/tokens.
  - `AuthAttemptRef` and `AuthAttemptTracker` monotonic attempt fencing preventing late asynchronous HTTP/MFA callbacks from corrupting rotated or logged-out profile states.
  - Fail-closed `CredentialVault` interface, `InMemoryCredentialVault` (unit tests), and Android Keystore-backed `AndroidCredentialVault` utilizing `MasterKey` AES256-GCM and `EncryptedSharedPreferences`, with backup exclusions in `data_extraction_rules.xml`.
  - `AuthRepository`, `AuthWireDto`, `AuthResponseParser`, and `AuthStatusParser` implementing REST auth flows (`/api/auth/login`, `/api/auth/register`, `/api/auth/mfa/setup`, `/api/auth/mfa/confirm`, `/api/auth/status`, `/api/auth/logout`).
  - Multi-profile Compose UI integration: `WorkbenchScreen` (Settings panel integration), `ProfileListScreen`, `AddProfileCard`, tabbed `AuthDialog` with masked inputs (`PasswordVisualTransformation`) and operator approval notice, and `MfaChallengeContent` transient TOTP setup/verification with disclosure.
  - `MainActivity` wiring `AndroidCredentialVault`, `ConnectionRegistry`, `AndroidProfileMetadataStore`, and `ProfileRepository` with lifecycle-scoped initialization.
- **Handoff:** Phase 04 profiles, authentication, MFA, and credential vault implementation complete and automated checks passed. Phase 05 (Native terminal editor and crypto proof gates) and Phase 06 (TERMINAL Traditional shell projects and configuration) are unblocked. (Note: Device process-recreation persistence, live daemon qualification, and Android GATE-A device evidence remain tracked under open qualification gates and Phase 18).

## Phase 05 Completion Record

- **Completed:** 2026-10-15 23:35:00 +07:00
- **Status:** 100% prototype/contracts (with runtime qualification open under Phase 18)
- **Validation:** Review score 6.8/10 (conditional prototype verified per `plans/reports/code-review-261015-2314-phase-05-proof-gates.md`). Critical fail-open security vulnerability in `OpaqueClientBridge.kt` remediated during review to strictly fail closed (`OpaqueCryptoException`) when the native library is unavailable. 100% automated test pass rate across 336 executed checks: 5 Rust unit and parity tests in `native-app/crypto-bridge` (`cargo test`), 61 KMP shared JVM unit tests (`:shared:jvmTest`), 26 Android debug unit tests (`:androidApp:testDebugUnitTest`), 26 Android release unit tests (`:androidApp:testReleaseUnitTest`), and 218 static invariant assertions (66 Phase 05 proof-gates assertions in `tests/test-phase-05-proof-gates.sh`, 57 Phase 04 assertions, 48 Phase 03 assertions, 47 Phase 02 assertions). `assembleDebug` builds cleanly (65 actionable tasks executed).
- **Deliverables:**
  - Pinned candidate records and feasibility proof documented in `docs/android-native-dependency-decisions.md`: ConnectBot termlib 0.3.13 (`libvterm.so`, Apache-2.0), Sora Editor 0.23.4 (LGPL-2.1), offline JSON AST language service, and Rust OPAQUE cdylib bridge.
  - Native terminal surface contracts: `AndroidTerminalSurface` and `TerminalSessionController` with input isolation during replay, modifier key encoding (`Ctrl+C/D/Z`, navigation arrows, Enter, Tab, Backspace), buffer feeding, resize callbacks, search matching, and text selection.
  - Native editor surface contracts: `AndroidEditorSurface` and `EditorSession` with text edit modeling, snapshot undo/redo history, dirty state tracking, line geometry/metrics hooks, gutter decorations, read-only guard, and candidate adapter metadata.
  - Offline language service contracts: `LanguageService` and `JsonLanguageService` providing offline JSON AST diagnostics and symbol hierarchy without browser engine/WebView dependencies, coordinated via `LanguageServiceCoordinator` with generation/watermark response fencing preventing stale asynchronous completions.
  - TypeScript language service architectural blocker audit: `TypeScriptLanguageServiceAudit` formalizing hard blocker (`BLOCKED_PENDING_RUNTIME_DECISION`); remote Rust server lacks an LSP daemon and browser web-workers are prohibited; non-browser TS semantic analysis requires an embedded JS engine (QuickJS / Hermes) or server LSP decision.
  - OPAQUE cryptographic bridge: `native-app/crypto-bridge` Rust cdylib implementing `DamHopperOpaqueSuite` (Ristretto255, SHA-512, Scrypt) matching server 0.13.2, HKDF SHA-256 session key derivation with AES-256-GCM encryption/decryption, bounded monotonic handle store (`AtomicI64`, max capacity 64, zeroization on disposal), and Kotlin companion `OpaqueClientBridge` hardened to fail closed without plaintext/mock fallbacks.
  - Automated test harness: `LanguageServiceTest` (5 tests), `AndroidTerminalSurfaceTest` (6 tests), `AndroidEditorSurfaceTest` (6 tests), `OpaqueClientBridgeTest` (4 tests with HKDF golden vector), `native-app/crypto-bridge` tests (5 tests), and shell invariant test suite `tests/test-phase-05-proof-gates.sh` (66 assertions across 5 suites).
- **Handoff:** Phase 05 feasibility prototype and contracts verified. Phase 06 (TERMINAL Traditional shell projects and configuration) is unblocked and can proceed immediately. Downstream handoffs:
  - Phase 07 (Terminal sessions replay input and agents) inherits `ConnectBot termlib 0.3.13` candidate and `TerminalSessionController`; must qualify physical ARM64 rendering, 16 KiB page size execution, and bounded buffer management.
  - Phase 09 (Native editor language services and safe saves) inherits `Sora Editor 0.23.4` candidate and `JsonLanguageService`; must address the TypeScript LSP/runtime decision and Sora differential undo/relinking compliance.
  - Phase 11 (Encrypted transfers media and Android storage) inherits `OpaqueClientBridge` and `crypto-bridge`; must qualify Android NDK cross-compilation (`arm64-v8a`, `x86_64`) and 16 KiB ELF alignment on physical devices.

## Phase 06 Completion Record

- **Completed:** 2026-10-16 00:50:00 +07:00
- **Status:** 100% complete (runtime qualification deferred to Phase 18)
- **Validation:** Review score 9.4/10 per `plans/reports/code-review-261016-0041-phase-06-remediation-cycle-2.md` (Cycle 2 approved). All 3 critical integrity risks verified resolved: cross-project worktree contamination prevented via reactive target binding and cache flushing; unselectable/prunable worktrees disabled in UI; workspace switch concurrency fenced at initiation with immediate revision bump and cache invalidation. Dead shim (`ui/components/PanelNavigationRow.kt`) cleanly cut over and deleted. Sibling path prefix matching corrected with path boundary `/` checks. 100% automated test pass rate across 152 host unit-test executions across 119 unique test methods (81 shared JVM tests across 16 test classes in `:shared:jvmTest`, 33 Android debug unit tests in `:androidApp:testDebugUnitTest`, 33 Android release unit tests in `:androidApp:testReleaseUnitTest`, and 5 Rust unit tests in `native-app/crypto-bridge`) and 282 static invariant assertions across 5 suites (64 Phase 06 assertions in `tests/test-phase-06-shell-workspace.sh`, 66 Phase 05 assertions in `tests/test-phase-05-proof-gates.sh`, 57 Phase 04 assertions in `tests/test-phase-04-profiles-auth.sh`, 48 Phase 03 assertions in `tests/test-phase-03-transport.sh`, and 47 Phase 02 assertions in `tests/test-phase-02-foundation.sh`). `:androidApp:assembleDebug` builds cleanly (116 Gradle tasks).
- **Deliverables:**
  - Solitary TERMINAL mode and Traditional shell presentation invariants enforced across models, layout, and manifests (`WorkbenchModel.kt`, `WorkbenchNavigation.kt`).
  - Authoritative 12-panel registry (`terminal`, `files`, `editor`, `diff`, `merge`, `git`, `workflow`, `agents`, `resources`, `ports`, `ssh_host`, `settings`) in `PanelRegistry.kt`.
  - Top single-line horizontally scrolling button row (`PanelNavigationRow.kt`) below server/project header with selected button reveal logic, visible across keyboard/IME states (`windowSoftInputMode="adjustResize"`). Zero FloatingActionButtons in entire shared UI.
  - Unified `PanelHost.kt` presenting a single active content area across phones, foldables, and tablets while preserving background session/controller instances; no wide-screen docking.
  - Monotonic back-dismissal navigation stack (`WorkbenchNavigation.kt`) with strict hierarchical unwinding: active dialogs -> workspace switcher modal -> target picker modal -> selected panel returning to TERMINAL -> app exit.
  - Server-authoritative workspace & target management: `WorkspaceRepository.kt` integrating REST endpoints (`/api/workspace/status`, `/api/workspace`, `/api/projects`, `/api/git/{project}/worktrees`, `/api/workspace/switch`, `/api/workspace/known`).
  - Revision-fenced `ProjectTargetStore.kt` with monotonic workspace revision tracking, preventing cross-project worktree contamination, invalidating caches synchronously upon workspace switches, and failing closed on unavailable/prunable targets.
  - Modals and UI surfaces (`WorkspaceScreens.kt`, `WorkbenchHeader.kt`): `ProjectTargetPickerModal` with horizontally scrolling project chips and clickable state guards, `WorkspaceSwitcherModal` with known workspace directory listing, and `WorkspaceSwitchWarningDialog` with explicit destructive session termination warning.
  - Lossless conflict-aware remote configuration editor: `RemoteConfigRepository.kt`, `RemoteConfigEditor.kt`, `RemoteConfigScreen.kt` with dirty state tracking, external version mismatch detection, and draft preservation across background refreshes.
- **Handoff:** Phase 06 TERMINAL Traditional shell, projects, worktrees, and configuration complete and automated checks passed. Phase 07 (Terminal sessions replay input and agents) is unblocked and inherits `TerminalSessionController` and shell panel hosting to implement live PTY session attachment, input replay, and terminal agent integration. Note: Physical hardware runtime qualification, soft-keyboard IME display resize validation, and `BringIntoViewRequester` UI refinement remain deferred to Phase 18.

## Phase 07 Completion Record

- **Completed:** 2026-10-16 02:20:00 +07:00
- **Status:** 100% complete
- **Validation:** Review score 8.8/10 (Cycle 2 approved). 100% automated pass rate: 212 runtime unit tests across 143 unique test definitions, 327 static invariant assertions across 6 suites, clean assembleDebug.
- **Deliverables:** TerminalModels (DTOs, agent enums), TerminalReplayGate (UTF-8 byte stream reconciliation, duplicate chunk discard, overlap slicing, bounded queue), TerminalRepository (REST CRUD and WebSocket flows), AgentStatusReducer (serverEpoch and revision monotonic fencing, deduplicated attention events), TerminalSessionController (input isolation, modifier and ANSI special key encoding, bracketed paste), TerminalInputController (hardware key events, Unicode codepoints, IME text), TerminalScreens (in-panel session tabs, inline accessory keys without FABs, search overlay), and WorkbenchScreen wiring.
- **Remediations Verified:**
  - CRIT-01: Non-reentrant Mutex deadlock in `AgentStatusReducer.kt` resolved. `reloadSnapshotAsync` hoisted outside `mutex.withLock`. Bounded `seenAttentionIds` (max 1000 with LRU eviction).
  - WARN-01: Profile switch in `WorkbenchScreen.kt` closes all controllers and clears cache.
  - WARN-02: `getOrCreateController` ensures controller exists before `attachTerminal`.
  - WARN-03: `isPanelActive` set correctly for all controllers on session/panel switch.
  - WARN-04: Stream attachment added on session jump and session removal.
  - WARN-05: `worktreePath` included in `CreateSessionRequest`.
  - SUGG-02: Bracketed paste added to `AndroidTerminalSurface.pasteText`.
  - SUGG-03: Key release `ACTION_UP` modifier unlatching and supplementary Unicode character preservation in `TerminalInputController`.
- **Handoff:** Phase 08 (Filesystem watchers search and replace) completed with Cycle 2 user approval (6/10) and documented open limitations; Phase 09 (Native editor language services and safe saves) is unblocked.

## Phase 08 Completion Record

- **Completed:** 2026-10-16
- **Status:** 100% complete (with user approval of Cycle 2 review and documented open limitations; Phase 09 unblocked)
- **Validation:** Cycle 2 review score 6/10 per `plans/reports/code-reviewer-261016-0617-phase-08-cycle-2-filesystem-watchers.md` (Reviewer: CHANGES REQUESTED; accepted via user approval with explicit open limitations recorded). Automated testing: 100% pass across 194 unit test executions (116 in `:shared:jvmTest`, 39 in `:androidApp:testDebugUnitTest`, 39 in `:androidApp:testReleaseUnitTest`), 384 static assertions across 7 test suites (`tests/test-phase-08-filesystem-watchers.sh` [57], `test-phase-07-terminal-agents.sh` [45], `test-phase-06-shell-workspace.sh` [64], `test-phase-05-proof-gates.sh` [66], `test-phase-04-profiles-auth.sh` [57], `test-phase-03-transport.sh` [48], `test-phase-02-foundation.sh` [47]), and `:androidApp:assembleDebug` clean build (65 actionable tasks).
- **Deliverables:**
  - Filesystem Models & Contracts (`FileModels.kt`): `FileEntry`, `FileStat`, `FsOpRequest`, `FsOpBatchRequest`, `FsOpResult`, binary detection, and path isolation.
  - File Repository (`FileRepository.kt`): REST file operations (`/api/fs/list`, `stat`, `read`, `write`, `op`), binary chunk reading/writing, fallback handling.
  - File Tree State & Watcher Lifecycle (`FileTreeState.kt`, `FileTreeSubscription.kt`, `FileTreeHelpers.kt`): reactive lazy file tree state, `watchOnly=true` subscription to root, generation-fenced subscription manager (`TreeSubscriptionManager`), unhandled overflow recovery, tree expansion/collapse caching.
  - Mutating Operations & Concurrency (`FileMutationCoordinator.kt`, `FsWriteCoordinator.kt`): mutex-serialized CAS file operations (`create_file`, `create_dir`, `rename`, `delete`), bounded write queue, sanitization against path traversal.
  - Search Repository & Multi-Profile Federation (`SearchModels.kt`, `SearchRepository.kt`, `FederatedSearchCoordinator.kt`): content and path search (`/api/fs/search`), case sensitivity, regex/literal, max results cap (500), multi-profile federated search aggregation with owner profile attribution.
  - Replace Coordinator (`ReplaceModels.kt`, `ReplaceCoordinator.kt`): frozen search spec validation (`res.query`, `res.caseSensitive`), batch preview generation, CAS replacement (`applyBatch`) with `require(!isSearchTruncated)`, per-file outcome accounting (`changed`, `conflicted`, `failed`).
  - UI & Presentation (`FileScreens.kt`, `FilesTopBar.kt`, `FileTreeItemView.kt`, `SearchReplaceView.kt`, `ReplacePreviewCard.kt`, `FileActionDialogs.kt`, `FileModalsHost.kt`): Files panel top bar with search/replace toggle, show-hidden toggle, refresh action; flattened virtualized `LazyColumn` file tree with directory expand/collapse; search & replace drawer with query input, case-sensitive toggle, scope selector, preview card list with match snippets; create file/dir, rename, and delete confirmation dialogs with error presentation.
  - WorkbenchScreen Integration (`WorkbenchScreen.kt`): wired Files panel into authoritative 12-panel registry, lifecycle-scoped `FileTreeState` and `FederatedSearchCoordinator` bindings, back-dismissal integration.
- **Documented Open Limitations & Residuals (from Cycle 2 Review):**
  - **H1 (Lossy UTF-8 decode in replace):** `FileRepository.readFile` uses permissive UTF-8 decode; server only probes first 8192 bytes for binary check. Invalid UTF-8 sequences past 8 KiB can be replaced lossily. Strict decode / binary classification required.
  - **H2 (Watcher coverage & reconnect rebind):** Server watcher is non-recursive; live events only cover root directory (`path=""`). Expanded subfolder updates rely on client re-fetch upon expand. Socket reconnect rebind requires identity trigger on `Connected(socketRef)`.
  - **H3 (Timeout handling vs cancellation):** `TimeoutCancellationException` from `withTimeout` treated as `CancellationException`, which can abort entire batch replace and hide per-file outcomes; requires distinguishing timeout failure from parent scope cancellation.
  - **H4 (Federation target resolution):** Multi-profile federated search target resolution for non-active profiles uses profile display name instead of active project/workspace target.
  - **H5 (Dirty buffer protection gate):** Authoritative dirty-buffer provider interface pending Phase 09 native editor implementation; Replace All currently defaults to `isDirtyFile = { false }`.
  - **H6 (Outcome visibility & qualified preview):** Partial failures and per-file replace outcomes not surfaced in UI detail cards (currently counts only); file preview cards lack profile/project qualifier when matching identical relative paths across servers.
  - **H7 (Behavioral test coverage):** Mocked WebSocket tests for early buffering, reconnection rebind, and batch CAS conflicts to be expanded during qualification.
- **Handoff:** Phase 08 completed with user approval. Phase 09 (Native editor language services and safe saves) is unblocked and inherits `FileRepository`, `ReplaceCoordinator`, and qualified file navigation routes. Physical device runtime qualification remains under Phase 18.

## Phase 09 Completion Record

- **Completed:** 2026-10-16 07:24:21 +07:00
- **Status:** 100% complete (with user approval of review and documented open limitations; Phase 10 unblocked for authorized continuation)
- **Validation:** User-approved with documented open limitations (Reviewer Cycle 2 score 6/10 CHANGES REQUESTED; accepted via user approval with noted limitations). Automated test suite 100% pass across 219 unit test executions (141 in `:shared:jvmTest`, 39 in `:androidApp:testDebugUnitTest`, 39 in `:androidApp:testReleaseUnitTest`), 454 static invariant assertions across 8 test suites (`tests/test-phase-09-editor-saves.sh` [70], `test-phase-08-filesystem-watchers.sh` [57], `test-phase-07-terminal-agents.sh` [45], `test-phase-06-shell-workspace.sh` [64], `test-phase-05-proof-gates.sh` [66], `test-phase-04-profiles-auth.sh` [57], `test-phase-03-transport.sh` [48], `test-phase-02-foundation.sh` [47]), and `:androidApp:assembleDebug` clean build (55 actionable tasks).
- **Deliverables:** FileTierPolicy (<1MB normal, 1-5MB degraded, >=5MB large 64KB range read, binary, media, markdown/html/mermaid), EditorModels, EditorSession with submitted-bytes baseline tracking and bounded undo/redo, EditorTabSaveCoordinator with atomic transform updates, EditorTabsState with multi-tab management, clean auto-reload, dirty stale marking, discardAndReloadTab, 64KB loadLargeFileRange pager, and authoritative isDirtyFile for ReplaceCoordinator, LanguageService with JSON AST symbols/diagnostics, TsJsLanguageService delimiter/keyword scanner with quote-before-comment precedence, and TypeScriptLanguageServiceAudit record. UI: EditorScreens, EditorTopBar, LargeFileView, BinaryHexView, MarkdownPreviewView with Mermaid banner, MediaPreviewCard, SaveConflictDialog, and WorkbenchScreen integration. Zero FABs.
- **Documented Open Limitations & Implementation Gaps:**
  1. **Editor Surface Implementation Gap:** Live editor surface uses Compose TextField with candidate adapter metadata; physical Sora Editor native canvas binding deferred to Phase 18 device qualification.
  2. **Language Service Implementation Gap:** TS/JS semantic intelligence formally BLOCKED per TypeScriptLanguageServiceAudit pending QuickJS/Hermes or server LSP decision; syntax heuristic delimiter checking active.
  3. **Encrypted Save Implementation Gap:** Encrypted save safely fails closed until Phase 11 owner-bound crypto session.
- **Handoff:** Phase 09 completed with user approval and documented open limitations. Phase 10 (Native diff merge and blame) is unblocked for authorized continuation with documented constraints and inherits `EditorSession`, `EditorTabsState`, `FileTierPolicy`, and `LanguageService`. Physical device runtime qualification remains under Phase 18.

## Phase 10 Completion Record

- **Completed:** 2026-10-16 09:48:17 +07:00
- **Status:** 100% complete
- **Validation:** User approved score 9/10 (Cycle 5 code review approved, score 9/10 per `plans/reports/code-reviewer-261016-1030-phase-10-cycle-5.md`; all critical items resolved, zero critical findings; verified with QA report `plans/reports/qa-261016-0917-phase-10-cycle-2-verification.md`). 100% automated test pass rate across 246 unit test executions (168 in `:shared:jvmTest`, 39 in `:androidApp:testDebugUnitTest`, 39 in `:androidApp:testReleaseUnitTest`) and 531 static invariant assertions across 9 shell test suites (`tests/test-phase-10-diff-merge-blame.sh` [77], `test-phase-09-editor-saves.sh` [70], `test-phase-08-filesystem-watchers.sh` [57], `test-phase-07-terminal-agents.sh` [45], `test-phase-06-shell-workspace.sh` [64], `test-phase-05-proof-gates.sh` [66], `test-phase-04-profiles-auth.sh` [57], `test-phase-03-transport.sh` [48], `test-phase-02-foundation.sh` [47]). Clean `assembleDebug` APK build.
- **Deliverables:**
  - **Native Diff Models & Engine (`DiffModels.kt`, `DiffCalculator.kt`, `LcsDiffEngine.kt`, `DiffReviewController.kt`):** Side-by-side and inline diff models, hunk grouping/navigation, hunk discard/revert mapping, read-only past commit diff inspection, editable working-tree modified buffer with baseline mtime CAS safe saves (`saveModified`), and exit commit diff navigation.
  - **3-Way Merge Conflict Resolution (`MergeConflictModels.kt`, `ConflictParser.kt`, `MergeConflictController.kt`):** Standard 2-way and 3-way `diff3` marker parsing (`<<<<<<<`, `|||||||`, `=======`, `>>>>>>>`), granular conflict chunk resolution (accept ours, accept theirs, accept base, accept both), custom edits with undo, malformed marker error presentation, mark-resolved endpoint integration (`/api/git/{project}/resolve`), and safe buffer reset (`resetBufferState()`).
  - **Git Blame Engine & Cache (`BlameModels.kt`, `BlameRepository.kt`, `BlameCache.kt`, `BlameValidator.kt`):** 250ms debounced single-flight queries, SHA-256 UTF-8 buffer fingerprint caching, partition gap/overlap validation, commit index bounds check, instant invalidation on local edits, and exact commit reveal nonce carrying profile/project/root/commit OID.
  - **Native UI Surfaces (`DiffReviewScreen.kt`, `DiffRowItem.kt`, `MergeConflictScreen.kt`, `EditorBlameGutter.kt`, `WorkbenchScreen.kt`):** Side-by-side & inline diff viewer, hunk navigation bar, exit commit diff action, merge conflict multi-file resolver with panel navigation, blame gutter overlay, zero FABs, adhering strictly to single top panel row and adjustResize soft keyboard behavior.
- **Documented Open Limitations & Residuals:**
  1. **Multi-File onResolved Race:** `onResolved` navigation checks remaining conflicts using the pre-reload count; manual navigation or reloading is supported when multiple files conflict.
  2. **Non-default Root Save:** Diff saves currently operate on the target worktree root; non-default sub-repository roots require explicit target scoping.
  3. **Hunk Visual Highlighting:** Hunk navigation steps through the hunk counter index; visual scroll-into-view and animated highlight deferred to Phase 18 device qualification.
- **Handoff:** Phase 10 completed with user approval (Score 9/10). Phase 11 (Encrypted transfers media and Android storage) unblocked for next sequence progression and Phase 12 (Complete Git and safe history workflows) unblocked on diff/merge/blame dependency. Physical hardware and live server qualification deferred to Phase 18.

## Phase 11 Completion Record

- **Completed:** 2026-10-16
- **Status:** 100% complete (with user approval of Cycle 2 review and documented open limitations deferred to Phase 18; Phase 12 and Phase 17 unblocked)
- **Validation:** User approved Cycle 2 review (accepted via user approval with documented open limitations; Reviewer Cycle 2 score 5/10 CHANGES REQUESTED per `plans/reports/code-reviewer-261016-1050-phase-11-cycle-2-encrypted-transfers-media-storage.md`). 100% automated pass rate across 282 automated test executions (7 Rust unit tests in `native-app/crypto-bridge`, 183 KMP shared JVM unit tests in `:shared:jvmTest`, 46 Android debug unit tests in `:androidApp:testDebugUnitTest`, 46 Android release unit tests in `:androidApp:testReleaseUnitTest`), 615 static invariant assertions across 10 shell test suites (`tests/test-phase-11-encrypted-transfers-media.sh` [84], `test-phase-10-diff-merge-blame.sh` [77], `test-phase-09-editor-saves.sh` [70], `test-phase-08-filesystem-watchers.sh` [57], `test-phase-07-terminal-agents.sh` [45], `test-phase-06-shell-workspace.sh` [64], `test-phase-05-proof-gates.sh` [66], `test-phase-04-profiles-auth.sh` [57], `test-phase-03-transport.sh` [48], `test-phase-02-foundation.sh` [47]), and clean `assembleDebug` APK build.
- **Deliverables:**
  - **Cryptographic & Transfer Coordination (`CryptoSession.kt`, `CryptoSessionManager.kt`, `TransferCoordinator.kt`, `EncryptedSaveCoordinator.kt`, `native-app/crypto-bridge/src/lib.rs`):**
    - OPAQUE session key derivation and envelope encryption (AES-256-GCM, HKDF-SHA256, 16-byte IV, 16-byte tag, server wire format compatibility).
    - Generation-fenced transfers (`ConnectionRef` / `ProfileId`) with monotonic watermarks, atomic JSON-header and binary frame groups, 64 KiB chunking, and backpressure handling.
    - Encrypted file upload and safe save flows with expected mtime CAS conflict detection, fail-closed handling without plaintext fallback, and 100 MiB envelope size enforcement.
    - Rust cdylib cryptographic bridge (`native-app/crypto-bridge/src/lib.rs`) with zeroization and 7 unit tests.
  - **Native Android Storage & SAF (`AndroidDocumentStorage.kt`):**
    - Android Storage Access Framework (SAF) integration via `OpenDocument` and `CreateDocument` contracts.
    - Streaming chunked I/O (`streamFromUri`, `streamToUri`) avoiding whole-file heap buffering.
    - URI metadata query and filename sanitization against path traversal.
  - **Protected Media & Streaming Client (`AndroidMediaClient.kt`, `AndroidVideoSurface.kt`, `MediaModels.kt`):**
    - Media ticket issuance and session cookie capture (`/api/media/ticket`, `dhs_media_session`).
    - Purpose-scoped leases (`PLAYBACK`, `DOWNLOAD`, `THUMBNAIL`) with origin verification and automatic disposal.
    - Resumable video playback via custom `MediaDataSource` supporting HTTP 206 range requests with bounded buffer streaming.
    - Native Android MediaPlayer surface integration in Compose without Floating Action Buttons (zero FABs invariant held).
  - **Workbench & Editor Integration (`WorkbenchScreen.kt`, `EditorScreens.kt`, `MediaPreviewCard.kt`, `EditorTopBar.kt`, `EditorTabsState.kt`):**
    - Protected media preview cards with streaming ticket integration.
    - Safe encrypted save coordination hooked into editor tabs.
- **Documented Open Limitations & Residuals (Deferred to Phase 18):**
  - **L1 (Live Device & Authenticated Server Qualification):** Real Android device verification, end-to-end encrypted transfer roundtrips against live authenticated Rust server daemon, and live media playback/seeking over remote network deferred to Phase 18 (`phase-18-integrated-device-security-and-performance-qualification.md`).
  - **L2 (End-to-end CryptoSession Wiring):** OPAQUE login hook for automatic `CryptoSession` activation on profile session establishment and UI toggle exposure for explicit encrypted save mode tracked for Phase 18 qualification.
  - **L3 (SAF & OEM Media Edge Cases):** Real device Storage Access Framework intent resolution across diverse OEM Android distributions and edge cases (200-OK on Range requests, fail-closed cookie capture hardening) tracked under Phase 18 qualification.
- **Handoff:** Phase 11 (Encrypted transfers media and Android storage) completed with user approval. Phase 12 (Complete Git and safe history workflows) unblocked (dependencies Phase 06 and Phase 10 satisfied); Phase 17 (Preferences privacy notifications and lifecycle) has its Phase 11 dependency satisfied (remaining prerequisites: Phases 07 [completed], 13, 14, 15, 16 [pending]). Physical hardware and live server qualification deferred to Phase 18.
