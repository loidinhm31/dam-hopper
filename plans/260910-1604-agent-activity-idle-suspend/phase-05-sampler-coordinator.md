# Phase 05 — Transactional sampler and automatic admission coordinator

## Context links

- [Plan](plan.md), [normative design contract](design-contract.md), [repository findings](research/repository-findings.md).
- Prerequisites: [Phase 01 policy/configuration](phase-01-policy-contracts.md), [Phase 02 PTY evidence/input gate](phase-02-pty-observation.md), [Phase 03 process discovery](phase-03-process-discovery.md), [Phase 04 TCP observation](phase-04-tcp-observation.md).
- Consumer: [Phase 06 protected API/UI](phase-06-api-ui.md). Integrated evidence: [Phase 07 verification](phase-07-verification.md).
- Current runtime seams: [`server/src/idle_suspend/coordinator.rs`](../../server/src/idle_suspend/coordinator.rs), [`status.rs`](../../server/src/idle_suspend/status.rs), [`policy.rs`](../../server/src/idle_suspend/policy.rs), [`server/src/pty/manager.rs`](../../server/src/pty/manager.rs), [`fleet_state.rs`](../../server/src/pty/fleet_state.rs), [`server/src/state.rs`](../../server/src/state.rs), [`server/src/main.rs`](../../server/src/main.rs).
- Existing status fallback/API: [`server/src/api/idle_suspend.rs`](../../server/src/api/idle_suspend.rs). Existing library tests: [`server/src/idle_suspend/tests.rs`](../../server/src/idle_suspend/tests.rs).

## Overview

- Date: 2026-09-10.
- Description: combine PTY, process and TCP evidence transactionally in one cooperative worker, keep final sampling asynchronous, add a manager-locked agent-policy claim, and project bounded same-sample failure evidence into the protected measurement warning.
- Priority: P1. Estimated implementation effort: 20h.
- Implementation status: DONE (2026-09-11). Review status: Code review complete (approved with fixes for eligibility deadline, epoch spent status latching, MT-safe account resolution, and debug log cleanup).
- Progress: 100% (27/27 implementation steps; 20/20 todo items).
- Validation: 1031/1031 server tests passed; 131/131 idle_suspend tests passed; 7/7 sampler tests passed; 7/7 manager fence tests passed.
- Evidence: [Test report](../reports/tester-260911-0847-phase05-transactional-sampler-admission-coordinator.md) · [Code review](../reports/code-review-260911-0849-phase05-transactional-sampler-coordinator.md) · advisor checkpoint verified.
- Dependencies: Phases 02–04 behavior and types must be implemented and frozen. Phase 02 hands `manager.rs` ownership to this phase; Phase 03 hands `activity/mod.rs` ownership to this phase. Phase 04 retains ownership only of TCP/netlink implementation files.

## Key Insights

- Current deadline handling enters `finalCheck` and synchronously calls the empty-fleet claim. Agent mode requires a genuinely new full process/socket sample. Awaiting that scan inline would block timing, manual-force, invalidation, and shutdown commands.
- A timeout around `spawn_blocking` or a detached thread does not stop a kernel-stalled procfs syscall. The safety guarantee is acceptance denial after one second, cooperative cancellation between bounded operations, no overlapping workers, and a real join before PTY teardown—not impossible hard syscall cancellation.
- Process retention and TCP counter baselines are stateful. If process preparation succeeds but TCP preparation fails, committing process state would make the next pass compare incompatible generations. Both preparations must commit back-to-back only after the whole request remains current.
- “New observation” is not “new activity.” Scheduled sequence changes every complete attempt; `activity_revision` changes for genuine activity or required baseline/recovery reset; `epoch_activity_revision` changes only for genuine activity that may authorize another automatic epoch.
- Outcome/resume invalidates comparability but not ownership knowledge. Exact retained descendants, terminal identities/raw-output handles, and socket continuity survive root removal and baseline invalidation. Re-discovery or re-enumeration during recovery starts a quiet baseline; it never grants a new spent epoch.
- Raw output can occur between polls, not only while a process/netlink scan is running. The sampler therefore owns the previous accepted end checkpoint per exact terminal incarnation/Arc and compares the next sample's start and end against it; start-versus-end alone would silently miss inter-sample bytes.
- Agent policy permits live ordinary/service terminals. Therefore its claim cannot call the manual forced path and cannot call the existing empty-fleet quiescence path. It needs a separate private method that admits live sessions only after exact activity fences and lifecycle blockers pass.
- Startup `enabled` controls automatic execution, not observation or manual force. `agent-activity` starts the observer even with `enabled = false`; state remains `disabled`, no arm deadline exists, and no automatic executor request can occur.
- Public status must change on meaningful state/count/reason/deadline facts, not every 2-second sample. Latest sample timestamps may still be visible on a live GET with the same status revision.
- Warning detail validity and blocked-interval continuity are different state. Every unavailable result replaces details from current qualified evidence, while one monotonic onset survives cause/PID changes; only a complete available observation clears it.
- A TCP preparation error must be enriched from the same still-uncommitted `PreparedProcessSample`. Re-scanning after failure could bind a different PID generation, and discarding that prepared process evidence would make attributable socket failures needlessly opaque.
- PID and safe executable identity have one narrow disclosure path: `activity.measurementWarning.processes` on the existing authenticated, `no-store` GET and its escaped UI. They remain forbidden in logs, audit records, errors, telemetry and WebSocket hints.

## Requirements

### One-worker sampling and timing

