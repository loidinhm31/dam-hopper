# Scout Report: Host Entry Apps, Packages, and Deploy Pipelines

**Date:** 2026-10-05  
**Target Focus:** `apps/web/`, `apps/native/`, `packages/browser-bridge/`, `packages/shared/`, `deploy/`, `scripts/`  
**Monorepo Tech Stack:** Rust server/native + React 19 UI + Tauri 2 + Vite 6 + pnpm v10

---

## 1. Architecture Topology & Component Overview

```
                    ┌───────────────────────────┐
                    │  packages/browser-bridge  │
                    │   (V1 debugging protocol, │
                    │   IIFE & ESM distributions)│
                    └─────────────┬─────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │ (embedded at build)    │ (staged zip bundle)    │ (runtime postMessage)
         ▼                        ▼                        ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   apps/native    │    │ apps/browser-ext │    │    apps/web      │
│  Tauri 2 desktop │    │  MV3 Chrome/Edge │    │    Vite SPA      │
│ (Win/Linux/Andr) │    │  (DevTools DOM)  │    │  (port 4802/5173)│
└────────┬─────────┘    └──────────────────┘    └────────┬─────────┘
         │                                               │
         │ (IPC / WebView)                               │ (REST/WS proxy)
         ▼                                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                   DamHopper Server / Services                    │
│  - dam-hopper-server (API :4801, Axum, Tokio, MongoDB/auth)       │
│  - dam-hopper-web    (Static Host :4802, hyper/tower)            │
│  - dam-hopper-manager (Linux Release CLI / Provisioner)          │
│  - dam-hopper-idle-suspend-helper (Root socket / RTC wakealarm)  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Host Entry Applications

### 2.1 apps/web (Vite SPA Host)
- **Role:** Web browser single-page app and dev host.
- **Build & Packaging:**
  - Vite 6 + `@vitejs/plugin-react` (React 19) + `@tailwindcss/vite` (v4).
  - Target: `es2022`, base: `/`.
  - Injected defines: `__DAM_HOPPER_RELEASE_VERSION__`.
  - Manual Rollup chunking: Monaco editor (`monaco`), xterm (`terminal`), react-markdown/remark (`markdown`), react-arborist (`tree`), react-qr-code (`qr`).
  - Workaround plugin: `fixBrokenXtermRequestMode` prevents invalid fetch request modes.
  - Lifecycle hook (`prebuild` & `predev`): Runs `scripts/stage-browser-debug-extension.mjs`, compiling `apps/browser-extension` and packaging `public/browser-debug-extension/dam-hopper-browser-debug.zip` for direct user download from UI.
- **Dev Loopback Proxy:**
  - Targets `http://127.0.0.1:4803` (or `VITE_DAM_HOPPER_SERVER_URL`).
  - Proxies `/api` (HTTP REST/SSE) and `/ws` (WebSockets).
  - Enforces production invariant: `VITE_DAM_HOPPER_SERVER_URL` must remain unset for production builds; throws explicit build error if defined.
- **Bootstrapping Flow (`src/main.tsx`):**
  1. `configureLogger` with level from `VITE_DAM_HOPPER_LOG_LEVEL` (defaults to dev `debug`, prod `warn`).
  2. `initializeClientDiagnostics()`.
  3. `performFreshStateReset()` (idempotent clean state wipe).
  4. `initTransport(new IdleTransport())` (safe fallback pre-mount).
  5. `migrateToProfiles()` (migrates legacy single-server keys).
  6. `fetchRuntimeConfig()` + `reconcileManagedProfile(runtimeConfig)`.
  7. Renders React 19 tree with `QueryClient` (`staleTime: 10_000, retry: 1`).

### 2.2 apps/native (Tauri 2 Desktop & Mobile Host)
- **Role:** Cross-platform native host (Windows, Linux, Android, iOS stub).
- **Vite Configuration:**
  - Base: `./` (relative paths required for local webview file resolution).
  - Dev server: port 1420 (strictPort: true), dev host support via `TAURI_DEV_HOST`.
  - Compilation target: `tauriPlatform === "windows" ? "chrome105" : "safari13"`.
