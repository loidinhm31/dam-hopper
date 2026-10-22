# DamHopper Android Native Client (`native-app`)

**Status:** The active Android entry flow is implemented as Profile Login → Project List → Project Terminal. Terminal ANR remediation uses atomic display snapshots. The remediation handoff reports 111/111 JVM terminal tests passed, `:androidApp:assembleDebug` succeeded, and a 50,000-line live-stream run on `Medium_Phone_API_36` recorded zero ANRs and zero dropped frames. Separate live-server and broader physical-device, visual, and IME qualification remain open. Broader workbench panels remain in source but are not mounted by the current root flow.
**Architecture Document:** [Android Native Client Architecture](../docs/architecture/android-native-client.md)  
**Acceptance Ledger:** [Android Native Acceptance Ledger](../docs/android-native-acceptance.md)  
**Implementation Plan:** [Android Native App Plan](../plans/261015-1647-android-native-app/plan.md)
**Terminal ANR remediation plan:** [Atomic display snapshot plan](../plans/261023-0232-android-terminal-anr-remediation/plan.md)

---

## 1. Overview

`native-app` is an Android-native implementation of the DamHopper development workbench. It connects to the existing DamHopper Rust server backend (`server/`) using REST, WebSocket, and Server-Sent Events (SSE).

Unlike `apps/native/` (which hosts the desktop application using Tauri 2 and WebView), `native-app` is built entirely with **Kotlin Multiplatform (KMP)** and **Jetpack Compose**, using platform-native Android widgets and terminal/editor rendering adapters. It does not contain or run a browser engine, WebView, local PTY, local Git, or local AI agent execution.

---

## 2. Core Mobile Flow & Navigation Lifecycle

The current app entry point is a guided three-screen flow:

| Stage | Screen | Behavior |
| --- | --- | --- |
| `PROFILE_LOGIN` | `ProfileLoginScreen` | Select or add a server profile, test reachability, authenticate (including MFA), or use Dev Login only after a server capability probe confirms development mode. |
| `PROJECT_LIST` | `ProjectListScreen` | Load workspace projects with loading, error, and empty states; refresh the list or return to Profiles / Switch. Selecting a card sets the project target. |
| `TERMINAL` | `ProjectTerminalScreen` | List and attach to PTY sessions for the selected project, reconcile replay with live output, and send commands from the inline input field. |

`MainActivity` initializes `ProfileRepository`, creates `AppFlowNavigation`, and installs the platform `BackHandler`. `DamHopperMobileApp` renders the screen selected by `AppFlowState`, which tracks the stage, profile ID, project, and active session. It reconstructs the workspace and terminal repositories when the active profile, server URL, or connection generation changes, clearing the old references before constructing owner-scoped replacements.

Back navigation is hierarchical: Terminal → Project List → Profile Login. At Profile Login, the flow leaves Back unconsumed so `MainActivity` can finish. A Back transition changes the visible stage but preserves selection fields; the active session ID can therefore be reused when returning to Terminal. The explicit Profiles / Switch action clears the session ID. Switching to a different profile clears the selected project and session; selecting a different project clears the prior session.

Leaving Terminal deactivates input and disposes the screen's local terminal controllers, but does not kill or remove the server-owned PTY. The terminal controls are inline: command input with Send, Ctrl+C, Tab, Esc, Up, Down, and Clear. Clear affects only the local display buffer. The hosted screens contain no WebView or floating action button.

The shared module still contains a separate 12-panel `WorkbenchScreen` / `PanelHost` shell. The current `DamHopperMobileApp` root does not mount that shell, so its other panel destinations are not reachable through this three-screen flow. The panel-shell contract below describes that retained subsystem, not the active app navigation.

### Physical-device development over Wi-Fi

1. Build and install the debug variant on a connected Android device:

   ```bash
   ./native-app/gradlew -p native-app :androidApp:installDebug
   ```

   On Windows PowerShell:

   ```powershell
   .\native-app\gradlew.bat -p native-app :androidApp:installDebug
   ```

2. Connect the phone and development host to the same trusted Wi-Fi network. Use the host's reachable LAN address and server port in the profile URL; `localhost` and `127.0.0.1` on a phone refer to the phone itself. The emulator preset `10.0.2.2:4803` is for the Android emulator, not a physical device. The host service must listen on a reachable interface and the host firewall must allow the chosen port on the trusted network.

