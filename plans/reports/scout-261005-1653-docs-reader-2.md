# Scout Documentation Audit Report: Reader 2 (Release, Operations, Testing, API, and Architecture)

**Date:** 2026-10-05  
**Auditor:** Codebase Scout (Reader 2)  
**Deliverable:** `plans/reports/scout-261005-1653-docs-reader-2.md`  
**Environment:** Linux x86_64, Fedora 44 / glibc >= 2.39, pnpm monorepo  
**Assigned Scope:**
- 9 Core Root Docs (Group LOC: 2,415)
- 11 Nested API Reference Docs under `docs/api/` (Group LOC: 3,130)
- 4 Historical Plugin Architecture Docs under `docs/architecture/` (Group LOC: 1,123)
- Critical Stale Audit Inspection: `docs/configuration/server-environment-auth.md` (LOC: 146)
- **Total Audited Scope:** 25 Markdown documents (~6,814 LOC)

---

## 1. Executive Summary & Audit Overview

This audit comprehensively inspects 25 documentation artifacts across release management, operational runbooks, testing architecture, API endpoint contracts, plugin platform historical specifications, and server configuration.

### Key High-Level Findings:
1. **Retired Plugin Platform Remains Entangled in Current Docs:** While the trusted plugin platform was formally retired on 2026-10-02 (superseded by Native Evcrate Advisor), stale artifacts and references remain in active configuration and operational guides:
   - `docs/configuration/server-environment-auth.md` actively lists `DAM_HOPPER_PLUGIN_ADMINS_FILE` in its main environment variable table and active explanation, despite a later historical note.
   - `docs/linux-release-manager.md` declares the runner retired at the top, yet still includes runner unit staging, `dam-hopper-plugin-runner.conf`, and `/var/lib/dam-hopper-plugin-runner/` in its layout and staging sections.
   - 6 plugin documents (`docs/plugin-platform-linux.md`, `docs/plugin-platform-d00.md`, and `docs/architecture/plugin-platform-d01..d05.md`) clutter active architecture and root namespaces without an isolated archive location.
2. **Duplicate and Split Ownership Across Root and Subdirectories:**
   - **Authentication:** `docs/authentication-api.md` (249 LOC) and `docs/api/authentication.md` (86 LOC) duplicate contracts; the latter is a truncated wrapper pointing to the former.
   - **WebSocket:** Root `docs/ws-protocol-guide.md` (618 LOC) duplicates and supersedes `docs/api/websocket.md` (70 LOC).
   - **Git Endpoints:** `docs/api/rest-endpoints.md` duplicates extensive Git operations (diff, status, commit, rewrite, squash) that are independently and authoritatively defined in `docs/api/git.md` (760 LOC).
   - **Frontend State in API Docs:** `docs/api/rest-endpoints.md` embeds client-side `ServerProfile` state and `packages/ui` persistence tables (155 LOC), which belong in client/workbench architecture.
   - **Configuration:** Root `docs/configuration-guide.md` (410 LOC) duplicates content from `docs/configuration/` (7 files, 985 LOC).
3. **Broken Internal Heading Anchors:** Several documents contain broken `#anchor` links caused by historical section renaming, notably:
   - Links into `docs/linux-release-manager.md#helper-service-lifecycle-production-cli-phase-03` (section renamed to `## Current service lifecycle`).
   - Link from `docs/phase-06-preferences-settings-usage-and-host.md` to `docs/system-architecture.md#fleet-deck-drilldown-popover-phase-03-2026-09-20` (heading does not exist in target).
4. **Phase-Prefixed Documents Contain Core Living Architecture:** `docs/phase-03-files-editor-search-git.md` and `docs/phase-06-preferences-settings-usage-and-host.md` are actively updated, high-value living architecture guides for the workbench and multi-server profiles, but carry milestone planning names and brittle links into `../plans/`.

---

## 2. Per-File Detailed Analysis

### 2.1 Core Target Documents (9 Files)

#### 1. `docs/linux-release-manager.md` (698 LOC)
- **Purpose:** Authoritative operational and architectural specification for the Linux release manager CLI (`dam-hopper` / `dam-hopper-manager`). Covers unprivileged fetch, root-only staging, atomic directory exchange (format-2 migration), health-gated activation (10s consecutive stability), rollback, crash recovery, and runtime provisioning.
- **Key Sections:**
  - Status & Trust Boundary (Manifest v2, manager state v3, UID/GID authority).
  - API Runtime Reconciliation (`provision-api-runtime` ExecStartPre, strict 0700/0600 mode verification on `/var/lib/dam-hopper`).
  - Phase 03 Preflight SQLite Migration Protection (`dam-hopper.toml` candidate discovery).
  - Command Grammar & Privilege Matrix (`fetch`, `install`, `role set`, `start`, `status`, `rollback`, `recover`, `version`, `validate`, `diagnose`).
  - Health Gate & Crash Recovery (20s initial + 20x 500ms stable probes on 4801/4802).
  - Production Diagnostics (`dam-hopper diagnose --json`, bundleSchemaVersion 1).
  - Format-2 Migration (`renameat2(RENAME_EXCHANGE)` atomic swap of `/opt/dam-hopper`).
- **Internal Links & Dependencies:**
  - `[Publisher and Bootstrap](./linux-release-publisher-bootstrap.md)`
  - `[Linux Release Manifest v2](./linux-release-manifest.md)`
  - `[Linux systemd](./linux-systemd.md)`
  - `[Linux API Runtime State Provisioning](./linux-release-runtime-provisioning.md)`
  - `[Authentication API](./authentication-api.md)`
- **Suspicious Outdated Claims (Unverified):**
  - *Internal contradiction:* Lines 542–544 and 601–605 describe `stage_units.rs` staging runner units, `render_runner_unit`, `/etc/dam-hopper/tmpfiles.d/dam-hopper-plugin-runner.conf`, and `/var/lib/dam-hopper-plugin-runner/`, directly contradicting the header and Section "Current service lifecycle" which explicitly state plugin runner assets are retired.
