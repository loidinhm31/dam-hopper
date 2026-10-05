# Documentation Reader Report: Core Architecture, Indexing, and Standards

**Date:** 2026-10-05  
**Commit Range Analyzed:** `c1d5a98e0d94400fd1080eb6bba71567780dcbdf` (Refactor/Restructure) through `9e727b4bee3b8634add7d049a247a7d3599f282a` (0.10.2 Release Bump)  
**Target Documents:**
- `docs/system-architecture.md`
- `docs/project-overview-pdr.md`
- `docs/codebase-summary.md`
- `docs/code-standards.md`
- `docs/project-roadmap.md`
- `docs/README.md`
- `docs/api-reference.md`
- `docs/testing.md`
- `docs/windows-release-packaging.md`
- Modular Subdirectories: `docs/api/`, `docs/configuration/`, `docs/frontend-components/`

---

## 1. Modular Indexing Scheme & Structure (Commit c1d5a98e)

Commit `c1d5a98e0d94400fd1080eb6bba71567780dcbdf` (`feat(testing): restructure frontend test runners and add application E2E journeys (#44)`) executed a comprehensive restructuring of the documentation repository:
- **Net Churn:** 37 documentation files touched (-17,460 lines, +5,678 lines).
- **Rule Enforcement (`docs.maxLoc: 800`):** Every monolithic document (>800 lines) was deconstructed into focused modular topic guides under subdirectories.
- **Hub-and-Spoke Indexing Architecture:**
  1. **Top-Level Entry Points:**
     - `docs/README.md` (55 lines): Simplified from 501 lines into a clean roadmap index referencing core documents, development references, 10 feature architecture guides, operations/release manuals, and changelogs.
     - `docs/api-reference.md` (85 lines): Converted from 2,919 lines into an index table pointing to 11 modular topic guides under `docs/api/`. Preserves legacy anchor sections (`#authentication`, `#git-api`, `#ide-file-explorer`, etc.) that redirect readers to the appropriate sub-files.
     - `docs/frontend-components.md` (24 lines): Converted from 825 lines into an index pointing to sub-guides in `docs/frontend-components/`, retaining legacy link anchors.
     - `docs/configuration/server-configuration.md` (27 lines) & `docs/configuration/index.md` (17 lines): Converted from 800+ lines into an index routing to modular server runtime, auth, deployment, operations, and advisor references.
     - `docs/linux-systemd.md`: Modularized by extracting `docs/linux-systemd/idle-suspend-runbook.md` (377 lines).
  2. **Core Architectural Summaries:**
     - `docs/system-architecture.md` (115 lines, down from 5,542): High-density architecture specification detailing runtime components, multi-profile tuple ownership, Git CAS safety, Native Advisor, and Agent Status.
     - `docs/project-overview-pdr.md` (115 lines, down from 2,318): Concise product requirements document covering PR-001 through PR-028, core principles, and pass/fail success measures.
     - `docs/code-standards.md` (97 lines, down from 2,532): Direct engineering rules for Rust backend, React/TypeScript, transport scoping, and security boundaries.
     - `docs/codebase-summary.md` (62 lines, down from 848): Repository breakdown and LOC statistics based on Repomix compaction.
     - `docs/project-roadmap.md` (37 lines, down from 1,119): Delivered milestones vs open platform qualification gates.
  3. **Repository Consolidation:**
     - Retired `CLAUDE.md` into `AGENTS.md`.
     - Pruned 36 expired plan directories (>60 days old) and recorded links in `docs/CHANGELOG-archive.md`.

---

## 2. Key Sections of Each Target Document

