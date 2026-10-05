# Documentation Audit & Architecture Scout Report

**Report ID:** `plans/reports/scout-261005-1653-docs-reader-1.md`  
**Date:** 2026-10-05  
**Auditor:** Elite Codebase Scout (Docs Reader 1)  
**Environment:** Linux x64 | dam-hopper pnpm monorepo | Asia/Saigon  
**Scope:** 9 Primary target documents + 7 recursive `docs/configuration/` documents (16 files total, ~3,400 LOC)  
**Context:** Documentation source of truth audit prior to doc restructuring. No source application code modified.

---

## 1. Executive Summary & Key Cross-Cutting Findings

### 1.1 Critical Stale Configuration Issue
- **`docs/configuration/server-environment-auth.md`** contains active references to the retired plugin architecture:
  - Line 34 includes `DAM_HOPPER_PLUGIN_ADMINS_FILE` in the active **Environment Variables** table.
  - Line 36 describes runner host-owned allowlist loading in active present tense.
  - Lines 90–137 contain the **Historical: Retired Plugin Management Administrator Allowlist** section explaining runner RPC precedence and bearer management API authentication, linking to `../architecture/plugin-platform-d05.md`.
  - **Verdict:** The plugin platform was permanently retired on 2026-10-02 (replaced by Native Advisor). `DAM_HOPPER_PLUGIN_ADMINS_FILE` and plugin management auth must be purged from active server configuration and moved to `docs/archive/` or deleted.

### 1.2 Broken Headings and Anchor Verification Ledger
The main validator checks file existence but does not validate heading anchors (`#slug`). The following broken anchors were identified during this audit:

| Source File | Referenced Link & Anchor | Target Heading / Actual Status | Failure Cause & Remediation |
|---|---|---|---|
| `docs/configuration-guide.md:11` | `[Manual Smoke Checklist](#manual-smoke-checklist)` | `docs/configuration/server-operations.md:21` (`## Manual Smoke Checklist`) | **Broken local anchor:** Heading is absent in `configuration-guide.md`. Update link to `./configuration/server-operations.md#manual-smoke-checklist`. |
| `docs/configuration-guide.md:512` | `[Linux Release Manager](./linux-release-manager.md#helper-service-lifecycle-production-cli-phase-03)` | `docs/linux-release-manager.md:315` (`## Current service lifecycle`) | **Broken heading anchor:** Target file heading renamed. Update anchor to `#current-service-lifecycle`. |
| `docs/configuration-guide.md:697` | `[System Architecture](./system-architecture.md#cognito-privacy-mode-2026-10-02)` | `docs/system-architecture.md:102` (`## Cognito Mode`) | **Broken heading anchor:** Historical date suffix `-2026-10-02` appended in error. Update anchor to `#cognito-mode`. |
| `docs/configuration/server-runtime-settings.md:83` | `[telemetry architecture notes](../system-architecture.md#codex-otel-usage-analytics)` | Missing entirely from `docs/system-architecture.md` | **Missing architecture section:** Section does not exist in `system-architecture.md`. Telemetry architecture is currently only in `server-runtime-settings.md`. |
| `docs/configuration/server-configuration.md:27` | `[Server Environment and Authentication](./server-environment-auth.md#historical-retired-plugin-management-administrator-allowlist)` | Exists in `server-environment-auth.md:111` | **Stale topic:** Valid anchor slug, but links to retired plugin configuration in active server config. Needs removal once plugin docs are archived. |

---

## 2. Per-File Detailed Audit

### 2.1 `docs/configuration-guide.md` (730 LOC)
- **Purpose:** Primary operator guide for project registry configuration (`dam-hopper.toml`), global UI configuration (`config.toml`), file access boundaries, terminal environment, host resource monitoring, opt-in Linux terminal idle-suspend, and Browser Debug preview.
- **Key Sections:**
  - Project Registry (`dam-hopper.toml`): path normalization via `dunce`, Windows path formats, validation.
  - File Access Boundaries: per-project sandbox roots (`/api/fs/*` and WS).
  - Startup Config Resolution (6-step resolution order).
  - Terminal Environment Resolution: precedence rules.
  - Host Resource Monitoring: read-only monitor, intervals, bounded process inventory.
  - Terminal Idle Suspend: policies (`empty-fleet`, `agent-activity`), `agent_executables` rules, rollout stages, manual force sleep.
  - Browser Debug Preview: extension ZIP, parent origins, framing CSP.
  - UI Configuration: shortcuts, inline terminal suggestions, per-agent notifications (`ui.terminal_agent_notifications`), Cognito mode styles.
- **Internal Links & Dependencies:**
  - `#manual-smoke-checklist` (**BROKEN ANCHOR**)
  - `./configuration/advisor.md` (Valid)
  - `./pty-activity-observation.md`, `./agent-activity-process-discovery.md`, `./tcp-activity-observation.md`, `./agent-activity-automatic-admission.md`, `./idle-suspend-status-ui.md` (All valid)
  - `./linux-release-manager.md#helper-service-lifecycle-production-cli-phase-03` (**BROKEN ANCHOR**)
  - `./system-architecture.md#cognito-privacy-mode-2026-10-02` (**BROKEN ANCHOR**)
  - `./configuration/server-configuration.md` (Valid)
- **Suspicious / Outdated Claims:**
  - `[UNVERIFIED]` Lines 228–232: Phase 07 release evidence statement claims Windows CI result, canary-host profiling, staged monitor canary, and rollback rehearsal deferred as post-release work.
  - `[UNVERIFIED]` Lines 576–578: "Linux native builds remain experimental and unverified at runtime; macOS support is deferred."
