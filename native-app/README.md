# DamHopper Android Native Client (`native-app`)

**Status:** Foundation, live transport, profile/auth/vault, native proof gates, Traditional shell/workspaces/config, and terminal sessions/replay/agents host contracts implemented and verified (Phases 02–07). Native surface integration and live backend/device runtime launch qualification remain open.  
**Architecture Document:** [Android Native Client Architecture](../docs/architecture/android-native-client.md)  
**Acceptance Ledger:** [Android Native Acceptance Ledger](../docs/android-native-acceptance.md)  
**Implementation Plan:** [Android Native App Plan](../plans/261015-1647-android-native-app/plan.md)

---

## 1. Overview

`native-app` is an Android-native implementation of the DamHopper development workbench. It connects to the existing DamHopper Rust server backend (`server/`) using REST, WebSocket, and Server-Sent Events (SSE).

Unlike `apps/native/` (which hosts the desktop application using Tauri 2 and WebView), `native-app` is built entirely with **Kotlin Multiplatform (KMP)** and **Jetpack Compose**, using platform-native Android widgets and terminal/editor rendering adapters. It does not contain or run a browser engine, WebView, local PTY, local Git, or local AI agent execution.

---

## 2. Workspace & Shell Invariants

The native Android client adheres to strict presentation rules established by architectural decisions and user validation:

1. **TERMINAL Mode Shell:**
   - The workbench operates strictly in **TERMINAL mode** (`workspaceMode = "terminal"`).
   - The desktop IDE shell and workspace mode switchers are excluded.
2. **Traditional Terminal Presentation:**
   - The terminal operates strictly in **Traditional terminal mode** (`terminalUsageMode = "traditional"`).
   - The desktop Runtime terminal presentation and usage mode switchers are excluded.
3. **Single Top Panel-Navigation Row:**
   - All 12 included remote workbench panels are accessed via a single horizontally scrollable button row positioned at the top, directly beneath the server/project header.
   - Buttons display an icon and a short text label, with visual indication of the active panel.
   - The navigation row stays visible and docked when the software keyboard (IME) is displayed.
   - No wrapping into multiple rows; no overflow/More menu.
4. **Zero Floating Buttons:**
   - Floating Action Buttons (FABs), draggable launchers, and floating panel toggles are strictly prohibited. All navigation and actions are inline.
5. **Single Content Area:**
   - One content area is used across all screen sizes (phones, foldables, tablets). Selecting a panel visually replaces the terminal while keeping underlying terminal sessions and controllers alive. No multi-pane or side-by-side terminal/panel docking.
6. **First-Release Preview Exceptions:**
   - **HTML Preview:** Embedded interactive HTML/JS browser preview is excluded (B01). HTML files are edited as raw source code.
   - **Mermaid Rendering:** DOM-rendered Mermaid diagrams are excluded (B02). Markdown files display raw fenced Mermaid code blocks with an explicit rendering-unavailable notice.

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
│       │       │   └── settings/    # RemoteConfigRepository, RemoteConfigEditor, RemoteConfigScreen
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
│       │   │   ├── MainActivity.kt # Compose entry point with NativeTheme and WorkbenchScreen
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
│       │   └── network_security_config.xml # Debug loopback cleartext overrides (10.0.2.2, 127.0.0.1)
│       └── test/kotlin/dev/damhopper/nativeapp/
│           └── ManifestSecurityTest.kt # Unit tests verifying manifest security invariants
└── crypto-bridge/               # Rust cdylib (libdamhopper_crypto_bridge.so): OPAQUE PAKE, AES-256-GCM HKDF
```

### Security Policies & Manifest Isolation
- **Release TLS Policy**: `src/main/res/xml/network_security_config.xml` sets `cleartextTrafficPermitted="false"` with system trust anchors only.
- **Debug Loopback Cleartext**: `src/debug/res/xml/network_security_config.xml` permits cleartext traffic strictly for `10.0.2.2`, `127.0.0.1`, and `localhost` with user trust anchors.
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

Phase 07 implements host-contract foundations for remote PTY lifecycle management, byte-for-byte stream replay, input isolation, and server-authoritative agent status observation (live emulator canvas integration, physical ConnectBot `libvterm.so` JNI binding, and live server-backed streaming remain open qualification gates):

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
- **Phase 07:** Terminal sessions, replay, input, and agent status *(Host contracts implemented and verified; 45/45 static assertions; recorded QA report notes 155 unit tests passing; live emulator canvas integration, physical terminal rendering, IME behavior, and server-backed replay remain open qualification gates deferred to Phase 18)*
- **Phase 08:** Filesystem watchers, search, and replace
- **Phase 09:** Native editor, language services, and safe saves
- **Phase 10:** Native diff, merge, and blame
- **Phase 11:** Encrypted transfers, media, and Android storage
- **Phase 12:** Complete Git and safe history workflows
- **Phase 13:** Workflow tracking and project plans
- **Phase 14:** Agent Store imports and memory
- **Phase 15:** Host resources, fleet, and usage
- **Phase 16:** Ports, tunnels, idle consent, and host controls
- **Phase 17:** Preferences, privacy, notifications, and lifecycle
- **Phase 18:** Integrated device security and performance qualification
- **Phase 19:** Signed APK release and operational handoff