1. Start exactly one activity worker when startup `automatic_policy == AgentActivity`, including when `enabled == false`. Start no activity worker under `EmptyFleet`.
2. The worker owns the only mutable `ProcessDiscovery` and `TcpObserver`. No per-tick task/thread creation, overlapping sample, detached timeout work, alternate collector, or second baseline owner.
3. Scheduled cadence is fixed internal 2 seconds. Per-request acceptance deadline is `issued_at + 1 second`; accepted observation age is at most 5 seconds. Scheduling uses monotonic `Instant` only.
4. Coordinator sends bounded `SampleRequest`s without awaiting work in its select branch. Scheduled ticks coalesce/drop while an equivalent scheduled request is running or queued; they never accumulate an unbounded backlog.
5. At an eligible deadline, enter `FinalCheck`, publish that meaningful state, mint a new request ID, and enqueue one `Final` sample issued after entry. A recent cached/scheduled sample cannot substitute.
6. If a scheduled request is still executing, mark it obsolete/cooperatively cancelled and queue the one final request behind it on the same worker. Its original one-second deadline still applies. A stalled predecessor may therefore make the final result late/unavailable; never start a second worker to “meet” the deadline.
7. Final sampling is asynchronous. While it runs, the coordinator continues selecting timing commands, manual force commands, manager activity/lifecycle invalidation, sampler results, executor outcome, and shutdown.
8. A result is accepted only if request ID/kind are current, `completed_at <= request.deadline`, `now - completed_at <= 5 seconds`, and every request fence still matches. A late result is `scanTimeout`/unavailable and cannot claim even if the worker later returns complete data.
9. Check cooperative cancellation and the shared deadline before/between bounded procfs loops and reads. TCP netlink uses nonblocking/deadline-aware I/O. Never claim that cancellation interrupts an in-progress kernel syscall.
10. Shutdown closes automatic admission, invalidates queued/final requests, requests cooperative cancellation, and joins the one worker and coordinator before PTY teardown. A kernel-stalled syscall can delay join indefinitely; target-host normal sample/join latency is a rollout gate, not a reason to detach.

### Frozen Phase 03/04 transaction

11. Consume these exact Phase 03 interfaces; do not rename or recreate them:

```rust
fn ProcessDiscovery::prepare_sample(
    &self,
    pty: &PtyActivitySnapshot,
    agents: &AgentExecutableSet,
    deadline: Instant,
) -> Result<PreparedProcessSample, ActivityUnavailable>;
fn PreparedProcessSample::sample(&self) -> &ProcessSample;
fn ProcessDiscovery::commit_sample(
    &mut self,
    prepared: PreparedProcessSample,
) -> ProcessSample;
fn ProcessDiscovery::invalidate(&mut self);
```

12. Consume exact Phase 04 equivalents:

```rust
fn TcpObserver::prepare_sample(
    &self,
    owned: &OwnedSocketSet,
    deadline: Instant,
) -> Result<PreparedNetworkSample, ActivityUnavailable>;
fn PreparedNetworkSample::sample(&self) -> &NetworkSample;
fn TcpObserver::commit_sample(
    &mut self,
    prepared: PreparedNetworkSample,
) -> NetworkSample;
fn TcpObserver::invalidate(&mut self);
```

The common private failure/evidence contract is also frozen and is consumed verbatim:

```rust
pub(crate) struct ActivityUnavailable {
    pub(crate) reason: ActivityUnavailableReason,
    pub(crate) retryable_close_race: bool,
    pub(crate) context: FailureContext,
}

pub(crate) struct BlockingProcessEvidence {
    pub(crate) process: ProcessIdentity,
    pub(crate) safe_executable_identity: Option<String>,
}

pub(crate) struct FailureContext {
    pub(crate) processes: Vec<BlockingProcessEvidence>,
    pub(crate) implicated_owned_inodes: Vec<OwnedSocketInode>,
}

pub(crate) struct OwnedSocketInode {
    pub(crate) inode: u64,
    pub(crate) representative_owner: ProcessIdentity,
    pub(crate) has_additional_owners: bool,
}
```

`ProcessSample` additionally produces `process_evidence: Vec<BlockingProcessEvidence>` for every current relevant process, sorted/deduplicated by `(pid,start_ticks)` and bounded by the existing 1,024 relevant-process cap. `OwnedSocketSet.inodes` is sorted/unique by inode and bounded by the existing 8,192 cap; representative owner is the lowest PID then start ticks. Phase 03 stores each qualified safe identity once in `process_evidence`. 13. Execute process prepare first, then TCP prepare using `PreparedProcessSample::sample().owned_sockets`. Recheck cancellation, monotonic deadline, request currency, and manager fleet/input/activity invalidations after both preparations. Only then call both infallible commits back-to-back on the worker. Dropping either prepared value aborts both state changes. Reporting truncation or absence of attributable identities never relaxes these completeness/fence checks. 14. If process preparation fails, preserve only that returned `ActivityUnavailable.context`: directly attributable proc failures may contain bounded `processes`; host-wide/incomplete failures contain none. If TCP preparation fails, join only its `context.implicated_owned_inodes` to `representative_owner` and `has_additional_owners` in the same uncommitted `PreparedProcessSample::sample().owned_sockets`, then resolve those exact `(pid,start_ticks)` owners against that same sample's `process_evidence`. Do this before dropping the prepared value and without committing process, TCP or raw baselines. Never join against a cached/next sample, scan again, or attach every current agent to a global diagnostic/timeout failure. 15. Perform at most one full process + TCP retry inside the original one-second deadline, and only when the typed failure has `retryable_close_race: true`. Phase 04 sets that flag only when an owned inode is absent from every otherwise complete TCP/UDP/UNIX diagnostic dump; Phase 03 uses it only for its explicitly classified process/FD close race. `NLM_F_DUMP_INTR`, `ENOBUFS`, truncation, framing/ABI/permission error, UDP presence, namespace mismatch, limits and deadline are nonretryable. Never extend the deadline, commit the first preparation, retry only half the pipeline, or delay retry for report enrichment. Publish only the terminal attempt's current failure context; do not retain identities from the superseded attempt. 16. Map common unavailable reasons exactly: `ProcAccess`, `ScanLimit`, `ScanTimeout`, `SocketDiagnostics`, `UnsupportedTransport`, `NamespaceMismatch`, `IdentityUncertain`, `CounterOverflow`. Coordinator adds `StaleObservation` and `Reconciling`; no error maps to valid zero activity. After the optional full retry is exhausted, or a completed result is accepted from the worker as late/unavailable, publish unavailable and call both observer `invalidate()` methods on that same worker. Process invalidation preserves retained identities/terminal Arcs but marks image/change comparison reconciling; TCP invalidation marks counters unqualified. The next full success is baseline/full-quiet recovery only. Coordinator-generated stale/reconciling states have empty failure context unless the current accepted failure itself supplied qualified evidence. 17. `ProcessSample` supplies recognized count, sorted/deduplicated `monitored_terminals: Vec<MonitoredTerminalEvidence { terminal: TerminalIdentity, output_sequence: Arc<AtomicU64>, sample_start_sequence: u64 }>`, `OwnedSocketSet`, `process_evidence`, and `ProcessChange`. At the beginning of `ProcessDiscovery::prepare_sample`, Phase 03 captures `sample_start_sequence` for every Phase 02 live-root handle plus every retained detached-lineage handle before procfs work and rejects `u64::MAX`. New matches reuse the already-captured live-root start value; retained root-removed lineage uses the retained Arc. Retained attribution continues owning terminal identity plus raw-output handle after root removal. Safe identity is already qualified and bounded by Phase 03; Phase 05 never reads argv/cmdline/cwd/exe again.

