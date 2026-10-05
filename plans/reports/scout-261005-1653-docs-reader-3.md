# Documentation Scout Report: Core Protocols, Operations, Phases, and Frontend Components

**Date:** 2026-10-05  
**Author:** Scout Agent (Docs Reader 3)  
**Deliverable:** `plans/reports/scout-261005-1653-docs-reader-3.md`  
**Environment:** Linux x64 | pnpm monorepo | dam-hopper  
**Scope:**
- 9 Primary Target Documents (2,422 LOC):
  - `docs/ws-protocol-guide.md`
  - `docs/worktree-operation.md`
  - `docs/user-guide-multi-server-profiles.md`
  - `docs/workflow-context-surface.md`
  - `docs/deployment-guide.md`
  - `docs/phase-04-terminal-continuity-workflow-navigation.md`
  - `docs/phase-07-media-isolation-and-encryption.md`
  - `docs/codebase-summary-release.md`
  - `docs/README.md`
- 7 Recursive Nested Documents under `docs/frontend-components/` (1,660 LOC):
  - `docs/frontend-components/index.md`
  - `docs/frontend-components/files-and-media.md`
  - `docs/frontend-components/host-and-usage.md`
  - `docs/frontend-components/notifications-and-privacy.md`
  - `docs/frontend-components/platform-integrations.md`
  - `docs/frontend-components/terminal-and-ide.md`
  - `docs/frontend-components/workbench.md`
- Cross-cutting audits: `docs/api/`, `docs/architecture/`, `docs/configuration/` duplicate/stale ownership, heading anchor integrity, retired plugin disposition, and purpose-based replacement paths for all `phase-*.md` files.

---

## 1. Executive Summary

A comprehensive documentation audit was executed across 16 documents (4,082 LOC total) spanning WebSocket transports, Git worktree operations, multi-profile runtimes, UI surface specifications, deployment pipelines, legacy phase references, and component architectures.

### Key Critical Findings:
1. **Critical Stale Configuration (`DAM_HOPPER_PLUGIN_ADMINS_FILE`):**
   `docs/configuration/server-environment-auth.md` lines 47-50 still documents `DAM_HOPPER_PLUGIN_ADMINS_FILE` in the active environment variables table and describes the runner reading it, directly contradicting the complete retirement of the trusted plugin platform on 2026-10-02 (Phases 06–08). Furthermore, `docs/user-guide-multi-server-profiles.md` still cites "plugin management" under Settings and describes EVCrate Advisor as a "plugin" (`evcrate.advisor`) rather than a native service.
2. **Duplicate & Stale Ownership Between `docs/` and Subdirectories:**
   - **Authentication:** `docs/authentication-api.md` (249 LOC) and `docs/api/authentication.md` (86 LOC) both define auth contracts; the latter is a partial stub pointing to the former and to historical plans.
   - **Frontend Components:** `docs/frontend-components.md` (48 LOC) and `docs/frontend-components/index.md` (13 LOC) duplicate the top-level index role.
   - **Workflow API:** `docs/workflow-api.md` (188 LOC) and `docs/api/advisor-and-workflow.md` (172 LOC) share overlapping coverage of `/api/workflow/*`.
3. **Broken / Inconsistent Heading Anchors:**
   - `docs/workflow-context-surface.md:83` references `[System Architecture](./system-architecture.md#workflow-context-surface-ui-phase-05)` — the anchor `#workflow-context-surface-ui-phase-05` does not exist in `docs/system-architecture.md`.
   - `docs/ws-protocol-guide.md:29` references `[API reference](./api-reference.md#project-worktree-targets-phases-17)`. The target heading in `docs/api-reference.md:39` is `## Project Worktree Targets (Phases 1–7)` using a Unicode en-dash (`\u2013`), resulting in broken anchors on standard Markdown slugifiers.
4. **WebSocket Protocol Gaps in Documentation:**
   `docs/ws-protocol-guide.md` omits several implemented wire messages: filesystem mutating operations (`fs:op` / `fs:op_result`), unencrypted binary chunk upload (`fs:upload_begin`, `fs:upload_chunk`, `fs:upload_commit`, `fs:upload_result`), inbound `worktree_path` qualifiers, push events (`tunnel:*`, `port:*`, `host:alertsInvalidated`), and `auth:session_remove`.
5. **Phase-Named File Proliferation:**
   Seven `phase-*.md` files remain in root `docs/`. These documents contain essential ongoing architectural rules (tuple-keyed terminal ownership, media session v2 cookies, encryption contexts, multi-profile target filtering) obscured behind historical project phase designations.

---

## 2. Primary Target Documents (9 Files)

### 2.1 `docs/ws-protocol-guide.md` (618 LOC)
- **Purpose:** Authoritative reference for real-time bidirectional WebSocket message framing (`kind`-tagged JSON) on `/ws`, covering terminal I/O, scrollback replay, shell lifecycle, filesystem operations, OPAQUE PAKE auth, encrypted uploads, and semantic agent status streaming.
- **Key Sections:**
  - `Message Format` & `Retired plugin epoch protocol`: `{ "kind": "command:action", ...payload }`.
  - `Project target context` & `Current terminal REST transport`: Target-scoped terminal creation via `POST /api/terminal`.
  - `Client→Server Messages`: Terminal attach/replay (`terminal:attach`), FS subscriptions (`fs:subscribe_tree`), FS range reads (`fs:read`), FS write streaming with OCC (`fs:write_begin`, `fs:write_chunk`), OPAQUE PAKE registration/login, encrypted put (`fs:put_*`).
  - `Server→Client Messages`: `terminal:output` (with byte `offset` and PTY `incarnation`), `terminal:buffer`, `terminal:lifecycle` (OSC 633 validation), `terminal:exit`, `terminal:target-unavailable`, `terminal:agentStatusChanged`/`Removed`/`Invalidated`, `fs:tree_snapshot`, `fs:event`, `fs:read_result`, `fs:write_ack`/`result`.
  - `Implementation Notes`: Session lease rechecks, watcher close codes (`4403`, `4401`, `1013`, `4001`).