3. `src/debug/res/xml/network_security_config.xml` permits cleartext traffic to any host in debug builds, not only LAN addresses. This is a transport allowance, not a security boundary. Profile Login blocks password/MFA submission over HTTP; the active REST and WebSocket request builders restrict bearer credentials to HTTPS/WSS or loopback targets. These are request-construction guards; redirect behavior is not established, and HTTP remains unencrypted. Do not expect an authenticated Wi-Fi flow over HTTP. Use HTTPS for authenticated device login; debug builds trust system and user-installed CAs, so a local development CA can be installed on the device while normal certificate and hostname validation still apply.

4. Dev Login is available only after Test Connection confirms the server's `dev_mode` capability. Treat an HTTP capability response as untrusted on a network; do not use Dev Login on an untrusted network. The server's `--no-auth` mode is loopback-only by project security policy and must not be exposed over Wi-Fi/LAN. Release network security remains TLS-only.

For a USB-connected device that needs a loopback-bound development server, `adb reverse` can forward a device-local port to the host without opening that server to the Wi-Fi network.

---

## 3. Module Architecture & Toolchain Pins

The project follows a two-module architecture established in Phase 02:

### Toolchain Pins
Defined in `native-app/gradle/libs.versions.toml` and pinned in the Gradle wrapper:
- **Gradle**: 8.11.1 (`gradle-wrapper.properties` with official SHA-256 `f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6`).
- **Android Gradle Plugin (AGP)**: 8.7.3 (`com.android.application`, `com.android.library`).
- **Kotlin**: 2.1.10 (`org.jetbrains.kotlin.multiplatform`, `org.jetbrains.kotlin.plugin.serialization`, `org.jetbrains.kotlin.plugin.compose`).
- **Compose Multiplatform**: 1.7.3 (`org.jetbrains.compose`).
- **Kotlinx Libraries**: Coroutines 1.10.1, Serialization 1.8.0, Datetime 0.6.1.
- **Ktor Client**: 3.1.0 (`ktor-client-okhttp`, `ktor-client-java` staged for Phase 03 transport).
- **Java / Bytecode Target**: Java 17 across all modules (`JavaVersion.VERSION_17`, `JvmTarget.JVM_17`).
- **Android SDK**: `minSdk 29` (Android 10+), `targetSdk 35`, `compileSdk 35`.
- **NDK ABI Filters**: `arm64-v8a` and `x86_64`.

### Implemented Project Structure

