# Stable API and Architecture Documentation Report

## Executive Summary

- **Assignment Scope:** Owned exclusively `docs/api/**/*.md` (11 files) and `docs/architecture/**/*.md` (11 files). Disjoint ownership respected; no edits outside assigned scopes.
- **Goal:** Refactored documentation text to eliminate development 'phase' and 'plan' terminology, removed all markdown links and inline paths to `../../plans`, updated technical contracts with verified codebase facts, and maintained all documents strictly under the 800 LOC limit without validation runs.

## Key Changes and Subsystem Refactoring

1. **Elimination of Phase and Plan Terminology:**
   - Replaced development phase headings, narratives, execution progress statements, and risk records across all 22 files with coherent subsystem and architectural descriptions.
   - Removed all links and inline references pointing to `../../plans/*`. Retained essential security deadlines (30-day session expiry, 10-day MFA freshness, token rotation, and bounded revocation) directly in canonical documents.
   - Removed obsolete review score metrics and transient cycle receipts. Preserved factual historical completion and qualification dates (e.g. 2026-09-11, 2026-09-28, 2026-09-30, 2026-10-02, 2026-10-04) without developmental milestone labels.

2. **Accurate Codebase Contracts & Reader Report Alignments:**
   - `docs/api/transport-and-events.md`:
     - Updated `terminalAttach` return type to `boolean | void` ("returns false if not sent").
     - Updated `onTerminalBuffer` callback signature to include all current fields: `data`, `offset`, `reset`, `truncated`, and `incarnation`.
   - `docs/api/authentication.md`:
     - Corrected `--no-auth` startup rejection statement: explicitly documented that `--no-auth` is rejected in production environments (`RUST_ENV=production` or `ENVIRONMENT=production`) and whenever an active database connection is present (`AppState` verifies `db.is_some()`). Corrected former overclaim by documenting that server startup skips MongoDB setup under `--no-auth`, so MongoDB environment variables alone do not reject `--no-auth`.
   - `docs/architecture/host-resource-sse.md`:
     - Replaced nonexistent `remote_addr()` method description on `ForceCloseListener` with verified semantics: `accept()` yields `SocketAddr` under Axum's `Connected` listener trait.
     - Documented sticky REST-only error latching and independent supervisor mechanics without developmental milestone designations.
   - `docs/architecture/native-ssh-forwarding.md`:
     - Preserved Windows desktop platform capability as release-gated pending the open Windows S13 packaged runtime qualification gate.
   - `docs/api/rest-endpoints.md`:
     - Retained `<a id="client-side-profile-management"></a>` and updated heading to `## Client-Side Profile Management`.

## Changed Files Inventory

### `docs/api/` (11 files)
- `docs/api/advisor-and-workflow.md`: Removed `(Phase 03)` from tracking service heading; rephrased PTY lifecycle observation narrative.
- `docs/api/agent-usage-and-sessions.md`: Removed phase labels from Agent Status and Persistence API headings; removed all plan/review report links; removed phase comments from JSON examples and schema notes.
- `docs/api/authentication.md`: Updated `--no-auth` rejection mechanics to align with `main.rs` and `state.rs`.
- `docs/api/filesystem-and-media.md`: Refactored qualification heading and ledger narrative to describe workbench media integration without phase tags.
- `docs/api/git.md`: Removed phase designations from worktree target, profile-owned search, frontend transport, and UI parity headings.
- `docs/api/idle-suspend.md`: Removed phase designations from policy, qualification boundary, helper execution, and helper audit v2 headings; rephrased multi-stage observation narrative into coherent subsystem wording.
- `docs/api/rest-endpoints.md`: Removed phase tags from terminal idempotency, Git diff, and client-side profile management headings; preserved anchor `#client-side-profile-management`.
- `docs/api/system-services.md`: Removed phase tags from frontend diagnostics, browser debug, native SSH, backend diagnostics export, and production diagnostics headings; repointed production diagnostics link to canonical `#production-diagnostics`.
- `docs/api/transport-and-events.md`: Removed phase labels from reconnection flow and session attachment; updated `terminalAttach` return type and `onTerminalBuffer` callback properties (`reset`, `truncated`, `incarnation`).
- `docs/api/websocket.md`: Removed phase tags from terminal attach description, file tree subscription, file read, and file write headers.
- `docs/api/workspace-settings.md`: Verified clean; no phase/plan references present.

