# Documentation Scout Report: Workflow API, Authentication, Idle Suspend, Phase Documents, and Architecture

**Date:** 2026-10-05  
**Author:** Scout Agent (Docs Reader 4)  
**Deliverable:** `plans/reports/scout-261005-1653-docs-reader-4.md`  
**Environment:** Linux x64 | pnpm monorepo | dam-hopper  
**Scope:**
- 9 Primary Target Documents (2,401 LOC):
  - `docs/workflow-api.md` (602 LOC)
  - `docs/CHANGELOG-archive.md` (539 LOC)
  - `docs/agent-activity-automatic-admission.md` (322 LOC)
  - `docs/authentication-api.md` (249 LOC)
  - `docs/agent-activity-process-discovery.md` (217 LOC)
  - `docs/linux-release-runtime-provisioning.md` (198 LOC)
  - `docs/idle-suspend-status-ui.md` (170 LOC)
  - `docs/phase-01-auth-state-cryptography-and-policy.md` (80 LOC)
  - `docs/frontend-components.md` (24 LOC)
- 3 Additional Assigned Architecture Documents (764 LOC):
  - `docs/architecture/agent-status.md` (405 LOC)
  - `docs/architecture/git-history-search.md` (170 LOC)
  - `docs/architecture/native-advisor.md` (189 LOC)
- Critical Stale Configuration Audit:
  - `docs/configuration/server-environment-auth.md` (146 LOC) — `DAM_HOPPER_PLUGIN_ADMINS_FILE` & plugin management auth audit
- Cross-cutting Audits:
  - Purpose-based replacement paths for all 7 `phase-*.md` files in `docs/`
  - Disposition of retired plugin docs (`plugin-platform-linux.md`, `plugin-platform-d00.md`, `plugin-platform-d01.md`, `d02.md`, `d03.md`, `d05.md`)
  - Duplicate / stale ownership across `docs/api/`, `docs/architecture/`, `docs/configuration/`, `docs/frontend-components/`
  - Heading anchor & Markdown link integrity audit
  - Preservation of unique operational and security guidance

---

## 1. Executive Summary

A comprehensive documentation audit was performed across 13 documents (3,311 LOC total). The audit evaluated document purpose, structural sections, internal dependencies, outdated/unverified claims, heading anchor integrity, duplicate and stale directory ownership, and recommended dispositions.

### Key Critical Findings:

1. **Critical Stale Configuration (`DAM_HOPPER_PLUGIN_ADMINS_FILE`):**
   `docs/configuration/server-environment-auth.md` line 46 explicitly presents `DAM_HOPPER_PLUGIN_ADMINS_FILE` as an active environment variable in its main table, followed by line 48 claiming the runner reads it before opening its management RPC surface. Furthermore, lines 112–146 preserve a full section detailing the `plugin-admins.json` allowlist. Because the trusted plugin platform and runner daemon were completely excised on 2026-10-02 (Phases 06–08 of the Native Advisor migration), this documentation is actively misleading. The variable must be removed from the active table and the historical section moved to archive.

2. **Phase-Named Document Proliferation:**
   Seven top-level files (`docs/phase-*.md`) continue to use project-phase naming rather than purpose-based architecture naming. Notably, `docs/phase-01-auth-state-cryptography-and-policy.md` documents critical cryptographic primitives (AES-256-GCM secret encryption, zeroizing memory buffers, TOTP step advance CAS, V2 session policy) that are current core architecture, not ephemeral Phase 01 notes. A systematic purpose-based migration plan is detailed in Section 3.

3. **Duplicate & Stale Ownership Across `docs/` and Subdirectories:**
   - **Authentication:** `docs/authentication-api.md` (249 LOC) and `docs/api/authentication.md` (86 LOC) both define authentication REST endpoints. The latter is a partial stub referencing the former. They must be consolidated into `docs/api/authentication.md`.
   - **Frontend Components:** `docs/frontend-components.md` (24 LOC) and `docs/frontend-components/index.md` (13 LOC) both serve as index tables. `docs/frontend-components.md` omits direct links to `terminal-and-ide.md` and `platform-integrations.md`, requiring double-nesting through `index.md`.
   - **Workflow API:** `docs/workflow-api.md` (602 LOC) provides exhaustive documentation, while `docs/api/advisor-and-workflow.md` provides an overlapping summary table. `docs/workflow-api.md` should remain the canonical deep reference.

4. **Broken Heading Anchors in Compacted Architecture References:**
   Recent compaction of core documents (`docs/system-architecture.md`, `docs/codebase-summary.md`, `docs/project-overview-pdr.md`, `docs/api-reference.md`) broke inbound anchors from multiple target documents:
   - `docs/workflow-api.md:586` -> `docs/system-architecture.md#workflow-phases-0103-service-rest-and-lifecycle-correlation` (BROKEN)
   - `docs/workflow-api.md:587` -> `docs/codebase-summary.md#workflow-tracking` (BROKEN)
   - `docs/workflow-api.md:588` -> `docs/project-overview-pdr.md#pr-013-terminal-lifecycle-correlation-and-agent-adapter-phase-03` (BROKEN)
   - `docs/idle-suspend-status-ui.md:167` -> `docs/system-architecture.md#server-authoritative-terminal-idle-suspend-architecture` (BROKEN)
   - `docs/architecture/git-history-search.md:170` -> `docs/api-reference.md#commit-history` (BROKEN; belongs in `docs/api/git.md#commit-history`)
   - `docs/architecture/git-history-search.md:170` -> raw unlinked path `plans/261001-2003-git-history-search-persistence/...` lacking `../../plans/` prefix and Markdown link syntax.

5. **Stale Completion Claims in Architecture Guides:**
   - `docs/architecture/git-history-search.md` lines 3 and 112 state "End-to-end qualification remains Phase 07". This claim is stale; Phase 07 qualification was completed on 2026-10-02 (`plans/reports/qualification-261002-0245-git-history-qualification.md`).
   - `docs/agent-activity-automatic-admission.md` status line cites "Phases 05–07 complete (2026-09-11)", omitting completed Phase 08 rollout.

---

## 2. Detailed Per-File Audit (13 Documents)

