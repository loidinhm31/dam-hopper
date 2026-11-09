# Android Native Client — Historical Phase Baselines (Phases 02–11, 13–16)

**Document status:** Historical phase baselines and static assertion ledgers for the initial Android native client foundation and feature increments. For active scope, acceptance ledgers, Git workflows, Phase 17–18 baselines, and the Native Android Agent Hub redesign (P01/P02), refer to the primary [Android Native Acceptance Ledger](../android-native-acceptance.md).

---

### 7.5 Phase 02 Toolchain & Security Baseline
- **Toolchain Pins (`native-app/gradle/libs.versions.toml`, `gradle-wrapper.properties`):**
  - Gradle: 8.11.1 (distribution SHA-256 `f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6`).
  - Android Gradle Plugin (AGP): 8.7.3.
  - Kotlin: 2.1.10 (`multiplatform`, `serialization`, `compose`).
  - Compose Multiplatform: 1.7.3 (`org.jetbrains.compose`).
  - Kotlinx: Coroutines 1.10.1, Serialization 1.8.0, Datetime 0.6.1.
  - Ktor Client: 3.1.0 (OkHttp & Java engines staged).
  - SDK / Bytecode: minSdk 29, targetSdk 35, compileSdk 35, Java 17 target.
  - ABI targets: `arm64-v8a` and `x86_64`.
- **Security & Isolation Policies:**
  - Network Security: Release base config enforces `cleartextTrafficPermitted="false"` with system CA trust anchors. Debug base config permits cleartext to any host and debug overrides trust system plus user-installed CAs. This is a debug-only transport allowance; authenticated Wi-Fi login should use HTTPS. Profile Login blocks password/MFA over HTTP and stored tokens over HTTP for non-development endpoints. Never expose `--no-auth` over Wi-Fi/LAN.
  - Data Extraction & Backup: Manifest disables backup (`android:allowBackup="false"`, `android:fullBackupContent="false"`). Data extraction rules (`data_extraction_rules.xml`) exclude `.` from both `<cloud-backup>` and `<device-transfer>`.
  - IME Configuration: Manifest configures `android:windowSoftInputMode="adjustResize"` to request window resizing when the software keyboard opens (visual dock stability across virtual keyboards pending device testing).
  - Web Engine Exclusion: Prohibits WebView or Tauri dependencies (0 occurrences detected in `native-app/shared/src/` or `native-app/androidApp/src/main/` by static verification).

### 7.6 Phase 03 Contracts Ownership & Transport Baseline
- **Ownership & Lifecycle Models (`core/model/`):**
  - `ConnectionRef(profileId, generation)`: Immutable profile connection epoch identifier producing deterministic tuple keys `["profileId", generation]` compatible with TypeScript web client conventions.
  - `SocketInstanceRef(connection, socketId)`: Scopes socket attempt lifecycle within a `ConnectionRef`, producing tuple keys `["profileId", generation, "socketId"]`. Ensures socket-bound capabilities (e.g. `host:uiConnection`) are revoked on reconnect.
  - `ProjectTargetRef(profileId, project, worktreePath)`: Normalizes project target worktree paths and produces server-safe payloads via `toServerPayload()` without exposing client profile IDs.
  - `ConnectionOwnerError`: Standard typed error carrying explicit reasons (`STALE`, `UNAVAILABLE`, `OWNER_MISMATCH`, `AUTH_REQUIRED`).
- **Generation Fencing & In-Memory Watermarks (`core/ownership/ConnectionRegistry.kt`):**
  - Manages active generations per profile under coroutine `Mutex` synchronization.
  - Monotonic in-memory generation watermarks (`generationWatermarks`) persist across profile removal within the registry/process lifetime, preventing ABA generation collisions on profile re-creation during runtime.
  - Strict owner validation: `assertCurrentOwner` gates request initiation and completion across REST, WebSocket, and SSE.
  - Dispatches retirement events to registered listeners (`retirementListeners`) upon generation advance.
- **REST API Client (`core/transport/ApiClient.kt`):**
  - Scoped to an immutable `ConnectionRef` with base URL normalization.
  - Redirect following disabled (`followRedirects = false`) to prevent auth token leakage across cross-origin redirects.
  - Structured concurrency: immediately rethrows `CancellationException` before error wrapping.
  - Parses server error responses (`{ "code": "...", "error": "..." }`) and `Retry-After` headers into typed `ApiRequestError`.
- **URL & Diagnostic Sanitization (`core/transport/ApiErrors.kt`):**
  - `redactUrl()` sanitizes query parameters (`([?&]token=)[^&]+`) and user-info credentials (`((?:https?|wss?)://[^:/@]+:)[^@]+(@)`) across HTTP, HTTPS, WS, and WSS schemes.
  - Masks `decisionCapability=[REDACTED]` in `ServerMsg.UiConnection.toString()` and `UiConnectionReceipt.toString()`.
- **Live WebSocket Transport (`core/transport/WsConnection.kt`):**
  - Origin-less handshake URL: `GET /ws?token=<token>` avoids synthetic browser `Origin` headers.
  - Exact-socket receipts: `host:uiConnection` creates `UiConnectionReceipt` bound to `SocketInstanceRef`, revoked immediately on close, error, or reconnect.
  - Maps server close codes to typed `WsState`: `4403` (`MfaRequired`), `4401` (`LoginRequired`), `1013` (`AuthUnavailable`), `4001` (`Overflow`).
  - Socket-instance fencing: `handleCloseReason` and `handleSocketFailure` verify `activeSocketRef == socketRef` before modifying state or closing sessions.
- **Atomic Application Frame Writer (`core/transport/SerializedWsWriter.kt`):**
  - Mutex-guarded transmission prevents interleaving of text JSON headers and binary frames.
  - Atomic pairs (`sendAtomicPair`) for chunked binary uploads (`fs:write_chunk_binary`, `fs:upload_chunk`) abort the session with `CloseReason.Codes.PROTOCOL_ERROR` if partial failure occurs after header delivery.
- **Bounded Request Correlator (`core/transport/WsRequestCorrelator.kt`):**
  - Bounds concurrent in-flight requests (default `maxInFlight = 256`), throwing `UNAVAILABLE` on overflow.
  - Request timeout handling unregisters pending requests (`unregister(reqId)`) to eliminate capacity leaks.
  - Cancels all pending requests upon socket disconnect or replacement.
- **Bounded SSE Client (`core/transport/HostResourceSseClient.kt`):**
  - Enforces strict memory caps: 256 KiB for data events (`MAX_DATA_EVENT_BYTES`) and 4 KiB for control/status events (`MAX_CONTROL_EVENT_BYTES`).
  - Strict status-data adjacency: data frames require an immediately preceding status frame with identical `serverEpoch` and `revision`. Comments (`: ping`) clear preceding status to prevent stale pairing.
- **Android Platform Network Factory (`platform/network/AndroidHttpClientFactory.kt`):**
  - Pinned OkHttp engine configuration: 15s connect timeout, 30s read/write timeouts, 15s WebSocket ping interval, and disabled redirects (`followRedirects(false)`, `followSslRedirects(false)`).
  - Enforces Android `network_security_config.xml` TLS-only release policy.

### 7.7 Phase 04 Profiles, Authentication, MFA & Credential Vault Baseline
- **Multi-Server Profile Lifecycle (`features/profiles/`):**
  - `ProfileRepository`: Manages multi-server profile instances (`ServerProfile`), active selection (`activeProfileId`), and status projection (`authStatuses`).
  - `ServerProfile`: Strict URL validation via `validateServerUrl` enforces HTTP/HTTPS scheme, rejects user credentials in URL authority, query parameters, and fragments, and maps Android emulator loopback addresses (`10.0.2.2`).
  - `ProfileMetadataStore` & `AndroidProfileMetadataStore`: Persists non-secret profile metadata in Android `SharedPreferences` under key `damhopper_server_profiles`.
- **Android Keystore Credential Custody (`platform/vault/AndroidCredentialVault.kt`):**
  - `CredentialVault` contract: Keyed by `token:${profileId}:${baseUrl}`. Restricts storage strictly to Bearer session tokens; passwords, challenge tokens, and TOTP setup secrets are never persisted.
  - Keystore-backed `EncryptedSharedPreferences`: Employs `MasterKey` (`AES256_GCM`) with `AES256_SIV` key encryption and `AES256_GCM` value encryption.
  - Fail-Closed Key Handling: Throws `VaultKeyInvalidatedException` on key invalidation or corruption; never falls back to unencrypted plaintext storage.
  - Data Extraction & Backup Exclusion: `data_extraction_rules.xml` excludes `sharedpref` domain from both `<cloud-backup>` and `<device-transfer>`, and manifest enforces `android:allowBackup="false"`.
- **Attempt Watermark Fencing (`features/profiles/AuthAttemptTracker.kt`):**
  - Fences asynchronous authentication calls against concurrent lifecycle modifications.
  - `AuthAttemptTracker.startAttempt(profileId)` generates monotonically increasing `AuthAttemptRef(profileId, attemptId)`.
  - `assertActive(attempt)` gates session token installation; late or outdated callbacks throw `AuthAttemptStaleException`.
  - Profile endpoint updates, deletions, and logouts call `attemptTracker.invalidate(profileId)` to retire pending attempt watermarks immediately.
