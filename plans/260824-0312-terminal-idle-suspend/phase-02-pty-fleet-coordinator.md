# Phase 02 — PTY Fleet State and Fake Idle-Suspend Coordinator

## Context links

- [Parent plan](./plan.md)
- [Phase 01](./phase-01-policy-config-security-gate.md)
- [System architecture](../../docs/system-architecture.md#server-authoritative-terminal-idle-suspend-planned-security-gate-required)
- [Terminal lifecycle research](./research/researcher-02-terminal-lifecycle-report.md)
- [Backend PTY scout](./scout/scout-01-backend-pty-report.md)
- [WebSocket/UI scout](./scout/scout-02-websocket-ui-report.md)

## Overview

- Date: 2026-08-24
- Description: Add an incarnation-aware, content-free PTY fleet watch seam and startup-owned coordinator with ordered live timing updates, tested only with fake/unavailable execution.
- Priority: P1
- Implementation status: Pending
- Review status: Pending backend concurrency/security review

## Key Insights

- `live` is authoritative; `list()` also contains dead tombstones and cannot define no-running state.
- Create releases the PTY manager lock during slow spawn, and restart has a delayed supervisor. Both gaps must remain non-quiescent through explicit reservations.
- Session IDs are reusable. Every state mutation must reject stale `(id, incarnation/reservation)` completion and increment one monotonic fleet generation.
- Natural exit with planned restart must transfer `live -> restart_pending` atomically; otherwise a transient empty count could arm suspend.
- `/ws` output already carries terminal ID to all clients. Parsing those bytes internally would add privacy, lag, and false-idle bugs.
- A final read-only recheck is insufficient if create can start immediately after it. Final admission and helper queue acceptance need one fleet-gate ordering point.
- Timing mutation must enter the same coordinator order as final handoff. Persisting first in an API handler would allow stale timing or a post-handoff disk change.

## Requirements

### Functional

- Publish `PtyFleetSnapshot` with only monotonic generation, live count, creating count, restart-pending count, disposal/shutdown state, and handoff state.
- Expose a `tokio::sync::watch`-style receiver directly from `PtySessionManager`; initial snapshot and every safety-relevant transition must be observable.
- Define quiescent as all three counts zero and neither disposing nor handoff active. Dead/tombstone sessions are excluded.
- Reserve `creating` before releasing the lock for spawn. Complete/cancel only with the matching reservation/incarnation.
- Transfer exiting restartable PTYs into `restart_pending` without an observable empty gap; carry pending state through backoff, successful replacement, cancellation, or exhausted/failed spawn.
- Coordinator states: disabled, watching, armed, finalCheck, handedOff, suppressed, failed, resumed. Track revision and one idle-epoch identifier.
- Start an epoch only on non-quiescent to quiescent transition. After any attempt/suppression/failure/resume, require a later non-quiescent transition before another attempt.
- Cancel grace on create/restart reservation, generation change, admitted timing change, startup policy disable, unsupported capability, shutdown, or disposal.
- At deadline, claim handoff only if generation and full snapshot still match. Atomically enqueue one immutable request into a bounded single-flight executor queue.
- If final claim wins, reject new creates/restarts with a typed temporary error until enqueue failure, execution outcome, or resume reconciliation releases the gate.
- Accept complete bounded timing commands only before helper handoff. Cancel the arm, admit bounded audit, atomically persist both values, update runtime, re-read current fleet, increment status revision, then watch or re-arm from the new quiet period.
- If timing audit/persistence fails, keep/restore the prior runtime pair and re-evaluate/re-arm under it. If canonical state is ambiguous, remain unavailable and do not hand off.
- Once helper handoff is accepted, reject timing commands with `idleSuspendHandoffInProgress`; do not write audit, memory, or disk. Release timing admission only after outcome/resume reconciliation.
- Start coordinator only after persisted session restoration; shutdown must cancel and join it before PTY/persistence teardown.

### Non-functional

- Never copy terminal IDs, output, command, cwd, env, buffer, or browser identity into fleet snapshots/coordinator audit.
- Do not add work to the PTY output hot path. Lifecycle state changes may publish one coalescing watch snapshot.
- Never hold the PTY manager mutex across `.await`; final admission uses a synchronous bounded `try_send`/claim transaction.
- Use injectable monotonic clock and fake executor. Automated tests must never suspend or invoke a host command.
- Bound channel capacity, status history, errors, and timing values. No automatic retry inside one idle epoch.
- Serialize timing commands, deadline final checks, and handoff acceptance in one owner task; never hold PTY/config locks across audit or filesystem I/O.

## Architecture

- `PtyFleetState` lives under the PTY manager lock. Internal maps/tokens preserve ID/incarnation correctness; public snapshots expose counts only.
- Transition contract: `begin_create -> creating`; `publish_live -> live`; `exit_restartable -> restart_pending`; `begin_respawn -> creating/restart_pending reservation`; terminal failure/cancel removes the matching reservation; disposal forces non-armable state.
- `PtyFleetWatcher` is a direct server seam, not an `EventSink` or WebSocket consumer. Generation increments on every mutation that could invalidate idleness, even when public counts are unchanged.
- `IdleSuspendCoordinator` owns one task, cancellation token, state snapshot, epoch bookkeeping, immutable startup policy, mutable timing pair, timing command receiver, and bounded executor sender.
- Atomic final handoff pseudocode: lock fleet; verify quiescent + generation + epoch + not shutting down; mark claim; `try_send(fixed_request)`; mark handedOff on enqueue or roll back claim on failure; unlock. New starts observe the claim and cannot publish a PTY into a handed-off host.
- Timing transaction pseudocode: dequeue before handoff -> validate again -> cancel arm -> audit admission -> atomic pair persistence -> synchronous runtime/config commit -> latest fleet recheck -> revision/hint -> re-arm if quiescent. Any pre-commit failure restores prior timing behavior; ambiguous persistence latches unavailable.
- Queue order defines the winner: `UpdateTiming` dequeued first prevents that deadline from accepting handoff; `AcceptHandoff` first closes timing admission through reconciliation.
- Fake executor records request metadata and returns typed outcomes. Production remains unavailable in this phase.
- Post-outcome behavior while fleet remains empty is `suppressed/failed/resumed`, never re-arm. Any accepted non-empty reservation starts a fresh epoch after the gate is released.

## Related code files

| Absolute path | Action | Purpose | Dependencies |
|---|---|---|---|
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/pty/fleet_state.rs` | Create | Content-free snapshot/watch, generation, reservations, handoff gate | PTY manager invariants |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/pty/manager.rs` | Modify | Wire create/live/exit/restart/kill/remove/dispose transitions | Fleet state |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/pty/session.rs` | Modify if needed | Carry opaque reservation/incarnation identity, never UI data | Fleet state/manager |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/pty/mod.rs` | Modify | Export fleet snapshot/watch contracts | Fleet state |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/pty/tests.rs` | Modify | Lifecycle transition and stale-incarnation coverage | Manager integration |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/coordinator.rs` | Create | State machine, grace, epoch, final claim, shutdown/join | Phase 1 policy/executor; fleet watch |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/status.rs` | Create | Bounded internal/public status and outcome types | Coordinator/protocol |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/executor.rs` | Modify | Bounded single-flight worker plus fake/unavailable behavior | Phase 1 protocol |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/timing_store.rs` | Modify | Coordinator-owned atomic pair persistence adapter | Phase 1 store |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/timing_audit.rs` | Modify | Coordinator-owned bounded audit admission adapter | Phase 1 audit |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/tests.rs` | Create | Fake-clock/executor state-machine tests | Coordinator |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/mod.rs` | Modify | Export coordinator/status seams | New modules |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/state.rs` | Modify | Own coordinator, immutable startup policy, mutable timing seam | Coordinator |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/main.rs` | Modify | Start after restore; cancel/join before PTY teardown | AppState/coordinator |

## Implementation Steps

1. Model fleet snapshots, reservation tokens, monotonic generation, and disposal/handoff states. Specify which existing manager transition owns each update.
2. Initialize the watch sender with the real current snapshot. Add a cheap receiver/snapshot API; do not reuse `list()`.
3. Instrument create before slow spawn, success, concurrent replacement, and failure. Make stale completion tokens no-ops except diagnostics.
4. Instrument exit/restart atomically. Preserve restart-pending across backoff and transfer it without an empty fleet observation.
5. Instrument explicit kill/remove, target-unavailable/failed replacement, cleanup, and disposal. Dead tombstone sweep must not affect running counts.
6. Add temporary typed create/restart rejection while a final handoff is accepted/in flight. Ensure rejected calls do not spawn a child.
7. Implement coordinator state, revisions, epoch latch, cancellable grace, final generation recheck, atomic bounded enqueue, and one-attempt rule.
8. Add `UpdateTiming` command/result. Serialize it with final handoff; implement cancellation, audit/store transaction, runtime commit, latest-fleet recheck, revision, and exact conflict/failure outcomes.
9. Wire startup policy, mutable timing, coordinator, audit/store, and unavailable executor into `AppState`. Start only after persistence restore completes.
10. Add explicit shutdown: mark coordinator stopping, cancel timer/request before handoff, join task, then continue existing monitor/tunnel/PTY/persistence teardown.
11. Test fleet/timing/handoff transitions with fake clock/executor/store/audit, including both admission winners, I/O failures, same-pair no-op, and late stale callbacks.

## Todo list

- [ ] Add content-free fleet snapshot/watch seam
- [ ] Add create and incarnation-safe reservations
- [ ] Make exit-to-restart-pending atomic
- [ ] Cover kill/remove/failure/dispose transitions
- [ ] Add atomic final handoff admission gate
- [ ] Add ordered timing mutation transaction and conflict result
- [ ] Implement epoch/state coordinator with fake executor
- [ ] Wire startup-after-restore and shutdown-before-PTY ordering
- [ ] Add fake-clock race/state tests

## Success Criteria

- No-running means exactly zero live, creating, and restart-pending PTYs; dead tombstones and output silence never affect it.
- A restartable exit never emits an armable fleet snapshot between exit and replacement decision.
- A create during grace cancels arming. A create before final claim wins; after accepted claim it is rejected before spawn.
- Final check rejects changed generation even when counts return to the same values.
- Same-ID stale reader/respawn/reservation events cannot decrement or replace the current incarnation.
- At most one executor request occurs per idle epoch; failure/resume with an empty fleet does not loop.
- A changed timing command ordered before handoff cancels the old arm, commits one pair, bumps status revision, rechecks current fleet, and re-arms from the new quiet period when quiescent.
- Audit/persistence failure retains prior runtime behavior; accepted handoff makes timing update return exact 409 with no memory/disk mutation until reconciliation.
- Shutdown before handoff yields zero executor requests and joins coordinator before PTY teardown.
- All tests use fake time/execution; production executor remains unavailable.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Transient restart gap arms suspend | Critical | Atomic live-to-restart-pending transfer |
| New PTY starts after final check | Critical | Shared generation-fenced handoff admission; reject starts after accepted claim |
| Same ID stale callback corrupts count | Critical | Reservation/incarnation token matching and monotonic generation |
| Lock/await deadlock | High | Synchronous state mutation and bounded `try_send`; never await under manager lock |
| Event burst blocks PTY | High | Coalescing watch snapshots on lifecycle only; no output-path hook |
| Empty fleet causes retry loop | High | Epoch latch reset only after non-empty transition |
| Timing write races handoff | Critical | One coordinator order; explicit winner and post-handoff 409 |
| Timing pair diverges across disk/runtime | Critical | Audit admission, atomic pair write, synchronous commit, reconciliation latch |

## Security Considerations

- Fleet snapshots are metadata-minimal counts; coordinator never receives terminal content or browser events.
- The admission gate is availability-sensitive: return a clear temporary terminal-create error rather than spawning into a pending suspend.
- Executor channel is fixed-type, capacity one/single-flight, and cannot accept arbitrary work.
- Unknown/poisoned/closed watch or executor state suppresses action. Never interpret missing data as empty.
- Host-resource alerts and WebSocket output cannot call coordinator methods; add negative dependency tests.
- Timing commands carry only capped actor identity and the validated pair; coordinator/audit never receives bearer material or terminal/helper content.

## Next steps

- Once security/operator approval exists, connect the executor to [Phase 03](./phase-03-privileged-helper-systemd-audit.md).
- Build protected status delivery and the dedicated timing adapter/Settings UI on the tested coordinator in [Phase 04](./phase-04-rest-websocket-ui-monitoring.md).

## Unresolved questions

- Should a terminal create receive immediate `host suspend in progress` failure or a very short bounded retry hint after accepted handoff?
- Does a failed create count as the required non-empty transition for a new epoch, or only a successfully published live PTY? Recommended: reservation cancels current arm, but new epoch requires a real non-quiescent reservation transition.
- Should coordinator start immediately after restore completes or wait an additional startup stabilization interval beyond the configured quiet period?
- Which existing manager generation can be reused versus adding a dedicated fleet generation with narrower invariants?
