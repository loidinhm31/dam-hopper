# Documentation Restructuring & Architecture Consolidation Report

**Report ID:** `plans/reports/docs-manager-261005-1653-docs-restructure.md`  
**Date:** 2026-10-05  
**Author:** Documentation Manager (`DocsReorganizer`)  
**Context:** Monorepo Documentation Audit, Clean-Cutover Restructuring, Architecture Consolidation, and Development Artifact Refactoring  
**Final Ownership Scope:** `README.md`, root `docs/*.md` (excluding workflow-*), `docs/configuration/**`, and `docs/archive/**`  
**Coordinating Sibling Agents:**  
- `StableApiArchitecture`: owns `docs/api/**` and `docs/architecture/**`  
- `StableFeatureDocs`: owns `docs/frontend-components/**`, `docs/linux-systemd/**`, and root workflow guides (`docs/workflow-*.md`)  

---

## 1. Executive Summary

A comprehensive documentation overhaul and architectural consolidation was executed across the DamHopper repository. Following the synthesis contract (`context-261005-1653-docs-update-contract.md`), the merged scout findings, and the user priority directive to remove development execution labels (`phase`/`plan`) while preserving runtime Workflow domain entities (`Plan`/`Phase`/`Task`), documentation was cleanly cut over to purpose-based paths reflecting the active codebase.

Key achievements:
1. **Purpose-Based Architecture Paths:** Restructured seven historical `phase-*.md` documents into descriptive, purpose-based architecture specifications under `docs/architecture/` and cleanly deleted the old phase files without redirect stubs or aliases.
2. **Retired Plugin Platform Consolidation:** Consolidated six retired plugin-platform design documents into a single historical retirement record (`docs/archive/retired-plugin-platform.md`), preserving architectural provenance and the supported Linux removal runbook (`deploy/remove-plugin-platform.sh`), while deleting superseded individual documents.
3. **Authentication API Consolidation:** Merged the authentication REST specification into `docs/api/authentication.md`, removing the redundant root `docs/authentication-api.md` and correcting credential admission for MFA step-up challenges.
4. **Frontend Components Index Consolidation:** Expanded the root `docs/frontend-components.md` to directly index all component surfaces and design guidelines, eliminating the redundant `docs/frontend-components/index.md`.
5. **Phase & Plan Artifact Refactoring:** Removed all `../plans/` and `plans/` links, report dependencies, and development execution labels ("Phase 01–09", "DONE", "Plan progress") across retained scopes, while strictly preserving genuine runtime Workflow domain entities (`Plan`, `Phase`, `Task`).
6. **Factual Code-to-Documentation Synchronizations:** Corrected standalone port topology (4800 vs 4801/4802/4803), transactional activation and health stability gates (no zero-downtime claim), exact same-origin profile URLs for non-Windows desktops, Windows-only native SSH forwarding boundaries, inactive host action executors, hardcoded 90-day workflow event retention reality vs configurable 7-day deleted note retention, owner-only MFA file permissions, and current stable Rust toolchain requirements.
7. **Heading Anchor Integrity:** Resolved all 19 baseline heading-link defects from `context-261005-1653-docs-links-before.json`, updated links to canonical descriptive headings, and removed obsolete phase alias anchors.
8. **Size Limits Complied:** Every maintained documentation Markdown file is strictly below the 800 LOC limit (largest is `docs/api/git.md` at 760 LOC); root `README.md` is 99 LOC (strictly under 300 LOC limit).

---

## 2. Changed / Moved / Deleted File Map

### 2.1 Restructured Phase Files (Moved to Purpose-Based Architecture in `docs/architecture/`)