- **Frozen Protocol v2 Authentication & TOTP MFA (`features/profiles/AuthRepository.kt`):**
  - Protocol Version Gates: `AuthResponseParser` and `AuthStatusParser` enforce frozen protocol constants (`authProtocol = 2`, `workbenchProtocol = 2`), rejecting mismatches with `INCOMPATIBLE_PROTOCOL`.
  - REST Authentication Stack: Connects to `/api/auth/register` (new accounts disabled pending operator approval), `/api/auth/login` (yields 5-minute login challenge or dev session), `/api/auth/mfa/setup` (transient TOTP secrets, never persisted), `/api/auth/mfa/confirm`, `/api/auth/mfa/verify`, `/api/auth/mfa/challenge` (step-up rotation), `/api/auth/status`, and `/api/auth/logout`.
  - Typed Error Mapping: Maps server codes for `ACCOUNT_DISABLED`, `MFA_REQUIRED`, `SESSION_EXPIRED`, `SESSION_REVOKED`, `INCOMPATIBLE_PROTOCOL`, and `ATTEMPT_STALE`.
  - Sensitive Data Redaction: `AuthSession`, `LoginChallenge`, and `MfaSetupData` sanitize tokens and secrets in `toString()` diagnostics (`[REDACTED]`).
- **ConnectionRegistry Session Lifecycle Integration:**
  - Endpoint changes, credential rotation, and logouts call `retireProfileConnection()` which executes `ConnectionRegistry.retireConnection()`, invalidating active REST, WebSocket, and SSE instances for that generation.
  - Profiles are strictly isolated: invalidating or logging out one profile does not affect other registered profiles.
  - Monotonic generation watermarks (`generationWatermarks`) persist across profile deletion, preventing ABA generation reuse if the profile ID is recreated within the process lifetime.
- **UI & Presentation Invariants:**
  - `AuthDialog`: Tabbed login/register dialog with obscured password input (`PasswordVisualTransformation`) and operator approval notice for newly registered accounts.
  - `MfaChallengeContent`: Interactive TOTP setup and challenge verification with explicit disclosure of transient secret lifecycle.
  - Workbench Integration: Profile management hosted under `WorkbenchScreen` SETTINGS panel and header profile indicator, maintaining strict TERMINAL Traditional mode and zero floating buttons (FABs).

### 7.8 Phase 05 Native Terminal, Editor & Crypto Proof Gates Baseline
- **Terminal Surface Contracts & Candidate Pin (`platform/terminal/`):**
  - `AndroidTerminalSurface`: Decoupled terminal display surface. Remote Rust server owns PTY session lifecycle.
  - `TerminalSessionController`: Outlives Compose recomposition and tab navigation.
  - Input Isolation & Fencing: Input drops and IME isolation are enforced when `isPanelActive == false` or while `isReplayCompleted == false`, preventing keystroke leakage into hidden sessions or out-of-order execution during replay.
  - Terminal candidate pinned to ConnectBot termlib 0.3.13 (`org.connectbot:termlib:0.3.13`, `libvterm.so` JNI core; Apache-2.0 / MIT licenses).
  - VT100/ANSI modifier translation for Ctrl, Alt, Arrow keys, Esc, Tab, Home, End; bounded search and clipboard selection hooks.
- **Editor Surface Contracts & Candidate Pin (`platform/editor/`):**
  - `AndroidEditorSurface`: Code editor surface interface and Compose wrapper.
  - `EditorSession`: Tracks monotonic `modelVersion` on edits, `editEpoch`, `originalServerText`, `serverMtime`, and `isDirty`. Stale saves are rejected if connection generation is retired.
  - Line geometry & gutter decorations: Gutter decoration models for Git blame annotations, diagnostics, and commit reveal.
- Candidate pinned to Sora Editor 0.23.4 (`io.github.Rosemoe.sora-editor:editor:0.23.4` and `io.github.Rosemoe.sora-editor:language-java:0.23.4`, LGPL-2.1-or-later). License obligations identified; DEX packaging clarification and Section 6(a) user relinking/replacement runbook documented in `plans/261023-1429-native-editor-file-explorer/distribution-qualification.md` (packaging configuration includes `pickFirsts += setOf("/META-INF/AL2.0", "/META-INF/LGPL2.1")`, full license text bundled in `assets/licenses/sora-editor.txt`, and ProGuard keep rules configured for `io.github.rosemoe.sora.**`). Formal binary distribution release remains gated pending demonstrated relinking verification on a packaged release artifact.
- **Language Service & Stale Request Fencing (`features/editor/`):**
  - `JsonLanguageService`: Non-browser offline JSON lexer delivering syntax validation, AST diagnostics, and symbol hierarchy.
  - `LanguageServiceCoordinator`: Fences stale asynchronous diagnostics via monotonic request watermarks (`fileWatermarks`).
  - `TypeScriptLanguageServiceAudit`: Documents the hard architectural blocker for TypeScript language services: remote server hosts no LSP daemon, WebView/browser workers prohibited, non-browser Kotlin/Java cannot run full TypeScript AST evaluation without an embedded JS engine (QuickJS, Hermes, or V8 JNI). Phase 09 TS semantic features remain hard-gated pending architectural decision.
- **OPAQUE Cryptographic Bridge & Fail-Closed Security (`crypto-bridge/` & `platform/crypto/`):**
  - Rust cdylib `native-app/crypto-bridge/`: Exact suite match with `server/src/crypto/opaque.rs` (`DamHopperOpaqueSuite`: `Ristretto255`, `TripleDh<Ristretto255, Sha512>`, `Identity`).
  - HKDF key derivation: SHA-256 with 32 zero bytes salt and info `b"dam-hopper-aes-256-gcm-v1"`, deriving 32-byte AES-256-GCM session keys; host Rust integration tests verify byte-for-byte session key derivation parity with simulated server output (live server end-to-end network interop remains an open qualification gate).
  - Fail-Closed Security: Elimination of simulated crypto fallback upon `UnsatisfiedLinkError`; operations strictly throw `OpaqueCryptoException`. Monotonic atomic handles (`AtomicI64`, capacity 64, zeroization on release, double-close safety).
  - Android NDK 16 KiB ELF alignment requirement (`-C link-arg=-Wl,-z,max-page-size=16384`); complete 16 KiB runtime qualification (APK zip alignment, prebuilt dependency `.so` validation, and execution on 16 KiB page size kernel) tracked under Phase 11/18.
- **Verification & Test Suite Results (per recorded QA report):**
  - Total Automated Checks Passed: 336/336 checks passed (100% pass rate).
    - 118 Unit Test Executions (92 unique test cases):
      - 61 shared JVM unit tests in `:shared:jvmTest` (`pnpm native-app:test`)
      - 26 Android debug unit tests in `:androidApp:testDebugUnitTest` (`pnpm native-app:test:android`)
      - 26 Android release unit test executions in `:androidApp:testReleaseUnitTest` (supplementary release variant execution)
      - 5 Rust crypto bridge integration tests in `cargo test --manifest-path native-app/crypto-bridge/Cargo.toml`
    - 218 Invariant Assertions Passed across 4 shell regression scripts:
      - 66 assertions in `tests/test-phase-05-proof-gates.sh` (5 suites)
      - 57 assertions in `tests/test-phase-04-profiles-auth.sh` (5 suites)
      - 48 assertions in `tests/test-phase-03-transport.sh` (6 suites)
      - 47 assertions in `tests/test-phase-02-foundation.sh` (5 suites)
  - Debug APK Assembly: `./gradlew assembleDebug` (`pnpm native-app:assembleDebug`) succeeded cleanly (65 actionable tasks).

### 7.9 Phase 06 Shell Navigation, Workspaces & Remote Configuration Baseline
- **Required Invariants:**
  - Strict TERMINAL workspace mode (`workspaceMode = "terminal"`) and Traditional shell presentation (`terminalUsageMode = "traditional"`) across all screens.
  - Exactly one horizontal scrolling navigation row docked beneath the header; zero floating action buttons (FABs) or secondary navigation drawers.
  - Single active content area (`singleContentArea = true`); switching panels replaces the visible content area without split-screen docking.
  - Back-stack precedence: Dismisses active modal overlays via fixed precedence order (auth dialog -> destructive switch confirmation -> target picker -> workspace switcher -> profile list) before navigating from non-terminal panels back to TERMINAL; pressing back on TERMINAL with no overlays yields to platform exit.
  - Fail-closed target availability: Selecting an unverified or unavailable target presents an explicit unavailable state; silent redirection to project root is prohibited.
  - Non-destructive remote configuration: Updates preserve entire server JSON documents to prevent stripping unmodeled fields; dirty local drafts are preserved upon background refreshes and flagged with external conflict notices.
  - Explicit destructive workspace warnings: Switching workspaces disposes all remote PTY sessions and reinitializes sandboxes; confirmation requires explicit user acknowledgment.