### `docs/architecture/` (11 files)
- `docs/architecture/agent-status.md`: Removed all phase tags, plan links, and review report references; refactored OMP and Codex/Claude native hook architectures into modular subsystem descriptions; cleaned up duplicate headings.
- `docs/architecture/agent-store-ports-and-browser.md`: Verified clean; no phase/plan references present.
- `docs/architecture/authentication-state-and-cryptography.md`: Removed `plans` security-contract link; retained full token freshness and revocation rules in local narrative.
- `docs/architecture/git-history-search.md`: Removed phase tags from shared controller, workspace panel, standalone Git page, and selection persistence sections; removed plan links.
- `docs/architecture/host-resource-sse.md`: Removed phase headers across backend publisher, authenticated endpoint, stream client, and UI cutover; fixed `ForceCloseListener` socket address wording; removed plan links and research notes.
- `docs/architecture/media-isolation-and-encryption.md`: Verified clean; no phase/plan references present.
- `docs/architecture/native-advisor.md`: Removed phase labels from contract baseline, history domain, policy editor, panel provider, and settings cutover; removed plan links and progress receipts.
- `docs/architecture/native-ssh-forwarding.md`: Maintained Windows desktop capability as release-gated for open Windows S13 qualification; verified clean of phase/plan references.
- `docs/architecture/preferences-settings-and-host-resources.md`: Verified clean; link to system architecture multi-profile ownership verified.
- `docs/architecture/terminal-continuity-and-workflow.md`: Verified clean; no phase/plan references present.
- `docs/architecture/workbench-files-editor-and-git.md`: Verified clean; no phase/plan references present.

## Exception Inventory

The following genuine occurrences of `phase` or `plan` substrings are retained as permitted exceptions:
1. **Runtime Workflow Entity Identifiers:**
   - Domain entity types: `Plan`, `Phase`, `Task` in workflow tracking documentation.
2. **Actual Codebase File and Script Paths:**
   - `server/tests/transport_enforcement_phase03.rs` in `docs/architecture/authentication-state-and-cryptography.md`
   - `server/tests/idle_suspend_phase07.rs` in `docs/api/system-services.md`
   - `scripts/qualify-phase09-workbench.mjs` in `docs/api/filesystem-and-media.md`
3. **Natural English Substring Matches:**
   - "explanation" in `docs/api/git.md` and `docs/architecture/git-history-search.md`
   - "transplant" in `docs/architecture/native-advisor.md`

## Heading Rename Map Sent to Main and DocsReorganizer

