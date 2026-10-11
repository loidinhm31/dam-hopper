# Phase 01 — Coordinator admission and cooldown

## Context links
- [Overview](plan.md); [Phase 02 evidence](phase-02-process-retention-and-semantic-freshness.md); [Phase 03 presence](phase-03-websocket-presence-and-backpressure.md).
- [Original contracts: timer, consent, final admission](../261010-1746-host-resources-auto-sleep/contracts.md#semantic-evidence-and-timer).
- [Architecture and canonical lock order](../../docs/system-architecture.md#semantic-agent-free-automatic-sleep); [API](../../docs/api/idle-suspend.md); [automatic admission](../../docs/agent-activity-automatic-admission.md).

## Overview
- Date: 2026-10-11. Priority: P1. Estimated effort: 10h.
- Implementation: complete. Review: complete. Validation: passed.
- Issues: **1** approving socket can disappear during asynchronous auth/final preparation; **2** refusal currently waits two quiet intervals; **3** fresh ticket can reuse an old free anchor after an intervening non-free generation.

## Key Insights
- `coordinator.rs:2603–2619` checks liveness only before awaiting auth; `2807–2809` later sets host-suspending without validating that same socket.
- `2861–2863` stores an unpolled executor future. Creating it is not helper dispatch. Production executor also awaits socket connect (`helper_client.rs:69`) before sending (`72`).
- Deny clears `free_anchor` at `1383–1391`; Free samples do not establish another anchor while deferred (`1671–1679`). At cooldown expiry (`1565–1575`), another three-hour timer starts.
- The cadence generation check (`1577–1597`) is not executed by approval's immediate final-check path. Ticket/admission fields at `2735–2760` are both populated from the same fresh evaluation, so equality is tautological rather than proof of uninterrupted eligibility.
- Existing docs prescribe presence → PTY → registry order (`system-architecture.md:322–329`); do not invent a reverse lock order or hold locks through auth/helper I/O.

## Requirements
### Functional
- Recheck the original approving connection, closing state, session bindings and deadline at final commit and again at the actual executor dispatch boundary after asynchronous preparation.
- Socket loss before commitment cancels authorization even when another client stays live; never convert it into the zero-client route or migrate it to a replacement socket.
- Bind every free epoch and consent request to its originating `non_free_generation`; any change resets the full quiet interval and cancels old automatic intent.
- Deny, unanswered timeout, and pre-dispatch connection loss impose one full new >10,800s continuously qualified-free wait. Work/Unknown during that wait starts a later interval.
- Preserve first-decision arbitration and existing manual/legacy-policy behavior; approved joins need no quorum, but zero-client joins invalidate that route.
### Non-functional
- One coordinator and one helper request; bounded attempt state, typed rejection/cancellation, no background retry service.
- No allocative per-tick copies of complete inventory; transfer prepared evidence into the one final attempt.
- Epoch timestamps remain projections, not admission predicates.

## Architecture
### Qualified free epoch and deferral
Replace independent unbound free-anchor bookkeeping with a small private `FreeEpoch { since: Instant, since_ms: u64, non_free_generation: u64 }`, or equivalent colocated fields with one reset helper. Keep existing DTO field names.

- On refusal/invalidation requiring deferral at `t0`: clear the previous epoch; set `deferred_until = t0 + quiet`; retain denied/cancelled/expired consent for truthful status.
- Continue inventory/semantic qualification during deferral. First qualified Free establishes a new epoch **during** cooldown; subsequent Free keeps it only if its generation matches.
- Eligibility is `now > max(epoch.since + quiet, deferred_until)` after verified Free. At exact equality, no handoff. Cooldown expiry must not erase an already qualified epoch.
- Working/Unknown, incomplete scan, input/lifecycle mutation or generation advance resets the epoch. A renewed same-state lease or Idle ↔ Blocked does not.
- Public `eligibleAtMs`/`deferredUntilMs` reflect those respective monotonic deadlines; cancelled approval may retain `decision: approve` as history, but lifecycle stays cancelled.

### Atomic presence and semantic commit
Add a narrow approved-presence fence beside `try_claim_no_client_fence`, not a standalone liveness boolean:

`with_approved_connection_fence(connection_id, approving_actor, commit_closure)` locks presence, verifies the exact live/nonclosing record and actor invariants, then runs a bounded synchronous closure. Closure acquires PTY manager inner, then semantic registry read; it verifies current fleet/input/root/timing/epoch/semantic evidence and changes attempt state to dispatch-committed only on success. Set host-suspending under the same presence guard. Do not expose mutex guards publicly.

- Preserve caller order for reporter mutations (`reporters → credentials → registry`); the final closure never acquires reporter/credential locks. Audit PTY retirement paths for inverse acquisitions before wiring this method.
- Registry validation recomputes current lease/free authority using Phase 02 monotonic evidence, not merely matching ticket scalars. Compare live generation to **epoch generation**, then ticket generation to that same value.
- PTY manager's current admission (`manager.rs:1288–1295`) must compare against independently read current evidence supplied under the lock, not accepted values copied from the ticket.
- Apply the same serialized final closure to zero-client admission. Existing presence CAS remains authoritative even if watch delivery coalesces.

### Dispatch boundary
Use one private typed automatic dispatch authorization carried by the existing executor path. Update executor implementations and test executors together; no deprecated execution shim.

1. Fresh scan/auth happen outside locks; capture request identity, qualified epoch generation, matched evidence, approving socket/actor or zero-client mode, timing/fleet/input fences and provisional claim.
2. A provisional claim is still cancellable. Queueing the future must not emit `HelperRequestDispatched` or promise irreversible handoff.
3. Production executor connects/prepares the helper frame outside locks. Immediately before invoking its first helper request write, consume the single-use authorization through the final synchronous commit above; no further asynchronous preparation between commit and write initiation. Failure sends **no suspend frame** and returns typed pre-dispatch cancellation to coordinator.
4. This consumption is the documented linearization point: subsequent disconnect/decision is too late. No lock remains held during write/response await; partial send is never retried as a fresh automatic attempt.
5. Recording executor consumes authorization at its recording boundary. Unavailable executor never authorizes a successful dispatch. Manual requests use their existing admission, not automatic consent.
6. Emit dispatched/handed-off facts only at actual committed execution, using an existing coordinator completion/notification channel if needed. On precommit cancellation, release PTY/presence claims exactly once and publish cancelled/deferred or blocked status with the established reason.

## Related code files
Paths relative to repository root; ranges identify researched symbols, not patch offsets.

| Action | File and lines | Purpose |
|---|---|---|
| Modify | `server/src/idle_suspend/coordinator.rs:690–707,1329–1403,1565–1690,2557–2878` | Bound free epoch, unified deferral, fresh final checks, provisional vs committed attempt |
| Modify | `server/src/idle_suspend/client_presence.rs:371–442,503–554` | Exact approving-socket fence; compose after Phase 03 publication refactor |
| Modify | `server/src/pty/manager.rs:1269–1351` | Locked final validation/claim with current semantic proof |
| Modify | `server/src/idle_suspend/activity/sampler.rs:243–320` | Epoch-bound claim evidence; migrate affected constructors |
| Modify | `server/src/agent_status/runtime.rs:766–786` | Narrow locked semantic validation; implementation shared with Phase 02 |
| Modify | `server/src/idle_suspend/executor.rs:11–21,82–109,148–166` | Single-use authorization at dispatch; all implementors/callers migrated |
| Modify | `server/src/idle_suspend/helper_client.rs:63–88` | Authorize after connection preparation, before first request write |
| Modify | `server/src/idle_suspend/tests.rs:5090–5349` | Extend coordinator recording-executor regression harness |
| Modify | `docs/system-architecture.md:293–329`, `docs/api/idle-suspend.md`, `docs/CHANGELOG.md` | Accurate cooldown, provisional/commit boundaries, lock discipline |

No new production service or deleted file; remove obsolete duplicate reset/deferral logic and false pre-dispatch events in the touched paths. Update other executor implementations located by references, including integration-test executors.

## Implementation Steps
1. Enumerate epoch resets, deferral causes, both final-check callers, executor implementors and claim release paths. Freeze shared interfaces with Phases 02/03; audit actual lock graph against existing architecture.
2. Implement the bound epoch and one deferral transition. Sample while deferred, preserve valid newly accumulated continuity at expiry, and enforce strict >quiet everywhere, including PTY admission.
3. Reconcile live non-free generation in the approval command path before using the old epoch, after auth await, after fresh scan and at final dispatch authorization. Reject mismatches even when current aggregate is Free.
4. Add exact approved socket fence; verify binding and host-suspending under one presence lock. Compose PTY/registry checks in canonical order; keep all blocking work outside.
5. Move automatic executor commitment to the helper-write boundary; implement typed cancelled outcome and coordinator state/claim cleanup. Keep historical decision separate from authorization state.
6. Add deterministic barriers around auth return, final-scan completion, provisional claim, executor first poll, and helper connect completion. Test real concurrency, not only cadence status transitions.
7. Update current docs/changelog with exact timing/linearization behavior. Preserve earlier plan/report snapshots.
8. Main agent runs targeted/full gates after all phase edits land; planner runs none.

## Todo list
- [x] Bind free epoch/request/attempt to original non-free generation.
- [x] Consolidate deferral and track new Free continuity during cooldown.
- [x] Add exact approved-connection atomic commit fence.
- [x] Guard real executor dispatch; release every provisional claim on rejection.
- [x] Cover race/timing/legacy paths and update normative docs.

## Success Criteria
| Regression | Required observable result |
|---|---|
| Approver disconnects during delayed auth; sibling remains | Cancelled approval; zero executor/helper suspend requests |
| Same loss after scan, after provisional claim, before executor poll or during helper connect | Zero suspend frames; both claims released; no replacement-socket authority |
| Generation changes Working → Idle before cadence sees it, then user approves | Old request cancelled; new full interval; zero dispatch |
| Generation changes after final sample or claim | Final authorization rejected despite currently Idle row |
| Deny at `t0`, continuously Free | No request at exactly `t0+10800s`; next qualifying tick after boundary opens one new request, not after six hours |
| Unknown/work during cooldown | New interval anchored only after recovery; deadline extends correctly |
| Timeout/disconnect deferral | Same one-interval semantics; no zero-client bypass of the abandoned request |
| Unchanged qualified approval; joining sibling | Exactly one immediate dispatch; duplicate Yes idempotent, contrary No conflicts |
| Zero-client join races, manual/legacy paths | Existing fences and policies preserved |

Suggested main-agent commands: `cargo test --manifest-path server/Cargo.toml --lib agent_free`; then full `cargo test --manifest-path server/Cargo.toml`. Use explicit `Instant` advancement in domain tests or injected monotonic time; Tokio paused time alone does not advance `std::time::Instant`.

## Risk Assessment
- **Deadlock:** nested new callback could invert PTY/registry retirement order. Audit every nested caller, keep callbacks bounded and lock ownership private.
- **False dispatch evidence:** production connect is asynchronous whereas current fake records synchronously. Put authorization at both real and recording boundaries; assert helper received frames.
- **Partial helper write:** irreversible request cannot be safely replayed. Existing request correlation/deduplication remains; surface failure and reconcile, never auto-retry.
- **State drift:** many standalone fields currently reset independently. Centralize touched epoch/deferral transitions without a wholesale coordinator rewrite.

## Security Considerations
- Preserve async account/session/MFA revalidation; socket fence supplements it, not replaces it. Auth-store failure fails closed.
- Connection ID is not sufficient proof: verify captured actor/session/auth/credential versions and closing/deadline under presence lock; never expose capability secrets in new attempt Debug/status/events.
- No sleeps, auth/database reads, procfs scans or helper I/O under synchronous admission locks.
- Late decision after committed dispatch cannot cancel; earlier safety invalidations must revoke authorization regardless of first-answer arbitration.

## Next steps
Integrate Phase 02 evidence/time contract and Phase 03 ordered presence mutations before backend qualification. Pass authoritative cancelled-approval status fixtures to Phase 04. Parent owns execution, verification and final publication.

## Unresolved questions
None blocking. Actual physical suspend/resume stays outside recording/loopback test claims.