- **Recommended Disposition:** **KEEP & UPDATE**. Retain as primary release manager authority. Purge retired plugin runner references from Section "Filesystem layout" and "Role-aware unit staging". Fix incoming broken anchors.

#### 2. `docs/linux-release-publisher-bootstrap.md` (408 LOC)
- **Purpose:** Authoritative specification for the CI release publisher DAG (`release-linux.yml`) and non-root Linux bootstrap installer (`dam-hopper-install.sh`).
- **Key Sections:**
  - Release Boundary (`vX.Y.Z` exact SemVer alignment across tag, Cargo.toml, and package.json).
  - Publisher DAG (validate-metadata -> parallel build jobs -> package twice with fixed epoch `1700000000` -> attestation for 6 subjects -> publish approval).
  - Public Asset Set (exact 6 assets: 4 Linux + 2 Windows direct-server).
  - Windows Direct-Server Profile (`dam-hopper-install.ps1`, zip with 4 root members).
  - Manifest & SPDX 2.3 SBOM generation.
  - Asset Gates (`check-release-assets.mjs` with `--profile <linux|windows|all>` and migration mode).
  - Historical v0.5.0/v0.5.1 runner packaging incident record.
  - Bootstrap Installer Workflow (`dam-hopper-install.sh`, leaves release in `PENDING`).
- **Internal Links & Dependencies:**
  - `[Linux Release Manifest v2](./linux-release-manifest.md)`
  - `[Linux Release Manager](./linux-release-manager.md)`
  - `[Windows Release Asset Packaging](./windows-release-packaging.md)`
  - `[Linux systemd](./linux-systemd.md)`
- **Suspicious Outdated Claims (Unverified):** None. The document explicitly differentiates between historical incidents (v0.5.0/v0.5.1) and current release contracts.
- **Recommended Disposition:** **KEEP & UPDATE**. Synchronize cross-references; keep as primary publisher authority.

#### 3. `docs/plugin-platform-linux.md` (350 LOC)
- **Purpose:** Historical operational deployment and qualification guide for the retired Linux trusted plugin platform (runner daemon, Unix socket, DAC scenarios, systemd hardening).
- **Key Sections:**
  - Explicit Header: `**RETIRED (2026-10-02)**`.
  - Dual-identity architecture (`dam-hopper-plugin-runner` vs `dam-hopper-api`).
  - Filesystem layout & socket permissions (`/run/dam-hopper/plugin-runner.sock` mode 0660).
  - Developer workstation DAC vs multi-user ACL configuration (`setfacl`).
  - Global owner history source & SHA-256 root identity calculation.
  - Phase D06 LAN qualification and Phase 09 Workspace Advisor qualification evidence.
- **Internal Links & Dependencies:**
  - `[Linux Release Manager](./linux-release-manager.md)`
  - `[Linux systemd](./linux-systemd.md)`
- **Suspicious Outdated Claims (Unverified):** Entire platform is retired. All commands (`dam-hopper-plugin-runner`, `--plugin-owner-user`, `--plugin-admin-subject`), sockets, systemd units, and Settings UI sections no longer exist in code.
- **Recommended Disposition:** **ARCHIVE / MOVE**. Move to `docs/archive/plugins/plugin-platform-linux.md`. No current documents link to this file (0 inbound links).