The sampler owns a bounded prior-accepted-end map keyed by exact terminal incarnation and Arc identity. Genuine raw activity is `sample_start_sequence > prior_accepted_end` or `sample_end_sequence > sample_start_sequence` on the same retained handle, including recovery; reject decrease/saturation as unavailable. A newly encountered identity/Arc establishes a baseline, never inherits a reused terminal's checkpoint. Commit the new end map only with the successful process/TCP pair. Invalidation preserves comparable retained-handle checkpoints; failed samples cannot consume inter-sample output deltas.

### Observation, activity and epoch revisions

18. Every returned sample request receives a checked monotonic observation sequence, regardless of success. Counter exhaustion is fail-closed; never wrap into an equal prior sequence.
19. `activity_revision` increments on qualifying genuine activity and on required initial/recovery/baseline reset. An unchanged complete sample does not increment it.
20. `epoch_activity_revision` increments only for genuine activity: accepted nonempty input anywhere; managed create/restart reservation; relevant agent/descendant discovery, validated exit, attribution/image change; raw output delta in a recognized/retained agent terminal; attributable TCP socket/counter activity. It does not increment for baseline establishment, observation recovery, timing update, sample heartbeat, status GET, helper outcome/release, wall-clock jump, or re-enumeration of retained identity/socket state.
21. Preserve a `last_attempted_epoch_activity_revision`. Once an automatic manager claim succeeds, latch the current epoch activity revision before issuing the executor request. Success, helper suppression, and execution failure all remain spent. Unchanged/recovery/timing/outcome samples cannot attempt again until the epoch activity revision genuinely advances.
22. Final-sample unavailable/stale failure invokes no executor and does not spend the epoch. Recovery must complete a new full baseline and quiet window before the same unspent epoch may be checked again.
23. `ProcessChange::BaselineEstablished` and `NetworkChange::BaselineEstablished` reset the quiet baseline and activity revision but not the epoch revision. A measurable raw-output/input/create event during reconciliation remains genuine and invalidates/restarts the recovery request; re-discovery alone does not.
24. `ProcessChange::Activity`, `NetworkChange::Activity`, or a qualifying raw/input/create signal advances both revisions and records one latest reason/time. Multiple signals coalesced into one sample may advance once; equality/ordering must stay monotonic and no event is lost as “unchanged.”
25. Deadline is `max(last_genuine_activity, baseline_or_recovery_started_at, admitted_timing_reset) + quiet_period`. A sample completion heartbeat alone never moves it. There is no second quiet period after reaching likely idle.
26. Initial empty server with no activity stays `Watching`; no clean-boot auto-arm. Restored live roots count as initial nonquiescent context: after restore completes and the first full baseline succeeds, a complete quiet period may arm. Persisted timestamps, buffer bytes, output offsets, or old sample state are never imported.
27. A complete qualified zero-agent sample is valid. Agent policy may arm with live service-only terminals after required epoch/baseline conditions. Unknown counts/incomplete discovery cannot.
28. Lifecycle hard blockers always prevent agent claim: `creating_count > 0`, `restart_pending_count > 0`, disposing, closing, or handoff active. `live_count > 0` alone is not a blocker in agent policy. Empty-fleet `is_quiescent()` remains unchanged.

### Final request and manager-locked admission

29. Introduce a private opaque final claim ticket. Public callers cannot construct it; it contains no serde/log/debug dump of private identities. Suggested private shapes, with final names adjusted only to fit the integrated activity module:

```rust
pub(crate) enum SampleKind { Scheduled, Final, Recovery }

pub(crate) struct SampleRequest {
    request_id: u64,
    kind: SampleKind,
    issued_at: Instant,
    deadline: Instant,
    activity_revision: u64,
    epoch_activity_revision: u64,
    timing_revision: u64,
}

pub(crate) enum ActivityMeasurementState {
    Initializing,
    Available,
    Unavailable,
}

pub(crate) enum ActivityObservationReason {
    RecentInput,
    RecentOutput,
    RecentNetwork,
    AgentChanged,
    LifecycleBusy,
    Quiet,
    ProcAccess,
    ScanLimit,
    ScanTimeout,
    SocketDiagnostics,
    UnsupportedTransport,
    NamespaceMismatch,
    StaleObservation,
    IdentityUncertain,
    CounterOverflow,
    Reconciling,
    EpochSpent,
}

pub(crate) enum QualifyingActivityKind {
    Input,
    Output,
    Network,
    AgentChanged,
    ManagedLifecycle,
}

pub(crate) enum ActivityDelta {
    Unchanged,
    BaselineReset,
    Genuine(QualifyingActivityKind),
}

pub(crate) struct MonitoredOutputFence {
    terminal: TerminalIdentity,
    output_sequence: Arc<AtomicU64>,
    accepted_sequence: u64,
}

pub(crate) struct ActivityObservation {
    observation_sequence: u64,
    completed_at: Instant,
    measurement_state: ActivityMeasurementState,
    reason: Option<ActivityObservationReason>,
    delta: ActivityDelta,
    fleet_generation: u64,
    input_revision: u64,
    output_checkpoints: Vec<MonitoredOutputFence>,
    recognized_agent_count: Option<usize>,
    monitored_terminal_count: Option<usize>,
    last_qualifying_activity_at: Option<Instant>,
    activity_revision: u64,
    epoch_activity_revision: u64,
}

pub(crate) struct ActivityClaimTicket {
    request_id: u64,
    observation_sequence: u64,
    completed_at: Instant,
    activity_revision: u64,
    epoch_activity_revision: u64,
    timing_revision: u64,
    fleet_generation: u64,
    input_revision: u64,
    roots: Vec<(TerminalIdentity, ProcessIdentity)>,
    output_fences: Vec<MonitoredOutputFence>,
    eligibility_deadline: Instant,
}

pub(crate) struct AgentActivityAdmission<'a> {
    ticket: &'a ActivityClaimTicket,
    automatic_policy: IdleSuspendAutomaticPolicy,
    automatic_enabled: bool,
    accepted_request_id: u64,
    accepted_activity_revision: u64,
    accepted_epoch_activity_revision: u64,
    accepted_timing_revision: u64,
    now: Instant,
}

pub(crate) fn PtySessionManager::try_claim_agent_activity_handoff(
    &self,
    admission: AgentActivityAdmission<'_>,
) -> Result<HandoffClaim, HandoffClaimError>;
```