- **Tauri 2 Rust Layer (`src-tauri`):**
  - Crate: `dam-hopper-native`, lib: `dam_hopper_native_lib`, entry: `main.rs`.
  - Window topology: Single main webview window (1280x800, min 960x640).
  - Child webview: Dynamically created `browser-debug` webview bound to main window bounds.
  - Windows Manifest: Embeds `windows.manifest` with Common Controls via MSVC linker flags (`/MANIFEST:EMBED`) in `build.rs`.
  - Build-time Asset Embedding: `build.rs` validates and copies the browser-bridge IIFE asset into Cargo output dir `browser-debug-bridge.iife.js`, included statically into `src/browser_debug/controller.rs` via `include_str!`. Panics if browser-bridge was not compiled first.
- **Platform Capability Gates (`capabilities` & `permissions`):**
  - `default.json`: Scoped to `windows: ["main"]`, enables `core:default` and `notification:*`.
  - `browser-debug.json`: Platforms `["windows", "linux"]`, enables commands `browser_debug_*`.
  - `ssh-forward.json`: Platform `["windows"]` ONLY, enables commands `ssh_forward_*`.
  - Mobile: Neither desktop capability granted; only notifications active.
- **Window Boundary & Security ACL:**
  - `ssh_forward::ensure_main_window(label)`: Hard rejects any IPC invocation from child or non-main webviews (`label != "main"`).
  - CSP configured in `tauri.conf.json`: Restricts scripts, styles, frames, workers, connect targets.
  - Headless CLI Mode: `--ssh-forward-trust-repair` on Windows triggers `dam_hopper_native_lib::run_trust_repair(&arguments)` without creating desktop windows.
- **Graceful Shutdown Coordinator (`src/shutdown.rs`):**
  - Active on Windows desktop. 5-second grace window (`SHUTDOWN_GRACE`).
  - Intercepts `WindowEvent::CloseRequested` and app exit events.
  - Disposes SSH forwarding manager instances and child browser debug webviews before app termination.

---

## 3. Packages Architecture

### 3.1 packages/browser-bridge (Browser Debugging Protocol & Runtime)
- **Role:** Framework-neutral, zero-dependency bridge running inside target documents or extension content scripts.
- **Distribution:** Builds dual ESM (`index.js`) and IIFE (`index.iife.js`) via Vite library mode.
- **Protocol Contract (`src/protocol.ts` - V1):**
  - Version constant: `BROWSER_BRIDGE_VERSION = 1`.
  - Input guards: Nonce / Request ID max 128 chars; text max 512 chars; URL max 2048 chars; max 12 attributes (128 chars each); max locator depth 6 levels (512 chars max).
  - Attribute allowlist: `id`, `class`, `name`, `data-testid`, `role`, `aria-label`, `type`, `placeholder`, `href`, `title`, `alt`, `value`. Strips passwords, authorization tokens, hidden values.
  - Commands: `dam-hopper:connect`, `dam-hopper:start-picker`, `dam-hopper:stop-picker`, `dam-hopper:go-back`, `dam-hopper:go-forward`, `dam-hopper:reload`.
  - Events: `dam-hopper:bridge-ready`, `dam-hopper:selection`, `dam-hopper:navigation`, `dam-hopper:console`, `dam-hopper:error`.
- **Target Channels & Observers:**
  - `createPostMessageBrowserBridgeChannel`: Wraps `window.parent.postMessage` and `message` listener.
  - Navigation observer (`observeNavigation`): Monkeypatches `history.pushState`, `history.replaceState`, listens to `popstate`, `hashchange`.
  - Console observer (`observeConsole`): Intercepts `debug`, `log`, `info`, `warn`, `error` with structured metadata.
  - Element Picker (`createPicker`): Real-time hovering overlay, geometry bounding box calculations, DOM breadcrumbs, resilient locator synthesis (`data-testid`, semantic attributes, CSS path).
  - Extension presence detection (`markBrowserExtensionPresence`): Injects DOM attribute `data-dam-hopper-browser-debug="1"` and emits `dam-hopper:browser-extension-ready`.

