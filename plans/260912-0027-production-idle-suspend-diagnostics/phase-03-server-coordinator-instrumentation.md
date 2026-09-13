# Phase 03 — Server coordinator/manual automatic instrumentation and restart-safe IDs

## Context links

- [Plan](plan.md) · [Design contract](design-contract.md) · [Phase 02](phase-02-canonical-event-foundation.md)
- [Producer research](research/researcher-01-event-audit-contract.md)
- `server/src/idle_suspend/coordinator.rs` · `server/src/state.rs` · `server/src/api/idle_suspend.rs`
- `server/src/idle_suspend/activity/sampler.rs` · `server/tests/idle_suspend.rs`

## Overview

- Date: 2026-09-12
- Description: wire one event producer into server startup; instrument authoritative coordinator transitions, decisions, dispatch/outcome/reconciliation; replace action request IDs with one restart-safe UUID correlation lifecycle.
- Priority: P1
- Implementation status: pending
- Review status: coordinator state-machine and compatibility review required
- Effort: 18h
- Ownership: one coordinator owner exclusively edits `coordinator.rs` and `state.rs`; API/test owners update their callsites after signatures freeze.
- Dependency: Phase 02 writer/types approved. Phase 04 consumes the frozen request-ID behavior.

## Key Insights

- `run_coordinator`, `handle_deadline`, `handle_outcome`, and `handle_force_suspend` are the action authority. Instrument there, not from status changes or an observer.
- Internal `SampleRequest.request_id: u64` is sampler correlation only; it must remain distinct from action UUID.
- Current automatic helper IDs `epoch-N` collide across API restarts. Manual `manual-<uuid>` is unique but prefixes are unnecessary; both modes should share one type/lifecycle.
- Measurement samples occur frequently. Only availability transitions and admission-relevant activity/rejection events belong in the stream.

## Requirements

- Construct one `IdleSuspendEventWriter` beside `DiagnosticStore` using its fixed diagnostics directory; store it in `AppState` and pass it through `start_with_sink`/`start_internal` into `run_coordinator`.
- Add an internal `AttemptContext { correlation_id, mode, started revisions/generation }`; allocate UUID v4 before `attemptStarted` for automatic candidate/manual command.
- Reuse exact UUID string in `SuspendWithRtcWakeRequest.request_id`, force-suspend accepted response, existing manual audit request ID, all server events, and later helper records.
- Emit semantic boundaries only: coordinator start, attempts, arm/cancel, availability transitions, final-check start/result, handoff claim result, dispatch, received outcome, reconciliation, terminal rejection.
- Cover automatic `empty-fleet` and `agent-activity`, manual accepted/rejected/conflict/capability/shutdown, and timing/grace/fleet/activity invalidation paths with closed reasons.
- Preserve timing/manual audit order and failure behavior. Manual audit acceptance still blocks dispatch on failure. Server semantic event failures never rewrite coordinator state or helper outcome; later gaps/open chains expose loss.
- Emit `helperOutcomeReceived` only for an actual executor result and exactly one `reconciliationCompleted` after outcome/release. Crash/open chain remains open.
- No event for each scheduled sample, status heartbeat, unchanged fleet snapshot, or repeated unavailable measurement.
- Tests use paused/fake clock, temp writer, fake executor/sampler/PTY manager; never real suspend/RTC/systemd/audits.
- Non-goals: helper audit changes, collector, status UI fields, automatic retry, new coordinator state, policy/default behavior.
- Rollback: restore prior ID generation and remove event-writer wiring only with the old server binary; protocol remains v1 and existing audit files remain. Do not delete generated event evidence.

## Architecture

- `AppState::new` creates `IdleSuspendEventWriter` at `diagnostics.log_path().parent()/idle-suspend-events-v1.jsonl`; initialization failure records a sanitized backend diagnostic and stores no writer, keeping service behavior available but future collection partial.
- `IdleSuspendCoordinator::{start,start_with_sink,start_with_sampler,start_internal}` accept optional writer; tests inject deterministic writer. `run_coordinator` owns current `Option<AttemptContext>`.
- Automatic lifecycle: candidate → UUID/`attemptStarted` → `armStarted` → final start/result → claim result → dispatch → helper outcome → reconciliation. Cancellation/rejection emits terminal event and clears context.
- Manual lifecycle: receive command → UUID/attempt → existing audit/admission gates → reject terminally or dispatch same UUID → outcome/reconciliation.
- Measurement availability transition tracks only prior available/unavailable class; reason changes inside repeated unavailable samples update status but do not generate sample-volume events unless they terminate an active attempt.
- Event writes occur outside `PtySessionManager` locks and after authoritative decisions are captured. Payload snapshots are copied bounded primitives only.

## Related code files with modify/create/delete and dependency

