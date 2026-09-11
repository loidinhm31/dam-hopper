# Configured-Agent Activity: Transactional Sampling and Automatic Admission

**Status:** Phase 05 complete 2026-09-11. This page documents the private Linux
`agent-activity` coordinator layer. It combines PTY, process, and owned-TCP
evidence; it does not treat any single observation as proof that an agent is
finished or expose process arguments, terminal bytes, socket addresses, or raw
diagnostics.

## Scope and source map

| Source | Responsibility |
| --- | --- |
| `server/src/idle_suspend/activity/sampler.rs` | Dedicated worker, request mailbox, transactional process/TCP sample, raw-output checkpoints, revisions, and opaque final ticket |
| `server/src/idle_suspend/activity/{mod,process,tcp}.rs` | Private evidence records, bounded process attribution, owned socket set, and independently prepared baselines |
| `server/src/idle_suspend/coordinator.rs` | Tokio state machine, cadence/final/recovery requests, epoch latch, claim dispatch, status publication, and cooperative shutdown |
| `server/src/idle_suspend/status.rs` | Version-1 public status DTO, activity warning projection, fallback state, and meaningful-change filtering |
| `server/src/pty/manager.rs` | Manager-locked admission gate for policy, revisions, roots, output fences, and lifecycle |
| `server/src/pty/fleet_state.rs` | Content-free fleet generation, lifecycle counts, quiescence, and handoff gate |
| `server/src/idle_suspend/policy.rs` | Startup-owned policy and validated executable matcher set |
| `server/src/api/idle_suspend.rs` | Protected status, timing, and manual force-suspend REST handlers |
| `server/src/main.rs`, `server/src/state.rs` | Startup after persistence restoration and shutdown ordering |

The lower-level evidence contracts remain in [PTY Activity Observation](./pty-activity-observation.md), [Configured-Agent Process Discovery](./agent-activity-process-discovery.md), and [Owned TCP Byte Observation](./tcp-activity-observation.md). This page is the integration contract for their Phase 05 consumer.

## Runtime topology

The coordinator owns the asynchronous policy loop. Under `agent-activity`, it
starts one `ActivitySampler`; the sampler starts exactly one named,
joinable `idle-suspend-sampler` thread. That thread owns the stateful
`ProcessDiscovery` and `TcpObserver` instances, so their committed baselines
are never concurrently accessed by Tokio tasks or PTY manager callers.

```text
StartupIdleSuspendPolicy + RuntimeIdleSuspendTiming
                    |
                    v
        IdleSuspendCoordinator (Tokio task)
          | PTY fleet/activity watches
          | scheduled / final / recovery requests
          v
 ActivitySampler mailbox + result channel
          |
          v
 idle-suspend-sampler (joinable std::thread)
   | ProcessDiscovery<LinuxProcSource>
   | TcpObserver<LinuxSocketDiagnostics>
   | prior accepted raw-output checkpoints
          |
          v
  verified ActivityObservation + optional opaque ActivityClaimTicket
          |
          v
PtySessionManager::try_claim_agent_activity_handoff
          |
          v
  one admitted SuspendWithRtcWakeRequest -> executor/helper
```

`automatic_policy = empty-fleet` does not start this sampler and keeps the
activity field null. `automatic_policy = agent-activity` starts it even when
there are no recognized agents; measurement remains private and is surfaced
through the status DTO only as bounded, content-free metadata.

## Worker lifecycle and request policy

The sampler has a one-slot mailbox. Scheduled requests are coalesced when a
request is already queued. A `Final` request supersedes queued work and sets a
cooperative cancellation flag for an in-flight sample. A `Recovery` request
has the same priority and is used after resume or handoff release. The worker
checks cancellation and the monotonic request deadline between expensive
stages; it does not force-kill a syscall or spawn a second worker.

Each request carries:

- `request_id` and `SampleKind` (`Scheduled`, `Final`, or `Recovery`);
- one monotonic one-second acceptance deadline;
- the quiet-period `eligibility_deadline` used by the final ticket; and
- activity, epoch-activity, and timing revisions captured by the coordinator.

The normal cadence is two seconds. A final sample is requested asynchronously
when the quiet countdown expires, rather than reusing the last scheduled
sample. Recovery invalidates both committed baselines before preparing its
next sample, so post-resume state cannot be mistaken for continuity.

`ActivitySampler::shutdown_and_join` sets shutdown, clears pending work,
cooperatively cancels the current request, wakes the condition variable, and
joins the worker. `Drop` uses the same path. The server calls coordinator
shutdown before stopping PTY readers or tearing down the PTY manager; this
prevents a sampler from retaining manager-owned observation handles during
PTY teardown.

## Transactional sample algorithm

A successful sample follows this order. Preparation is read-only; no baseline
is committed until every fence and manager snapshot check succeeds.

1. **Initial PTY snapshot.** Under the manager lock, capture the content-free
   fleet generation, input revision/time, qualified live roots, and cloned raw
   output counter handles. An incomplete snapshot (root uncertainty, a 256-root
   bound, or saturated revision/counter) is unavailable, never quiet.