### 2.1 `docs/workflow-api.md` (602 LOC)
- **Purpose:** Authoritative technical specification and REST API contract for the server-side workflow tracking engine (`/api/workflow/*`) under SQLite persistence (`sessions.db`).
- **Key Sections:**
  - `Scope and authorization`: Bearer/cookie auth, workspace config locator scoping, structured `target` resolution (`project`, `worktreePath`), 32 KiB request limit, RFC3339 timestamps.
  - `Service and persistence architecture`: `WorkflowService`, transactional repository locking, additive migration `010_workflow_tracking.sql`, optional `AppState.workflow`, 24h retention purge.
  - `PTY observation pipeline`: Clone-cheap non-blocking `WorkflowObservationRecorder`, `try_send` into bounded `sync_channel(256)`, dedicated background worker, allowlisted metadata only (terminal ID, incarnation, exit code, restart count; never commands, CWD, env, or output).
  - `Startup terminal reconciliation`: Reconciles live `(sessionId, incarnation)` against persisted links (`attached`, `stale`, `exited`, `crashed`, `detached`).
  - `Bounded diagnostics`: Four fixed-cardinality metrics in `DiagnosticStore` (`workflow_operation_duration_seconds`, `workflow_queue_dropped_total`, `workflow_reconciliation_total`, `workflow_storage_errors_total`).
  - `Profile-scoped old-server 404`: `GET /api/workflow/overview` 404 handled as profile-local feature unavailability, suppressing client retry loops.
  - `Common response and errors`: UUID `requestId` replay idempotency (`replayed: true`), typed tombstones, optimistic concurrency CAS via `updatedAt`.
  - `Endpoint specifications`: `GET /overview`, `GET /events` (keyset pagination with opaque cursor), Item CRUD (`POST`, `PATCH`, `DELETE /items`), Session lifecycle (`POST /sessions`, `/end`, `/abandon`), Resource links (`POST`, `DELETE /links`), Durable notes (`POST`, `DELETE /notes`), History purge (`DELETE /history?before=...`).
  - `Validation and implementation evidence`: Cites test files and Phase 03 code review.
- **Internal Links & Dependencies:**
  - `docs/workflow-client-state.md` (valid)
  - `docs/workflow-context-surface.md` (valid)
  - `plans/reports/code-reviewer-260902-0420-phase-03-terminal-lifecycle-correlation.md` (valid)
  - `docs/system-architecture.md#workflow-phases-0103-service-rest-and-lifecycle-correlation` (**BROKEN ANCHOR**)
  - `docs/codebase-summary.md#workflow-tracking` (**BROKEN ANCHOR**)
  - `docs/project-overview-pdr.md#pr-013-terminal-lifecycle-correlation-and-agent-adapter-phase-03` (**BROKEN ANCHOR**)
- **Suspicious / Outdated Claims (Unverified):**
  - Section *Known implementation note* states that `server.workflow_event_retention_days` is validated in config but API event constructors hardcode the 90-day default expiry directly [UNVERIFIED whether subsequent backend commits wired this setting].
- **Recommended Disposition:** **KEEP & UPDATE**. Retain as the primary canonical deep specification for the workflow tracking subsystem. Fix broken cross-reference anchors to reflect compacted top-level docs. In `docs/api/advisor-and-workflow.md`, maintain only a lightweight summary table with an explicit link to this document.

---

### 2.2 `docs/CHANGELOG-archive.md` (539 LOC)
- **Purpose:** Historical changelog archive preserving milestone release records, phase completions, verification test counts, and architectural rationale for entries dated 2026-09-12 and earlier (dating back to v1.0.0 on 2026-02-15).
- **Key Sections:**
  - 2026-09-12: HTML preview in Explorer (Phases 01–03).
  - 2026-09-11: Configured-agent idle suspend (Phases 01–08 complete).
  - 2026-09-10 to 2026-09-09: Production CLI deployment setup for idle suspend helper & socket.
  - 2026-09-07: Plan item notes & inline title/summary editing; Cross-origin port transport guard fix.
  - 2026-09-06: Authenticated manual force sleep (Phases 01–05 complete).
  - 2026-09-02: Workflow tracking domain, service, PTY correlation, client state, and responsive UI (Phases 01–07).
  - 2026-08-31: Explorer tree expansion & editor view scroll persistence; runtime terminal custom-name persistence; traditional terminal search/scroll fixes.
  - 2026-08-30 to 2026-05-15: Native browser debug v1, native Windows SSH forwarding (Phase 07), telemetry/usage refactor, OPAQUE PAKE stealth encrypted upload, multi-server connection profiles, libgit2 root-aware push/retry.
  - Pre-1.0 releases (v1.0.0 to v1.0.4): Monaco editor, WebSocket file writing, notify watcher.
- **Internal Links & Dependencies:**
  - Links to `docs/CHANGELOG.md` at top.
  - Extensive historical links to `../plans/...` and `../plans/reports/...`.
- **Suspicious / Outdated Claims (Unverified):**
  - Contains references to older schemas and intermediate designs (e.g. SQLite migration 009, early terminal persistence, legacy plugin-runner references). Per RFC/contract instructions: **Changelog claims are historical; do not rewrite history.**
- **Recommended Disposition:** **KEEP AS-IS (Archive)**. Maintain as the permanent historical archive for entries <= 2026-09-12. No content rewriting.

---

### 2.3 `docs/agent-activity-automatic-admission.md` (322 LOC)
- **Purpose:** Canonical integration specification for the Linux `agent-activity` coordinator layer (Phases 05–07), combining PTY root evidence, process discovery, and owned TCP socket diagnostics into generation-fenced automatic host suspend handoffs.
- **Key Sections:**
  - `Scope and source map`: Coordinates `ActivitySampler`, `ProcessDiscovery`, `TcpObserver`, and `PtySessionManager`.
  - `Runtime topology`: Dedicated joinable `idle-suspend-sampler` OS thread, single-slot mailbox, Tokio coordinator task, isolated baselines.
  - `Worker lifecycle and request policy`: Scheduled (2s cadence), Final (on quiet countdown expiry), and Recovery (post-resume baseline invalidation) sample kinds; one-second acceptance deadline.
  - `Transactional sample algorithm`: 8-step pipeline with initial snapshot, process preparation, TCP preparation, raw output verification, cancellation/manager recheck, consecutive commit, delta classification, and opaque ticket creation.
  - `Delta classification and revisions`: Deterministic classification (`RecentInput`, `RecentOutput`, `RecentNetwork`, `AgentChanged`, `LifecycleBusy`, `BaselineEstablished`, `Unchanged`).
  - `Manager-locked final admission`: 9 explicit verification gates verified under `PtySessionManager::Inner` lock.
  - `Public status and privacy contract`: `GET /api/system/idle-suspend/v1/status` (`IdleSuspendStatusV1`), strict content-free warning projection (max 32 PIDs, max 256 bytes safe identity, zero command args / env / sockets / tokens).
  - `Coordinator state machine`: Event loop handling `empty-fleet` vs `agent-activity`, quiet window arming, spent epoch latching, and manual force sleep interaction.
  - `Phase 07 integrated qualification`: Cites 323 backend/PTY/API tests, 14 boundary checks, 16 Chromium tests, and live Linux smoke.
