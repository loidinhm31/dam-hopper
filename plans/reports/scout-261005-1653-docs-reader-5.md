# Scout Report: Documentation Audit & Restructure Analysis (Batch 5)

**Report Identifier:** `plans/reports/scout-261005-1653-docs-reader-5.md`  
**Date:** 2026-10-05  
**Working Directory:** `/home/loidinh/WS/dam-hopper`  
**Environment:** Linux x64 (Fedora 44, kernel 7.1.10), 16 CPUs, 13.7 GiB available RAM, pnpm monorepo  
**Target Group LOC:** 2,384 lines across 8 primary target files + 696 lines across 3 assigned nested files  

---

## 1. Executive Summary & Key Findings

This audit analyzes 8 primary documentation files (2,384 LOC) plus 3 assigned nested documents (696 LOC) covering system architecture, project requirements, terminal idle suspend, Linux systemd operations, Windows release packaging, PTY activity observation, workflow client state, host-resource SSE streaming, and server authentication configuration.

### Key Architectural & Documentation Findings
1. **Critical Stale Active Configuration Defect (`docs/configuration/server-environment-auth.md`):**
   `DAM_HOPPER_PLUGIN_ADMINS_FILE` is still documented in the active Environment Variables table and accompanying prose as an active configuration parameter read by the plugin runner. Because the plugin runner, plugin platform, and runner management RPC were completely retired on 2026-10-02 during the Native Advisor cutover, presenting this as active configuration violates the repository source of truth. It must be purged from active tables and marked historical.
2. **Broken Internal Heading Anchors:**
   The documentation-wide link validator checks file existence but misses heading anchor targets. A critical broken anchor was identified:
   - `docs/terminal-idle-suspend-security.md:317` links to `./linux-release-manager.md#helper-service-lifecycle-production-cli-phase-03`. The target file lacks this heading; the actual heading is `## Current service lifecycle` (`#current-service-lifecycle`).
   - In `docs/linux-systemd.md`, Section 10 is followed by `## Terminal Idle Suspend Runbook` (missing section number `11.`), followed by `## 12. Operator Runbook: Native Advisor Migration & Plugin Platform Retirement`.
3. **Historical Phase-Named Documentation Bloat (`phase-*.md`):**
   Seven files in `docs/` (`phase-01`, `phase-03`, `phase-04`, `phase-05`, `phase-06`, `phase-07`, `phase-08`) remain named after historical execution phases from September 2026 rather than permanent subsystems. They contain foundational architecture (auth policy, multi-profile IDE, terminal ownership, Agent Store, settings/preferences, media encryption, desktop SSH forwarding) and should be migrated to purpose-based paths.
4. **Retired Plugin Platform Documentation Footprint:**
   Six documents in `docs/` and `docs/architecture/` (`plugin-platform-d00.md`, `plugin-platform-linux.md`, `architecture/plugin-platform-d01.md`, `d02.md`, `d03.md`, `d05.md`) describe the retired plugin platform. While they carry historical retirement banners, they pollute active documentation roots. They should be relocated to a unified `docs/archive/plugin-platform/` hierarchy.
5. **Duplicate / Stale Child Document Ownership:**
   - `docs/frontend-components/index.md` is an incomplete sub-index that lists only 3 surfaces (`terminal-and-ide.md`, `platform-integrations.md`, `../workflow-context-surface.md`), omitting `workbench.md`, `host-and-usage.md`, `notifications-and-privacy.md`, and `files-and-media.md`, while duplicating the root `docs/frontend-components.md`.
   - `docs/configuration/index.md` creates a confusing three-tier hierarchy alongside `docs/configuration-guide.md` and `docs/configuration/server-configuration.md`.
   - `docs/api/rest-endpoints.md` duplicates endpoint definitions documented in domain-specific API files (`api/git.md`, `api/filesystem-and-media.md`, `api/advisor-and-workflow.md`).

---

## 2. Per-File Detailed Audit

### 2.1 `docs/terminal-idle-suspend-security.md` (589 LOC)
- **Purpose**: Canonical security invariants, threat analysis, mitigations, audit retention/path policies, privileged helper enrollment, logind inhibitor handling, release manager staging/lifecycle integration, verification bounds, and operational approval gates for Linux terminal idle suspend (both `empty-fleet` and `agent-activity` policies, and manual force-suspend).
- **Key Sections**:
  - `Security Invariants`: 6 non-negotiable rules (Startup ownership, No unrestricted sudo/shell, Dedicated narrow action & timing authority, No-auth mode rejection, Fail-closed by default, Descriptor-relative runtime state).
  - `Threat Analysis and Mitigations`: Matrix of 8 critical/high threats (Arbitrary command escalation, config tampering, workspace switch hijack, timing bounds abuse, audit log tampering, fleet race condition, CSRF, ambiguous manual POST).
  - `Audit Retention and Path Policy`: Server JSONL at `/var/lib/dam-hopper/idle-suspend-audit.jsonl` (mode `0600`, `O_NOFOLLOW`), semantic event writer at `/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl`, helper audit v2 at `/var/log/dam-hopper/idle-suspend-helper.jsonl` (mode `0600`, 10k record pruning).
  - `Phase 01–08 Chronological Milestones`: Execution-domain safeguards (`wakeAfterSeconds: 0`), systemd PID enrollment (`PIDFile=/run/dam-hopper/server.pid`, `SO_PEERCRED`), PTY activity observation (`ProcessIdentity`), process discovery (`LinuxProcSource`, bounds), TCP observation (`NETLINK_SOCK_DIAG`), manual force-suspend (`POST /api/system/idle-suspend/v1/force-suspend`), protected status (`Cache-Control: no-store`, max 32 PIDs), and diagnostics CLI (`dam-hopper diagnose --json`).
  - `Unresolved questions`: Operational canary gates (exclusive `rtc0`, `SOCK_DIAG` in sandbox, sample latency, production host/maintenance window).
