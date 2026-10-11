# Docs Manager — Phase 04 Three-Hour Coordinator, Immediate Consent, and Final Handoff Report

- **Date**: 2026-10-11
- **Phase**: Phase 04 — Three-hour coordinator, immediate consent and final handoff
- **Plan**: `plans/261010-1746-host-resources-auto-sleep/`
- **Branch**: `feat/host-resources-auto-sleep`
- **Status**: Complete (Advisory Report)
- **Authorized Docs Updated**:
  - `docs/system-architecture.md`
  - `docs/api/idle-suspend.md`
- **Report Path**: `plans/reports/docs-manager-261011-phase-04-documentation.md`
- **Protected Sealed Paths**: Untouched
  - `plans/261010-1746-host-resources-auto-sleep/plan.md`
  - `plans/261010-1746-host-resources-auto-sleep/reports/phase-01-completion-receipt.md`
  - `plans/261010-1746-host-resources-auto-sleep/reports/phase-02-completion-receipt.md`
  - `plans/261010-1746-host-resources-auto-sleep/reports/phase-03-completion-receipt.md`

---

## 1. Executive Summary & Assessment

Phase 04 implementation delivers the core coordination engine, public client presence branching, atomic first-valid consent arbitration, pre-dispatch actor verification, the fresh final-check pipeline, and privacy-preserving audit trail for the semantic `agent-free` automatic sleep policy.

Documentation in `docs/system-architecture.md` and `docs/api/idle-suspend.md` has been updated to comprehensively record Phase 04 architecture, contracts, API endpoints, and redaction invariants:
1. **Three-Hour Coordinator Engine**: Strict continuous quiet epoch (`> 10,800s`), monotonic deadline measurements, and zero-agent boot tracking.
2. **Presence Branching**: Zero-client automatic final check, live-client consent prompt generation, and pending-upgrade synchronization.
3. **Consent Arbitration & Immediate Transition**: Atomic first-valid decision latching, duplicate idempotency, contrary decision conflict rejection, immediate approval final check dispatch (bypassing the 60s timeout), and refusal deferral.
4. **Timeouts & Deferrals**: 60-second unanswered consent expiration, last-client disconnect cancellation, and pre-dispatch database actor invalidation each deferring for `> 10,800s`.
5. **Fresh Final Check Pipeline**: Pre-execution process discovery re-sample, semantic evaluation, provisional PTY handoff acquisition, and client presence fence acquisition before helper dispatch.
6. **Protected Consent API**: `POST /api/system/idle-suspend/v1/consent/decision` with 16 KiB body limit, constant-time cryptographic capability verification, and fail-closed `--no-auth` rejection.
7. **Server Audit & Privacy Redaction**: Tamper-checked JSONL logging (`0600`, `O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK`, `sync_data`) and diagnostic bundle projection redacting actors to booleans and stripping connection IDs.

---

## 2. Phase 04 Architecture & Contracts

### 2.1 Three-Hour Quiet Interval & Continuous Quiescence

- **Strict Inequality Bound**: In production, the coordinator requires continuous quiescence exceeding 3 hours (`10,800` seconds). The boundary condition `elapsed == quiet_period_seconds` is explicitly rejected; sleep eligibility requires `elapsed > Duration::from_secs(quiet_period_seconds)`. (In unit test profiles, timing defaults to 2 seconds for determinism).
- **Monotonic Epoch Tracking**: Timing is measured against monotonic timestamps (`Instant::now()` anchored at `free_anchor`). System clock skews, NTP jumps, or wall-clock mutations cannot forge elapsed quiescence.
- **Zero-Agent Fleet Support**: Clean boot in `agent-free` mode supports an empty fleet without false-negative quiescence blockers. If 0 managed agents exist at startup, the coordinator enters `AgentFreePhase::Tracking` immediately.
- **Intervening Activity Invalidation**: Any transition of managed agents out of `Free` (such as `Working`, hook transitions, lease expiration sweeps, terminal removal, or new terminal creation) immediately clears `free_anchor`, `free_since_ms`, and `eligible_at_ms`, setting `AgentFreePhase::Blocked`.