### 2.1 `docs/system-architecture.md` (115 lines)
- **Runtime Overview:** Rust Axum/Tokio server + shared React 19 UI mounted in Vite (web) and Tauri 2 (native desktop). Distinct domain ownership in `server/src/` (`api`, `auth`, `config`, `crypto`, `fs`, `git`, `pty`, `workflow`, `advisor`, `agent_status`, `telemetry`, `idle_suspend`, `port_forward`, `tunnel`). Former plugin platform is retired.
- **Multi-Profile Ownership Model:** Tuple-keyed ownership: browser captures `{ profileId, generation }` before issuing asynchronous work; requests, query keys, event subscriptions, and cleanup are owner-bound. Late results from retired generations are fenced. Web and native hosts use a single `QueryClient` with qualified keys; independent selectors for Project target, Settings target, preferences source, and Browser target.
- **Backend State & Service Composition:** `AppState` cloned through Axum state extraction. Mutex locks (`advisor_settings_lock`) are never held across `.await`. Domain persistence uses CAS atomic file replacement.
- **Native Advisor:** Native Rust domain (`server/src/advisor/`), Axum routes (`server/src/api/advisor.rs`), React subtree (`packages/ui/src/advisor/`). Default-off (`[server.advisor].enabled = false`), admin-only, `--no-auth` denied. History read from `$HOME/.evcrate/advisor-history` (real directory required; symlinks rejected). Routing policy atomically updated at `$HOME/.evcrate/advisor-routing.json` via strict SHA-256 CAS.
- **Agent Status:** `AgentStatusRuntime` in-process memory correlation of terminal ID + PTY incarnation. OMP loopback WebSocket collector (5s heartbeat, 15s lease). Codex/Claude hooks over protected Unix domain socket with peer credential verification. Fencing via reporter epochs. Unknown state explicit; silence does not prove success.
- **Git Safety Model:** Porcelain for working tree/index; raw object plumbing for commit message edit and squash. Compare-and-swap ref updates against captured branch/HEAD snapshot. Contiguous oldest-first squash preserving final tree. Active vs inactive branch safety: inactive rewrites touch only target branch ref, verify HEAD did not transition, and leave active checkout/index completely untouched. Fails closed on `checked-out-branch` and `active-operation`. UI parity between `WorkspaceGitPanel` and `GitPage`. Decoupled leased publication (`PublishSnapshot` with expected remote OID).
- **Cognito Mode:** Ephemeral in-app overlay with capture-phase input guard and `inert`/`aria-hidden` boundary. Heavy Blur style: `blur(16px) saturate(180%) rgba(148, 163, 184, 0.12)`.
- **Auth, Privacy & Capabilities:** MFA session auth, exact allowed CORS origins, opaque media tickets, OPAQUE PAKE + AES-256-GCM chunked encrypted uploads over WebSocket. Redacting logger.
- **Idle Suspend & Deployment:** Linux UDS helper with systemd integration; fail-closed execution checks.
- **Qualification Boundary:** Explicit division between unit/integration tests and live qualification gates.

### 2.2 `docs/project-overview-pdr.md` (115 lines)
- **Product Vision:** Multi-profile development workbench operating across one or more servers; explicit ownership via browser profile and connection generation.
- **Core Principles:** 1) Owner-scoped operation; 2) Safe defaults; 3) Conservative semantics; 4) Bounded work and disclosure; 5) Explicit destructive intent.
- **Requirements & Status Matrix:** PR-001 through PR-028:
  - PR-001 to PR-007: TOML registry, PTY lifecycle, Git operations/squash, sandbox files, Agent Store, REST/MFA auth, multi-server workbench.
  - PR-007A to PR-007C: Profile-qualified files/search/Git, native platform scope, integration qualification.
  - PR-008 to PR-021: Logging, host resources, browser debug, workflow, idle suspend, multi-profile UI.
  - PR-022 to PR-025: Trusted plugin platform (**Retired**).
  - PR-026: Agent Status (Linux-qualified for documented OMP/Codex/Claude versions).
  - PR-027: Native Evcrate Advisor (Complete native replacement).
  - PR-028: Cognito Mode in-app privacy mask (Delivered).
- **Acceptance Criteria:** Strict invariants for Profiles, Git safety, Native Advisor, and Agent Status.
- **Pass/Fail Success Measures:** Owner isolation, Git safety, Advisor access, Disclosure control, Qualification claims.
- **Non-Functional Requirements:** Security, Reliability, Performance, Compatibility, Accessibility, Qualification.

### 2.3 `docs/codebase-summary.md` (62 lines)
- **Repository Overview:** ~1,349 code files, ~416,000 LOC.
  - `server/`: 348 files, ~157k LOC.
  - `packages/ui/`: 859 files, ~204k LOC.
  - `apps/native/`: `src-tauri` ~25.8k LOC, `src` ~4.2k LOC.
  - `apps/web/`: Vite single-page browser host.
