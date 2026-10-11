# Host Resources: agent-aware automatic sleep — Progress Overview

**Overview Path**: `plans/261010-1746-host-resources-auto-sleep/progress.md`  
**Plan Path**: `plans/261010-1746-host-resources-auto-sleep/plan.md`  
**Branch**: `feat/host-resources-auto-sleep`  
**Advice Mode**: `explicit`  
**Current Date**: 2026-10-11  

---

## Phase Status Summary

| # | Phase | Status | Completion Basis | Evidence / Receipt |
|---|---|---|---|---|
| 01 | Contracts, configuration and admission interfaces | **DONE** | Sealed durable controller receipt (`task_run_id: ae52fd84-6791-4ff6-8ac4-88d18961d15e`, rev 7) | [`phase-01-completion-receipt.md`](reports/phase-01-completion-receipt.md) |
| 02 | Managed agent inventory and qualified semantic evidence | **DONE** | Sealed durable controller receipt (`task_run_id: 00a533ce-2ba5-4bf7-9d13-9ab582c77e30`, rev 10) | [`phase-02-completion-receipt.md`](reports/phase-02-completion-receipt.md) |
| 03 | Public WebSocket presence, liveness and session binding | **DONE** | Sealed durable controller receipt (`task_run_id: 252d12a0-fc0b-40e8-987e-fe5a60961c84`, rev 7) | [`phase-03-completion-receipt.md`](reports/phase-03-completion-receipt.md) |
| 04 | Timer, immediate consent and final handoff | **DONE** | Sealed durable controller receipt (`task_run_id: 5d2f133c-3a64-4306-9fe6-2891e49bdb65`, rev 7) | [`phase-04-completion-receipt.md`](reports/phase-04-completion-receipt.md) |
| 05 | Host Resources and shared consent UI | **DONE** | Sealed durable controller receipt (`task_run_id: 66fa7950-7615-4f32-9c9f-6a7f07f8f250`, rev 7) | [`phase-05-completion-receipt.md`](reports/phase-05-completion-receipt.md) |
| 06 | Runtime, security, visual qualification and rollout | **DONE** | Sealed durable controller receipt (`task_run_id: fffa1fdb-edd7-4034-8fec-1669369d9e2e`, rev 7) | [`phase-06-completion-receipt.md`](reports/phase-06-completion-receipt.md) |

---

## Phase 01 Completed Scope

- **Policy & Configuration**:
  - `IdleSuspendAutomaticPolicy::AgentFree` (`agent-free` in TOML, `agentFree` in JSON)
  - Fixed 10,800s quiet period enforced fail-closed at startup validation and timing PATCH admission
  - `StartupIdleSuspendPolicy` immutability preserved across full config update, workspace reload, and settings import
  - `TimingStore::persist_timing_pair_for_policy` enforces 10,800s constraint while preserving unrelated TOML formatting
- **Status & Wire Protocols**:
  - `IdleSuspendStatusV1` extended with `agentFree`, `clientPresence`, and `consent` DTOs
  - Mutual exclusion between `activity` (`agent-activity` only) and `agentFree`/`clientPresence`/`consent` (`agent-free` only)
  - Fallback uninitialized status generates reconciling state with null counts when coordinator unstarted
  - `UiConnectionFrame` and `ConsentDecisionRequest`/`ConsentDecisionResponse` protocol types implemented
- **UI API Client**:
  - TypeScript types and `decodeIdleSuspendStatusV1` strict boundary decoders in `@dam-hopper/ui`
  - Validates all discriminator branches, negative counts, out-of-bounds timestamps, and mutual exclusivity
  - `api.system.submitConsentDecision` transport client method added
- **Concurrency & Architecture**:
  - Documented 3-tier canonical admission lock hierarchy in `docs/system-architecture.md`
  - Order: `ClientPresenceRegistry` -> `PtySessionManager::inner` -> `AgentStatusRuntime::registry`
  - Strict invariants: zero locks across `.await`/IO/procfs, single-direction acquisition, pre-flight async auth checks
- **Validation Metrics**:
  - Backend tests: 1,957/1,957 passed across 60 suites
  - Frontend tests: 2,769/2,769 passed across 330 test files
  - Frontend typecheck: 0 errors
  - Reviewer score: 9.4/10 (APPROVED, 0 critical issues)

---

## Phase 02 Completed Scope

- **Process Discovery & Descendant Closures**:
  - `ProcessDiscovery` in `server/src/idle_suspend/activity/process.rs` bounds candidate matching strictly to managed PTY session roots and retained lineage
  - Full `descendant_processes` closures traced per recognized agent (Codex, Claude, OMP) using DFS/BFS traversal; subagents cannot hide working state under an idle parent
  - Privacy-preserving `ProcessImageKey` captures executable device/inode and sanitized entrypoint token without raw argv/env leakage
  - Returns deduplicated, sorted `matched_agents: Vec<MatchedManagedAgent>` with verified process and terminal identities
  - Independent external agents (tmux, SSH, shell outside managed PTYs) cleanly excluded by deliberate product design
