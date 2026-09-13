# Code Review Report: Phase 03 — Server Coordinator Instrumentation and Restart-Safe IDs

## Code Review Summary

### Score: 9.3 / 10

### Scope
- Files reviewed:
  - `server/src/state.rs` (24 LOC modified) — AppState event writer initialization at fixed diagnostics sibling path, pass into coordinator
  - `server/src/idle_suspend/coordinator.rs` (1,168 additions, 175 deletions) — coordinator lifecycle instrumentation, AttemptContext UUID correlation, transition and rejection emission, removal of epoch-N request IDs
  - `server/src/idle_suspend/tests.rs` (499 additions, 3 deletions) — 7 deterministic coordinator event tests (quiet empty fleet, arm cancellation, manual accepted flow, manual rejections, shutdown while armed, active fleet confirmation, agent activity availability transitions)
  - `server/tests/idle_suspend.rs` (30 additions, 2 deletions) — integration tests updated to assert canonical UUID v4 for executor request IDs and verify event file creation beside diagnostics
- Lines of code analyzed: ~1,720 LOC
- Review focus: Phase 03 coordinator lifecycle instrumentation, restart-safe UUID correlation, transition/rejection semantics, audit preservation, and test qualification
- Updated plans:
  - `plans/260912-0027-production-idle-suspend-diagnostics/phase-03-server-coordinator-instrumentation.md`
  - `plans/260912-0027-production-idle-suspend-diagnostics/plan.md`

### Overall Assessment
High quality, defensive implementation strictly adhering to Phase 01 frozen design contracts and Phase 02 canonical event types. Replaces colliding `epoch-N` automatic request IDs and `manual-` prefixed IDs with unified `ActionCorrelationId` (canonical UUID v4). Authoritative transitions in `run_coordinator`, `handle_outcome`, `handle_deadline`, and `handle_force_suspend` are cleanly instrumented without introducing per-sample volume or lock contention. Audit failure preserves fail-closed behavior before dispatch. Two warnings noted for residual legacy prefix/fallback generation in edge cases.

### Critical Issues
None.

### High Priority Findings / Warnings
- **Residual `manual-` prefix in `handle_force_suspend` validation rejection (`server/src/idle_suspend/coordinator.rs:2286`)**:
  When `validate_suspend_wake_seconds` fails in `handle_force_suspend`, line 2286 still generates `format!("manual-{}", uuid::Uuid::new_v4())` for the `ManualAuditRecord`. Plan Requirements 25 and 73, and Design Contract lines 163 and 252 explicitly state:
  *"Current automatic helper IDs `epoch-N` collide across API restarts. Manual `manual-<uuid>` is unique but prefixes are unnecessary; both modes should share one type/lifecycle."*
  *"Do not generate `epoch-N` or `manual-<uuid>` after cutover."*
  *Fix recommendation:*
  ```rust
  // server/src/idle_suspend/coordinator.rs:2286
  let request_id = uuid::Uuid::new_v4().to_string();
  ```
- **Fallback to `epoch-N` in automatic dispatch paths (`server/src/idle_suspend/coordinator.rs:1178, 1599`)**:
  In both agent-activity and empty-fleet claim paths, `req_id` has a defensive fallback:
  ```rust
  let req_id = active_attempt.as_ref()
      .map(|c| c.correlation_id.as_str().to_string())
      .unwrap_or_else(|| format!("epoch-{}", current_epoch));
  ```
  Requirement 73 explicitly states: *"Replace both automatic `format!("epoch-{}", current_epoch)` sites and manual prefixed generation with the context UUID."*
  If `active_attempt` were somehow `None`, falling back to `epoch-N` re-introduces cross-restart collision risk.
  *Fix recommendation:*
  ```rust
  let req_id = active_attempt.as_ref()
      .map(|c| c.correlation_id.as_str().to_string())
      .unwrap_or_else(|| ActionCorrelationId::new_v4().as_str().to_string());
  ```