- **Backend Subsystems:** `api/` (27k), `linux_release/` (20k), `idle_suspend/` (19k), `pty/` (12.6k), `git/` (12k), `agent_status/` (11.4k), `advisor/` (6.5k), `telemetry/` (6.3k), `fs/` (6k), `workflow/` (5.5k), `config/` (5k), `auth/` (1.4k), `port_forward/` (1.2k), `tunnel/` (1k).
- **Shared UI Subsystems:** Components (79k), `lib/` (31k), `api/` (28k), hooks (21k), Advisor (10k), stores (7.4k), contexts (2k).
- **Core Invariants:** Summaries for Multi-profile, Git, Native Advisor, Agent Status, Cognito Mode, Idle Suspend, Encrypted Uploads.
- **Test & Deployment Boundaries:** Notes test locations and scripts.

### 2.4 `docs/code-standards.md` (97 lines)
- **Repository Structure Table:** Maps source folders to responsibilities.
- **Cross-Cutting Rules:**
  - *Ownership & Async:* Always capture `{ profileId, generation }` prior to async work; recheck post-await; fail closed on disconnected owners; bind subscriptions to originating transport; separate project/settings/preferences/browser targets.
  - *Rust Backend:* Axum handlers handle HTTP/auth mapping; owning services enforce invariants; typed `thiserror` enums; explicit limits on sizes/buffers/scans; never hold locks across `.await`; atomic file persistence; redacting logger.
  - *React & TypeScript:* Shared components in `packages/ui/`; single `QueryClient` with owner-qualified TanStack keys; typed API DTO decoders; abortable/cancellable requests; deterministic effect cleanup; explicit error/loading/disconnected states.
- **Domain Invariants:** Git rewrite vs leased push separation; Native Advisor native service/panel with CAS routing and fallback catalogs; Agent Status terminal/incarnation correlation without prompt leaks; Cognito Mode ephemeral overlay with Heavy Blur CSS.
- **Security:** Server-derived actor/roles; exact CORS origins; opaque media tickets; OPAQUE/AES WebSocket encryption; `--no-auth` loopback only.
- **Testing & Delivery:** Small domain units colocated; `server/tests/` and `packages/ui/browser-tests/`; root scripts.

### 2.5 `docs/project-roadmap.md` (37 lines)
- **Recently Delivered:** Native Evcrate Advisor, Git commit rewrite and squash, Cognito Mode, Multi-profile workbench, Agent Status, Idle suspend and diagnostics.
- **Open Qualification & Planning Gates:** Host-resource SSE (deployed proxy, soak, live browser pending); Windows native workbench (S13); Browser child WebView (Linux unverified); Agent provider/platform coverage (Linux qualification only for specific OMP/Codex/Claude versions).
- **Retired Scope:** Plugin platform, runner, SDK, APIs, release assets. Agent Store remains active.

### 2.6 `docs/README.md` (55 lines)
- Core routing index linking to:
  - Start Here (Overview/PDR, Architecture, Codebase Summary, Roadmap).
  - Development References (Code Standards, Testing, Frontend Components, Configuration Guide/Index, API Reference/Auth/Workflow/WebSocket).
  - Feature Architecture Table (10 feature guides: multi-server profiles, native advisor, agent status, git history search, host-resource SSE, files/editor/search/git, terminal continuity, idle suspend, media isolation, cognito preferences).
  - Operations & Release (Linux systemd, release manager, runtime provisioning, Windows packaging, manifest, publisher/bootstrap, nohup, release summary).
  - Change History (Changelog, Changelog-archive).

### 2.7 `docs/api-reference.md` (85 lines)
- Master API routing table pointing to 11 topic documents in `docs/api/`:
  1. `docs/api/authentication.md`
  2. `docs/api/advisor-and-workflow.md`
  3. `docs/api/system-services.md`
  4. `docs/api/idle-suspend.md`
  5. `docs/api/agent-usage-and-sessions.md`
  6. `docs/api/git.md`
  7. `docs/api/transport-and-events.md`
  8. `docs/api/rest-endpoints.md`
  9. `docs/api/filesystem-and-media.md`
  10. `docs/api/workspace-settings.md`
  11. `docs/api/websocket.md`