- **Internal Links & Dependencies**:
  - Links to: `./pty-activity-observation.md`, `./agent-activity-process-discovery.md`, `./tcp-activity-observation.md`, `./agent-activity-automatic-admission.md`, `./idle-suspend-status-ui.md`.
  - Link to `./linux-release-manager.md#helper-service-lifecycle-production-cli-phase-03`: **BROKEN ANCHOR**. Heading in target file is `## Current service lifecycle` (`#current-service-lifecycle`).
  - Plan reports referenced: `../plans/reports/tester-260910-0732-phase-04-boundary-verification.md` and `reviewer-260910-0733-phase-04-verification-boundary.md`.
- **Suspicious Outdated Claims (unverified)**:
  - Document is structured chronologically as a sequence of phase completions ("Phase 01 status (2026-09-06)", "Phase 02 status", "Production CLI Phase 03", etc.) rather than a cohesive domain architecture.
  - [UNVERIFIED] Test counts in text ("102/102 tests total", "323 backend/PTY/API/integration tests", "16/16 Chromium tests", "14/14 boundary checks").
  - References `/etc/dam-hopper/dam-hopper.toml` as a legacy copy-once fallback.
- **Recommended Disposition**: **KEEP and REFACTOR**.
  - Must preserve all operational/security invariants, threat matrix, path policies, and canary requirements without dilution.
  - Reorganize phase-based historical sections into structural domains: (1) Execution & RTC Invariants, (2) Process & TCP Observation Seams, (3) Privileged Helper Sandboxing & Peer Verification, (4) Audit Logging & Diagnostic Redaction, (5) Canary Protocols.
  - Fix broken anchor to `./linux-release-manager.md`.

---

### 2.2 `docs/linux-systemd.md` (564 LOC)
- **Purpose**: Authoritative operator and deployment guide for DamHopper running under Linux systemd (Manifest v2, manager state v3). Covers platform requirements, release artifacts, service roles (`server`, `web`, `both`), filesystem permissions and hierarchy, install/upgrade/activate/rollback workflows, health probe gates, format-2 legacy migration, production diagnostics bundle capture, and plugin platform removal runbook.
- **Key Sections**:
  - `1. Supported Platform and System Requirements`: x86_64, glibc >= 2.39, systemd >= 245.
  - `2. Release Artifacts and Trust Chain`: 4 immutable tag assets (`dam-hopper-install.sh`, `.tar.gz`, `release-manifest.json`, `.spdx.json`).
  - `3. Host Architecture and Service Roles`: Unit table (`dam-hopper-recovery.service`, `dam-hopper-idle-suspend-helper.service`, `dam-hopper-api.service`, `dam-hopper-web.service`); Agent Store OMP/Codex file access permissions.
  - `4. Filesystem Hierarchy and Permissions`: `/opt/dam-hopper/releases/`, `/var/lib/dam-hopper-manager/`, `/var/lib/dam-hopper/`, `/etc/dam-hopper/`, `/run/lock/dam-hopper/deploy.lock`.
  - `5. Operator Installation and Lifecycle Workflow`: Staging via `dam-hopper-install.sh`, activation via `sudo dam-hopper start`, upgrading, changing roles.
  - `6. Health Probes and Runtime Configuration`: API (`0.0.0.0:4801`), Web (`0.0.0.0:4802`), Web runtime configuration.
  - `7. Rollback, Crash Recovery, and Boot Ordering`: 20s startup deadline, 20 consecutive 500ms probes, automatic rollback, manual rollback, boot recovery unit.
  - `8. Format-2 Legacy Migration`: `renameat2(RENAME_EXCHANGE)` atomic swap.
  - `9. Troubleshooting and Diagnostics`: `dam-hopper status --json`, `dam-hopper diagnose --json`, journalctl, common failure resolutions.
  - `10. Retired Checkout-Runner Commands and Obsolete Paths`: Deprecation of `deploy/run-linux-production.sh`.
  - `Terminal Idle Suspend Runbook`: (Unnumbered heading) Links to `./linux-systemd/idle-suspend-runbook.md`.
  - `12. Operator Runbook: Native Advisor Migration & Plugin Platform Retirement`: 5-step removal procedure using `deploy/remove-plugin-platform.sh`.
- **Internal Links & Dependencies**:
  - Links to: `./linux-release-publisher-bootstrap.md`, `./architecture/agent-status.md#agent-store-path-verification` (valid anchor), `./linux-systemd/idle-suspend-runbook.md`, `./linux-release-manager.md#production-diagnostics-phase-06` (valid anchor), `./authentication-api.md`.
- **Suspicious Outdated Claims (unverified)**:
  - Heading numbering defect: Section 10 is followed by `## Terminal Idle Suspend Runbook` (lacking number 11), followed by `## 12. Operator Runbook...`.
  - Section 12 represents a one-time migration runbook for nodes upgrading across the 2026-10-02 cutover; once completed across fleets, it is decommission history.
  - [UNVERIFIED] Example version strings `v0.1.0` and `v0.2.0` in examples.
