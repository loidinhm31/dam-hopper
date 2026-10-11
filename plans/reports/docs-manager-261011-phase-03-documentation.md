# Docs Manager — Phase 03 Public WebSocket Presence, Liveness & Session Binding Report

- **Date**: 2026-10-11
- **Phase**: Phase 03 — Public WebSocket presence, liveness and session binding
- **Plan**: `plans/261010-1746-host-resources-auto-sleep/`
- **Branch**: `feat/host-resources-auto-sleep`
- **Status**: Complete (Advisory Report)
- **Authorized Docs Updated**: `docs/system-architecture.md`
- **Report Path**: `plans/reports/docs-manager-261011-phase-03-documentation.md`
- **Protected Sealed Paths**: Untouched
  - `plans/261010-1746-host-resources-auto-sleep/plan.md`
  - `docs/project-roadmap.md`
  - `plans/261010-1746-host-resources-auto-sleep/phase-01-contracts-and-configuration.md`
  - `plans/261010-1746-host-resources-auto-sleep/phase-02-agent-inventory-and-semantic-evidence.md`
  - `plans/261010-1746-host-resources-auto-sleep/reports/phase-01-completion-receipt.md`
  - `plans/261010-1746-host-resources-auto-sleep/reports/phase-02-completion-receipt.md`

---

## 1. Executive Summary & Assessment

Phase 03 implementation delivers public WebSocket client presence tracking, RAII lifecycle guards, constant-time decision capability verification, heartbeat supervision, and exact-owner frontend receipt binding.

Prior documentation in `docs/system-architecture.md` established Phase 01 configuration contracts and Phase 02 process discovery/semantic evidence, but sketched client presence only at high level and lacked specifications for:
1. Two-phase RAII guard lifecycle (`PendingUpgradeGuard` and `ClientPresenceGuard`).
2. Saturated admission bounds (`DEFAULT_MAX_PUBLIC_CLIENTS = 1024`) and HTTP 503 fail-closed rejection.
3. Cryptographic capability derivation, SHA-256 storage, and constant-time verification (`subtle::ConstantTimeEq`).
4. Decoupled frame reader prioritizing control frames over the bounded application queue to prevent heartbeat starvation.
5. Exact-owner UI connection receipt lookup (`isCurrentConnection(owner)`) with zero ambient fallback.

Documentation in `docs/system-architecture.md` has been updated to comprehensively record Phase 03 architecture and invariants.

---

## 2. Changes Made in `docs/system-architecture.md`

### 2.1 Multi-Profile Ownership Model Integration (Lines 77–79)
- Documented connection receipts (`host:uiConnection`, `getUiConnectionReceipt`) bound to exact captured `{ profileId, generation }` owner.
- Explicit invariant: receipts discarded immediately on transport termination, close, or error with zero ambient fallback.

### 2.2 Semantic Agent-Free Status Update (Line 230)
- Updated implementation progress: Phase 01, Phase 02, and Phase 03 certified and qualified; Phase 04–06 cover coordinator timer and UI consent.

### 2.3 Public WebSocket Client Presence Registry & RAII Guards (Lines 273–280)
- **`ClientPresenceRegistry` (`server/src/idle_suspend/client_presence.rs`)**:
  - In-memory bounded capacity (`DEFAULT_MAX_PUBLIC_CLIENTS = 1024`) attached to `AppState.client_presence`.
  - Exclusion invariant: strictly tracks authenticated public UI `/ws` WebSocket connections. Private loopback OMP reporter sockets (`/ws/agent-status`) and HTTP Server-Sent Events streams (host-resource SSE) are deliberately excluded.
- **Two-Phase Connection Admission**:
  1. `PendingUpgradeGuard`: Reserved post-authentication (`reserve_pending_upgrade`) before Axum WebSocket upgrade. Capacity saturation immediately rejects admission with `PresenceAdmissionError::CapacityExceeded` (HTTP 503 `PRESENCE_UNAVAILABLE`). Expired pending reservations (`PENDING_UPGRADE_TIMEOUT = 30s`) are pruned on every mutation. Dropped guards cleanly release reservation slots without leaking active state.
  2. `ClientPresenceGuard`: Promoted upon upgrade completion (`promote_pending_to_live`), capturing connection ID (UUIDv4) and actor session invariants (`subject`, `session_id`, `auth_version`, `credential_version`, `effective_deadline`). Guard drop automatically decrements connection count and increments monotonic membership revision.
- **Zero-Client Admission Fence**: `try_claim_no_client_fence(expected_revision)` atomically asserts zero live connections and zero pending upgrades while verifying monotonic revision match; latches `host_suspending = true` to immediately reject new upgrades with `HostSuspending` (HTTP 503).
- **Monotonic Revision Tracking**: `membership_revision: u64` increments on every reservation, promotion, liveness prune, retirement, or fence transition. Broadcasts `IdleSuspendClientPresenceStatusV1` snapshots via a Tokio watch channel without lock contention.

### 2.4 Cryptographic Capability Verification & Session Invariants (Lines 281–285)
- **Immediate Private Receipt Delivery**: Server sends private `host:uiConnection` frame (`UiConnectionFrame`: `{ kind: "host:uiConnection", version: 1, connectionId, decisionCapability }`) directly to newly connected socket channel ahead of broadcast events.
- **High-Entropy Capability Secret**: 122-bit CSPRNG secret (`Uuid::new_v4()`). Server computes and stores only 32-byte SHA-256 digest (`hash_capability`); raw secret never logged, never emitted to `event_sink`, and never exposed in GET/status endpoints.
- **Constant-Time Verification**: `verify_decision_capability` hashes candidate secret with SHA-256 and compares using `subtle::ConstantTimeEq` to defeat timing side-channel leakage.
- **Actor Invariant Validation**: Enforces exact match on `subject`, `session_id`, `auth_version`, `credential_version`, and monotonic deadline (`now < effective_deadline`).
- **Active/Closing Invariant**: Rejects connections with `closing: true`; explicit `mark_closing()` immediately revokes decision capability prior to task teardown.