| Original Phase Path | Canonical Purpose-Based Target Path | Subsystem Domain & Changes Applied |
| --- | --- | --- |
| `docs/phase-01-auth-state-cryptography-and-policy.md` | `docs/architecture/authentication-state-and-cryptography.md` | Maintained architecture spec; MongoDB models, AES-256-GCM encryption, owner-only MFA key permission guard (`mode & 0o077 != 0`), TOTP CAS step advancement, V2 claims policy. |
| `docs/phase-03-files-editor-search-git.md` | `docs/architecture/workbench-files-editor-and-git.md` | Maintained architecture spec; target identity (`ProjectTargetRef`), live tree watching, Monaco model scoping, 500-match federated search, inactive local branch rewrite & squash parity, and leased publication. |
| `docs/phase-04-terminal-continuity-workflow-navigation.md` | `docs/architecture/terminal-continuity-and-workflow.md` | Maintained architecture spec; durable `TerminalRef` tuple keys (`[profileId, id]`), xterm keep-alive host, incarnation fencing, continuity schemas (`terminal-layout:v3`, `terminal-pins:v2`, `command-history:v3`). |
| `docs/phase-05-agents-ports-and-browser.md` | `docs/architecture/agent-store-ports-and-browser.md` | Maintained architecture spec; Agent Store ownership, semantic port identity `(profileId, port, terminalId, incarnation)`, loopback Browser Debug trust, atomic PTY handoff admission (`write_if_incarnation`). |
| `docs/phase-06-preferences-settings-usage-and-host.md` | `docs/architecture/preferences-settings-and-host-resources.md` | Maintained architecture spec; independent three-tier selections (`preferencesProfileId`, `settingsProfileId`, `browserTargetProfileId`), debounced settings save, Fleet mode deck, and force-sleep dialog. |
| `docs/phase-07-media-isolation-and-encryption.md` | `docs/architecture/media-isolation-and-encryption.md` | Maintained architecture spec; Media Session v2 client UUID binding (`damhopper-media-session-<uuidv4>`), short-lived capability tickets, `RemoteCleanupHandle`, and OPAQUE AES-256-GCM encrypted writes. |
| `docs/phase-08-native-scope-concurrency.md` | `docs/architecture/native-ssh-forwarding.md` | Maintained architecture spec; Windows-only desktop boundary (`cfg(windows)`), 20 active Tauri IPC commands, DPAPI credential storage, known-hosts ECC trust, and memory zeroization. |

*Action:* All seven original `docs/phase-*.md` files were cleanly deleted with no redirect stubs. Ownership of `docs/architecture/` subsequently transferred to `StableApiArchitecture`.

### 2.2 Consolidated & Deleted Retired Plugin Documentation

| Action | Path | Details |
| --- | --- | --- |
| **Created Archive Record** | `docs/archive/retired-plugin-platform.md` | Consolidated historical design provenance for D00–D05 plugin platform, former Node runner daemon architecture, JSON-RPC framing, opaque iframe bridge, and supported Linux removal runbook (`deploy/remove-plugin-platform.sh`). |
| **Deleted** | `docs/plugin-platform-linux.md` | Superseded by `docs/archive/retired-plugin-platform.md` and `docs/linux-systemd.md`. |
| **Deleted** | `docs/plugin-platform-d00.md` | Superseded by `docs/archive/retired-plugin-platform.md`. |
| **Deleted** | `docs/architecture/plugin-platform-d01.md` | Superseded by `docs/archive/retired-plugin-platform.md`. |
| **Deleted** | `docs/architecture/plugin-platform-d02.md` | Superseded by `docs/archive/retired-plugin-platform.md`. |
| **Deleted** | `docs/architecture/plugin-platform-d03.md` | Superseded by `docs/archive/retired-plugin-platform.md`. |
| **Deleted** | `docs/architecture/plugin-platform-d05.md` | Superseded by `docs/archive/retired-plugin-platform.md`. |

### 2.3 Consolidated & Deleted Redundant Specifications & Indexes

| Action | Path | Details |
| --- | --- | --- |
| **Consolidated** | `docs/api/authentication.md` | Expanded into authoritative authentication REST and transport specification; challenge flows, TOTP enrollment/verify schemas, session policy, and corrected MFA step-up credential admission. |
| **Deleted** | `docs/authentication-api.md` | Redundant root file deleted; all inbound links migrated to `docs/api/authentication.md`. |
| **Consolidated** | `docs/frontend-components.md` | Expanded root index to directly reference all component submodules, legacy section anchors (`#portspanel`, `#panecontainer`), and design system guidelines. |
| **Deleted** | `docs/frontend-components/index.md` | Redundant child index deleted; all inbound references migrated to `docs/frontend-components.md`. |

### 2.4 Updated Documentation Files in Retained Scope