- **Internal Links & Dependencies:**
  - `docs/pty-activity-observation.md` (valid)
  - `docs/agent-activity-process-discovery.md` (valid)
  - `docs/tcp-activity-observation.md` (valid)
  - `docs/idle-suspend-status-ui.md` (valid)
  - `docs/terminal-idle-suspend-security.md` (valid)
  - `docs/system-architecture.md` (valid)
  - `docs/api-reference.md#terminal-idle-suspend` (valid)
  - `docs/configuration-guide.md#terminal-idle-suspend-opt-in-linux-suspend` (valid)
  - `plans/reports/qa-260911-1107-phase07-integrated-qualification.md` (valid)
- **Suspicious / Outdated Claims (Unverified):**
  - Line 3 states: "Phases 05–07 complete (2026-09-11)". Phase 08 (documentation, runbooks, rollout) was subsequently completed and approved.
  - Omits mention of `IdleSuspendEventWriter` which actively emits semantic events to `/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl` during lifecycle transitions.
- **Recommended Disposition:** **KEEP & UPDATE**. Retain as the authoritative coordinator specification. Update status header to reflect Phase 08 rollout completion; document semantic diagnostic event writer integration. Consider moving into `docs/architecture/idle-suspend-agent-activity.md`.

---

### 2.4 `docs/authentication-api.md` (249 LOC)
- **Purpose:** Authoritative reference for challenge-based password login, TOTP enrollment/setup/confirmation, login verification, session step-up, session status, logout, and transport-level enforcement (Phases 02–04).
- **Key Sections:**
  - `Flow overview`: Password login produces a 5-minute restricted challenge, never a session token in normal authenticated mode. Session token issued only after TOTP confirmation/verification.
  - `Endpoints table`: `POST /api/auth/login`, `POST /api/auth/mfa/setup`, `POST /api/auth/mfa/confirm`, `POST /api/auth/mfa/verify`, `POST /api/auth/mfa/challenge`, `GET /api/auth/status`, `POST /api/auth/logout`.
  - `Login and enrollment`: Request/response JSON payloads, Base32 key & `otpauthUri` retrieval, `--no-auth` development bypass.
  - `Login verification and step-up`: `POST /api/auth/mfa/verify` dual-purpose behavior, `POST /api/auth/mfa/challenge` session-bound challenge issuance.
  - `Session status`: `GET /api/auth/status` returning `issuedAt`, `expiresAt`, `mfaDueAt`, or `401 MFA_REQUIRED` when due.
  - `Logout and errors`: Token revocation, cookie clearing, typed error JSON.
  - `Protected REST and live transports (Phase 03)`: V2 claims evaluation, WebSocket session policy (frame-level deadline checks, background 5s watcher with 2s DB timeout, close codes `4403`, `4401`, `1013`), media ticket/session binding.
  - `Profile-owned UI client (Phase 04)`: `@dam-hopper/ui` API integration (`auth-client.ts`, `auth-types.ts`, `connections.ts`).
- **Internal Links & Dependencies:**
  - `plans/260926-2157-token-rotation-mfa/security-contract.md` (valid)
  - `docs/phase-01-auth-state-cryptography-and-policy.md` (valid)
  - `docs/api-reference.md#authentication` (valid)
  - `docs/frontend-components.md#profile-owned-enrollment-and-mfa-ui-phase-04` (valid legacy anchor)
- **Suspicious / Outdated Claims (Unverified):**
  - Line 146 notes: "The handler currently accepts either Bearer or cookie credentials, although the security contract specifies Bearer for this endpoint. Use Bearer for clients; cookie-only step-up is a current contract deviation." [UNVERIFIED whether cookie-only step-up remains accepted].
  - Substantial duplicate ownership with `docs/api/authentication.md` (which provides a partial 86-line summary).
- **Recommended Disposition:** **CONSOLIDATE INTO `docs/api/authentication.md`**. Move this complete, detailed reference into `docs/api/authentication.md` to establish single-source authority for authentication endpoints, replacing the current 86-line stub. Preserve all unique transport-enforcement and security details.

---

### 2.5 `docs/agent-activity-process-discovery.md` (217 LOC)
- **Purpose:** Technical specification for the private Linux procfs process-discovery seam (Phase 03) utilized by the opt-in `agent-activity` idle-suspend policy.
- **Key Sections:**
  - `Source map`: `ProcessDiscovery`, `ProcessSource` trait, `LinuxProcSource`, command matcher, socket-inode collection.
  - `Observation flow`: Single-pass bounded read-only procfs traversal without mutating discovery state.
  - `ProcessSource abstraction`: Method matrix (`list_pids`, `read_stat`, `read_exe`, `read_exe_metadata`, `read_cmdline`, `read_cwd`, `read_netns`, `list_fds`, `read_fd_socket`).
  - `Identity and attribution`: `ProcessIdentity { pid, start_ticks }` preventing PID reuse; retained detached lineages.
  - `Matching contract`: Literal basename / normalized `/proc/<pid>/exe`; finite interpreter grammar (Node, Bun, Python, POSIX shell launchers); lexical CWD normalization; generic script name restrictions; exclusion of shell `-c` string inspection.
  - `Hard bounds and completeness`: Explicit caps (256 roots, 8,192 `/proc` entries, 1,024 relevant identities, 16 KiB command line, 4,096 FDs, 8,192 socket inodes, 256 bytes safe identity). Fail-closed on bound saturation.
  - `Prepared result and failure evidence`: `ProcessSample`, representative owner, closed `ActivityUnavailableReason` set.
  - `Privacy, safety, and limitations`: Read-only, no process signaling/killing, transient raw arguments, safe warning projection.
- **Internal Links & Dependencies:**
  - `docs/pty-activity-observation.md` (valid)
  - `docs/tcp-activity-observation.md` (valid)
  - `docs/agent-activity-automatic-admission.md` (valid)
  - `docs/terminal-idle-suspend-security.md` (valid)
  - `docs/system-architecture.md` (valid)
  - `plans/260910-1604-agent-activity-idle-suspend/phase-03-process-discovery.md` (valid)
- **Suspicious / Outdated Claims (Unverified):**
  - Line 3 states: "Phase 03 implemented 2026-09-11". Downstream phases 04–08 are now complete.
- **Recommended Disposition:** **KEEP & UPDATE**. Retain as authoritative specification. Consider grouping under `docs/architecture/` alongside `pty-activity-observation.md` and `tcp-activity-observation.md`.

---