- **Unique Operational / Security Invariants to Preserve:**
  - Lexical path validation: `..` rejection in project path; `env_file` and terminal `cwd` must be strictly relative and project-contained.
  - dunce platform canonicalization & Windows UNC/verbatim path handling (`\\?\` and UNC).
  - Sandbox root reinitialization on config reload / workspace switch.
  - Terminal idle-suspend safety invariants: `0` sentinel for clear-only RTC indefinite sleep in helper protocol, but `0` strictly rejected in persisted config / timing PATCH (`60..=86400s`).
  - Strict syntax limits on `agent_executables`: 1–32 entries, 1–256 UTF-8 bytes, no metacharacters, generic interpreters (`node`, `bun`, `python`, `sh`, `bash`) rejected.
  - Cognito mode ephemeral nature: activation state is memory-only; reloads start inactive; mask is visual only, not content redaction.
- **Recommended Disposition:** **KEEP & UPDATE**. Fix the 3 broken anchors. Delegate deeper server settings to `docs/configuration/server-*.md` to prevent line bloat (currently 730 LOC; docs target is max 800 LOC).

---

### 2.2 `docs/CHANGELOG.md` (200 LOC)
- **Purpose:** Chronological release and milestone history recording delivered features, bug fixes, phase closures, and qualification stats from 2026-09-20 through 2026-10-05.
- **Key Sections:**
  - `2026-10-05`: Git inactive local branch commit-message edit, squash, UI accessibility qualification (349 tests); Frontend testing restructure Phase 05 (Playwright runner separation, isolated Mongo 8.2 container, 4-tier boundaries, visual review governance).
  - `2026-10-04`: Host-resource SSE recovery after BFCache; Advisor routing editor & harness model selector (Phase 05); Docs refresh.
  - `2026-10-03`: Cognito Mode Heavy Blur visual restoration (`blur(20px)` / `rgba(13, 17, 23, 0.52)` historically noted); Git squash commits in both surfaces.
  - `2026-10-02`: Native Advisor migration (Phases 01–09); Git history search & selection persistence (Phase 07); Cognito Mode Phase 05 completion.
  - `2026-10-01` & earlier: Host-resource SSE delivery; Git commit search; Plugin platform D00–D06 (historical).
- **Internal Links & Dependencies:**
  - Links to historical plans (`../plans/...`), reports (`../plans/reports/...`), and docs (`docs/testing.md`, `docs/project-roadmap.md`, `docs/architecture/agent-status.md`, `docs/configuration-guide.md`, `docs/system-architecture.md`, `docs/plugin-platform-d00.md`, `docs/phase-03-files-editor-search-git.md`).
- **Suspicious / Outdated Claims:**
  - None. Per system policy, historical claims in CHANGELOG are immutable historical records. (e.g., historical styling notes or retired plugin development phases are accurate historical reflections of what was done at that date).
- **Unique Operational / Security Guidance:**
  - Preserves exact verification metrics, test counts, commit hashes, and historical design cutovers.
- **Recommended Disposition:** **KEEP AS IS**. Do not rewrite history. Continue prepending new milestone entries.

---

### 2.3 `docs/linux-release-manifest.md` (337 LOC)
- **Purpose:** Formal specification for Linux Release Manifest v2 and Manager State v3, governing release packaging, artifact digests, target profiles, systemd service units, and verification gates.
- **Key Sections:**
  - Status & Authority: Rust validator (`server/src/linux_release/`) is runtime authority; JSON Schema (`deploy/release/release-manifest.schema.json`) must remain structurally equivalent.
  - Publisher & Bootstrap Boundary: 4 emitted assets (`dam-hopper-install.sh`, profile archive, `release-manifest.json`, SPDX 2.3 SBOM).
  - Manifest Scope & Windows Asset Boundary: Manifest v2 is strictly Linux `x86_64-unknown-linux-gnu` systemd; Windows release is separate.
  - Inventory Schema: Max 20,000 entries; relative forward-slash paths; role projections (`common`, `server`, `web`, `both`); required paths.
  - Service & Rollback Contracts: API unit (`dam-hopper-api.service`, port 4801), Web unit (`dam-hopper-web.service`, port 4802).
  - Manager Consumption: `fetch`, `install`, `start`, `rollback`, `recover`.
  - Format-2 Compatibility Boundary: One-time migration from legacy layout.
- **Internal Links & Dependencies:**
  - `./linux-release-publisher-bootstrap.md` (Valid)
  - `./linux-release-manager.md` (Valid)
  - `./linux-systemd.md` (Valid)
- **Suspicious / Outdated Claims:**
  - Lines 254–257: Mentions that checked-in JSON Schema "still contains legacy Fedora profile/archive alternatives and is not a standalone approval gate for the Linux-only v2 cutover." `[UNVERIFIED]` status of schema cleanup.
- **Unique Operational / Security Invariants to Preserve:**
  - API identity authority: Finalized API unit's `User=`/`Group=` is sole runtime identity authority; Manifest v2 has NO API identity field; root is rejected.
  - Inventory prohibitions: Forbidden runtime files in archive (`.env`, `dam-hopper.toml`, `server-token`, `*.sqlite`, `*.db`).
  - Size and payload limits: Manifest v2 ≤ 1 MiB, SBOM ≤ 16 MiB, archive ≤ 500 MiB, uncompressed inspection ≤ 512 MiB.
  - Plugin retirement reflection: Runner unit, bundled Node, and runner tmpfiles are explicitly retired.
- **Recommended Disposition:** **KEEP & UPDATE**. Retain as primary release contract reference. Update notes regarding JSON schema synchronization if Fedora alternatives were cleaned up.

---

### 2.4 `docs/phase-08-native-scope-concurrency.md` (260 LOC)
- **Purpose:** Technical specification for concurrent multi-profile native SSH forwarding on Windows desktop (Tauri) and integration of the child-WebView Browser Debug target owner lease.
- **Key Sections:**
  - Purpose & Platform Boundary: Windows desktop capability; browser and mobile receive no SSH host.
  - Lifecycle Contract: `NativeScopeRef`, `ScopeHandle`, `openClient`, `openScope`, `closeScope`, `reconcileKnownScopes`, `purgeScope`.
  - Runtime & Teardown Isolation: Scope-keyed connection registries `(scopeId, connectionProfileId)`, scope-local cleanup ordering.
  - Desktop IPC Surface: 21 registered Tauri commands on `main` webview label with `ssh-forward-main` capability.
  - Persistence & Trust: Windows store under `app_config_dir/ssh-forward/`, endpoint-first trust challenges, DPAPI/Credential Manager integration.
  - React Host Lifecycle: `native-ssh-forward-host.ts`, `SshForwardScopeBridge`, `useSshForward`.
  - Native Browser Debug Owner Boundary: `BrowserDebugTarget` lease consumption; independent from SSH scope selection.
  - Platform & Release Gate: Support matrix (Windows v1 vs Linux unverified vs macOS deferred).
- **Internal Links & Dependencies:**
  - `./phase-05-agents-ports-and-browser.md` (Valid)
  - `../plans/reports/project-manager-260917-2043-phase-08-status-update.md` (Valid)
  - `../plans/reports/code-review-260917-2014-phase-08-native-scope-concurrency.md` (Valid)
- **Suspicious / Outdated Claims:**
  - `[UNVERIFIED]` Lines 3–5 & 230–232: "Windows S13 runtime and packaged qualification remain release gates; Linux evidence is not Windows proof." Needs confirmation if Windows S13 qualification has been completed.
- **Unique Operational / Security Invariants to Preserve:**
  - 6-component `NativeScopeRef` binding: `desktopInstanceId`, `managerSessionId`, `clientEpoch`, `scopeId`, `scopeGeneration`, `activationToken`.
  - Zero-drift client epoch reset: `openClient` tears down all scopes, runtimes, workers, credentials before rehydrating.
  - Port collision prevention: Exclusive loopback ports across scopes; port collision reported rather than exposing ambiguous listeners.
  - Strict memory zeroization: Passwords and keys cleared on scope close, epoch reset, and app shutdown.
  - Tauri command isolation: Exclusively granted to `main` webview label on Windows; secondary child WebViews and browser hosts receive 0 SSH commands.
- **Recommended Disposition:** **MOVE / RENAME to Purpose-Based Path**: Propose `docs/architecture/native-ssh-forwarding.md` (or `docs/architecture/native-scope-concurrency.md`). Preserve all 21-command IPC definitions, cryptographic lifecycle rules, and security boundaries.

---

### 2.5 `docs/tcp-activity-observation.md` (240 LOC)
- **Purpose:** Detailed kernel-level and architectural specification for unprivileged Linux TCP byte observation via `NETLINK_SOCK_DIAG` and `tcp_info`, used by the `agent-activity` idle-suspend policy.
- **Key Sections:**
  - Source Map: `tcp_info.rs`, `netlink.rs`, `tcp.rs`, `activity/mod.rs`.
  - Observation Flow: Namespace verification -> Netlink socket open -> TCP IPv4/v6 dump -> UDP/Unix dump if needed -> INET_DIAG_INFO parse -> namespace reverification -> baseline compare.
  - `tcp_info` Prefix Contract: Byte ranges `128..136` (`tcpi_bytes_received`) and `200..208` (`tcpi_bytes_sent`); 208-byte minimum prefix; native-endian decoding.
  - Netlink Transport & Wire Contract: `AF_NETLINK`/`SOCK_RAW`, unprivileged, monotonic poll deadlines, 16 MiB datagram response budget.
  - Linux Source & Namespace Contract: `NetworkNamespaceIdentity::current_thread()`, `/proc/thread-self/ns/net` device/inode check before and after dump.
  - Observer & Baseline Contract: `SocketKey` (namespace, family, cookie; excludes reusable inode), transactional `prepare_sample` / `commit_sample`.
  - Failure, Privacy & Limits: Bounded diagnostics; zero raw payload or command exposure.
- **Internal Links & Dependencies:**
  - `./agent-activity-automatic-admission.md` (Valid)
  - `./agent-activity-process-discovery.md` (Valid)
  - `./pty-activity-observation.md` (Valid)
  - `./terminal-idle-suspend-security.md` (Valid)
  - `./system-architecture.md` (Valid)
- **Suspicious / Outdated Claims:**
  - None. Content reflects current implemented crate-private Linux activity subsystem.
- **Unique Operational / Security Invariants to Preserve:**
  - Libc-independent byte offset decoding: Slices `128..136` and `200..208` via `try_into` and `u64::from_ne_bytes`; avoids structure size mismatches across kernels.
  - Double namespace verification: Prevents thread migration / namespace race exploitation.
  - Datagram pre-allocation bounding: `MSG_PEEK | MSG_TRUNC` full length check against remaining global 16 MiB budget prior to allocation.
  - Two-word cookie identity in `SocketKey` (ignores volatile reusable inode).
  - Polling heuristic caveat: Does not guarantee an agent has permanently completed.
- **Recommended Disposition:** **KEEP & CONSOLIDATE / MOVE**: Propose moving to `docs/architecture/idle-suspend/tcp-activity-observation.md` or keeping at `docs/architecture/tcp-activity-observation.md`. Preserve exact kernel offsets and wire formats.

---

### 2.6 `docs/phase-05-agents-ports-and-browser.md` (191 LOC)
- **Purpose:** Architecture and implementation guide for client-side multi-profile ownership boundaries, port/tunnel aggregation, Browser Debug trust, and same-profile terminal handoff.
- **Key Sections:**
  - 1. Agent Store Ownership: Effective `profileId`, `ConnectionRef { profileId, generation }`, draft identity `{ profileId, projectName, agent }`, import scan scoping.
  - 2. Port & Tunnel Aggregation: Semantic port identity `(profileId, port, terminalId, incarnation)`.
  - 3. Browser Target Trust: `BrowserDebugTarget` snapshot structure, loopback and exact-origin tunnel trust, revision tracking.
  - 4. Same-Profile Terminal Handoff: 8-step handoff sequence; atomic `PtySessionManager::write_if_incarnation` manager lock.
  - 5. Owner-Local Feature Availability: `useFeatureAvailability` state machine (`unknown`, `loading`, `available`, `unavailable`).
  - 6. Source Map & Maintenance Rules.
- **Internal Links & Dependencies:**
  - `../plans/reports/qa-260917-1517-phase-05-agents-ports-browser-validation.md` (Valid)
  - `../plans/reports/code-review-260917-1522-phase-05-cycle2.md` (Valid)
  - `./phase-08-native-scope-concurrency.md` (Valid)
- **Suspicious / Outdated Claims:**
  - `[UNVERIFIED]` Lines 10–11: "Windows-native S13 remains blocked; this guide does not make a native runtime claim."
- **Unique Operational / Security Invariants to Preserve:**
  - 4-tuple port identity prevents collision between identical ports on different profiles/servers.
  - Strict owner capture across async boundaries: Must preserve `profileId` and connection generation across every `await`.
  - Atomic PTY incarnation write: `write_if_incarnation` holds manager lock across liveness, incarnation compare, input revision admission, and write to eliminate replacement-PTY races.
  - Ephemeral artifact boundaries: 10-minute expiry, max 64 KiB JSON / 4 MiB PNG, local filesystem paths only.
- **Recommended Disposition:** **MOVE / RENAME to Purpose-Based Path**: Propose `docs/architecture/multi-profile-workbench.md` (or `docs/architecture/workbench-ownership-handoff.md`).

---

### 2.7 `docs/native-browser-debug-support.md` (130 LOC)
- **Purpose:** Platform support matrix, security boundary, and qualification runbook for the Tauri child-WebView Browser Debug feature on Windows, Linux, and macOS.
- **Key Sections:**
  - Architecture: Least-privileged Tauri child WebView; document-start bridge; 0 generic Tauri/shell/FS commands.
  - Support Matrix: Windows v1 (WebView2 verified) vs Linux (WebKitGTK implemented, runtime unverified) vs macOS (deferred).
  - Phase 08 Owner Integration: `BrowserDebugTarget` lease binding; independent from SSH scopes; console relay disabled.
  - Cognito Privacy Mode Viewport Behavior: Hidden viewport (`isViewportVisible={false}`, null native viewport) while mask is active.
  - Windows Gate Runbook: `smoke-browser-debug.mjs`, required evidence JSON structure.
  - Rollback: `VITE_DAM_HOPPER_NATIVE_BROWSER_DEBUG=0` build flag.
  - Release Security Checklist: Denied popups, downloads, client certificates, password managers via WebView2 hooks.
- **Internal Links & Dependencies:**
  - No direct outbound markdown links. Mentions Phase 05 and Phase 08 concepts.
- **Suspicious / Outdated Claims:**
  - `[UNVERIFIED]` Lines 9–12: "The Windows native S13 gate remains blocked until a real packaged runtime records WebView2, DPAPI, SSH-scope, and Browser relay evidence..."
  - `[UNVERIFIED]` Line 107: Linux WebKitGTK runtime behavior remains unverified on the distribution matrix.
- **Unique Operational / Security Invariants to Preserve:**
  - Zero-privilege child webview: Remote child target must NOT inherit Tauri application commands or filesystem access.
  - Explicit WebView2 deny hooks for popups, downloads, permissions, client certificates, and password managers.
  - Build-time rollback flag `VITE_DAM_HOPPER_NATIVE_BROWSER_DEBUG=0` falls back cleanly to iframe adapter.
  - Cognito mode viewport hiding: Native child surface cannot be blurred by CSS `backdrop-filter`, so native child must be physically unmapped/hidden.
- **Recommended Disposition:** **KEEP & UPDATE / MOVE**: Propose `docs/architecture/native-browser-debug.md` or keep as `docs/native-browser-debug-support.md`.

---

### 2.8 `docs/code-standards.md` (102 LOC)
- **Purpose:** Active engineering standards and invariant rules across Rust backend, shared React UI, transport, security, and testing.
- **Key Sections:**
  - Repository Structure Map.
  - Cross-Cutting Rules: Ownership & async work (`{ profileId, generation }`), Rust backend error/lock/transaction invariants, React/TypeScript boundaries.
  - Domain-Specific Invariants: Git history changes (CAS ref updates, contiguous squash, leased push), Native Advisor (default-off, admin-only, atomic CAS routing), Agent Status (incarnation correlation, private ingress), Cognito Mode (`blur(16px) saturate(180%)`).
  - Git, Auth & Transport Security: Server actor derivation, exact CORS, session-bound capabilities.
  - Testing & Delivery: 4-Tier Runner Boundaries (Tier 1 Rust, Tier 2 Vitest jsdom, Tier 3 Vitest Browser Mode, Tier 4 Playwright E2E), deterministic auth seeding (`application_e2e_seed`), visual evidence capture policy (`capture-policy.ts`).
  - Retired Plugin Documentation: Explicit statement that D00–D05 plugin platform is retired.
- **Internal Links & Dependencies:**
  - `./project-roadmap.md` (Valid)
  - `./architecture/native-advisor.md` (Valid)
  - `./configuration/advisor.md` (Valid)
  - `./architecture/agent-status.md` (Valid)
  - `./testing.md` (Valid)
- **Suspicious / Outdated Claims:**
  - None. Perfectly synchronized with 2026-10-05 frontend testing restructure and Native Advisor cutover.
- **Unique Operational / Security Invariants to Preserve:**
  - All rules are normative standards for the entire repository.
- **Recommended Disposition:** **KEEP AS IS**. High quality, concise (102 lines < 800 LOC limit).

---

### 2.9 `docs/codebase-summary.md` (70 LOC)
- **Purpose:** Top-level repository inventory, subsystem LOC counts, key architectural decisions, and current commit references, generated via Repomix compaction.
- **Key Sections:**
  - Repository at a Glance: ~1,349 files, ~416k LOC.
  - Backend Map: Major subsystem line counts (`api/`, `linux_release/`, `idle_suspend/`, `pty/`, `git/`, `agent_status/`, `advisor/`, etc.).
  - Shared UI Map: Component, hook, API, and store breakdowns.
  - Current Architecture & Invariants: Commit-specific highlights (Git inactive local branch edit/squash `6f756b1b`, Cloudflared tunnel isolation `b1f0419c`, Settings accordion collapsed `aa35a91e`, Native Advisor, Agent Status, Cognito Mode, Idle Suspend, Encrypted Uploads).
  - Test & Deployment Boundaries: Summary of 4-tier testing architecture and deploy paths.
- **Internal Links & Dependencies:**
  - `./architecture/native-advisor.md` (Valid)
  - `./architecture/agent-status.md` (Valid)
  - `./terminal-idle-suspend-security.md` (Valid)
  - `./testing.md` (Valid)
  - `./README.md#operations-and-release` (Valid)
  - `./deployment-guide.md` (Valid)
- **Suspicious / Outdated Claims:**
  - None. Current as of 2026-10-05 (Version 0.10.2).
- **Unique Operational / Security Invariants to Preserve:**
  - High-level directory responsibility and architecture summary.
- **Recommended Disposition:** **KEEP & MAINTAIN**. Keep as quick entry point for agents and contributors.

---

### 2.10 `docs/configuration/index.md` (19 LOC)
- **Purpose:** Navigation index routing operators to modular configuration documents.
- **Key Sections:** Contents links to registry guide, server configuration index, runtime settings, environment/auth, deployment/transport, operations/troubleshooting, and Native Advisor.
- **Internal Links & Dependencies:** All 7 outbound links are valid.
- **Suspicious / Outdated Claims:** None.
- **Recommended Disposition:** **KEEP**. Concise router.

---

### 2.11 `docs/configuration/server-configuration.md` (28 LOC)
- **Purpose:** Subtopic index for server-owned settings and operator runbooks, preserving legacy section anchor redirects.
- **Key Sections:** Contents; Legacy section links (`Environment Variables`, `Windows Server Loopback Smoke Checklist`, `Plugin Management Administrator Allowlist`).
- **Internal Links & Dependencies:**
  - `./server-runtime-settings.md` (Valid)
  - `./server-environment-auth.md` (Valid)
  - `./server-deployment.md` (Valid)
  - `./server-operations.md` (Valid)
  - `./advisor.md` (Valid)
  - `./server-environment-auth.md#environment-variables` (Valid)
  - `./server-operations.md#windows-server-loopback-smoke-checklist` (Valid)
  - `./server-environment-auth.md#historical-retired-plugin-management-administrator-allowlist` (Valid anchor slug, but refers to retired plugin configuration)
- **Suspicious / Outdated Claims:**
  - Mentions retired Plugin Management Administrator Allowlist in active index.
- **Recommended Disposition:** **UPDATE**. Remove the legacy plugin allowlist anchor redirect once `server-environment-auth.md` is purged of plugin configuration.

---

### 2.12 `docs/configuration/server-environment-auth.md` (137 LOC)
- **Purpose:** Documentation for server environment variables, JWT signing secret, session tokens, MFA key provisioning, lost-authenticator recovery runbook, and (erroneously retained) retired plugin allowlist.
- **Key Sections:**
  - Global Configuration (`~/.config/dam-hopper/config.toml`).
  - Environment Variables Table: Ports, hosts, CORS, Web root, Mongo, MFA key file, and stale `DAM_HOPPER_PLUGIN_ADMINS_FILE`.
  - JWT Signing Secret & Session Tokens: `~/.config/dam-hopper/server-token` (UUIDv4 signing secret, mode `0600`), `--new-token` rotation.
  - MFA Encryption Key File Provisioning: `DAM_HOPPER_MFA_KEY_FILE` (32 raw bytes / AES-256-GCM / mode `0600`).
  - Operator Recovery Runbook: Privileged `mongosh` script to increment `authVersion` and clear MFA state for a lost TOTP device.
  - Historical: Retired Plugin Management Administrator Allowlist (STALE).
- **Internal Links & Dependencies:**
  - `./server-configuration.md` (Valid)
  - `../phase-01-auth-state-cryptography-and-policy.md` (Valid)
  - `../authentication-api.md` (Valid)
  - `../architecture/plugin-platform-d05.md` (Target exists, but is a RETIRED doc)
- **Suspicious / Outdated Claims:**
  - `[STALE / DELETED FEATURE]` Line 34: `DAM_HOPPER_PLUGIN_ADMINS_FILE` listed as an active environment variable.
  - `[STALE / DELETED FEATURE]` Line 36: Describes runner reading host-owned allowlist file before opening management RPC surface.
  - `[STALE / DELETED FEATURE]` Lines 90–94: Describes management API bearer authentication vs cookie access.
- **Unique Operational / Security Invariants to Preserve:**
  - `server-token` is strictly a JWT signing secret, NEVER a client bearer token (`chmod 600`).
  - `DAM_HOPPER_MFA_KEY_FILE` strict Unix permissions (`0600`), AES-256-GCM TOTP secret encryption at rest, backup requirement.
  - Operator TOTP recovery runbook: Exact immutable `_id` + `authVersion` filter, `matchedCount === 1` / `modifiedCount === 1` precondition, 5-second polling session invalidation fence.
- **Recommended Disposition:** **UPDATE IMMEDIATELY**:
  1. Remove `DAM_HOPPER_PLUGIN_ADMINS_FILE` from Environment Variables table.
  2. Remove line 36 plugin runner description.
  3. Excise or relocate Section 5 ("Historical: Retired Plugin Management Administrator Allowlist") to an archive document.

---

### 2.13 `docs/configuration/server-operations.md` (210 LOC)
- **Purpose:** Operational runbooks for on-demand SSH key loading, manual smoke checklists (Linux/Windows), Windows direct-server setup, configuration troubleshooting, multi-project workspace example, and OMP agent-status integration.
- **Key Sections:**
  - SSH Key Management: On-demand `/api/ssh/keys/load`, in-memory session storage.
  - Manual Smoke Checklist: 7-step cross-project isolation and Windows path/UNC checks.
  - Windows Direct-Server Installation: PowerShell bootstrap (`dam-hopper-install.ps1`), directory layout, upgrade preservation, attestation via `gh attestation verify`.
  - Windows Server Loopback Smoke Checklist: Isolated temporary config, loopback startup on 4801, `/api/health` polling.
  - Troubleshooting Configuration: Registry not found, project not discovered, session token issues.
  - Multi-Project Workspace TOML Example.
  - OMP Agent Status Integration: CLI install/status/uninstall commands for embedded OMP extension.
- **Internal Links & Dependencies:**
  - `./server-configuration.md` (Valid)
  - `../authentication-api.md` (Valid)
  - `../architecture/agent-status.md` (Valid)
- **Suspicious / Outdated Claims:** None.
- **Unique Operational / Security Invariants to Preserve:**
  - SSH keys stored strictly in-memory per session; never written to disk.
  - Windows direct-server directory structure and non-admin PATH setup.
  - Attestation verification commands for Windows assets.
  - Exact OMP adapter CLI flags (`--agent-dir`, `--json`).
- **Recommended Disposition:** **KEEP & MAINTAIN**. Contains vital operational checklists.

---

### 2.14 `docs/configuration/server-deployment.md` (152 LOC)
- **Purpose:** Deployment reference covering server modes (dev, release, dedicated `dam-hopper-web`), Docker combined mode, Linux systemd release manager, browser origin/CORS rules, media compatibility contract, and Host Resources SSE reverse-proxy operations.
- **Key Sections:**
  - Running the Server: Cargo development, release build, dedicated web host (`dam-hopper-web` on port 4802).
  - API-only and Docker Combined Mode: Explicit `--web-dir /opt/dam-hopper/web` for Docker; systemd defaults to API-only on 4801.
  - Linux Systemd Release Manager: Bootstrap installer vs manager CLI (`fetch`, `install`, `start`).
  - Browser Origin & Transport: Strict credentialed CORS origin configuration (`DAM_HOPPER_CORS_ORIGINS`); rejection of wildcards.
  - Media Compatibility & Phase 09 Qualification: UUIDv4 `mediaClientId`, `session-cookie-v2`, cross-server ticket isolation.
  - Host Resources SSE & Reverse Proxy: Nginx configuration (`proxy_buffering off`, `proxy_read_timeout 60s`), admission limits (32 global, 4 per subject), rollout/rollback steps.
- **Internal Links & Dependencies:**
  - `./server-configuration.md` (Valid)
  - `../linux-systemd.md` (Valid)
  - `../../plans/260929-1522-host-resources-sse/validation-matrix.md` (Valid workspace-root path)
- **Suspicious / Outdated Claims:**
  - `[UNVERIFIED]` Lines 105–107: "G2-Web is qualified; G2-Native remains blocked until real Windows S13 runtime, SSH, WebView2/DPAPI, and Browser relay evidence is recorded."
  - `[UNVERIFIED]` Line 140: Mentions active backpressured HTTP/WS shutdown (C19) remaining unproven by the focused suite.
- **Unique Operational / Security Invariants to Preserve:**
  - Strict CORS rules: No `*` with credentials; exact `http://` or `https://` origin matching.
  - Nginx SSE configuration parameters (`X-Accel-Buffering: no`, compression disabled).
  - Host resource SSE stream bounds: 32 global / 4 per subject max bodies; 5s auth supervision.
  - Graceful shutdown bounds: SSE admission revoked immediately; ≤2s feature cleanup; 10s hard connection cancellation.
- **Recommended Disposition:** **KEEP & MAINTAIN**. Essential production operations and proxy guide.

---

### 2.15 `docs/configuration/server-runtime-settings.md` (199 LOC)
- **Purpose:** Configuration and operator reference for terminal session persistence (SQLite), telemetry (opt-in Codex OTLP collector), and system diagnostics collection.
- **Key Sections:**
  - Runtime & Service Settings: `session_db_path`, `session_buffer_ttl_hours` (default 24h), scrollback retention (1 MB per session).
  - Deferred Host-Action Scaffolding: Explicit notice that host-action configuration is deferred/inactive.
  - Telemetry Configuration: `[server.telemetry]`, loopback OTLP receiver (`127.0.0.1:4811`), HMAC session identity, managed `~/.codex/config.toml` exporter.
  - Diagnostics Storage: Fixed internal idle-suspend JSONL path; production CLI `dam-hopper diagnose --json` bounds (60m window, 10k records, 16 MiB scan, 8 MiB bundle); owner permissions (`0700` dir, `0600` bundle).
- **Internal Links & Dependencies:**
  - `./server-configuration.md` (Valid)
  - `../system-architecture.md#codex-otel-usage-analytics` (**BROKEN ANCHOR / MISSING SECTION**)
  - `../linux-release-manager.md#production-diagnostics-phase-06` (Valid)
- **Suspicious / Outdated Claims:**
  - `[BROKEN REFERENCE]` Line 83 links to non-existent section in `system-architecture.md`.
- **Unique Operational / Security Invariants to Preserve:**
  - SQLite database permissions: Must be `0600` user-only; non-world-readable directory.
  - Telemetry privacy guarantee: No command text, prompts, responses, or tool outputs stored; derived HMAC session identifiers only.
  - Managed Codex exporter: Atomic write to `~/.codex/config.toml` with `0600` token; refuses to overwrite foreign or modified config (`codexExporter: "conflict"`).
  - Diagnostics bounds: Maximum 8 MiB serialized bundle; non-root execution never escalates.
- **Recommended Disposition:** **KEEP & UPDATE**. Fix broken link at line 83 (either add a telemetry section to `system-architecture.md` or link directly to the telemetry configuration within this document).

---

### 2.16 `docs/configuration/advisor.md` (134 LOC)
- **Purpose:** Configuration and operator reference for the native Advisor feature (`[server.advisor]`), account routing policy CAS updates, model catalog discovery, and history directory permissions.
- **Key Sections:**
  - Native Advisor Configuration: `enabled = false` default; `GET /api/advisor/status` and `PATCH /api/advisor/settings`.
  - Account Policy Route Update: `POST /api/advisor/policy/current` and `PATCH /api/advisor/policy`; SHA-256 CAS `expectedRevision`; 16 KiB limit; atomic `0600` file replacement with `O_NOFOLLOW`.
  - Model Catalog Discovery: `POST /api/advisor/models`; backends (`codex`, `claude`, `omp`, `pi`); built-in fallback catalogs and issue codes.
  - Frontend Routing Availability & Transport: REST mapping; independent from history directory.
  - Inline Routing Editor (Phase 04): Validation rules (`policy-routing-validation.ts`), catalog query debouncing/cancellation.
  - History Source & Status: Reads `$HOME/.evcrate/advisor-history`; requires real directory; rejects symlinks.
  - Access Control: Requires authenticated session with administrator role; `--no-auth` denied.
- **Internal Links & Dependencies:**
  - `../architecture/native-advisor.md#harness-model-discovery` (Valid)
  - `../architecture/native-advisor.md#frontend-transport-and-provider` (Valid)
  - `../architecture/native-advisor.md#inline-routing-editor-phase-04` (Valid)
  - `#model-catalog-discovery` (Valid)
  - `../architecture/native-advisor.md#native-advisor-rest-api` (Valid)
- **Suspicious / Outdated Claims:** None.
- **Unique Operational / Security Invariants to Preserve:**
  - Admin-only authorization; strictly blocked in `--no-auth` mode.
  - Atomic CAS replacement: `PATCH /api/advisor/policy` requires exact SHA-256 hash match of existing bytes, temporary file `0600` with `O_NOFOLLOW`, atomic rename, and directory sync.
  - Symlink rejection on history root: `$HOME/.evcrate/advisor-history` inspected with `symlink_metadata`; symlink root fails closed.
  - Credential rejection: Automatic recursive rejection of credential-like keys in routing policy.
- **Recommended Disposition:** **KEEP AS IS**. Exemplary configuration reference with accurate cross-links and anchors.

---

## 3. Proposal for Purpose-Based Replacement of `phase-*.md` Files

The repository currently maintains several top-level documents named after historical development sprints (`docs/phase-*.md`). While their contents remain technically accurate, their milestone-based file names hinder discoverability and long-term maintainability.

### 3.1 Assigned Phase Documents

| Current File | Proposed Purpose-Based Path | Scope & Preservation Focus |
|---|---|---|
| `docs/phase-05-agents-ports-and-browser.md` | `docs/architecture/multi-profile-workbench.md` | Multi-profile frontend ownership model, tuple-keyed port/tunnel aggregation, `BrowserDebugTarget` trust, and atomic `write_if_incarnation` PTY terminal handoff. |
| `docs/phase-08-native-scope-concurrency.md` | `docs/architecture/native-ssh-forwarding.md` | Concurrent multi-profile native SSH forwarding architecture, 21 Tauri IPC commands, Windows credential vault isolation, and Browser Debug child-webview lease. |

### 3.2 Sibling Phase Documents (Comprehensive Alignment)

| Sibling File | Proposed Purpose-Based Path | Scope |
|---|---|---|
| `docs/phase-01-auth-state-cryptography-and-policy.md` | `docs/architecture/auth-cryptography-policy.md` | Session cryptography, MFA encryption key, TOTP state, and auth policies. |
| `docs/phase-03-files-editor-search-git.md` | `docs/architecture/files-editor-git.md` | Project-contained filesystem sandbox, Monaco editor, search, and Git operations. |
| `docs/phase-04-terminal-continuity-workflow-navigation.md` | `docs/architecture/terminal-continuity-workflow.md` | Terminal session persistence, PTY lifecycle, and workflow navigation. |
| `docs/phase-06-preferences-settings-usage-and-host.md` | `docs/architecture/preferences-settings-host.md` | Global preferences, settings UI, telemetry usage, and host resource monitoring. |
| `docs/phase-07-media-isolation-and-encryption.md` | `docs/architecture/media-isolation-encryption.md` | Media token issuance, `session-cookie-v2`, and WebSocket encrypted uploads. |

---

## 4. Disposition Strategy for Retired Plugin Documentation

On 2026-10-02, the Dam-Hopper plugin platform, SDK, runner daemon, and plugin management APIs were formally retired and replaced with Native Advisor. Several legacy documents and active configuration passages still remain:

### 4.1 Legacy Plugin Documents
- **`docs/plugin-platform-d00.md`** (Candidate contract)
- **`docs/architecture/plugin-platform-d01.md`** (Package registry & trust staging)
- **`docs/architecture/plugin-platform-d02.md`** (Owner runner & worker supervision)
- **`docs/architecture/plugin-platform-d03.md`** (Authorized plugin API)
- **`docs/architecture/plugin-platform-d05.md`** (Management API & transactional lifecycle)

**Recommended Action:**  
Move all 5 documents into an archive directory: `docs/archive/retired-plugin-platform/`.  
*Rationale:* Keeps `docs/architecture/` representing strictly active system architecture, while preserving historical design and contract evidence for compliance or migration auditing.

### 4.2 Immediate Cleanups in Active Docs
1. **`docs/configuration/server-environment-auth.md`:**
   - Remove row `DAM_HOPPER_PLUGIN_ADMINS_FILE` from the active **Environment Variables** table (line 34).
   - Remove description of plugin runner allowlist loading (line 36).
   - Excise Section 5 ("Historical: Retired Plugin Management Administrator Allowlist", lines 90–137) or move it to `docs/archive/retired-plugin-platform/admin-allowlist.md`.
2. **`docs/configuration/server-configuration.md`:**
   - Remove the legacy redirect section `### Plugin Management Administrator Allowlist` (lines 25–28).
3. **`docs/ws-protocol-guide.md` & `docs/api/advisor-and-workflow.md`:**
   - Retain one-line historical retirement notices, updating links to the archived path.

---

## 5. Duplicate and Stale Ownership Across Child Directories

| Topic / Concern | Primary Authoritative Doc | Secondary / Child Doc | Observation & Recommended Action |
|---|---|---|---|
| **Server Settings Navigation** | `docs/configuration-guide.md` | `docs/configuration/server-configuration.md` | Overlapping scope. `configuration-guide.md` should focus on project registry (`dam-hopper.toml`) and UI preferences (`config.toml`), deferring all daemon/server-owned settings directly to `docs/configuration/server-*.md`. |
| **Native Advisor Config** | `docs/configuration/advisor.md` | `docs/architecture/native-advisor.md` | Clean separation. `advisor.md` owns operator settings, endpoints, and fallbacks; `native-advisor.md` owns internal domain architecture and migration records. Maintain this boundary. |
| **Idle Suspend Specifications** | `docs/tcp-activity-observation.md` | `docs/pty-activity-observation.md`, `agent-activity-process-discovery.md` | Subsystem documentation is currently split across root `docs/`. Recommend grouping under `docs/architecture/idle-suspend/` during restructure. |
| **Manual Smoke Checklists** | `docs/configuration/server-operations.md` | `docs/configuration-guide.md` | `configuration-guide.md` links to local `#manual-smoke-checklist` which is broken because the actual checklist lives in `server-operations.md`. Fix link to establish `server-operations.md` as sole checklist authority. |

---

## 6. Unresolved Questions

1. **Windows S13 Runtime Qualification:** Documents `phase-08-native-scope-concurrency.md`, `phase-05-agents-ports-and-browser.md`, `native-browser-debug-support.md`, and `server-deployment.md` all note that Windows native S13 packaged runtime qualification (WebView2, DPAPI, SSH-forwarding) remains blocked or unobserved. Has this testing occurred, or should docs continue to label native desktop support as an experimental/unqualified gate?
2. **Telemetry Architecture Document:** `docs/configuration/server-runtime-settings.md` references `docs/system-architecture.md#codex-otel-usage-analytics`, but neither the heading nor any telemetry section exists in `system-architecture.md`. Should a telemetry architecture section be added to `system-architecture.md`, or should a dedicated `docs/architecture/telemetry.md` document be established?
3. **Archive Directory Structure:** For retired documentation (plugin platform D00–D05), does the project prefer moving them to `docs/archive/` or deleting them completely from `docs/` given that historical Git history retains their contents?