- **Implemented Mechanisms:**
  - `PanelRegistry` (`ui/navigation/PanelRegistry.kt`): Authoritative metadata mapping for all 12 panels (`WorkbenchPanel.entries`) with labels, monospace short codes (`TERM`, `FS`, `EDIT`, `DIFF`, `MRG`, `GIT`, `FLOW`, `AGNT`, `RES`, `PORT`, `HOST`, `SET`), icon glyphs, and descriptions; throws `IllegalArgumentException` on unmodeled panels.
  - `PanelNavigationRow` (`ui/navigation/PanelNavigationRow.kt`): Single-row `horizontalScroll` with Compose `BringIntoViewRequester` auto-scrolling the selected button into view on panel activation; respects `adjustResize` window insets without layout overflow.
  - `PanelHost` (`ui/navigation/PanelHost.kt`): Single content host container dispatching active panel rendering across 12 branch slots (`terminalContent`, `filesContent`, `editorContent`, `diffContent`, `mergeContent`, `gitContent`, `workflowContent`, `agentsContent`, `resourcesContent`, `portsContent`, `sshHostContent`, `settingsContent`).
  - `WorkbenchNavigation` (`ui/navigation/WorkbenchNavigation.kt`): State machine coordinating active panel, active project, and modal dialogs with strict `handleBackPress()` precedence (auth -> workspace switch warning -> target picker -> workspace switcher -> profile list -> return to TERMINAL -> platform back).
  - `ProjectTargetStore` (`features/workspace/ProjectTargetStore.kt`): Reactive store tracking project targets (`root` vs `worktree`). Monotonic workspace revision (`invalidateWorkspace`) fences in-flight network requests. Fails closed when cached worktrees are unselectable or missing (`isSelectable = isAvailable && !isPrunable`).
  - `WorkspaceRepository` (`features/workspace/WorkspaceRepository.kt`): Wire client for `/api/workspace/status`, `/api/workspace`, `/api/projects`, `/api/git/{project}/worktrees`, `/api/workspace/known`, `/api/workspace/discover`, `/api/workspace/init`, and `/api/workspace/switch`.
  - `WorkspaceScreens` (`features/workspace/WorkspaceScreens.kt`): Modal dialogs including `ProjectTargetPickerModal` (project chips and worktree selection with cross-project target fencing), `WorkspaceSwitcherModal` (known/discovered workspace browser), and `WorkspaceSwitchWarningDialog` (explicit warning that switching disposes all server PTY sessions).
  - `RemoteConfigRepository` (`features/settings/RemoteConfigRepository.kt`) & `RemoteConfigEditor` (`features/settings/RemoteConfigEditor.kt`): Manages `/api/config`, `/api/config/projects/{name}`, and `/api/global-config/ui`. Retains raw JSON document fidelity (`baseConfigJson`, `draftConfigJson`), detects external server drift (`handleServerRefresh` setting `hasConflict = true` without clobbering dirty drafts), and supports granular `UiPreferences` updates.
- **Verified Acceptance Evidence & Open Qualification:**
  - 64 Invariant Assertions passing in `tests/test-phase-06-shell-workspace.sh` covering TERMINAL/Traditional shell invariants, 12-panel registry, navigation row auto-reveal, back precedence, wire DTO schemas, target store revision fencing, remote config conflict detection, and modal dialogs.
  - 25 JVM and Android unit tests passing (`WorkbenchShellPhase06Test`, `ProjectTargetStoreTest`, `RemoteConfigEditorTest`, `WorkbenchNavigationTest`).
  - Clean APK build: `./gradlew assembleDebug` (`pnpm native-app:assembleDebug`) succeeded with 65 tasks up to date.
  - Code review rating: Cycle 2 review scored 9.4/10 with all 3 critical issues (cross-project target contamination, unselectable worktree clickability, and workspace switch initiation fencing) verified resolved.
  - *Open Qualification Gates:* High-DPI button reveal scaling across physical Android displays and end-to-end device scrolling qualification pending in Phase 18.

### 7.10 Phase 07 Terminal Sessions, Stream Replay, Input & Agent Status Baseline
- **Required Invariants:**
  - Strict Traditional terminal presentation (`terminalUsageMode = "traditional"`): sessions operate in Traditional terminal presentation; IDE shell dock layout and Runtime terminal presentations are excluded.
  - Inline UI controls & zero FABs: terminal accessory buttons (Ctrl, Alt, Esc, Tab, arrows) and session switcher tabs are docked strictly inline within `TerminalPanelScreen`; agent jump-to-session actions are inline within `AgentsPanelScreen`. Zero floating action buttons across the entire UI.
  - Stream replay gate & byte reconciliation (`TerminalReplayGate`): live output is queued while historical replay buffer is in flight. Chunk reconciliation via `reconcileTerminalOutput` performs duplicate chunk discard (`endOffset <= currentOffset`), gap detection (`startOffset > currentOffset`), and partial overlap slicing (`startOffset < currentOffset < endOffset`).
  - Outbound query suppression & echo loop prevention: `activeReplayWrites` tracks in-flight replay writes across attach resets; `shouldForwardTerminalData()` returns false while replay writes are pending, preventing terminal device queries from leaking into live sessions.
  - Server-authoritative agent status observation (`AgentStatusReducer`): state reducer applies `serverEpoch` and monotonic `revision` ordering. Epoch mismatches trigger snapshot reload hoisted outside non-reentrant mutex. Deltas update unread attentions with bounded attention tracking (1,000-entry LRU cap) to suppress duplicate alerts.
  - Input isolation & keyboard bridging: keystrokes are dropped when `isPanelActive == false` or `isReplayCompleted == false`. Hardware modifiers (Ctrl, Alt, Shift) unlatch on `ACTION_UP`. Supplementary Unicode (> 0xFFFF) handled via surrogate pairs. Alt-special key prefixes escape (`0x1B`). Bracketed paste wrapping (`\u001b[200~... \u001b[201~`) applied to clipboard text.
  - Cross-profile session isolation: `WorkbenchScreen` closes and clears all registered `TerminalSessionController` instances upon active profile transitions to prevent cross-profile session and socket leakage.
- **Implemented Mechanisms:**
  - `TerminalModels` (`features/terminal/TerminalModels.kt`): Session metadata (`TerminalSessionMeta`, `TerminalSessionDetailed`), CRUD wire requests (`CreateSessionRequest`, `RenameSessionRequest`), agent status rows (`TerminalAgentStatusRow`), unread attention events (`AgentAttentionEvent`), and snapshot DTO (`AgentStatusSnapshotV1`).
  - `TerminalRepository` (`features/terminal/TerminalRepository.kt`): REST client wrapping `/api/terminal/sessions`, `/api/terminal/sessions/{id}`, `/api/terminal/sessions/{id}/rename`, `/api/terminal/sessions/{id}/kill`, `/api/terminal/sessions/{id}/remove`, `/api/terminal/sessions/{id}/buffer`, and `/api/agent-status/snapshot`.
  - `TerminalReplayGate` (`features/terminal/TerminalReplayGate.kt`): Gate coordinator tracking `hasAttachBufferBeenReceived`, `isReplayWriting`, `isLiveStreamReady`, bounded queuing (`maxQueuedChunks = 1024`, `maxQueuedBytes = 4 MiB`), overflow notifications, and exact offset reconciliation (`reconcileTerminalOutput`).
  - `AgentStatusReducer` (`features/terminal/AgentStatusReducer.kt`): Authoritative state reducer handling `applySnapshot`, `applyStatusChanged`, `applyStatusRemoved`, and `applyStatusInvalidated` with epoch/revision fencing and non-reentrant mutex deadlocks eliminated by hoisting snapshot reload.
  - `TerminalSessionController` (`features/terminal/TerminalSessionController.kt`): Retained session state controller decoupled from Compose lifecycle, managing PTY incarnation, offset tracking, replay gate lifecycle, raw input sink, ANSI arrow/navigation encoding, and bracketed paste wrapping.
  - `TerminalInputController` (`platform/terminal/TerminalInputController.kt`): Android platform bridge for hardware key events (`KeyEvent`), IME text commits (`onImeCommitText`), IME backspace (`onImeDeleteBackward`), and clipboard paste.
  - `AndroidTerminalSurface` (`platform/terminal/AndroidTerminalSurface.kt`): Native terminal surface contract implementation with in-memory buffer, bracketed paste wrapping, text selection, and search.
  - `TerminalScreens` (`features/terminal/TerminalScreens.kt`): Compose UI for `TerminalPanelScreen` (session tabs, inline accessory bar) and `AgentsPanelScreen` (agent filter chips, status roster, jump-to-session action).
  - `WorkbenchScreen` (`ui/screens/WorkbenchScreen.kt`): Host integration wiring `terminalContent` and `agentsContent` into `PanelHost`, centralized `getOrCreateController`, worktree target forwarding, and profile transition cleanup.
- **Verified Acceptance Evidence & Open Qualification:**
  - 45 Static Invariant Assertions passing in `tests/test-phase-07-terminal-agents.sh` verifying session CRUD contracts, stream reconciliation logic, agent status reducer fencing, input gating, zero FABs, and `adjustResize` window insets.
  - 327 Cumulative Invariant Assertions passing across all Phases 02–07 static test scripts (100% pass rate).
  - Recorded QA Report (`plans/reports/qa-261016-0200-reverify-phase-07-terminal-agents.md`) notes 155 passing unit tests: 103 shared JVM tests in `:shared:jvmTest` (`AgentStatusReducerTest`, `TerminalReplayGateTest`, `TerminalRepositoryTest`, `TerminalSessionControllerTest`) and 52 Android unit tests in `:androidApp:testDebugUnitTest` (`TerminalInputControllerTest`, `AndroidTerminalSurfaceTest`), plus 5 Rust crypto-bridge unit tests.
  - Clean debug APK build: `:androidApp:assembleDebug` succeeded (65 actionable tasks).
  - Code Review Score: 8.8 / 10 (Cycle 2 Review `plans/reports/code-review-261016-0205-phase-07-terminal-agents-cycle-2.md`) with Cycle 1 critical deadlock, cross-profile controller leak, attachment race, and worktree routing verified remediated on host.
  - *Open Qualification Gates:* Live emulator canvas integration in `TerminalScreens`, physical ConnectBot `libvterm.so` JNI binding, physical device IME candidate composition, window insets during soft keyboard transitions, and real server-backed WebSocket PTY streaming qualification deferred to Phase 18.