### 2.6 `docs/linux-release-runtime-provisioning.md` (198 LOC)
- **Purpose:** Technical specification and operator runbook for the Linux release-manager pre-start runtime state and configuration provisioning contract (`dam-hopper-manager provision-api-runtime`).
- **Key Sections:**
  - `Runtime authorities`: Sole authority is API systemd unit `User=`/`Group=`. Root execution refused before layout root is opened.
  - `Filesystem layout and permissions`:
    - `/var/lib/dam-hopper`: API UID:GID, directory `0700` (tightened from legacy `0755` via descriptor `fchmod`).
    - `/var/lib/dam-hopper/.config`: API UID:GID, directory `0700`.
    - `/var/lib/dam-hopper/.config/dam-hopper`: API UID:GID, directory `0700`.
    - `/var/lib/dam-hopper/dam-hopper.toml`: API UID:GID, regular file `0600`.
    - `/var/lib/dam-hopper/idle-suspend-audit.jsonl`: API UID:GID, regular file `0600`.
    - `/etc/dam-hopper/dam-hopper.toml`: `root:root`, regular file `0644` (read-only legacy migration source).
  - `Configuration selection and migration`: Copy-once decision matrix; legacy file never mutated; canonical file is sole startup authority.
  - `Descriptor-relative provisioning flow`: Trusted directory descriptor walk, `O_NOFOLLOW`, atomic staging sibling (`.dam-hopper.toml.provisioning`), `renameat2(RENAME_NOREPLACE)`, directory sync.
  - `Refusal boundaries and failure behavior`: Symlinks and mismatched owners refused; reverse-order cleanup of unmutated/empty objects only.
  - `Operations checklist`: Step-by-step procedures for fresh host setup, legacy migration, production policy changes, and read-only diagnostics smoke (`cargo test --test idle_suspend_diagnostics_linux_smoke -- --ignored`).
- **Internal Links & Dependencies:**
  - `docs/linux-systemd.md` (valid)
  - `docs/linux-release-manager.md` (valid)
  - `docs/terminal-idle-suspend-security.md` (valid)
  - `docs/configuration-guide.md` (valid)
  - `docs/system-architecture.md` (valid)
- **Suspicious / Outdated Claims (Unverified):**
  - Status line cites "Phase 01 complete (2026-09-14)". Release contracts have advanced to Manifest v2 and manager state v3.
  - Verify alignment with `deploy/systemd/dam-hopper-api.service.in` `ExecStartPre` configuration.
- **Recommended Disposition:** **KEEP & UPDATE**. Retain as authoritative deployment runbook. Can be co-located under `docs/deployment/linux-api-runtime-provisioning.md` or kept alongside `docs/linux-systemd.md`.

---

### 2.7 `docs/idle-suspend-status-ui.md` (170 LOC)
- **Purpose:** Technical specification for browser-side decoding, state presentation, heuristic disclosure, and manual force-sleep integration for configured-agent activity idle suspend (Phases 06–07).
- **Key Sections:**
  - `Protected status boundary`: `GET /api/system/idle-suspend/v1/status` with `Cache-Control: no-store`.
  - `Activity object`: Closed `measurementState` and `reasonCode` enums, nullable counts, `tcp4-tcp6` coverage, measurement warning projection (sorted PIDs, max 256 bytes safe identity, zero args/env/sockets/tokens).
  - `Client decode and compatibility`: Strict `decodeIdleSuspendStatusV1` with narrow legacy fallback (empty-fleet / null activity when both properties absent).
  - `HostIdleSuspendStatus presentation`: Visible policy badge, independent measurement rows, accessible heuristic notice, measurement-blocked alert, derived display countdown (`armDeadlineMs`), preserved manual force confirmation.
  - `Verification record`: 323 backend/PTY/API tests, 14 boundary checks, 16 Chromium browser tests.
- **Internal Links & Dependencies:**
  - `docs/api-reference.md#terminal-idle-suspend` (valid)
  - `docs/frontend-components.md` (valid)
  - `docs/system-architecture.md#server-authoritative-terminal-idle-suspend-architecture` (**BROKEN ANCHOR**)
  - `docs/terminal-idle-suspend-security.md` (valid)
  - `docs/agent-activity-automatic-admission.md` (valid)
  - `plans/260910-1604-agent-activity-idle-suspend/phase-07-verification.md` (valid)
  - `plans/reports/qa-260911-1107-phase07-integrated-qualification.md` (valid)
- **Suspicious / Outdated Claims (Unverified):**
  - Cites Phase 07 qualification; Phase 08 rollout subsequently completed.
  - Inbound broken anchor to `docs/system-architecture.md`.
- **Recommended Disposition:** **KEEP & UPDATE**. Fix broken link to `system-architecture.md`. Consider consolidating into `docs/frontend-components/host-and-usage.md` or retaining as a dedicated status UI specification.

---

### 2.8 `docs/phase-01-auth-state-cryptography-and-policy.md` (80 LOC)
- **Purpose:** Authoritative technical and cryptographic specification for MongoDB auth state persistence, AES-256-GCM secret encryption, zeroizing memory key management, TOTP verification with monotonic step CAS, and V2 session policy evaluation.
- **Key Sections:**
  - `Scope and integration boundary`: MongoDB models, cryptographic helpers, TOTP verification, deterministic session policy evaluator (`AppState.auth`, `evaluate_claims`).
  - `Module map`: Exact mapping of `server/src/auth/` modules (`model.rs`, `store.rs`, `policy.rs`, `secret.rs`, `totp.rs`, `mod.rs`).
  - `Persisted state and policy`: `users`, `authSessions`, `authChallenges` collections; camelCase fields; V2 claims (`v`, `sub`, `sid`, `authVersion`, `credentialVersion`, `iat`, `exp`).
  - `Policy bounds`: 30-day absolute session lifetime, 10-day MFA freshness deadline, 5-minute challenge lifetime, 5 max challenge attempts, 10 failed attempts / 10-minute cooldown window.
  - `Cryptography and TOTP`: `DAM_HOPPER_MFA_KEY_FILE` loading (32 raw, 64 hex, 44 base64 bytes; regular file, mode 0600 on Unix, zeroizing memory). AES-256-GCM encryption with 12-byte random nonce and AAD binding (`keyId`, `username`, `purpose`). TOTP 20-byte secret, SHA-1, 6 digits, 30s step, ±1 step window, monotonic CAS step advancement.
  - `Startup and operational boundary`: Production requires MongoDB + MFA key (`RUST_ENV=production`), rejects `--no-auth`. Key kept out of database and browser.
- **Internal Links & Dependencies:**
  - `plans/260926-2157-token-rotation-mfa/phase-01-auth-state-and-policy.md` (valid)
  - `docs/authentication-api.md` (valid)
  - `plans/260926-2157-token-rotation-mfa/phase-03-transport-enforcement.md` (valid)
  - `plans/260926-2157-token-rotation-mfa/security-contract.md` (valid)
  - `docs/api-reference.md#authentication` (valid)
  - `docs/configuration/server-configuration.md#environment-variables` (valid)
  - `docs/system-architecture.md` (valid)
  - `plans/260926-2157-token-rotation-mfa/plan.md` (valid)
- **Suspicious / Outdated Claims (Unverified):**
  - Retains phase-specific name (`phase-01-*`) and heading ("Phase 01 — Auth State...") despite documenting permanent foundational security invariants.
  - Header states "Status: Implementation complete; foundational state and policy only", which was written before Phases 02–04 were delivered.
