# Codebase Scout Report: Native Desktop & Tooling Architecture

**Report Target**: `plans/reports/scout-261005-1653-nativetooling.md`  
**Date**: 2026-10-05  
**Scope**: Desktop/Tauri host (`apps/native`), runtime bridges, permissions/capabilities, scripts, root workspace configuration, deployment templates, and README.

---

## 1. Directory and Symbol Map

### 1.1 Root & Workspace Configurations
- `package.json`: Root manifest defining monorepo scripts (`dev:native`, `build:native`, `check`, `release:verify`, `release:verify-windows`, `test:all`), engines (`node >=20`, `pnpm >=10`), and root devDependencies (`eslint `9`, `@typescript-eslint/parser `8`, `prettier `3`).
- `pnpm-workspace.yaml`: Defines packages (`apps/*`, `packages/*`), build permissions (`allowBuilds.esbuild: true`), and dependency patches (`@radix-ui/react-compose-refs@1.1.2`).
- `tsconfig.base.json`: Base TypeScript compiler options (`target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`, `verbatimModuleSyntax: true`).
- `eslint.config.js`: ESLint flat configuration using `@typescript-eslint` and `eslint-plugin-react-hooks`. Excludes build artifacts and dependencies; relaxes hook rules for test files.
- `.prettierrc`: Formatting rules (`semi: true`, `singleQuote: false`, `tabWidth: 2`, `trailingComma: "all"`).
- `.editorconfig`: Line ending enforcement (`end_of_line = lf`, `charset = utf-8`).
- `deploy/server.env.example`: Service environment variables template (`MONGODB_URI`, `MONGODB_DATABASE`, `DAM_HOPPER_MFA_KEY_FILE`, `DAM_HOPPER_CORS_ORIGINS`).
- `README.md`: Architectural map, web development instructions, loopback development security warnings, release installation paths. Preserved user content and conventions.

### 1.2 Native Application (`apps/native/`)
- `package.json`: Package `@dam-hopper/native` v0.10.2. Scripts for Tauri v2 workflows (`tauri:dev`, `tauri:build`, `tauri:build:windows`, `tauri:probe`, smoke scripts, Android and iOS scaffolds).
- `vite.config.ts`: Native frontend bundler setup on port 1420. Injects `__DAM_HOPPER_TAURI_PLATFORM__`, configures module aliases (`@` -> `packages/ui/src`, `@dam-hopper/browser-bridge` -> `packages/browser-bridge/src/index.ts`), and applies `fixBrokenXtermRequestMode()`.
- `tsconfig.json`: TypeScript project configuration extending `../../tsconfig.base.json`.
- `index.html`: Webview host mount point (`#root`) loading `/src/main.tsx`.

#### Source Modules (`apps/native/src/`)
- `main.tsx`: Native entrypoint.
  - `syncNativePlatform()`: Sets DOM dataset (`appHost="native"`, `appPlatform`, `deviceKind`) and `window.damHopper`.
  - `installNativeDebugConsoleShortcut()`: Global listener for Shift+F12 invoking native `open_debug_console`.
  - Application bootstrapping: Calls `performFreshStateReset()`, `migrateToProfiles()`, instantiates `QueryClient`, mounts `DamHopperApp` wrapped by `SshForwardHostProvider`, `SshForwardScopeBridge`, and `BrowserDebugHostProvider`.
- `native-browser-debug-host.ts`: Client adapter for native browser debug sidecar.
  - `NativeBrowserDebugHost`: Implements `BrowserDebugHost`. Enqueues target mutations, invokes `browser_debug_create`, `browser_debug_navigate`, `browser_debug_command`, `browser_debug_set_bounds`, `browser_debug_set_zoom`, `browser_debug_set_visible`, `browser_debug_destroy`. Handles `browser-debug:relay` and `browser-debug:relay-rejected` events.
  - `bridgeEventToHostEvent()`: Normalizes bridge events (`dam-hopper:bridge-ready`, `dam-hopper:selection`, `dam-hopper:navigation`, `dam-hopper:error`).
  - Helper functions: `isNativeBrowserDebugEnabled()`, `isNativeBrowserDebugPlatformSupported()` (Windows and Linux), `getNativeBrowserDebugEnvironment()`.
- `native-ssh-forward-host.ts`: Client adapter for Windows native SSH port forwarding.
  - `NativeSshForwardHost`: Implements `SshForwardHost`. Dispatches to 20 Tauri IPC commands defined in `NATIVE_SSH_FORWARD_COMMANDS`.
  - Input & output wire validation functions: Strict schema validators for UUIDv4, `WireCounter`, `UtcTimestamp`, `SshConnectionProfile`, `SshForwardRule`, `SshForwardSnapshot`, `KeyInventory`.
  - `createNativeSshForwardHost()`: Factory returning `NativeSshForwardHost` exclusively on Windows (`platform === "windows"`).
- `native-server-url.ts`:
  - `isProfileSupportedOnNative()`: Enforces network isolation: Windows allows remote HTTP(S) server profiles, while non-Windows native desktop enforces exact same-origin profile URLs.
- `idle-transport.ts`:
  - `IdleTransport`: Fallback `Transport` rejecting invokes when no active server profile is selected.
- `tauri-api.d.ts` & `vite-env.d.ts`: Ambient typings for `@tauri-apps/api/core` `invoke` and Vite client.

### 1.3 Native Tauri Host (`apps/native/src-tauri/`)
- `Cargo.toml`: Package `dam-hopper-native` v0.10.2.
  - Core dependencies: `tauri = "=2.11.5"` (features: `unstable`, `devtools`), `tauri-plugin-notification = "=2.3.3"`, `sha2`, `serde`, `tokio`, `uuid`, `time`, `toml`.
  - Windows dependencies (`cfg(windows)`): `webview2-com = "=0.38.2"`, `windows = "0.61"`, `windows-sys = "0.61"`, `russh = "=0.62.5"` (ring engine), `tokio`, `zeroize = "1"`, `base64 = "=0.22.1"`.
  - Linux dependencies (`cfg(target_os = "linux")`): `webkit2gtk = "=2.0.2"` (features: `v2_40`).
- `build.rs`:
  - Verifies presence of and embeds compiled browser bridge IIFE into `/browser-debug-bridge.iife.js`.
  - Windows MSVC: Injects linker flags for `windows.manifest` and attaches `SSH_FORWARD_COMMANDS` to `AppManifest`.
- `tauri.conf.json`: Tauri v2 configuration. App identifier `com.damhopper`, window dimensions (1280x800, min 960x640), strict CSP (`connect-src` loopback and WebSocket, `frame-src`, asset schemes).
- `tauri.package.conf.json` & `tauri.windows.package.conf.json`: Release packaging overrides disabling updater artifacts.

#### Capabilities & Permissions (`apps/native/src-tauri/capabilities/` & `permissions/`)
- `capabilities/default.json`: Granted to window `main`. Permissions: `core:default`, `notification:allow-is-permission-granted`, `notification:allow-request-permission`, `notification:allow-notify`.
- `capabilities/browser-debug.json`: Granted to window `main` on platforms `["windows", "linux"]`. Permissions: `["browser-debug"]`.
- `capabilities/ssh-forward.json`: Granted to window `main` strictly on `["windows"]`. Permissions: `["ssh-forward"]`.
- `permissions/browser-debug.toml`: Defines `browser-debug` permission covering 8 commands: `browser_debug_create`, `browser_debug_navigate`, `browser_debug_command`, `browser_debug_set_bounds`, `browser_debug_set_zoom`, `browser_debug_set_visible`, `browser_debug_destroy`, `browser_debug_clear_data`.
- `permissions/ssh-forward.toml`: Defines `ssh-forward` permission covering 20 commands: `ssh_forward_open_client`, `ssh_forward_open_scope`, `ssh_forward_close_scope`, `ssh_forward_reconcile_known_scopes`, `ssh_forward_snapshot`, `ssh_forward_create_connection`, `ssh_forward_update_connection`, `ssh_forward_delete_connection`, `ssh_forward_create_rule`, `ssh_forward_update_rule`, `ssh_forward_delete_rule`, `ssh_forward_connect`, `ssh_forward_disconnect`, `ssh_forward_set_rule_enabled`, `ssh_forward_list_keys`, `ssh_forward_load_key`, `ssh_forward_load_password`, `ssh_forward_forget_credential`, `ssh_forward_approve_host`, `ssh_forward_purge_scope`.

#### Rust Native Implementation (`apps/native/src-tauri/src/`)
- `main.rs`: Entrypoint. Checks for `--ssh-forward-trust-repair` argument on Windows to invoke `run_trust_repair(&arguments)`. Otherwise executes `dam_hopper_native_lib::run()`.
- `lib.rs`: Tauri builder orchestration.
  - Registers `tauri_plugin_notification`.
  - Windows: Registers `open_debug_console`, 9 browser debug commands, and 20 SSH forward commands. Initializes `SshForwardManager` and `NativeShutdownCoordinator`.
  - Non-Windows desktop: Registers `open_debug_console` and 9 browser debug commands only (SSH commands absent).
  - Handles `WindowEvent::CloseRequested` and `RunEvent::ExitRequested` to run graceful shutdown before process termination.
- `shutdown.rs`:
  - `NativeShutdownCoordinator`: Coordinates bounded graceful disposal (5-second grace period `SHUTDOWN_GRACE`) across active SSH tunnels and browser debug child webviews.
- `browser_debug/`:
  - `controller.rs`: `BrowserDebugController` state machine. Spawns child webview `browser-debug`, injects embedded bridge IIFE, applies geometry/zoom, handles commands and message relays.
  - `navigation_policy.rs`: `NavigationPolicy`. Enforces canonical origins; allows only loopback HTTP (`127.0.0.1`, `::1`, `localhost`) or explicitly registered credential-free HTTPS tunnel origins. Rejects embedded credentials.
  - `platform.rs`: `install_relay()`. Windows attaches WebView2 COM `with_webview` denying permissions (`COREWEBVIEW2_PERMISSION_STATE_DENY`) and tapping `WebMessageReceived`. Linux connects to `webkit2gtk::UserContentManagerExt::connect_script_message_received`. Other platforms return `Unsupported`.
  - `profile_storage.rs`: `ProfileStorage`. Allocates isolated user data directory hashed via SHA256 of server profile ID under `<app_data_dir>/browser-debug/profiles/<hash>`.
  - `protocol.rs`: Enforces wire limits: max message envelope 64 KiB (`MAX_RELAY_BYTES`), max payload 60 KiB (`MAX_PAYLOAD_BYTES`), string lengths, and strict key structure.
- `ssh_forward/`:
  - `mod.rs`: Windows-gated module seam. `ensure_main_window()` verifies webview label is `"main"`.
  - `command_names.in.rs`: Canonical compile-time array of the 20 SSH forwarding command names.
  - `commands.rs`: Exact Tauri command handler functions verifying `ensure_desktop_main` and calling `SshForwardManager`.
  - `manager.rs`: `SshForwardManager`. Authoritative lifecycle controller. Enforces limits: 16 active forwards (`ACTIVE_FORWARD_LIMIT`), 4 concurrent handshakes, 250ms event debounce (`EVENT_MIN_INTERVAL`), 20s connect command timeout, 5s worker shutdown grace. Manages CAS optimistic revisions (`connections_revision`, `rules_revision`).
  - `connection_runtime.rs`: Tokio TCP listener lifecycle, loopback binding, connection admission, session slots.
  - `ssh_client.rs`: `russh` adapter. Connect timeout 15s, channel timeout 10s, keepalive 30s with max 2 misses (drops on 3rd probe). Limits channels to 64.
  - `model.rs`: DTOs and wire contracts (`WireCounter`, `UtcTimestamp`, `SshForwardSnapshot`, inputs/results).
  - `profile.rs`: `SshConnectionProfile`, `SshForwardRule`, strict `LoopbackHost` ("127.0.0.1" only).
  - `known_hosts.rs`: Strict SSH host key trust. Only elliptic curve algorithms allowed (`ssh-ed25519`, `ecdsa-sha2-nistp256/384/521`). RSA prohibited. Challenges expire in 5 minutes (`CHALLENGE_TTL_SECONDS = 300`).
  - `trust_repair.rs`: Out-of-band CLI tool (`--ssh-forward-trust-repair`) executed when DamHopper is stopped to repair or restore compromised known-host entries.
  - `store.rs`: Handle-based atomic storage under `<app_config_dir>/ssh-forward/`. Multi-process file locks (`ScopeActivityLease`, `FeatureRuntimeLease`).
  - `store_schema.rs`: V1 to V2 schema migration (`StoredScopeConfigV2`). Separates connections from forwarding rules (max 64 connections, max 64 rules per scope).
  - `scope_retention.rs`: 30-day quarantine retention (`ORPHAN_RETENTION_DAYS = 30`) before unreferenced scopes become purge-eligible.
  - `instance.rs`: `ClientEpochIssuer` and `DesktopClientContext` ensuring monotonically increasing epoch ordering per manager session.
  - `error.rs`: Redacted error codes (`SshForwardErrorCode`) and fixed public error messages.

### 1.4 Native & Root Utility Scripts
- `apps/native/scripts/`:
  - `smoke-browser-debug.mjs`: Validates bridge build inputs, inspects Windows WebView2 Evergreen runtime version from registry, and validates JSON evidence against 10 lifecycle checks.
  - `smoke-ssh-forward.mjs`: Validates Tauri build inputs, checks WebView2 and OpenSSH executables, runs runtime preflight, and verifies evidence JSON.
  - `ssh-forward-evidence.mjs`: Validates evidence JSON against 13 security/runtime requirements; verifies zero sensitive credentials or private keys are retained.
  - `bump-version.js`: Localized version bump utility for `apps/native` (updates `package.json`, `Cargo.toml`, `tauri.conf.json`).
- `scripts/`:
  - `run-uat.sh`: Full UAT runner orchestrating the Rust API server and web host with PID tracking and health probes.
  - `run-all-tests.sh`: Monorepo test runner executing package test suites in serial order within isolated process groups (`setsid`).
  - `bench.sh`: HTTP benchmark runner for Rust server API endpoints using `hey` or `wrk`.
  - `verify-idle-suspend-boundary.sh`: Enforces terminal idle suspend security invariants (zero sudo, zero shell, systemd hardening directives, 16 KiB force-suspend body limit).
  - `qualify-phase09-workbench.mjs`: Concurrent multi-server qualification harness.
  - `qualify-host-resource-sse.mjs`: Qualification suite for SSE host-resource delivery.
  - `profile-host-resource-monitor.sh` & `profile-host-resource-deep-scan.sh`: Dedicated Linux profilers for host resource background monitors.
  - `compare-servers.sh`: API comparison tool targeting the legacy Node server.

---

## 2. Runtime and Data Flow



### 2.1 Browser Debug Child Sidecar
1. **Target Selection**: UI calls `NativeBrowserDebugHost.setTarget(target)`.
2. **Navigation Policy Evaluation**: Native `BrowserDebugController` checks target URL with `NavigationPolicy`. URL must be either loopback HTTP (`http://127.0.0.1:*`, `http://localhost:*`) or registered credential-free HTTPS tunnel. Credentials in URLs are rejected.
3. **Storage Isolation**: Allocates a separate WebView data directory via `ProfileStorage` under `<app_data_dir>/browser-debug/profiles/<sha256(profileId)>`.
4. **Child Creation**: Tauri instantiates child Webview `browser-debug` embedded inside the main window geometry.
5. **Platform Relay Hook**:
   - **Windows**: Attaches WebView2 COM handler via `with_webview`. Explicitly denies permissions (geolocation, notifications, camera, microphone) and intercepts `WebMessageReceived`.
   - **Linux**: Connects WebKitGTK `script_message_received` signal on `UserContentManager`.
   - **macOS / Other**: Returns `Unsupported`.
6. **Bridge Script Injection**: Pre-bundled `browser-debug-bridge.iife.js` script initializes communication inside the child webview.
7. **Message Relay**: Messages from the child are validated by `protocol.rs` (size limits: 64 KiB total, 60 KiB payload), verified with generation, nonce, and requestId, then emitted to the main webview via Tauri events `browser-debug:relay` or `browser-debug:relay-rejected`.

### 2.2 SSH Forward Routing (Windows-Only)
1. **Access Boundary Check**: Every SSH command validates `ensure_desktop_main(&webview)`. Calls originating from any webview other than `main` (such as the untrusted `browser-debug` child) are immediately rejected with `DesktopInstanceMismatch`.
2. **Client Context Initialization**: Client invokes `ssh_forward_open_client` providing known scope IDs. The manager creates/loads `<app_config_dir>/ssh-forward/desktop-instance.toml` and returns `DesktopClientContext` (instance ID, session ID, client epoch).
3. **Scope Management & CAS Persistence**:
   - Scope activation (`ssh_forward_open_scope`) opens `<app_config_dir>/ssh-forward/scopes/<hash>/`.
   - Acquires cross-process activity lock `ScopeActivityLease`.
   - Scopes store configurations in TOML V2 schema (`StoredScopeConfigV2`) containing up to 64 connections and 64 forwarding rules.
   - All mutations enforce CAS optimistic concurrency via `connections_revision` and `rules_revision` (`WireCounter`). Mismatches return `ConnectionsRevisionConflict` or `RulesRevisionConflict`.
4. **Authentication & Credential Security**:
   - Passwords and SSH key passphrases are stored in the Windows Credential Manager (`WindowsCredentialVault`) or held in temporary memory leases (`CredentialLease`) protected by `zeroize`.
   - Passwords and private keys are never persisted in TOML config files.
5. **Connection & Port Forwarding**:
   - Invoking `ssh_forward_connect` connects to the remote host using `russh` (Ring crypto backend).
   - Strict host-key checking via `known_hosts.rs`: Requires `ssh-ed25519` or `ecdsa-sha2-*`. Prohibits RSA. Unrecognized keys require user approval challenges (valid for 5 minutes). Changed keys block connection and require stopped-app CLI repair (`--ssh-forward-trust-repair`).
   - Active forwarding rules bind local TCP listeners strictly on `127.0.0.1:<local_port>` (never `0.0.0.0`). Bidirectional traffic multiplexes over `russh` direct-tcpip channels.
6. **Graceful Shutdown**:
   - Main window `CloseRequested` and app `ExitRequested` events are intercepted by `NativeShutdownCoordinator`.
   - Active tunnels, TCP listeners, and child webviews are afforded up to 5 seconds (`SHUTDOWN_GRACE`) for orderly disconnection before the process terminates.

---

## 3. Authoritative Commands, Config, and Contracts

### 3.1 Authoritative Commands
| Command | Execution Method / Path | Scope / Purpose |
| --- | --- | --- |
| `dev:native` | `pnpm --filter @dam-hopper/native tauri:dev` | Start native Vite host + Tauri desktop app |
| `build:native` | `pnpm --filter @dam-hopper/native tauri:build` | Build native deb and rpm packages (Linux) |
| `build:native:windows` | `pnpm --filter @dam-hopper/native tauri:build:windows` | Build NSIS installer package (Windows) |
| `tauri:probe` | `node apps/native/scripts/smoke-browser-debug.mjs --runtime` | Preflight WebView2 runtime on Windows |
| `smoke:evidence` | `node apps/native/scripts/smoke-browser-debug.mjs --validate-evidence` | Validate browser debug evidence against 10 checks |
| `smoke:ssh-forward` | `node apps/native/scripts/smoke-ssh-forward.mjs` | Validate SSH forward build inputs and runtime |
| `test:all` | `scripts/run-all-tests.sh` | Run all monorepo test suites in process groups |
| `check` | `pnpm check` | Root verify: web build, native build, lint, cargo test |
| `release:verify` | `pnpm release:verify` | Verify version alignment and release script syntax |
| `release:verify-windows` | `pnpm release:verify-windows` | Verify Windows release archives and PowerShell AST |
| `trust-repair` | `dam-hopper.exe --ssh-forward-trust-repair <cmd>` | Out-of-band CLI to remove endpoint or restore trust |

### 3.2 Configuration Contracts
- **`tauri.conf.json`**:
  - `devUrl`: `http://localhost:1420`
  - `frontendDist`: `../dist`
  - `security.csp`: Restricts connect sources to loopback (`http://localhost:*`, `http://127.0.0.1:*`, `ws://*`, `tauri:`).
- **`build.rs` Asset Contract**:
  - Requires pre-compiled browser bridge bundle from package `@dam-hopper/browser-bridge` (`packages/browser-bridge output index.iife.js`). Cargo build panics if missing.
- **Storage Layout (`ssh-forward/`)**:
  - Root: `%APPDATA%\com.damhopper\ssh-forward\`
  - `desktop-instance.toml`: Unique desktop instance GUID.
  - `scopes/<sha256(scopeId)>/profiles.toml`: V2 configuration schema.
  - `scopes/<sha256(scopeId)>/known-hosts.toml`: Trusted host key fingerprints.
  - `scopes/<sha256(scopeId)>/scope-meta.toml`: Last seen timestamps and orphan quarantine dates.
  - File locks: `ssh-forward.lock`, `ssh-forward-runtime.lock`, `scope-activity.lock`, `scope-operation.lock`.

---

## 4. Product Capabilities and Limits

### 4.1 Platform Capability Matrix
| Feature | Windows (x64) | Linux (x64) | macOS / Mobile |
| --- | --- | --- | --- |
| **Desktop Host Shell** | Supported (WebView2) | Supported (WebKitGTK) | Mobile scaffolds only; desktop macOS unsupported |
| **Browser Debug Sidecar** | Supported (Full Relay) | Partial (Embedded view; relay verification pending) | Unsupported |
| **Native SSH Forwarding** | Supported (`cfg(windows)`) | Unsupported (`cfg(windows)` gated) | Unsupported |
| **Remote Profile URLs** | Allowed (HTTP/HTTPS) | Loopback same-origin only | Loopback same-origin only |
| **Packaging Bundles** | NSIS (`.exe`) | DEB, RPM | Mobile APK / iOS workspace scaffolds |

### 4.2 Architectural Limits & Security Thresholds
- **SSH Forwarding Limits**:
  - Max active forwards across all connections: **16**.
  - Max concurrent connection handshakes: **4**.
  - Max direct-tcpip channels per connection: **64**.
  - Max saved connection profiles per scope: **64**.
  - Max saved forwarding rules per scope: **64**.
  - Handshake connection timeout: **15 seconds**; outer connect timeout: **20 seconds**.
  - SSH Keepalive: **30 seconds** interval; disconnects after **2 consecutive missed replies** (drop on 3rd probe).
  - Target binding: Strictly **`127.0.0.1`** loopback.
  - Cryptographic algorithms: Only modern elliptic curve curves allowed (`ssh-ed25519`, `ecdsa-sha2-nistp256/384/521`). RSA is rejected.
  - Host key approval challenge TTL: **5 minutes** (300 seconds).
  - Orphan scope retention: **30 days** in quarantine before becoming purge-eligible.
- **Browser Debug Limits**:
  - Maximum relay envelope size: **64 KiB** (`MAX_RELAY_BYTES`).
  - Maximum payload size: **60 KiB** (`MAX_PAYLOAD_BYTES`).
  - Maximum URL length: **2,048 characters**.
  - Maximum nonce and request ID length: **128 characters**.
  - Injected bridge capabilities: Restricted strictly to `navigation` and `picker`; console mirroring over IPC is prohibited to prevent infinite feedback loops with Tauri invoke parser.
  - WebView2 permissions: Hardware and sensitive permissions (camera, microphone, geolocation, notifications) denied at runtime.

---

## 5. Documentation Updates Needed

### 5.1 Platform Gate Clarifications (`README.md` & `docs/system-architecture.md`)
- **Evidence**: `apps/native/src-tauri/capabilities/ssh-forward.json` sets platform gate to `windows`. `apps/native/src/native-ssh-forward-host.ts` explicitly checks `platform === "windows"`. `apps/native/src/native-server-url.ts` restricts non-Windows desktop to same-origin.
- **Deficiency**: `README.md` describes DamHopper as a multi-profile workbench for web and desktop without specifying that native SSH local port forwarding is currently implemented and supported exclusively on Windows.
- **Action**: Add explicit platform support notes in `README.md` and `docs/system-architecture.md` clarifying that SSH port forwarding is Windows-only, and non-Windows native clients enforce loopback same-origin profiles.

### 5.2 Version Bump Protocol Alignment (`apps/native/scripts/bump-version.js`)
- **Evidence**: `apps/native/scripts/bump-version.js` updates only 4 files (`package.json`, `Cargo.toml`, `tauri.conf.json`, `tauri.properties`).
- **Deficiency**: The repository versioning policy (`memory://root/MEMORY.md` and `deploy/release/check-version-alignment.mjs`) mandates synchronizing **13 distinct version files**. A developer running `pnpm --prefix apps/native run version` will leave 9 files desynchronized and fail `pnpm release:check-version`.
- **Action**: Document in `docs/code-standards.md` and script comments that `apps/native/scripts/bump-version.js` is a localized internal tool and must be followed by `node deploy/release/check-version-alignment.mjs` or the full release checklist.

### 5.3 Build Prerequisites Documentation (`docs/deployment-guide.md`)
- **Evidence**: `apps/native/src-tauri/build.rs` panics if browser bridge asset does not exist. `apps/native/src-tauri/Cargo.toml` requires `webkit2gtk` with `v2_40` feature on Linux.
- **Deficiency**: Developers attempting `cargo build` directly in `apps/native/src-tauri` without building the browser bridge will fail with a panic. Linux developers without WebKitGTK 4.1 development headers will fail native compilation.
- **Action**: Add a "Native Desktop Prerequisites" section to `docs/deployment-guide.md` specifying: (1) `pnpm --filter @dam-hopper/browser-bridge build` is required before building native desktop, and (2) Linux system requirements (`libwebkit2gtk-4.1-dev` or equivalent).

---

## 6. Retired versus Active Functionality

### 6.1 Retired Functionality
- **Node.js API Server (`packages/server/`)**: Completely retired in favor of the Axum/Tokio Rust server in `server/`. `scripts/compare-servers.sh` references `packages/server`, which no longer exists in the repository.
- **Linux Plugin Runner (`dam-hopper-plugin-runner`)**: Retired. The Advisor architecture now operates as a native Rust server subsystem and React UI panel (`MEMORY.md:57-73`).
- **Linux Release Runner `NOTICES` Asset**: Retired from `deploy/release/check-release-assets.mjs` following Linux runner retirement (`MEMORY.md:27-28`).
- **SSH Forward V1 Profile Schema (`StoredProfilesV1`)**: Retired in favor of V2 (`StoredScopeConfigV2`). V1 1-to-1 profiles are automatically migrated to separated connections and rules upon opening scopes (`store_schema.rs:37-75`).
- **RSA Host Key Support**: Deprecated and rejected in SSH client forwarding. Only elliptic curve algorithms (`ed25519`, `ecdsa-sha2`) are supported (`known_hosts.rs:19-24`).

### 6.2 Active Functionality
- **Tauri 2 Native Host (`apps/native`)**: Active host using Tauri v2.11.5 and Vite 6.
- **Native Browser Debug Sidecar**: Active on Windows (WebView2) and Linux (WebKitGTK).
- **Native SSH Port Forwarding**: Active on Windows with handle-based atomic storage, DPAPI credential vault, CAS revisions, and out-of-band trust repair CLI.
- **Host Resource SSE Streaming**: Active Rust Axum subsystem streaming host metrics with qualification test runners (`scripts/qualify-host-resource-sse.mjs`).
- **Terminal Idle Suspend Boundary Hardening**: Active contract enforcement (`scripts/verify-idle-suspend-boundary.sh`).

---

## 7. Unresolved Questions

1. **`scripts/compare-servers.sh` Obsolescence**: Since `packages/server` has been retired and deleted, should `scripts/compare-servers.sh` be removed or refactored into a mock benchmark comparator?
2. **Linux SSH Forwarding Roadmap**: Is native SSH local port forwarding planned for Linux in a future milestone, or is the architecture permanently bounded to Windows?
3. **Linux WebKitGTK Browser Debug Runtime Qualification**: `apps/native/scripts/smoke-browser-debug.mjs` notes that "Linux WebKitGTK runtime verification remains pending". What specific headless or containerized runtime checks are planned to graduate Linux browser debug into active CI gating?