| Action | Path/symbol | Planned change | Dependency |
| --- | --- | --- | --- |
| Modify | `server/src/state.rs::{AppState,AppState::new,start_idle_suspend_coordinator}` | Construct/store/pass optional canonical writer at fixed diagnostics sibling path | Phase 02 writer |
| Modify | `server/src/idle_suspend/coordinator.rs::{IdleSuspendCoordinator::start,start_with_sink,start_with_sampler,start_internal,run_coordinator}` | Carry writer/attempt context; emit coordinator/action events | Phase 02 types |
| Modify | `server/src/idle_suspend/coordinator.rs::{handle_deadline,handle_outcome,handle_force_suspend}` | Return/consume explicit transition facts and one UUID; remove `epoch-N` and `manual-` generation | Frozen lifecycle |
| Modify | `server/src/idle_suspend/tests.rs` | Deterministic event chains, failures, no-per-sample volume, audit compatibility | Coordinator changes |
| Modify | `server/tests/idle_suspend.rs` | Public automatic/manual success/rejection/restart behavior and exact executor request correlation | Unit behavior stable |
| Modify if constructor callsites require | `server/src/api/tests.rs`, `server/tests/common/*` | Inject temp diagnostics paths through existing constructors; assert consumer-visible results only | `AppState` wiring |
| Inspect only | `server/src/api/idle_suspend.rs::{force_suspend,get_status}` | Response already forwards coordinator request ID; no new history endpoint | Coordinator result unchanged |
| Create | None | Use Phase 02 module | — |
| Delete | None | Preserve status/audit/protocol paths | — |

## Implementation Steps

1. Add optional writer construction to `AppState` from the injected diagnostics log parent; use exact fixed filename and sanitized failure event. Update constructor fixtures with temp diagnostics only.
2. Extend coordinator constructors serially. Keep public call ergonomics; crate-private test constructor receives injected writer/clock.
3. Add `AttemptContext` and helper functions that map concrete coordinator outcomes/activity deltas/preflight-facing executor outcomes to frozen event/reason/data variants exhaustively.
4. On startup emit `coordinatorStarted` with policy/timing/status revisions. Failure does not stop coordinator.
5. Instrument empty-fleet arm/cancel/deadline claim and agent-activity candidate/final-ticket/claim branches. Allocate one UUID at first actionable candidate and clear it only on terminal/reconciliation.
6. Track measurement availability class and emit unavailable/recovered only on transitions. Repeated samples, heartbeats, and unchanged status emit nothing.
7. Replace both automatic `format!("epoch-{}", current_epoch)` sites and manual prefixed generation with the context UUID. Keep epochs/revisions in event data.
8. Instrument manual audit/admission branches. Existing audit records receive same UUID; audit failure remains terminal before dispatch.
9. On dispatch emit before executor call; on actual response emit mapped outcome then reconcile exactly once. A semantic write error must not replace `SuspendOutcome` or prevent handoff release.
10. Add deterministic tests for quiet success; recent input/output/network; unavailable measurement/recovery; stale generation/revision; active fleet; handoff conflict; capability failure; audit failure; manual confirmation; shutdown; restart/open chain; event-write failure after action; repeated samples.
11. Run focused commands: `cargo test -p dam-hopper-server idle_suspend::tests::coordinator_`, `cargo test -p dam-hopper-server --test idle_suspend`, plus focused API manual tests. Review state/event ordering against the contract.

## Todo list

- [ ] Wire one optional writer through `AppState` and coordinator startup.
- [ ] Add one UUID `AttemptContext` for both modes.
- [ ] Instrument every authoritative transition/rejection without sample logging.
- [ ] Preserve manual/timing audit and status behavior.
- [ ] Add deterministic chain/restart/fault tests.
- [ ] Complete coordinator compatibility review.

## Success Criteria

- Quiet automatic path yields one ordered UUID chain from attempt/arm through final check, claim, dispatch, outcome, reconciliation; executor receives exactly that UUID.
- Recent input/output/network, unavailable measurement, stale revision/generation, active fleet, capability, handoff, audit, and shutdown paths end with typed private-data-free evidence and no unintended executor call.
- Manual accepted response, server audit, server event, executor request all expose one identical UUID; existing confirmation/audit gates remain observable.
- Two API process instances cannot collide through epoch reuse; prior open chain plus new producer identity is reconstructable as restart boundary.
- Repeated measurement/status samples add no events. Semantic post-action write failure preserves actual suspend outcome and reconciliation.
- Focused unit/integration commands pass with fake executor and temp files; no real host mutation.
- Review gate approves event ordering/reasons before helper/collector work consumes them.

## Risk Assessment

- State-machine instrumentation changes timing: capture bounded facts then write outside manager locks; do not refactor state transitions unnecessarily.
- Duplicate terminal events from multiple branches: centralize terminal/reconciliation emission around explicit transition results.
- Correlation cleared too early: tests assert dispatch/outcome/reconciliation identity and cancellation cleanup.
- Writer unavailable at startup: service stays functional, source absence is partial; never silently switch paths.

## Security Considerations

- Mapping functions accept only typed activity/outcome state; never serialize executor errors, actor, sampler process/socket internals, or terminal data.
- UUID returned through existing authenticated manual API is opaque and non-authorizing.
- No new API route, public WebSocket payload, credential access, or privilege.
- Audit failure behavior remains fail-closed where it already protects manual action.

## Next steps

Phase 04 enriches the existing helper audit around the same protocol-v1 UUID. Phase 05 starts only after server and helper record fixtures are reviewed stable.

## Unresolved questions

None. A missing branch-to-reason mapping reopens Phase 01 taxonomy review.
