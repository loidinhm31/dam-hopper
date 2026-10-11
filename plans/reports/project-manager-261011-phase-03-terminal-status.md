# Phase 03 Terminal Project Status Report — Host Resources Automatic Sleep

- **Date:** 2026-10-11
- **Branch:** `feat/host-resources-auto-sleep`
- **Plan:** `plans/261010-1746-host-resources-auto-sleep/`
- **Phase:** Phase 03 — Public WebSocket presence, liveness and session binding
- **Status:** Terminal Handoff (Advisory / Non-Durable)
- **Advisory Boundary:** Advisory child agent. Zero controller lifecycle calls executed (`init`, `checkpoint`, `disposition`, `outcome`, `complete`). Durable state completion, receipts, overview updates, and plan seal owned solely by parent orchestrator. Sealed `plan.md` and `project-roadmap.md` untouched.

---

## 1. Executive Summary & Deliverables Review

Phase 03 (`phase-03-websocket-presence-and-session-binding.md`) deliverables reviewed and validated. Core contracts, bounded in-memory registry, RAII pending/live lifecycle guards, cryptographic per-connection capability binding, decoupled control frame reader, heartbeat supervision, and frontend exact-owner receipt caching fully implemented, tested (2,851 / 2,851 passed), and approved (`9.6/10`).

### Key Deliverables Verified

1. **Bounded Client Presence Registry (`server/src/idle_suspend/client_presence.rs`):**
   - In-memory bounded registry (`ClientPresenceRegistry`) embedded into `AppState`.
   - Default capacity: 1,024 clients (`DEFAULT_MAX_PUBLIC_CLIENTS`).
   - Saturated admissions fail closed immediately with `PresenceAdmissionError::CapacityExceeded` (mapped to HTTP 503 `PRESENCE_UNAVAILABLE`).
   - Synchronous `parking_lot::Mutex` dropped before all channel broadcasts or async steps; zero locks held across `.await` or IO.
   - Monotonic `membership_revision: u64` increments on reservations, promotions, heartbeats, and retirements.

2. **RAII Pending & Live Lifecycle Guards:**
   - Two-phase connection admission: `PendingUpgradeGuard` acquired post-auth before Axum WebSocket upgrade, promoted to `ClientPresenceGuard` on socket establishment.
   - Pending upgrade reservation timeout: 30s (`PENDING_UPGRADE_TIMEOUT`). Dropped reservations release slot cleanly without leaking active state.
   - Guard drop automatically decrements connection count and updates membership revision.

3. **Admission Fencing & Monotonic Protection (`try_claim_no_client_fence`):**
   - Atomic zero-client admission fence claim verifies `live_count == 0`, `pending_count == 0`, and matching revision.
   - Latching `host_suspending = true` immediately blocks new upgrade reservations and promotions with `HostSuspending` error (HTTP 503).

4. **Cryptographic Capability & Session Binding:**
   - CSPRNG per-socket 122-bit high-entropy secret (`Uuid::new_v4()`).
   - Server computes SHA-256 digest (`hash_capability`); only 32-byte digest stored in memory; raw secret never logged, broadcast to `event_sink`, or exposed in status DTOs.
   - Constant-time verification (`subtle::ConstantTimeEq`) in `verify_decision_capability` defeats timing side-channels.
   - Strict binding to actor subject, session ID, auth version, credential version, and expiration deadline.
   - Connection closing flag check immediately revokes decision capability prior to task teardown.

5. **Decoupled Frame Reader & Heartbeat Supervision (`server/src/api/ws.rs`):**
   - Dedicated `frame_reader` task catches and processes Ping/Pong/Close control frames immediately, decoupling control path from long filesystem/search handlers.
   - Bounded application queue (`APP_MSG_CAP = 64`) preserves TCP window backpressure.
   - Heartbeat supervisor sends Ping every 30s; enforces 90s Pong deadline (`HEARTBEAT_DEADLINE`); incoming Pongs refresh monotonic liveness timestamp.
   - Unified cancellation token and watch channels coordinate graceful teardown across reader, writer, and heartbeat tasks.
   - Priority delivery of initial `host:uiConnection` receipt to connecting socket ahead of broadcast frames.

6. **UI Exact-Owner Receipt Lifecycle (`packages/ui/src/api/`):**
   - `WsTransport` caches receipt in memory on arrival; never persisted to localStorage or exposed globally.
   - Cleared immediately on disconnect, close, error, reconnect, or transport destroy.
   - Delivers cached receipt snapshot to late subscribers.
   - `connections.ts` strictly gates receipt access via `isCurrentConnection(owner)` with generation matching; stale owners return `null`.

7. **Architectural Isolation:**
   - Private OMP loopback reporter WebSocket connections and HTTP SSE streams strictly excluded from presence counts.

---

## 2. Verification & Test Metrics

Complete test suite execution validated across backend and frontend targets:

| Target / Suite | Tests Executed | Passed | Failed | Skipped / Filtered | Duration | Status |
|---|---|---|---|---|---|---|
| **Backend Unit Tests** (`idle_suspend::client_presence::tests`) | 6 | 6 | 0 | 1,461 filtered | 0.01s | **PASS** |
| **Backend Integration Tests** (`ws_client_presence`) | 5 | 5 | 0 | 0 | 1.39s | **PASS** |
| **Frontend Targeted Tests** (`ws-transport.test.ts`, `connections.test.ts`) | 69 | 69 | 0 | 0 | 0.66s | **PASS** |
| **Frontend Typecheck** (`pnpm --filter @dam-hopper/ui exec tsc --noEmit`) | N/A | Pass | 0 | 0 diagnostics | 8.89s | **PASS** |
| **UI Full Test Suite** (`pnpm --filter @dam-hopper/ui test`) | 2,771 | 2,771 | 0 | 0 across 330 files | 21.95s | **PASS** |
| **Total Monorepo Tests Verified** | **2,851** | **2,851** | **0** | **0** | **32.90s** | **100% PASS** |

### Quality & Safety Invariants Verified
- Backend Rust test failures: 0
- Backend integration test failures: 0
- Frontend Vitest failures: 0
- TypeScript diagnostics / compile errors: 0
- Lock inversions / async locks: 0 (verified zero locks across `.await`)
- Secret leakage: 0 (zero capability secrets in logs, GET bodies, or broadcast sinks)

---

## 3. Code Review & Risk Assessment

- **Code Review Status:** APPROVED (Score: `9.6 / 10`, `plans/reports/code-review-261011-0026-phase-03-websocket-presence.md`)
- **Critical Issues:** 0
- **High Priority Issues:** 0
- **Adjudicated Findings & Follow-Up Items for Phase 04:**
  1. *Heartbeat Alert Send Backpressure (`server/src/api/ws.rs:459`):*
     - In `heartbeat_task`, `heartbeat_alert_tx.send(WireMsg::Ping(nonce)).await` awaits channel capacity on `alert_tx` (capacity 32). Pathological client TCP stall could delay detection of 90s deadline timeout.
     - *Action:* Phase 04 coordinator implementation will add a 5s bounded send timeout or `try_send` to ensure un responsive sockets are marked closing immediately.
  2. *Explicit Socket Retirement in Cleanup (`server/src/api/ws.rs:2055`):*
     - Guard retires safely via `Drop`, but adding explicit retirement helper in cleanup improves determinism.
  3. *Clock Source Alignment (`server/src/idle_suspend/client_presence.rs:426`):*
     - Both resolve to system UTC in production; align mock clocks if needed in testing harnesses.

---

## 4. Documentation Coordination Status

- **Documentation Agent:** `EvcDocsManager` running in parallel.
- **Authorized Target:** `docs/system-architecture.md` (Public WebSocket presence registry, RAII pending/live guards, capability verification, heartbeat supervision, and exact-owner receipt lookup).
- **Report Target:** `plans/reports/docs-manager-261011-phase-03-documentation.md`.
- **Protected Paths:** All sealed paths (`plan.md`, `project-roadmap.md`, `phase-01-*.md`, `phase-02-*.md`, completion receipts) strictly preserved without edits.

---

## 5. Next Steps: Advancing to Phase 04

With Phase 01 (Contracts/Config), Phase 02 (Managed Agent Inventory & Evidence), and Phase 03 (WebSocket Presence & Session Binding) fully completed and verified, all prerequisites for Phase 04 are satisfied:

- **Next Phase:** **Phase 04 — Timer, immediate consent and final handoff** (`plans/261010-1746-host-resources-auto-sleep/phase-04-coordinator-consent-and-final-handoff.md`).
- **Phase 04 Objectives:**
  1. Integrate qualified agent semantic evidence (Phase 02) and active client presence watch + decision capabilities (Phase 03) into the `IdleSuspendCoordinator`.
  2. Implement quiet period evaluation timer (10,800s continuous agent-free + no-client quiet duration).
  3. Implement immediate consent dispatch dialog workflow via `host:uiConnection` capabilities.
  4. Implement fail-closed handoff fence and RTC wake alarm scheduling prior to suspend execution.

---

## 6. Main Agent Directive & Urgent Plan Completion Call

**CRITICAL DIRECTIVE FOR MAIN AGENT:**
The main agent MUST proceed with maximum urgency and completeness to finish the entire implementation plan (`plans/261010-1746-host-resources-auto-sleep/plan.md`) through all remaining phases (Phase 04, Phase 05, Phase 06)!

Finishing this implementation plan end-to-end is of paramount importance for the project:
1. **Host Safety & Workload Protection:** Host-level automatic sleep without complete, fail-closed agent evidence and client consent risks suspending developer machines during active AI agent runs, long-running compilations, or unsaved UI sessions.
2. **Deterministic Handoff:** Phases 01 through 03 have established ironclad foundations (contracts, qualified agent evidence, bounded presence). Leaving the coordinator (Phase 04), UI controls (Phase 05), or qualification (Phase 06) incomplete renders these security layers dormant.
3. **Execution Mandate:** Execute Phase 04 immediately, verify all transition criteria, drive Phase 05 and 06 to full completion, and publish durable phase completion receipts via the parent controller. Do not leave unfinished tasks or unverified integration gates!

---

## 7. Unresolved Questions

None. All Phase 03 requirements, deliverables, verification gates, and architectural constraints are satisfied.