- **Internal Links & Dependencies:**
  - `./architecture/plugin-platform-d03.md` (retired architecture reference)
  - `./api-reference.md#retired-plugin-api-anchors`
  - `./api-reference.md#project-worktree-targets-phases-17` (broken anchor issue due to en-dash)
  - `./architecture/agent-status.md`
  - `./api-reference.md`
- **Suspicious / Outdated Claims (Unverified / Stale):**
  - Line 617: *"Inbound dispatch/commit checks the local session lease/ deadline, not MongoDB per frame; the watcher covers persisted revocation."* While memory-lease checking is correct, the mention of MongoDB should clarify that this applies only when the MongoDB auth driver is active; DamHopper also supports SQLite/dev auth.
  - Omission of `fs:op` (`create_file`, `create_dir`, `rename`, `delete`, `move`) and outbound `fs:op_result` [UNVERIFIED in doc, present in Rust server ws protocol].
  - Omission of unencrypted upload messages: `fs:upload_begin`, `fs:upload_chunk`, `fs:upload_commit`, `fs:upload_result`.
  - Omission of optional `worktree_path` fields across all inbound filesystem messages (`fs:subscribe_tree`, `fs:read`, `fs:write_begin`, `fs:op`, `fs:upload_begin`, `fs:put_begin`, `fs:put_save`).
  - Omission of push notifications for tunnels (`tunnel:created`, `tunnel:ready`, `tunnel:failed`, `tunnel:stopped`), ports (`port:discovered`, `port:lost`), and host alert lag (`host:alertsInvalidated`).
  - Omission of `auth:session_remove`.
- **Recommended Disposition:** **KEEP & UPDATE**. Move or link to `docs/api/websocket.md`. Add the missing FS mutating ops, plain upload streaming, tunnel/port push events, and `worktree_path` qualifiers.

---

### 2.2 `docs/worktree-operation.md` (421 LOC)
- **Purpose:** End-to-end operational and user guide for Git worktrees within DamHopper: repository configuration, worktree creation (CLI and UI), session-scoped target selection, development, branch synchronization, maintenance, and safe deletion guards.
- **Key Sections:**
  - 1. Worktree model (shared ODB, independent working trees)
  - 2. Configure DamHopper once (`dam-hopper.toml` single repository registration)
  - 3. Inspect repository (`git worktree list --porcelain`)
  - 4. Create worktree (new branch, existing local, remote tracking)
  - 5. Prepare worktree (`pnpm install`, server startup)
  - 6. Add worktree from UI (Project panel workflow)
  - 7. Select active worktree (session-scoped UI target, server validation)
  - 8. Work on branch
  - 9. Push or merge completed work (PR workflow vs local ff-merge)
  - 10. Optional maintenance (list, lock, move, repair)
  - 11. Safe removal (dirty editor tab & live terminal blocking guards, Git removal, branch deletion)
  - 12. DamHopper API actions (`GET/POST/DELETE /api/git/{project}/worktrees`, `POST /api/git/{project}/worktrees/prune`)
  - 13. Troubleshooting
  - 14. Completion checklist
- **Internal Links & Dependencies:**
  - Config reference `dam-hopper.toml`
  - REST endpoints `/api/git/{project}/worktrees*`
- **Suspicious / Outdated Claims (Unverified / Stale):**
  - Section 1 layout and Section 3 bash paths use hardcoded developer environment paths (`/mnt/data/ws/sharing/dam-hopper` and `/home/loidinh/WS/dam-hopper-ws/...`). These should be generalized to standard documentation placeholders (e.g. `/srv/repos/my-project`).
- **Recommended Disposition:** **KEEP & UPDATE**. High-value operational guide. Clean up developer-specific paths; preserve all safety guards, ODB sharing rules, and API specifications. Propose placing in `docs/operations/git-worktrees.md` or retaining as `docs/worktree-operation.md`.

---

### 2.3 `docs/user-guide-multi-server-profiles.md` (369 LOC)
- **Purpose:** Comprehensive user guide and architectural overview of the unified multi-server profile workbench. Documents concurrent profile connections, endpoint policies, qualified resource addressing (`{ profileId, project, worktreePath }`), federated search, Windows native SSH scopes, integration qualification, persistence schemas, and host resource SSE delivery.
- **Key Sections:**
  - Overview: Unified workbench, origin security (Windows/Web cross-origin; non-Windows exact same-origin), `workbenchProtocol: 2` requirement.
  - Create or migrate profile: `migrateToProfiles()`, `localStorage` keys, Basic/None auth, auto-connect.
  - Connect profiles: Status matrix (`Disconnected`, `Connecting`, `Connected`, `Login required`, `Offline`, `Unsupported`).
  - Navigate from profile to project: Qualified `{ profileId, project }` switcher.
  - Phase 03: Files, editor, search, and Git (Monaco model scoping, dirty tab isolation, federated search up to 500 results, SSH retry).
  - Phase 08: Native forwarding scopes (Windows desktop `NativeScopeRef`, per-profile SSH workers).
  - Phase 09: Integration and qualification (S01–S12 web gate qualified; S13 Windows native blocked).
  - Persistence and security: Storage table (`damhopper_server_profiles`, `damhopper_profile_auth_v2_<profileId>`, `damhopper_active_profile_id`, `dam-hopper:workspace-state`).
  - Page endpoint resolution: Workspace, Git, Settings, Workspace Advisor, Agent Store, Usage.
  - Host resources and health delivery: Independent per-profile streams, 7 delivery modes, privileged sleep actions.
  - Developer reference: `ServerProfile` interface and `connections.ts` exports.
- **Internal Links & Dependencies:**
  - `./phase-07-media-isolation-and-encryption.md`
  - `./phase-03-files-editor-search-git.md`
  - `./phase-05-agents-ports-and-browser.md`
  - `./phase-08-native-scope-concurrency.md`
  - `../plans/260916-2137-unified-profile/phase-09-integration-and-qualification.md`
  - `../plans/260916-2137-unified-profile/verification-matrix.md`
  - `../packages/ui/src/api/server-config.ts`
  - `../packages/ui/src/api/connections.ts`
  - `./api-reference.md`
  - `./system-architecture.md`