### 3.2 packages/shared (Shared Utilities & Redaction)
- **Role:** Minimal runtime utilities shared across all frontend and client targets.
- **Logger (`src/logger.ts`):**
  - Levels: `debug`, `info`, `warn`, `error`, `silent` with ordinal ranking.
  - Multi-sink subscription architecture (`addLoggerSink`).
  - Automatic Sensitive Data Redaction (`redactSensitiveData: true` default):
    - Regex pattern: `SENSITIVE_KEY_PATTERN` matches `token`, `authorization`, `password`, `passwd`, `passphrase`, `api[-_]?key`, `secret`, `credential`, `private[-_]?key`.
    - String scrubbing: Scans Bearer tokens (`Bearer ...`), query params (`?token=...`), key-value assignments.
    - Deep tree recursion: Traverses arrays and object structures up to `MAX_REDACTION_DEPTH = 8`.
    - Cycle defense: `WeakSet` tracks visited object references, substitutes `"[Circular]"`.
    - Error normalization: Sanitizes message and stack traces.

---

## 4. Deploy Pipelines & Infrastructure

### 4.1 Systemd Topology (`deploy/systemd`)
Linux production services run on systemd (RHEL / Fedora 44 / Debian compatible):
1. **dam-hopper-api.service.in:**
   - Role: Main API server (`dam-hopper-server`).
   - Listen: `0.0.0.0:4801`.
   - Identity: Non-root user `@API_USER@:@API_GROUP@`.
   - Setup: ExecStartPre triggers `systemd-tmpfiles` and `dam-hopper-manager provision-api-runtime`.
   - Process tracking: Mixed kill mode, writes PID to `/run/dam-hopper/server.pid`.
   - Security: `UMask=0077`, loads `/etc/dam-hopper/server.env` (permissions 0600).
