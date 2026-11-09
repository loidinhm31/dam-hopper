# DamHopper Android Native Client (`native/android-app`)

**Status:** Native Android Agent Hub redesign: 2-stage mobile flow Profile Login → Agent Hub (`AppFlowStage.HUB`) with nested Open Project picker and capability navigation (Terminal, Files, Editor, Git). Status: Approved with noted issues after 3 code review cycles (Cycle 3 review score 5/10; 7 critical issues C-01–C-08 with C-06 addressed in source, 7 warnings; approved with known unresolved findings by explicit user approval; technical acceptance, safety invariant verification, and release qualification remain open). Automated Unit Test Evidence: 1,299 / 1,299 tests passing (1,044 shared JVM tests via `:shared:jvmTest` + 255 Android debug unit tests via `:androidApp:testDebugUnitTest`, 0 failures, 0 skipped; forced rerun 2026-11-08). Build & Packaging: `:androidApp:assembleDebug` (debug APK produced) and `:androidApp:compileDebugAndroidTestKotlin` SUCCESS. Git fixture oracle: 12/12 passing (`git-workspace-fixture.mjs --self-test`). Release qualification gates: Physical ARM64 / API 29 / API 33+ device and live multi-server runtime release gates remain unexecuted (`BLOCKED_PENDING_DEVICE`, 0 connected devices observed via `adb devices`).
**Architecture Document:** [Android Native Client Architecture](../../docs/architecture/android-native-client.md)  
**Acceptance Ledger:** [Android Native Acceptance Ledger](../../docs/android-native-acceptance.md)  
**Redesign Plan:** [Android Agent Hub Redesign Plan](../../plans/261107-0305-android-agent-hub-redesign/plan.md)  
**Historical Implementation Plan:** [Android Native App Plan](../../plans/261015-1647-android-native-app/plan.md)  
**Native Editor & Explorer Plan:** [Native Editor & File Explorer Plan](../../plans/261023-1429-native-editor-file-explorer/plan.md)
---

## 1. Overview

`native/android-app` is an Android-native implementation of the DamHopper development workbench. It connects to the existing DamHopper Rust server backend (`server/`) using REST, WebSocket, and Server-Sent Events (SSE).

Unlike `apps/native/` (which hosts the desktop application using Tauri 2 and WebView), `native-app` is built entirely with **Kotlin Multiplatform (KMP)** and **Jetpack Compose**, using platform-native Android widgets and terminal/editor rendering adapters. It does not contain or run a browser engine, WebView, local PTY, local Git, or local AI agent execution.

---

## 2. Core Mobile Flow & Navigation Lifecycle
The mobile application flow implements a two-stage navigation model: **Profile Login → Agent Hub (`AppFlowStage.HUB`)**.

| Stage | Screen | Behavior |
| --- | --- | --- |
| `PROFILE_LOGIN` | `ProfileLoginScreen` | Select or add a server profile, test reachability, authenticate (including MFA), or use Dev Login only after a server capability probe confirms development mode. |
| `HUB` | `AgentHubNavigator` / `DamHopperMobileApp` | Primary application stage. Integrates attached profile observation, project/worktree grouping, zero-session open refs, pins, hidden state, and nested capabilities (Terminal, Files, Editor, Git) alongside a nested Open Project picker, retained Settings overlay, and notification feed. |

### Two-Row Chrome Architecture

The mobile interface is structured around a compact, non-wrapping two-row chrome optimized for mobile ergonomics and virtual keyboard (IME) stability:

1. **Row 1 — Context & Status Header (`WorkbenchHeader` / Top Bar):**
   - Displays the active server profile and project/worktree context.
   - Houses header triggers: Notification feed bell (with unread count badge), Settings gear, and visual Cognito Privacy Mode toggle.
   - Pinned at the top of the viewport; remains visible across all stages and when virtual keyboards appear.

2. **Row 2 — Docked Capability Navigation Row:**
   - Single-line horizontal docking row presenting active capability destinations: **Terminal**, **Files**, **Editor**, and **Git** (`WorkspacePanel.GIT`).
   - Enforces a minimum 48dp touch target for all navigation controls to satisfy mobile accessibility requirements.
   - Never wraps into multiple rows; remains docked and visible while the software keyboard (IME) is active (`adjustResize`).
   - Selecting a capability switches the displayed surface in the single content host without unmounting or terminating active background PTYs or dirty editor sessions.