- **Recommended Disposition**: **KEEP and UPDATE**.
  - Fix heading numbering (`## 11. Terminal Idle Suspend Runbook`).
  - Retain Section 12 as a dedicated decommission reference or move to `docs/archive/plugin-platform/`.
  - Core production guide: keep at `docs/linux-systemd.md`.

---

### 2.3 `docs/plugin-platform-d00.md` (290 LOC)
- **Purpose**: Historical candidate contract for the former DamHopper trusted plugin platform (Phase D00). Freezes cross-repository candidate specifications for `@dam-hopper/plugin-sdk`, manifest-v1, runner JSON-RPC protocol v1 framing, opaque UI `srcdoc` iframe bridge, and worker cancellation.
- **Key Sections**:
  - `Historical Banner`: Explicitly notes platform retirement on 2026-10-02.
  - `Scope and boundary`: Trusted backend plugin execution, resource boundaries.
  - `Candidate artifact map`: SDK package, manifest schema, runner schema, worker schema, UI schema, fixtures, Rust mirror.
  - `Manifest-v1`: Package identity, SemVer, capability lists, backend/UI entrypoints, file inventory with SHA-256.
  - `Runner framing and JSON-RPC`: 4-byte BE length prefix + JSON-RPC 2.0; method namespaces (`runner.*`, `plugin.*`, `context.*`, `management.*`).
  - `Opaque UI bridge`: `host.bootstrap`, `frame.ready`, `frame.portAck`, `request`, `cancel`, `response`, `context.revoked`.
  - `Worker cancellation and escalation`: `WorkerCancellationTracker`, cooperative settlement vs supervisor process termination.
  - `Candidate resource budgets`: Ceilings for frames, payloads, memory, timeouts.
- **Internal Links & Dependencies**:
  - Links to: `./system-architecture.md`, `./code-standards.md`, `./architecture/plugin-platform-d01.md`, `./architecture/plugin-platform-d02.md`, and plan files in `../plans/260920-1603-plugin-platform/`.
- **Suspicious Outdated Claims (unverified)**:
  - Entire document describes a retired platform. Code paths (`packages/plugin-sdk`, `server/src/plugins`) have been removed from the repository.
- **Recommended Disposition**: **ARCHIVE / MOVE**.
  - Move to `docs/archive/plugin-platform/d00-contracts.md`.
  - Retain historical banner and content for design provenance; remove from active root index.

---

### 2.4 `docs/pty-activity-observation.md` (262 LOC)
- **Purpose**: Canonical implementation guide for the private Linux PTY evidence seam used by terminal idle-suspend configured-agent activity detection. Documents identity tracking, `/proc/<pid>/stat` parsing, monotonic atomic output sequence counters, input admission gates, bounded snapshot creation, and private watch invalidation.
- **Key Sections**:
  - `Source map`: `server/src/pty/{activity, session, manager, mod, tests}.rs`.
  - `Observation flow`: Spawn/respawn -> probe start_ticks -> counter on `LiveSession` -> reader increment -> input admission -> snapshot capture.
  - `Process and terminal identity`: `ProcessIdentity { pid, start_ticks }`, `TerminalIdentity { session_id, incarnation }`, `RootQualification { Qualified, Uncertain, Unavailable }`. Safe parenthesis parsing in `parse_proc_stat`.
  - `Raw PTY output evidence`: `Arc<AtomicU64>` `raw_output_sequence`, incremented per nonempty read, sequence semantics, `u64::MAX` saturation.
  - `Input admission`: `PtySessionManager::write(id, data)` gates, rollback on write error, handoff rejection (`AppError::IdleSuspendHandoffInProgress`).
  - `PtyActivitySnapshot`: Content-free, bounded to 256 live roots, explicit `incomplete_reason` (`RootUnqualified`, `CounterSaturated`, `RevisionSaturated`, `ScanLimitExceeded`).
  - `PtyActivityWatcher`: Coalescing `tokio::sync::watch::Receiver<u64>` private invalidation seam.
  - `Privacy and failure rules`: Private server-side evidence, zero content leakage, fail-closed.
- **Internal Links & Dependencies**:
  - Links to: `./agent-activity-process-discovery.md`, `./tcp-activity-observation.md`, `./agent-activity-automatic-admission.md`.
- **Suspicious Outdated Claims (unverified)**:
  - Forward-looking phrasing: "Phase 03 consumes...", "Phase 04 consumes...", "Phase 05 combines...". All those phases are now implemented and operational.
  - Status header: "Phase 02 implemented 2026-09-11".
- **Recommended Disposition**: **KEEP and UPDATE**.
  - High architectural and operational value. Keep technical content intact.
  - Update forward-looking phase references to descriptive subsystem references (e.g., "The configured-agent process discovery engine consumes this root seam...").
  - Can remain in `docs/` or move to `docs/architecture/pty-activity-observation.md`.

---