- **Suspicious / Outdated Claims (Unverified / Stale):**
  - Line 275: Lists *"plugin management"* under Settings target server scope (`settingsProfileId`). Plugin management was retired on 2026-10-02.
  - Line 276: Describes Workspace Advisor as *"The EVCrate Advisor plugin (`evcrate.advisor`)"* with standalone `/plugins/:installationId` routing removed. It is now a native server domain and UI component, not a plugin.
  - Phase-named headings (Phase 03, Phase 08, Phase 09) date back to September 2026 unified-profile plans.
- **Recommended Disposition:** **KEEP & UPDATE**. Primary user guide for the multi-server workbench. Update stale plugin references in Section "Page endpoint resolution"; update links to point to purpose-based paths rather than `phase-*.md` files.

---

### 2.4 `docs/workflow-context-surface.md` (283 LOC)
- **Purpose:** Technical UI specification for `@dam-hopper/ui`'s `WorkflowContextSurface`, detailing the ambient ribbon, desktop deck, compact sheet, selected-item inline editing, note management, TanStack Query integration, keyboard shortcuts, and shell placement across IDE, Terminal, and Mobile shells.
- **Key Sections:**
  - Surface and callback flow: Overview query, target/item selection, Deck vs Sheet responsive presentation.
  - Selected-item notes: Whitespace-aware rendering, CAS deletion via `DELETE /api/workflow/notes/{id}` using `note.updatedAt`.
  - Selected-item editing: Inline `WorkflowSelectedItemEditForm` (title/summary editing with trim, blank title guard, CAS update via `usePatchWorkflowItem`).
  - State, errors, and authority: React Query memory state, `['workflow']` query invalidation, no URL/localStorage workflow state.
  - Workflow Context Surface (Phases 05–06): Module responsibility table (16 components/hooks), WorkspacePage and shell integration (`IdeShell`, `TerminalWorkspaceShell`, `MobileWorkspaceShell`), Data and state flow, Ambient ribbon (`WorkflowContextRibbon`), Desktop deck (`WorkflowContextDeck`), Mobile sheet (`WorkflowContextSheet`), Items/capture/sessions, Focus and action safety (`Mod+Shift+KeyW`), Verification and current qualification.
- **Internal Links & Dependencies:**
  - `./workflow-api.md`
  - `./workflow-client-state.md`
  - `./frontend-components/index.md`
  - `./system-architecture.md#workflow-context-surface-ui-phase-05` (BROKEN ANCHOR: does not exist in `system-architecture.md`)
  - Internal anchors `#selected-item-notes`, `#selected-item-editing`
- **Suspicious / Outdated Claims (Unverified / Stale):**
  - Duplicate structural narrative: Lines 1-67 provide an introductory specification, while lines 68-283 restart with "Workflow Context Surface (Phases 05–06)" and duplicate component responsibility summaries.
  - Broken anchor: `[System Architecture](./system-architecture.md#workflow-context-surface-ui-phase-05)` points to a nonexistent heading in `docs/system-architecture.md`.
  - Historical test assertion counts from dated Phase 05/06 reports (e.g. 62/62 focused UI tests, 1,493 tests).
- **Recommended Disposition:** **CONSOLIDATE & MOVE**. Move to `docs/frontend-components/workflow-surface.md` (or merge into `docs/frontend-components/workbench.md`). Fix the broken system architecture anchor and remove duplicate introductory text.

---

### 2.5 `docs/deployment-guide.md` (246 LOC)
- **Purpose:** Central installation and deployment guide covering four deployment topologies: Linux release candidate with systemd manager (`dam-hopper-install.sh`), Windows direct console server (`dam-hopper-install.ps1`), source build (`pnpm` + `cargo`), and local development loopback (`--no-auth`).
- **Key Sections:**
  - Deployment Topologies overview table.
  - 1. Linux Release Installer: Prerequisites, `dam-hopper-install.sh` download, release candidate staging, status inspection, production environment & MFA key configuration (`/etc/dam-hopper/server.env`, `DAM_HOPPER_MFA_KEY_FILE`), service activation (`dam-hopper start`), rollback and recovery.
  - 2. Windows Release Installer: Non-admin invariants, PowerShell one-liner, parameter reference, launching server, upgrading.
  - 3. Build from Source: Node 20+, pnpm 10+, Rust 1.97.1+, build commands.
  - 4. Local Development & Loopback Mode (`--no-auth`): Loopback constraint (`127.0.0.1`), feature gates (Advisor, Host Actions, and Idle Suspend disabled in `--no-auth`), mutual exclusivity with MongoDB.
  - 5. Related Documentation.
- **Internal Links & Dependencies:**
  - `./linux-systemd.md`
  - `./windows-release-packaging.md`
  - `./configuration/index.md`
  - `./authentication-api.md` (duplicate ownership with `docs/api/authentication.md`)
- **Suspicious / Outdated Claims (Unverified / Stale):**
  - Lines 68, 77, 80: Mentions production authenticated mode requiring MongoDB (`MONGODB_URI=mongodb://127.0.0.1:27017`, `MONGODB_DATABASE=damHopper`). While MongoDB is an implemented backend for enterprise multi-user/TOTP auth, the server also operates with local configuration and SQLite sessions; this distinction should be explicitly stated so operators do not assume MongoDB is mandatory for all deployments.
- **Recommended Disposition:** **KEEP & UPDATE**. Central operations document. Update the authentication reference link to `docs/api/authentication.md`. Preserve all strict security guidelines (mode 0600 keys, `--no-auth` loopback-only, non-admin Windows invariants).

---

### 2.6 `docs/phase-04-terminal-continuity-workflow-navigation.md` (195 LOC)
- **Purpose:** Implementation specification for durable terminal identity and continuity across the multi-profile workbench: tuple-based resource keys (`[profileId, id]`), xterm keep-alive registry (`TerminalKeepAliveHost`), PTY incarnation fencing, browser continuity schemas (`terminal-layout:v3`, `terminal-pins:v2`, `command-history:v3`), workflow terminal links, notification navigation, and owner-directed diagnostics export.
- **Key Sections:**
  - 1. Identity and ownership (durable `TerminalRef`, canonical `[profileId, id]` JSON encoding, `terminal-registry.ts` imperative registry, `TerminalKeepAliveHost`, PTY incarnation fencing).
  - 2. Owner-bound transport and API routing (`useTerminalManager({ profileId })`, bound API clients, generation retirement).
  - 3. Browser-local continuity schemas:
    - 3.1 `terminal-layout:v3` (`dam-hopper:terminal-layout:v3:<encodeURIComponent([profileId, groupId])>`, payload version 2 binary tree).
    - 3.2 `terminal-pins:v2` (`sessionStorage`, payload version 2).
    - 3.3 `command-history:v3` (salted with `profileId`, server-validated lifecycle submissions).
  - 4. Workflow links and owner-directed navigation (SQLite history, fail-closed target/session reveal).
  - 5. Notifications and diagnostics (owner-directed export, redacting logs, terminal tail limits).
  - 6. Fresh-state and lifecycle boundaries (`performFreshStateReset()`).
  - 7. Source map and status.
  - 8. Unresolved questions (background notification profile switching, mutable registry map export).