`MonitoredOutputFence` privately retains terminal identity, its exact Arc handle, and accepted sequence. Do not expose ticket internals outside PTY/activity/coordinator modules.

30. The coordinator accepts a final ticket only when it matches the pending final request and current `activity_revision`, `epoch_activity_revision`, timing revision, unspent epoch, and expired eligibility deadline. No `.await` occurs between this validation and the synchronous manager claim.
31. Add a distinct crate-private `PtySessionManager::try_claim_agent_activity_handoff(...)`. It locks the existing manager `Inner` admission mutex once and validates all of the following before setting `handoff_active`: startup automatic policy is still agent activity and enabled; accepted request/ticket/revision values match; the monotonic deadline remains expired; observation age is valid; exact fleet generation/input revision match; lifecycle blockers are clear; terminal incarnation/root identities are unchanged; relevant raw-output Arc handles have not advanced or saturated; and no manager-side observation invalidation occurred.
32. Build the accepted admission object so request ID, observation/activity/epoch/timing revisions are compared under that same manager lock with fleet/input/root/raw fences. The startup policy is immutable, and coordinator revision state cannot change during this synchronous no-await call; still pass the exact accepted values rather than trusting equal counts or reconstructing a claim from status.
33. Manager performs no procfs, netlink, disk, audit, channel wait, allocation-heavy scan, or async work under its lock. It compares bounded scalar identities/Arc counters already captured by the ticket, then activates the existing handoff gate atomically.
34. The agent path does not call `try_claim_forced_handoff` and does not weaken `try_claim_handoff`. Manual forced admission remains the only path that bypasses quiescence after authenticated explicit confirmation.
35. A rejected agent claim returns a closed private error mapped to watching/stale/lifecycle state; it never falls back to forced or empty-fleet claim and never invokes the executor. New genuine invalidation may begin a later epoch; a pure ticket race does not invent activity.
36. A successful claim gates all newly server-admitted create/restart/input through existing Phase 02 behavior. It cannot freeze autonomous processes. Raw/kernel process/network activity immediately after comparison remains an explicit heuristic race, never an atomic “all work stopped” claim.
37. After successful automatic claim, issue the existing immutable `SuspendWithRtcWakeRequest` through the one current `IdleSuspendExecutor` future. Preserve single flight with manual requests. Do not extend helper protocol, capability, preflight, RTC, inhibitor, audit, or outcome semantics.

### Timing, manual, outcome and recovery

38. Timing update preserves the existing validated audit -> atomic persistence -> runtime commit transaction. The exact same pair is a no-op: no deadline, activity/epoch, or meaningful status revision change.
39. A timing command admitted before handoff invalidates any pending final request. For an available, unspent, otherwise eligible epoch it resets deadline to admission time + new quiet duration. Unavailable/reconciling remains non-armable; spent remains spent. Accepted handoff returns the existing exact 409 behavior.
40. Manual force arriving during automatic final check first invalidates the automatic request, then follows existing capability/auth/audit/confirmation/forced-or-unforced claim behavior. There is never an automatic and manual executor request for the same handoff.
41. Manual action remains available when automatic `enabled == false`. Agent observer state, recognized count, or likely quiet cannot remove real active-fleet confirmation or choose `force` for the user.
42. On any automatic or manual typed outcome: clear automatic deadline/final request; preserve the automatic spent latch; mark activity `reconciling`; call both observer `invalidate()` methods without erasing retained exact process/terminal/output ownership; release manager handoff; and request a fresh recovery baseline.
43. Admission stays blocked while reconciling. Input/create admitted after release is genuine activity and stales/restarts the recovery request. A complete recovery baseline establishes a new quiet start but never increments `epoch_activity_revision`; re-discovered same agents or re-enumerated sockets do not re-arm a spent epoch.
44. If a manual handoff occurred while an automatic epoch was unspent, recovery does not mint a new epoch. That same unspent revision may become eligible only after the full recovery quiet window. If it was already spent, it remains permanently ineligible until genuine activity.

### Observer-only rollout and public status

45. Under `agent-activity, enabled = false`, run scheduled/recovery observation and publish status including measurement warnings, but force coordinator state `Disabled`, `arm_deadline_ms = None`, skip final requests/automatic claims, and guarantee zero automatic executor calls. Manual force retains independent current authority.
46. Under `empty-fleet`, do not instantiate procfs/netlink activity worker; preserve existing automatic state machine and claim semantics exactly. Public `activity` is `null`.
47. Phase 05 owns backend `IdleSuspendStatusV1` additions, all constructors, and API fallback constructors: required `automatic_policy` plus nullable `activity`. Agent policy always has an activity object, including initializing/unavailable/disabled/not-started states; empty-fleet always has null.
48. Add closed serializable status types with exact camelCase values from the normative contract, including required `activity.measurementWarning`. Counts/timestamps are nullable while unknown. `networkCoverage` is always literal `tcp4-tcp6` for agent activity and is a scope label, not proof of complete networking.
49. Status reason precedence is deterministic: reconciling/lifecycle/unavailable/stale block quiet; `epochSpent` overrides eligibility after available recovery; within an unspent quiet window retain the latest genuine activity reason; use `quiet` only for a complete available candidate whose quiet deadline has elapsed. Never publish unknown as zero.
50. Separate snapshot update from meaningful announcement. A scheduled unchanged sample may refresh display timestamps while retaining `status_revision` and emitting no `host:idleSuspendChanged`. State, policy, validity, reason, counts, activity time, epoch, actual fleet/lifecycle, deadline, timing, outcome, capability, detail, or warning cause/process/truncation change is meaningful. Elapsed warning duration and sample heartbeats alone are not.
51. Use checked monotonic revisions. Counter exhaustion becomes fail-closed/unavailable and never wraps to equality. Do not emit per-sample audit/journal/event noise.
52. API coordinator-not-started fallback is complete and conservative. Empty-fleet reports legacy null activity. Agent policy reports initializing/reconciling with null counts/deadlines and a reconciling measurement warning, never fabricated zero/quiet. Establish warning onset once in fallback state, not anew on every GET. Existing protected GET and `Cache-Control: no-store` remain.