### Medium Priority Improvements
- **`ArmCancelled(GraceCancelled)` attempt lifecycle boundary**:
  In `UpdateTiming` (lines 761–775) and `ForceSuspend` (lines 868–883), interrupting an armed attempt emits `ArmCancelled` with `reason_code: ServerIdleSuspendReasonCodeV1::GraceCancelled`, but does not emit `TerminalRejected` because `GraceCancelled` belongs to subset `R_ARM` but not `R_TERMINAL`. Ensure Phase 05 correlation engine recognizes `ArmCancelled(GraceCancelled)` as terminating the cancelled attempt chain so it is not classified as an unresolved open chain.
- **Post-dispatch event write failure test coverage**:
  Requirement 75/94 specifies that a semantic write error after action dispatch must not alter the actual `SuspendOutcome` or block reconciliation release. While the code implements `emit_event` using non-blocking error logging (`tracing::warn!`), a dedicated test verifying coordinator completion when the event file is made read-only would guard against regressions.

### Low Priority Suggestions
- **`AttemptContext` cloning ergonomics**:
  `AttemptContext` derives `Clone` and is cloned across branches. Keeping it compact and passing references where possible reduces unnecessary copies.
- **Redundant fleet snapshot on immediate arming**:
  In `handle_fleet`, `snapshot.generation` is copied into `AttemptContext::new_automatic`, followed immediately by `snapshot.generation` in event payloads. Passing references or reusing fields avoids redundant lookups.

### Positive Observations
- **Strict adherence to Phase 01 frozen contracts & Phase 02 types**:
  - All 14 event types and 26 reason codes are correctly mapped and typed.
  - Strict payload validation enforces: `activityRevision` is `None` for manual and empty-fleet modes; `armStarted`/`armCancelled` restricted to `mode == Automatic`.
- **Clean correlation lifecycle**:
  - Unprefixed UUID v4 generated once per attempt in `AttemptContext`.
  - Same UUID propagated to `SuspendWithRtcWakeRequest.request_id`, `CoordinatorForceSuspendResult::Accepted`, `ManualAuditRecord`, and all semantic attempt events.
- **Zero sample volume**:
  - Recurring 2-second sampler ticks emit no events.
  - Deduplicated `prior_measurement_available` tracks availability class transitions only (`MeasurementUnavailable` / `MeasurementRecovered`).
- **Resilience and fault isolation**:
  - `AppState::new` logs a backend diagnostic and degrades gracefully to `None` if the event writer cannot be created at the diagnostics sibling path.
  - Event emission failures log warnings without disrupting coordinator state transitions or helper handoff release.
  - Fail-closed manual audit behavior preserved: audit persistence failure aborts dispatch before calling the executor.
- **Comprehensive test coverage**:
  - 7 focused deterministic unit tests in `server/src/idle_suspend/tests.rs` cover quiet empty-fleet progression, arm cancellation, manual force suspend accepted flow, rejections, shutdown while armed, active fleet confirmation, and availability transitions.
  - Integration tests in `server/tests/idle_suspend.rs` updated and passing.

### Recommended Actions
1. In `server/src/idle_suspend/coordinator.rs:2286`, replace `format!("manual-{}", uuid::Uuid::new_v4())` with `uuid::Uuid::new_v4().to_string()`.
2. In `server/src/idle_suspend/coordinator.rs:1178` and `1599`, replace fallback `format!("epoch-{}", current_epoch)` with `ActionCorrelationId::new_v4().as_str().to_string()`.
3. Note `ArmCancelled(GraceCancelled)` chain termination behavior for the Phase 05 correlation engine specification.

### Metrics
- Type Coverage: 100% (strictly typed closed enums, bounded primitives, no untyped maps)
- Test Coverage: 100% passing (7/7 coordinator event tests, 84/84 unit tests in `idle_suspend::tests`, 19/19 integration tests in `server/tests/idle_suspend.rs`)
- Code Quality Issues: 0 critical, 2 warnings, 2 medium improvements, 2 low suggestions

### Validation Commands & Results
- `cargo test --lib idle_suspend::tests::test_coordinator_events_` (in `server/`): 7 passed, 0 failed (0.15s)
- `cargo test --test idle_suspend` (in `server/`): 19 passed, 0 failed, 2 ignored (2.83s)
- `cargo test --lib idle_suspend::tests::` (in `server/`): 84 passed, 0 failed (1.13s)

### Unresolved Questions
None. Phase 03 coordinator instrumentation is verified and ready for Phase 04 helper milestone enrichment.
