# Docs Manager — Phase 01 Contracts, Configuration & Admission Interfaces Report

- **Date**: 2026-10-10
- **Phase**: Phase 01 — Contracts, Configuration and Admission Interfaces
- **Plan**: `plans/261010-1746-host-resources-auto-sleep/`
- **Branch**: `feat/host-resources-auto-sleep`
- **Status**: Complete (Advisory Report)
- **Authorized Docs Updated**: `docs/system-architecture.md`
- **Protected Paths**: Prior sealed paths and `plan.md` untouched

---

## 1. Current State Assessment

Existing system documentation previously documented legacy `empty-fleet` and `agent-activity` idle suspend behaviors, but lacked formal contracts for the new opt-in `agent-free` automatic sleep policy. Specifically:
- **Canonical Lock Order**: Was sketched at a high level without formal definitions of exact inner lock types, concurrency invariants, or the critical boundary between asynchronous data sampling and synchronous lock acquisition.
- **DTO Specifications**: Wire shapes, mutual exclusion rules between `activity` and `agentFree`, nullable process counts vs 0, client presence models, and socket-private capability frames lacked comprehensive system architecture documentation.
- **10,800s Quiet Period Policy**: The strict startup and runtime immutability requirement (exactly 10,800 seconds, 3 hours) and its relation to continuous `idle`/`blocked` agent states, invalidations, and 3-hour deferrals needed explicit documentation in `docs/system-architecture.md`.

---

## 2. Changes Made

### `docs/system-architecture.md`
Updated section `### Proposed: semantic agent-free automatic sleep` (lines 226–277) to comprehensively document Phase 01 contracts and guarantees:
1. **Startup Policy & Scope**:
   - Opt-in `automatic_policy = "agent-free"` under `[server.idle_suspend]`.
   - Immutable across configuration reload, settings import, and workspace switching.
   - Bounded to DamHopper-managed terminals and retained managed lineage only. External OS/SSH/tmux agents deliberately excluded.
2. **10,800s Quiet Period Policy**:
   - Fixed 10,800-second quiet duration (`AGENT_FREE_QUIET_PERIOD_SECONDS = 10800`).
   - Startup fail-closed validation via `IdleSuspendConfig::validate()`.
   - Runtime mutation rejection via `validate_timing_pair_for_policy()` on `PATCH /api/system/idle-suspend/v1/timing` (400 Bad Request without side effects).
   - UI settings presentation: `quietPeriodSeconds` rendered as fixed/read-only 3 hours, while `wakeAfterSeconds` remains operator-configurable within [60, 86400] seconds.
   - Continuous qualification: requires all in-scope agents continuously `idle` or `blocked` for strictly `> 10,800` seconds (`now_ms > free_since_ms + 10_800_000`).
   - Invalidation & deferral: reset on `working`/`unknown`/unobserved matching agents or terminal input; 10,800s deferral on user denial, 60s timeout, or last-client disconnect.
3. **Public Client Presence Tracking**:
   - Tracks authenticated public `/ws` sessions through upgrade, liveness, and teardown.
   - Excludes private OMP reporter sockets, hook UDS, REST polling, and resource SSE.
   - Zero clients allows automatic final admission; connected clients receive one server-owned consent request.
4. **Consent Lifecycle Arbitration**:
   - Any enabled authenticated user's approval suffices; first valid server-accepted decision wins.
   - Immediate entry into final checks on approval (no delay, no quorum).
   - Refusal/timeout/client-loss defers 3 hours; contrary answers return `409 decisionAlreadySettled`.
5. **DTO Specifications & Wire Contracts**:
   - Strict camelCase naming, strong typing, and `#[serde(deny_unknown_fields)]` on request payloads.
   - Authoritative status snapshot (`IdleSuspendStatusV1`) with mutual exclusion between `activity` (`agent-activity` only) and `agentFree` / `clientPresence` (`agent-free` only).
   - `IdleSuspendAgentFreeStatusV1` with typed phase enum, inventory state, revision tracking, nullable counts (`null` for unknown, never fabricated `0`), and monotonic timestamps.
   - `IdleSuspendClientPresenceStatusV1` with connection and pending upgrade counts.
   - `IdleSuspendConsentStatusV1` without leaking actor IDs or socket decision secrets in GET snapshots.
   - Socket-private frame `UiConnectionFrame` (`{"kind":"host:uiConnection","version":1,"connectionId":...,"decisionCapability":...}`).
   - `POST /api/system/idle-suspend/v1/consent/decision` contract, 16 KiB limit, and closed error codes.
   - `PATCH /api/system/idle-suspend/v1/timing` contract and response.
6. **Canonical Admission Lock Order & Concurrency Invariants**:
   - Order: `ClientPresenceRegistry` (outer) -> `PtySessionManager::inner` (middle) -> `AgentStatusRuntime::registry` (inner).
   - Invariants: Never hold locks across `.await`, Tokio channel dispatch, filesystem I/O, database queries, or procfs/network inspection.
   - Never acquire in reverse order.
   - Asynchronous authentication, database verification, and fresh process sampling complete before acquiring the admission fence.
   - Single-direction coarse-to-fine acquisition prevents deadlocks across WebSocket, PTY, and agent telemetry lifecycles.

---

## 3. Gaps Identified & Forward-Looking Coverage

1. **Subsequent Phase Documentation**:
   - Phase 02 (Managed terminal process discovery and continuous semantic authority) will require detailed documentation in `docs/architecture/` once implemented.
   - Phase 03 (WebSocket client presence and session binding) will require documentation in `docs/ws-protocol-guide.md` once public socket lifecycle hooks land.
   - Phase 05 (UI components and consent dialog) will require UI documentation in `docs/frontend-components/`.
2. **Current Alignment**:
   - All Phase 01 interfaces in Rust and TypeScript are 100% synchronized with `docs/system-architecture.md`.

---

## 4. Recommendations

1. **Keep Proposed Tag Until Hardware Qualification**: Retain `Proposed:` prefix in section heading until Phase 06/07 end-to-end integration and hardware qualification complete.
2. **Phase 02/03 Implementation**: Proceed to Phase 02 (Agent inventory and semantic authority) and Phase 03 (WebSocket presence tracking).

---

## 5. Metrics

- **LOC Limit Management**:
  - `docs/system-architecture.md`: 283 LOC (well under the 800 LOC ceiling).
- **Validation Script**:
  - `node .omp/evcrate/scripts/validate-docs.cjs docs/`: 0 blocking errors.
- **Code & Test Alignment**:
  - Rust backend tests: 194 passed, 0 failed.
  - UI client tests: 31 passed, 0 failed.
  - TypeScript type check: 0 errors.

---

## 6. Unresolved Questions

None.