3. **Adaptive Hub Navigator:**
   - Responsive presentation: pins as a 280dp/360dp navigation rail on wide viewports (>=360dp / tablet / landscape), or presents as a dismissible modal sheet with a scrim on compact mobile screens.
   - Observes attached profile runtimes without initiating background auto-connects or synthetic keepalives.
   - Supports persistent pins, hidden session states, and jump-to-session routing across qualified workspace targets.

### Back Navigation Hierarchy & Dirty-Departure Fencing

Back navigation is strictly hierarchical and unwinds modal layers before retreating flow stages:
1. Active dialogs, diff/commit inspection sheets, and the Open Project picker close first.
2. In-content capability surfaces unwind to the primary Hub overview.
3. Hub stage Back retreats to `PROFILE_LOGIN`.
4. At `PROFILE_LOGIN`, Back is unconsumed to allow Android `MainActivity` to finish cleanly.

Any navigation that departs a dirty workspace (switching projects, closing modified tabs, or logging out) is intercepted by `DepartureRequest` guards (`WorkspaceDepartureGuard`), prompting the user before discarding unsaved editor drafts or active PTYs.

The shared module still contains a separate 12-panel `WorkbenchScreen` / `PanelHost` shell. The active `DamHopperMobileApp` root does not mount that shell; its other panel destinations are not reachable through the guided flow. The Agent Hub root, nested capabilities, and focused Git view are active root surfaces, not entry points into that dormant shell.

### Focused Git workspace view

The focused workspace toolbar mounts a direct Git destination (`WorkspacePanel.GIT`) alongside Terminal, Files, and Editor in `ProjectTerminalScreen`. Selecting Git renders the retained `GitPanelScreen` within the single content host without unmounting or terminating active terminal PTYs or editor tabs.

The focused Git view organizes operations into three primary sections with nested inspection routes:

1. **Changes Section (`GitChangesView`):**
   - Displays staged, unstaged, untracked, and conflicting file changes in a categorized list. Supports staged and unstaged edits on the same file, untracked file pagination, binary assets, and deleted or empty files.
   - Provides stage, unstage, commit (with optional `amend` toggle), and confirmed discard actions. File discard is guarded by dirty-editor checks and requires explicit user confirmation before executing.
   - Invalidation and reconciliation run strictly after server mutation success (`GitOutcomeKind.SUCCEEDED`), preventing premature UI state clearing on network or server errors.

2. **History Section (`GitHistoryView`):**
   - Renders a pure ancestry directed acyclic graph (DAG) computed from commit OID parent links (`GitGraphLayout`). Supports linear histories, 2-parent merges, multi-parent octopus merges, skewed commit timestamps, downward and upward edges, and off-page stub indicators.
   - Literal search query filtering debounces input and renders matching commits as a flat list; active search disables squash selection to prevent non-contiguous commit merges.
   - Nested commit details view (`GitCommitDetailsDialog`) displays the full commit message, author, committer, and modified file list. Selecting a modified file opens a nested, read-only file diff view (`GitFileDiffView`).
   - Hardware Back and toolbar Back affordances unwind nested diff views to commit details, and commit details back to the History overview before unmounting the Git surface.

3. **Branches and Worktrees Section (`GitBranchesWorktreesView`):**
   - Lists local and remote branches disambiguated by full canonical ref (`refs/heads/*` vs `refs/remotes/*`). Supports branch creation, checkout, fast-forward branch updates, and safe deletion of inactive branches.
   - Manages git worktrees: create, open, remove, and prune. Path mapping preserves projected paths and strictly escapes punctuation characters (`& + # =`) across REST queries and bodies.
   - Worktree removal validates prechecks: main worktree removal is blocked, and removal is refused if matching retained owners contain unsaved editor buffers or active terminal sessions.

#### Four Distinct Working Identities

The focused Git client maintains four distinct, non-interchangeable identities to ensure cross-profile isolation and prevent state corruption:

1. **Authenticated Logical Owner (`ProfileId` / `profileId`):** Identifies the active server connection profile. All controllers, repositories, and caches are fenced to this owner.
2. **Connection Generation (`generation`):** Monotonically increasing counter for the active socket/transport runtime. Stale responses and background jobs from retired generations are rejected via `assertCurrentOwner`.
3. **Workspace Project Target (`ProjectTargetRef` / `targetWorktree`):** The active project directory or linked worktree target. Switching worktrees triggers a guarded whole-workspace transition that prompts on unsaved editor drafts.
4. **Working Tree Root (`VcsRoot` / `root`):** The repository root within multi-root or submodule configurations. Wire requests qualify Git operations by root where supported.