```text
native-app/
├── gradle/
│   ├── libs.versions.toml       # Pinned version catalog (AGP 8.7.3, Kotlin 2.1.10, Compose 1.7.3, Ktor 3.1.0)
│   └── wrapper/
│       ├── gradle-wrapper.jar
│       └── gradle-wrapper.properties # Gradle 8.11.1-bin with verified SHA-256
├── gradlew / gradlew.bat        # Executable Gradle wrappers
├── settings.gradle.kts          # Declares rootProject and includes :shared, :androidApp
├── build.gradle.kts             # Root build script declaring plugin aliases
├── gradle.properties            # JVM allocation and Kotlin/Android flags
├── shared/                      # Kotlin Multiplatform shared library module
│   ├── build.gradle.kts         # KMP config (Android + JVM targets, JVM 17, minSdk 29)
│   └── src/
│       ├── commonMain/kotlin/   # Domain models, Compose UI, theme (excludes Android/Swing classes)
│       │   └── dev/damhopper/nativeapp/
│       │       ├── core/        # Core models, ownership, and live transport (Phase 03)
│       │       │   ├── model/       # ConnectionRef, ProjectTargetRef, ConnectionOwnerError
│       │       │   ├── ownership/   # ConnectionRegistry (monotonic watermark ABA protection)
│       │       │   └── transport/   # ApiClient, WsConnection, SerializedWsWriter, WsRequestCorrelator,
│       │       │                    # HostResourceSseClient, WireMessages (ClientMsg, ServerMsg),
│       │       │                    # WsHandshakeUrl, WsTypes, ApiErrors, PlatformHttpEngine
│       │       ├── features/
│       │       │   ├── profiles/    # ProfileRepository, AuthRepository, ServerProfile, AuthState,
│       │       │   │                # CredentialVault, AuthAttemptTracker, AuthAttemptRef,
│       │       │   │                # ProfileMetadataStore, ProfileScreens, AuthDialog, MfaChallenge
│       │       │   ├── terminal/    # TerminalSessionController, TerminalReplayGate, TerminalRepository,
│       │       │   │                # AgentStatusReducer, TerminalScreens, TerminalModels, TerminalSurface
│       │       │   ├── workspace/   # WorkspaceRepository, ProjectTargetStore, WorkspaceScreens
│       │       │   ├── settings/    # RemoteConfigRepository, RemoteConfigEditor, RemoteConfigScreen
│       │       │   ├── files/       # FileRepository, FileTreeState, TreeSubscriptionManager, SearchRepository, ReplaceCoordinator
│       │       │   ├── editor/      # EditorSession, EditorRepository, EditorTabSaveCoordinator, EditorTabsState, BlameRepository
│       │       │   ├── git/         # GitRepository, GitChangesController, GitBranchController, GitHistoryController, DiffReviewController
│       │       │   ├── workflow/    # WorkflowRepository, WorkflowController, ProjectPlansRepository, ProjectPlansController
│       │       │   ├── agents/      # AgentStoreRepository, AgentMemoryRepository, AgentImportRepository, Controllers & Screens
│       │       │   └── host/        # PortRepository, TunnelRepository, IdleSuspendRepository, IdleConsentController,
│       │       │                    # SshRepository, HostControlRepository, DiagnosticsRepository, PortsPanelScreen,
│       │       │                    # PortsDialogs, IdleSuspendDialogs, HostControlScreens, WorkbenchSleepConsentBanner,
│       │       │                    # HostResourceRepository, UsageRepository, ResourceStreamCoordinator, UsageController
│       │       ├── model/       # WorkbenchModel.kt (WorkbenchPanel, WorkbenchState, shell invariants)
│       │       └── ui/
│       │           ├── components/ # WorkbenchHeader, PanelNavigationRow, PanelPlaceholders
│       │           ├── navigation/ # PanelRegistry, PanelNavigationRow, PanelHost, WorkbenchNavigation
│       │           ├── screens/    # WorkbenchScreen
│       │           └── theme/      # Color.kt, Type.kt, NativeTheme.kt
│       ├── commonTest/kotlin/   # Unit tests for models, ownership, serialization, shell invariants
│       │   └── dev/damhopper/nativeapp/
│       │       ├── core/        # ConnectionRegistryTest, WireSerializationTest
│       │       └── model/       # WorkbenchSerializationTest, WorkbenchStateTest
│       ├── jvmTest/kotlin/      # Transport integration tests (ApiClientTest, WsConnectionTest, HostResourceSseTest)
│       ├── androidMain/         # Android platform dependencies (PlatformHttpEngine with OkHttp)
│       └── jvmMain/             # JVM platform dependencies (PlatformHttpEngine with Java engine)
│   ├── build.gradle.kts         # Android config (minSdk 29, compileSdk 35, ABI filters, Compose)
│   ├── proguard-rules.pro       # R8 / ProGuard optimization rules
│   └── src/
│       ├── main/
│       │   ├── AndroidManifest.xml # Backup disabled, adjustResize, network security config
│       │   ├── kotlin/dev/damhopper/nativeapp/
│       │   │   ├── MainActivity.kt # Initializes repositories; hosts DamHopperMobileApp and AppFlowNavigation
│       │   │   ├── platform/
│       │   │   │   ├── crypto/      # OpaqueClientBridge (JNI companion for Rust crypto-bridge)
│       │   │   │   ├── network/     # AndroidHttpClientFactory
│       │   │   │   ├── storage/     # AndroidProfileMetadataStore (SharedPreferences)
│       │   │   │   ├── terminal/    # TerminalInputController, AndroidTerminalSurface
│       │   │   │   └── vault/       # AndroidCredentialVault (Keystore AES-256-GCM)
│       │   └── res/
│       │       ├── values/      # strings.xml, colors.xml, themes.xml
│       │       └── xml/
│       │           ├── network_security_config.xml # Release TLS-only base config
│       │           └── data_extraction_rules.xml   # Excludes cloud-backup and device-transfer
│       ├── debug/res/xml/
│       │   └── network_security_config.xml # Debug cleartext policy and user-CA trust overrides
│       └── test/kotlin/dev/damhopper/nativeapp/
│           └── ManifestSecurityTest.kt # Unit tests verifying manifest security invariants
└── crypto-bridge/               # Rust cdylib (libdamhopper_crypto_bridge.so): OPAQUE PAKE, AES-256-GCM HKDF
```