- **Verified OMP TCP Peer Binding**:
  - `verify_tcp_peer_process` in `server/src/agent_status/collector.rs` binds loopback WebSocket connections to OS process identity on Linux
  - Discovers client socket inode from `/proc/net/tcp` and `/proc/net/tcp6` matching peer port
  - Validates client file descriptor in `/proc/<pid>/fd/` targets `socket:[<inode>]`, bounded to `MAX_PEER_FDS_SCAN = 256`
  - Traces process ancestry to registered terminal root up to 32 hops; enforces `stat_before.start_ticks == root.start_ticks` on direct root match to defeat PID recycling
  - Pre- and post-checks of `/proc/<pid>/stat` ensure `start_ticks` remain identical and rejects zombie/dead states (`Z`, `X`)
  - Unverified connections fail closed in semantic evaluation as `UnverifiedProcessBinding` without leaking socket or process details
- **Hard Fail-Closed Native Freshness Gate**:
  - Empirical research confirmed Codex and Claude CLI hooks lack keepalive heartbeats; leases expire after 15s (`DEFAULT_LEASE_MS = 15_000`)
  - Enforces hard fail-closed gate: no synthetic lease stretching, no simulated Idle states from stop events, and no screen/transcript scraping
  - Unrefreshed native providers transition to `AgentSemanticBlockReason::UnrefreshedNativeProvider` (`AgentSemanticEvaluation::Unknown`), blocking automatic sleep until refreshed or proven exited
- **Non-Free Generation Tracking & Semantic Evaluation**:
  - Monotonic `non_free_generation: u64` in `AgentStatusRegistry` increments on every non-free transition (working admission, hook state transition, lease expiration sweep, terminal removal, reconnect)
  - Brief `Working -> Idle` gap between coordinator polling sweeps increments `non_free_generation`, invalidating previous Free claim tickets
  - `evaluate_managed_agents` returns `Free` (only when all agents Idle/Blocked with valid leases, or 0 agents), `Working` (capturing implicated PIDs), or `Unknown` (expired lease, unrefreshed provider, unverified binding, ambiguous owner, subagent uncovered)
- **AgentFreeClaimTicket & PTY Manager Handoff Fences**:
  - `AgentFreeClaimTicket` in `server/src/idle_suspend/activity/sampler.rs` captures atomic evaluation snapshot with sanitized `Debug` formatting
  - `PtySessionManager::try_claim_agent_free_handoff` in `server/src/pty/manager.rs` enforces 8-point admission fence under `inner` lock: policy check, revision/generation match, monotonic deadline expired, observation age <= 5s, input revision match, fleet generation match, live session/root match, and atomic fleet handoff claim
- **Validation Metrics**:
  - Test gate: 3,261/3,261 passed across 5 suites (89 agent_status, 180 idle_suspend, 208 pty + 1 ignored benchmark, 15 backend integration, 2,769 UI Vitest)
  - Typecheck: 0 TypeScript diagnostics on `@dam-hopper/ui`
  - Code review score: 9.3/10 (APPROVED; hardening incorporated)

---

## Phase 03 Completed Scope

- **Bounded Client Presence Registry (`server/src/idle_suspend/client_presence.rs`)**:
  - In-memory bounded registry (`inner: Mutex<RegistryInner>`) with default capacity 1,024 clients.
  - Fails closed on saturation with `PresenceAdmissionError::CapacityExceeded` (HTTP 503 `PRESENCE_UNAVAILABLE`).
  - Zero locks across `.await`/IO boundaries; synchronous mutex dropped before all channel broadcasts (`status_tx.send_replace`).
  - Monotonic `membership_revision: u64` tracks all admissions, promotions, heartbeats, and closures.
  - Zero-client admission fence (`try_claim_no_client_fence`) enforces strict revision matching and zero live/pending connections before arming host suspension.
- **Cryptographic Capability & Session Binding**:
  - Per-connection 122-bit high-entropy capability secret generated via CSPRNG `Uuid::new_v4()`.
  - Hashed immediately via SHA-256; only 32-byte digest stored in memory; plaintext secret never logged, broadcast, or exposed.
  - Constant-time verification (`subtle::ConstantTimeEq`) prevents timing side-channel attacks.
  - Strict validation of actor subject, session ID, auth version, credential version, and effective deadline.
  - Connection closure immediately marks record closing and invalidates decision capability.