- **Internal Links & Dependencies:**
  - `../plans/reports/code-review-260917-1321-phase-04-terminals-and-workflow.md`
- **Suspicious / Outdated Claims (Unverified / Stale):**
  - Status header: *"DONE — 2026-09-17"*.
  - Historical plan framing: Framed as "Phase 04 implementation reference" instead of permanent terminal continuity architecture.
- **Recommended Disposition & Purpose-Based Replacement Path:**
  - **Proposed Replacement Path:** `docs/architecture/terminal-continuity-and-ownership.md`.
  - **Action:** Move from `docs/phase-04-terminal-continuity-workflow-navigation.md` to `docs/architecture/terminal-continuity-and-ownership.md`. Strip dated phase headers and review links; retain all durable key definitions, keepalive architecture, schema specifications, and diagnostics export rules.

---

### 2.7 `docs/phase-07-media-isolation-and-encryption.md` (130 LOC)
- **Purpose:** Technical contract and operational specification for media session isolation (media session v2, UUIDv4 `mediaClientId`, ticket capabilities, session cookies, fail-closed stream authorization, `RemoteCleanupHandle`) and client-side encryption context (OPAQUE PAKE, project-qualified key `<profileId>@<generation>:<project>`, in-memory AES-256-GCM keys).
- **Key Sections:**
  - Purpose and invariants (fail-closed, actor-bound, cookie namespacing).
  - Media session v2 wire contract:
    - Client identifier and cookie namespace (`damhopper-media-session-<uuidv4>`, `HttpOnly; SameSite=Lax; Path=/api/fs`).
    - Endpoints: `POST/DELETE /api/fs/image/tickets`, `POST/DELETE /api/fs/video/tickets`, `DELETE /api/fs/media-session`, `GET/HEAD /api/fs/{image,video}/stream/{ticket}`.
    - Authorization, freshness, and revocation: 5-step stream authorization pipeline, 30m idle / 8h absolute bounds.
  - Remote cleanup lifecycle: `RemoteCleanupHandle` (best-effort, 5-second deadline, deduplicated abort controller).
  - Owned encryption context:
    - Project-qualified state: `<profileId>@<generation>:<project>`.
    - Prompt queue & OPAQUE identifiers: `enc-<prefix>-<12hex>`.
    - One transport and freshness fences: single `WsTransport` capture, zeroing key material on fence failure.
  - Source map and verification.
- **Internal Links & Dependencies:**
  - `../plans/260916-2137-unified-profile/phase-07-media-isolation-and-encryption.md`
  - `./api-reference.md`
  - `./system-architecture.md`
  - `./code-standards.md`
- **Suspicious / Outdated Claims (Unverified / Stale):**
  - Historical phase framing: *"Status: DONE (100%, 2026-09-17)"*.
- **Recommended Disposition & Purpose-Based Replacement Path:**
  - **Proposed Replacement Path:** `docs/architecture/media-isolation-and-encryption.md`.
  - **Action:** Move from `docs/phase-07-media-isolation-and-encryption.md` to `docs/architecture/media-isolation-and-encryption.md`. Preserve all cryptographic contracts, cookie namespaces, and lifecycle handle definitions.

---

### 2.8 `docs/codebase-summary-release.md` (112 LOC)
- **Purpose:** Summary of release architecture and deployment subsystems split from the main codebase summary: Linux release manager (`server/src/linux_release/`), historical plugin-runner retirement notice, Windows direct-server release packaging (`dam-hopper-install.ps1`, zip), Release CI DAG (`release-linux.yml`), and historical runtime boundaries (Phases 00–03 from 2026-09-14).
- **Key Sections:**
  - Linux release and deployment (manifest validation, role projection, unit staging, root-owned helper).
  - Retired plugin-runner packaging (Historical notice regarding removal of runner, bundled Node, and v0.5.0 incident).
  - Phase 01–02 Windows direct-server release and installer (`dam-hopper-install.ps1`, 6-asset union).
  - Phase 03 cross-platform Release CI and guidance (`release-linux.yml`, `attest-release`, `publish-release`).
  - Historical runtime boundaries (Phases 00–03, 2026-09-14): merge boundary, API runtime-state (`/var/lib/dam-hopper/dam-hopper.toml`, `renameat2`), systemd unit policy, preflight SQLite holder checks.
- **Internal Links & Dependencies:**
  - `./linux-release-manifest.md`
  - `./windows-release-packaging.md`
  - `./linux-release-runtime-provisioning.md`
- **Suspicious / Outdated Claims (Unverified / Stale):**
  - Historical phase sections (Phase 00 merge boundary, Phase 01 runtime-state boundary, Phase 02 systemd unit/policy boundary, Phase 03 preflight) document runtime boundaries implemented on 2026-09-14. These are historical implementation snapshots rather than active architectural overviews.
- **Recommended Disposition:** **CONSOLIDATE & UPDATE**. Consolidate the permanent release architecture content into `docs/deployment-guide.md` or move into `docs/architecture/release-and-deployment.md`. Archive the dated Phase 00–03 2026-09-14 milestones.

---

### 2.9 `docs/README.md` (48 LOC)
- **Purpose:** Root documentation index and navigation portal to product requirements, system architecture, API references, configuration guides, feature architecture, operations, and changelogs.
- **Key Sections:**
  - Start here (deployment, project overview, system architecture, codebase summary, roadmap).
  - Development references (code standards, testing, frontend components, configuration, APIs).
  - Feature architecture and guides table (multi-server profiles, native advisor, agent status, git history search, host-resource SSE, files/editor, terminal continuity, idle suspend, media isolation, cognito preferences).
  - Operations and release (Linux systemd, manager, runtime provisioning, deployment guide, Windows packaging, publisher bootstrap, nohup recovery).
  - Change history (current changelog, archived changelog, plugin platform retirement notice).