#### Safety Guards, Conflict Handoff & Contract Invariants

- **Safe History Rewrites:** Differentiates checked-out active branch actions (amend, reset, discard, drop, cherry-pick) from inactive local branch rewrites (CAS message edit snapshot and contiguous oldest-first squash). Signed commits are protected by an explicit consent guard (`allowSignatureRemoval`), preventing accidental signature stripping without user confirmation.
- **Separate Leased Publication:** History rewrites never publish automatically. Publication is an explicit subsequent user action (`/push/prepare` + `/push/publish`) verifying exact expected remote OIDs; stale remote tips abort without blind `--force` fallback.
- **Read-Only Conflict & Operation Handoff:** Conflict states (`GET /api/git/:project/conflicts`) and stopped operations (`GET /api/git/:project/operation`) present unmerged file status and guidance directing the developer to Terminal or web CLI. Zero wire calls are made to `POST /resolve` or `POST /operation`.
- **Secondary-Root Push vs Fetch/Pull Restrictions:** The server fetch and pull endpoints (`POST /api/git/fetch`, `POST /api/git/pull`) do not accept a root selector; secondary roots in multi-root workspaces visibly disable fetch and pull. Ordinary push (`POST /api/git/push`) supports root qualification and remains available for secondary roots.
- **Drop-Ack Idempotence:** If a mutating request is accepted by the server but the connection drops before receiving the acknowledgement, exactly one request was forwarded; the client does not replay mutations or maintain offline write queues, instead performing authoritative reconciliation on refresh (`GitRefreshReason.RECONCILE`).
- **Shortcut Scope:** Git shortcuts remain unmapped in this focused root; Git tab availability does not authorize broader Settings shortcut changes or 12-panel shell activation.

### Traditional terminal Agents sidebar

The Terminal toolbar exposes a discoverable `Agents <count>` trigger. The sidebar pins to the left at 280dp on workspaces at least 600dp wide; narrower layouts use a dismissible modal sheet with a scrim. This terminal-scoped status navigator complements the existing File Tree sidebar used for editor file browsing; it is not a global navigation rail or another panel destination.

The roster observes open, selectable Traditional terminal sessions already retained by registered workspaces on already-attached profile runtimes. It does not connect saved profiles, open new sockets, keep a runtime alive for observation, or replace Agent Store. It groups observed agents by workspace, status, and reason; the multi-select filter covers the seven presented statuses and counts are calculated before filtering. The filter is stored on-device in a dedicated Android preference, not synced with profiles or remote Settings.

Selecting an agent group captures an exact qualified terminal target, checks it against current runtime/inventory metadata, and revalidates after any dirty-editor confirmation. Missing, stale, or contended instances are refused without selecting a replacement; observation availability alone is not task success. Manual navigation does not create notification attention. The sidebar's Settings action opens the retained Settings overlay at **Host administration (HOST) → Agents (AGENTS)** for the current workspace server (independent of the preference-source profile).

### Physical-device development over Wi-Fi

1. Build and install the debug variant on a connected Android device:

   ```bash
   ./native/android-app/gradlew -p native/android-app :androidApp:installDebug
   ```

   On Windows PowerShell:

   ```powershell
   .\native\android-app\gradlew.bat -p native/android-app :androidApp:installDebug
   ```

2. Connect the phone and development host to the same trusted Wi-Fi network. Use the host's reachable LAN address and server port in the profile URL; `localhost` and `127.0.0.1` on a phone refer to the phone itself. The emulator preset `10.0.2.2:4803` is for the Android emulator, not a physical device. The host service must listen on a reachable interface and the host firewall must allow the chosen port on the trusted network.

3. `src/debug/res/xml/network_security_config.xml` permits cleartext traffic to any host in debug builds, not only LAN addresses. This is a transport allowance, not a security boundary. Profile Login blocks password/MFA submission over HTTP; the active REST and WebSocket request builders restrict bearer credentials to HTTPS/WSS or loopback targets. These are request-construction guards; redirect behavior is not established, and HTTP remains unencrypted. Do not expect an authenticated Wi-Fi flow over HTTP. Use HTTPS for authenticated device login; debug builds trust system and user-installed CAs, so a local development CA can be installed on the device while normal certificate and hostname validation still apply.