- **Decoupled Frame Reader & Heartbeat Supervision (`server/src/api/ws.rs`)**:
  - Dedicated `frame_reader` task catches and processes Ping/Pong/Close control frames immediately, preventing long filesystem handlers from starving heartbeat liveness.
  - Bounded application queue (`APP_MSG_CAP = 64`) provides natural TCP window backpressure.
  - 30s Ping / 90s Pong heartbeat supervisor terminates silent/dead connections.
  - Unified cancellation watch channel coordinates teardown across reader, writer, and heartbeat tasks.
  - Initial `host:uiConnection` receipt delivered privately to the connecting socket's priority queue ahead of any broadcasts.
- **UI Exact-Owner Receipt Lifecycle (`packages/ui/src/api/`)**:
  - `WsTransport` stores current receipt in memory; never persisted in localStorage or exposed in global state.
  - Cleared immediately on disconnect, close, error, reconnect, and transport destruction.
  - Notifies subscribers immediately, and provides snapshot to late subscribers.
  - `connections.ts` strictly gates receipt access via `isCurrentConnection(owner)`; stale generations return null.
- **Validation Metrics**:
  - Backend unit tests: 6/6 passed (`idle_suspend::client_presence::tests`).
  - Backend integration tests: 5/5 passed (`ws_client_presence`).
  - UI targeted tests: 69/69 passed (`ws-transport.test.ts`, `connections.test.ts`).
  - UI full test suite: 2,771/2,771 passed across 330 files.
  - Frontend typecheck: 0 TypeScript diagnostics (`tsc --noEmit`).
  - Reviewer score: 9.6/10 (APPROVED).

---

## Phase 04 Completed Scope

- **Coordinator Agent-Free Loop & Quiet Interval (`server/src/idle_suspend/coordinator.rs`)**:
  - Enforced continuous >10,800s quiet interval strictly on tick evaluations.
  - Zero-agent startup baseline support initialized cleanly without false-negative blockers.
  - Public presence branching: zero clients trigger immediate final check; live clients open single consent request; pending upgrade holds execution.
  - First-valid consent decision atomically latches; contrary decision returns HTTP 409 `decisionAlreadySettled`; identical duplicate decision returns idempotent HTTP 200 OK.
  - Immediate approval bypasses 60s unanswered timeout and initiates fresh evidence gathering immediately.
  - Refusal, 60s unanswered timeout, or last client disconnect resets coordinator to >3h deferral cooldown.
  - Fresh final checks pipeline: re-sampling, semantic evaluation, provisional PTY claim management, presence fence, and privileged RTC suspend helper dispatch.
- **Protected Consent Decision API (`server/src/api/idle_suspend.rs`, `server/src/api/router.rs`)**:
  - `POST /api/system/idle-suspend/v1/consent/decision` endpoint registered with 16 KiB body limit, JSON content-type guard, and CSRF origin validation.
  - Authentication check with fail-close `--no-auth` guard.
  - Constant-time capability secret validation against public presence registry.
  - Pre-dispatch actor database revalidation (enabled account, auth version, session unrevoked, unexpired, and MFA validity).
- **Audit & Privacy Redaction (`server/src/idle_suspend/server_audit.rs`, `server/src/linux_release/diagnostics/redaction.rs`)**:
  - `ConsentAuditRecord` persistent audit trail on Unix mode 0600 file descriptor with `sync_data`.
  - Privacy-preserving redaction masking actor presence, stripping connection IDs, and mapping sanitized revision summaries.
- **Validation Metrics**:
  - Backend tests: 210/210 passed in `idle_suspend` crate test suite; 1/1 passed in consent decision API test; 9/9 passed in `test_agent_free`.
  - UI test suite: 2,771/2,771 passed across 330 files.
  - Frontend typecheck: 0 TypeScript diagnostics (`tsc --noEmit`).
  - Reviewer score: 9.3/10 (APPROVED).
  - Controller state sealed: `task_run_id: 5d2f133c-3a64-4306-9fe6-2891e49bdb65`, revision 7.

---

## Phase 05 Completed Scope

- **Strict Boundary Decoders & Transport (`packages/ui/src/api/`, `packages/ui/src/hooks/use-sse.ts`)**:
  - Enforced `scope === "managed-terminals"`, policy/field mutual exclusion across `empty-fleet`, `agent-activity`, and `agent-free`, state/decision consistency in `decodeConsentStatus`, and `decodeConsentDecisionResponse` validation at the `api.system.submitConsentDecision` boundary.
  - Mapped `system:submitConsentDecision` in `WsTransport` to `POST /api/system/idle-suspend/v1/consent/decision` with `credentials: "omit"` and Bearer auth.
  - Added `useSubmitConsentDecision` mutation (`retry: false`) and exact-owner status query invalidation on WebSocket `connected` transition and `host:uiConnection` receipt acquisition.