- Backward-compatibility anchor sections redirecting to the modular files.

### 2.8 `docs/testing.md` (235 lines)
- **Architectural Boundaries & 4 Runner Tiers:**
  1. *Rust Backend Tests (`cargo test`):* Embedded unit tests + `server/tests/` integration tests using real temporary filesystems and Git repos.
  2. *Frontend Unit & Logic Tests (Vitest jsdom):* `packages/ui/src/**/*.test.ts(x)` for reducers, stores, hooks, helpers. Strictly excludes `e2e/**` and `browser-tests/**`.
  3. *Browser Component Regressions (Vitest Browser Mode):* Headless Chromium tests under `packages/ui/browser-tests/**/*.browser.{ts,tsx}` on ports 15173 (components) and 15174 (loopback Axum advisor routing).
  4. *Application E2E Journeys (`@playwright/test` 1.61.1):* User journeys under `packages/ui/e2e/**/*.spec.ts` interacting with built web SPA and production server container.
- **Discovery Invariants:** `.spec.ts` for Playwright E2E; `.browser.tsx` for Vitest component regressions; retirement of legacy `.e2e.tsx`; `tsconfig.e2e.json` typecheck isolation.
- **Isolated Application Services (Phase 02):** Containerized test runtime (`dam-hopper:production-test`) pairing production server and web SPA with isolated MongoDB 8.2; deterministic auth seeding via `application_e2e_seed` binary with V2 signed claims and pre-seeded `localStorage`; `HOME=/e2e/home` containment; strict teardown cleanup guarantees.
- **Application E2E Journeys (Phase 03):** Three active journeys: Privacy Mode Heavy Blur (`privacy-heavy-blur.spec.ts`), Advisor Model Dropdown & Theme (`advisor-model-dropdown-theme.spec.ts`), Counsel Evaluations Responsive Narrow Dock (`counsel-evaluations-responsive.spec.ts`).
- **Visual Evidence Governance (Phase 04):** Full viewport screenshots (1440x900 default, 320px narrow dock); colocated artifacts in `packages/ui/e2e/<case>/` (`screenshot.png`, `evidence.json`, `review.md`); strict rule forbidding image files in `plans/`; unified capture policy (`capture-policy.ts`); staging in `.e2e-staging/<runId>/`; PNG magic header and IHDR dimension validator; atomic publication; mandatory human review governance (`review.md` reset to `PENDING_HUMAN_REVIEW`). Green CI does not certify visual acceptance.
- **CI Quality Gate (Phase 05):** Integrated `application_e2e` job in `.github/workflows/pr-quality-gate.yml`; `scripts/run-all-tests.sh` sequencing; capture-disabled parity guarantee (`CI=true E2E_CAPTURE=0`).
- **Ranked Workflow Gaps:** P1 gaps (Docked/split layouts, multi-profile switching, persistent settings, terminal continuity); P2 gaps (file editing & Git mutations, media sessions & token revocation, native desktop host WebView2).

### 2.9 `docs/windows-release-packaging.md` (241 lines)
- **Direct-Server Windows Asset Contract:** Identified by protected `vX.Y.Z` tag; exactly 2 public assets: `dam-hopper-install.ps1` and `dam-hopper-vX.Y.Z-windows-x86_64.zip`.
- **ZIP Packaging Invariants:** Exactly 4 root-level regular files: `dam-hopper-server.exe`, `dam-hopper.example.toml`, `LICENSE`, `README.md`. Traversal, nested folders, trailing bytes rejected.
- **Combined Publication Union (`--profile all`):** Exactly 6 assets (Linux install script, systemd tarball, manifest v2, spdx sbom + Windows install script, zip).
- **Checker Profiles & Tooling:** `deploy/release/check-release-assets.mjs` with `--profile windows|linux|all`; bounded ZIP parser and PowerShell parser syntax check.
- **PowerShell Bootstrap Installer:** `dam-hopper-install.ps1` non-admin installer downloading exact ZIP from GitHub release, validating SHA-256 and size; installs to `%LOCALAPPDATA%\Programs\dam-hopper`; preserves existing `dam-hopper.toml`; parameters `-Version`, `-Latest`, `-InstallDir`, `-AddToPath`, `-VerifyAttestation`, `-DryRun`.
- **Integration Harness:** `release:windows-installer-test` (14 scenarios in `tests/deploy/windows-release-install.ps1`), `release:windows-gate-test` (23 assertions), and `release:windows-package-twice`.