4. Dev Login is available only after Test Connection confirms the server's `dev_mode` capability. Treat an HTTP capability response as untrusted on a network; do not use Dev Login on an untrusted network. The server's `--no-auth` mode is loopback-only by project security policy and must not be exposed over Wi-Fi/LAN. Release network security remains TLS-only.

For a USB-connected device that needs a loopback-bound development server, `adb reverse` can forward a device-local port to the host without opening that server to the Wi-Fi network.

---

## 3. Module Architecture & Toolchain Pins

The project follows a two-module architecture established in Phase 02:

### Toolchain Pins
Defined in `native/android-app/gradle/libs.versions.toml` and pinned in the Gradle wrapper:
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
native/android-app/
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
│       │       │   ├── git/         # GitRepository, GitWorkspaceRuntime, GitChangesController, GitBranchController,
│       │       │   │                # GitHistoryController, GitGraphLayout, WorkspaceGitSafety, DiffReviewController
│       │       │   ├── workflow/    # WorkflowRepository, WorkflowController, ProjectPlansRepository, ProjectPlansController
│       │       │   ├── agents/      # AgentStoreRepository, AgentMemoryRepository, AgentImportRepository, Controllers & Screens
│       │       │   └── host/        # PortRepository, TunnelRepository, IdleSuspendRepository, IdleConsentController,
│       │       │                    # SshRepository, HostControlRepository, DiagnosticsRepository, PortsPanelScreen,
│       │       │                    # PortsDialogs, IdleSuspendDialogs, HostControlScreens, WorkbenchSleepConsentBanner,
│       │       │                    # HostResourceRepository, ResourceStreamCoordinator, ResourceFrameCommitter
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
│   │   │   │   ├── network/     # AndroidNetworkMonitor (ConnectivityManager default-network callback)
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
- **Prohibited Dependency Exclusion**: Zero occurrences of `WebView` or `tauri` detected in `native/android-app/shared/src/` or `native/android-app/androidApp/src/main/` by the static test suite.

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
   - Android platform OkHttp engine configures pinned timeouts (15s connect, 30s write), 15s ping interval, disabled redirects (`followRedirects(false)`, `followSslRedirects(false)`), and release TLS-only network security config.
   - Autonomous WebSocket recovery supervisor (`WsRecoverySupervisor` & `WsRecoveryPolicy`): handles exponential backoff with jitter on transient socket drops, halts generic retry on MFA/login challenges (`4401`/`4403`), and triggers immediate reconnection on foreground resume or default-network change.
   - Decoupled terminal status presentation (`TerminalConnectionPresentation`): transport disconnection overrides PTY process liveness; stream readiness (`isReplayCompleted`) is synchronously revoked upon socket failure to prevent stale green indicators.

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

### Guarded PTY Lifecycle, Stream Replay & Terminal Sessions (Phases P02, P03, P07)

Remote PTY session management enforces a fail-closed lifecycle, byte-for-byte stream replay, input isolation, and server-authoritative agent observation:

1. **Guarded PTY Session Lifecycle (`TerminalRepository` & `TerminalSessionController`):**
   - Implements full CRUD operations for remote PTY sessions over REST (`/api/terminal/sessions`), supporting list, create, detailed metrics, rename, kill, remove, restart, and buffer fetching.
   - **Guarded Termination Protocol (Phase P02):** Process termination requires atomic `POST /api/terminal/{id}/terminate` gated by the manager-lifetime UUID epoch header (`X-DamHopper-PTY-Epoch`) and positive u64 string `incarnationExact`. Refuses stale, missing, or mismatched epoch/incarnation requests with typed 400/404/409 error responses.
   - **Local vs Remote Close Distinction:** Distinguishes presentation-only `Close View` (removes local tab and disposes terminal surface while retaining the server-owned PTY process) from destructive `End Session` backend termination.
   - **Uncertain-Create Persistence:** Persistent reservation records are stored before create dispatch; in-flight network drops or timeouts preserve the pending reservation across process recreation, blocking duplicate replacement until settled.
   - PTY state is retained across Compose recompositions and capability navigation transitions within `TerminalSessionController`. Profile transitions dispose and clear registered session controllers, preventing cross-profile PTY or socket leakage.
   - *Known review findings (Cycle 3):* Rendered terminal rows from a project-null Hub do not rebind the row's workspace/profile before selection (C-01); uncertain-create records currently use timestamps rather than strict UUIDs (Warning 2); termination version header `X-DamHopper-Termination-Version: 1` requirement is inferred rather than strictly validated (Warning 3).