### 2.5 `docs/windows-release-packaging.md` (241 LOC)
- **Purpose**: Defines the packaging, asset checking, reproducibility, Release CI workflow, and PowerShell bootstrap installer (`dam-hopper-install.ps1`) for the direct-server Windows release profile.
- **Key Sections**:
  - `Asset contract`: Exact two public assets (`dam-hopper-install.ps1`, `dam-hopper-vX.Y.Z-windows-x86_64.zip`); exact four root files (`dam-hopper-server.exe`, `dam-hopper.example.toml`, `LICENSE`, `README.md`). Exact six-asset union with Linux profile.
  - `Asset checker profiles`: `deploy/release/check-release-assets.mjs --profile <linux|windows|all>`.
  - `Packaging and verification commands`: `release:windows-archive`, `release:windows-check-assets`, `release:windows-package-twice`, `release:windows-installer-test`, `release:windows-gate-test`.
  - `Release CI workflow (Phase 03)`: `.github/workflows/release-linux.yml`, `x86_64-pc-windows-msvc`, `SOURCE_DATE_EPOCH=1700000000`.
  - `PowerShell bootstrap installer (Phase 02)`: Non-admin, per-user `%LOCALAPPDATA%\Programs\dam-hopper`, parameter table, attestation verification via `gh`.
  - `Installer and fixture verification`: 14 integration scenarios in `windows-release-install.ps1`.
  - `Boundaries and handoff`: Explicit separation of Windows direct-server from Linux systemd / Manifest v2.
- **Internal Links & Dependencies**:
  - Links to: `./linux-release-publisher-bootstrap.md`.
- **Suspicious Outdated Claims (unverified)**:
  - Identifies release workflow as `.github/workflows/release-linux.yml` (cross-platform release script).
  - [UNVERIFIED] Test counts: "14 scenarios", "23 assertions".
- **Recommended Disposition**: **KEEP and UPDATE**.
  - Current and accurate for Windows release engineering.
  - Keep in `docs/windows-release-packaging.md` (or rename to `docs/windows-release-guide.md` to parallel Linux release docs).

---

### 2.6 `docs/workflow-client-state.md` (187 LOC)
- **Purpose**: Documents the shared `@dam-hopper/ui` client types, transport mappings, domain helpers, and React Query state for the Workflow subsystem (REST API mapping via `WsTransport`, profile-scoped query keys, item/session/resource link models).
- **Key Sections**:
  - `Module map`: 8 frontend modules (`workflow-dto-types.ts`, `workflow-domain-helpers.ts`, `workflow-types.ts`, `client.ts`, `ws-transport.ts`, `workflow-queries.ts`, `queries.ts`, `query-client.ts`).
  - `DTO and union contract`: Closed string unions (`ItemKind`, `ItemStatus`, `SessionStatus`, `ResourceLinkType`, `ResourceObservedState`, `WorkflowSource`, `WorkflowEventType`), DTO response shapes.
  - `Domain helpers`: Parent kind validation, completed/open item status checks, progress formatting (`formatTrackedTasksProgress`), duration calculations.
  - `Transport channel mapping`: 13 workflow channels mapped to REST routes via `WsTransport.channelToEndpoint`.
  - `Profile and transport-safe query state`: Hashed query keys scoped by profile and generation: `["profile", profileId, generation, "workflow", "overview"]`.
  - `Hooks and mutation policy`: `useWorkflowOverview`, `useWorkflowEvents`, optimistic state avoidance, request ID generation.
  - `Verification`: Phase 04 test figures (51/51 targeted UI tests).
- **Internal Links & Dependencies**:
  - Links to: `./workflow-api.md`, `./workflow-context-surface.md`.
  - Relative plan link: `../plans/260901-0919-workflow-tracking-notes/phase-04-client-types-transport-and-query-state.md`.
- **Suspicious Outdated Claims (unverified)**:
  - Header: `Status: Phase 04 complete (2026-09-02)`.
  - Leaks plan file path outside `docs/` (`../plans/...`).
  - Phrasing refers to Phase 04 vs Phase 05 component dependencies.
- **Recommended Disposition**: **CONSOLIDATE / UPDATE**.
  - Either consolidate with `docs/workflow-context-surface.md` into `docs/frontend-components/workflow.md`, or update in place: remove phase-completion dates, strip planning links, and document as the authoritative frontend workflow state guide.

---

### 2.7 `docs/project-overview-pdr.md` (128 LOC)
- **Purpose**: Product Development Requirements (PDR) defining the current product contract, product vision, core principles (Owner-scoped operation, Safe defaults, Conservative semantics, Bounded work/disclosure, Explicit destructive intent), requirement inventory (PR-001 through PR-028), acceptance criteria, 4-tier testing architecture, and success measures as of 2026-10-05.
- **Key Sections**:
  - `Product vision`: Multi-profile development workbench, browser and desktop hosts, Axum server, explicit profile ownership.
  - `Product principles`: 5 foundational architectural invariants.
  - `Product requirements and status`: Table mapping PR-001 through PR-028, explicitly identifying PR-022–PR-025 as **Retired** and PR-027 Native Advisor as complete.
  - `Acceptance criteria for critical behavior`: Profiles & ownership, Git safety (CAS ref updates, leased publication), Native Advisor, Agent status & privacy, 4-tier testing architecture.
  - `Success measures`: Pass/fail acceptance measures.
  - `Non-functional requirements`: Security, reliability, performance, compatibility, accessibility, qualification.
- **Internal Links & Dependencies**:
  - Links to: `./configuration-guide.md`, `./authentication-api.md`, `./phase-03-files-editor-search-git.md`, `./architecture/host-resource-sse.md`, `./native-browser-debug-support.md`, `./workflow-api.md`, `./workflow-client-state.md`, `./architecture/git-history-search.md`, `./api-reference.md#git-operations` (valid anchor), `./architecture/native-advisor.md`, `./configuration/advisor.md`, `./testing.md`, `./system-architecture.md`, `./code-standards.md`, `./project-roadmap.md`, `./CHANGELOG.md`, `./CHANGELOG-archive.md`.