- **Recommended Disposition:** **MOVE / RENAME TO PURPOSE-BASED PATH**. Propose moving to `docs/architecture/auth-state-and-cryptography.md` or `docs/architecture/authentication-security.md`. Update status from historical phase milestone to canonical architectural specification, preserving all cryptographic contracts.

---

### 2.9 `docs/frontend-components.md` (24 LOC)
- **Purpose:** Top-level navigation index and legacy link redirector for the modularized frontend components documentation in `packages/ui`.
- **Key Sections:**
  - `Contents`: Links to `workbench.md`, `host-and-usage.md`, `files-and-media.md`, `notifications-and-privacy.md`, `index.md`, and `workflow-context-surface.md`.
  - `Legacy section links`: Preserves anchor redirects for `#profile-owned-enrollment-and-mfa-ui-phase-04` and `#host-resource-fleet-deck-and-cards-phase-02`.
- **Internal Links & Dependencies:**
  - `docs/frontend-components/*.md` (all 5 links valid)
  - `docs/workflow-context-surface.md` (valid)
- **Suspicious / Outdated Claims (Unverified):**
  - Structural duplication: `docs/frontend-components.md` (top-level) and `docs/frontend-components/index.md` (nested) both exist.
  - `docs/frontend-components.md` does not directly link to `terminal-and-ide.md` or `platform-integrations.md`, requiring navigation through `index.md`.
- **Recommended Disposition:** **CONSOLIDATE**. Update `docs/frontend-components.md` to directly link all 6 submodules (`workbench.md`, `host-and-usage.md`, `files-and-media.md`, `notifications-and-privacy.md`, `terminal-and-ide.md`, `platform-integrations.md`) plus `workflow-context-surface.md`. Convert `docs/frontend-components/index.md` into a forwarding pointer or remove it.

---

### 2.10 `docs/architecture/agent-status.md` (405 LOC)
- **Purpose:** Authoritative architecture specification for OMP-first agent status (Phases 01–05) and native Codex/Claude hooks (Phases 01–06), detailing loopback collector IPC, reducer state machine, PTY credentials, and UI notifications.
- **Key Sections:**
  - `Delivery Scope and Invariants`: Linux x86_64 qualified, no Herdr dependency, loopback collector inside server process, explicit Unknown state.
  - `End-to-end data flow`: OMP extension -> loopback WebSocket (`/v1/agent-status`, Bearer PTY capability) -> `AgentStatusRuntime` -> protected REST snapshot + authenticated WS pushes -> UI watcher and notification center.
  - `Runtime identity and ownership`: `serverEpoch`, `{id, incarnation}`, `reporterEpoch`, `agentSessionId`, `turnId`. Fenced transitions, sequence replay suppression.
  - `Implemented semantic contract v1`: `unknown | idle | working | blocked`. 5s heartbeat, 15s lease.
  - `Implemented standalone OMP adapter and installation`: `extensions/dam-hopper-agent-status.ts`, CLI commands (`dam-hopper-server integration omp install|status|uninstall --agent-dir`).
  - `Frontend, reconnect, and notifications (Phase 04)`: `terminalAgentNotifications: {version:2, ...}`, sound/toast/browser notifications, badges on tabs.
  - `Agent Store path verification`: `GET /api/agent-status/paths`, `~/` expansion against `service_user` or `plugin_owner_user` in `/etc/dam-hopper/host.toml`.
  - `Codex and Claude native-hook rollout (Phases 01–06)`: Managed installation (`hooks.json`, `settings.json`), provider allowlists, `/v1/agent-hooks` over Unix socket, peer verification, subagent rejection, event normalization.
  - `Native qualification`: Linux x86_64 qualification (OMP 18.4.1, Codex 0.158.0, Claude Code 2.1.250).
- **Internal Links & Dependencies:**
  - Extensive links to plans (`../../plans/260928-0318-agent-status-omp-first/*`, `../../plans/260929-0140-agent-status-codex-claude/*`) and reports (`../../plans/reports/*`). All 2-level `../../plans/` relative paths resolve correctly.
- **Suspicious / Outdated Claims (Unverified):**
  - Line 251 notes: "Codex and Claude currently use line readers that do not enforce the declared 1 MiB MAX_LINE_BYTES constant, so a per-line byte limit is not guaranteed for those adapters." [UNVERIFIED implementation observation].
  - Notes Windows and macOS server runtimes remain platform-unqualified [VERIFIED].
- **Recommended Disposition:** **KEEP AS-IS**. Authoritative, fully synchronized architecture reference.

---

### 2.11 `docs/architecture/git-history-search.md` (170 LOC)
- **Purpose:** Authoritative architecture specification for server-side commit message filtering, shared client transport, persisted history selections, and consecutive-commit squash.
- **Key Sections:**
  - `REST API contract`: `GET /api/git/{project}/log` with `messageQuery`, ASCII-case-insensitive full-message matching, pagination.
  - `Shared client transport`: `git:log` WS channel mapped to REST in `WsTransport`.
  - `Owner-scoped query contract`: `normalizeGitMessageQuery`, `gitLogQueryOptions`, `gitHistoryQueryPrefixes`, query caching by `{profileId, generation, projectTarget, root, revision, query}`.
  - `Persisted selections`: `useGitHistoryStore` (`dam-hopper:git-history-state` v1), `gitPageSelection`, `rootByTarget`, `branchByScope`, `selectionRecoveryRequired`.
  - `Shared history controller`: `useGitHistoryView`, search debouncing (300ms, IME-safe), canonical branch refs (`refs/heads/...`, `refs/remotes/...`), graph/list presentation.
  - `Workspace Git panel and Git page integrations`: Independent selections, bulk action guards on unavailable projects.
  - `Shared consecutive-commit squash`: `useGitSquash`, linear parent validation, branch-qualified snapshots, ref CAS locking, leased publication with exact-OID bounds.
- **Internal Links & Dependencies:**
  - `docs/frontend-components.md` (valid)
  - `docs/code-standards.md#git-history-changes` (valid)
  - `docs/api-reference.md#commit-history` (**BROKEN ANCHOR**; anchor is not in `api-reference.md`, but in `docs/api/git.md#commit-history`)
  - `plans/261001-2003-git-history-search-persistence/phase-03-persisted-history-selections.md` (**BROKEN LINK**; bare unlinked string, missing `../../plans/` prefix and Markdown link syntax)
- **Suspicious / Outdated Claims (Unverified):**
  - Line 3 states: "End-to-end qualification remains Phase 07" and line 112 states: "End-to-end qualification remains Phase 07". **STALE / UNVERIFIED**: Phase 07 qualification was completed on 2026-10-02 (`plans/reports/qualification-261002-0245-git-history-qualification.md` and `phase-07-completion-receipt.md`).
- **Recommended Disposition:** **KEEP & UPDATE**. Update status lines to record completed Phase 07 qualification; repair the broken anchor to `api/git.md#commit-history` and the bare plan link.