### 2.2 Public Client Presence Branching

At the expiration of the 3-hour quiet interval, the coordinator inspects `client_presence.snapshot()`:
1. **Zero Connected Clients (`connection_count == 0 && pending_upgrade_count == 0`)**:
   - Coordinator transitions from `Tracking` directly to `AgentFreePhase::FinalCheck`.
   - Automatic execution proceeds without emitting a consent prompt.
2. **Positive Connected Clients (`connection_count > 0`)**:
   - Coordinator generates a single server-owned consent request (`ActiveConsentRequest`):
     - `request_id`: `"consent-"` followed by UUIDv4 (`Uuid::new_v4()`).
     - `request_revision`: Monotonic sequence counter (`next_consent_request_seq`).
     - `requested_at`: Monotonic `Instant::now()` and epoch ms.
     - `expires_at`: `requested_at + 60s` (`UNANSWERED_CONSENT_TIMEOUT_SECONDS`).
     - `wake_after_seconds`: Running configured wake interval.
     - `state`: `ConsentState::Pending`.
   - Coordinator transitions to `AgentFreePhase::AwaitingConsent`, publishing status via Tokio watch channel and `host:idleSuspendChanged`.
3. **Pending Upgrade Connections (`connection_count == 0 && pending_upgrade_count > 0`)**:
   - Upgrades in flight hold coordinator evaluation; coordinator remains in `Tracking` across cadence ticks until pending upgrades either complete Axum promotion or hit the 30-second reservation timeout.

### 2.3 Atomic First-Valid Consent Latch & Immediate Approval Dispatch

- **First-Valid Arbitration**:
  - The first valid decision (`Approve` or `Deny`) received from any enabled authenticated client latches atomically into `active_consent.decision` and is stored in `last_settled_consent`.
  - Submissions specifying mismatched `request_id` or `request_revision` return HTTP 409 `consentUnavailable`.
- **Conflict Rejection on Contrary Decisions**:
  - If a decision is already latched and a subsequent request arrives with a contrary decision (e.g., `Deny` after `Approve`), the server returns HTTP 409 `decisionAlreadySettled` with `{ requestId, settledDecision }` and performs zero state mutation.
- **Idempotency on Duplicate Decisions**:
  - If an identical decision arrives for an already settled request (e.g., repeated `Approve` by the same or another client), the server returns HTTP 200 OK (`Success { idempotent: true }`) without re-triggering handoff.
- **Immediate Approval Final Check Dispatch**:
  - When `Approve` is latched:
    1. Sets `active_consent.state = ConsentState::Approved`.
    2. Records `approving_connection_id` and `approving_actor`.
    3. Sets `AgentFreePhase::Approved`.
    4. Responds HTTP 200 OK to the client.
    5. **Immediately invokes `attempt_agent_free_final_check(true, ...)`**, bypassing the remainder of the 60-second unanswered timeout.
- **Refusal Deferral**:
  - When `Deny` is latched:
    1. Sets `active_consent.state = ConsentState::Denied`.
    2. Sets `AgentFreePhase::Deferred` with reason `AgentFreeReasonCode::ClientRefusal`.
    3. Defers coordinator for a full `> 10,800s` (`deferred_until = Instant::now() + quiet_period_seconds`).
    4. Clears `free_anchor`, `free_since_ms`, and `eligible_at_ms`.
    5. Responds HTTP 200 OK.

### 2.4 Timeouts, Disconnects, and Pre-Dispatch Invalidation

1. **60-Second Unanswered Consent Timeout**:
   - The coordinator cadence loop evaluates `active_consent.expires_at`.
   - If `Instant::now() >= req.expires_at` with `decision.is_none()`:
     - Sets `req.state = ConsentState::Expired`.
     - Sets `AgentFreePhase::Deferred` with reason `AgentFreeReasonCode::UnansweredTimeout`.
     - Defers coordinator for `> 10,800s` (`deferred_until = Instant::now() + quiet_period_seconds`).
     - Subsequent decision submissions return HTTP 409 `consentExpired`.