- **Suspicious Outdated Claims (unverified)**:
  - Links to `./phase-03-files-editor-search-git.md` which requires migration to a purpose-based path.
  - Content itself is fresh and authoritative (Status date: 2026-10-05).
- **Recommended Disposition**: **KEEP and UPDATE**.
  - Top-level contract specification; keep as root PDR document.
  - Update link to Phase 03 once the replacement path is established.

---

### 2.8 `docs/system-architecture.md` (123 LOC)
- **Purpose**: Current system architecture specification (updated 2026-10-05). Defines high-level monorepo layout, runtime boundaries (Axum/Tokio server, React 19 UI, Vite web, Tauri 2 native), multi-profile ownership model (`{ profileId, generation }`), backend state, tunnel isolation / port forwarding, Native Advisor native domain, Agent Status runtime, Git safety model (CAS, active vs inactive branches, leased publication), Cognito Mode, authentication/privacy/capability boundaries, and deployment/qualification boundaries.
- **Key Sections**:
  - `Runtime overview`: Mermaid diagram showing UI -> Profiles -> Client -> Server -> Domains -> Store.
  - `Code boundaries & UI surfaces/settings topology`: Monorepo structure, collapsed settings accordion default (`defaultOpen = false`).
  - `Multi-profile ownership model`: Monotonic generation, owner-qualified queries and event subscriptions.
  - `Backend state and service composition`: `AppState`, serialized setting updates, no sync locks over `.await`.
  - `Tunnel isolation and port forwarding`: Cloudflared quick tunnels, `--config ""`, single-authority supervisor exit pattern, danger port deny-list.
  - `Native Advisor`: Native domain in `server/src/advisor/`, routes in `server/src/api/advisor.rs`, React subtree in `packages/ui/src/advisor/`.
  - `Agent Status`: `AgentStatusRuntime`, loopback WebSocket for OMP, Unix domain socket for Codex/Claude with peer credentials.
  - `Git safety model`: CAS ref updates, active vs inactive branch locking, leased publication with exact expected OID (`PublishSnapshot`).
  - `Cognito Mode`: In-app overlay, capture-phase input guard, Heavy Blur CSS (`blur(16px) saturate(180%)`).
  - `Authentication, privacy, and capability boundaries`: MFA keys, OPAQUE PAKE, opaque media tickets.
  - `Idle suspend and deployment`: Linux coordinator, enrolled helper, fail-closed checks.
  - `Qualification boundary`: Unit/integration vs live qualification boundaries.
- **Internal Links & Dependencies**:
  - Links to: `./user-guide-multi-server-profiles.md`, `./phase-03-files-editor-search-git.md`, `./architecture/native-advisor.md`, `./configuration/advisor.md`, `./architecture/agent-status.md`, `./architecture/git-history-search.md`, `./api-reference.md#git-operations` (valid anchor), `./authentication-api.md`, `./configuration/server-configuration.md`, `./terminal-idle-suspend-security.md`, `./pty-activity-observation.md`, `./architecture/host-resource-sse.md`, `./project-roadmap.md`, `./testing.md`.
- **Suspicious Outdated Claims (unverified)**:
  - References `./phase-03-files-editor-search-git.md` (historical phase naming).
  - Content itself is fresh and authoritative (Status date: 2026-10-05).
- **Recommended Disposition**: **KEEP and UPDATE**.
  - Top-level system architecture specification; keep as root architecture overview.
  - Update link to Phase 03 once the replacement path is established.

---

### 2.9 Nested Doc: `docs/architecture/host-resource-sse.md` (173 LOC)
- **Purpose**: Canonical architecture and implementation specification for Server-Sent Events (SSE) streaming of host resources (`GET /api/system/resources/v1/events`). Documents the publisher contract, authenticated endpoint, admission/lifetime rules, profile-owned stream client, dual-query React cutover (`snapshot` and `metrics`), freshness tracking, and remaining deployment qualification gates.
- **Key Sections**:
  - `Status and Scope`: Phases 01–04 delivered; Phase 05 test instrumentation; Phase 06 docs complete; live target gates pending.
  - `Phase 01 backend publisher contract`: `HostResourceMonitor`, `CachedHostResourcePair`, `StreamStatusBasis`, `HostResourcePublisher`, `PublishedFrame` (capped at 256 KiB).
  - `Phase 02 authenticated SSE endpoint`: Route admission capped at 32 global and 4 per-subject bodies; 2s auth timeout; periodic status at 15s; signal+10s forced close.
  - `Target ownership and source of truth`: Flow diagram, collector independence, clamped freshness parameters.
  - `HTTP and wire contract`: `host-resources` full frame, `host-resources-status` small control (<4 KiB), `host-resources-error`.
  - `Admission, auth, shutdown, and lifetime`: `AdmissionPermit`, supervisor checking claims every 5s with 2s timeout.
  - `Browser coordinator and source arbitration`: Profile-owned stream client, `WsTransport`, `HostResourceSseParser`, 7 coordinator modes, Phase 04 dual-query cutover (`registerConnectionRegistryQueryClient`, `ProjectionFreshness`).
  - `Qualification and rollout gate`: Pending target gates (N=0/1/4/16/32 load, reference Linux hosts, proxy qualification, native C42).
  - `Source map and research corrections`: Identifies earlier research notes as explicitly superseded.
  - `Unresolved questions`: Reference/weak Linux hosts, proxy/LB/CDN buffering/compression, native streaming fetch.
- **Internal Links & Dependencies**:
  - Links to: `../system-architecture.md`.
  - Numerous relative links to `../../plans/260929-1522-host-resources-sse/...` and `../../server/...` and `../../packages/ui/...`.