---

### 2.12 `docs/architecture/native-advisor.md` (189 LOC)
- **Purpose:** Architecture specification for the Native Advisor domain service and completed retirement record for the Dam-Hopper plugin platform (Phases 01–09 complete 2026-10-04).
- **Key Sections:**
  - `Frozen decisions`: Complete plugin platform retirement confirmed, per-server admin setting for enablement, native Rust Axum domain service + React panel.
  - `History domain and API`: `$HOME/.evcrate/advisor-history`, final-root symlink rejection, default-off setting.
  - `Account policy persistence and security invariants`: Atomic same-directory replacement via `renameat`, strict CAS `expectedRevision` SHA-256 validation, preservation of non-route fields, recursive credential safety rejection (`ROUTE_CREDENTIAL_FIELD`).
  - `Harness model discovery`: `POST /api/advisor/models`, adapters for `omp`, `pi`, `codex`, `claude`, fallback catalogs, bounds (500 models, 256 KiB serialized array, 16 KiB request cap).
  - `React UI integration`: `AdvisorPanel.tsx`, `NativeAdvisorProvider`, abortable requests, zero iframes / MessagePorts / plugin SDKs.
  - `Settings & Workspace cutover`: `AdvisorSettingsSection.tsx`, single host in Workspace, placement tests.
  - `Historical plugin retirement record`: Explicit list of retired assets and clean-cutover boundaries.
- **Internal Links & Dependencies:**
  - `plans/261002-0246-native-advisor-migration/*` (valid)
  - `docs/configuration/advisor.md` (valid)
  - `docs/configuration/advisor.md#model-catalog-discovery` (valid)
- **Suspicious / Outdated Claims (Unverified):**
  - Line 251 notes line readers in Codex/Claude model discovery adapters do not enforce declared 1 MiB line limits [unverified].
- **Recommended Disposition:** **KEEP AS-IS**. Authoritative, fully up-to-date architecture reference.

---

### 2.13 `docs/configuration/server-environment-auth.md` (146 LOC) — Stale Configuration Audit
- **Purpose:** Reference for global defaults, environment variables, server-token handling, MFA key provisioning, and operator recovery runbooks.
- **Key Sections:**
  - `Global Configuration`: `~/.config/dam-hopper/config.toml`, defaults and workspace shortcuts.
  - `Environment Variables table`: Active environment variables.
  - `JWT Signing Secret and Session Tokens`: `server-token` file, `--new-token` rotation.
  - `MFA Encryption Key and Operator Recovery Runbook`: `DAM_HOPPER_MFA_KEY_FILE` provisioning, authenticated `mongosh` identity-recovery script with atomic `authVersion` bump.
  - `Historical: Retired Plugin Management Administrator Allowlist`: Legacy runner allowlist details.
- **Critical Stale Configuration Findings:**
  1. **Line 46 in Active Environment Variables Table:**
     `| DAM_HOPPER_PLUGIN_ADMINS_FILE | path | Optional root-seeded plugin administrator JSON override |`
     This variable belongs to the removed plugin runner. Keeping it in the active environment variables table presents a false capability to operators.
  2. **Line 48 in Active Body Text:**
     `Plugin management administrators are not configured in dam-hopper.toml; the runner reads this host-owned file before opening its management RPC surface.`
     The runner was deleted; no management RPC surface exists.
  3. **Lines 112–146 in Dedicated Section:**
     `## Historical: Retired Plugin Management Administrator Allowlist`
     While tagged "Historical", retaining 35 lines of dead plugin-runner configuration in an active operations and configuration guide dilutes operational clarity.
  4. **Stale Cross-Reference in `docs/configuration/server-configuration.md:25`:**
     Preserves `### Plugin Management Administrator Allowlist` heading pointing into `server-environment-auth.md`.
- **Recommended Disposition:** **UPDATE & CLEANSE**:
  - Delete `DAM_HOPPER_PLUGIN_ADMINS_FILE` row from the active environment variables table.
  - Delete line 48 active text.
  - Excise lines 112–146 from `server-environment-auth.md` and move to `docs/historical/plugin-platform/d05-management-lifecycle.md` if historical reference is needed.
  - Update `docs/configuration/server-configuration.md` to remove the dead legacy section link.
  - **Preserve:** Keep all unique security guidance intact: `DAM_HOPPER_MFA_KEY_FILE` specifications, mode `0600` constraints, zeroizing buffers, and the complete MongoDB operator recovery runbook.

---

## 3. Purpose-Based Replacement Paths for `phase-*.md` Files

Seven documents in `docs/` currently retain historical phase-numbered file names. These documents contain enduring architectural invariants and operational specifications that should be organized by concern:

| Current File | Purpose / Scope | Proposed Purpose-Based Path | Disposition |
|---|---|---|---|
| `docs/phase-01-auth-state-cryptography-and-policy.md` (80 LOC) | MongoDB auth schema, AES-256-GCM secret encryption, zeroizing memory, TOTP step CAS, V2 session policy | `docs/architecture/auth-state-and-cryptography.md` | **Move & Update:** Transition from phase record to canonical architecture specification. Retain all cryptographic invariants. |
| `docs/phase-03-files-editor-search-git.md` (174 LOC) | Profile-qualified IDE workbench resources (Files, Monaco Editor, Global Search, Git panel) | `docs/architecture/workbench-ide-resources.md` | **Move & Update:** Consolidate with `docs/frontend-components/workbench.md` or establish as workbench architecture guide. |
| `docs/phase-04-terminal-continuity-workflow-navigation.md` (124 LOC) | Multi-profile terminal continuity, workflow links, and owner-directed navigation | `docs/architecture/terminal-continuity-and-navigation.md` | **Move & Update:** Integrates with `docs/workflow-context-surface.md` and `docs/frontend-components/terminal-and-ide.md`. |
| `docs/phase-05-agents-ports-and-browser.md` (141 LOC) | Multi-profile Agent Store, port/tunnel aggregation, and Browser Debug target trust | `docs/architecture/multi-profile-agents-and-tunnels.md` | **Move & Update:** Co-locates agent store distribution with tunnel isolation. |
| `docs/phase-06-preferences-settings-usage-and-host.md` (170 LOC) | Multi-profile preference sources, Settings target, local usage, and host resources | `docs/architecture/workbench-preferences-and-host.md` | **Move & Update:** Consolidate with `docs/frontend-components/host-and-usage.md`. |
| `docs/phase-07-media-isolation-and-encryption.md` (127 LOC) | Multi-profile media sessions, media tickets, remote cleanup, and encrypted streaming | `docs/architecture/media-isolation-and-tickets.md` | **Move & Update:** Complements `docs/api/filesystem-and-media.md`. |
| `docs/phase-08-native-scope-concurrency.md` (154 LOC) | Native scope concurrency, Windows desktop SSH port-forwarding scopes (`NativeScopeRef`) | `docs/architecture/native-scope-concurrency.md` | **Move & Update:** Provides dedicated architecture guide for desktop concurrency. |