- **Internal Links & Dependencies:**
  - Links to 26 different doc paths across `docs/` and `docs/architecture/`.
  - Links directly to four `phase-*.md` files: `phase-03-files-editor-search-git.md`, `phase-04-terminal-continuity-workflow-navigation.md`, `phase-07-media-isolation-and-encryption.md`, and `phase-06-preferences-settings-usage-and-host.md`.
  - Links to `docs/frontend-components.md` (which overlaps with `docs/frontend-components/index.md`).
- **Suspicious / Outdated Claims (Unverified / Stale):**
  - Still indexes several phase-named files in the "Feature architecture and guides" table.
- **Recommended Disposition:** **KEEP & UPDATE**. Update table links once `phase-*.md` files are relocated to their purpose-based architectural paths. Update frontend component link to point to `docs/frontend-components/index.md`.

---

## 3. Nested Documents: `docs/frontend-components/` (7 Files)

### 3.1 `docs/frontend-components/index.md` (13 LOC)
- **Purpose:** Navigation index for component detail pages.
- **Key Sections:** Contents (Terminal and IDE components, Platform integrations, Workflow Context Surface); Quick Start.
- **Internal Links & Dependencies:**
  - `../frontend-components.md`
  - `./terminal-and-ide.md`
  - `./platform-integrations.md`
  - `../workflow-context-surface.md`
- **Duplicate / Stale Ownership:** Overlaps with root `docs/frontend-components.md`.
- **Recommended Disposition:** **KEEP & EXPAND**. Serve as the canonical index for all frontend component docs; absorb the contents of `docs/frontend-components.md`.

---

### 3.2 `docs/frontend-components/files-and-media.md` (119 LOC)
- **Purpose:** Specification for shared file decorations, native image preview, native video preview/download, and sandboxed HTML preview in the IDE Explorer and Editor tabs.
- **Key Sections:**
  - Shared File Decorations (`packages/ui/src/lib/file-decoration.ts`): File icon/badge/language lookup precedence.
  - Explorer Image Preview (`ImagePreview.tsx`): Native `<img>` rendering with credentialed probe, `crossOrigin="use-credentials"`, `RemoteCleanupHandle`.
  - Explorer Video Preview and Direct Download (`VideoPreview.tsx`, `start-video-download.ts`): Separate playback vs download ticket lifecycle.
  - Explorer HTML Preview (`HtmlHost.tsx`, `HtmlPreview.tsx`): Sandboxed iframe (`sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"`, opaque `"null"` origin), in-memory storage shim, in-frame visual alert modal, 5 MiB size cutoff, view mode persistence (`dam-hopper:html-view-mode:v1`).
- **Internal Links & Dependencies:**
  - `../frontend-components.md`
- **Suspicious / Outdated Claims (Unverified / Stale):** None; aligns with live React components and media ticket architecture.
- **Recommended Disposition:** **KEEP**. Up-to-date component reference.

---

### 3.3 `docs/frontend-components/host-and-usage.md` (291 LOC)
- **Purpose:** Architecture and component reference for host resource monitoring (Fleet Deck, Popover, Diagnoses, Alerts), terminal idle-suspend status, error boundaries, usage insights, and terminal commit chips.
- **Key Sections:**
  - Unified-profile integration and qualification (Phase 09): S01–S12 web gate qualified, Windows S13 blocked.
  - Host-resource fleet deck and cards (`HostResourceFleetDeck.tsx`, `HostResourceFleetCard.tsx`): Scan-first cards, sample age calculation, profile inspection callback.
  - Host-resource alert presentation (`HostResourcePopover.tsx`, `HostResourceDiagnosis.tsx`): Snapshot freshness, battery/power rendering, maximum severity resolution.
  - Terminal idle-suspend status (`HostIdleSuspendStatus.tsx`): Coordinator state, countdown timer, heuristic notice, manual force sleep.
  - Error Boundary and stale lazy-chunk recovery (`ErrorBoundary.tsx`): Automatic reload for stale chunks via `dam-hopper:stale-chunk-reload-attempted`.
  - Explorer-local transport errors: Isolated error boundaries per surface/target.
  - Usage Insights Settings & Session Audit (`SettingsUsageInsightsSection.tsx`, `UsagePage.tsx`): Local capture toggling, Codex export status, HMAC session identities.
  - Latest Commit in Terminal & Traditional Terminal Projects: Branch/commit chip, project grouping rail (220–520px).
- **Internal Links & Dependencies:**
  - `../frontend-components.md`
  - `../../scripts/qualify-phase09-workbench.mjs`
  - `../../plans/260916-2137-unified-profile/verification-matrix.md`
  - `../idle-suspend-status-ui.md`
  - `../../plans/reports/qa-260911-1107-phase07-integrated-qualification.md`
- **Suspicious / Outdated Claims (Unverified / Stale):**
  - Section "Unified-profile integration and qualification (Phase 09)" contains historical phase qualification narrative that belongs in a qualification report rather than permanent component docs.
- **Recommended Disposition:** **KEEP & UPDATE**. Retain component specifications; remove historical phase qualification narrative and plan links.

---

### 3.4 `docs/frontend-components/notifications-and-privacy.md` (138 LOC)
- **Purpose:** Architecture and interaction contracts for Cognito Privacy Mode, semantic agent notifications, and project-relative terminal title ordinals.
- **Key Sections:**
  - Cognito Privacy Mode (`CognitoModeOverlay.tsx`, `useCognitoModeInputGuard.ts`): Memory-only activation, capture-phase event blocking (pointer, mouse, touch, keyboard, IME, composition), full viewport blur/black overlay (`z-index: 10000`), dismissal strictly via matching activation chord, terminal toast viewport kept above (`z-index: 10001`).
  - Terminal Agent Notifications (`AgentStatusBridge.tsx`, `TerminalNotificationCenter.tsx`): Profile-scoped subscriptions, fencing by server epoch and terminal incarnation, OMP turn-ended and needs-attention alerts, Claude needs-attention only, suppression of Codex alerts, elimination of Codex OSC 9 parsing.
  - Terminal Title Ordinals: Ephemeral 1-based project sequence (`Project #1`, `Project #2`), separate from global `openTabs` order.