### 7.11 Phase 08 Filesystem Watchers, Search and Replace Baseline
- **Required Invariants:**
  - Target-qualified filesystem operations: File, directory, stat, read, and mutation operations forward the specified `ProjectTargetRef` without ambient profile fallbacks; operations do not independently validate `target.profileId` against captured connection generations in commonMain.
  - Chunked write serialization & CAS: `FsWriteCoordinator` serializes chunked frames under coroutine `Mutex` with monotonic `reqId` allocated by `WsConnection`. Expected mtime compare-and-swap (CAS) is passed in `fs:write_begin` (`expected_mtime`).
  - Live tree subscription & buffering: `TreeSubscriptionManager` buffers incoming `fs:event` and `fs:overflow` messages via an in-memory channel before the subscribe request completes, filtering events by `subId` and protecting unsubscriptions with generation fencing (current unbounded channel carries memory risks under high server event volumes).
  - Watcher scope boundary: Live directory watching is currently bounded to the root directory without automatic per-subfolder subscriptions. Rebind on reconnect triggers only when `activeSubscription == null`.
  - Inline UI presentation & zero FABs: `FilesPanelScreen` docks Explorer and Search & Replace subtabs within the single content area; inline `FilesTopBar`; modal dialogs in `FileModalsHost` preserve input on error with zero floating action buttons.
  - Bounded federated search: Search queries across connected profile bindings enforce an aggregate 500-match cap, isolate partial profile failures, and map workspace matches to their originating project targets.
  - Conservative replacement execution: Search-and-replace executes literal non-regex replacements using frozen search specifications; preview aggregates match counts per file; batch execution verifies match presence and applies read-to-write CAS; an authoritative dirty-buffer provider interface remains an open data-safety gate pending Phase 09.
- **Implemented Mechanisms:**
  - `FileModels` (`features/files/FileModels.kt`): `DirEntryDto`, `ListResponseDto`, `FileStatDto`, `FsFileReadResult`, `FileTreeNode`.
  - `FileRepository` (`features/files/FileRepository.kt`): REST `/api/fs/list` and `/api/fs/stat`, WebSocket `FsRead`, `FsWrite` via `FsWriteCoordinator`, `FsOp` via `executeFsOp`.
  - `FsWriteCoordinator` (`features/files/FsWriteCoordinator.kt`): Mutex-guarded chunked writes with monotonic `reqId` and expected mtime CAS.
  - `TreeSubscriptionManager` (`features/files/FileTreeSubscription.kt`): Early-buffered channel before subscribe response, subId filtering, generation fencing.
  - `FileTreeState` (`features/files/FileTreeState.kt`): Lazy folder expansion, virtualized rows (`FileTreeItemView`), hidden-file toggle, selection highlight, `fs:event` path mapping, `fs:overflow` recovery.
  - `FileMutationCoordinator` (`features/files/FileMutationCoordinator.kt`): Create file/dir, rename, delete.
  - `SearchRepository` (`features/files/SearchRepository.kt`): REST content/path search.
  - `FederatedSearchCoordinator` (`features/files/FederatedSearchCoordinator.kt`): Parallel search across profiles, 500-match cap, error isolation, workspace target mapping.
  - `ReplaceCoordinator` (`features/files/ReplaceCoordinator.kt`): Literal replacement, match count previews, sequential batch apply with read-to-write CAS.
  - `FilesPanelScreen` (`features/files/FileScreens.kt`), `FilesTopBar`, `SearchReplaceView`, `ReplacePreviewCard`, `FileActionDialogs`, `FileModalsHost`.
  - `WorkbenchScreen` (`ui/screens/WorkbenchScreen.kt`): Wiring `filesContent` in `PanelHost`, federated bindings effect, profile target forwarding.
- **Verified Acceptance Evidence & Open Qualification:**
  - 57 Static Source Assertions passing in `tests/test-phase-08-filesystem-watchers.sh` verifying models, REST/WS contracts, watcher lifecycle, search federation, replace coordinator, and zero FABs.
  - 384 Cumulative Static Assertions passing across all Phases 02–08 static test scripts (100% pass rate).
  - Automated verification evidence (dated QA report `plans/reports/qa-261016-0613-reverify-phase-08-filesystem-watchers.md`): 194 automated test executions passed across `:shared:jvmTest` (116) and `:androidApp` debug/release unit tests (39 debug + 39 release executions covering the same 39 test methods); clean `:androidApp:assembleDebug` (65 actionable tasks).
  - Cycle 2 review score 6/10 (`plans/reports/code-reviewer-261016-0617-phase-08-cycle-2-filesystem-watchers.md`): Cycle 1 critical race and modal crash closed; baseline accepted via user approval with recorded open limitations: lossy UTF-8 replace fallback, timeout-as-cancellation batch abort, root-only directory watcher without subfolder re-subscription, secondary-profile display-name target resolution, dirty-buffer provider unwired pending Phase 09 editor, and outcome UI detail. Physical device execution, real server-backed WebSocket integration, and open safety gates deferred to Phase 18.

### 7.12 Phase 09 Native Editor, Language Services & Safe Saves Baseline
- **Required Invariants:**
  - Exact file tier size boundaries (`FileTierPolicy`):
    - Normal tier: `< 1 MiB` (`NORMAL_MAX_BYTES = 1,048,576` bytes). Full in-memory text buffer editable with syntax intelligence and undo/redo.
    - Degraded tier: `>= 1 MiB` and `< 5 MiB` (`DEGRADED_MAX_BYTES = 5,242,880` bytes). Full in-memory text buffer editable; language service processing gated or optimized.
    - Large tier: `>= 5 MiB`. Read-only partial viewing via bounded 64 KiB (`LARGE_CHUNK_BYTES = 65,536` bytes) range paging (`loadLargeFileRange`, `LargeFileView`); full buffer loading prohibited.
    - Binary tier: Read-only raw binary hex inspection (`BinaryHexView`, Base64 payload decoding).
    - Image & Video tiers: Preview-only via `MediaPreviewCard`; excluded from text decoding or editor mutation paths (`isPreviewOnlyFile == true`).
    - Diff tier: Git diff view routed to diff viewer (retained for Phase 10).
    - Safe UTF-8 decoding: `decodeUtf8Safe` safely drops incomplete trailing multi-byte UTF-8 sequences (1–3 bytes) at 64 KiB chunk boundaries to prevent Unicode replacement character corruption (`\uFFFD`).
  - Safe-save protocol:
    - Submitted-bytes snapshot tracking: `EditorSession.beginSave()` captures an immutable text snapshot and records `submittedContent` and `submittedEpoch`. Upon save completion, `completeSave(savedMtime, submittedSnapshot)` updates `savedContent` and `serverMtime`, then authoritatively recalculates `isDirty = (getText() != savedContent)` so that intermediate user edits typed while the save was in flight are never lost. `abortSave()` clears submitted state.
    - Compare-and-swap (CAS) mtime protection: `EditorRepository.saveFile` supplies `expectedMtime` to `fileRepository.writeFile`. If remote mtime differs, the server rejects the write and yields `EditorSaveResult.Conflict`, prompting `SaveConflictDialog` (reload vs force-overwrite). Guarded force overwrite re-stats the file to obtain fresh mtime before saving.
    - Atomic tab transforms: `EditorTabSaveCoordinator` applies functional state transforms to the latest current tab state (`transformTab { current -> current.copy(...) }`) rather than stale captured snapshots, preventing race conditions with concurrent edits.
    - UnknownOutcome timeout handling: Timeouts occurring after commit transmission (`TimeoutCancellationException`) return `EditorSaveResult.UnknownOutcome` instead of retrying or failing silently, informing the user that server state must be verified before retrying.
    - Clean auto-reload vs dirty stale flags: On filesystem watcher modification events (`handleRemoteFileModified`), clean tabs (`!tab.isDirty`) automatically reload fresh server content; dirty tabs retain local modifications and are marked `isStale = true` with an inline conflict notice, preventing remote reads from clobbering unsaved edits.
    - Explicit discard: `discardAndReloadTab(key)` forces reloading from server and clears dirty/stale flags.
    - Authoritative dirty-buffer wiring: `EditorTabsState.isDirtyFile` is wired to `WorkbenchScreen` and injected into `ReplaceCoordinator`, preventing search-and-replace batch operations from clobbering unsaved buffers (`ReplaceFileOutcome.SkippedDirty`).
  - Solitary navigation & zero FABs: Single horizontal scrolling button row below header; all editor controls (tab row, action buttons, conflict dialogs) are docked inline within `EditorScreens` and `EditorTopBar`; zero floating action buttons (`FloatingActionButton`, `ExtendedFloatingActionButton`).
- **Implemented Mechanisms:**
  - `FileTierPolicy` (`features/editor/FileTierPolicy.kt`): Size constants (`1 MiB`, `5 MiB`, `64 KiB`), file extension classifiers, `determineTier`, `isPreviewOnlyFile`, `decodeUtf8Safe`.
  - `EditorModels` (`features/editor/EditorModels.kt`): `EditorTab`, `PersistedTabMetadata` (strictly excludes dirty text content), `TextPosition`, `TextRange`, `TextEdit`, `FindReplaceState`, `buildEditorTabKey`.
  - `EditorSession` (`features/editor/EditorSession.kt`): Retained document session managing text buffer, `serverMtime`, `savedContent`, `submittedContent`, monotonic `modelVersion`, `editEpoch`, `isDirty`, cursor/selection, and bounded undo/redo (`EditorUndoManager`).
  - `EditorRepository` (`features/editor/EditorRepository.kt`): Target-bound file loader, safe CAS save, guarded force-overwrite, and timeout handling yielding `EditorSaveResult.UnknownOutcome`. Encrypted save fail-closed check.
  - `EditorTabSaveCoordinator` (`features/editor/EditorTabSaveCoordinator.kt`): Orchestrates save and force-overwrite using atomic tab transforms.
  - `EditorTabsState` (`features/editor/EditorTabsState.kt`): Multi-tab management, active tab selection, clean-only auto-reload, dirty stale flag, `discardAndReloadTab`, 64 KiB `loadLargeFileRange`, and `isDirtyFile`.
  - `LanguageService` (`features/editor/LanguageService.kt`) & `TsJsLanguageService` (`features/editor/TsJsLanguageService.kt`): `JsonLanguageService` (AST diagnostics & symbols), `TsJsLanguageService` (delimiter matching and keyword scanning with quote-before-comment precedence), `TypeScriptLanguageServiceAudit` (formal audit record), `LanguageServiceCoordinator` (monotonic request/response watermarks).
  - `AndroidLanguageService` (`platform/editor/AndroidLanguageService.kt`): Android platform dispatcher mapping file extensions to language services.
  - UI Components (`features/editor/`): `EditorPanelScreen`, `EditorTopBar`, `LargeFileView`, `BinaryHexView`, `MarkdownPreviewView` (with Mermaid deferred banner), `MediaPreviewCard`, `SaveConflictDialog`, and `WorkbenchScreen` integration.