---

## 4. Disposition of Retired Plugin Documentation

The trusted plugin platform was retired on 2026-10-02 (Phases 06–08 of the Native Advisor migration). All plugin runner daemons, sockets, tmpfiles, sysusers, and iframe bridges were excised. The corresponding documentation should be handled as follows:

| Document | Current Location | Proposed Disposition | Justification |
|---|---|---|---|
| `docs/plugin-platform-linux.md` (260 LOC) | `docs/` | **Move to `docs/historical/plugin-platform/linux-deployment.md`** | Operational deployment guide for retired runner; maintain for historical reference. |
| `docs/plugin-platform-d00.md` (180 LOC) | `docs/` | **Move to `docs/historical/plugin-platform/d00-contract.md`** | Foundational Manifest-v1 and opaque iframe bridge contract; retired. |
| `docs/architecture/plugin-platform-d01.md` (125 LOC) | `docs/architecture/` | **Move to `docs/historical/plugin-platform/d01-registry-trust.md`** | Package registry and staging architecture; retired. |
| `docs/architecture/plugin-platform-d02.md` (186 LOC) | `docs/architecture/` | **Move to `docs/historical/plugin-platform/d02-runner-process.md`** | Runner process model and IPC socket; retired. |
| `docs/architecture/plugin-platform-d03.md` (190 LOC) | `docs/architecture/` | **Move to `docs/historical/plugin-platform/d03-facade-context.md`** | Authenticated REST façade and grant model; retired. |
| `docs/architecture/plugin-platform-d05.md` (248 LOC) | `docs/architecture/` | **Move to `docs/historical/plugin-platform/d05-management-lifecycle.md`** | Management routes and admin allowlist; retired. |
| Stale references in active docs | `docs/configuration/server-environment-auth.md`, `docs/configuration/server-configuration.md`, `docs/user-guide-multi-server-profiles.md` | **Excise immediately from active docs** | Remove `DAM_HOPPER_PLUGIN_ADMINS_FILE`, plugin management sections, and references to EVCrate as a plugin. |

---

## 5. Duplicate and Stale Ownership Audit Across Subdirectories

| Area / Subsystem | Primary Document (`docs/`) | Child / Modular Document | Audit Finding & Recommended Ownership |
|---|---|---|---|
| **Authentication API** | `docs/authentication-api.md` (249 LOC) | `docs/api/authentication.md` (86 LOC) | **Duplicate Ownership:** `docs/api/authentication.md` is a partial stub that links back to `docs/authentication-api.md`. **Action:** Consolidate all content into `docs/api/authentication.md`. Redirect or delete `docs/authentication-api.md`. |
| **Frontend Components Index** | `docs/frontend-components.md` (24 LOC) | `docs/frontend-components/index.md` (13 LOC) | **Redundant Nesting:** Both act as indexes. Top-level omits direct links to `terminal-and-ide.md` and `platform-integrations.md`. **Action:** Make `docs/frontend-components.md` the sole comprehensive index. Redirect `docs/frontend-components/index.md`. |
| **Workflow Tracking** | `docs/workflow-api.md` (602 LOC) | `docs/api/advisor-and-workflow.md` (74 LOC) | **Overlapping Coverage:** `docs/api/advisor-and-workflow.md` covers both Native Advisor and Workflow routes. **Action:** Keep `docs/workflow-api.md` as canonical deep specification; maintain concise table in `docs/api/advisor-and-workflow.md` linking directly to it. |
| **Idle Suspend API** | `docs/agent-activity-automatic-admission.md` (322 LOC) + `docs/idle-suspend-status-ui.md` (170 LOC) | `docs/api/idle-suspend.md` (354 LOC) | **Overlapping Coverage:** `docs/api/idle-suspend.md` duplicates policy tables and DTO definitions. **Action:** `docs/api/idle-suspend.md` should own endpoint request/response contracts; coordinator internals belong in `agent-activity-automatic-admission.md`. |
| **Native Advisor** | `docs/architecture/native-advisor.md` (189 LOC) | `docs/configuration/advisor.md` (134 LOC) & `docs/api/advisor-and-workflow.md` (74 LOC) | **Clean Separation:** Architecture covers engine, CAS updates, and model discovery; configuration covers settings/fallbacks; API covers REST schemas. Ownership is clean and non-conflicting. |

---

## 6. Preservation of Unique Operational & Security Guidance

The following operational and security guidance is unique to the audited documents and MUST be preserved through any consolidation or restructuring:

1. **Linux API Runtime State Provisioning (`docs/linux-release-runtime-provisioning.md`):**
   - Fixed non-root UID/GID authority: API systemd unit `User=`/`Group=` is the sole identity authority; root UID/GID execution is refused before opening trusted layout roots.
   - Exact descriptor-relative directory walking using `O_NOFOLLOW` and Linux `renameat2(RENAME_NOREPLACE)`.
   - Tightened directory permissions: `/var/lib/dam-hopper` and `.config` subdirectories tightened from legacy `0755` to `0700` via descriptor `fchmod`.
   - Single-direction legacy configuration migration: one-way staged copy from `/etc/dam-hopper/dam-hopper.toml` to `/var/lib/dam-hopper/dam-hopper.toml`; legacy file is never modified or synchronized after first run.
   - Reverse-order cleanup on error, ensuring unmutated and nonempty files are preserved.

2. **MFA Key Provisioning & Emergency Operator Recovery (`docs/phase-01-auth-state-cryptography-and-policy.md` & `docs/configuration/server-environment-auth.md`):**
   - `DAM_HOPPER_MFA_KEY_FILE` must contain exactly 32 raw bytes (or 64 hex / 44 base64 chars), mode `0600`, regular file only (rejects symlinks), held in zeroizing memory.
   - Secret encryption: AES-256-GCM with 12-byte random nonce and AAD binding (`keyId`, `username`, `purpose`).
   - TOTP monotonic step advancement via compare-and-swap (CAS) to prevent replay attacks across concurrent verification attempts.
   - Privileged Operator Recovery Runbook: `mongosh` script using immutable `_id` and atomic `$inc: { authVersion: 1 }` with `$unset` of MFA fields, invalidating all sessions and active WebSockets within 7 seconds.

3. **Terminal Idle Suspend Fail-Closed Invariants (`docs/agent-activity-automatic-admission.md` & `docs/agent-activity-process-discovery.md`):**
   - Zero shell execution / zero sudo: The server never invokes shell pipelines or user-supplied executable paths.
   - Process attribution safety: `ProcessIdentity { pid, start_ticks }` Prevents PID reuse attacks.
   - Manager-locked final admission: 9 distinct verification gates checked atomically under `PtySessionManager::Inner` lock.
   - Strict privacy boundary: Public status DTO projects at most 32 PIDs, max 256 bytes safe identity; command arguments, environment variables, socket inodes, tokens, and raw metrics NEVER cross into public status.