2. **Last Client Disconnect Deferral**:
   - If `client_presence.snapshot()` shows `connection_count == 0 && pending_upgrade_count == 0` while in `AwaitingConsent` or `Approved`:
     - Sets `req.state = ConsentState::Cancelled`.
     - Sets `AgentFreePhase::Deferred` with reason `AgentFreeReasonCode::LastClientDisconnected`.
     - Defers coordinator for `> 10,800s`.
     - Ensures an unobserved approval or abandoned prompt cannot suspend the machine.
3. **Pre-Dispatch Database Actor Revalidation**:
   - Before executing handoff for an approved consent, `revalidate_approving_actor` re-queries the authentication store:
     - Asserts user exists and `user.is_enabled == true`.
     - Asserts `user.auth_version` matches the token's `auth_version`.
     - Asserts session exists and `session.revoked_at.is_none()`.
     - Asserts session expiration: `chrono::Utc::now() < session.expires_at`.
     - Asserts MFA deadline: `chrono::Utc::now() < mfa_due_at` (computed via `compute_mfa_due_at`).
     - Asserts `session.credential_version` matches the token's `credential_version`.
   - Failure of any check sets `req.state = ConsentState::Cancelled`, sets `AgentFreePhase::Deferred` with reason `AgentFreeReasonCode::SafetyInvalidation`, and defers coordinator for `> 10,800s`.

### 2.5 Fresh Final Check Pipeline & Atomic Handoff

When entering `attempt_agent_free_final_check`:
1. **Fresh Process Discovery Sample**:
   - Captures current PTY snapshot via `pty_manager.capture_activity_snapshot()`.
   - Runs `process_discovery.prepare_sample` within 100ms deadline, followed by `commit_sample`.
   - Any discovery error sets `AgentFreeInventoryState::Degraded`, `AgentFreePhase::Blocked`, clears anchor, and cancels active consent.
2. **Fresh Semantic Evaluation**:
   - Evaluates managed agents via `agent_status.evaluate_managed_agents(&matched_agents, now_ms)`.
   - If `Working` or `Unknown` (expired lease, unrefreshed native provider, ambiguous owner):
     - Sets `AgentFreePhase::Blocked` with corresponding reason.
     - Clears anchor and cancels active consent.
   - If `Free`:
     - Verifies `Instant::now().duration_since(free_anchor) > quiet_period_seconds`.
3. **Provisional PTY Handoff Claim**:
   - Constructs `AgentFreeClaimTicket` capturing request ID, completions, revisions, roots, matched agent evidence, and eligibility deadline.
   - Invokes `pty_manager.try_claim_agent_free_handoff(admission)` under PTY inner lock:
     - Verifies fleet generation, input revision, session counts, and root process identities match.
     - Verifies no sessions are creating, disposing, closing, or restarting.
4. **Presence Fence Acquisition**:
   - For **zero-client flow**: invokes `client_presence.try_claim_no_client_fence(pres_rev)`. If live connections or pending upgrades arrived concurrently, releases PTY handoff, cancels automatic execution, and creates a fresh consent request instead.
   - For **approved-client flow**: invokes `client_presence.set_host_suspending(true)`.
5. **Helper Dispatch & Suspend Execution**:
   - Emits server events: `FinalCheckCompleted`, `HandoffClaimAccepted`, and `HelperRequestDispatched`.
   - Dispatches single `SuspendWithRtcWakeRequest { request_id, wake_after_seconds }` to `IdleSuspendExecutor`.
   - Transitions to `CoordinatorState::HandedOff` and `AgentFreePhase::HandedOff`.
6. **Resume / Outcome Reconciliation**:
   - Upon executor outcome (resumed or failed):
     - Releases PTY handoff: `pty_manager.release_handoff()`.
     - Releases presence fence: `client_presence.release_host_suspending()`.
     - Clears in-flight consent: `active_consent = None;`.
     - Clears anchors: `free_anchor = None; free_since_ms = None; eligible_at_ms = None;`.
     - Publishes status update and refreshes capabilities.