#### 4. `docs/phase-03-files-editor-search-git.md` (256 LOC)
- **Purpose:** Architecture specification for profile-qualified and worktree-qualified workbench features: project target identity (`ProjectTargetRef`), live file tree watching, Monaco editor scoping, federated search across profiles, search-replace with dirty-tab protection, and Git history actions (commit editing, inactive local branch rewrite, squash, leased publication).
- **Key Sections:**
  - Target Identity (`{ profileId, project, worktreePath? }` and stale generation rejection).
  - Files & Live Tree (`fs:subscribe_tree`, `IdleTransport` fail-closed fallback).
  - Editor & Previews (Monaco model URI scoping, dirty tabs, 5 MiB large file viewer, media tickets).
  - Federated Search (project vs all connected profiles, 500-match aggregate cap).
  - Inactive Local Branch Rewrites & UI Surface Parity (PR #47, updated 2026-10-05).
  - Server-side history search & Persisted Git history selection (`useGitHistoryStore`).
  - Source map and test matrix.
- **Internal Links & Dependencies:**
  - `[Frontend Components](./frontend-components.md)`
  - `[Git history search architecture guide](./architecture/git-history-search.md)`
  - `[API Reference](./api-reference.md)`
  - Brittle links into plans: `../plans/261001-2003-git-history-search-persistence/...` (Phases 01, 05, 06).
- **Suspicious Outdated Claims (Unverified):**
  - Section "Server-side history search" states "Phase 07 end-to-end qualification remains open" (unverified historical plan note; Git qualification was closed on 2026-10-02).
- **Recommended Disposition:** **MOVE & UPDATE** to purpose-based path: `docs/workbench-files-editor-search-git.md` (or `docs/architecture/workbench-files-editor-git.md`). Remove brittle `../plans/` links.

#### 5. `docs/testing.md` (235 LOC)
- **Purpose:** Authoritative repository testing architecture and standards following PR #44 frontend test restructuring.
- **Key Sections:**
  - 4-Tier Runner Architecture (`cargo test`, Vitest jsdom, Vitest browser mode on 15173/15174, Playwright E2E journeys).
  - Runner Discovery Invariants (`.spec.ts` vs `.browser.tsx`, exclusion of legacy `.e2e.tsx`).
  - Isolated Application Services (Docker/Podman containers, `dam-hopper:production-test`, HOME=/e2e/home isolation, deterministic auth seeding).
  - Application E2E Journeys (Privacy Mode Heavy Blur, Advisor Model Dropdown & Theme, Counsel Evaluations Responsive Narrow Dock).
  - Visual Evidence Authenticity & Governance (`capture-policy.ts`, 1440x900 viewport, `review.md` human review standard).
  - CI Quality Gate Integration (`pr-quality-gate.yml`, `scripts/run-all-tests.sh`, capture-disabled parity).
  - Ranked Workflow Coverage Gaps (P1/P2 priorities).
- **Internal Links & Dependencies:**
  - `[plans/261004-1639-frontend-test-restructure/research/browser-coverage-inventory.md](../plans/...)`
- **Suspicious Outdated Claims (Unverified):** None. Reflects current repository architecture.
- **Recommended Disposition:** **KEEP & UPDATE**. Retain as primary testing guide. Clean up external plan link.

#### 6. `docs/linux-nohup.md` (173 LOC)
- **Purpose:** Documents legacy, unsupported nohup background launcher (`deploy/run-linux-nohup.sh`) and container build instructions for host resource monitoring release/rollback.
- **Key Sections:**
  - Header: Explicitly marked `legacy, unsupported`. Warning against running alongside systemd units.
  - Install & Start (`deploy/run-linux-nohup.sh restart --bin ...`).
  - Configuration (`~/.config/dam-hopper/server.conf`, port 4800).
  - Host Resource Monitoring Release & Rollback (Docker container build, `scripts/profile-host-resource-deep-scan.sh`, Phase 07 release checks).
- **Internal Links & Dependencies:**
  - `[Linux systemd workflow](./linux-systemd.md)`
- **Suspicious Outdated Claims (Unverified):**
  - Mixes legacy nohup process management with container builds and host resource canary rollout.
  - Mentions Phase 07 release check commands (`pnpm lint`, `pnpm build:server`) that do not match current release verification scripts.
- **Recommended Disposition:** **ARCHIVE / CONSOLIDATE**. The nohup wrapper is legacy and unsupported. Move to `docs/archive/linux-nohup.md` or consolidate container instructions into `docs/deployment-guide.md`.

#### 7. `docs/phase-06-preferences-settings-usage-and-host.md` (171 LOC)
- **Purpose:** Implementation contract for multi-profile preferences source, Settings target, owner-qualified usage, host resources, fleet mode, and idle-suspend dialogs.
- **Key Sections:**
  - Ownership Model (`preferencesProfileId`, `settingsProfileId`, `browserTargetProfileId`).
  - Preference Source Transaction (`stores/settings.ts`, `PersistedSettingsState`, 500ms debounce).
  - Settings Target & Configuration UI (`SettingsPage`, `GlobalConfigEditor`, `ConfigEditor`, TOML export/import).
  - Owner-Qualified Usage (`UsagePage`, deep links, range deletions).
  - Host Resources & Idle Suspend (Fleet mode deck, `use-sse.ts`, `ForceSleepDialog`).
  - Source map and verification status.
- **Internal Links & Dependencies:**
  - `[Fleet Deck & Drilldown Popover](./system-architecture.md#fleet-deck-drilldown-popover-phase-03-2026-09-20)` (**BROKEN ANCHOR**: heading does not exist in target).
  - `[API Reference](./api-reference.md)`
  - `[Protected Idle-Suspend Status](./idle-suspend-status-ui.md)`
  - `[Frontend Components](./frontend-components.md)`
  - Brittle links into plans: `../plans/260916-2137-unified-profile/...` and `../plans/reports/...`.
- **Suspicious Outdated Claims (Unverified):** None in core behavior; milestone plan links and broken anchor require remediation.
- **Recommended Disposition:** **MOVE & UPDATE** to purpose-based path: `docs/workbench-preferences-settings-host.md`. Fix broken anchor and remove brittle `../plans/` links.

#### 8. `docs/api-reference.md` (85 LOC)
- **Purpose:** Top-level navigation index for API reference documents, routing readers to domain-specific files under `docs/api/`.
- **Key Sections:**
  - Base URL summary (local 4803, systemd 4801, legacy 4800).
  - Current API references table (11 links to `docs/api/*.md`).
  - Domain notes (Auth, Native Advisor, Idle Suspend, Git, Worktrees, Commit History, Filesystem, Media, Agent Store, WebSocket).
  - Retired Plugin API Anchors (explicit tombstones for D03 and D05 pointing to historical architecture records).
- **Internal Links & Dependencies:**
  - 11 links into `docs/api/*.md`.
  - Links to `docs/architecture/plugin-platform-d03.md` and `d05.md`.
- **Suspicious Outdated Claims (Unverified):** None. Clean, accurate hub.
- **Recommended Disposition:** **KEEP & UPDATE**. Maintain as central API index. Ensure anchor targets in child docs stay synchronized.

#### 9. `docs/project-roadmap.md` (39 LOC)
- **Purpose:** High-level project delivery status and qualification tracking document, updated as of 2026-10-05.
- **Key Sections:**
  - Recently delivered table (Native Advisor, Git commit rewrite/squash PR #47, Quick tunnel isolation PR #46, Frontend test restructuring PR #44, Cognito Mode, Multi-profile workbench, Agent Status, Idle suspend).
  - Open qualification and planning gates (Application E2E gaps P1/P2, Host-resource SSE, Windows native S13, Browser child WebView, Agent provider coverage).
  - Retired scope (Trusted plugin platform, plugin SDK/runner/APIs/bridge/assets).
  - Current references table.
- **Internal Links & Dependencies:**
  - `[Native Advisor architecture](./architecture/native-advisor.md)`
  - `[Git history architecture](./architecture/git-history-search.md)`
  - `[Testing guide](./testing.md)`
  - `[Agent Status architecture](./architecture/agent-status.md)`
  - `[Host-resource SSE architecture](./architecture/host-resource-sse.md)`
  - `[Native Browser Debug](./native-browser-debug-support.md)`
- **Suspicious Outdated Claims (Unverified):** None. Highly synchronized and accurate.
- **Recommended Disposition:** **KEEP & UPDATE**. Retain as authoritative status tracking page.

---

### 2.2 Nested API Documents (`docs/api/`, 11 Files, 3,130 LOC)

#### 10. `docs/api/advisor-and-workflow.md` (74 LOC)
- **Purpose:** Documents Native Evcrate Advisor REST routes (`/api/advisor/*`) and summarizes Workflow Tracking Service routes (`/api/workflow/*`).
- **Key Sections:** Native Advisor Endpoints (status, settings, history refresh/summary/page/detail, policy current/patch, models, evaluations list/read/compare); Query filters & 16 KiB/64 KiB limits; Policy update & model discovery errors; Historical notice on retired plugin APIs; Workflow Tracking overview.
- **Internal Links:** `../api-reference.md`, `../workflow-api.md`.
- **Issues / Duplicate Ownership:** Workflow section is a terse summary pointing to root `docs/workflow-api.md` (338 LOC). Native Advisor architecture is independently documented in `docs/architecture/native-advisor.md`.
- **Recommended Disposition:** **KEEP & UPDATE**. Consolidate full workflow route details here or make this the definitive routing reference with links to workflow guides.

#### 11. `docs/api/agent-usage-and-sessions.md` (236 LOC)
- **Purpose:** Contracts for Agent Status snapshot (`GET /api/agent-status/v1/snapshot`), Codex Usage Analytics (`GET /api/usage/*`), and Terminal Session Persistence (`/api/terminal/list`, SQLite buffer snapshots).
- **Key Sections:** Agent Status API (OMP and native Codex/Claude); Codex Usage Analytics (summary, health, settings, setup, sessions, session detail, destructive delete); Session Persistence (SQLite schema, worker thread, buffering).
- **Internal Links:** `../architecture/agent-status.md`, `../../plans/reports/...`.
- **Issues / Duplicate Ownership:** Session persistence section contains historical Phase 05 design documentation whose source plan is noted as missing from the checkout.
- **Recommended Disposition:** **KEEP & UPDATE**. Move historical plan notes to architecture or keep as internal storage specification.

#### 12. `docs/api/authentication.md` (86 LOC)
- **Purpose:** High-level summary of authentication protocols, `--no-auth` dev mode, and auth REST endpoints.
- **Key Sections:** Dev mode (--no-auth); Auth Endpoints (`login`, `mfa/setup`, `mfa/confirm`, `mfa/verify`, `mfa/challenge`, `status`, `logout`).
- **Internal Links:** `../api-reference.md`, `../authentication-api.md`, `../../plans/...`.
- **Issues / Duplicate Ownership:** **Severe Duplicate Ownership.** Root `docs/authentication-api.md` (249 LOC) documents the exact same endpoints in fuller detail. `docs/api/authentication.md` acts as an incomplete wrapper that defers to `../authentication-api.md`.
- **Recommended Disposition:** **CONSOLIDATE**. Merge `docs/authentication-api.md` directly into `docs/api/authentication.md` to establish a single source of truth for auth endpoints under `docs/api/`.

#### 13. `docs/api/filesystem-and-media.md` (270 LOC)
- **Purpose:** Contracts for IDE File Explorer (`/api/fs/*`) and Session-Bound Media Capabilities v2 (image preview, video playback/download).
- **Key Sections:** IDE File Explorer (list, read, stat, search, search-paths); Session-Bound Media Capabilities v2 (client UUIDv4 binding, cookie `damhopper-media-session-<uuid>`, endpoints, stream authorization, Phase 09 qualification, language files).
- **Internal Links:** `../api-reference.md`, `../phase-07-media-isolation-and-encryption.md`, `../../scripts/...`.
- **Issues / Duplicate Ownership:** Well-maintained; overlaps conceptually with `docs/phase-07-media-isolation-and-encryption.md` which covers the encryption/crypto lifecycle.
- **Recommended Disposition:** **KEEP & UPDATE**. Retain as primary API reference for filesystem and media streams.

#### 14. `docs/api/git.md` (760 LOC)
- **Purpose:** Definitive reference for all Git routes, target worktree validation, commit history filtering, commit rewriting, contiguous-chain squash, and leased push publication.
- **Key Sections:**
  - Project Worktree Targets (Phases 1–7; `ProjectTargetRef`, validation error codes).
  - Profile-owned file and search requests.
  - Worktree management (`GET/POST/DELETE /api/git/{project}/worktrees`).
  - Branch discovery & commit history (`GET /api/git/{project}/log` with `messageQuery`).
  - History actions (cherry-pick, revert).
  - Git History Safety Contract (local CAS, unpushed protections).
  - Commit message editing & contiguous squash.
  - Leased Push Publication (`POST /api/git/{project}/push/prepare` and `/push/leased`).
  - Frontend Transport, Hooks, Action Controllers, and UI Surfaces (PR #47, updated 2026-10-05: inactive local branch rewrites, Radix menu accessible descriptions, receipt-bound leased push).
- **Internal Links:** `../api-reference.md`, `../phase-03-files-editor-search-git.md`.
- **Issues / Duplicate Ownership:**
  - File length is 760 LOC (approaching repo maxLoc 800 ceiling).
  - Duplicated by `docs/api/rest-endpoints.md` which redundantly defines Git routes.
- **Recommended Disposition:** **KEEP & UPDATE**. Treat as sole authority for Git endpoints. Trim redundant Git sections from `rest-endpoints.md`.

#### 15. `docs/api/idle-suspend.md` (354 LOC)
- **Purpose:** Server-authoritative terminal idle suspend subsystem contracts: policy configuration, status, timing mutations, manual force-suspend, and helper service protocol.
- **Key Sections:** Startup Policy & Configuration contract (`[server.idle_suspend]`); Status endpoint (`GET /api/system/idle-suspend/v1/status` with `activity` payload); Timing mutation (`PATCH .../timing`); Manual force-suspend (`POST .../force`); Helper service protocol (Unix socket framing, commands, exit codes); Status push events (`host:idleSuspendChanged`).
- **Internal Links:** `../api-reference.md`, `../agent-activity-process-discovery.md`, `../tcp-activity-observation.md`, `../agent-activity-automatic-admission.md`, `../idle-suspend-status-ui.md`.
- **Issues / Duplicate Ownership:** Comprehensive and synchronized with server implementation.
- **Recommended Disposition:** **KEEP & UPDATE**. Retain as primary reference for idle-suspend APIs.

#### 16. `docs/api/rest-endpoints.md` (640 LOC)
- **Purpose:** Consolidated REST endpoint reference covering Global Configuration, Projects, Terminals, Git Operations, SSH Credentials, Git Diff, and client-side server profile management.
- **Key Sections:**
  - Global Configuration & Preferences (`/api/global-config`, `/api/config`).
  - Projects (`/api/projects`).
  - Terminals (`/api/terminal`, `/api/terminal/list`, input, resize).
  - Git Operations (status, stage, unstage, commit, push, fetch, pull).
  - SSH Credential APIs (`/api/ssh/keys/*`).
  - Git Diff & Change Management (`/api/git/:project/diff`, stage-file, discard).
  - Git History Rewriting & Squash.
  - Client-Side Profile Management (Phase 02: `ServerProfile`, connection status, localStorage breakdown).
- **Internal Links:** `../api-reference.md`.
- **Issues / Duplicate Ownership:**
  - **Severe Duplication:** Lines 129–238 (Git Operations), lines 300–418 (Git Diff), and lines 419–485 (Git History Rewriting & Squash) duplicate `docs/api/git.md`.
  - **Misplaced Domain:** Lines 486–640 ("Client-Side Profile Management") document client TypeScript interfaces (`packages/ui/src/api/server-config.ts`), `localStorage` keys, and frontend connection lifecycles, which are not server REST endpoints.
- **Recommended Disposition:** **CONSOLIDATE & PRUNE**.
  1. Remove redundant Git sections and link directly to `docs/api/git.md`.
  2. Relocate "Client-Side Profile Management" to `docs/user-guide-multi-server-profiles.md` or `docs/workbench-preferences-settings-host.md`.
  3. Keep global config, projects, terminals, and SSH credentials in this document.

#### 17. `docs/api/system-services.md` (389 LOC)
- **Purpose:** System service API contracts for diagnostics, browser debug, native SSH forwarding IPC, and host resources.
- **Key Sections:**
  - Frontend Diagnostics Snapshot (localStorage ring).
  - Browser Debug Artifacts (`POST /api/browser-debug/artifacts`).
  - Native SSH Forwarding IPC (Windows desktop Tauri IPC commands).
  - Backend Diagnostics Export (`POST /api/diagnostics/export`).
  - Production Diagnostics CLI (`dam-hopper diagnose --json`).
  - Host Resource Snapshot & Alerts (`/api/system/resources/v1/snapshot`, `alerts`, `events` SSE).
- **Internal Links:** `../api-reference.md`.
- **Issues / Duplicate Ownership:** Mixes REST endpoints with client-only storage (frontend diagnostics), local host CLI commands (`dam-hopper diagnose`), and Windows Tauri IPC commands (`dam_hopper_ssh_forward_*`).
- **Recommended Disposition:** **KEEP & UPDATE**. Retain REST and SSE endpoints; clarify non-REST boundaries (CLI vs IPC).

#### 18. `docs/api/transport-and-events.md` (157 LOC)
- **Purpose:** Documents client-side transport abstraction (`packages/ui/src/api/transport.ts`) for reconnection, terminal streams, session attachment, and push event listeners.
- **Key Sections:** Reconnection Flow (`Transport` interface, `invoke`); Terminal Subscriptions (`onTerminalData`, `onTerminalExit`, enhanced exits); Session Attachment (`terminalAttach`, buffer replay); Terminal Control (`terminalWrite`, `terminalResize`); Private observation boundaries notice; Event Subscriptions (`onEvent`, `onStatusChange`).
- **Internal Links:** `../api-reference.md`, `../pty-activity-observation.md`, `../agent-activity-process-discovery.md`, etc.
- **Issues / Duplicate Ownership:** Specifically documents the client TypeScript SDK layer rather than wire protocol.
- **Recommended Disposition:** **KEEP & UPDATE**. Clarify that this document covers the frontend client SDK transport contract.

#### 19. `docs/api/websocket.md` (70 LOC)
- **Purpose:** Documents the WebSocket endpoint (`/ws`), message framing, terminal commands/events, file tree subscriptions, and file read/write operations.
- **Key Sections:** WebSocket /ws connection & auth; Legacy WebSocket Terminal Messages; File Tree Subscription (`fs:subscribe_tree`, `fs:event`); File Read (`fs:read`); File Write (`fs:write_begin`, `fs:write_chunk`, `fs:write_commit`); Git Events (`git:progress`).
- **Internal Links:** `../api-reference.md`.
- **Issues / Duplicate Ownership:** **Severe Duplication.** Root `docs/ws-protocol-guide.md` (618 LOC) covers the exact same WebSocket protocols in vastly greater detail with complete frame examples and error tables.
- **Recommended Disposition:** **CONSOLIDATE**. Merge with `docs/ws-protocol-guide.md` or make `docs/api/websocket.md` the authoritative specification under `docs/api/` and convert the root guide into an architecture/implementation reference.

#### 20. `docs/api/workspace-settings.md` (94 LOC)
- **Purpose:** Contracts for Agent Store distribution/import/ship, Workspace management (`/api/workspace/*`), and Settings & Health (`/api/health`).
- **Key Sections:** Agent Store (`/api/agent-store/distribution`, `import`, `ship`); Workspace Management (`status`, detailed info, `switch`, `init`); Settings & Health (`GET /api/health`).
- **Internal Links:** `../api-reference.md`.
- **Issues / Duplicate Ownership:** Clean and concise. Minor conceptual overlap with `docs/configuration/`.
- **Recommended Disposition:** **KEEP & UPDATE**. Maintain as domain reference.

---

### 2.3 Historical Plugin Architecture Documents (`docs/architecture/`, 4 Files, 1,123 LOC)

#### 21. `docs/architecture/plugin-platform-d01.md` (307 LOC)
- **Purpose:** Historical design record for Phase D01 package registry and trust staging (archive inspection, layout, durable `registry-v1.json`, streaming stage protocol).
- **Key Sections:** Header: `**HISTORICAL (retired 2026-10-02)**`; Scope and ownership; Runner state layout (`/var/lib/dam-hopper-plugin-runner/`); Durable records & recovery; Streaming stage protocol (`management.stage.*`); Archive validation invariants; CAS registry API.
- **Internal Links:** `../plugin-platform-d00.md`, `./plugin-platform-d02.md`, `./plugin-platform-d05.md`, `../../plans/...`.
- **Recommended Disposition:** **ARCHIVE / MOVE**. Move to `docs/archive/plugins/plugin-platform-d01.md`.

#### 22. `docs/architecture/plugin-platform-d02.md` (301 LOC)
- **Purpose:** Historical design record for Phase D02 owner-account runner, Unix-socket boundary (`/run/dam-hopper/plugin-runner.sock`), real Node worker supervision, and framing.
- **Key Sections:** Header: `**HISTORICAL (retired 2026-10-02)**`; Ownership & process topology; `dam-hopper-plugin-runner` binary options; RunnerServer authenticated local RPC; 4-byte BE length-prefixed JSON-RPC 2.0; RunnerClient full-duplex client; WorkerProcess private Node execution; InstallationSupervisor & 3-crash budget; systemd hardening.
- **Internal Links:** `../plugin-platform-d00.md`, `./plugin-platform-d01.md`, `./plugin-platform-d03.md`, `./plugin-platform-d05.md`.
- **Recommended Disposition:** **ARCHIVE / MOVE**. Move to `docs/archive/plugins/plugin-platform-d02.md`.

#### 23. `docs/architecture/plugin-platform-d03.md` (259 LOC)
- **Purpose:** Historical design record for Phase D03 authenticated REST/WebSocket façade, actor grants, and short-lived execution contexts.
- **Key Sections:** Header: `**HISTORICAL (retired 2026-10-02)**`; Boundary and data flow; Protected REST API (`/api/plugins/*`); Grant & authorization model (`GrantKey`); WebSocket connection epoch lifecycle (`plugin:epoch`); Context & runner limits; Client contract.
- **Internal Links:** `../plugin-platform-d00.md`, `./plugin-platform-d01.md`, `./plugin-platform-d02.md`, `./plugin-platform-d05.md`, `../api-reference.md#trusted-plugin-api-phase-d03`.
- **Recommended Disposition:** **ARCHIVE / MOVE**. Move to `docs/archive/plugins/plugin-platform-d03.md`.

#### 24. `docs/architecture/plugin-platform-d05.md` (256 LOC)
- **Purpose:** Historical design record for Phase D05 plugin management REST API, root-seeded administrator allowlist, and transactional lifecycle coordinator.
- **Key Sections:** Header: `**HISTORICAL (retired 2026-10-02)**`; Boundary & data flow; Administrator allowlist (precedence: CLI -> env var -> file -> deny all); Bearer-only management guard (`require_bearer_auth`); Management REST API (`/api/plugins/admin/*`); Transactional lifecycle coordinator; UI Settings surface.
- **Internal Links:** `../plugin-platform-d00.md`, `./plugin-platform-d01.md`, `./plugin-platform-d02.md`, `./plugin-platform-d03.md`, `../api-reference.md#trusted-plugin-management-api-phase-d05`.
- **Recommended Disposition:** **ARCHIVE / MOVE**. Move to `docs/archive/plugins/plugin-platform-d05.md`.

---

### 2.4 Critical Stale Document Inspection

#### 25. `docs/configuration/server-environment-auth.md` (146 LOC)
- **Purpose:** Active reference for global defaults, environment variables, JWT signing secret, and MFA recovery runbook.
- **Key Sections:**
  - Global Configuration (`~/.config/dam-hopper/config.toml`).
  - Environment Variables Table.
  - JWT Signing Secret & Session Tokens (`~/.config/dam-hopper/server-token`).
  - MFA Encryption Key (`DAM_HOPPER_MFA_KEY_FILE`) & Operator Recovery Runbook (MongoDB mongosh commands).
  - Historical: Retired Plugin Management Administrator Allowlist (lines 98–146).
- **Critical Stale Issues Identified:**
  1. **Active Environment Table Contamination:** In the main "Environment Variables" table (line 42), `DAM_HOPPER_PLUGIN_ADMINS_FILE` is actively listed:
     `| DAM_HOPPER_PLUGIN_ADMINS_FILE | path | Optional root-seeded plugin administrator JSON override |`
  2. **Active Operational Claim Contamination:** Lines 44–45 state as current fact:
     `"Plugin management administrators are not configured in dam-hopper.toml; the runner reads this host-owned file before opening its management RPC surface."`
  3. **Internal Contradiction:** Later in the document (line 98), Section "Historical: Retired Plugin Management Administrator Allowlist" states that this describes the removed plugin platform and is not current server configuration.
- **Recommended Disposition:** **UPDATE IMMEDIATELY**.
  - Remove `DAM_HOPPER_PLUGIN_ADMINS_FILE` from the Environment Variables table.
  - Delete lines 44–45.
  - Remove the historical allowlist section (lines 98–146) or relocate it into the archived plugin D05 architecture record (`docs/archive/plugins/plugin-platform-d05.md`). Do not preserve retired plugin runner variables as active server configuration.

---

## 3. Anchor & Link Integrity Findings

A strict heading slug validation was performed across all assigned documents and their inbound/outbound links:

| Source Document | Link Target | Observed Anchor Issue | Cause & Recommended Fix |
|---|---|---|---|
| `docs/phase-06-preferences-settings-usage-and-host.md` | `docs/system-architecture.md` | `#fleet-deck-drilldown-popover-phase-03-2026-09-20` not found | Heading does not exist in `system-architecture.md`. Fleet Deck is documented in `docs/user-guide-multi-server-profiles.md`. Change link to `docs/user-guide-multi-server-profiles.md#fleet-deck` or update heading. |
| `docs/terminal-idle-suspend-security.md` (inbound) | `docs/linux-release-manager.md` | `#helper-service-lifecycle-production-cli-phase-03` not found | Target heading was renamed to `## Current service lifecycle`. Update link anchor in caller document. |
| `docs/configuration-guide.md` (inbound) | `docs/linux-release-manager.md` | `#helper-service-lifecycle-production-cli-phase-03` not found | Target heading was renamed to `## Current service lifecycle`. Update link anchor in caller document. |
| `docs/CHANGELOG-archive.md` (inbound) | `docs/api-reference.md` | `#client-side-profile-management-phase-02` not found | Section moved to `docs/api/rest-endpoints.md#client-side-profile-management-phase-02`. Update link or preserve historical anchor. |
| `docs/CHANGELOG.md` (inbound) | `docs/linux-release-publisher-bootstrap.md` | `#v051-release-checklist` not found | Target heading was renamed to `## Historical v0.5.0/v0.5.1 runner packaging incident`. |
| `docs/CHANGELOG.md` (inbound) | `docs/project-roadmap.md` | `#trusted-plugin-platform-2026-09-22` not found | Heading replaced by `## Retired scope` upon plugin retirement. |
| Multiple `phase-*.md` documents | `../plans/...` | Multiple direct relative links to internal plans | Brittle links to ephemeral plans; replace with stable architecture links or self-contained summaries. |

---

## 4. Directory & Child Docs Ownership / Duplication Analysis

| Area | Child Documents Inspected | Primary Conflicts & Duplications | Ownership Recommendation |
|---|---|---|---|
| **API (`docs/api/`)** | 11 files | - `docs/api/authentication.md` (86 LOC) vs `docs/authentication-api.md` (249 LOC).<br>- `docs/api/websocket.md` (70 LOC) vs `docs/ws-protocol-guide.md` (618 LOC).<br>- `docs/api/rest-endpoints.md` duplicates extensive Git routes from `docs/api/git.md` (760 LOC).<br>- `docs/api/rest-endpoints.md` embeds client TypeScript profile state. | Establish `docs/api/` as the single authoritative home for all API references. Consolidate root auth and WS docs into `docs/api/`. Prune redundant Git routes from `rest-endpoints.md`. |
| **Architecture (`docs/architecture/`)** | 8 files (4 plugins) | - 4 historical plugin specs (`d01`, `d02`, `d03`, `d05`) reside alongside active architecture (`native-advisor.md`, `git-history-search.md`, `host-resource-sse.md`, `agent-status.md`). | Move the 4 plugin files to `docs/archive/plugins/`. Keep `docs/architecture/` strictly for active, living system architecture. |
| **Configuration (`docs/configuration/`)** | 7 files | - Root `docs/configuration-guide.md` (410 LOC) duplicates content in `docs/configuration/` (985 LOC).<br>- Stale plugin variable in `server-environment-auth.md`. | Consolidate configuration into `docs/configuration/`. Deprecate or replace root `configuration-guide.md` with an index redirecting to `docs/configuration/`. |
| **Frontend Components (`docs/frontend-components/`)** | 7 files | - Root `docs/frontend-components.md` (278 LOC) duplicates structure of `docs/frontend-components/` directory (1,660 LOC across 7 files). | Use `docs/frontend-components/` as the primary directory; convert root `frontend-components.md` into an index or merge into `docs/frontend-components/index.md`. |

---

## 5. Reorganization Proposals

### 5.1 Purpose-Based Replacement Paths for `phase-*.md` Files

The `phase-*.md` naming reflects historical phased implementation milestones rather than ongoing domain purpose. They contain essential, active architecture and should be renamed as follows:

| Current File | Proposed Purpose-Based Path | Rationale & Scope |
|---|---|---|
| `docs/phase-01-auth-state-cryptography-and-policy.md` | `docs/architecture/auth-cryptography-policy.md` | Architectural specification for auth state, password hashing, AES-256-GCM MFA keys, and session policy. |
| `docs/phase-03-files-editor-search-git.md` | `docs/architecture/workbench-files-editor-git.md` | Frontend workbench architecture for target identity, file watching, Monaco editor, federated search, and Git actions. |
| `docs/phase-04-terminal-continuity-workflow-navigation.md` | `docs/architecture/terminal-continuity-workflow.md` | Terminal continuity, PTY reincarnation, bell notifications, and workflow navigation. |
| `docs/phase-05-agents-ports-and-browser.md` | `docs/architecture/agent-ports-browser-debug.md` | Port forwarding, agent process detection, and browser debug extension integration. |
| `docs/phase-06-preferences-settings-usage-and-host.md` | `docs/architecture/workbench-preferences-settings-host.md` | Multi-profile preference sources, Settings targets, usage analytics, Fleet deck, and idle-suspend dialogs. |
| `docs/phase-07-media-isolation-and-encryption.md` | `docs/architecture/media-isolation-encryption.md` | Session-bound media capabilities v2, ticket encryption, and cookie namespace isolation. |
| `docs/phase-08-native-scope-concurrency.md` | `docs/architecture/native-scope-concurrency.md` | Native desktop concurrency, SSH forwarding lifecycle, and multi-window scoping. |

### 5.2 Disposition of Retired Plugin Documentation

The trusted plugin platform was retired on 2026-10-02. The 6 plugin documents should be cleanly moved into an archive hierarchy rather than mixed with active architecture:

| Current File | Proposed Disposition & Path | Action Required |
|---|---|---|
| `docs/plugin-platform-d00.md` | `docs/archive/plugins/d00-contract-specification.md` | Move to archive; preserve historical record. |
| `docs/architecture/plugin-platform-d01.md` | `docs/archive/plugins/d01-package-registry.md` | Move to archive; remove from active architecture directory. |
| `docs/architecture/plugin-platform-d02.md` | `docs/archive/plugins/d02-owner-runner.md` | Move to archive; remove from active architecture directory. |
| `docs/architecture/plugin-platform-d03.md` | `docs/archive/plugins/d03-authorized-api.md` | Move to archive; remove from active architecture directory. |
| `docs/architecture/plugin-platform-d05.md` | `docs/archive/plugins/d05-management-lifecycle.md` | Move to archive; absorb historical allowlist from `server-environment-auth.md`. |
| `docs/plugin-platform-linux.md` | `docs/archive/plugins/linux-deployment-qualification.md` | Move to archive; preserve D06/Phase 09 LAN qualification evidence. |
| `docs/architecture/` (index) | Create `docs/architecture/retired-plugin-platform.md` | Single concise tombstone pointing to `native-advisor.md` and `docs/archive/plugins/`. |

---

## 6. Unique Operational & Security Guidance to Preserve

During restructuring, the following unique operational, security, and cryptographic invariants documented in the audited files must be strictly preserved:

1. **Linux Release Manager Identity & Provisioning Invariants (`docs/linux-release-manager.md`):**
   - The API unit's exact final `User=`/`Group=` pair is the sole runtime identity authority; UID 0 is strictly rejected, and `Group=` must match primary group.
   - Fixed metadata requirements for `/var/lib/dam-hopper`: API UID/GID, directory `0700`; canonical `dam-hopper.toml` regular file `0600`; `idle-suspend-audit.jsonl` regular file `0600`.
   - SQLite migration protection: canonical TOML is startup authority; legacy TOML under `/etc` is read-only copy-once migration source.
   - Format-2 atomic exchange using `renameat2(RENAME_EXCHANGE)` without cross-device or copy/delete fallback.
2. **Release Publisher Reproducibility & Provenance (`docs/linux-release-publisher-bootstrap.md`):**
   - Exact 6-asset public release union (4 Linux + 2 Windows).
   - Strict archive reproducibility: GNU tar, POSIX format, sorted names, zeroed UID/GID, deleted atime/ctime PAX records, `SOURCE_DATE_EPOCH=1700000000`, `gzip -n -9`, built twice requiring identical SHA-256.
   - Manifest v2 is external to the archive to prevent digest cycles.
   - Bootstrap installer trap cleanup and `PENDING` candidate state (never auto-starts services).
3. **MFA Emergency Recovery Runbook (`docs/configuration/server-environment-auth.md`):**
   - Lost TOTP recovery in authenticated `mongosh`: atomic `$inc: { authVersion: NumberLong(1) }` paired with `$unset` of MFA fields, filtering by immutable `_id` and observed `authVersion`.
   - Never reset by username alone; require `matchedCount === 1` and `modifiedCount === 1`.
4. **Git History Safety & CAS (`docs/api/git.md`, `docs/phase-03-files-editor-search-git.md`):**
   - Commit-message editing and squash use branch/HEAD CAS tip snapshots.
   - Leased publication is an explicit, separate user-confirmed action bound to exact remote OID without ambient HEAD fallback.
   - Inactive local branch actions check `historyView.isViewingLocalBranch`; receipt-bound leased push publishes strictly against `receipt.branch`.
5. **Session-Bound Media Isolation v2 (`docs/api/filesystem-and-media.md`):**
   - Media session cookies are namespaced: `damhopper-media-session-<canonical-lowercase-uuidv4>` with `HttpOnly; SameSite=Lax; Path=/api/fs`.
   - Bearer tokens are NEVER placed in media URLs or stream requests.
   - Native HTML5 elements use `crossOrigin="use-credentials"`.
6. **E2E Visual Evidence Governance (`docs/testing.md`):**
   - Full-viewport capture (1440x900 default, 320px narrow dock); element snippets forbidden.
   - Colocated artifacts (`screenshot.png`, `evidence.json`, `review.md`).
   - Binary image files (`.png`, `.webp`, `.jpg`) are strictly forbidden inside `plans/` or `plans/reports/`.
   - `CI=true` enforces `E2E_CAPTURE=0` (pure functional assertions, zero file bloat).
   - Test automation cannot bypass human review; `review.md` resets to `PENDING_HUMAN_REVIEW`.

---

## 7. Unresolved Questions

1. **Consolidation of Root API References vs `docs/api/` Subdirectory:**
   Should root-level reference documents like `docs/authentication-api.md` (249 LOC) and `docs/ws-protocol-guide.md` (618 LOC) be wholly moved into `docs/api/` (replacing the stubs `docs/api/authentication.md` and `docs/api/websocket.md`), or should `docs/api/` be reserved for short cheatsheets? (*Recommendation: Consolidate everything into `docs/api/` as the single authoritative source of truth*).
2. **Timing of `phase-*.md` Renaming:**
   Since multiple active plans and documents link to `phase-03-files-editor-search-git.md` and `phase-06-preferences-settings-usage-and-host.md`, should renaming proceed immediately with alias redirects, or be coordinated in a dedicated documentation restructuring pass across all 7 phase files?
3. **Historical Runner Residue in `linux-release-manager.md`:**
   Does any active code in `server/src/linux_release/` still parse or reference `stage_units` runner templates or `dam-hopper-plugin-runner.conf`, or can sections 542–544 and 601–605 be completely excised during the next documentation update?