- **Internal Links & Dependencies:**
  - `../frontend-components.md`
- **Suspicious / Outdated Claims (Unverified / Stale):** None; accurately reflects current privacy guard and agent status notification implementation.
- **Recommended Disposition:** **KEEP**. High-value privacy and security reference.

---

### 3.5 `docs/frontend-components/platform-integrations.md` (85 LOC)
- **Purpose:** Shared host embedding contracts, session status helpers, and cooperative Browser Debug bridge integration.
- **Key Sections:**
  - Session Status Helpers (`SessionStatus` type: `alive`, `restarting`, `crashed`, `exited`).
  - Cooperative Browser Debug Bridge (`@dam-hopper/browser-bridge`): Framed target communication, nonce generation, unpackaged extension workflow, exact parent origin filtering (`VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS`), sanitized element pickers.
  - Shared design-system and embedding contract: Provider ordering (`AppZoom` → `Encrypt` → `AndroidChromeInputPolicy` → `Router`), OPAQUE prompt queuing, Radix UI wrappers, JetBrains Mono font.
- **Internal Links & Dependencies:**
  - `../frontend-components.md`
  - `../system-architecture.md`
  - `../configuration-guide.md`
  - `../native-browser-debug-support.md`
  - `../phase-07-media-isolation-and-encryption.md`
- **Suspicious / Outdated Claims (Unverified / Stale):**
  - Links to `../phase-07-media-isolation-and-encryption.md` which should point to `docs/architecture/media-isolation-and-encryption.md`.
- **Recommended Disposition:** **KEEP & UPDATE**. Retain host and bridge contracts; update cross-links.

---

### 3.6 `docs/frontend-components/terminal-and-ide.md` (736 LOC)
- **Purpose:** Primary component and interaction specification for the IntelliJ-style IDE Tool Window system, workspace shells (IDE, Terminal, Mobile), Browser Debug tooling, native SSH forwarding host, xterm.js integration, touch scrolling, inline terminal suggestions, terminal docking, Git panels, and file tree synchronization.
- **Key Sections:**
  - IDE Tool Window System: `ActivityBar`, `ToolPanel`, `IdeShell`, bottom panel maximize toggle (`resolveBottomPanelLayout`).
  - Workspace Mode Shell: `WorkspacePage`, `localStorage` key `dam-hopper:workspace-mode`, shortcuts (`Mod+Shift+Backquote`, `Mod+Shift+KeyG`, `KeyZ`, `KeyP`, `KeyM`), `MobileWorkspaceShell` compact surface selector.
  - Terminal Workspace Shell & Overlays: Floating overlay panels for Files, Git, Project, Ports, Fleet.
  - Browser Debug Tool: Singleton `BrowserDebugKeepAliveHost`, extension download, custom/responsive viewports.
  - Native SSH forwarding host (Phase 08): `NativeScopeRef`, per-profile forwarding scopes.
  - Multi Terminal Display & Floating Controls: `MobileTerminalAccessoryBar`, on-screen terminal keys, custom 60% and minimized touch keyboards, touch gesture containment (`terminal-touch-scroll.ts`).
  - TerminalPanel & Reconnect: xterm.js v6 integration, replay gate, PTY incarnation scoping, WebGL resource handling.
  - Inline terminal suggestions: Server OSC 633 validation, ghost suffix rendering, `Alt+Right` / `Alt+Shift+Right` shortcuts, `command-history.ts` v3.
  - Terminal Docking: dnd-kit docking zones, layout tree persistence (`terminal-layout:v3`), pins (`terminal-pins:v2`).
  - Git Workspace Panel: `GitBranchControl`, `GitLogTree`, `GitLocalChanges`, `WorkspaceGitPanel`, root selection, consecutive-commit squash, leased publication.
  - Project Info Panel & Worktree target lifecycle: target selection, blocker checks before removal, dirty tab and active session protection.
  - FileTree & Monaco: Persistent open folder state (`dam-hopper:explorer-tree-state`), Monaco viewState persistence (`dam-hopper:editor-state`), language scan filter.
- **Internal Links & Dependencies:**
  - `../frontend-components.md`
  - `../phase-03-files-editor-search-git.md`
- **Suspicious / Outdated Claims (Unverified / Stale):**
  - Line 677: Links to `../phase-03-files-editor-search-git.md`.
  - References Phase 04 / Phase 08 headings internally.
- **Recommended Disposition:** **KEEP & UPDATE**. The foundational reference for the entire IDE/terminal UI. Update historical phase links.

---

### 3.7 `docs/frontend-components/workbench.md` (278 LOC)
- **Purpose:** Architecture specification for shared React 19 shell initialization, unified profile connection runtimes, profile-owned MFA authentication UI, shared Git history/squash controller, multi-profile Settings/Usage/Host ownership, and Native Evcrate Advisor workspace integration.
- **Key Sections:**
  - Overview: Host division (`apps/web`, `apps/native`, `packages/ui`), tech stack (React 19, Vite, Zustand, TanStack Query, Tailwind v4, xterm.js).
  - Unified shell and profile navigation: Independent profile runtimes, `ProjectSwitcher`, `fresh-state-reset.ts`.
  - Profile-owned enrollment and MFA UI: `MfaChallengeForm`, QR setup, Base32 key copy, Android Chrome input policy bypass (`data-auth-input`).
  - Shared Git-history view: `useGitHistoryView`, message search, consecutive-commit squash (`GitSquashDialog`), leased publication.
  - Unified-profile Settings, Usage, and Host ownership: Tri-selection ownership (`preferencesProfileId`, `settingsProfileId`), 7 host-resource SSE delivery modes.
  - Native Advisor Workspace host and provider: `WorkspaceAdvisorHost.tsx`, `AdvisorPanel.tsx`, `NativeAdvisorProvider`, inline policy editor (`PolicySummaryCard.tsx`) with route fieldsets and CAS updates (`PATCH /api/advisor/policy`).