2. **Stream Replay Gate & Byte Reconciliation (`TerminalReplayGate`):**
   - Coordinates historical replay buffer writes and live PTY streaming. Outbound terminal queries are suppressed (`shouldForwardTerminalData() == false`) while active replay writes are in flight (`activeReplayWrites > 0`) to prevent terminal echo loops.
   - Real-time chunk reconciliation via `reconcileTerminalOutput` performs duplicate chunk discard (`endOffset <= currentOffset`), gap detection (`startOffset > currentOffset`), and partial overlap slicing (`startOffset < currentOffset < endOffset`).
   - Bounded live queue (default 1024 chunks / 4 MiB) protects memory during slow replay processing, invoking `onQueueOverflow` to trigger stream re-attachment if bounds are exceeded.

3. **Server-Authoritative Agent Status Observation (`AgentStatusReducer`):**
   - Maintains an authoritative `AgentStatusState` coordinating live WebSocket events (`ServerMsg.AgentStatusChanged`, `ServerMsg.AgentStatusRemoved`, `ServerMsg.AgentStatusInvalidated`) with REST snapshots (`/api/agent-status/snapshot`).
   - Fences stale updates using `serverEpoch` and monotonic `revision` ordering. Epoch mismatches trigger a full snapshot reload hoisted outside non-reentrant mutex locks to prevent coroutine deadlocks.
   - Admits notification effects only for newly accepted live semantic attention after a silent owner/socket snapshot baseline. The reducer fences epoch, contiguous revision, row identity, and per-row attention revision; gaps, reconnect/reconciliation, replay, snapshots, and invalidation do not create alerts. The old `seenAttentionIds` LRU is not used.

4. **Platform Input Bridging & Bracketed Paste (`TerminalInputController`):**
   - Bridges hardware keyboard events (`KeyEvent`), IME text commits, and clipboard paste to `TerminalSessionController`.
   - Gated execution: keystrokes and text commits are rejected when `isPanelActive == false` or `isReplayCompleted == false`.
   - Modifiers (Ctrl, Alt, Shift) unlatch on `ACTION_UP` events. Supplementary Unicode characters (> 0xFFFF) are handled via surrogate pairs.
   - Clipboard text is wrapped in standard bracketed paste escape sequences (`\u001b[200~` and `\u001b[201~`) before dispatch.

### Canonical Document Registry & Explicit Filesystem Targets (Phase P06)

The native editor and file management architecture implements explicit filesystem targets and canonical document custody:

1. **Filesystem Target Discrimination (`FilesystemTargetRef`):**
   - Explicitly distinguishes `FilesystemTargetRef.Workspace` (canonical browse root authority from `[workspace].root`) from `FilesystemTargetRef.Project(name, worktreePath)`.
   - Fences project-marking operations (`POST /api/config/projects`) and unmarking (`DELETE /api/config/projects/{name}`) against accidental directory mutations.

2. **Canonical Document Registry & Leases (`EditorTabsState` & `AndroidEditorDocument`):**
   - Binds open document leases under the retained owner keyed by the 6-tuple `(profileId, endpoint, account, workspaceId, workspaceEpoch, canonicalPath)`.
   - Shares underlying dirty buffer and undo/redo stacks across route aliases without duplicate in-memory buffers.
   - Tracks document lifecycle through `canDispose` view lease tracking; clean detached documents close deterministically upon last view release.

3. **Safe Saves & Conflict Protection (`EditorRepository` & `EditorTabSaveCoordinator`):**
   - CAS mtime protection: verifies remote `baselineMtime` matches server file state before committing saves.
   - Stale detection: external server changes mark buffers as stale (`isStale = true`) and present clean auto-reload vs explicit `discardAndReloadTab` resolution.
   - Dirty departures: navigation away from dirty documents or projects is gated by `DepartureRequest`, requiring user confirmation before discarding unsaved edits.
   - *Known review findings (Cycle 3):* Initial editable admission accepts missing/invalid file identity and resolves fallback path (C-02); reconnection rebind clears authority without fresh matching baseline (C-03); explicit discard retains unclosed references for dirty documents in view settlement (C-04); dirty-departure dialogs mount outside in-content Cognito masking (C-05).
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