---

## 3. Protected Consent API Specification

### 3.1 Endpoint Overview

- **Path**: `POST /api/system/idle-suspend/v1/consent/decision`
- **Registration**: `server/src/api/router.rs`
- **Body Limit**: 16 KiB (`RequestBodyLimitLayer::new(16 * 1024)`)
- **Transport Guards**:
  - `Content-Type: application/json` required.
  - Cookie-authenticated requests require `Origin` header matching allowed origins.
- **Authentication Guards**:
  - Requires `AuthenticatedActor` from session extension.
  - Denied under `--no-auth` with HTTP 403 `consentDisabledNoAuth`.
  - Actor account must be enabled in database (`user.is_enabled`).

### 3.2 Cryptographic Decision Capability Verification

Before passing commands to the coordinator, the handler invokes:
```rust
state.client_presence.verify_decision_capability(&req.connection_id, &req.decision_capability, &actor)
```
1. **Constant-Time Verification**:
   - Server looks up `connection_id` in `ClientPresenceRegistry`.
   - Hashes candidate `req.decision_capability` using SHA-256 (`hash_capability`).
   - Compares candidate digest with stored digest using `subtle::ConstantTimeEq` to defeat timing side channels.
2. **Session Invariant Matching**:
   - Candidate `actor.subject == connection.subject`.
   - Candidate `actor.session_id == connection.session_id`.
   - Candidate `actor.auth_version == connection.auth_version`.
   - Candidate `actor.credential_version == connection.credential_version`.
   - Monotonic deadline check: `Instant::now() < connection.effective_deadline`.
3. **Closing Revocation**:
   - Connections marked `closing: true` immediately fail verification.
4. **Error Mapping**:
   - `NotFound` -> HTTP 404 `connectionNotFound`.
   - `Closing`, `CapabilityMismatch`, `SubjectMismatch`, `SessionMismatch`, `AuthVersionMismatch`, `CredentialVersionMismatch`, `DeadlineExpired` -> HTTP 403 `invalidCapability`.

### 3.3 Request & Response Schemas

#### Request Payload (`ConsentDecisionRequest`)
Strict JSON schema; unknown fields forbidden (`deny_unknown_fields`).
```json
{
  "requestId": "consent-550e8400-e29b-41d4-a716-446655440000",
  "requestRevision": 1,
  "connectionId": "550e8400-e29b-41d4-a716-446655440001",
  "decisionCapability": "550e8400-e29b-41d4-a716-446655440002",
  "decision": "approve"
}
```

| Field | Type | Constraints | Description |
|---|---|---|---|
| `requestId` | string | 1..=64 chars, non-empty | Active consent request UUID |
| `requestRevision` | integer (`u64`) | monotonic sequence | Issuance revision of the consent request |
| `connectionId` | string | 1..=128 chars, non-empty | UUID of the active public WebSocket connection |
| `decisionCapability` | string | 1..=128 chars, non-empty | CSPRNG capability token delivered in `host:uiConnection` |
| `decision` | string enum | `"approve"` or `"deny"` | User consent choice |

#### Success Response (`ConsentDecisionResponse`, HTTP 200 OK)
Headers include `Cache-Control: no-store`.
```json
{
  "version": 1,
  "requestId": "consent-550e8400-e29b-41d4-a716-446655440000",
  "decision": "approve",
  "statusRevision": 42,
  "settled": true
}
```

### 3.4 Status Code & Error Matrix