- **Documented Open Limitations:**
  1. Native Editor Canvas: Current live editor surface uses Compose `TextField` with candidate adapter metadata indicator; physical Sora Editor (`io.github.rosemoe.sora-editor`) native canvas binding and AAR relinking qualification are deferred to Phase 18 device qualification.
  2. TypeScript/JavaScript Semantic Intelligence: Formally BLOCKED per `TypeScriptLanguageServiceAudit` (`BLOCKED_PENDING_RUNTIME_DECISION`); remote server lacks LSP daemon and web-workers are excluded; native runtime requires embedded QuickJS/Hermes engine or server-side LSP routing. Delimiter/keyword syntax scanner active as interim heuristic.
  3. Encrypted File Save: Encrypted mode toggle fails closed with explicit error (`Encrypted save requires Phase 11 owner-bound crypto session`) until Phase 11 crypto session implementation; plaintext fallback is strictly prohibited.
- **Verified Acceptance Evidence & Open Qualification:**
  - 70 Static Invariant Assertions passing in `tests/test-phase-09-editor-saves.sh` covering tier boundaries, session models, safe saves, multi-tab state, language services, UI components, and zero FABs.
  - 454 Cumulative Invariant Assertions passing across all 8 static test scripts (Phases 02–09, 100% pass rate).
  - 219 Unit Test Executions passing (141 in `:shared:jvmTest`, 39 in `:androidApp:testDebugUnitTest`, 39 in `:androidApp:testReleaseUnitTest` across 180 unique test methods per QA report `plans/reports/qa-261016-0718-phase-09-editor-saves-cycle-3.md`), plus clean `:androidApp:assembleDebug` build (55 actionable tasks).
  - Code Review Score: 6/10 (Cycle 2 Review `plans/reports/code-reviewer-261016-0709-phase-09-editor-saves-cycle2.md`), accepted via user approval with documented open limitations. Physical device qualification, Sora native canvas, and live server WebSocket saves deferred to Phase 18.

### 7.13 Phase 10 Native Diff, Merge Conflict Resolution and Git Blame Baseline
- **Required Invariants:**
  - Native diff review & layout mode parity: Support both side-by-side (`DiffLayoutMode.SIDE_BY_SIDE`) and inline (`DiffLayoutMode.INLINE`) diff views. Bounded computation budget (`MAX_DIFF_LINES = 10_000`) prevents UI unresponsiveness on oversized inputs.
  - Server-correlated hunk mapping: Map local diff lines to server `HunkInfo` (`newStart`, `newLines`, `oldStart`, `oldLines`), assigning authoritative `hunkIndex` to corresponding diff rows.
  - Fail-closed hunk discard & safety guards: `DiffReviewController.discardHunk` resolves the mapped server hunk and dispatches `DiscardHunkRequest` to `POST /api/git/{project}/discard-hunk`. Discard is strictly rejected if:
    1. The diff is read-only (`isReadOnly = true`, applicable to commit diffs, deleted-only files, or binary files).
    2. Local unsaved diff modifications are present (`isModifiedDirty = true`).
    3. Active editor session contains unsaved in-memory buffer edits (`isDirtyBufferProvider(target, path) == true`).
  - Compare-and-swap (CAS) baseline mtime saves: Modifying working-tree diff drafts updates `modifiedDraft` and sets `isModifiedDirty = true`. Saving invokes `saveModified(fileRepo)` with expected mtime protection (`baselineMtime` captured via `/api/fs/stat` on current `loadDiffSeq`). Conflicts return explicit error without silent overwrite.
  - Commit diff navigation: Historical commits load in read-only mode (`commitHash != null`). `exitCommitDiff()` returns directly to working-tree diff view.
  - Robust 2-way and 3-way/diff3 conflict marker parsing: `ConflictParser` parses standard 2-way (`<<<<<<<`, `=======`, `>>>>>>>`) and 3-way/diff3 (`<<<<<<<`, `|||||||`, `=======`, `>>>>>>>`) markers, preserving labels (`ourLabel`, `ancestorLabel`, `theirLabel`) and newline conventions (CRLF / LF).
  - Conflict resolution integrity:
    - Target-specific block resolution via `ConflictSide` (`OURS`, `THEIRS`, `ANCESTOR`, `BOTH_OURS_FIRST`, `BOTH_THEIRS_FIRST`) and batch resolution (`acceptAll`).
    - `hasMalformedConflicts` rejects malformed blocks (unmatched delimiters, missing separators, excess ancestors).
    - `hasRemainingConflicts` confirms no opening markers (`<<<<<<<`) remain before allowing resolution.
    - `markResolved()` strictly validates `allResolved && !isMalformed` before submitting `ResolveConflictRequest` to `POST /api/git/{project}/resolve`.
  - Buffer safety & line count metrics for blame: Enforce 5 MiB UTF-8 threshold (`GIT_BLAME_MAX_BUFFER_BYTES = 5 * 1024 * 1024`). `computeBufferLineCount` preserves CRLF and LF layout metrics for exact editor display alignment.
  - Keystroke debounce & coroutine job cancellation: `BlameRepository.requestBlameDebounced` applies 250 ms debounce (`GIT_BLAME_DEBOUNCE_MS`), cancelling prior in-flight coroutine jobs for the target file key (`"${target.project}:${target.worktreePath ?: ""}:$path"`). Visible gutter annotations are immediately wiped on buffer changes (`lineAttributions = null`).
  - Strict partition validation: `BlameValidator.validateBlameResponse` enforces integral bounds, echo matching (`snapshotId`, `modelVersion`), display line count matching, contiguous non-overlapping partition covering `[1..bufferLineCount]`, and valid commit index references with `null` indices designated as Uncommitted.
  - Bounded multi-dimensional LRU cache: `BlameCache` retains up to 64 completed blame responses within a 32 MiB memory budget. Cache keys (`BlameCacheKey`) incorporate profile ID, generation, project, worktree path, root ID, HEAD OID, repository epoch, relative path, and SHA-256 buffer fingerprint (`computeSha256`). Target epoch advancement (`advanceTargetEpoch`) and owner retirement (`retireOwner`) provide lifecycle invalidation capability interfaces.
  - Gutter presentation & commit inspection: `EditorBlameGutter` displays 6-character commit hashes and 8-character author names. Clicking an attributed commit triggers `onInspectCommit`, which routes to `diffController.loadDiff(project, target, path, commitHash)` and navigates to the `DIFF` panel without clobbering dirty editor buffers. Standalone `CommitRevealRequest` and `CommitRevealCoordinator` provide nonce-bound coordination models for cross-surface commit reveal; active `WorkbenchScreen` integration routes directly using navigation target snapshot.
  - Zero FABs & inline workbench integration: `DiffReviewScreen`, `MergeConflictScreen`, and `EditorPanelScreen` are docked inline within `WorkbenchScreen` and `PanelHost`. Zero floating action buttons across all review surfaces; navigation is driven exclusively via the single horizontally scrolling top navigation row (`PanelNavigationRow`). Platform metadata records are maintained in `NativeReviewSurfaces`.
- **Implemented Mechanisms:**
  - `DiffModels` (`features/git/DiffModels.kt`): `FileDiffContent`, `GitLineChange`, `HunkInfo`, `DiffLayoutMode`, `DiffLineType`, `DiffRow`, `DiscardHunkRequest`, `FileDiffQuery`.
  - `DiffCalculator` (`features/git/DiffCalculator.kt`) & `LcsDiffEngine` (`features/git/LcsDiffEngine.kt`): 10,000-line capped diff calculation, side-by-side and inline row builders, server hunk index mapping.
  - `DiffReviewController` (`features/git/DiffReviewController.kt`): Load diff, hunk discard mapping, dirty buffer/modified guards, CAS baseline mtime saves, commit diff inspection and `exitCommitDiff()`.
  - `MergeConflictModels` (`features/git/MergeConflictModels.kt`): `ConflictFile`, `ResolveConflictRequest`, `ConflictRegion`, `ConflictSide`.
  - `ConflictParser` (`features/git/ConflictParser.kt`): 2-way and 3-way/diff3 conflict marker parsing, `hasMalformedConflicts`, `hasRemainingConflicts`, `acceptConflict`, `acceptAll`.
  - `MergeConflictController` (`features/git/MergeConflictController.kt`): Load conflicts, select file, accept conflict blocks, dirty state tracking, and validated `markResolved()`.
  - `BlameModels` (`features/editor/BlameModels.kt`): `GitBlameInput`, `GitBlameCommit`, `GitBlameRange`, `GitBlameStatus`, `GitBlameResponse`, `BlameLineAttribution`, size and debounce constants.
  - `BlameValidator` (`features/editor/BlameValidator.kt`): `computeBufferLineCount`, `isBufferOverLimit`, `computeBufferFingerprint`, and `validateBlameResponse`.
  - `BlameCache` (`features/editor/BlameCache.kt`): Bounded 64-entry / 32 MiB LRU cache, `BlameCacheKey`, `advanceTargetEpoch`, `retireOwner`.
  - `Sha256Digest` (`core/crypto/Sha256Digest.kt`, JVM, Android): KMP expect/actual SHA-256 byte and string hashing.
  - `BlameRepository` (`features/editor/BlameRepository.kt`): Debounced blame requests, coroutine cancellation per file key, cache lookup, partition validation, and line attribution derivation.
  - `CommitRevealRequest` (`features/editor/CommitRevealRequest.kt`): `CommitRevealRequest`, `CommitRevealCoordinator` with owner and target validation.
  - UI Components: `DiffReviewScreen`, `DiffRowItem`, `MergeConflictScreen`, `EditorBlameGutter`, `EditorTopBar` blame toggle, `EditorScreens`, `NativeReviewSurfaces`, and `WorkbenchScreen` integration.