2. **Prepare process evidence.** `ProcessDiscovery::prepare_sample` performs
   bounded procfs attribution and returns a prepared process baseline plus
   recognized-agent evidence and an owned socket set.
3. **Prepare TCP evidence.** `TcpObserver::prepare_sample` reads the owned
   socket set through the bounded TCP diagnostics seam. If it fails, the
   sampler enriches the failure with at most 32 implicated process identities
   from the still-uncommitted process sample, then drops that prepared sample.
4. **Verify raw output.** For each monitored terminal, validate the sampled
   sequence against its start sequence and the prior accepted-end map. A
   decrease or saturation is a `CounterOverflow`; a sequence advance is raw
   output activity. The map key includes the exact terminal incarnation and
   counter `Arc`, preventing a replacement PTY from inheriting old output.
5. **Recheck cancellation and manager state.** Check the deadline/cancel flag,
   then capture a second PTY snapshot. A changed fleet generation or input
   revision returns `StaleObservation` and commits neither prepared baseline.
6. **Commit back-to-back.** Only after both preparations and all fences pass,
   call `ProcessDiscovery::commit_sample` and `TcpObserver::commit_sample`.
   These assignments are infallible; the pair is committed consecutively, not
   independently exposed as a partially accepted result.
7. **Classify the delta.** Update the bounded raw-output map and classify the
   complete sample. Genuine activity advances both activity revisions and
   updates the last qualifying timestamp; baseline establishment advances only
   the general activity revision; unchanged does not advance either revision.
8. **Build observation and ticket.** The observation contains counts, reason,
   revisions, fleet/input fences, and output checkpoints. Only an unchanged
   `Final` sample receives an opaque `ActivityClaimTicket`; scheduled,
   recovery, changed, unavailable, and baseline samples cannot authorize a
   handoff.

A close race that leaves an owned inode unresolved is retryable. The worker
retries at most once and only while the original deadline remains. All other
failures, or a second close-race failure, become a typed unavailable result.
The retry never commits the failed preparation.

## Delta classification and revisions

Classification priority is deterministic:

| Evidence | Observation reason | Effect |
| --- | --- | --- |
| Accepted nonempty PTY input or newer input revision/time | `RecentInput` | Genuine; increments activity and epoch revisions |
| Raw output checkpoint advanced | `RecentOutput` | Genuine; increments both revisions |
| Owned TCP counters/keys changed, reset, retired, or were replaced | `RecentNetwork` | Genuine; increments both revisions |
| Recognized process attribution changed | `AgentChanged` | Genuine; increments both revisions |
| PTY creation or restart is pending | `LifecycleBusy` | Genuine; increments both revisions |
| First valid process/TCP baseline | No reason | `BaselineEstablished`; increments activity revision only |
| Complete comparable sample with no change | No reason | `Unchanged`; no revision increment |

The coordinator treats any genuine delta as a new quiet anchor and cancels a
pending final check. The epoch revision is the once-per-automatic-epoch
activity budget: after a successful claim, that revision is latched as spent.

## Manager-locked final admission

The sampler's ticket is opaque to public callers. The coordinator can present
it only through `AgentActivityAdmission`. `PtySessionManager` takes its
single `Inner` lock and verifies every condition before setting
`handoff_active`:

| Gate | Required condition | Rejection |
| --- | --- | --- |
| Policy | Startup policy is `AgentActivity` and enabled | `PolicyMismatch` |
| Ticket revisions | Request ID, activity revision, epoch revision, and timing revision equal the accepted coordinator values | `PolicyMismatch` |
| Quiet deadline | `now >= eligibility_deadline` | `DeadlineNotExpired` |
| Observation freshness | Ticket age is at most five seconds | `ObservationStale` |
| Input fence | Manager input revision equals ticket input revision | `InputRevisionMismatch` |
| Fleet fence | Manager generation equals ticket generation | `GenerationMismatch` |
| Root identity | Live count, session ID/incarnation, and exact qualified `(pid, start_ticks)` roots match | `RootIdentityMismatch` |
| Output fence | Every counter is below the saturation sentinel and equals its accepted sequence | `RawOutputAdvanced` |
| Lifecycle | Fleet is not closing, disposing, already handed off, creating, or restart-pending | Typed fleet claim error (`Closing`, `Disposing`, `HandoffAlreadyActive`, or `LifecycleBusy`; `NotQuiescent` applies to the separate `empty-fleet` claim) |

The final fleet claim and handoff flag are set while that same manager lock is
held. On success the coordinator records the epoch revision as spent, enters
`HandedOff`, clears the arm deadline, and dispatches exactly one executor
future. Any failed gate returns to `Watching` without spending the epoch.

## Public status and privacy contract

`GET /api/system/idle-suspend/v1/status` is protected and returns
`IdleSuspendStatusV1` with `Cache-Control: no-store`. The v1 response always
includes `automaticPolicy`, `enabled`, timing bounds/current values, the
content-free `fleetSnapshot`, state, epoch, outcome/detail, and revision. The
`activity` field is:

- `null` under `empty-fleet`; or
- an `IdleSuspendActivityStatusV1` object under `agent-activity`.

The activity object contains `measurementState` (`initializing`, `available`,
or `unavailable`), an optional closed `reasonCode`, optional recognized-agent
and monitored-terminal counts, optional sample and last-activity timestamps,
`networkCoverage` (currently `tcp4-tcp6`), and nullable `measurementWarning`.

When measurement is unavailable or reconciling, the warning contains a closed
`reasonCode`, continuous `blockedSinceMs`, and a process list projected from
safe executable evidence. The list is sorted/deduplicated by PID, capped at
32, and sets `processesTruncated` when more evidence exists. It contains only
`pid` and optional safe executable identity: command arguments, environment,
terminal bytes, socket addresses, socket inodes, and raw diagnostics never
enter the public DTO.

`IdleSuspendStatusV1::is_meaningful_change` ignores status revision, wall-clock
snapshot timestamp, sample timestamp churn, and elapsed warning duration. It
still publishes semantic changes to coordinator state, policy, timing, fleet,
epoch, arm deadline, activity reason/state/counts, last qualifying activity,
network coverage, warning reason, process identities, or truncation.

## Coordinator state machine

The coordinator handles both automatic policies in one event loop:

- **`empty-fleet`:** the existing fleet watcher arms only after an active-to-
  empty transition. It claims the generation-fenced empty fleet at deadline,
  then dispatches the executor. Resume/failure releases handoff and requires a
  new non-quiescent transition before another epoch.
- **`agent-activity`:** scheduled samples establish a complete baseline and a
  qualifying activity context. With measurement available, no lifecycle
  blocker, and an unspent epoch revision, the coordinator arms at
  `quiet_anchor + quiet_period`. At expiry it enters `FinalCheck`, sends a
  fresh asynchronous `Final` request, and admits only a current unchanged
  result whose ticket is still within the five-second age limit and whose
  quiet deadline has expired.
- **Invalidation:** PTY input, genuine sampler activity, generation changes,
  creation/restart, disposal, or closing cancels the final request and clears
  the arm deadline. It returns to `Watching` rather than treating an old
  ticket as proof of quiet.
- **Spent epoch:** a successful final admission latches the accepted epoch
  activity revision. The latch reports `EpochSpent` after recovery and blocks
  another automatic claim while that revision remains spent.
- **Recovery:** after suspend outcome or handoff release, the coordinator
  requests a `Recovery` sample and reconciles measurement. Recovery does not
  increment `current_epoch`; a later genuine activity/new qualifying context
  is required before another epoch can arm.
- **Manual force sleep:** the protected manual command remains available to an
  authenticated enabled actor independently of automatic scheduling. It uses
  the existing explicit active-fleet confirmation and forced handoff path;
  it cancels an automatic final check rather than racing it.

A missing helper, unsupported capability, audit/persistence failure, lifecycle
race, stale evidence, or unavailable measurement fails closed. Unavailable
agent measurement never arms or claims automatic suspend.

## Startup, shutdown, and verification map

`AppState` constructs startup-owned policy and runtime timing, then
`server/src/main.rs` starts the coordinator after persistence restoration. On
shutdown, `state.shutdown_idle_suspend_coordinator().await` runs before PTY
buffer snapshot, reader stop/join, and `PtySessionManager::shutdown`. This
ordering joins the sampler while its manager remains valid and avoids orphaned
background activity work.

The implementation's focused verification map is:

- `server/src/idle_suspend/activity/sampler.rs`: scheduled/final ticketing,
  raw output, overflow, retryable close race, TCP failure enrichment,
  cooperative cancellation, and worker join tests;
- `server/src/idle_suspend/tests.rs`: disabled observer-only mode, clean boot,
  countdown/final claim, invalidation reset, spent-epoch latch, and shutdown;
- `server/src/pty/tests.rs`: successful claim plus policy/revision/deadline/
  age/input/generation/root/output/lifecycle rejection gates.

These tests use injected process/socket sources and test managers; this page
claims the source coverage map, not a production host suspend or RTC run.

## Related documentation

- [PTY Activity Observation](./pty-activity-observation.md)
- [Configured-Agent Process Discovery](./agent-activity-process-discovery.md)
- [Owned TCP Byte Observation](./tcp-activity-observation.md)
- [Terminal Idle Suspend Security](./terminal-idle-suspend-security.md)
- [System Architecture](./system-architecture.md)
- [API Reference](./api-reference.md#terminal-idle-suspend)
- [Configuration Guide](./configuration-guide.md#terminal-idle-suspend-opt-in-linux-suspend)

## Unresolved questions

No new product or implementation questions were introduced by Phase 05. The
existing operational questions about exclusive `rtc0` ownership and physical
or out-of-band wake approval remain in [Terminal Idle Suspend Security](./terminal-idle-suspend-security.md#unresolved-questions).