### Blocked measurement warning

53. Freeze this required nullable member of `activity`; it is null exactly when measurement is available and an object while initializing/unavailable, including disabled observation and not-started fallback:

```ts
interface IdleSuspendMeasurementWarningV1 {
  reasonCode:
    | "procAccess"
    | "scanLimit"
    | "scanTimeout"
    | "socketDiagnostics"
    | "unsupportedTransport"
    | "namespaceMismatch"
    | "staleObservation"
    | "identityUncertain"
    | "counterOverflow"
    | "reconciling";
  blockedSinceMs: number;
  processes: Array<{ pid: number; executableIdentity: string | null }>;
  processesTruncated: boolean;
}
```

54. Track one continuous unavailable interval with an internal monotonic onset; expose epoch-ms `blockedSinceMs` for display only. Cause/process changes do not reset onset. Complete available observation clears it; later failure starts another interval. Restart restores no warning history.
55. Before dropping failed preparation, combine current `FailureContext.processes` and implicated inode representatives joined against that same prepared `ProcessSample.process_evidence`. Never commit process/TCP/raw baselines on failure. Deduplicate internally by `(pid,start_ticks)`, sort by positive PID, and publish at most 32 current attributable examples. Host-wide/unknown failures use `processes: []`, never invented PID or total blocker count.
56. Identity is Phase03-qualified native/entrypoint basename or the configured exact path needed for a generic entrypoint, at most 256 UTF-8 bytes without controls or command arguments. Unknown identity is null, never argv/cmdline fallback. Set `processesTruncated` for known additional examples beyond 32 or omitted shared owners; unknown attribution alone is false. Collection stays inside existing process/socket caps and deadline; no enrichment pass.
57. Replace stale warning details with current failure evidence, never cached PID rebinding. Stale/deadline/global failures without current attributable evidence carry no processes. Warning projection is read-only: it cannot grant eligibility, advance activity/epoch, replace force/fleet counts, or add process remediation.
58. Only authenticated/no-store status and its UI expose PID/safe identity. Logs, audits, WebSocket revision hints, persistence and report exports exclude warning process details. Arguments, prompts, env, output, session/root/start-time data and socket identifiers/addresses never enter the warning.

## Architecture

### Worker ownership and request flow

```text
restored PtySessionManager
       │ manager activity/fleet watcher
       v
async coordinator select loop (always command-responsive)
  ├─ 2s tick ───────────────┐
  ├─ final deadline ────────┤ bounded requests
  ├─ timing/manual commands │
  ├─ executor outcome       v
  └─ shutdown         one cooperative activity worker
                         owns ProcessDiscovery + TcpObserver
                         capture PTY fence under manager lock
                         prepare process -> prepare TCP
                         recheck cancel/deadline/request fences
                         commit process + TCP back-to-back
                         emit complete/unavailable result
                                  │
                                  v
                         coordinator result channel
                                  │
          scheduled -> revisions/deadline/status
          final -> accepted opaque ticket -> manager-locked claim
```

A dedicated long-lived worker is preferred over per-sample `spawn_blocking`: stable ownership, no overlap, and joinable teardown. Its async bridge uses bounded channels. If implemented as a dedicated OS thread because procfs source methods are synchronous, retain one thread for the runtime and join it explicitly. If implemented as one Tokio blocking task, it still must be long-lived and joined; wrapping each sample in `timeout(spawn_blocking(...))` is prohibited.

### Transactional sample algorithm

```text
request + 1s monotonic deadline
  -> capture bounded PTY/root/input/fleet/raw handles under manager mutex
  -> ProcessDiscovery captures all live + retained raw sample_start_sequence values
  -> ProcessDiscovery::prepare_sample
  -> TcpObserver::prepare_sample(process.sample().owned_sockets)
  -> compare start/end with sampler's prior accepted end map
  -> verify request/cancel/deadline + current manager invalidation revisions
  -> classify baseline / unchanged / genuine activity / unavailable
  -> commit_sample(process), commit_sample(tcp) back-to-back
  -> emit observation + optional Final-only opaque ticket
```

Any failure/staleness/cancellation before both commits drops both prepared values and leaves the raw checkpoint map unchanged. A successful transaction commits process state, TCP state, and the new raw end map as one accepted generation. At most one full retry is allowed only for an explicitly retryable close/dump race and uses the original deadline.

### Revision and spent-epoch model

```text
observation_sequence: every result; identity only
activity_revision:    genuine activity OR required baseline reset
                         └─ invalidates cached/final tickets

epoch_activity_revision: genuine activity only
last_attempted_epoch_activity_revision: latched on successful automatic claim

eligible epoch = available baseline
              && qualifying context exists
              && epoch_activity_revision != last_attempted...
              && no lifecycle blocker
              && quiet deadline expired
```

Baseline recovery may move `activity_revision` and quiet start. It never moves `epoch_activity_revision`, so it cannot manufacture an attempt after a spent epoch.

### Final admission sequence

```text
quiet deadline expires
  1. state = FinalCheck; meaningful status revision
  2. enqueue NEW Final(request ID, activity/epoch/timing fences)
  3. continue command select; invalidations mark ID stale
  4. receive complete on-time matching result
  5. synchronously accept ticket against coordinator revisions/deadline
  6. manager lock: validate policy + ticket + fleet/input/root/raw/lifecycle
  7. set handoff_active atomically
  8. latch spent epoch; issue one immutable executor request
```

No await or filesystem/kernel I/O occurs between steps 5 and 7. The claim prevents new server-admitted work; it does not freeze already-running OS work.

### Status projection

Private observations contain exact identities and monotonic `Instant`s. `status.rs` maps aggregate activity plus the explicitly bounded `measurementWarning` projection above; no other private evidence is serialized. Meaningful revision comparison includes warning cause/processes/truncation, excludes heartbeat timestamps and elapsed duration. Live GET may see newer timestamps without a revision hint.

## Related code files

Create:

- `server/src/idle_suspend/activity/sampler.rs`: one worker, request/result/ticket types, process+TCP transaction, raw evidence combination, bounded retry, deadline/cancellation logic, and focused inline tests.

Modify after prior owners hand off:

- `server/src/idle_suspend/activity/mod.rs`: Phase 05 becomes integration owner; add sampler declarations and common observation/ticket visibility. Do not move Phase 03/04 implementation bodies here.
- `server/src/idle_suspend/coordinator.rs`: dual policy state machine, asynchronous scheduled/final/recovery requests, revisions/epochs, meaningful publication, disabled observer, timing/manual/outcome/shutdown coordination.
- `server/src/idle_suspend/status.rs`: exact policy/activity/measurement-warning DTOs, safe projection, nullable aggregates, meaningful comparison helpers, and all constructors.
- `server/src/idle_suspend/mod.rs`: crate-private exports needed by coordinator/status/API; no private identity public export.
- `server/src/pty/manager.rs`: final activity snapshot/invalidation integration and distinct manager-locked agent activity claim. Phase 02 must finish first.
- `server/src/pty/fleet_state.rs`: only if a closed `HandoffClaimError` variant/helper is required for agent lifecycle rejection; preserve existing quiescence and manual forced semantics.
- `server/src/state.rs`: start coordinator/observer after restore for both enabled states when agent policy is selected; retain one owner and shutdown handle.
- `server/src/main.rs`: preserve post-restore startup and make shutdown order explicit: activity coordinator/worker join before PTY producers/readers teardown.
- `server/src/api/idle_suspend.rs`: Phase 05-owned coordinator-not-started `IdleSuspendStatusV1` fallback construction with policy/activity fields.
- `server/src/idle_suspend/tests.rs`: scripted worker/coordinator/final-ticket/revision/epoch/race/shutdown library tests using fake executor and deterministic barriers.
- Existing PTY manager/fleet tests adjacent to modified claim code: exact lock fence, live-agent admission, service-only behavior, raw/input/lifecycle rejection.
- `server/src/api/tests.rs`: migrate status constructors needed for compilation. Phase 06 owns additive route behavior/privacy regressions after DTO freeze.

Consume without ownership changes:

- `server/src/idle_suspend/activity/process.rs`: Phase 03 prepare/commit/invalidate implementation.
- `server/src/idle_suspend/activity/tcp.rs`, `netlink.rs`, `tcp_info.rs`: Phase 04 prepare/commit/invalidate and Linux diagnostics.
- `server/src/pty/activity.rs`, `server/src/pty/session.rs`: Phase 02 identity/raw-output types and handles.
- `server/src/idle_suspend/policy.rs`: Phase 01 `AgentExecutableSet` and immutable startup policy.
- Existing executor/helper/protocol/audit/timing-store modules: preserve authority and wire behavior.

No UI/client file belongs to Phase 05. No database migration, persistent baseline, helper change, new API endpoint, shell command collector, background telemetry, or detached cancellation task.

## Implementation Steps

1. Receive exact Phase 02–04 implemented types and use LSP references on coordinator start/status/claim constructors. Resolve compilation ownership before editing: Phase 03 hands `activity/mod.rs`; Phase 02 hands `manager.rs`; Phase 04 keeps TCP files.
2. Add `activity/sampler.rs` with bounded request/result channels and one long-lived worker owning one `ProcessDiscovery` and one `TcpObserver`. Choose a joinable dedicated execution context for synchronous procfs work; never spawn one blocking task per sample.
3. Define checked revisions and opaque ticket types. Use private/custom debug behavior so exact identities, roots, output handles, sockets and matcher material cannot enter logs/audits/errors; only the dedicated status warning projection may serialize bounded PID/safe identity.
4. Implement worker request handling: capture PTY activity snapshot; check cancellation/deadline; let process prepare capture all live/retained `sample_start_sequence` values; TCP prepare; raw end read; compare start/end against the sampler-owned prior accepted end map; full fence recheck; infallibly commit process, TCP, and the new end map together. New/recovered identity/Arc establishes baseline; increases on the same retained Arc are genuine. Drop prepared state and leave all three baselines unchanged on every early exit.
5. Implement the one full retry for explicitly retryable close/dump race only. Re-capture PTY state and rerun both observers within the original deadline. A second race or expired deadline returns unavailable.
6. Classify `BaselineEstablished`, `Unchanged`, and genuine activity across process/network/raw/input/create signals. Advance `activity_revision` and `epoch_activity_revision` according to separate rules. Use conservative sample completion time for observed activity.
7. Implement invalidation without ownership loss. `invalidate()` marks process/TCP baselines unqualified but retains validated descendants, terminal identities and raw Arc handles. Recovery re-enumeration is baseline, not genuine activity.
8. Refactor coordinator scheduled sampling around the existing select loop. Start sampler for agent policy regardless of enabled; schedule 2-second samples; coalesce while busy; process results/events without blocking command reception.
9. Add agent-mode eligibility state: initial-empty guard, restored-root baseline context, last activity/baseline/timing quiet anchor, availability, lifecycle blockers, and spent epoch latch. Leave empty-fleet transition helpers semantically unchanged.
10. Replace synchronous agent deadline claim with asynchronous fresh final request. Enter/publish `FinalCheck` first; enqueue one new request; keep loop responsive. Bind pending request to all revisions and deadline.
11. On input/lifecycle/timing/manual/shutdown while final sampling runs, mark the request stale immediately and apply the event's real semantics. A late matching result remains denied because its ID/revisions no longer match.
12. Add the crate-private agent claim to manager. Under one `Inner` lock compare accepted ticket/revisions, startup policy tag/enabled, deadline/age, fleet generation, input revision, exact current terminal/root/incarnation set, monitored raw checkpoints, and lifecycle blockers. Set existing handoff gate only after all pass.
13. Preserve `try_claim_handoff` for empty-fleet and `try_claim_forced_handoff` for confirmed manual force. Search all claim callsites; automatic agent mode must reach only its distinct path and have no fallback.
14. On successful automatic claim, latch the attempted epoch before constructing one existing executor request. Preserve exact wake timing and single-flight outcome path. Ensure an enqueue/construction failure releases handoff without granting a retry to an already attempted epoch unless contract classifies it as pre-attempt.
15. Integrate timing transaction. Invalidate pending final before any admitted mutation; retain exact 409 during handoff; no-op same pair leaves deadline/revisions; changed pair resets only an unspent eligible deadline and never manufactures epoch activity.
16. Integrate manual command ordering. Stale automatic final before manual capability/audit work; retain actual count/force confirmation and independent disabled-mode authority; never execute both paths.
17. Implement outcome recovery: latch/retain spent state, publish reconciling, invalidate comparability while preserving retained ownership, release handoff, request a fresh baseline, and deny eligibility until it completes. Rejected input during handoff is never replayed; newly accepted post-release input is genuine.
18. Implement shutdown state: stop command/automatic admission, cancel queued/final requests, cooperatively stop worker, drain any already accepted executor outcome safely, join worker/coordinator, then return to `main.rs`. Keep existing main order ahead of PTY stop/readers/shutdown.
19. Extend `status.rs` and every constructor with exact frozen DTO. Centralize mapping and meaningful projection. Replace wrapping revisions. Send watch updates for fresher live timestamps but emit WS hint only when meaningful projection changes.
20. Extend API fallback construction. Agent policy without a coordinator is initializing/reconciling with null counts and no deadline; empty-fleet remains null activity. Preserve protected/no-store behavior.
21. Add deterministic library tests with paused monotonic time, barriers and scripted `ProcessSource`/diagnostics through the sampler. Keep private injected observer/ticket cases in `server/src/idle_suspend/tests.rs` or inline activity tests, never in public integration.
22. Add manager tests for every fence independently: same counts but changed generation/incarnation/root; input revision; one raw sequence; activity/epoch/timing/request revision; deadline/age; lifecycle; saturation. Each mismatch produces zero fake executor calls and no handoff.
23. Add coordinator races in both event orders: scheduled/final result versus input/output/network/create/timing/manual/shutdown; final failure/recovery; success/suppression/failure spent epoch; post-resume re-discovery; genuine next activity. Assert exact request count.
24. Add blocked-operation shutdown test: final result becomes unavailable at one second while the worker is still blocked; commands remain responsive; no replacement worker starts. Release the fixture barrier, then prove worker join completes before fixture PTY teardown. Do not call this hard kernel cancellation.
25. Hand Phase 06 exact DTO examples/reason precedence. Hand Phase 07 public coordinator/real observer seams. Public `server/tests/idle_suspend.rs` must use real observer/public status/FakeExecutor; it must not receive scripted private types.
26. Implement continuous warning onset and same-preparation failure projection, including unavailable/disabled/fallback states, stale-detail replacement, representative-owner truncation and null-on-available recovery. Hand Phase06 exact warning examples and reject contract drift rather than making the field optional.
27. Prove cause/PID changes preserve onset, available recovery clears it, later failure restarts it, warning-only changes announce once without epoch changes, and elapsed duration creates no hints. Verify failed TCP evidence is useful without committing any baseline.