2. **dam-hopper-web.service.in:**
   - Role: Static frontend host (`dam-hopper-web`).
   - Listen: `0.0.0.0:4802`.
   - Identity: Dedicated locked system user `dam-hopper-web:dam-hopper-web` (`/sbin/nologin`).
   - Hardened Sandbox: `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `PrivateDevices=true`, `ProtectKernelTunables=true`, `MemoryDenyWriteExecute=true`, `LockPersonality=true`, `CapabilityBoundingSet=`, `AmbientCapabilities=`. Read-only access to release root and config.
3. **dam-hopper-idle-suspend-helper.service.in & .socket.in:**
   - Role: Privileged low-power idle-suspend helper.
   - Identity: `root:@API_GROUP@` with socket activation `/run/dam-hopper/idle-suspend.sock`.
   - Capabilities: Bound strictly to `CAP_WAKE_ALARM`.
   - Boundary Check: Validates calling process against enrolled PID (`/run/dam-hopper/server.pid`) and UID before configuring `/sys/class/rtc/rtc0/wakealarm`.
   - Audit: Appends to `/var/log/dam-hopper/idle-suspend-helper.jsonl`.
4. **dam-hopper-recovery.service.in:**
   - Role: Boot-time failure recovery oneshot (`dam-hopper-manager recover --boot`).
   - Ordering: Runs before API and web services on boot.

### 4.2 Release Packaging & Manifest Generation (`deploy/release`)
1. **Linux Tarball Packager (`build-release-archive.sh`):**
   - Output: `dam-hopper-${TAG}-linux-x86_64-systemd.tar.gz`.
   - Determinism: Normalized `SOURCE_DATE_EPOCH`, GNU tar `--sort=name --owner=0 --group=0 --numeric-owner --pax-option=...`, `gzip -n -9`.
   - Contents:
     - `bin/dam-hopper-manager` (compiled `dam-hopper` CLI)
     - `bin/dam-hopper-server`
     - `bin/dam-hopper-web`
     - `bin/dam-hopper-idle-suspend-helper`
     - `systemd` unit files
     - `sysusers.d/dam-hopper-web.conf`
     - `tmpfiles.d/dam-hopper-runtime.conf`
     - `web` static build from `apps/web/dist`
     - `LICENSE`
2. **Windows ZIP Packager (`build-windows-release-archive.mjs`):**
   - Output: `dam-hopper-${TAG}-windows-x86_64.zip`.
   - Deterministic ZIP serializer using raw Node `zlib.deflateRawSync`, zero external dependencies, deterministic MS-DOS date/time (epoch 1700000000).
   - Contents: `dam-hopper-server.exe`, `dam-hopper.example.toml`, `LICENSE`, `README.md`.
3. **Manifest & SBOM Generator (`generate-release-manifest.mjs`):**
   - Emits `release-manifest.json` conforming to `release-manifest.schema.json` (Schema v2/v3).
   - Emits SPDX 2.3 JSON SBOM (`dam-hopper-${TAG}-linux-x86_64-systemd.spdx.json`).
   - Security gate: Throws error if sensitive files (`.env`, `server.env`, `dam-hopper.toml`, `.db`, `.sqlite`) contaminate the package.
4. **Release Asset Gate (`check-release-assets.mjs`):**
   - Verifies pre-publication asset hashes, file inventories, schema compliance, and GitHub attestation consistency across Linux and Windows release profiles.
5. **Version Alignment Checker (`check-version-alignment.mjs`):**
   - Enforces strict semantic version consistency across 13 manifests and source files before release publishing.

### 4.3 Installers
- **Linux (`dam-hopper-install.sh`):**
  - Non-root bootstrap installer.
  - Fetches GitHub releases or consumes local bundle.
  - Verifies SHA-256 against `release-manifest.json` and checks `gh attestation verify`.
  - Extracts manager, delegates staging and activation to `dam-hopper-manager` with sudo. Supports `--role server|web|both`. Does not autostart services.
- **Windows (`dam-hopper-install.ps1`):**
  - Non-admin bootstrap installer.
  - Installs to `%LOCALAPPDATA%\Programs\dam-hopper`.
  - Verifies SHA-256 and GitHub attestations.
  - Extracts `dam-hopper-server.exe` and config template; preserves existing user config.
  - Optionally updates user environment `PATH`. Does not autostart services.

---

## 5. Test Scripts & Quality Harnesses (`scripts`)

| Script | Purpose | Execution Invariants |
|---|---|---|
| `scripts/run-all-tests.sh` | Master test suite orchestrator | Runs Rust server tests, shared tests, browser-bridge tests, UI unit tests, native host tests, Vitest real-DOM browser tests (port 15173), and Playwright E2E. Uses `setsid` process groups with trapped signals and 5s graceful shutdown before `SIGKILL`. Optional `RUN_NATIVE_E2E=1` for SSH forward tests. |
| `scripts/run-uat.sh` | Linux User Acceptance Testing harness | Spins up isolated server (:4803) and web host (:4804) under `/tmp/dam-hopper-uat`, validating complete runtime configuration, logs, and PID lifecycles. |
| `scripts/bench.sh` | Rust server endpoint benchmark baseline | Executes `hey` or `wrk` with 50 concurrency across `/api/health`, `/api/workspace/status`, `/api/config`, `/api/projects`, `/api/terminal`, `/api/commands/search`, `/api/agent-store`. |
| `scripts/verify-idle-suspend-boundary.sh` | 14-point security boundary verification | Verifies zero `sudo` execution in server code, zero shell invocations, systemd helper unit hardening flags, body limits (16 KiB), wake duration validation (>= 60s), and audit file permissions (`0600`, `O_NOFOLLOW`). |
| `scripts/compare-servers.sh` | Server regression comparator | Side-by-side comparison of Rust server endpoints against legacy Node server responses. |
| `scripts/qualify-phase09-workbench.mjs` | Multi-profile workbench qualification | Sets up dual isolated git repositories and PTY fixtures, validating worktree operations and streaming under concurrent load. |
| `scripts/qualify-host-resource-sse.mjs` | Host resource metrics qualification | Measures SSE streaming latency, disconnect recovery, and reader cancellation semantics. |
| `scripts/profile-host-resource-monitor.sh` | Monitor resource profiling | Profiles warmup and steady-state CPU/memory footprint of the system monitor binary under Linux. |

---

## 6. Platform Constraints & Parity Matrix

| Feature / Subsystem | Linux | Windows | Android (Mobile) |
|---|---|---|---|
| **Server Backend (`dam-hopper-server`)** | **Primary target** (Full systemd, cgroups, RTC wake alarms) | **Supported** (Standalone console binary, local app data) | Not supported |
| **Manager / Deploy CLI (`dam-hopper`)** | **Supported** (`dam-hopper-manager` with atomic rollback & staging) | Not supported (Uses PowerShell script `dam-hopper-install.ps1`) | Not supported |
| **Static Web Host (`dam-hopper-web`)** | **Supported** (Dedicated sandboxed service on port 4802) | Not deployed as service (Uses Vite dev or reverse proxy) | Not supported |
| **Native Desktop App (`apps/native`)** | **Supported** (Tauri 2 + WebKit2GTK) | **Supported** (Tauri 2 + WebView2 + NSIS installer) | Mobile app (Tauri 2 Android activity) |
| **Browser Debug Host** | **Supported** (WebKit2GTK UserContentManager IPC) | **Supported** (WebView2 Win32 COM relay + permission deny policy) | **Disabled / Unsupported** (`PlatformRelayResult::Unsupported`) |
| **Browser Debug Console Relay** | Disabled by default (isolated navigation relay active) | Disabled by default (avoids Wry invoke parser error feedback loops) | Disabled |
| **Native SSH Forwarding** | **Not implemented / Gated out** (`createNativeSshForwardHost` returns `null`) | **Fully Supported** (`russh`, Windows Credential Vault, DPAPI, atomic probes) | **Disabled** (Returns null) |
| **SSH Forward Trust Repair** | Not available | Supported via `--ssh-forward-trust-repair` CLI flag | Not available |
| **Remote Server Profile Transport** | Exact same-origin only (`isProfileSupportedOnNative`) | HTTP(S) remote transport allowed (`isProfileSupportedOnNative`) | Exact same-origin only |
| **DevTools Shortcut (`Shift+F12`)** | Active | Active | Disabled |
| **Idle Suspend Privileged Helper** | Fully supported (`CAP_WAKE_ALARM`, UNIX socket, RTC) | Not applicable | Not applicable |

---

## 7. Key Findings & Architecture Highlights

1. **Strict Dependency Build Order:** `apps/native` cannot compile its Rust crate (`dam-hopper-native`) unless `packages/browser-bridge` has already built its IIFE distribution. `build.rs` asserts this explicitly.
2. **Same-Origin Production Gate:** `apps/web/vite.config.ts` prevents accidental baked backend URLs by throwing a fatal error if `VITE_DAM_HOPPER_SERVER_URL` is set during a production build.
3. **Windows-Exclusive SSH Forwarding Seam:** Native SSH forwarding is strictly implemented for Windows desktop using Windows Credential Manager and `russh`. On Linux and mobile, the Tauri capabilities omit SSH forwarding commands, and the frontend factory returns `null`.
4. **Deterministic Multi-Platform Packaging:**
   - Linux produces POSIX PAX-compliant tarballs with fixed timestamps (`SOURCE_DATE_EPOCH`), root ownership, and SHA-256 manifest verification.
   - Windows produces raw deflate deterministic ZIPs with hardcoded DOS timestamps and member manifests.
5. **Multi-Process Linux Isolation:** Linux production deployments cleanly partition concerns into three distinct processes:
   - Root helper with `CAP_WAKE_ALARM` (`dam-hopper-idle-suspend-helper`)
   - Unprivileged application server (`dam-hopper-server`)
   - Heavily sandboxed zero-capability static web server (`dam-hopper-web`)

---

## 8. Unresolved Questions

1. **Linux Native SSH Forwarding Roadmap:** Does the roadmap plan to port `ssh_forward` to Linux (e.g. using `libsecret` / Secret Service API and OpenSSH agent sockets) to achieve feature parity with Windows native desktop?
2. **Native Browser Debug Console Transport:** Is there a planned out-of-band IPC transport for WebView2 console log mirroring that avoids Tauri invoke error reflection loops?