- **Internal Links & Dependencies:**
  - `../frontend-components.md`
  - `../authentication-api.md`
  - `../../plans/260926-2157-token-rotation-mfa/phase-04-profile-mfa-flow.md`
  - `./index.md`
  - `../architecture/git-history-search.md`
  - `../../plans/261001-2003-git-history-search-persistence/phase-04-shared-history-view.md`
  - `../../plans/261001-2003-git-history-search-persistence/phase-07-qualification-documentation.md`
  - `../architecture/host-resource-sse.md`
  - `../../plans/260929-1522-host-resources-sse/phase-04-resource-query-and-ui-cutover.md`
  - `../phase-06-preferences-settings-usage-and-host.md`
- **Suspicious / Outdated Claims (Unverified / Stale):**
  - Section headings carry historical phase numbers (Phase 02, Phase 04, Phase 06, Phase 04/05).
  - Numerous links point to dead or historical plans in `plans/`.
- **Recommended Disposition:** **KEEP & UPDATE**. Clean up plan links; update cross-links to point to canonical architecture docs.

---

## 4. Cross-Directory Audit: Duplicate & Stale Ownership

| Domain | Files Involved | Nature of Conflict | Recommended Resolution |
| --- | --- | --- | --- |
| **Authentication API** | `docs/authentication-api.md` (249 LOC)<br/>`docs/api/authentication.md` (86 LOC) | Duplicate specification. `docs/api/authentication.md` is a partial stub that defers to `docs/authentication-api.md` and links to obsolete plan paths. | Consolidate `docs/authentication-api.md` into `docs/api/authentication.md`. Keep all API specs under `docs/api/`. |
| **Frontend Components Index** | `docs/frontend-components.md` (48 LOC)<br/>`docs/frontend-components/index.md` (13 LOC) | Redundant top-level indexes. Both act as navigation gateways to child docs. | Retain `docs/frontend-components/index.md` as canonical. Turn `docs/frontend-components.md` into a clean redirect/forwarding stub. |
| **Workflow API** | `docs/workflow-api.md` (188 LOC)<br/>`docs/api/advisor-and-workflow.md` (172 LOC) | Overlapping API contracts. Both document `/api/workflow/*` endpoints. | Consolidate workflow endpoint contracts into `docs/api/workflow.md` (or keep in `docs/api/advisor-and-workflow.md`). Retain `docs/workflow-api.md` as server engine/persistence guide. |
| **Plugin Configuration (CRITICAL)** | `docs/configuration/server-environment-auth.md` (lines 47-50, 108-146) | **STALE CONFIG:** Lines 47-50 document `DAM_HOPPER_PLUGIN_ADMINS_FILE` as an active environment variable for the plugin runner. Lower down (line 108), it is labeled historical. The plugin platform was deleted on 2026-10-02. | **PURGE:** Remove `DAM_HOPPER_PLUGIN_ADMINS_FILE` from active environment variables table immediately. Move lines 108-146 to retired archive or mark explicitly as dead. |
| **Multi-Profile Settings & Advisor** | `docs/user-guide-multi-server-profiles.md` (lines 275-276) | Stale text referencing "plugin management" in Settings and calling EVCrate Advisor "the EVCrate Advisor plugin (`evcrate.advisor`)". | Update text to reflect native Advisor and remove "plugin management" from Settings scope. |

---

## 5. Heading Anchor Integrity Audit

The following anchor defects were identified across the surveyed documents:

1. **Broken Cross-Document Anchor:**
   - **Source:** `docs/workflow-context-surface.md:83`
   - **Link:** `[System Architecture](./system-architecture.md#workflow-context-surface-ui-phase-05)`
   - **Target File:** `docs/system-architecture.md`
   - **Problem:** Anchor `#workflow-context-surface-ui-phase-05` **does not exist** anywhere in `docs/system-architecture.md`.
   - **Fix:** Update link to point to `docs/system-architecture.md` or a valid heading such as `#ui-and-client-state`.

2. **Inconsistent Unicode Punctuation Slug (En-Dash vs Hyphen):**
   - **Source:** `docs/ws-protocol-guide.md:29`
   - **Link:** `[API reference](./api-reference.md#project-worktree-targets-phases-17)`
   - **Target File:** `docs/api-reference.md:39`
   - **Target Heading:** `## Project Worktree Targets (Phases 1–7)`
   - **Problem:** The heading in `docs/api-reference.md` contains an en-dash (`\u2013`, `–`), not an ASCII hyphen (`-`). In GitHub Flavored Markdown slug generation, en-dashes are stripped (yielding `#project-worktree-targets-phases-17`), but in other CommonMark/VitePress/Astro tools, they convert to hyphens or break.
   - **Fix:** Standardize heading in `docs/api-reference.md:39` to use an ASCII hyphen (`## Project Worktree Targets (Phases 1-7)`) and update link to `#project-worktree-targets-phases-1-7`.

---

## 6. Purpose-Based Replacement Paths for `phase-*.md` Files

The repository contains 7 `phase-*.md` files in root `docs/`. These documents describe permanent system architecture rather than transient milestones. The following purpose-based paths are proposed:

| Current File | Purpose Summary | Proposed Purpose-Based Path |
| --- | --- | --- |
| `docs/phase-01-auth-state-cryptography-and-policy.md` | Backend auth state models, AES-256-GCM TOTP secret encryption, deterministic session-policy engine, and MongoDB CAS operations. | `docs/architecture/auth-state-cryptography-and-policy.md` |
| `docs/phase-03-files-editor-search-git.md` | Multi-profile IDE workbench resources: target qualification (`ProjectTargetRef`), Monaco tabs, FS ops, federated search, and Git isolation. | `docs/architecture/multi-profile-ide-resources.md` |
| `docs/phase-04-terminal-continuity-workflow-navigation.md` | Terminal continuity, tuple-keyed ownership `[profileId, id]`, xterm keepalive registry, incarnation fences, layout/pin/history schemas. | `docs/architecture/terminal-continuity-and-ownership.md` |
| `docs/phase-05-agents-ports-and-browser.md` | Multi-profile Agent Store catalogs, port/tunnel aggregation, Browser Debug target trust, terminal handoff, and artifact creation fences. | `docs/architecture/agent-store-ports-and-browser-debug.md` |
| `docs/phase-06-preferences-settings-usage-and-host.md` | Tri-selection ownership (`preferencesProfileId`, `settingsProfileId`, `browserTargetProfileId`), Cognito privacy mode, and host resources. | `docs/architecture/preferences-settings-and-host-resources.md` |
| `docs/phase-07-media-isolation-and-encryption.md` | Media session v2 (`mediaClientId` UUIDv4, namespaced cookies, fail-closed stream auth, `RemoteCleanupHandle`) and client-side encryption context. | `docs/architecture/media-isolation-and-encryption.md` |
| `docs/phase-08-native-scope-concurrency.md` | Windows desktop native SSH forwarding scopes (`NativeScopeRef`, concurrent scope lifecycles, DPAPI credentials, and S13 gates). | `docs/architecture/native-ssh-forwarding-scopes.md` |