## Todo list

- [x] Take `activity/mod.rs` and `manager.rs` ownership only after prerequisite handoff.
- [x] Add one bounded joinable activity worker with no overlap/detach.
- [x] Implement exact process/TCP prepare-then-commit transaction.
- [x] Enforce 2s cadence, 1s acceptance, 5s age, one bounded full retry.
- [x] Separate observation, activity and epoch activity revisions.
- [x] Preserve retained identity/output/socket ownership through root removal/recovery.
- [x] Compare raw output across and within samples using one transactional prior-end map.
- [x] Implement initial/restored baseline and genuine-activity epoch rules.
- [x] Keep fresh final sampling asynchronous and command-responsive.
- [x] Add opaque manager-locked policy/ticket/fleet/input/root/raw admission.
- [x] Preserve empty-fleet and manual forced claim behavior.
- [x] Run observer status-only when agent policy is disabled.
- [x] Preserve timing transaction and exact handoff conflict.
- [x] Reconcile after every manual/automatic outcome without rearming spent epoch.
- [x] Publish meaningful status changes without heartbeat hints.
- [x] Join sampler/coordinator before PTY teardown.
- [x] Keep scripted injection in library tests and public integration on real observer.
- [x] Project bounded current blocker examples before aborting failed preparation.
- [x] Track continuous warning onset independently of quiet/epoch authority.
- [x] Cover warning recovery, stale identity, truncation, disabled/fallback and privacy.

## Success Criteria

Keep deterministic regressions for these observable contracts:

- One worker services scheduled, final and recovery requests serially. A blocked sample causes no overlap/detach; final/timing/manual/shutdown select branches remain responsive.
- Exactly-at-deadline complete result may be accepted according to one documented comparison; completion after one second or observation older than five seconds is unavailable and makes zero executor calls.
- Process preparation followed by TCP failure/cancellation/staleness commits neither observer. Successful combined request commits both once. Retryable close race gets at most one full retry inside original budget.
- Unchanged 2-second samples advance observation sequence only. They do not advance activity/epoch revisions, deadline, status revision, WS hint or audit.
- Baseline/recovery advances activity revision/quiet start but not epoch revision. Same live agents and re-enumerated existing sockets after outcome do not rearm a spent epoch; retained descendants/output handles survive root removal.
- Accepted input anywhere, create/restart reservation, relevant identity change, agent-owned raw output, and attributable TCP change advance genuine epoch activity. Service-only output/network/listeners do not.
- Raw output emitted after sample A completes and before sample B starts resets quiet when B sees `sample_start_sequence` above A's committed end, even if no bytes arrive during B. New/recovered identity/Arc is baseline only; an increase on the same retained Arc is genuine; unavailable B does not advance the checkpoint.
- Initial empty boot never arms. Restored live roots baseline only after restore and may arm after one full quiet window. No persisted activity evidence is trusted.
- Agent policy with live service PTYs can claim only through exact ticketed manager admission. Creating/restart/dispose/close/handoff always block. Empty-fleet and manual claim behavior remains exact.
- Fresh final request is minted after `FinalCheck`. Cached samples cannot claim. Any request/activity/epoch/timing/fleet/input/root/raw mismatch produces zero executor calls even when aggregate counts match.
- Successful automatic claim issues exactly one executor request and spends the epoch. Success, suppression and failure never retry without genuine activity. Final sample failure does not spend, but recovery requires full quiet.
- Timing/manual races invalidate automatic final first. Same timing pair is no-op. Changed timing resets only an unspent eligible countdown. Manual action remains available while automatic mode is disabled and retains actual fleet confirmation.
- Outcome/resume publishes reconciling, preserves spent latch and retained ownership, releases handoff safely, and requires complete recovery baseline. Rejected handoff input is never replayed.
- `agent-activity + enabled=false` continuously exposes observation state with coordinator disabled, no countdown/final claim and zero automatic executor requests. Empty-fleet starts no observer and exposes null activity.
- Status contains only exact aggregate DTO. Unknown is null, not zero. Heartbeats do not emit revisions/hints; meaningful state/count/reason/deadline changes do.
- Shutdown first denies admission, then cooperatively cancels and joins the single worker/coordinator before PTY teardown. A released fake barrier proves ordering; no claim promises a stuck kernel syscall is forcibly cancelled.
- All private scripted tests remain library tests. Public integration later exercises a real managed PTY/process/netlink observer and public status with `FakeExecutor`.