```text
advisor-and-workflow.md: ## Workflow Tracking Service and REST API (Phase 03) -> ## Workflow Tracking Service and REST API (#workflow-tracking-service-and-rest-api)
agent-usage-and-sessions.md: ## Agent Status API (OMP-first Phases 01–05; native Phases 01–06) -> ## Agent Status API (#agent-status-api)
agent-usage-and-sessions.md: ## Session Persistence API (Phase 05) -> ## Session Persistence API (#session-persistence-api)
filesystem-and-media.md: #### Phase 09 integration qualification -> #### Workbench media integration qualification (#workbench-media-integration-qualification)
git.md: ### Project worktree targets (Phases 1–7) -> ### Project worktree targets (#project-worktree-targets)
git.md: ### Profile-owned file and search requests (Phase 03) -> ### Profile-owned file and search requests (#profile-owned-file-and-search-requests)
git.md: ### Frontend Transport... (Phase 02 & Phase 03) -> ### Frontend Transport, Hooks, Action Controllers, and UI Surfaces (#frontend-transport-hooks-action-controllers-and-ui-surfaces)
git.md: #### 7. UI Surface Parity & Accessibility (Phase 03) -> #### 7. UI Surface Parity & Accessibility (#7-ui-surface-parity--accessibility)
idle-suspend.md: ### Phase 01 policy/configuration contract -> ### Policy and configuration contract (#policy-and-configuration-contract)
idle-suspend.md: #### Configured-agent activity qualification boundary (Phase 07, 2026-09-11) -> #### Configured-agent activity qualification boundary (2026-09-11) (#configured-agent-activity-qualification-boundary-2026-09-11)
idle-suspend.md: #### Phase 01 helper execution contract -> #### Helper execution contract (#helper-execution-contract)
idle-suspend.md: #### Phase 04 helper audit v2 (internal diagnostics) -> #### Helper audit v2 (internal diagnostics) (#helper-audit-v2-internal-diagnostics)
rest-endpoints.md: ### Git Diff & Change Management (Phase 01) -> ### Git Diff & Change Management (#git-diff--change-management)
rest-endpoints.md: ## Client-Side Profile Management (Phase 02) -> ## Client-Side Profile Management (#client-side-profile-management)
system-services.md: ## Frontend Diagnostics Snapshot (Phase 01) -> ## Frontend Diagnostics Snapshot (#frontend-diagnostics-snapshot)
system-services.md: ## Browser Debug Artifacts (Phase 2; Phase 6 hardened) -> ## Browser Debug Artifacts (#browser-debug-artifacts)
system-services.md: ### Browser tool host policy (Phase 3) -> ## Browser tool host policy (#browser-tool-host-policy)
system-services.md: ## Native SSH forwarding IPC (Phase 08) -> ## Native SSH forwarding IPC (#native-ssh-forwarding-ipc)
system-services.md: ## Backend Diagnostics Export (Phase 04) -> ## Backend Diagnostics Export (#backend-diagnostics-export)
system-services.md: ### Production diagnostics CLI (Phases 06–07) -> ### Production diagnostics CLI (#production-diagnostics-cli)
system-services.md: #### Phase 07 qualification (production diagnostics, 2026-09-14) -> #### Production diagnostics qualification (2026-09-14) (#production-diagnostics-qualification-2026-09-14)
transport-and-events.md: ## Reconnection Flow (Phase A feature) -> ## Reconnection Flow (#reconnection-flow)
transport-and-events.md: ### Session Attachment (Phase 3) -> ### Session Attachment (#session-attachment)
transport-and-events.md: #### PTY, process, TCP, and automatic admission observation (server-internal Phases 02–05) -> #### PTY, process, TCP, and automatic admission observation (server-internal) (#pty-process-tcp-and-automatic-admission-observation-server-internal)
websocket.md: File Tree Subscription (Phase 03): -> File Tree Subscription:
websocket.md: File Read (Phase 04): -> File Read:
websocket.md: File Write (Phase 04): -> File Write:
agent-status.md: ## End-to-end data flow (Phases 01–05 implemented) -> ## End-to-end data flow (#end-to-end-data-flow)
agent-status.md: ## Runtime identity and ownership (Phases 01–05 complete) -> ## Runtime identity and ownership (#runtime-identity-and-ownership)
agent-status.md: ### Implemented private reporter connection (Phase 02) -> ### Implemented private reporter connection (#implemented-private-reporter-connection)
agent-status.md: ## Implemented PTY/runtime lifecycle (Phase 02) -> ## Implemented PTY/runtime lifecycle (#implemented-ptyruntime-lifecycle)
agent-status.md: ## Implemented standalone OMP adapter and installation (Phase 03) -> ## Standalone OMP adapter and installation (#standalone-omp-adapter-and-installation)
agent-status.md: ## Frontend, reconnect, and notifications (Phase 04) -> ## Frontend, reconnect, and notifications (#frontend-reconnect-and-notifications)
agent-status.md: ## Cross-phase invariants and release gates -> ## Subsystem invariants and release gates (#subsystem-invariants-and-release-gates)
agent-status.md: ## Codex and Claude native-hook rollout — Phases 01–06 complete -> ## Codex and Claude native-hook integration (#codex-and-claude-native-hook-integration)
agent-status.md: ### Managed installation and removal (Phase 03 delivered) -> ### Managed installation and removal (#managed-installation-and-removal)
agent-status.md: ### Native event adapters and ingress (Phases 04 and 06 qualified) -> ### Native event adapters and ingress (#native-event-adapters-and-ingress)
agent-status.md: ### Native rollout status and remaining gates -> ### Native qualification status and remaining gates (#native-qualification-status-and-remaining-gates)
git-history-search.md: ## Shared history controller and presentation (Phase 04) -> ## Shared history controller and presentation (#shared-history-controller-and-presentation)
git-history-search.md: ## Workspace Git panel integration (Phase 05) -> ## Workspace Git panel integration (#workspace-git-panel-integration)
git-history-search.md: ## Standalone Git page integration (Phase 06) -> ## Standalone Git page integration (#standalone-git-page-integration)
host-resource-sse.md: ## Phase 01 backend publisher contract (implemented) -> ## Backend publisher contract (#backend-publisher-contract)
host-resource-sse.md: ## Phase 02 authenticated SSE endpoint (implemented and verified) -> ## Authenticated SSE endpoint (#authenticated-sse-endpoint)
host-resource-sse.md: ## HTTP and wire contract (backend Phase 02...) -> ## HTTP and wire contract (#http-and-wire-contract)
host-resource-sse.md: ## Admission, auth, shutdown and lifetime (implemented in Phase 02) -> ## Admission, auth, shutdown and lifetime (#admission-auth-shutdown-and-lifetime)
host-resource-sse.md: ### Phase 03 profile-owned stream client (implemented and verified) -> ## Profile-owned stream client (#profile-owned-stream-client)
host-resource-sse.md: ### Phase 04 owner-fenced resource query and UI cutover (implemented) -> ## Owner-fenced resource query and UI integration (#owner-fenced-resource-query-and-ui-integration)
host-resource-sse.md: ## Qualification and rollout gate (later-phase targets; performance unqualified) -> ## Qualification and release gates (#qualification-and-release-gates)
host-resource-sse.md: ### Phase 05 scoped delivery and remaining gates -> ## Scoped testing and remaining gates (#scoped-testing-and-remaining-gates)
native-advisor.md: ## Phase 01: frozen contract and parity baseline -> ## Frozen contract and parity baseline (#frozen-contract-and-parity-baseline)
native-advisor.md: ## Phase 02: native history domain and API -> ## Native history domain and API (#native-history-domain-and-api)
native-advisor.md: ## Phase 03: policy and evaluation reads & routing editor -> ## Policy and evaluation reads & routing editor (#policy-and-evaluation-reads--routing-editor)
native-advisor.md: ## Phase 04: native React panel and provider -> ## Native React panel and provider (#native-react-panel-and-provider)
native-advisor.md: #### Inline routing editor (Phase 04) -> #### Inline routing editor (#inline-routing-editor)
native-advisor.md: ## Phase 05 Settings and Workspace cutover (complete) -> ## Settings and Workspace integration (#settings-and-workspace-integration)
```