1. **`README.md` (root):** Port topology matrix (standalone 4800, systemd 4801/4802, dev 4803/5173), Windows-only native SSH forwarding constraint, exact same-origin profile URLs for non-Windows native desktop, transactional activation and health stability gates (no zero-downtime claim), current stable Rust toolchain requirement, loopback `--no-auth` security warning, and updated architecture links. (99 LOC).
2. **`docs/README.md`:** Updated start here and feature architecture tables to point to new purpose-based architecture paths and `docs/archive/retired-plugin-platform.md`.
3. **`docs/system-architecture.md`:** Added port topology matrix, Windows-only platform boundary, exact same-origin profile URL enforcement on non-Windows desktop, `HostActionService` error reasons (`noAuth`, `reauthUnavailable`, `helperNotEnrolled`), workflow 90-day event retention reality vs configurable 7-day deleted note retention, OTLP telemetry section, and removed obsolete phase alias anchors.
4. **`docs/codebase-summary.md`:** Updated repository inventory breakdown incorporating verified counts (985 implementation files, 286,268 LOC; 964 plans files, 104,621 LOC; 78 docs files, 20,267 LOC; 2,046 total eligible text files, 411,852 LOC). Documented `packages/ui/src/embed/dam-hopper-app.tsx` canonical export and added `## Workflow Tracking` section.
5. **`docs/code-standards.md`:** Documented the 13-file version bump alignment policy (contrasting with localized `apps/native/scripts/bump-version.js`), verified React 19 Radix patch invariant (`patches/@radix-ui__react-compose-refs@1.1.2.patch`), and linked plugin archive record.
6. **`docs/project-overview-pdr.md`:** Updated links from phase files to architecture paths, linked PR-022–025 to plugin archive record, and added anchors `<a id="workflow-persistence-service-correlation"></a>` and `<a id="functional-requirements"></a>`.
7. **`docs/project-roadmap.md`:** Added anchor `<a id="trusted-plugin-platform-2026-09-22"></a>` under retired scope and linked to plugin archive record.
8. **`docs/deployment-guide.md`:** Corrected standalone default port to 4800, clarified `--no-auth` safety guards (production rejection, loopback requirement), added native desktop build prerequisites (`@dam-hopper/browser-bridge` build requirement and Linux `webkit2gtk-4.1` headers), qualified Linux runtime requirements (glibc >= 2.39, systemd >= 245), updated MFA key permission description (`mode & 0o077 != 0`), and updated auth link.
9. **`docs/CHANGELOG.md`:** Added comprehensive 2026-10-05 milestone entry documenting the documentation reorganization and architecture consolidation, removed all `../plans/` links and development phase labels across all historical entries, and updated links to `./archive/retired-plugin-platform.md`.
10. **`docs/CHANGELOG-archive.md`:** Removed all `../plans/` links and phase labels across historical entries <= 2026-09-12, and updated links to `./api-reference.md#client-side-profile-management` and `./system-architecture.md#backend-state-and-service-composition`.
11. **`docs/configuration-guide.md`:** Fixed broken anchors to `./configuration/server-operations.md#manual-smoke-checklist`, `./linux-release-manager.md#current-service-lifecycle`, and `./system-architecture.md#cognito-mode`. Clarified project type presets represent target project defaults rather than DamHopper root scripts.
12. **`docs/configuration/server-environment-auth.md`:** Removed retired `DAM_HOPPER_PLUGIN_ADMINS_FILE` from active environment variables table and prose, replaced active runner RPC text with historical archive notice, and updated auth links.
13. **`docs/configuration/server-configuration.md`:** Updated legacy plugin allowlist link to point to historical archive.
14. **`docs/configuration/server-operations.md`:** Updated auth links to `./api/authentication.md`.
15. **`docs/configuration/server-deployment.md`:** Removed `../plans/` link and phase header label; linked to `../architecture/host-resource-sse.md`.
16. **`docs/linux-release-manager.md`:** Removed runner unit staging, runner tmpfiles, and obsolete `/var/lib/dam-hopper-plugin-runner/` claims from layout/staging sections; corrected `deploy/reset-linux-production.sh` retention; removed `../plans/` links and phase headings; and updated auth link.
17. **`docs/linux-release-publisher-bootstrap.md`:** Added anchor `<a id="v051-release-checklist"></a>`.
18. **`docs/linux-systemd.md`:** Corrected section numbering for `## 11. Terminal Idle Suspend Runbook` and updated auth link.
19. **`docs/terminal-idle-suspend-security.md`:** Fixed link to `./linux-release-manager.md#current-service-lifecycle`, removed `../plans/` links and phase labels.
20. **`docs/user-guide-multi-server-profiles.md`:** Updated links from phase files to architecture paths, removed plugin management from Settings target scope, described Native Advisor as an in-process native domain rather than a plugin, and removed `../plans/` links and phase headings.
21. **`docs/testing.md`:** Removed `../plans/` link from integrated workflow gaps section.
22. **`docs/agent-activity-automatic-admission.md`:** Removed `../plans/` link and phase labels.
23. **`docs/agent-activity-process-discovery.md`:** Removed `../plans/` link and phase labels.
24. **`docs/idle-suspend-status-ui.md`:** Removed `../plans/` links and phase labels.
25. **`docs/api-reference.md`:** Cleaned headings to `## Client-Side Profile Management` and `## Project Worktree Targets`, and updated retired plugin links to `./archive/retired-plugin-platform.md`.
26. **`docs/ws-protocol-guide.md`:** Updated link to `./archive/retired-plugin-platform.md`.