| HTTP Status | Error Code (`code`) | Trigger Condition |
|---|---|---|
| **200 OK** | *(none)* | Decision accepted and latched, or identical decision already settled (idempotent). |
| **400 Bad Request** | `invalidConsentPayload` | Empty fields, field lengths exceeding limits, or invalid JSON. |
| **403 Forbidden** | `invalidCapability` | Capability secret mismatch, session invariant mismatch, or deadline expired. |
| **403 Forbidden** | `consentDisabledNoAuth` | Server running with `--no-auth` bypass. |
| **403 Forbidden** | `coordinatorDisabled` | Coordinator disabled in configuration. |
| **403 Forbidden** | `actorDisabled` | Authenticated user account disabled in database. |
| **404 Not Found** | `connectionNotFound` | `connectionId` not found in `ClientPresenceRegistry`. |
| **409 Conflict** | `decisionAlreadySettled` | Consent request already settled with a contrary decision. |
| **409 Conflict** | `consentExpired` | Consent request exceeded 60-second unanswered timeout. |
| **409 Conflict** | `consentCancelled` | Consent request cancelled due to agent activity, disconnect, or safety invalidation. |
| **409 Conflict** | `consentUnavailable` | No active consent request or `requestId`/`requestRevision` mismatch. |
| **409 Conflict** | `handoffInProgress` | Suspend handoff already in execution. |
| **503 Service Unavailable** | `coordinatorShuttingDown` | Server or coordinator task is shutting down. |
| **503 Service Unavailable** | `consentUnavailable` | Coordinator channel unavailable. |
| **503 Service Unavailable** | `forceSuspendAuditUnavailable` | Server audit file write or sync failed. |

---

## 4. Server Audit Trail & Privacy Redaction

### 4.1 Server Audit Implementation (`server/src/idle_suspend/server_audit.rs`)

- **Record Structure (`ConsentAuditRecord`)**:
  - `version`: u32 (always `1`).
  - `timestamp_ms`: u64 (Unix epoch ms).
  - `actor`: string (subject/username, max 128 chars).
  - `request_id`: string (consent request UUID, max 64 chars).
  - `request_revision`: u64.
  - `connection_id`: string.
  - `decision`: `ConsentDecisionValue` (`Approve` or `Deny`).
  - `status_revision`: u64.
  - `result`: `ConsentAuditResult` (`Admitted`, `RejectedSettled`, `RejectedExpired`, `RejectedCancelled`, `RejectedCapability`, `RejectedAuth`, `RejectedConflict`).
- **Filesystem Security**:
  - Verified opening: Opened with `libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK`.
  - Ownership & permissions: Enforces regular file, file mode `0o600`, and matching `geteuid()` / `getegid()`.
  - Durability: Synchronized immediately via `file.sync_data()`.
- **Query & Retention**:
  - In-memory querying via `read_recent_consent_records(limit)` bounded by `MAX_AUDIT_RECORDS = 10_000`.

### 4.2 Diagnostics Redaction (`server/src/linux_release/diagnostics/redaction.rs`)

When diagnostic bundles are exported, `project_server_audit` projects `ServerAuditRecord::Consent` into `ProjectedServerAudit` with strict privacy preservation:
1. **Actor Identity Redaction**:
   - `c.actor` (username / subject) is never included.
   - Projected only as a boolean: `actor_present: !c.actor.is_empty()`.
2. **Connection ID Omission**:
   - `connection_id` is stripped completely; zero socket tokens exposed.
3. **Correlation ID Projection**:
   - `correlation_id` contains `c.request_id` only if it validates as a canonical UUIDv4 (`validate_canonical_uuid_v4`), otherwise omitted (`None`).
4. **Action & Result Formatting**:
   - `action`: Formatted as `"consent_approve"` or `"consent_deny"`.
   - `result`: Formatted as `"admitted"` or `"rejected"`.
   - `reason_code`: Closed strings (`"decision_already_settled"`, `"consent_expired"`, `"consent_cancelled"`, `"invalid_capability"`, `"unauthorized"`, `"conflict"`).
5. **Details Minimization**:
   - `details` contains strictly `"requestRevision={},statusRevision={}"`. Zero command lines, PIDs, terminal names, or headers.

---

## 5. Evidence & Codebase Cross-Reference

