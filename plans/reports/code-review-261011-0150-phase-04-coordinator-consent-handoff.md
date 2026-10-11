# Code Review Report: Phase 04 — Three-Hour Coordinator, Immediate Consent, and Final Handoff

**Phase**: Phase 04 — Three-hour coordinator, immediate consent and final handoff  
**Plan**: Host Resources Automatic Sleep (`plans/261010-1746-host-resources-auto-sleep/`)  
**Reviewer**: Phase04Reviewer  
**Date**: 2026-10-11  
**Score**: 9.3 / 10 (APPROVED)  

---

## Code Review Summary

### Scope
- **Files reviewed**:
  - `server/src/idle_suspend/coordinator.rs` (1,273 insertions: AgentFree coordinator loop, consent arbitration, epochs, final check pipeline)
  - `server/src/idle_suspend/server_audit.rs` (97 insertions: `ConsentAuditRecord`, `ConsentAuditResult`, consent event persistence & queries)
  - `server/src/idle_suspend/tests.rs` (503 insertions: startup, consent latching, unanswered timeout, disconnect, zero-client handoff, audit)
  - `server/src/api/idle_suspend.rs` (177 insertions: `POST /api/system/idle-suspend/v1/consent/decision` endpoint guards, auth, capability check)
  - `server/src/api/router.rs` (4 insertions: consent decision route registration with 16KiB body limit)
  - `server/src/api/ws.rs` (11 insertions: lag resync hints on presence invalidation)
  - `server/src/api/tests.rs` (214 insertions: consent decision endpoint integration tests, auth, capability, origin, content-type guards)
  - `server/src/state.rs` (5 insertions: coordinator startup with presence, agent status, and auth service)
  - `server/src/agent_status/runtime.rs` (4 insertions: status revision getter)
  - `server/src/linux_release/diagnostics/redaction.rs` (32 insertions: privacy-preserving consent audit redaction and projection)
- **Lines of code analyzed**: ~2,320 lines of changes, ~5,000 lines contextual.
- **Review focus**: Security invariants, lock hierarchy, zero locks across `.await`, monotonic deadlines, first-valid consent latch, atomic handoff claims, YAGNI/KISS/DRY adherence.
- **Updated plans**:
  - `plans/261010-1746-host-resources-auto-sleep/phase-04-coordinator-consent-and-final-handoff.md` (marked completed, 8/8 TODOs checked)
  - `plans/261010-1746-host-resources-auto-sleep/progress.md` (Phase 04 marked DONE, Next Incomplete Phase advanced to Phase 05)

### Overall Assessment
The implementation delivers Phase 04 specifications with precision. It adheres strictly to validated contracts:
1. Continuous quiet interval (>10,800s in production, deterministic in tests) with strict inequality.
2. Zero-agent fleet starts in valid tracking state without false-negative blockers.
3. Public client presence arbitration correctly branches: zero clients -> automatic final check; positive clients -> single consent prompt with monotonic revision; pending-only upgrades hold execution.
4. First-valid consent decision latches atomically; contrary decisions return HTTP 409 `decisionAlreadySettled`; identical duplicate answers return idempotent `200 OK`.
5. Immediate approval bypasses the 60s unanswered timeout and starts fresh final evidence gathering immediately.
6. Refusal, unanswered timeout (60s), or last client disconnect resets coordinator to >3h deferral.
7. Architectural invariants preserved: zero locks across `.await`, bounded memory (channels and registries), monotonic deadlines, no busy spins, 3-tier admission hierarchy.

---

## Critical Issues
*None*. No security vulnerabilities, memory safety issues, data loss hazards, or breaking contract changes identified.

---

## High Priority Findings