---

## 3. Modular Subdirectories Deep-Dive

### 3.1 `docs/api/` (11 Domain Documents)
- `advisor-and-workflow.md` (74 lines): Complete endpoint table for `/api/advisor/*` (status, settings, history refresh/summary/page/detail, policy current/patch, models, evaluations list/read/compare).
- `agent-usage-and-sessions.md` (236 lines): `GET /api/agent-status/v1/snapshot`, terminal snapshot schema, Codex usage ingestion, session persistence.
- `authentication.md` (86 lines): Bearer token, HttpOnly cookie, Auth v2 challenge/verification/MFA flow, `--no-auth` development bypass rules.
- `filesystem-and-media.md` (270 lines): `/api/fs/list`, `/read`, `/write`, `/delete`, `/search`; session-bound media capabilities v2, opaque media tickets, encrypted WebSocket upload protocol.
- `git.md` (760 lines): Detailed contracts for worktree targets, branch queries, literal commit-message search (`messageQuery`), commit message rewriting (active and inactive branch CAS), contiguous oldest-first squash, and leased publication (`PublishSnapshot`, expected remote OID).
- `idle-suspend.md` (354 lines): Status route, configuration contracts (snake_case TOML vs camelCase JSON), manual force suspend, helper UDS protocol and events.
- `rest-endpoints.md` (640 lines): Global config (`/api/global-config`), project CRUD, terminal spawn/list/delete, SSH credentials on-demand load (`/api/ssh/keys/load`), leased push publication.
- `system-services.md` (389 lines): Client-side frontend diagnostics ring (`damhopper_diagnostics_frontend_v1`), browser-debug artifacts, native SSH forwarding scopes, host resources monitoring.
- `transport-and-events.md` (157 lines): `Transport` interface (`invoke`, `send`, `on`), reconnection flow, PTY subscription lifecycle, owner-qualified key management.
- `websocket.md` (70 lines): `/ws?token=...`, JSON framing format (`{kind, id, data}`), terminal write/attach/buffer replay contracts.
- `workspace-settings.md` (94 lines): Agent Store (`/api/agent-store/distribution`, `/import`, `/ship`), workspace status/registry, settings TOML import/export, health.

### 3.2 `docs/configuration/` (7 Documents)
- `index.md` (17 lines): Top-level navigation index routing to `configuration-guide.md` and modular server configuration guides.
- `server-configuration.md` (27 lines): Server settings index with legacy section anchors for backward compatibility.
- `server-runtime-settings.md` (203 lines): `[server]` SQLite `session_db_path`, `session_buffer_ttl_hours`, telemetry aggregates (`aggregate_retention_days`).
- `server-environment-auth.md` (146 lines): Global config `~/.config/dam-hopper/config.toml`, environment variables, server signing token, MFA key provisioning.
- `server-deployment.md` (202 lines): Launch modes (`cargo run`, release builds, systemd vs direct execution), CORS/allowed origins, media streaming, host-resource SSE.
- `server-operations.md` (256 lines): SSH key loading, Manual Smoke Checklist, Windows direct-server checklist, troubleshooting and OMP integration.
- `advisor.md` (134 lines): `[server.advisor] enabled = false`, runtime toggle via `PATCH /api/advisor/settings`, account routing policy CAS update, model discovery fallback catalogs.