- **Documented Open Limitations (per recorded Cycle 5 Review):**
  1. Merge completion navigation race: `onResolved` in `WorkbenchScreen` checks `conflictFiles` snapshot after triggering asynchronous `loadConflicts`. If reload completes before check, navigation logic may evaluate modified list; resolution state is safe via `allResolved = false` reset.
  2. `loadConflicts` loading state: `finally` block clears `isLoading` while nested `selectFile` fetch is in flight, creating potential spinner flicker.
  3. Non-default root save & draft preservation: `saveModified` writes using `target` only without `query.root` specialization; `loadDiff` executed after save resets concurrent in-flight edits typed during save.
  4. Controller unit test coverage: `DiffReviewController` and `MergeConflictController` currently lack dedicated unit tests (Phase 10 verification script covers 77 structural/model assertions; unit tests cover `BlameValidator`, `BlameCache`, `Sha256Digest`, `LcsDiffEngine`, `DiffCalculator`, `ConflictParser`).
  5. Asynchronous row recomputation: `recomputeRows` dispatches to `Dispatchers.Default` without monotonic sequence ordering, risking out-of-order completion on rapid layout mode toggles.
  6. Swallowed stat error: Failure during `/api/fs/stat` leaves `baselineMtime` null, causing saves to report missing baseline mtime without pre-surfacing the underlying filesystem stat failure.
  7. Physical device qualification: Live emulator canvas integration, physical touch/scroll gestures, Sora native canvas relinking, and real server-backed WebSocket integration remain open qualification gates deferred to Phase 18.
- **Verified Acceptance Evidence & Open Qualification:**
  - 77 Static Invariant Assertions verified in `tests/test-phase-10-diff-merge-blame.sh` covering wire models, diff calculation, hunk operations, conflict parsing, blame validation, cache bounds, reveal models, and zero FABs.
  - 531 Cumulative Invariant Assertions recorded across all 9 static test scripts (Phases 02–10, 100% pass rate).
  - 246 Automated Unit Tests passing across `:shared:jvmTest` and `:androidApp` test suites (per QA reports `qa-261016-0804-phase-10-diff-merge-blame.md` and `qa-261016-0917-phase-10-cycle-2-verification.md`).
  - Clean Kotlin compilation: `:shared:compileKotlinJvm` verified without errors (per Cycle 5 review).
  - Code Review Score: 9/10 (Cycle 5 Review `plans/reports/code-reviewer-261016-1030-phase-10-cycle-5.md`), accepted via user approval with documented open limitations.

### 7.14 Phase 11 Encrypted Transfers, Media Streaming and Android Storage Baseline
- **Required Invariants & Scaffolding Scope:**
  - OPAQUE envelope format & wire parity: `CryptoEnvelope` implements exact parity with server `decrypt_blob` (`iv(12) || ciphertext + tag(16)`), with `IV_LENGTH = 12`, `TAG_LENGTH = 16`, `METADATA_MAX_LENGTH = 4096`, packing metadata JSON (`FileBlobMetadata`/`TextBlobMetadata`), 0x00 delimiter, and content bytes.
  - Crypto session lifecycle & zeroization: `CryptoSession` holds the derived 32-byte AES-256-GCM key, implements `AutoCloseable`, and zeros key memory on `close()` (`keyBytes.fill(0)`), with documented JVM GC zeroization limitations. Generation validation via `assertValid(expectedOwner)`.
  - Fail-closed encrypted save: `EditorRepository.saveFile` and `forceOverwrite` enforce `if (encryptedRequested)` check without fallback to plaintext if crypto session is unavailable or fails. `EncryptedSaveCoordinator` coordinates conflict-aware `saveEncrypted` (using expected mtime CAS) and explicit single-blob `forceOverwriteEncrypted` (`fs:put_save` atomic pair).
  - Chunked binary transfer state machine: `TransferCoordinator` implements acknowledged binary header/chunk frames (`DEFAULT_CHUNK_SIZE = 64 KiB`, `MAX_FILE_SIZE = 100 MiB` enforced envelope/document limit where applicable) via `wsConnection.sendAtomicPair`. Ack listeners are registered before frame dispatch; `UnknownOutcome` is returned on in-flight commit timeout.
  - Android SAF document storage: `AndroidDocumentStorage` implements the `DocumentStorage` interface, operating on scoped content URIs without broad storage permissions; enforces `MAX_DOCUMENT_BYTES = 100 MiB`, filename sanitization (`sanitizeFilename`), and bounded streaming (`streamFromUri`, `streamToUri`).
  - Media client security boundaries & cookie isolation: `AndroidMediaClient` enforces UUIDv4 `mediaClientId`, namespaced session cookie (`damhopper-media-session-<uuidv4>`), strict same-origin checks (`assertSameOrigin`), redirect rejection (`followRedirects(false)`, `followSslRedirects(false)`), and purpose-scoped capabilities (`PLAYBACK` vs `DOWNLOAD`).
  - Native media presentation & zero FABs: `AndroidVideoSurface` utilizes `SurfaceView` and `MediaPlayer` backed by `LeaseMediaDataSource`; `MediaPreviewCard` renders file metadata and optional SAF download button; zero floating action buttons (`FloatingActionButton`, `ExtendedFloatingActionButton`).
- **Implemented Mechanisms:**
  - `CryptoEnvelope` & `CryptoSession` (`core/security/CryptoEnvelope.kt`, `CryptoSession.kt`).
  - `PlatformCrypto` expect/actual (`core/security/PlatformCrypto.kt`, `PlatformCrypto.jvm.kt`, `PlatformCrypto.android.kt`).
  - `OpaqueClientBridge` & Rust bridge (`platform/crypto/OpaqueClientBridge.kt`, `crypto-bridge/src/lib.rs`).
  - `TransferCoordinator` (`features/files/TransferCoordinator.kt`) and `FileRepository` integration (`features/files/FileRepository.kt`).
  - `EncryptedSaveCoordinator` (`features/editor/EncryptedSaveCoordinator.kt`) and `EditorRepository` wiring (`features/editor/EditorRepository.kt`).
  - `AndroidDocumentStorage` (`platform/storage/AndroidDocumentStorage.kt`).
  - `MediaModels` & `AndroidMediaClient` (`features/media/MediaModels.kt`, `platform/media/AndroidMediaClient.kt`).
  - `AndroidVideoSurface` & `MediaPreviewCard` (`platform/media/AndroidVideoSurface.kt`, `features/editor/MediaPreviewCard.kt`, `EditorScreens.kt`).
  - `WorkbenchScreen` host integration (`ui/screens/WorkbenchScreen.kt`).
- **Documented Open Limitations & Implementation Gaps (per Cycle 2 Review):**
  1. Encrypted save unreachable in production: OPAQUE login finish does not wire session into `CryptoSessionManager.setSession` (zero production callers); editor UI lacks encryption toggle; provider in `WorkbenchScreen` uses blocking call on commonMain thread.
  2. Media and SAF stack lack production consumers: `AndroidMediaClient`, `AndroidVideoSurface`, `LeaseMediaDataSource`, and `AndroidDocumentStorage` are declared but unwired from production UI/workflows (no SAF picker/ActivityResult, no ticket issue/revoke lifecycle, no image renderer; `MediaPreviewCard` renders descriptive placeholder text without media display).
  3. Cookie capture not fail-closed: `cookie.contains(name)` matching is permissive and allows null `cookieHeader` in `MediaLease` rather than throwing fail-closed `MediaException` at issue time; UUID validation checks version 4 but does not sanitize non-canonical representation.
  4. Unbounded `readRangeSync`: `response.body.bytes()` buffers the full response body into memory when the server returns 200 or 206 larger than requested, risking OOM on large media files.
  5. Partial generation fencing: Initial owner assertion occurs before transfer/encryption, but revalidation across subsequent asynchronous boundaries and full-operation fencing is not completed in all consumer paths.
  6. Envelope implementation duplication: Rust JNI exports (`nativeEncryptEnvelope`, `nativeDecryptEnvelope`) and Kotlin `CryptoEnvelope` maintain parallel implementations without single source of truth.
- **Verified Acceptance Evidence & Open Qualification:**
  - 84 Static Invariant Assertions passing in `tests/test-phase-11-encrypted-transfers-media.sh` verifying cryptographic models, transfer coordinator state machines, encrypted save wiring, SAF storage interface, media client security configuration, and zero FABs.
  - 615 Cumulative Static Assertions passing across all 10 static test scripts (Phases 02–11, 100% pass rate).
  - 7 Rust unit/parity tests passing in `native-app/crypto-bridge` (`cargo test --offline`).
  - Automated JVM/Android unit tests compiled and passing in `:shared:jvmTest` and `:androidApp:testDebugUnitTest`.
  - *Open Qualification Gates Deferred to Phase 18:* Physical ARM64 device qualification, 16 KiB kernel page size execution, real server-backed WebSocket chunked transfer interop, live server OPAQUE encrypted save roundtrip and tamper detection, media seek/playback with real device hardware decoders, and same-host two-profile media cookie isolation.