Future focused commands from repository root, after serialized phase implementation:

```sh
cargo test --manifest-path server/Cargo.toml --lib idle_suspend::activity::sampler::tests
cargo test --manifest-path server/Cargo.toml --lib idle_suspend::tests
cargo test --manifest-path server/Cargo.toml --lib pty::
```

The implementation owner must confirm filters execute intended tests. Phase 07 runs `server/tests/idle_suspend.rs`, the ignored live Linux observer smoke, aggregate Cargo/pnpm gates and actual browser proof. No formatter, lint, build or test command has been run during this docs-only planning assignment.

### Required future runtime proof and gates

- **Freshness/admission gate:** barriers prove stale/late/mismatched finals and every unavailable state make zero calls; valid exact ticket makes one call.
- **Privacy gate:** only authenticated/no-store measurement warnings expose bounded PID/safe identity; status excludes command arguments, matcher lists, terminal/root/start/socket IDs, addresses, bytes, tokens and tickets. Logs/events/audits exclude warning process details too.
- **Shutdown gate:** injected block proves deadline denial without cancellation fiction, then release proves one worker joins before PTY teardown. Target service-context normal latency must also qualify.
- **Public integration gate:** canonical `server/tests/idle_suspend.rs` uses real observer/public status/real manager plus FakeExecutor. Private scripted seams stay library-only.
- **Browser gate:** Phase 06/07 use actual Chromium to show policy/unknown/countdown/warning and preserve force flow; backend tests alone are insufficient.
- **Rollout gate:** unsupported procfs/netlink/counter/namespace or repeated sample/join budget failure keeps agent policy unavailable and blocks opt-in; no fallback.

## Risk Assessment

| Risk                                      | Impact                     | Mitigation                                                                              |
| ----------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| Slow final scan blocks command loop       | Critical                   | Bounded async request/result channel; coordinator never awaits scan inline              |
| Timeout leaves detached procfs worker     | Critical                   | One long-lived cooperative worker, no per-sample spawn/detach, explicit join            |
| Kernel syscall stalls shutdown            | High operational           | Admit limitation; deadline denies claim; target-host join qualification blocks rollout  |
| Partial process commit after TCP error    | Critical false quiet       | Prepare both, recheck, infallible back-to-back commit only on full success              |
| Recovery looks like new activity          | Critical duplicate attempt | Separate activity vs epoch revision; baseline never advances epoch                      |
| Root removal loses detached agent lineage | High false idle            | Retained exact identity, terminal and Arc output ownership survive invalidation/removal |
| Live service requires forced bypass       | Critical authority bug     | Dedicated agent claim; never call forced path; exact manager fences                     |
| Equal counts hide root/input/output race  | Critical                   | Ticket binds generation, input revision, identities/incarnations and raw checkpoints    |
| Heartbeat floods clients                  | Medium                     | Meaningful projection excludes sample/generated timestamps                              |
| Disabled observation accidentally arms    | Critical                   | Forced `Disabled`, null deadline, skip final/automatic claim; zero-call test            |
| Manual and automatic request overlap      | Critical                   | Single coordinator/executor flight; invalidate final before manual handling             |
| Revision wraps to stale equality          | Critical                   | Checked monotonic increments; overflow unavailable/no claim                             |

## Security Considerations

- Procfs/netlink/PTY evidence remains unprivileged and bounded. Only the authenticated/no-store warning may serialize PID and qualified safe identity. Never log, persist, export, hash into telemetry, or attach warning process details to audit/error strings; never expose arguments, env, prompts, terminal/session IDs, socket keys/addresses, raw bytes or byte counters.
- Opaque claim tickets remain private and non-serializable. Public warning examples are diagnostic context only, not eligibility evidence, exhaustive blocker totals or force authority.
- Manager lock is the admission boundary. No filesystem, netlink, disk audit, async wait or external call occurs while held. Exact server-admitted create/restart/input gates become active atomically with claim.
- Automatic agent policy never invokes manual forced claim and never bypasses helper capability, enrolled peer, audit, inhibitor, RTC ownership, execution or outcome checks.
- Observation failure affects automatic eligibility only. It must not kill/freeze a workload, reject ordinary PTY use before handoff, grant privilege, enter namespaces, invoke shell tools, or call model/provider APIs.
- Polling/final checks are heuristic. Newly detached never-observed children and work beginning immediately after comparison can escape. State this honestly; do not add unauthorized process freezing or claim semantic completion.
- Shutdown does not abandon an accepted helper request or a collector. Drain typed outcome/release handoff and join owned work. If target kernel calls do not return acceptably, disable agent policy rather than weakening safety.

## Next steps

1. Phase 06 consumes the exact status serialization, implements strict old/new decoding, and proves the actual browser surface without adding matcher controls.
2. Phase 07 integrates the real observer through the public coordinator/status and FakeExecutor, runs the canonical ignored Linux PTY/TCP smoke, measures service-context sample/join latency, and enforces privacy/shutdown gates.
3. Phase 08 enables observation-only rollout first (`enabled=false`, `agent-activity`) and treats unsupported or stalled hosts as no-go. Automatic canary remains explicit Operations work with bounded wake/recovery.

## Unresolved questions

- Rust/Tokio cannot forcibly cancel a kernel-stalled procfs syscall. The implementable contract is a strict one-second acceptance deadline, cooperative checks, deadline-aware netlink, one joinable worker, and delayed shutdown if the kernel never returns. If product requires a mathematical one-second worker termination/join guarantee, the contract must change before implementation; it cannot be satisfied safely in-process.
- Target Fedora/Linux and deployed service contexts must demonstrate required unprivileged procfs plus TCP_INFO behavior and acceptable normal sample/join latency. This is a rollout feasibility fact, not permission to add a weaker fallback.