- **Suspicious Outdated Claims (unverified)**:
  - Deep relative jumps (`../../plans/...`, `../../server/...`) cross out of documentation scope.
  - Pending qualification gates remain open: target Linux host, deployed proxy/LB/CDN, native C42.
- **Recommended Disposition**: **KEEP and UPDATE**.
  - Authoritative technical specification for SSE host resource streaming.
  - Sanitize relative links to repository source files and plans.

---

### 2.10 Nested Doc: `docs/linux-systemd/idle-suspend-runbook.md` (377 LOC)
- **Purpose**: Operator runbook for Linux systemd terminal idle-suspend helper enrollment, host qualification, emergency reset/rollback, manual force-sleep canary testing, target-host observer qualification, protected status reason code interpretation, observation-only canary, and bounded automatic canary.
- **Key Sections**:
  - `11. Terminal Idle Suspend Helper Enrollment & Rollback Runbook`: Numbered 11 to match parent `linux-systemd.md`.
  - `11.1 Host Qualification Requirements`: `/sys/class/rtc/rtc0/wakealarm`, systemd/logind, exclusive RTC ownership.
  - `11.2 Privileged Helper Enrollment & Hardening`: `dam-hopper-idle-suspend-helper.service`, socket mode `0660`, `SO_PEERCRED`, audit log v2 schema.
  - `11.3 Boundary Verification`: `verify-idle-suspend-boundary.sh`, 14 boundary checks.
  - `11.4 Rollback and Emergency Reset`: `./deploy/reset-linux-production.sh` dry-run and live usage.
  - `11.5 Manual Force Sleep Qualification & Canary Runbook`: Timed canary protocol vs Indefinite sleep protocol.
  - `11.6 Target-Host Observer Qualification`: Netlink socket diag, procfs visibility, live smoke test.
  - `11.7 Protected Status Interpretation & Operator Reason Guide`: 17-row diagnostic matrix of status states, reason codes, operator interpretations, and required actions.
  - `11.8 Observation-Only Canary Soak Runbook`: `enabled = false` with `automatic_policy = "agent-activity"`.
  - `11.9 Bounded Automatic Canary Runbook (Operations Gate)`: Full automatic canary execution and verification steps.
  - `11.10 Controlled Rollout Stop Criteria`: 9 mandatory abort criteria.
  - `11.11 Rollback and Emergency Disable Procedures`: Level 1 policy rollback, Emergency disable, Level 2 complete helper disenrollment.
- **Internal Links & Dependencies**:
  - Links to: `../linux-systemd.md`.
- **Suspicious Outdated Claims (unverified)**:
  - Heading numbering starts directly at `## 11.`, coupling it to the numbering in `docs/linux-systemd.md`.
- **Recommended Disposition**: **KEEP and UPDATE**.
  - Production-critical operator runbook; preserve intact.
  - Ensure section numbering aligns cleanly with `docs/linux-systemd.md`.

---

### 2.11 Nested Doc: `docs/configuration/server-environment-auth.md` (146 LOC)
- **Purpose**: Global defaults (`config.toml`), environment variables, server-token handling, MFA encryption key provisioning, lost TOTP authenticator operator recovery runbook, and historical plugin management administrator allowlist.
- **Key Sections**:
  - `Global Configuration`: `~/.config/dam-hopper/config.toml` defaults and workspaces.
  - `Environment Variables`: Reference table.
  - `JWT Signing Secret and Session Tokens`: `~/.config/dam-hopper/server-token`, `--new-token`.
  - `MFA Encryption Key and Operator Recovery Runbook`: `DAM_HOPPER_MFA_KEY_FILE`, MongoDB `users.updateOne` script.
  - `Historical: Retired Plugin Management Administrator Allowlist`: Former runner allowlist rules.
- **Internal Links & Dependencies**:
  - Links to: `./server-configuration.md`, `../phase-01-auth-state-cryptography-and-policy.md`, `../authentication-api.md`, `../architecture/plugin-platform-d05.md`.
- **CRITICAL STALE CURRENT-DOC ISSUE**:
  - Line 51 in the active Environment Variables table lists:
    `| DAM_HOPPER_PLUGIN_ADMINS_FILE | path | Optional root-seeded plugin administrator JSON override |`
  - Lines 53–54 state:
    `Plugin management administrators are not configured in dam-hopper.toml; the runner reads this host-owned file before opening its management RPC surface.`
  - Lines 142–145 state:
    `The management API requires Authorization: Bearer ... even when the general API also accepts an HttpOnly cookie...`
  - **Conflict**: The plugin runner was decommissioned and removed on 2026-10-02 during the Native Advisor cutover. No management RPC is opened, the environment variable is obsolete, and presenting it as current server configuration is incorrect.
- **Recommended Disposition**: **UPDATE and PURGE RETIRED CONFIG**.
  - Remove `DAM_HOPPER_PLUGIN_ADMINS_FILE` from the active Environment Variables table.
  - Remove prose describing the runner reading this file.
  - Relocate the entire "Historical: Retired Plugin Management Administrator Allowlist" section to `docs/archive/plugin-platform/` or re-tag as migration archive notes.
  - Update link from `../phase-01-auth-state-cryptography-and-policy.md` to purpose-based path.

---

## 3. Purpose-Based Replacement Paths for `phase-*.md` Files

The 7 `phase-*.md` files in `docs/` should be renamed and reorganized by subsystem purpose:

| Current Phase File | Core Subsystem Purpose | Recommended Purpose-Based Replacement Path |
| --- | --- | --- |
| `docs/phase-01-auth-state-cryptography-and-policy.md` | Auth state persistence, password hashing, TOTP, AES-256-GCM secrets, session policy | `docs/architecture/auth-cryptography-policy.md` (or `docs/auth-architecture.md`) |
| `docs/phase-03-files-editor-search-git.md` | Multi-profile IDE workbench: profile/worktree target qualification, file tree, tabs, search/replace, Git operations | `docs/workbench-ide-git.md` (or `docs/frontend-components/workbench-ide-git.md`) |
| `docs/phase-04-terminal-continuity-workflow-navigation.md` | Terminal ownership (`TerminalRef`, `TerminalInstanceRef`), session/incarnation lifecycle, workflow task linking, navigation | `docs/terminal-ownership-workflow.md` (or `docs/architecture/terminal-ownership-workflow.md`) |
| `docs/phase-05-agents-ports-and-browser.md` | Agent Store multi-profile isolation, port/tunnel discovery & aggregation, browser debug target trust | `docs/agent-store-ports-browser.md` |
| `docs/phase-06-preferences-settings-usage-and-host.md` | Workbench preferences source, Settings target, profile-local usage metrics, host action qualification | `docs/workbench-settings-preferences.md` |
| `docs/phase-07-media-isolation-and-encryption.md` | Media session v2, ticket-based authorization, cookie namespaces, encrypted WebSocket uploads (OPAQUE PAKE, AES-256-GCM) | `docs/media-isolation-encryption.md` (or `docs/architecture/media-isolation-encryption.md`) |
| `docs/phase-08-native-scope-concurrency.md` | Native desktop Tauri SSH forwarding scopes, concurrent profile channels, platform desktop integration | `docs/native-desktop-ssh-forwarding.md` |

---

## 4. Disposition of Retired Plugin Platform Documentation

The DamHopper plugin platform was superseded by Native Advisor and officially retired on 2026-10-02. The associated documentation should be handled as follows:

| Current Path | Document Title / Purpose | Recommended Disposition | Target Archived Path |
| --- | --- | --- | --- |
| `docs/plugin-platform-d00.md` | Trusted Plugin Platform — Phase D00 Contracts | **MOVE TO ARCHIVE** | `docs/archive/plugin-platform/d00-contracts.md` |
| `docs/plugin-platform-linux.md` | Trusted Plugin Platform — Linux Deployment & Qualification | **MOVE TO ARCHIVE** | `docs/archive/plugin-platform/linux-deployment.md` |
| `docs/architecture/plugin-platform-d01.md` | Phase D01: Package Registry & Trust Staging | **MOVE TO ARCHIVE** | `docs/archive/plugin-platform/d01-registry-staging.md` |
| `docs/architecture/plugin-platform-d02.md` | Phase D02: Owner-Account Runner & Worker Supervision | **MOVE TO ARCHIVE** | `docs/archive/plugin-platform/d02-runner-supervision.md` |
| `docs/architecture/plugin-platform-d03.md` | Phase D03: API/Runner Socket Integration | **MOVE TO ARCHIVE** | `docs/archive/plugin-platform/d03-api-integration.md` |
| `docs/architecture/plugin-platform-d05.md` | Phase D05: Management API & Lifecycle State Machine | **MOVE TO ARCHIVE** | `docs/archive/plugin-platform/d05-management-lifecycle.md` |
| Section in `docs/configuration/server-environment-auth.md` | Retired Plugin Management Administrator Allowlist | **EXTRACT TO ARCHIVE** | `docs/archive/plugin-platform/administrator-allowlist.md` |

**Archival Policy:**
- Create `docs/archive/plugin-platform/README.md` summarizing the retirement decision (2026-10-02 cutover to Native Advisor, PR-022–PR-025 retirement, PR-027 completion).
- Preserve existing text for design provenance; ensure no active documentation indexes link to them as current systems.

---

## 5. Duplicate and Stale Subdirectory Ownership Audit

### 5.1 `docs/frontend-components/` Ownership
- **Issue**: `docs/frontend-components/index.md` is incomplete and misleading. It lists only 3 surfaces (`terminal-and-ide.md`, `platform-integrations.md`, `../workflow-context-surface.md`), omitting 4 other existing component guides (`workbench.md`, `host-and-usage.md`, `notifications-and-privacy.md`, `files-and-media.md`).
- **Conflict**: `docs/frontend-components.md` (at root) already serves as a complete index of all frontend component modules.
- **Recommendation**: Delete `docs/frontend-components/index.md` or synchronize it completely with `docs/frontend-components.md`.

### 5.2 `docs/configuration/` Ownership
- **Issue**: Triplicate hierarchy between `docs/configuration-guide.md` (root guide), `docs/configuration/index.md` (subfolder index), and `docs/configuration/server-configuration.md` (server settings index).
- **Recommendation**: Consolidate `docs/configuration/index.md` and `docs/configuration/server-configuration.md` into a single server configuration index.

### 5.3 `docs/api/` Ownership
- **Issue**: `docs/api/rest-endpoints.md` duplicates route tables that are more thoroughly documented in domain-specific files (`api/git.md`, `api/filesystem-and-media.md`, `api/advisor-and-workflow.md`, `api/system-services.md`).
- **Recommendation**: Refactor `docs/api/rest-endpoints.md` into a concise route-to-domain index mapping HTTP methods and paths to the authoritative domain doc.

---