### 2.5 Decoupled Frame Reader & Heartbeat Supervision (Lines 286–289)
- **Control Path Decoupling**: Dedicated `frame_reader` loop in `server/src/api/ws.rs` intercepts WebSocket control frames (Ping, Pong, Close) immediately, decoupling liveness updates from bounded application queue (`APP_MSG_CAP = 64`). Long-running PTY or filesystem handlers cannot starve transport liveness.
- **Liveness Refresh**: Control frames and application data immediately refresh `last_liveness` via `record_pong()`.
- **Heartbeat Supervisor**: Sends ping every 30s (`HEARTBEAT_INTERVAL = 30s`) and monitors elapsed silence against `HEARTBEAT_DEADLINE = 90s`. Silent connections exceeding 90 seconds are marked closing, logged, and gracefully terminated via unified cancellation channels.

### 2.6 UI Exact-Owner Receipt Binding & Lifecycle (Lines 290–292)
- **`WsTransport` (`packages/ui/src/api/ws-transport.ts`)**: Caches `host:uiConnection` receipt in memory upon arrival (`getUiConnectionReceipt()`); immediately delivers cached snapshot to late subscribers (`subscribeUiConnection`). Socket disconnect, close, error, reconnect, or transport disposal resets receipt to `null` and notifies subscribers.
- **`connections.ts` (`packages/ui/src/api/connections.ts`)**: Provides `getUiConnectionReceipt(owner)` and `subscribeUiConnectionReceipt(owner, listener)` gated strictly by `isCurrentConnection(owner)` with generation matching. Stale owners, disconnected profiles, or non-WebSocket transports return `null` with no ambient or fallback profile resolution.

### 2.7 Canonical Admission Lock Order (Lines 298–305)
- Preserved single-direction coarse-to-fine hierarchy:
  1. Outer / Coarse: `ClientPresenceRegistry` lock (synchronous in-memory lock for live/pending sockets and reservation guards).
  2. Middle: `PtySessionManager::inner` lock (synchronous lock for fleet generation and managed terminal sessions).
  3. Inner / Fine: `AgentStatusRuntime::registry` lock (synchronous read/write lock for semantic agent states).
- Invariants: Zero locks across `.await`, zero reverse acquisitions, pre-sampling asynchronous checks before fence acquisition.

---

## 3. Evidence & Codebase Cross-Reference

| Documented Architecture Component | Source Implementation | Exercised Verification Tests |
|---|---|---|
| `ClientPresenceRegistry` & Capacity Bounds | `server/src/idle_suspend/client_presence.rs:145–262` | `server/tests/ws_client_presence.rs:253` (`test_ws_capacity_saturation_rejection`) |
| `PendingUpgradeGuard` & `ClientPresenceGuard` | `server/src/idle_suspend/client_presence.rs:547–636` | `server/src/idle_suspend/client_presence.rs:641` (`test_client_presence_pending_reservation_and_promotion`) |
| Zero-Client Fence `try_claim_no_client_fence` | `server/src/idle_suspend/client_presence.rs:493–539` | `server/src/idle_suspend/client_presence.rs:777` (`test_client_presence_claim_fence_and_suspending_rejection`) |
| `UiConnectionFrame` Wire Shape | `server/src/api/ws_protocol.rs:541–548` | `server/src/api/ws_protocol.rs:569` (`test_ui_connection_frame_serialization`) |
| Capability Hash & Constant-Time Verification | `server/src/idle_suspend/client_presence.rs:107–111, 372–432` | `server/src/idle_suspend/client_presence.rs:709` (`test_client_presence_capability_verification`) |
| Decoupled `frame_reader` & Heartbeat Task | `server/src/api/ws.rs:381–469` | `server/tests/ws_client_presence.rs:300` (`test_ws_ping_pong_liveness_interaction`) |
| Upgrade Reservation & Promotion in Axum Handler | `server/src/api/ws.rs:236–292` | `server/tests/ws_client_presence.rs:134` (`test_ws_public_client_presence_receipt_and_lifecycle`) |
| UI Transport Receipt Caching & Subscription | `packages/ui/src/api/ws-transport.ts:2840–2854, 3131–3151` | `packages/ui/src/api/ws-transport.test.ts:2288` (`describe("WsTransport host:uiConnection receipt lifecycle (Phase 03)")`) |
| UI Exact-Owner Receipt Getter & Subscription | `packages/ui/src/api/connections.ts:743–771` | `packages/ui/src/api/connections.test.ts:361` (`getUiConnectionReceipt and subscribeUiConnectionReceipt`) |

---

## 4. Verification & Validation Results

1. **LOC Limit Management**:
   - `docs/system-architecture.md`: 312 LOC (strict limit: 800 LOC). Well within size boundary.
2. **Documentation Validation Script**:
   ```bash
   node .omp/evcrate/scripts/validate-docs.cjs docs/
   ```
   - Checked 70 markdown documents.
   - Zero broken internal links introduced.
   - Zero unverified configuration keys introduced.
   - Code reference `record_pong()` in `docs/system-architecture.md` verified against `ClientPresenceRegistry::record_pong` and `ClientPresenceGuard::record_pong`.
3. **Protected Path Invariant**:
   - Zero edits to sealed plan files, sealed phase contracts, completion receipts, or roadmap.

---

## 5. Unresolved Questions

None. All technical and architectural contracts for Phase 03 are satisfied and documented.