- **Multi-Profile Consent Hook & Deterministic Queue (`packages/ui/src/hooks/use-host-sleep-consent.ts`)**:
  - Subscribes to all connected profile generations and per-socket `UiConnectionFrame` receipts kept strictly in transport memory.
  - Deduplicates duplicate profile aliases only when proven same backend instance (`serverEpoch` from qualified resource or agent-status store + UUID `requestId`).
  - Captures frozen `{ owner, requestId, requestRevision, connectionId }` per rendered action target and fences before and after every `await` against stale generations or socket replacement.
  - Handles `409` (`decisionAlreadySettled`, `idleSuspendHandoffInProgress`, `consentExpired`, `consentCancelled`) by refetching status, closing action controls, and displaying settled outcome; surfaces uncertainty on `503`/timeout and triggers GET reconciliation.
- **Always-Mounted Shared Consent UI & Status Organisms (`packages/ui/src/components/organisms/`, `packages/ui/src/embed/dam-hopper-app.tsx`)**:
  - Mounted `HostSleepConsentHost` and `HostSleepConsentDialog` once at `DamHopperApp` root covering IDE, Traditional Terminal, Compact/Mobile, and non-workspace routes across web and native desktop.
  - Pending `Escape`/X/outside dismissal sends one `deny` POST; settled dismissal closes presentation locally without sending a contrary POST; Cognito Mode hides and isolates the prompt without answering.
  - Extended `HostIdleSuspendStatus` for `agent-free` semantic eligibility, null-safe `Unknown` count labels, public client presence, consent status, and server-driven deadlines.
  - Updated `SettingsIdleSuspendTimingSection` to display a fixed read-only `10800s` (3h) quiet period in `agent-free` mode while keeping `wakeAfterSeconds` mutable.
- **Validation Metrics**:
  - Targeted Phase 05 Vitest: 149/149 passed across 7 files.
  - Browser Vitest: 17/17 passed (`idle-suspend-settings-status.browser.tsx`).
  - Full UI test suite: 2,783/2,783 passed across 331 files.
  - Frontend typecheck: 0 TypeScript diagnostics (`tsc --noEmit`).
  - Reviewer score: 9.1/10 (APPROVED; reviewer hardening incorporated).
  - Controller state sealed: `task_run_id: 66fa7950-7615-4f32-9c9f-6a7f07f8f250`, revision 7.

---

## Phase 06 Completed Scope

- **Permanent Boundary & Race Condition Test Suite (`server/src/idle_suspend/tests.rs`, `server/tests/idle_suspend.rs`)**:
  - Deterministic 10,800s threshold boundary assertion: 10,799s and 10,800s strictly ineligible, >10,800s eligible.
  - Approving socket disconnect invalidation (C15): coordinator defers for 3 hours when approving socket disconnects even if other sockets remain live.
  - Zero-client admission fence race test (C18): revision mismatch and pending upgrade races rejected.
  - Invalidation on Working/Unknown transition (C23): active consent cancelled and deferred upon non-free transitions.
  - Resume baseline reset (C27): anchor reset after resume prevents immediate resuspend loops.
  - Consent route boundary tests: unauthenticated 401, payload >16 KiB 413, managed-terminals scope projection.
- **Strict Decoder Boundary Suite (`packages/ui/src/api/idle-suspend-client.test.ts`)**:
  - Verified decoders for `decodeAgentFreeStatus`, `decodeClientPresenceStatus`, and `decodeConsentStatus`.
  - Enforced scope validation, enum bounds, non-negative counts, and state-decision consistency.
- **End-to-End Application Journeys (`packages/ui/e2e/host-auto-sleep/host-auto-sleep.spec.ts`)**:
  - Authenticated journeys with SQLite backend testing always-mounted consent host across IDE and Traditional Terminal surfaces.
  - Viewport checkpoints for desktop (1440x900), narrow tablet (768x1024), and compact mobile (390x844).
- **Safe Real-Router Loopback Smoke Fixture (`server/examples/agent_free_consent_fixture.rs`)**:
  - 5 core scenarios verified with real router, AppState, and recording FakeExecutor without physical suspend.
- **Security Boundary Verification (`scripts/verify-idle-suspend-boundary.sh`)**:
  - 15 automated security checks passed: zero sudo/shell, 16 KiB limit, file permissions 0600, systemd unit hardening.
- **Operational Canary & Rollback Runbook (`docs/linux-systemd/idle-suspend-runbook.md`, `docs/CHANGELOG.md`)**:
  - Documented Section 11.12 with operator disclosures, safe pre-deployment smoke, Canary Paths A/B, and clean rollback.

---

## Next Steps

- **All Phases Complete**: Phases 01 through 06 fully implemented, verified, and certified.
- **Hardware Qualification Gate**: Target Linux host maintenance window for physical RTC wake and hardware suspend qualification prior to production enablement.