### Security Policies & Manifest Isolation
- **Release TLS Policy**: `src/main/res/xml/network_security_config.xml` sets `cleartextTrafficPermitted="false"` with system trust anchors only.
- **Debug Network Policy**: `src/debug/res/xml/network_security_config.xml` allows cleartext traffic to any host and trusts user-installed certificates; this is a debug-only transport allowance, not an authentication or confidentiality guarantee. Profile Login blocks password/MFA submission over HTTP. REST and SSE request builders add bearer headers only to HTTPS or loopback URLs; the WebSocket builder adds a query token only for HTTPS/WSS or loopback. These are request-construction guards and do not establish redirect behavior. The SSE client belongs to the separate, unmounted panel shell.
  - For physical-device Wi-Fi testing, use HTTPS for authenticated sessions and restrict the server port to the trusted network. Never expose `--no-auth` over Wi-Fi/LAN; the release config remains TLS-only.
- **Data Extraction & Backup**: Manifest sets `android:allowBackup="false"` and `android:fullBackupContent="false"`; `data_extraction_rules.xml` excludes root path from cloud-backup and device-transfer.
- **IME Window Management**: Manifest sets `android:windowSoftInputMode="adjustResize"` to request window resizing when the software keyboard opens (visual dock stability across virtual keyboards pending device testing).
- **Prohibited Dependency Exclusion**: Zero occurrences of `WebView` or `tauri` detected in `native-app/shared/src/` or `native-app/androidApp/src/main/` by the static test suite.

### Live Transport & Ownership Architecture (Phase 03)

Phase 03 establishes the typed networking foundation used across all remote workbench domains:

1. **Generation-Fenced Connection Scoping (`ConnectionRef` & `ConnectionRegistry`):**
   - Profiles are addressed by `ProfileId`; runtime lifetimes are identified by a monotonically increasing `generation` counter (`["profileId", generation]`).
   - `ConnectionRegistry` guards against ABA generation reuse via an in-memory `generationWatermarks` table retained across profile removals within the registry process lifetime.
   - Stale background callbacks, in-flight REST responses, and old WebSocket frames are rejected via `assertCurrentOwner`.

2. **Origin-less WebSocket Handshake & Typed Protocol (`WsConnection`):**
   - Handshake builds target URL `GET /ws?token=<token>` per server admission requirements (`server/src/api/ws.rs`), avoiding synthetic browser `Origin` headers.
   - Inbound and outbound frames are strictly typed: polymorphic `ClientMsg` and `ServerMsg` with class discriminator `"kind"` and fallback `ServerMsg.Unknown` for unknown future events.
   - Mapped close codes to explicit `WsState` branches: `4403` (MFA required), `4401` (login required), `1013` (auth unavailable / 503), `4001` (overflow).
   - Receipts (`host:uiConnection`) are bound to an exact `SocketInstanceRef` and revoked immediately upon socket termination or reconnect.

3. **Atomic Frame Writer (`SerializedWsWriter`):**
   - Mutex-guarded queue ensures text JSON headers and binary payloads never interleave.
   - Atomic header/binary pairs (e.g. for `fs:write_chunk_binary` and `fs:upload_chunk`) abort the connection with `PROTOCOL_ERROR` if partial delivery occurs.

4. **Bounded Request Correlation (`WsRequestCorrelator`):**
   - In-flight request capacity is strictly bounded (max 256).
   - Request timeouts invoke `unregister(reqId)` to eliminate capacity slot leaks.
   - Disconnects and reconnects invoke bulk cancellation `cancelAll()` with `ConnectionOwnerError.UNAVAILABLE`.

5. **Bounded Server-Sent Events (`HostResourceSseClient`):**
   - Incremental streaming parser with strict memory caps (256 KiB data events, 4 KiB status/error events).
   - Status-data adjacency enforcement: data frames are accepted only when immediately preceded by a matching status frame having identical `serverEpoch` and `revision`.