### 3.3 `docs/frontend-components/` (7 Documents)
- `index.md` (13 lines): Detail index routing to `terminal-and-ide.md`, `platform-integrations.md`, and `workflow-context-surface.md`.
- `workbench.md` (278 lines): Shared shell architecture, Vite/Tauri host reset and single mount, Zustand/TanStack Query/Tailwind v4 libraries, profile connection runtime, Settings page selectors (`preferencesProfileId`, `settingsProfileId`), Native Advisor Workspace panel and routing card.
- `host-and-usage.md` (291 lines): Host resource fleet deck/cards, usage insights, idle suspend status UI, terminal integration.
- `files-and-media.md` (119 lines): Shared file decoration registry (`file-decoration.ts`), Explorer image/video/HTML previews.
- `notifications-and-privacy.md` (138 lines): Cognito Mode overlay and store, agent status notification lifecycle, terminal title ordinals.
- `platform-integrations.md` (85 lines): Session status helpers (`alive`, `restarting`, `crashed`, `exited`), Browser Debug bridge (`@dam-hopper/browser-bridge`), shared embedding contract.
- `terminal-and-ide.md` (736 lines): IntelliJ-inspired tool window system (`ActivityBar`, `ToolPanel`), terminal workspace layout, floating panels, Git panels, Explorer/editor UI.

---

## 4. Stale References, Missing Links, and Areas Needing Update

### 4.1 Stale "Pending / Plan-Only" Frontend Testing Status (Commit c1d5a98e Contradiction)
Commit `c1d5a98e` landed PR #44 (`feat(testing): restructure frontend test runners and add application E2E journeys`), which fully implemented Playwright E2E runners, container fixtures, evidence capture, and CI gates, and updated `docs/testing.md` and `docs/CHANGELOG.md`. However, three core documentation files were left with stale text:
1. **`docs/codebase-summary.md` (line 60):**
   - *Current text:* `"The frontend test-restructuring plan is **pending and plan-only**: Playwright application E2E restructuring is not implemented. See the [roadmap](./project-roadmap.md) for current qualification gaps."`
   - *Issue:* Completely stale. Application E2E is implemented under `packages/ui/e2e/` and running in CI.
   - *Recommended update:* Change to describe the implemented 4-tier runner architecture and reference `docs/testing.md`.
2. **`docs/code-standards.md` (line 92):**
   - *Current text:* `"A frontend app-E2E restructuring proposal is pending and plan-only; keep existing Vitest/component tests and do not imply Playwright application E2E is already the repository-wide test standard."`
   - *Issue:* Playwright application E2E is now implemented and part of the PR quality gate.
   - *Recommended update:* Clarify that Vitest remains the standard for unit and browser component tests, while Playwright is the standard for application E2E journeys.
3. **`docs/project-roadmap.md` (line 17):**
   - *Current text:* Under "Open qualification and planning gates": `"- **Frontend test restructuring:** a plan is pending, but plan-only; no Playwright application-E2E restructuring is implemented or authorized by that plan. Existing Vitest/component coverage remains current."`
   - *Issue:* Stale. Phase 05 of frontend test restructuring is complete.
   - *Recommended update:* Move Frontend test restructuring to "Recently delivered" (as recorded in `docs/CHANGELOG.md`), and note the specific remaining workflow gaps (P1/P2 from `docs/testing.md`) under open qualification gates instead.

### 4.2 Broken Anchors Resulting from Compression in Commit c1d5a98e
Because core documents were compressed from thousands of lines down to ~100 lines, several external and cross-document anchor links are now broken:
1. **`docs/configuration-guide.md` (line 11):**
   - *Link:* `[Manual Smoke Checklist](#manual-smoke-checklist)` (internal anchor).
   - *Issue:* The checklist was moved to `docs/configuration/server-operations.md`.
   - *Fix:* Update link to `[Manual Smoke Checklist](./configuration/server-operations.md#manual-smoke-checklist)`.
2. **`docs/configuration-guide.md` (line 512) and `docs/terminal-idle-suspend-security.md` (line 21):**
   - *Link:* `[Linux Release Manager](./linux-release-manager.md#helper-service-lifecycle-production-cli-phase-03)`.
   - *Issue:* That heading in `linux-release-manager.md` is named `## Current service lifecycle`.
   - *Fix:* Update anchor to `#current-service-lifecycle`.
3. **`docs/configuration-guide.md` (line 697):**
   - *Link:* `[System Architecture](./system-architecture.md#cognito-privacy-mode-2026-10-02)`.
   - *Issue:* Heading in `system-architecture.md` is `## Cognito Mode`.
   - *Fix:* Update anchor to `#cognito-mode`.