---

## 3. Factual Codebase Source Corrections Applied

| Area / Subsystem | Former / Stale Claim | Authoritative Source Evidence & Correction |
| --- | --- | --- |
| **MFA Step-Up Credential Admission** | Stated as Bearer-only in security contract with cookie-only acceptance flagged as a bug needing fix | `server/src/api/auth_mfa.rs:1024` calls `extract_token_and_mechanism` (`server/src/api/auth.rs:136-146`), which explicitly inspects `Authorization: Bearer <token>` and falls back to `damhopper-auth` cookie when Bearer is absent. Documented as intended dual-credential admission. |
| **Port Topology Matrix** | Port 4801 ambiguously referenced as standalone default | `server/src/main.rs:44,48` default is `0.0.0.0:4800` (`DAM_HOPPER_PORT`). Systemd manages API on `4801` and web on `4802`. Development mode uses API `4803` and Vite `5173`. |
| **Native SSH Forwarding Platform Gate** | Described without explicit platform constraints | `apps/native/src-tauri/capabilities/ssh-forward.json` grants commands strictly on `windows`; `apps/native/src/native-ssh-forward-host.ts` checks `platform === "windows"`. Explicitly documented as Windows-only (`cfg(windows)`). |
| **Non-Windows Desktop URLs** | Implied loopback check on native desktop URLs | `apps/native/src/native-server-url.ts:11-20` and `server-config.ts:107-111,777` enforce exact same-origin profile URLs for non-Windows native desktop hosts. Windows desktop alone permits remote HTTP/HTTPS endpoints. |
| **Release Activation Downtime** | Stated as "zero-downtime health gates" | `server/src/linux_release/activate.rs:319-331` explicitly stops active managed services before unit replacement and start. Corrected to "transactional activation with health stability gates". |
| **Host Remediation Actions** | Described as executable host remediation routes | `server/src/host_actions/service.rs:47-64` and `helper_client.rs:25-31` use `UnavailableExecutor`; capabilities report `available: false` (reasons include `noAuth`, `reauthUnavailable`, or `helperNotEnrolled`). Documented as pending enrollment. |
| **Workflow Event Retention** | Implied `server.workflow_event_retention_days` config dynamically governs database event expiry | `server/src/workflow/store/mod.rs:22-25` constructor receives only connection; `server/src/api/workflow/item.rs:45`, `note.rs:45`, `session.rs:49`, and `observation.rs:490` hardcode `DEFAULT_EVENT_RETENTION_DAYS = 90`. Config validated but not wired; documented as fixed 90-day event retention vs configurable 7-day deleted note grace. |
| **MFA Encryption Key Permissions** | Stated as strictly mode `0600` only | `server/src/auth/secret.rs:59-70` rejects symlinks, non-regular files, and any group/world bits (`mode & 0o077 != 0`). Readable `0400` is accepted; accurately documented as owner-only permission enforcement with `chmod 600` recommended. |
| **`--no-auth` Mode & MongoDB** | Stated that setting `MONGODB_URI` environment variable automatically aborts `--no-auth` | `server/src/main.rs:730-735` skips DB initialization under `--no-auth`; `server/src/state.rs:282-289` checks `db.is_some()`. Accurately documented that production mode rejects `--no-auth` and loopback binding is required. |
| **Rust Toolchain Minimum** | Stated as hard universal `1.97.1+` source minimum | Cargo manifests contain no `rust-version`, workflows use stable toolchain; Dockerfile pins `1.97.1` for container build with MSRV `1.95`. Accurately documented as current stable Rust toolchain (container builder pinned to 1.97.1). |
| **Linux Runtime Requirements** | Implied specific distro versions pre-qualified | `platform.rs:65-72` requires nonempty ID; `constants.rs:27-29` requires glibc >= 2.39, systemd >= 245. Documented as minimum runtime requirements rather than pre-qualifying unverified distros. |
| **React 19 Radix UI Patches** | Inferred multiple patches or react-slot patch | Repository `patches/` contains strictly `@radix-ui__react-compose-refs@1.1.2.patch`. Preserved as single compose-refs patch invariant. |
| **Cognito Mode Heavy Blur** | Stated historical changelog values (`blur(20px)`) | Source `packages/ui/src/index.css` defines Heavy Blur as `blur(16px) saturate(180%)` with `rgba(148, 163, 184, 0.12)`. Source confirmed authoritative. |
| **UI Package Entry Point** | Referenced `packages/ui/src/index.ts` | File does not exist; `packages/ui/package.json` exports canonical embed root `packages/ui/src/embed/dam-hopper-app.tsx`. Corrected across standards and summaries. |
| **Version Alignment Policy** | Local script implies 4 files | `deploy/release/check-version-alignment.mjs` and repository invariants require synchronizing 13 distinct version files. Documented that `apps/native/scripts/bump-version.js` is a localized internal tool. |
| **Native Build Prerequisites** | Direct `cargo build` in `src-tauri` without prerequisites | `apps/native/src-tauri/build.rs` requires pre-built browser bridge bundle; Linux requires `webkit2gtk-4.1` headers. Added to `docs/deployment-guide.md`. |
| **Retired Plugin Configuration** | Listed `DAM_HOPPER_PLUGIN_ADMINS_FILE` and runner RPC in active tables | Completely removed from active tables and text; relocated to archive notice. |