6. **Diagnostic Redaction & Security Policies:**
   - URL sanitizer (`redactUrl`) strips sensitive query tokens and user:password credentials across `http`, `https`, `ws`, and `wss` protocols.
   - `UiConnectionReceipt` and `ServerMsg.UiConnection` redact `decisionCapability` in `toString()` output.
   - Structured concurrency: `ApiClient` immediately rethrows `CancellationException` before error wrapping.
   - Android platform OkHttp engine configures pinned timeouts (15s connect, 30s read/write), 15s ping interval, disabled redirects (`followRedirects(false)`, `followSslRedirects(false)`), and release TLS-only network security config.

### Profiles, Authentication, MFA & Credential Vault Architecture (Phase 04)

Phase 04 implements multi-server profile management, protocol version 2 authentication, and credential custody:

1. **Multi-Server Profile Lifecycle (`ProfileRepository`):**
   - Coordinates profile instances (`ServerProfile`), active selection, and auth statuses across independent servers.
   - Enforces strict URL validation: scheme check (`http`/`https`), user-info credentials rejection, query/fragment rejection, and loopback remapping (`10.0.2.2`).
   - Persists non-secret profile metadata via `AndroidProfileMetadataStore` in Android `SharedPreferences` (`damhopper_server_profiles`).

2. **Android Keystore Credential Custody (`AndroidCredentialVault`):**
   - Implements `CredentialVault` contract bound to `(profileId, baseUrl)` pairs. Never persists passwords, challenges, or TOTP secrets.
   - Uses Android Keystore `MasterKey` (`AES256_GCM`) and `EncryptedSharedPreferences` (`AES256_SIV` key encryption, `AES256_GCM` value encryption).
   - Fail-closed error handling: throws `VaultKeyInvalidatedException` on key invalidation or corruption; never falls back to plaintext.
   - Excluded from cloud backup and device transfer via `data_extraction_rules.xml`.

3. **Asynchronous Attempt Watermark Fencing (`AuthAttemptTracker`):**
   - Fences async auth callbacks against concurrent lifecycle changes using monotonic `AuthAttemptRef(profileId, attemptId)` watermarks.
   - `assertActive(attempt)` gates credential storage; late or stale callbacks throw `AuthAttemptStaleException`.
   - Profile updates, deletions, and logouts invalidate active attempt watermarks immediately.

4. **Frozen Protocol v2 Authentication & TOTP MFA (`AuthRepository`):**
   - Validates frozen protocol version 2 across status, login, and MFA operations via `AuthResponseParser` and `AuthStatusParser`.
   - Handles multi-step login challenges, transient TOTP enrollment/verification, and step-up credential rotation.
   - Maps typed error codes (`ACCOUNT_DISABLED`, `MFA_REQUIRED`, `SESSION_EXPIRED`, `SESSION_REVOKED`, `INCOMPATIBLE_PROTOCOL`, `ATTEMPT_STALE`).
   - Redacts tokens and secrets in `toString()` diagnostics (`[REDACTED]`).

5. **Generation Retirement & Profile Isolation:**
   - Endpoint edits, token rotation, and logouts invoke `ConnectionRegistry.retireConnection()`, terminating active REST, WebSocket, and SSE instances for that generation.
   - Profiles remain strictly isolated: operations on one profile never impact other profiles.

### Terminal Sessions, Stream Replay & Agent Status Architecture (Phase 07)

Phase 07 implements host-contract foundations for remote PTY lifecycle management, byte-for-byte stream replay, input isolation, and server-authoritative agent status observation. The remediation handoff reports a 50,000-line live-stream ANR stress run with zero ANRs and zero dropped frames on `Medium_Phone_API_36`; full live-server qualification, broader physical-device rendering, IME behavior, and native-library qualification remain open.

1. **Traditional PTY Session Lifecycle (`TerminalRepository` & `TerminalSessionController`):**
   - Implements full CRUD operations for remote PTY sessions over REST (`/api/terminal/sessions`), supporting list, create, detailed metrics, rename, kill, remove, restart, and buffer fetching.
   - PTY state is retained across Compose recompositions and panel navigation transitions within `TerminalSessionController`. Sessions are displayed via inline tabs in `TerminalPanelScreen`; no floating action buttons are used.
   - Profile transitions in `WorkbenchScreen` dispose and clear all registered session controllers, preventing cross-profile PTY or socket leakage.