| Documented Component | Source File & Location | Verified Test / Suite |
|---|---|---|
| Agent-Free Coordinator Loop | `server/src/idle_suspend/coordinator.rs:791–1796` | `idle_suspend::test_agent_free_coordinator_startup_and_initial_status` |
| First-Valid Consent Latching | `server/src/idle_suspend/coordinator.rs:1239–1403` | `idle_suspend::test_agent_free_coordinator_consent_latch_first_yes_and_contrary_conflict` |
| Contrary Decision Conflict | `server/src/idle_suspend/coordinator.rs:1261, 1292` | `idle_suspend::test_agent_free_coordinator_consent_latch_first_no_defers` |
| Unanswered 60s Timeout | `server/src/idle_suspend/coordinator.rs:1599–1614` | `idle_suspend::test_agent_free_coordinator_consent_unanswered_timeout` |
| Last Client Disconnect Deferral | `server/src/idle_suspend/coordinator.rs:1616–1632, 2604–2617` | `idle_suspend::test_agent_free_coordinator_last_client_disconnect` |
| Zero-Client Automatic Handoff | `server/src/idle_suspend/coordinator.rs:1719–1759` | `idle_suspend::test_agent_free_coordinator_zero_client_automatic_handoff` |
| Fresh Final Check Pipeline | `server/src/idle_suspend/coordinator.rs:2556–2870` | `idle_suspend::test_agent_free_coordinator_consent_latch_first_yes_and_contrary_conflict` |
| Pre-Dispatch Actor Revalidation | `server/src/idle_suspend/coordinator.rs:2509–2554, 2619–2632` | `server/src/idle_suspend/tests.rs` |
| API Route & 16 KiB Body Limit | `server/src/api/router.rs:393–396` | `api::tests::test_idle_suspend_consent_decision_endpoint_guards_and_capabilities` |
| Consent Decision Handler | `server/src/api/idle_suspend.rs:483–647` | `api::tests::test_idle_suspend_consent_decision_endpoint_guards_and_capabilities` |
| Consent Decision Wire Types | `server/src/idle_suspend/protocol.rs:219–238` | `server/src/idle_suspend/tests.rs` |
| Consent Audit Record & Store | `server/src/idle_suspend/server_audit.rs:172–227, 380–382` | `idle_suspend::test_agent_free_server_audit_consent_record_lifecycle` |
| Diagnostics Privacy Redaction | `server/src/linux_release/diagnostics/redaction.rs:266–295` | `server/tests/idle_suspend.rs` |

---

## 6. Verification & Validation Results

1. **File Size Limit Management (`docs.maxLoc <= 800`)**:
   - `docs/system-architecture.md`: 336 LOC (limit: 800 LOC).
   - `docs/api/idle-suspend.md`: 414 LOC (limit: 800 LOC).
   - Both documentation files remain well within bounds.
2. **Documentation Validation Script**:
   ```bash
   node .omp/evcrate/scripts/validate-docs.cjs docs/
   ```
   - Analyzed 70 markdown documents.
   - Zero broken internal links introduced.
   - Zero unverified environment keys introduced.
   - Code references verified against existing implementation.
3. **Automated Test Results**:
   - Backend unit & integration tests (`cargo test idle_suspend`): **210 / 210 PASS** (0 failed, 1 ignored).
   - Backend consent decision test (`test_idle_suspend_consent_decision`): **1 / 1 PASS** (0 failed).
   - Frontend Vitest suite (`pnpm --filter @dam-hopper/ui test`): **2,771 / 2,771 PASS** across 330 files.
   - Frontend TypeScript check (`tsc --noEmit`): **0 errors, clean typecheck**.
   - Total validated test executions: **2,981 / 2,981 PASS (100%)**.
4. **Protected Path Preservation**:
   - `plans/261010-1746-host-resources-auto-sleep/plan.md` untouched.
   - `plans/261010-1746-host-resources-auto-sleep/reports/phase-01-completion-receipt.md` untouched.
   - `plans/261010-1746-host-resources-auto-sleep/reports/phase-02-completion-receipt.md` untouched.
   - `plans/261010-1746-host-resources-auto-sleep/reports/phase-03-completion-receipt.md` untouched.

---

## 7. Unresolved Questions

None. All technical specifications, security boundaries, and architectural contracts for Phase 04 are fully satisfied and documented.