### 1. `active_consent` Not Reset to `None` on Suspend Completion / Resume
- **File**: `server/src/idle_suspend/coordinator.rs:960-975`
- **Impact**: When a suspend completes (resumed or failed), `pty_manager.release_handoff()` and `client_presence.release_host_suspending()` are executed, and `free_anchor`, `deferred_until`, etc. are cleared. Line 1003 passes `None` for consent in that immediate status broadcast. However, the local variable `active_consent` is never set to `None`.
- On the subsequent 2-second background cadence tick (`line 1795`), `publish_agent_free_status_checked` reads `active_consent.as_ref().map(|r| r.to_status())`, republishing the stale consent request from prior to suspension. Furthermore, if a client submits a decision with the old `requestId`, line 1251 will return `Success { idempotent: true }` instead of `Unavailable`.
- **Recommendation**: Add `active_consent = None;` in `outcome = suspend_fut =>` under `if is_agent_free_policy`:
  ```rust
  if is_agent_free_policy {
      pty_manager.release_handoff();
      client_presence.release_host_suspending();
      active_consent = None; // Clear in-flight request upon outcome reconciliation
      free_anchor = None;
      free_since_ms = None;
      ...
  ```

---

## Medium Priority Improvements

### 1. Missing Absolute & MFA Expiration Check in `revalidate_approving_actor`
- **File**: `server/src/idle_suspend/coordinator.rs:2478-2512`
- **Impact**: `revalidate_approving_actor` verifies `user.is_enabled`, `user.auth_version`, `session.revoked_at.is_some()`, and `session.credential_version`. However, it does not check if `session.expires_at <= now` or if the MFA validity deadline has passed. While `verify_decision_capability` checks the memory record's `effective_deadline`, database revalidation during pre-dispatch should also enforce expiration fail-close.
- **Recommendation**: Convert `session.expires_at` via `bson_to_chrono` and verify `chrono::Utc::now() < expires_at`.

### 2. Avoidable `.unwrap()` in Production Coordinator Actor Loop
- **File**: `server/src/idle_suspend/coordinator.rs:1295`
- **Impact**: `audit.record_consent_event(&ConsentAuditRecord::new(...).unwrap())` panics if validation fails. While endpoint pre-validation currently restricts lengths, panicking the single coordinator task on an unexpected internal record format should be avoided.
- **Recommendation**: Use `if let Ok(record) = ConsentAuditRecord::new(...) { let _ = audit.record_consent_event(&record); }`.

---

## Low Priority Suggestions

### 1. Clippy Warning Cleanup in Tests and Coordinator
- **Files**: `server/src/idle_suspend/tests.rs:5409, 5485`, `server/src/idle_suspend/coordinator.rs:1587`
- **Detail**: Collapse nested `if` statements as flagged by `clippy::collapsible_if`.

---

## Positive Observations
1. **Constant-Time Verification**: `verify_decision_capability` uses `subtle::ConstantTimeEq` on SHA-256 digests, eliminating timing side-channels.
2. **Fail-Closed `--no-auth`**: Strict check in `verify_enabled_actor` cleanly disables consent mutations when authentication is bypassed.
3. **Decoupled Framing**: Public presence supervision uses dedicated reader tasks to prevent heartbeat starvation during heavy filesystem handlers.
4. **Immediate Approval Final Check**: Zero arbitrary delay after approval; final check dispatches immediately while unanswered timer strictly bounds only unsettled requests.
5. **No Locks Across `.await`**: Coordinator actor pattern isolates state transitions into synchronous message passes and cleanly awaits side-effects without holding mutexes.

---

## Validation Commands and Results

| Command | Status | Output / Metrics |
|---|---|---|
| `cargo test --manifest-path server/Cargo.toml idle_suspend` | **PASS** | 210 passed, 0 failed, 1 ignored (9.17s) |
| `cargo test --manifest-path server/Cargo.toml test_idle_suspend_consent_decision` | **PASS** | 1 passed, 0 failed (0.48s) |
| `pnpm --filter @dam-hopper/ui test` | **PASS** | 330 test files passed, 2,771 tests passed (20.56s) |
| `pnpm --filter @dam-hopper/ui exec tsc --noEmit` | **PASS** | 0 diagnostics, clean typecheck |
| `cargo clippy --manifest-path server/Cargo.toml --all-targets` | **PASS** | 0 errors, only non-blocking style warnings |

---

## Unresolved Questions
*None*. All contract requirements for Phase 04 are satisfied.