2. **Stream Replay Gate & Byte Reconciliation (`TerminalReplayGate`):**
   - Coordinates historical replay buffer writes and live PTY streaming. Outbound terminal queries are suppressed (`shouldForwardTerminalData() == false`) while active replay writes are in flight (`activeReplayWrites > 0`) to prevent terminal echo loops.
   - Real-time chunk reconciliation via `reconcileTerminalOutput` performs duplicate chunk discard (`endOffset <= currentOffset`), gap detection (`startOffset > currentOffset`), and partial overlap slicing (`startOffset < currentOffset < endOffset`).
   - Bounded live queue (default 1024 chunks / 4 MiB) protects memory during slow replay processing, invoking `onQueueOverflow` to trigger stream re-attachment if bounds are exceeded.

3. **Server-Authoritative Agent Status Observation (`AgentStatusReducer`):**
   - Maintains an authoritative `AgentStatusState` coordinating live WebSocket events (`ServerMsg.AgentStatusChanged`, `ServerMsg.AgentStatusRemoved`, `ServerMsg.AgentStatusInvalidated`) with REST snapshots (`/api/agent-status/snapshot`).
   - Fences stale updates using `serverEpoch` and monotonic `revision` ordering. Epoch mismatches trigger a full snapshot reload hoisted outside non-reentrant mutex locks to prevent coroutine deadlocks.
   - Tracks unread attention events with an in-memory LRU cache (`seenAttentionIds`, max 1,000 entries) to prevent duplicate alerts from replayed history.

4. **Platform Input Bridging & Bracketed Paste (`TerminalInputController`):**
   - Bridges hardware keyboard events (`KeyEvent`), IME text commits, and clipboard paste to `TerminalSessionController`.
   - Gated execution: keystrokes and text commits are rejected when `isPanelActive == false` or `isReplayCompleted == false`.
   - Modifiers (Ctrl, Alt, Shift) unlatch on `ACTION_UP` events. Supplementary Unicode characters (> 0xFFFF) are handled via surrogate pairs.
   - Clipboard text is wrapped in standard bracketed paste escape sequences (`\u001b[200~` and `\u001b[201~`) before dispatch.


#### Completed terminal rendering, replay, and ANR remediation (2026-10-23)

- **Atomic Compose snapshot:** `TerminalDisplaySnapshot` contains the coherent rendered rows, lines, stable row IDs, cursor state, content revision, and surface generation. `VtTerminalSurface` publishes it through Compose state using `referentialEqualityPolicy()`, avoiding per-row `SnapshotStateList` mutation and its `orderedEquals` cost. Snapshot-reference comparison is O(1); building rendered rows and downstream Compose invalidation/rendering remain separate costs.
- **Revision fencing and cursor updates:** Each `RenderedRow` keeps unpadded `baseText` for identity-based revision checks. Cursor-only presentation changes preserve the content revision and row IDs. Cursor blinking updates the snapshot without acquiring `bufferLock`.
- **Rendering and row identity:** `VtTerminalRow` caches base styled rows; unchanged rows are reused by reference. `lineIds: List<Long>` stays aligned with `lines` and supplies stable Compose `LazyColumn` keys.
- **Resize and VT behavior:** Main-buffer width reflow and height changes preserve displaced text above and below the viewport within the 2,000-line retention budget, with cursor anchoring, wide-cell repair, and hard-break preservation. Erase and RIS reset remain authoritative; the alternate buffer stays isolated without scrollback. DECAWM (`CSI ?7h/l`) supports right-edge overwrite when disabled; DCH (`CSI P`) deletes characters, moves styles, blanks the row tail, and repairs wide-cell pairs.
- **Attach and replay:** `beginAttach(): ULong` synchronously closes the replay gate and captures the accepted byte offset before asynchronous transport work. UTF-8 byte end-offset reconciliation discards stale/duplicate deltas, slices partial overlaps, and requests reattach on gaps. Reset snapshots remain authoritative; queued live chunks drain in historical mode while input and protocol replies remain fenced through completion. `failAttach(): Unit` fences transport failure without dropping queued live chunks. The active REST buffer-prefill bypass is removed.
- **Viewport and geometry:** User drag pauses follow; returning to bottom reenables it. Reading position stays anchored by stable `lineId` and pixel offset, clamping to the earliest surviving row after eviction. Grid geometry uses measured monospace metrics from the displayed 12sp text / 16sp line-height style; `softWrap = false` keeps one visual row per terminal row.
- **Reported validation (remediation handoff):** 111/111 JVM terminal tests passed; `:androidApp:assembleDebug` succeeded; a 50,000-line live-stream test on `Medium_Phone_API_36` recorded zero ANRs and zero dropped frames. These reported results were not independently rerun for this documentation update. Broader live-server, physical-device, visual, and IME qualification remains open.