## 6. Heading Anchor & Link Integrity Audit

| Source File | Line | Link Target | Anchor Status | Cause & Correction |
| --- | --- | --- | --- | --- |
| `docs/terminal-idle-suspend-security.md` | 317 | `./linux-release-manager.md#helper-service-lifecycle-production-cli-phase-03` | **BROKEN** | Target file has no such heading; heading is `## Current service lifecycle`. Update link to `#current-service-lifecycle`. |
| `docs/linux-systemd.md` | 79 | `./architecture/agent-status.md#agent-store-path-verification` | **VALID** | Target heading is `## Agent Store path verification`. |
| `docs/linux-systemd.md` | 434 | `./linux-release-manager.md#production-diagnostics-phase-06` | **VALID** | Target heading is `### Production diagnostics (Phase 06)`. |
| `docs/project-overview-pdr.md` | 62 | `./api-reference.md#git-operations` | **VALID** | Target heading is `## Git Operations`. |
| `docs/system-architecture.md` | 101 | `./api-reference.md#git-operations` | **VALID** | Target heading is `## Git Operations`. |
| `docs/configuration/advisor.md` | 51 | `../architecture/native-advisor.md#native-advisor-rest-api` | **VALID** | Target heading is `## Native Advisor REST API`. |
| `docs/linux-systemd.md` | ~420 | `## Terminal Idle Suspend Runbook` | **NUMBERING DEFECT** | Section 10 is followed by unnumbered heading, then Section 12. Correct to `## 11. Terminal Idle Suspend Runbook`. |

---

## 7. Preserved Unique Operational & Security Invariants

During doc restructuring and phase migrations, the following specific rules **must not** be diluted:

1. **Linux Idle Suspend Privileged Helper Security**:
   - `dam-hopper-idle-suspend-helper.service` binds `/run/dam-hopper/idle-suspend.sock` mode `0660`, owned by `root:<API group>`.
   - Peer UID/PID verification via kernel `SO_PEERCRED`. The Unix peer PID must match the API service systemd `MainPID` read from `PIDFile=/run/dam-hopper/server.pid` (created with `umask 0027`, mode `0640`).
   - Exclusive `rtc0` ownership: reject any foreign non-empty wakealarm as `RtcAlarmBusy`. Fail closed on active sleep inhibitors (`systemd-inhibit`).
   - Helper protocol version 1: accept only `wakeAfterSeconds: 0` (indefinite sentinel) or `60..=86400`. Zero converts to clear-only mode.
   - Audit trail v2: `/var/log/dam-hopper/idle-suspend-helper.jsonl` (mode `0600`, no-follow, max 10,000 records). Preflight and intent sync precede RTC mutation.
2. **Process and Netlink TCP Activity Observation**:
   - Process attribution requires `(pid, start_ticks)` from `/proc/<pid>/stat` field 22. Reject PGID-only or DISPLAY-only attribution.
   - Observation caps: 256 live roots, 8,192 scanned processes, 1,024 relevant processes, 4,096 FDs, 8,192 socket inodes, 16 KiB cmdlines, 1s sample timeout.
   - Netlink TCP collection via unprivileged `NETLINK_SOCK_DIAG`. Parse `tcp_info` prefix without casting raw bytes to C structs. Shared 16 MiB dump budget.
   - Zero content leakage: command lines, arguments, environment, terminal bytes, and socket IPs strictly excluded from status warnings, logs, and audits.
3. **MFA Key File Provisioning**:
   - `DAM_HOPPER_MFA_KEY_FILE` mandatory for production authenticated startup: strictly 32 raw bytes (or 64 hex / 44 Base64 chars), mode `0600`, regular file only (reject symlinks and group/world bits).
4. **Git Safety & Leased Publication**:
   - Local commit message rewrites and contiguous squashes use CAS on branch/HEAD without touching worktree or index.
   - Inactive branch rewrites lock only the target branch ref and verify HEAD was not switched.
   - Publication uses exact expected remote OID lease (`PublishSnapshot`). Normal push is fast-forward only.
5. **Native Advisor Invariants**:
   - Per-server setting `[server.advisor].enabled` defaults to `false`. `--no-auth` mode explicitly rejected.
   - History reads `$HOME/.evcrate/advisor-history` (real directory, reject symlinks). Routing policy at `$HOME/.evcrate/advisor-routing.json` requires SHA-256 CAS and owner-only mode `0600` atomic replacement.
6. **Cognito Mode Masking**:
   - Ephemeral in-app visual overlay with capture-phase input guard. CSS `blur(16px) saturate(180%)` with fallback to solid black. Not an OS-level recording boundary or auth mechanism.

---

## 8. Unresolved Questions

1. **Phase Migration Scope**: Should the proposed purpose-based replacement paths for `phase-*.md` files be implemented as renames with git history preservation, or as new consolidated architectural pages with redirection stubs?
2. **Target Canary Prerequisites for Idle Suspend**: Can every target Linux host guarantee DamHopper-exclusive `rtc0` ownership, or should pre-existing foreign alarms permanently inhibit manual suspend?
3. **Host-Resource SSE Live Deployment Qualification**: What reference Linux hardware specifications and reverse proxy configurations (e.g. Nginx `proxy_buffering off; proxy_read_timeout 45s;`) will be used to qualify the SSE stream before promoting it to a general release claim?
4. **Windows Native SSH Forwarding Qualification**: Will Windows native S13 desktop runtime qualification be scheduled prior to the next minor release, or remain an explicit open qualification gate?