## Physical Line Count Verification

| File | Physical LOC | Limit | Status |
| --- | ---: | ---: | --- |
| `docs/api/advisor-and-workflow.md` | 74 | 800 | OK |
| `docs/api/agent-usage-and-sessions.md` | 233 | 800 | OK |
| `docs/api/authentication.md` | 260 | 800 | OK |
| `docs/api/filesystem-and-media.md` | 270 | 800 | OK |
| `docs/api/git.md` | 760 | 800 | OK |
| `docs/api/idle-suspend.md` | 352 | 800 | OK |
| `docs/api/rest-endpoints.md` | 640 | 800 | OK |
| `docs/api/system-services.md` | 389 | 800 | OK |
| `docs/api/transport-and-events.md` | 160 | 800 | OK |
| `docs/api/websocket.md` | 70 | 800 | OK |
| `docs/api/workspace-settings.md` | 95 | 800 | OK |
| `docs/architecture/agent-status.md` | 382 | 800 | OK |
| `docs/architecture/agent-store-ports-and-browser.md` | 105 | 800 | OK |
| `docs/architecture/authentication-state-and-cryptography.md` | 80 | 800 | OK |
| `docs/architecture/git-history-search.md` | 166 | 800 | OK |
| `docs/architecture/host-resource-sse.md` | 171 | 800 | OK |
| `docs/architecture/media-isolation-and-encryption.md` | 129 | 800 | OK |
| `docs/architecture/native-advisor.md` | 188 | 800 | OK |
| `docs/architecture/native-ssh-forwarding.md` | 148 | 800 | OK |
| `docs/architecture/preferences-settings-and-host-resources.md` | 71 | 800 | OK |
| `docs/architecture/terminal-continuity-and-workflow.md` | 177 | 800 | OK |
| `docs/architecture/workbench-files-editor-and-git.md` | 137 | 800 | OK |

All 22 files are strictly below the 800 LOC cap.

## Unresolved Questions

None. Open platform and environment qualification items (Windows desktop S13 packaged runtime, non-Linux native server platforms, live proxy buffering, and load soak) are documented as explicit release gates in the specifications.