See the [terminal lifetime and remediation architecture](../docs/architecture/android-native-client.md#terminal-lifetime).

### Ports, Tunnels, Idle Consent & Host Controls Architecture (Phase 16)

Phase 16 implements remote network port discovery, Cloudflared tunnel management, idle suspend consent coordination with live capability receipts, remote SSH key custody, host remediation action scaffolding, and diagnostics export:

1. **Ports & Cloudflared Tunnels (`PortRepository`, `TunnelRepository`, `PortsPanelScreen`):**
   - REST endpoints `/api/ports`, `/api/tunnels`, `/api/tunnels/install`.
   - Dynamic port updates over WebSocket (`PortDiscovered`, `PortLost`) with monotonic incarnation sequence checking (`msg.incarnation >= existing.incarnation`).
   - Cloudflared quick tunnel lifecycle (`STARTING`, `READY`, `STOPPED`, `FAILED`), URL copy integration, and 3-hour remote public exposure reminders (`reminderDue = true`).
   - Single content area docking under `WorkbenchPanel.PORTS` with zero FABs.

2. **Idle Suspend & Live Socket Capability Consent (`IdleSuspendRepository`, `IdleConsentController`, `WorkbenchSleepConsentBanner`):**
   - REST endpoints for status (`GET /api/system/idle-suspend/v1/status`), timing patch (`PATCH /timing`), force-suspend (`POST /force-suspend`), and consent decisions (`POST /consent/decision`).
   - Fallback normalization (`decodeIdleSuspendStatusV1`) mapping old/unsupported server responses.
   - Enforces fail-closed WebSocket receipt capability gating (`receiptProvider: () -> UiConnectionReceipt?`), rejecting consent decisions when live capability receipt is absent.
   - Ticking countdown banner (`WorkbenchSleepConsentBanner`) disabling decision actions at zero remaining seconds.
   - Maps server 409 conflict responses (`IdleSuspendActiveFleetConflictException`, `IdleSuspendFleetChangedConflictException`, `IdleSuspendHandoffConflictException`).

3. **Remote SSH Keys, Host Controls & Diagnostics (`SshRepository`, `HostControlRepository`, `DiagnosticsRepository`, `HostControlScreens`):**
   - Remote SSH key listing, agent status, and key loading with `passphrase=[REDACTED]` masking; per-key credentials and forget/load operations mapped by key basename.
   - Host remediation action scaffolding (`GET /capabilities`, `POST /intents`, `POST /intents/{id}/approve`, `POST /executions`, `GET /audit`; action execution flows lack UI callers in Phase 16).
   - Diagnostics export (`POST /api/diagnostics/export`) defaulting to `includeTerminalOutput = false` and acknowledging server-daemon memory storage.
   - Single content area docking under `WorkbenchPanel.SSH_HOST` with zero FABs.
---

## 4. Verification & Build Commands

### Root Workspace Commands (`package.json`)

```bash
# Run shared platform-agnostic unit tests (WorkbenchModel, shell invariants, serialization):
pnpm native-app:test

# Run Android unit tests (manifest security, network security configs, extraction rules):
pnpm native-app:test:android

# Assemble debug APK:
pnpm native-app:assembleDebug

# Run foundation and security static assertion suite (47/47 static assertions):
bash tests/test-phase-02-foundation.sh

# Run Phase 03 transport and ownership static assertion suite (48/48 static assertions):
bash tests/test-phase-03-transport.sh

# Run Phase 04 profiles, auth, and vault static assertion suite (57/57 static assertions):
bash tests/test-phase-04-profiles-auth.sh

# Run Phase 06 shell and workspace static assertion suite (64/64 static assertions):
bash tests/test-phase-06-shell-workspace.sh

# Run Phase 07 terminal sessions, replay, input, and agents static assertion suite (45/45 static assertions):
bash tests/test-phase-07-terminal-agents.sh
# Run Phase 16 ports, tunnels, idle consent, and host controls static assertion suite (194/194 static assertions):
bash tests/test-phase-16-ports-tunnels-host-controls.sh

# Run combined test suites (foundation + transport):
bash tests/test-phase-02-foundation.sh && bash tests/test-phase-03-transport.sh
```
*(Note: Root scripts provide sensible fallbacks for `JAVA_HOME` and `ANDROID_HOME`, which can be overridden in your local shell environment).*

### Direct Gradle Commands

```bash
# Run shared JVM unit tests:
./native-app/gradlew -p native-app :shared:jvmTest

# Run Android unit tests:
./native-app/gradlew -p native-app :androidApp:testDebugUnitTest

# Assemble debug APK:
./native-app/gradlew -p native-app :androidApp:assembleDebug

# Install debug APK on connected device or emulator (pending device attachment):
./native-app/gradlew -p native-app :androidApp:installDebug

# Run connected Android instrumentation tests (pending device attachment):
./native-app/gradlew -p native-app :androidApp:connectedDebugAndroidTest
```

---

## 5. Implementation Roadmap

- **Phase 01:** Scope baseline and contract freeze *(Completed)*
- **Phase 02:** Gradle KMP Android foundation *(Foundation & security statically verified; runtime launch pending device attachment)*
- **Phase 03:** Contracts ownership and live transport *(Implemented and statically verified; 48/48 static transport assertions, 28/28 shared JVM tests; live backend qualification open)*
- **Phase 04:** Profiles authentication, MFA, and credential vault *(Implemented and verified; 57/57 static assertions, 53 shared JVM unit tests; live daemon and device qualification open)*
- **Phase 05:** Native terminal, editor, and crypto proof gates *(Contract and host prototype validated; candidate pins recorded; device qualification open)*
- **Phase 06:** TERMINAL Traditional shell, projects, and configuration *(Implemented and verified; 64/64 static assertions, 25 unit tests; device qualification open)*
- **Phase 07:** Terminal sessions, replay, input, and agent status *(Host contracts implemented and verified; 45/45 static assertions; recorded QA report notes 155 unit tests passing; remediation handoff reports a 50,000-line live-stream ANR stress run with zero ANRs and zero dropped frames on `Medium_Phone_API_36`; broader physical-device rendering, IME behavior, and server-backed replay remain open qualification gates deferred to Phase 18)*
- **Phase 08:** Filesystem watchers, search, and replace *(Implementation baseline recorded; 57/57 static assertions; qualification open)*
- **Phase 09:** Native editor, language services, and safe saves *(Implementation baseline recorded; 70/70 static assertions; candidate adapter and open limitations recorded)*
- **Phase 10:** Native diff, merge, and blame *(Implementation baseline recorded; 77/77 static assertions; qualification open)*
- **Phase 11:** Encrypted transfers, media, and Android storage *(Scaffolding baseline recorded; 84/84 static assertions; open security and integration limitations)*
- **Phase 12:** Complete Git and safe history workflows *(Implementation baseline recorded; 139/139 static assertions; open limitations recorded)*
- **Phase 13:** Workflow tracking and project plans *(Implementation baseline recorded; 100/100 static assertions; qualification open)*
- **Phase 14:** Agent Store imports and memory *(Implementation baseline recorded; 99/99 static assertions; open limitations recorded)*
- **Phase 15:** Host resources, fleet, and usage *(Implementation baseline recorded; 81/81 static assertions; qualification open)*
- **Phase 16:** Ports, tunnels, idle consent, and host controls *(Implementation baseline recorded; 194/194 static assertions in tests/test-phase-16-ports-tunnels-host-controls.sh; dated QA report recorded 417 unit test executions, Cycle 2 review reported 350 unique tests; clean assembleDebug; review score 7/10 changes required / qualification open with 3 High implementation defects and live server/device qualification open; see [Acceptance Ledger](../docs/android-native-acceptance.md))*
- **Phase 17:** Preferences, privacy, notifications, and lifecycle
- **Phase 18:** Integrated device security and performance qualification
- **Phase 19:** Signed APK release and operational handoff