### 7.16 Phase 13 Workflow Tracking and Project Plans Baseline
- **Required Invariants & Scaffolding Scope:**
  - Multi-product workflow surface: Single authoritative panel host `WorkflowPanelScreen` under `WorkbenchPanel.WORKFLOW` with top segmented selector between manual workflow tracking (`WorkflowSubProduct.TRACKING`) and read-only project plans (`WorkflowSubProduct.PROJECT_PLANS`).
  - Workflow domain contracts (W01): `WorkflowModels.kt` declaring typed enums (`ItemKind`, `ItemStatus`, `SessionStatus`, `ResourceLinkType`, `ResourceObservedState`, `WorkflowSource`), DTOs (`ItemDto`, `SessionDto`, `LinkDto`, `NoteDto`, `EventDto` with nullable target, `WorkflowOverviewDto`, `WorkflowEventsDto`, `PurgeDto`), mutation requests with custom `PatchItemRequestSerializer`, and `WorkflowDomainHelpers` (hierarchy validation `isValidParentKind`, valid status transitions `isValidStatusTransition`, progress formatting `formatTrackedTasksProgress`).
  - Workflow repository & controller: `WorkflowRepository` executing protected REST operations (`/api/workflow/overview`, `/events`, items, sessions, notes, purge); RFC4122 v4 UUID request identity generation; HTTP 404 detection for profiles without workflow tracking enabled (`WorkflowOverviewResult.Unavailable`). `WorkflowController` enforcing multi-server profile and generation fencing via `updateContext`, optimistic CAS conflict preservation (`conflictWarning = "Item was modified remotely. Your draft was preserved."`), and explicit non-blocking manual lifecycle (terminal exit never auto-completes tasks).
  - Workspace history purge safety: History purge confirmation dialog (`PurgeHistoryDialog`) explicitly labelled workspace-wide ("Purge All Workspace History", deleting events across all workspace projects).
  - Project plans domain & repository (W02): `ProjectPlansRepository` querying `/api/plans/folders` and `/api/plans` (with camelCase `planPath` parameter); strict path traversal guards rejecting absolute paths, leading slashes, parent segments (`..`, `.`), and external URLs (`http://`, `https://`).
  - 64 KiB bounded reads: `PlanConstants.MAX_DOCUMENT_BYTES = 64 * 1024` document read ceiling via `FileRepository` with `maxBytes + 1` range requests, mapping excess sizes to `PlanDocumentReadResult.Oversize`.
  - Hierarchical plan navigation: `ProjectPlansController` folder browsing, auto-open on `PLAN` kind folder (`selectPlan(response.path)`), hierarchical back-stack navigation (`handleBack()`), target switching via `updateTarget`. System back integration in `WorkbenchScreen` delegates to `projectPlansController.handleBack()` when `activePanel == WORKFLOW && workflowActiveSubProduct == PROJECT_PLANS`.
  - Native UI presentation & zero FABs: `WorkflowScreens.kt`, `WorkflowModals.kt`, `WorkflowSessionsAndEventsView.kt`, `ProjectPlanScreens.kt`, and `WorkflowPanelScreen.kt` enforcing zero floating action buttons (`FloatingActionButton`, `ExtendedFloatingActionButton`) and zero WebViews (`WebView`).
  - Exception B02 compliance: Markdown documents rendered natively via `MarkdownPreviewView`. Mermaid diagrams display an explicit rendering-unavailable notice (`⚠ Mermaid rendering deferred for this release`) adhering to approved exception B02.
- **Implemented Mechanisms:**
  - Repositories: `WorkflowRepository`, `ProjectPlansRepository` (`features/workflow/`).
  - Controllers: `WorkflowController`, `ProjectPlansController` (`features/workflow/`).
  - Models: `WorkflowModels.kt`, `ProjectPlanModels.kt` (`features/workflow/`).
  - Views & Modals: `WorkflowPanelScreen.kt`, `WorkflowScreens.kt`, `WorkflowModals.kt`, `WorkflowSessionsAndEventsView.kt`, `ProjectPlanScreens.kt`.
  - Host integration: `WorkbenchScreen.kt` (wiring both controllers, target update, and `panelBackHandler`).
- **Documented Open Limitations & Implementation Gaps (per Review & Ledger):**
  - 1. Ephemeral client-side session links: Server overview returns no link collection endpoint; session links and observed states exist client-side only and clear on context update/refresh.
  - 2. Workspace-wide purge destructive scope: Server purge deletes events across all projects in the workspace; native UI reflects workspace-wide scope.
  - 3. Free-text terminal/agent link: Terminal and agent linking uses free-text ID entry rather than live terminal picker from active sessions.
  - 4. Live device & WebSocket qualification: End-to-end device execution, watcher installation/rebinding, and live server interop deferred to Phase 18.
- **Verified Acceptance Evidence & Open Qualification:**
  - 100 Static Invariant Assertions verified in `tests/test-phase-13-workflow-plans.sh` across 5 suites (models, repository REST contracts, plan models/DTOs, bounded document reads, controllers, UI surfaces, and zero-FAB invariants).
  - 854 Cumulative Static Assertions passing across all 12 static test scripts (Phases 02–13, 100% pass rate).
  - 274 Automated Unit Test executions passing across `:shared:jvmTest` (224 tests) and `:androidApp:testDebugUnitTest` (50 tests).
  - Clean debug APK assembly: `pnpm native-app:assembleDebug` succeeds (65 tasks up-to-date/passing).
  - Code Review Score: 5/10 in Cycle 2, with Cycle 3 remediations resolving plan auto-open loop and workspace purge scope; baseline recorded with documented open implementation limitations deferred to Phase 18.

### 7.17 Phase 14 Agent Store, Memory and Imports Baseline
- **Required Invariants & Scaffolding Scope:**
  - Multi-product agent workbench surface: Single authoritative panel host `AgentsUnifiedPanelScreen` under `WorkbenchPanel.AGENTS` with top segmented selector between Agent Store catalog/distribution (`AgentsSubProduct.STORE`), agent memory editing/templates (`AgentsSubProduct.MEMORY`), Git repo / server-local imports (`AgentsSubProduct.IMPORT`), and live terminal observation (`AgentsSubProduct.OBSERVATION`).
  - Agent Store domain wire contracts (S01, S02): `AgentStoreModels.kt` declaring typed enums (`AgentType`, `AgentItemCategory`, `DistributionMethod`), catalog and health DTOs (`AgentStoreItem`, `DistributionStatus`, `ShipResult`, `BrokenSymlink`, `OrphanedItem`, `HealthCheckResult`, `AgentPresence`, `ProjectAgentScanResult`), action requests (`ShipRequest`, `UnshipRequest`, `AbsorbRequest`, `BulkShipRequest`), memory DTOs (`MemoryTemplateInfo`, `ProjectMemoryAgentEntry`, `ProjectMemoryDetailResponse`, `UpdateMemoryRequest`, `ApplyTemplateRequest`, `ApplyTemplateResponse`), and import DTOs (`RepoScanItem`, `ScanRepoRequest`, `ScanRepoResponse`, `ScanLocalRequest`, `ScanLocalResponse`, `ImportConfirmRequest`, `ImportResult`).
  - Repositories: `AgentStoreRepository` (REST operations for `/api/agent-store`, item content, delete, ship, unship, absorb, bulk-ship, matrix, scan, health; HTTP 404 detection for unavailable store feature; path segment encoding), `AgentMemoryRepository` (REST operations for templates, project memory CRUD, and template application), `AgentImportRepository` (Git repository clone scan, server directory scan, confirm import).
  - Controllers & lifecycle isolation: Controller-instance ownership with explicit `retire()` clearing state on profile disconnect or reconnect. `AgentStoreController` with monotonic `requestSequence` and `contentRequestSequence`. `AgentMemoryController` with monotonic `readOpRevision`, `templateOpRevision`, and `saveOpRevision`, dirty draft protection (`isDirty`) with `pendingTargetSwitch` dialog on project switch, and safe saves tracking `initialSavedContent`. `AgentImportController` with monotonic `scanRevision` tracking on source switch and reset, safe cleanup derivation (`cleanup = source == ImportSource.REPO`), and deduplication keying.
  - Native UI presentation & zero FABs: `AgentStoreScreens.kt`, `AgentDistributionMatrixView.kt`, `AgentStoreModals.kt`, `AgentMemoryScreens.kt`, `AgentImportScreens.kt`, and `AgentsUnifiedPanelScreen.kt` enforcing zero floating action buttons (`FloatingActionButton`, `ExtendedFloatingActionButton`), zero WebViews (`WebView`), and native markdown rendering via `MarkdownPreviewView`.
- **Implemented Mechanisms:**
  - Repositories: `AgentStoreRepository`, `AgentMemoryRepository`, `AgentImportRepository` (`features/agents/`).
  - Controllers: `AgentStoreController`, `AgentMemoryController`, `AgentImportController` (`features/agents/`).
  - Models: `AgentStoreModels.kt` (`features/agents/`).
  - Views & Modals: `AgentStoreScreens.kt`, `AgentDistributionMatrixView.kt`, `AgentStoreModals.kt`, `AgentMemoryScreens.kt`, `AgentImportScreens.kt`, `AgentsUnifiedPanelScreen.kt`.
  - Host integration: `WorkbenchScreen.kt` (wiring all three controllers and reducer under `agentsContent`).