*Migration Note:* When moving these files, strip the transient `Status: DONE (date)` headers and plan/review links; preserve all technical schemas, security invariants, and code locations.

---

## 7. Disposition of Retired Plugin Documentation

The trusted plugin platform (runner daemon, JSON-RPC IPC over Unix socket, iframe sandbox, plugin admin API) was completely retired on 2026-10-02 (Phases 06–08). Historical plugin files currently clutter active documentation directories.

### Proposed Dispositions:

1. **Move to Historical Archive Directory (`docs/archive/plugins/`):**
   - `docs/plugin-platform-linux.md` $\rightarrow$ `docs/archive/plugins/plugin-platform-linux.md`
   - `docs/plugin-platform-d00.md` $\rightarrow$ `docs/archive/plugins/plugin-platform-d00.md`
   - `docs/architecture/plugin-platform-d01.md` $\rightarrow$ `docs/archive/plugins/plugin-platform-d01.md`
   - `docs/architecture/plugin-platform-d02.md` $\rightarrow$ `docs/archive/plugins/plugin-platform-d02.md`
   - `docs/architecture/plugin-platform-d03.md` $\rightarrow$ `docs/archive/plugins/plugin-platform-d03.md`
   - `docs/architecture/plugin-platform-d05.md` $\rightarrow$ `docs/archive/plugins/plugin-platform-d05.md`
2. **Update Redirects / Retain Tombstones:**
   - Keep entries in `docs/api-reference.md#retired-plugin-api-anchors` pointing to `docs/archive/plugins/`.
3. **Clean Active Configuration:**
   - Purge `DAM_HOPPER_PLUGIN_ADMINS_FILE` from `docs/configuration/server-environment-auth.md` active variables table.
   - Clean "plugin management" text in `docs/user-guide-multi-server-profiles.md`.

---

## 8. Summary Disposition Table for Surveyed Documents

| File | LOC | Category | Primary Action | Target Path / Destination |
| --- | ---:| --- | --- | --- |
| `docs/ws-protocol-guide.md` | 618 | Transport | **KEEP & UPDATE** | `docs/api/websocket.md` or `docs/ws-protocol-guide.md` (add missing FS ops/upload/tunnel events) |
| `docs/worktree-operation.md` | 421 | Operations | **KEEP & UPDATE** | `docs/worktree-operation.md` (generalize developer paths) |
| `docs/user-guide-multi-server-profiles.md` | 369 | User Guide | **KEEP & UPDATE** | `docs/user-guide-multi-server-profiles.md` (clean plugin mentions) |
| `docs/workflow-context-surface.md` | 283 | UI Surface | **MOVE & CONSOLIDATE** | `docs/frontend-components/workflow-surface.md` (fix broken anchor) |
| `docs/deployment-guide.md` | 246 | Operations | **KEEP & UPDATE** | `docs/deployment-guide.md` (clarify MongoDB vs SQLite/dev auth) |
| `docs/phase-04-terminal-continuity-workflow-navigation.md` | 195 | Architecture | **MOVE & RENAME** | `docs/architecture/terminal-continuity-and-ownership.md` |
| `docs/phase-07-media-isolation-and-encryption.md` | 130 | Architecture | **MOVE & RENAME** | `docs/architecture/media-isolation-and-encryption.md` |
| `docs/codebase-summary-release.md` | 112 | Deployment | **CONSOLIDATE** | Merge into `docs/deployment-guide.md` or `docs/architecture/release-and-deployment.md` |
| `docs/README.md` | 48 | Navigation | **KEEP & UPDATE** | `docs/README.md` (update links to purpose-based paths) |
| `docs/frontend-components/index.md` | 13 | UI Index | **KEEP & EXPAND** | `docs/frontend-components/index.md` (canonical UI index) |
| `docs/frontend-components/files-and-media.md` | 119 | UI Component | **KEEP** | `docs/frontend-components/files-and-media.md` |
| `docs/frontend-components/host-and-usage.md` | 291 | UI Component | **KEEP & UPDATE** | `docs/frontend-components/host-and-usage.md` (trim phase qualification) |
| `docs/frontend-components/notifications-and-privacy.md` | 138 | UI Component | **KEEP** | `docs/frontend-components/notifications-and-privacy.md` |
| `docs/frontend-components/platform-integrations.md` | 85 | UI Component | **KEEP & UPDATE** | `docs/frontend-components/platform-integrations.md` (update cross-links) |
| `docs/frontend-components/terminal-and-ide.md` | 736 | UI Component | **KEEP & UPDATE** | `docs/frontend-components/terminal-and-ide.md` (update phase links) |
| `docs/frontend-components/workbench.md` | 278 | UI Component | **KEEP & UPDATE** | `docs/frontend-components/workbench.md` (clean dead plan links) |

---

## 9. Unresolved Questions

1. Should `docs/authentication-api.md` (in root `docs/`) be fully subsumed into `docs/api/authentication.md`, or should `docs/api/` contain only route summaries while `docs/authentication-api.md` remains the deep cryptographic reference?
2. For the 6 retired plugin documents, should they be individually moved to `docs/archive/plugins/` or merged into a single consolidated historical document `docs/archive/plugins/retired-plugin-platform.md`?
3. Should the historical phase boundaries in `docs/codebase-summary-release.md` (Phases 00–03 from 2026-09-14) be preserved in an archive file or completely deleted since those boundaries are now codified in `server/src/linux_release/`?