### Retained Settings Scopes & Safe Configuration (Phase P04)

`DamHopperMobileApp` presents Settings as an overlay above the Agent Hub flow, returning to the captured origin without resetting active screens or terminating remote PTYs:

1. **Three Dedicated Settings Scopes:**
   - **`This Device` (Local Client Preferences):** Managed via local `PreferencesStore` (EncryptedSharedPreferences with fallback). Controls appearance theme, system text scaling, editor/terminal font size (10..32sp), terminal accessory keyboard layout, terminal scroll step (bounded to 1..50, default 5), local diagnostics, and on-device shortcut mappings.
   - **`Preference Source A` (Remote User Preferences):** Synchronizes user preferences with the remote server via `POST /api/global-config/ui`. Sends sparse patches with explicit JSON null unbind serialization, preserving unmodeled web OS fields without silent clobbering.
   - **`Admin Target B` (Host Administration & Daemons):** Manages system daemon configuration (`config.toml`), remote idle suspend controls, and remote SSH key credentials.

2. **Destructive Workspace Switch Guard:**
   - Workspace root changes trigger `WorkspaceSwitchWarningDialog` to explicitly warn about server-side PTY process disposal before executing mutations.
   - *Known review findings (Cycle 3):* Overlaying current commands on original maps preserves removed/renamed keys during remote config edits (Warning 4).

### Bounded Attention Feed & Notification Platform Delivery (Phase P05 / Phase 17)

Mobile notification delivery coordinates server-authoritative semantic attention with Android OS platform sinks:

1. **Bounded In-Memory Attention Queue:**
   - Maintained in process memory capped at 50 history entries and 3 concurrent transient notifications.
   - Fenced admission: only newly accepted live semantic attention (OMP and runtime-qualified Claude) after a silent baseline snapshot generates alerts; Codex is status-only. Reconnects, snapshot reloads, revision gaps, invalidations, and replay reconcile silently without emitting duplicate notifications.

2. **Token-Qualified Single-Use Activation:**
   - Notification clicks invoke `coordinator.activate(token)` consuming the token exactly once.
   - Revalidates exact target profile, project, worktree, and terminal identity across suspension and dirty-departure confirmations.

3. **Android Platform Sinks & Channels:**
   - Exactly three stable private Android notification channels:
     - `channel_terminal_attention` (Importance: High) — semantic agent attention and urgent prompts.
     - `channel_transfers` (Importance: Low) — background file and crypto transfers.
     - `channel_idle_suspend` (Importance: High) — host idle-suspend countdown and consent alerts.
   - Channel visibility is set to `Notification.VISIBILITY_PRIVATE`, using generic lock-screen text to prevent sensitive code/command exposure.
   - User-initiated runtime permissions: API 33+ (`POST_NOTIFICATIONS`) requested only after explicit user configuration; API 29 requires no runtime permission.
   - In-app visual and input protection: active Cognito Privacy Mode suppresses visible notifications and silences alert audio.
   - *Known review findings (Cycle 3):* Notification routing uses pre-consent cached authority rather than fresh post-consent server verification (C-07); target selection callbacks check non-null connection rather than exact logical owner/generation match (C-08).
## 4. Verification & Build Commands

### Current Automated Verification Evidence (2026-11-08)

- **Shared JVM Unit Tests (`:shared:jvmTest`):** **1,044 / 1,044 passed** (0 failures, 0 skipped, 111 test suites; forced rerun 2026-11-08).
- **Android Debug Unit Tests (`:androidApp:testDebugUnitTest`):** **255 / 255 passed** (0 failures, 0 skipped, 31 test suites; forced rerun 2026-11-08).
- **Combined Unit Total:** **1,299 / 1,299 passed** (0 failures, 0 errors, 0 skipped).
- **Debug APK Packaging (`:androidApp:assembleDebug`):** **BUILD SUCCESSFUL** (debug APK produced).
- **Instrumented Test Compilation (`:androidApp:compileDebugAndroidTestKotlin`):** **BUILD SUCCESSFUL** (0 compilation errors; TerminalAgentsSidebarTest and AgentHubRootJourneys compiled cleanly).
- **Disposable Git Oracle Fixture:** **12 / 12 checks passed** (`node native/android-app/scripts/git-workspace-fixture.mjs --self-test`).

### Unexecuted Release Qualification Gates