4. **`docs/configuration/server-runtime-settings.md` (line 83):**
   - *Link:* `[telemetry architecture notes](../system-architecture.md#codex-otel-usage-analytics)`.
   - *Issue:* Section `#codex-otel-usage-analytics` was removed during compression.
   - *Fix:* Link to `../system-architecture.md#code-boundaries` or `../api/agent-usage-and-sessions.md`.
5. **`docs/idle-suspend-status-ui.md` (line 12):**
   - *Link:* `system-architecture.md#server-authoritative-terminal-idle-suspend-architecture`.
   - *Issue:* Heading was compressed to `## Idle suspend and deployment`.
   - *Fix:* Update anchor to `#idle-suspend-and-deployment`.
6. **`docs/phase-06-preferences-settings-usage-and-host.md` (line 16):**
   - *Link:* `system-architecture.md#fleet-deck-drilldown-popover-phase-03-2026-09-20`.
   - *Issue:* Heading removed during compression.
   - *Fix:* Update link to `./frontend-components/host-and-usage.md`.
7. **`docs/workflow-api.md` (lines 8, 12, 16):**
   - *Links:* `system-architecture.md#workflow-phases-0103-service-rest-and-lifecycle-correlation`, `codebase-summary.md#workflow-tracking`, `project-overview-pdr.md#pr-013-terminal-lifecycle-correlation-and-agent-adapter-phase-03`.
   - *Issue:* Headings collapsed in all three target documents.
   - *Fix:* Update links to target the top-level files or PR table in `project-overview-pdr.md`.
8. **`docs/workflow-context-surface.md` (line 16):**
   - *Link:* `system-architecture.md#workflow-context-surface-ui-phase-05`.
   - *Issue:* Heading removed during compression.
   - *Fix:* Update link to `system-architecture.md#code-boundaries`.

### 4.3 Subsequent Commits Impact (Post c1d5a98e through 0.10.2)
1. **Commit `aa35a91e` (`feat(ui): collapse all settings page sections by default (#45)`):**
   - Changed `SettingsPage.tsx` so all section accordions are collapsed by default upon navigation.
   - Documentation in `docs/frontend-components/workbench.md` and `docs/configuration-guide.md` does not mention that sections start collapsed, which is relevant for UI automation and operator workflows.
2. **Commit `b1f0419c` (`fix(tunnel): isolate quick tunnel config from host files and enforce single-authority exit lifecycle (#46)`):**
   - Isolated quick tunnel configuration from host files and established a single-authority process exit lifecycle in `server/src/tunnel/`.
   - Neither `docs/api/system-services.md` nor `docs/system-architecture.md` reflect the isolated temporary file policy or single-authority lifecycle for tunnels.
3. **Commit `6f756b1b` (`feat(git): enable inactive branch commit message editing and squash with leased publication (#47)`):**
   - Successfully updated `system-architecture.md`, `codebase-summary.md`, `api/git.md`, `frontend-components/terminal-and-ide.md`, `frontend-components/workbench.md`, and `CHANGELOG.md`.
   - *Minor gap:* `docs/project-roadmap.md` and `docs/project-overview-pdr.md` PR-003 row still describe Git rewrites generically without calling out the inactive local branch capability or Radix context menu accessibility improvements.
4. **Commit `9e727b4b` (`chore(release): bump version to 0.10.2`):**
   - Version bumped across 13 repository files to `0.10.2`.
   - `docs/CHANGELOG.md` has entries dated `2026-10-05` for PRs #44, #45, #46, and #47, but lacks an explicit `[0.10.2]` release tag/heading.

---

## 5. Unresolved Questions

1. Should the remaining P1/P2 application E2E workflow gaps cataloged in `docs/testing.md` (multi-profile switching, docked/split layouts, persistent settings tabs, terminal continuity) be explicitly added to `docs/project-roadmap.md` under open qualification gates?
2. Should legacy phase-specific guides (e.g. `docs/workflow-api.md`, `docs/workflow-context-surface.md`, `docs/phase-06-preferences-settings-usage-and-host.md`) be updated to remove old deep-anchor links into `system-architecture.md`, or should stable HTML anchor tags (`<a id="...">`) be added back into `system-architecture.md` for backward compatibility?
3. Should `docs/CHANGELOG.md` be updated with explicit version headings (e.g., `## [0.10.2] - 2026-10-05`) rather than date-only headings (`# 2026-10-05`)?