4. **Native Advisor CAS Updates & Routing Isolation (`docs/architecture/native-advisor.md`):**
   - Atomic same-directory replacement via `renameat` with `O_NOFOLLOW` and mode `0600`.
   - Strict CAS validation requiring 64-character hex `expectedRevision` matching current SHA-256 digest; conflicts return HTTP 409 (`POLICY_REVISION_CONFLICT`).
   - Preservation of non-route fields (`wait`, `history`) during route edits.
   - Recursive credential safety scanning: presence of keys like `token`, `secret`, `apiKey` triggers immediate rejection with `ROUTE_CREDENTIAL_FIELD`.
   - History root requirement: Real directory required; final-component symlinks are strictly rejected.

5. **OMP Loopback Capability Injection & Hook Ancestry Verification (`docs/architecture/agent-status.md`):**
   - Injected loopback WebSocket capability (`DAM_HOPPER_AGENT_STATUS_URL`, `DAM_HOPPER_AGENT_STATUS_TOKEN`) bound strictly to `127.0.0.1:0` with PTY-incarnation-scoped tokens.
   - Hook reporter peer verification: Unix domain socket peer credentials checked against reported PID; procfs ancestry verified back to the managed PTY shell.
   - Strict subagent rejection: Any native callback containing `agent_id` or `agent_type` is rejected immediately.

---

## 7. Heading Anchor & Link Integrity Analysis

| Source Document | Link Target | Observed Issue | Recommended Fix |
|---|---|---|---|
| `docs/workflow-api.md:586` | `./system-architecture.md#workflow-phases-0103-service-rest-and-lifecycle-correlation` | **Broken Anchor:** Heading was compacted in `system-architecture.md`. | Link to `./system-architecture.md` or update heading anchor. |
| `docs/workflow-api.md:587` | `./codebase-summary.md#workflow-tracking` | **Broken Anchor:** Heading does not exist in `codebase-summary.md`. | Link to `./codebase-summary.md`. |
| `docs/workflow-api.md:588` | `./project-overview-pdr.md#pr-013-terminal-lifecycle-correlation-and-agent-adapter-phase-03` | **Broken Anchor:** PR-011–014 grouped in a table; anchor does not exist. | Link to `./project-overview-pdr.md#pr-requirements-matrix`. |
| `docs/idle-suspend-status-ui.md:167` | `./system-architecture.md#server-authoritative-terminal-idle-suspend-architecture` | **Broken Anchor:** Heading was compacted in `system-architecture.md`. | Link to `./system-architecture.md`. |
| `docs/architecture/git-history-search.md:170` | `../api-reference.md#commit-history` | **Broken Anchor:** `#commit-history` heading is in `docs/api/git.md`, not `docs/api-reference.md`. | Change link target to `../api/git.md#commit-history`. |
| `docs/architecture/git-history-search.md:170` | `plans/261001-2003-git-history-search-persistence/phase-03-persisted-history-selections.md` | **Broken Link:** Bare unlinked string lacking `../../plans/` relative prefix and Markdown `[text](url)` syntax. | Change to `[Phase 03 plan](../../plans/261001-2003-git-history-search-persistence/phase-03-persisted-history-selections.md)`. |
| `docs/configuration/server-configuration.md:25` | `./server-environment-auth.md#historical-retired-plugin-management-administrator-allowlist` | **Stale Legacy Anchor:** Points to retired plugin configuration. | Remove legacy section link when section is excised. |

---

## 8. Summary of Recommended Dispositions

| Document | LOC | Current Role | Recommended Disposition | Action Details |
|---|---:|---|---|---|
| `docs/workflow-api.md` | 602 | Workflow REST spec | **KEEP & UPDATE** | Fix broken anchors to compacted top-level docs; maintain as canonical deep reference. |
| `docs/CHANGELOG-archive.md` | 539 | Archive changelog | **KEEP AS-IS** | Permanent historical archive (<= 2026-09-12); no modifications. |
| `docs/agent-activity-automatic-admission.md` | 322 | Coordinator spec | **KEEP & UPDATE** | Update status header to reflect Phase 08 rollout; document diagnostic event writer. |
| `docs/authentication-api.md` | 249 | Auth API spec | **CONSOLIDATE** | Merge into `docs/api/authentication.md` to establish single authoritative reference. |
| `docs/agent-activity-process-discovery.md` | 217 | Procfs discovery spec | **KEEP & UPDATE** | Retain as authoritative specification; group under `docs/architecture/`. |
| `docs/linux-release-runtime-provisioning.md` | 198 | API pre-start runbook | **KEEP & UPDATE** | Retain as authoritative deployment runbook; group under `docs/deployment/`. |
| `docs/idle-suspend-status-ui.md` | 170 | Idle-suspend UI spec | **KEEP & UPDATE** | Fix broken anchor to `system-architecture.md`; update status header to Phase 08. |
| `docs/phase-01-auth-state-cryptography-and-policy.md` | 80 | Auth crypto & policy | **MOVE / RENAME** | Move to `docs/architecture/auth-state-and-cryptography.md`; update from phase to canonical spec. |
| `docs/frontend-components.md` | 24 | Frontend UI index | **CONSOLIDATE** | Directly link all 6 submodules plus `workflow-context-surface.md`; supersede `index.md`. |
| `docs/architecture/agent-status.md` | 405 | Agent status arch | **KEEP AS-IS** | Authoritative, fully up-to-date architecture reference. |
| `docs/architecture/git-history-search.md` | 170 | Git search arch | **KEEP & UPDATE** | Update status line to reflect completed Phase 07 qualification; fix broken links/anchors. |
| `docs/architecture/native-advisor.md` | 189 | Native Advisor arch | **KEEP AS-IS** | Authoritative, fully up-to-date architecture reference. |
| `docs/configuration/server-environment-auth.md` | 146 | Server config & auth | **UPDATE & CLEANSE** | Delete `DAM_HOPPER_PLUGIN_ADMINS_FILE` from active table/body; excise retired plugin section. |

---

## 9. Unresolved Questions

1. **`server.workflow_event_retention_days` configuration wiring:** Has the server-side event retention setting been wired into `WorkflowStore` event constructors since the Phase 03 implementation note was written, or does it still hardcode the 90-day default?
2. **Cookie-only MFA step-up deviation:** Does the current Axum handler for `POST /api/auth/mfa/challenge` still accept cookie credentials, or has it been tightened to require Bearer tokens as mandated by the original security contract?
3. **Historical Plugin Docs Archival Structure:** Should the 6 retired plugin documents be preserved under `docs/historical/plugin-platform/` within Git, or should they be completely excised from `docs/` and preserved solely in Git history?