- **Documented Open Limitations & Review Findings (Cycle 2 Review 7/10):**
  - 1. Save retry lockout (H1): Shared `error` field in `AgentMemoryState` locks out save retries after transient failure until target switch.
  - 2. Controller reconnect initialization (H2): Reconnect effect replacing controller without project list change can miss initial `setProjects` call.
  - 3. Stale import confirm race (H3): `confirmImport` lacks scan-revision fencing on late response application.
  - 4. Empty project list draft loss (M5): Switching to empty project list drops dirty memory drafts without a prompt.
  - 5. REPO partial-import cleanup (M3): Retaining captured scan on partial failure risks retry hitting deleted temp directory.
  - 6. Absorb action server semantics (M2): Server absorb moves project-local non-symlink items to the store; offering absorb on shipped matrix cells contradicts server distributor semantics.
  - 7. Unused repository methods: `getItem` and `listProjectMemory` lack UI callers.
  - 8. Live qualification (L1/L2): Physical Android device execution, symlink traversal across filesystems, and live temp dir deletion deferred to Phase 18.
- **Verified Acceptance Evidence & Open Qualification:**
  - 99 Static Invariant Assertions verified in `tests/test-phase-14-agent-store-memory.sh` across 6 suites (wire models, store repo, memory repo, import repo, controllers/fencing, UI surfaces, and zero-FAB invariants).
  - 953 Cumulative Static Assertions passing across all 13 static test scripts (Phases 02–14, 100% pass rate).
  - Reported 303 Automated Unit Test executions passing across `:shared:jvmTest` (252 tests) and `:androidApp:testDebugUnitTest`/`:androidApp:testReleaseUnitTest` (51 tests).
  - Clean debug APK assembly: `pnpm native-app:assembleDebug` succeeds.
  - Code Review Score: 7/10 in Cycle 2 (CHANGES REQUESTED); baseline recorded with documented open implementation limitations deferred to Phase 18.

### 7.18 Phase 15 Host Resources Fleet Baseline
- **Required Invariants & Scaffolding Scope:**
  - Unified Resources surface: Single authoritative panel host `ResourcesUnifiedPanelScreen` under `WorkbenchPanel.RESOURCES`.
  - Host resources & alert models (H01): `HostResourceModels.kt`, `HostMetricsModels.kt`, `HostResourceAlertModels.kt` declaring typed enums (`AvailabilityState`, `AlertState`, `AlertSeverity`) and DTOs for snapshot v1, availability, memory pressure, cgroups, process inventory, CPU/disk metrics, alert summaries/incidents.
  - Streaming, coordination & atomic pairing (H01): `HostResourceSseClient` (authenticated OkHttp SSE with 256 KiB event cap), `ResourceStreamCoordinator` (per-owner subscriber counts, demand-driven visible stream vs 5s REST fallback, admission gating), `ResourceFrameCommitter` (atomic snapshot/metrics pairing, monotonic decimal revision checks, epoch restart tracking), `ResourceFailureHandler` (latching `AUTH_UNAVAILABLE` to AuthBlocked, `FRAME_TOO_LARGE` to RestOnly), and `ResourceStreamTimers` (10s initial data deadline, 45s byte idle timeout, 5 retries with backoff, 60s stable window).
  - Native UI presentation & zero FABs: `FleetScreens.kt`, `FleetDetailComponents.kt`, and `ResourcesUnifiedPanelScreen.kt` enforcing zero floating action buttons (`FloatingActionButton`, `ExtendedFloatingActionButton`), zero WebViews (`WebView`), single content host in `PanelHost`, and honest null indicators (`--`) without fabricating zero metrics.
- **Implemented Mechanisms:**
  - Repositories: `HostResourceRepository.kt` (`features/host/`).
  - Coordinators & Handlers: `ResourceStreamCoordinator.kt`, `ResourceFrameCommitter.kt`, `ResourceFailureHandler.kt`, `ResourceStreamTimers.kt` (`features/host/`).
  - Transport: `HostResourceSseClient.kt` (`core/transport/`).
  - Controllers: `HostResourceController.kt` (`features/host/`).
  - Models: `HostResourceModels.kt`, `HostMetricsModels.kt`, `HostResourceAlertModels.kt`, `ResourceStreamModels.kt` (`features/host/`).
  - Views: `FleetScreens.kt`, `FleetDetailComponents.kt`, `ResourcesUnifiedPanelScreen.kt` (`features/host/`).
  - Host integration: `WorkbenchScreen.kt` (wiring host controller under `resourcesContent`).
- **Documented Open Limitations & Review Findings (Cycle 3 Review 7/10):**
  - 1. Live qualification: Physical Android device execution, real SSE proxy buffering, and 32 global / 4 per-subject server admission limit qualification deferred to Phase 18 (Usage subproduct was retired and excised in Phase 03).
- **Verified Acceptance Evidence & Open Qualification:**
  - 81 Static Invariant Assertions verified across host resource suites (host models/DTOs, streaming/pairing/coordination, repositories/controllers, and UI/shell invariants; Usage subproduct was retired and excised in Phase 03).
  - 1034 Cumulative Static Assertions passing across all 14 static test scripts (Phases 02–15, 100% pass rate).
  - Reported 398 Automated Unit Test executions passing across `:shared:jvmTest` (272 tests) and `:androidApp:testDebugUnitTest`/`:androidApp:testReleaseUnitTest` (126 tests).
  - Clean debug APK assembly: `pnpm native-app:assembleDebug` succeeds.
  - Code Review Score: 7/10 in Cycle 3 (user approved baseline with documented open implementation limitations deferred to Phase 18).

### 7.19 Phase 16 Ports, Tunnels, Idle Consent and Host Controls Baseline
- **Required Invariants & Scaffolding Scope:**
  - Ports and Cloudflared tunnels (P01): `PortRepository` and `TunnelRepository` (`features/host/`) providing REST `/api/ports`, `/api/tunnels`, `/api/tunnels/install`; WebSocket events `PortDiscovered`, `PortLost` with monotonic incarnation sequence checking (`msg.incarnation >= existing.incarnation`); `TunnelReady`, `TunnelFailed`, `TunnelStopped`, `TunnelReminder` (`reminderDue = true`). Authoritative single content host `PortsPanelScreen` docked under `WorkbenchPanel.PORTS` with zero FABs.
  - Idle suspend & live socket capability consent (H02): `IdleSuspendRepository` and `IdleConsentController` (`features/host/`) providing REST `/api/system/idle-suspend/v1/status`, `/timing`, `/force-suspend`, `/consent/decision`; fallback normalization `decodeIdleSuspendStatusV1`; WebSocket `host:uiConnection` live receipt capability gating rejecting consent decisions when absent; typed 409 conflict exceptions (`ActiveFleet`, `FleetChanged`, `Handoff`); ticking countdown banner `WorkbenchSleepConsentBanner` with zero-expiration button lockout.
  - Remote SSH keys, host controls & diagnostics (C03): `SshRepository`, `HostControlRepository`, `DiagnosticsRepository` (`features/host/`) providing REST `/api/ssh/keys`, `/api/ssh/agent`, `/api/ssh/keys/load` with `passphrase=[REDACTED]`, per-key credential maps and forget/load operations by key basename; host actions `/capabilities`, `/intents`, `/approve`, `/executions`, `/audit` (repository scaffolding; action execution flows lack UI callers); diagnostics export `/api/diagnostics/export` with privacy default `includeTerminalOutput = false` acknowledging server memory storage. Authoritative single content host `HostControlScreens` docked under `WorkbenchPanel.SSH_HOST` with zero FABs.
- **Documented Open Limitations & Review Findings (Cycle 2 Review 7/10 — Changes Required / Qualification Open):**
  - High-1 (Action error clearing): `refreshStatus()` clears `_actionError` before render; mutation failures in `submitConsent` / `requestForceSuspend` remain unrendered in banner and force dialog.
  - High-2 (Reconnect reconciliation): Missing status reconciliation on WebSocket reconnect or new receipt; consent becoming pending while WS is down is not pushed until subsequent hint or tab switch.
  - High-3 (Default forget check): Default credential forget ignores `success=false` / `forgotten=false` / `error`; silent agent/capabilities query failures.
  - Warnings W-A through W-I: WS handler coroutine launch on every message; mixed-owner profile window during initialization; tunnel/port snapshot replacement races vs live WS updates; device clock skew vs server `expiresAtMs`.
  - Static structural assertions (194/194) assert AST/source invariants (models, routes, wire mappings, 0 FABs, 0 WebViews, redactions) without establishing dynamic Compose interaction or behavioral execution.
  - Live qualification: Physical Android hardware, live server WebSocket integration, and credential keystore binding deferred to Phase 18.
- **Verified Acceptance Evidence & Open Qualification:**
  - 194 Static Invariant Assertions verified in `tests/test-phase-16-ports-tunnels-host-controls.sh` across 6 suites (port/tunnel models, repositories, idle suspend models, consent controller, SSH/diagnostics, UI/shell invariants).
  - 1228 Cumulative Static Assertions passing across all 15 static test scripts (Phases 02–16, 100% pass rate).
  - Dated QA report recorded 417 automated unit test executions across `:shared:jvmTest` (281 tests) and `:androidApp:testDebugUnitTest`/`:androidApp:testReleaseUnitTest` (136 tests); Cycle 2 review recorded 350 unique tests (282 shared + 68 debug).
  - Clean debug APK assembly: `pnpm native-app:assembleDebug` succeeds.
  - Code Review Score: 7/10 in Cycle 2 (changes required, qualification open with documented open implementation limitations deferred to Phase 18).