- **Physical Device Execution & Visual Proof (`GATE-C`):** Categorized as **`BLOCKED_PENDING_DEVICE`** (0 connected devices or emulators observed via `adb devices`). Physical ARM64 device testing (API 29 and API 33+), TalkBack accessibility, IME soft keyboard behavior, and human visual verification remain required future release gates.
- **Live Multi-Server Containerized Runtime:** Multi-server isolation (ports 4804/4805), live Windows signal dispatch, and full containerized crypto isolation remain distinct release gates requiring dedicated isolated environments.

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
./native/android-app/gradlew -p native/android-app :shared:jvmTest

# Run Android unit tests:
./native/android-app/gradlew -p native/android-app :androidApp:testDebugUnitTest

# Assemble debug APK:
./native/android-app/gradlew -p native/android-app :androidApp:assembleDebug

# Compile debug instrumented test sources:
./native/android-app/gradlew -p native/android-app :androidApp:compileDebugAndroidTestKotlin

# Install debug APK on connected device or emulator (pending device attachment):
./native/android-app/gradlew -p native/android-app :androidApp:installDebug

# Run connected Android instrumentation tests (pending device attachment):
./native/android-app/gradlew -p native/android-app :androidApp:connectedDebugAndroidTest
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
- **Phase 12:** Complete Git and safe history workflows *(Implementation baseline recorded; 139/139 static assertions; focused Git view increment implemented in features/git/ and ProjectTerminalScreen; unit, JVM, Android unit tests passing, independent Git oracle and server smoke passing; connected device qualification blocked on missing hardware/adb)*
- **Phase 13:** Workflow tracking and project plans *(Implementation baseline recorded; 100/100 static assertions; qualification open)*
- **Phase 14:** Agent Store imports and memory *(Implementation baseline recorded; 99/99 static assertions; open limitations recorded)*
- **Phase 15:** Host resources, fleet, and usage *(Implementation baseline recorded; 81/81 static assertions; qualification open)*
- **Phase 16:** Ports, tunnels, idle consent, and host controls *(Implementation baseline recorded; 194/194 static assertions in tests/test-phase-16-ports-tunnels-host-controls.sh; dated QA report recorded 417 unit test executions, Cycle 2 review reported 350 unique tests; clean assembleDebug; review score 7/10 changes required / qualification open with 3 High implementation defects and live server/device qualification open; see [Acceptance Ledger](../../docs/android-native-acceptance.md))*
- **Phase 17:** Preferences, privacy, active-runtime notifications, Settings, and reactive consumers *(Implemented; main reports 901 unit tests passing and clean APK assembly; MainActivity/server and physical-device qualification remain open; see [Acceptance Ledger](../../docs/android-native-acceptance.md))*
- **Phase 18:** Integrated device security and performance qualification
- **Phase 19:** Signed APK release and operational handoff (see [.github/workflows/release-android.yml](../../.github/workflows/release-android.yml) and the [Android Release & Signing Setup Guide](../../docs/deployment-guide.md#5-android-native-client-release--github-actions-signing-setup))
- **Native Android Agent Hub Redesign (Phases P01–P08):** **Approved with noted issues after 3 code review cycles by explicit user approval; technical acceptance, safety invariant verification, and release qualification remain open** (2026-11-08). Delivers 2-stage flow Profile Login → Agent Hub (`AppFlowStage.HUB`), two-row chrome with minimum 48dp touch targets, responsive navigator rail (>=360dp) vs modal cover, nested capabilities (Terminal, Files, Editor, Git), canonical document leases under retained owner with shared dirty buffers/undo stacks, guarded PTY termination via atomic `POST /api/terminal/{id}/terminate` (`X-DamHopper-PTY-Epoch` UUID epoch and positive u64 `incarnationExact`), persistent uncertain-create records, retained Settings scopes (`This Device`, `Preference Source A`, `Admin Target B`), and bounded attention feed (50 history / 3 transients) across 3 private Android notification channels. Verified by 1,299 passing automated unit tests (1,044 shared JVM + 255 Android debug unit tests; forced rerun 2026-11-08), clean debug APK packaging, clean test compilation, and independent Git oracle pass. Final Cycle 3 code review scored 5/10 with 7 critical issues (C-01 to C-08, with C-06 addressed) and 7 warnings preserved as open technical debt. Physical device and live multi-server release gates remain unexecuted (`BLOCKED_PENDING_DEVICE`).