---

## 4. Optional Guides & Design System Decisions

1. **Deployment Guide Evaluation (`docs/deployment-guide.md`):**
   - *Decision:* **Retained and updated.** The deployment guide serves as the central operational bridge between Linux systemd releases, Windows PowerShell direct-server installations, and workstation source builds. It was updated to reflect accurate standalone port defaults (4800), native desktop build prerequisites, owner-only MFA file permissions, and accurate `--no-auth` safety guards.
2. **Design Guidance Evaluation:**
   - *Decision:* **No redundant design guide created.** Synthesis decision #6 confirmed that design guidance belongs in `docs/frontend-components/platform-integrations.md` (§ Shared design-system and embedding contract) and `packages/ui/src/index.css`. Creating an independent design guide would introduce duplicate maintenance overhead. Discoverability was improved by explicitly cross-referencing these sources in `docs/frontend-components.md`, `docs/codebase-summary.md`, and `docs/code-standards.md`.

---

## 5. Line Count (LOC) & Size Limits Verification

All 71 maintained Markdown documentation files under `docs/` and root `README.md` strictly comply with size limits (docs target: &le; 800 LOC; root `README.md` &le; 300 LOC).

- **Total Maintained Documentation Files:** 71 files under `docs/` (72 files including root `README.md`).
- **Total Documentation Lines:** 17,917 physical lines across all 71 docs + root `README.md`.
- **Root `README.md`:** 99 physical lines (strictly <300 LOC limit).
- **Largest Documentation File:** `docs/api/git.md` at 760 physical lines (strictly <800 LOC limit).

---

## 6. Heading-Link Defects Resolution Matrix

All 19 baseline warnings from `context-261005-1653-docs-links-before.json` were resolved to canonical descriptive headings:

| # | Referencing Document | Target Link | Resolution Applied |
| ---: | :--- | :--- | :--- |
| 1 | `docs/CHANGELOG-archive.md` | `./frontend-components.md#portspanel` | Pointed to `docs/frontend-components.md#portspanel` which forwards to `terminal-and-ide.md#portspanel`. |
| 2 | `docs/CHANGELOG-archive.md` | `./frontend-components.md#panecontainer` | Pointed to `docs/frontend-components.md#panecontainer` which forwards to `terminal-and-ide.md#panecontainer`. |
| 3 | `docs/CHANGELOG-archive.md` | `./system-architecture.md#backend-state-and-service-composition` | Repointed directly to descriptive heading `#backend-state-and-service-composition` in `docs/system-architecture.md`. |
| 4 | `docs/CHANGELOG-archive.md` | `./api-reference.md#client-side-profile-management` | Repointed to descriptive heading `#client-side-profile-management` in `docs/api-reference.md`. |
| 5 | `docs/CHANGELOG.md` | `./linux-release-publisher-bootstrap.md#v051-release-checklist` | Added anchor `<a id="v051-release-checklist"></a>` at historical incident section in `docs/linux-release-publisher-bootstrap.md`. |
| 6 | `docs/CHANGELOG.md` | `./project-roadmap.md#trusted-plugin-platform-2026-09-22` | Added anchor `<a id="trusted-plugin-platform-2026-09-22"></a>` at retired scope in `docs/project-roadmap.md`. |
| 7 | `docs/CHANGELOG.md` | `./system-architecture.md#multi-profile-ownership-model` | Repointed directly to descriptive heading `#multi-profile-ownership-model` in `docs/system-architecture.md`. |
| 8 | `docs/api-reference.md` | `./api/workspace-settings.md#settings-health` | Added anchor `<a id="settings-health"></a>` in `docs/api/workspace-settings.md`. |
| 9 | `docs/configuration/server-runtime-settings.md` | `../system-architecture.md#codex-otel-usage-analytics` | Added telemetry architecture section with anchor `<a id="codex-otel-usage-analytics"></a>` in `docs/system-architecture.md`. |
| 10 | `docs/configuration-guide.md` | `#manual-smoke-checklist` | Repointed link to `./configuration/server-operations.md#manual-smoke-checklist`. |
| 11 | `docs/configuration-guide.md` | `./linux-release-manager.md#current-service-lifecycle` | Repointed link to descriptive heading `./linux-release-manager.md#current-service-lifecycle`. |
| 12 | `docs/configuration-guide.md` | `./system-architecture.md#cognito-mode` | Repointed link to descriptive anchor `./system-architecture.md#cognito-mode`. |
| 13 | `docs/idle-suspend-status-ui.md` | `./system-architecture.md#server-authoritative-terminal-idle-suspend-architecture` | Added descriptive anchor `<a id="server-authoritative-terminal-idle-suspend-architecture"></a>` in `docs/system-architecture.md`. |
| 14 | `docs/architecture/preferences-settings-and-host-resources.md` | `../system-architecture.md#multi-profile-ownership-model` | Repointed link to descriptive heading in `docs/system-architecture.md`. |
| 15 | `docs/terminal-idle-suspend-security.md` | `./linux-release-manager.md#current-service-lifecycle` | Repointed link to descriptive heading `./linux-release-manager.md#current-service-lifecycle`. |
| 16 | `docs/workflow-api.md` | `./system-architecture.md#workflow-tracking-engine` | Repointed link to descriptive heading `## Workflow Tracking Engine` in `docs/system-architecture.md`. |
| 17 | `docs/workflow-api.md` | `./codebase-summary.md#workflow-tracking` | Added descriptive heading `## Workflow Tracking` in `docs/codebase-summary.md`. |
| 18 | `docs/workflow-api.md` | `./project-overview-pdr.md#workflow-persistence-service-correlation` | Added anchor `<a id="workflow-persistence-service-correlation"></a>` at PR-011–014 in `docs/project-overview-pdr.md`. |
| 19 | `docs/workflow-context-surface.md` | `./system-architecture.md#ui-surfaces-and-settings-topology` | Repointed link to descriptive heading `### UI Surfaces and Settings Topology` in `docs/system-architecture.md`. |

---

## 7. Unresolved Issues & Runtime Qualification Gates

The documentation task was completed cleanly without blocking documentation debt. The following platform and runtime gates represent verified facts of the implementation, not documentation blockers:

1. **Windows Native S13 Qualification:** Windows desktop native SSH port forwarding (`russh`, DPAPI vault, atomic storage leases) is implemented and Linux unit-tested, but real packaged Windows S13 runtime qualification remains a separate qualification gate.
2. **Linux WebKitGTK Child WebView Runtime:** The native browser-debug sidecar on Linux compiles against WebKitGTK 4.1 (`v2_40`), but live headless containerized CI gating remains open.
3. **Host-Resource SSE Deployed Proxy Gating:** The Axum SSE streaming route `/api/system/resources/v1/events` is implemented with bounded admission (32 global, 4 per actor), but deployed proxy buffering, CDN timeouts, and sustained load soak remain operational qualification gates.
4. **Extension Manifest Version Alignment:** `apps/browser-extension/public/manifest.json` specifies `"version": "0.2.0"` while `apps/browser-extension/package.json` specifies `"version": "0.10.2"`. Documented as an observed version check consideration for the 13-file release checklist.
5. **Obsolescence of `scripts/compare-servers.sh`:** The script references the retired Node server package (`packages/server`); it is retained as an obsolete historical artifact without being referenced in active operational runbooks.
