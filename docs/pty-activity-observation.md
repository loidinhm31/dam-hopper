# PTY Activity Observation

**Status:** Phase 02 implemented 2026-09-11. This page is the canonical
implementation guide for the private PTY evidence seam used by the later
configured-agent idle-suspend phases.

Phase 02 records evidence at the PTY boundary without adding a public REST
route, a WebSocket acknowledgement, terminal-content inspection, or an
automatic agent-policy claim. Phase 03 consumes the root/stat seam for process
discovery; Phase 04 adds owned TCP byte observation; Phase 05 owns sampling,
eligibility, and the final handoff claim.

## Source map

| Source | Contract |
| --- | --- |
| `server/src/pty/activity.rs` | Identity types, `/proc/<pid>/stat` parsing, raw-output counter helper, private snapshot and watcher types |
| `server/src/pty/session.rs` | Ephemeral root qualification and per-incarnation output-counter fields on `LiveSession` |
| `server/src/pty/manager.rs` | Spawn/respawn initialization, reader boundary, input admission, bounded snapshot capture, and watcher publication |
| `server/src/pty/mod.rs` | PTY-module exports for the shared private seam |
| `server/src/pty/tests.rs` | Focused identity, counter, admission, incarnation, smoke, and incompleteness regressions |

The manager remains authoritative for public fleet counts. An ordinary live
service terminal is still live even when a future `agent-activity` policy may
ignore its activity.

## Observation flow

```text
spawn or respawn
  -> capture child process_id()
  -> probe /proc/<pid>/stat start_ticks
  -> store root qualification + zeroed counter on LiveSession

reader.read() returns n > 0
  -> increment this incarnation's atomic raw-output sequence
  -> parse lifecycle/control data, buffer, persist, and broadcast

nonempty manager.write()
  -> check handoff/manager/session admission
  -> increment manager input_revision and set last_input_at
  -> publish private invalidation
  -> write to the LiveSession writer

capture_activity_snapshot()
  -> lock manager and copy scalar state plus Arc handles
  -> unlock; no procfs read and no terminal-content copy
```

The raw counter is deliberately before parser, decoder, scrollback,
persistence, port scanning, and event publication. It therefore records that a
new PTY read occurred even when control bytes or shell-integration data are
removed from visible output.

## Process and terminal identity

### `ProcessIdentity`

`ProcessIdentity` is an immutable pair:

| Field | Meaning |
| --- | --- |
| `pid: u32` | OS PID returned by the PTY child after spawn |
| `start_ticks: u64` | Linux kernel boot-tick start time read from `/proc/<pid>/stat` field 22 |

PID alone is not a stable identity because the kernel can reuse it. The
`start_ticks` value lets later discovery reject a different process that has
reused the same PID. It is not derived from a display label, command string,
foreground process group, or persisted session metadata.

`TerminalIdentity` separately combines the reusable public `session_id` with
the monotonic `incarnation` allocated for each concrete PTY. A replacement
with the same public ID receives a new incarnation and a new observation
counter. Readers from the evicted incarnation retain their old `Arc` and cannot
advance the replacement's counter.

### `RootQualification`

The PTY child root is represented explicitly:

| Variant | Meaning | Policy consequence |
| --- | --- | --- |
| `Qualified { identity }` | Child PID and start ticks were read and verified | Root may be consumed by later process discovery |
| `Uncertain { pid, reason }` | A child PID exists, but the start-time probe failed or was uncertain | Keep the terminal usable; observation is incomplete |
| `Unavailable { reason }` | The PTY implementation did not provide a PID | Keep the terminal usable; no root identity is guessed |

`is_qualified()` is true only for `Qualified`. `process_identity()` returns an
identity only for that variant; `pid()` may return the captured PID for either
`Qualified` or `Uncertain`. A failed probe is not repaired by attaching to a
later process with the same PID, and it is not a reason to kill the terminal.

The minimum parser (`parse_proc_stat`) safely finds the first opening and last
closing parentheses around `comm`, so names containing spaces or nested
parentheses do not shift the state, parent PID, or start-ticks fields. The
Linux probe reads `/proc/<pid>/stat`; non-Linux builds report that this probe is
unsupported. Probe work happens after spawn and outside the manager lock.

## Raw PTY output evidence

Each live incarnation owns one `Arc<AtomicU64>` named
`raw_output_sequence`. It starts at `0` for normal creation, restored-buffer
creation, and automatic respawn. The reader receives the same handle, while a
snapshot clones the `Arc` without copying output.

The counter has sequence semantics, not byte semantics:

- one successful `reader.read` result with `n > 0` increments it once;
- the increment occurs before any parser, decoder, buffer, persistence, port
  scan, or event work;
- hydration, replay, attach, resize, and retained scrollback do not increment
  it;
- no terminal bytes, ANSI text, command text, or per-byte loop is needed;
- `u64::MAX` is `SATURATED_COUNTER_SENTINEL`; increments saturate there and
  never wrap.

This counter must not be confused with `ScrollbackBuffer::total_written`,
which is a retained-buffer byte offset for replay. A saturated output counter
makes the activity snapshot incomplete until a new PTY incarnation establishes
a fresh baseline.

## Input admission

`PtySessionManager` owns one manager-wide `input_revision` and one private
monotonic `last_input_at: Option<Instant>` across all sessions. They describe
accepted terminal input, not a per-session byte offset. Any accepted nonempty
input resets the future quiet window, including input sent to a service-only
terminal. `Instant` is monotonic and is intentionally not serialized.

There is no client-supplied expected revision and no write acknowledgement in
the current terminal wire protocol. The revision is an internal observation
fence for later sampler/coordinator work.

Admission order for `PtySessionManager::write(id, data)` is:

| Condition | Result |
| --- | --- |
| `data` is empty | Return `Ok(())`; do not lock, increment, timestamp, invalidate, or write |
| A suspend handoff is active | Return `AppError::IdleSuspendHandoffInProgress`; do not touch the writer or record activity |
| Manager is closing or disposing | Return `AppError::Unavailable` |
| `id` is not live | Return `AppError::SessionNotFound` |
| `input_revision == u64::MAX` | Return `AppError::Unavailable`; do not reuse a saturated revision |
| All gates pass | Save prior revision/time, increment revision, set `last_input_at`, publish invalidation, then write while holding the existing manager lock |
| Writer fails | Restore the prior revision/time and return `AppError::PtyError`; failed bytes are not reported as accepted |
| Writer succeeds | Keep the new revision/time; the input is admitted |

The same handoff gate applies to automatic and manual handoff state. Rejected
input is never queued or replayed. Keeping the existing lock during the
`LiveSession` writer call serializes the evidence update with the admission
decision; Phase 02 does not introduce an asynchronous writer queue.

## `PtyActivitySnapshot`

`capture_activity_snapshot()` returns a bounded, private
`PtyActivitySnapshot`:

| Field | Meaning |
| --- | --- |
| `fleet` | Content-free authoritative `PtyFleetSnapshot`, including generation, live/creating/restart-pending counts, disposal/shutdown, and handoff flags |
| `input_revision` | Manager-wide revision captured at the same manager boundary |
| `last_input_at` | Manager-wide monotonic timestamp for the last admitted nonempty input |
| `roots` | One `RootActivityRecord` for each live session, containing `TerminalIdentity`, `RootQualification`, and an `Arc<AtomicU64>` counter handle |
| `captured_at` | Monotonic capture timestamp |
| `incomplete_reason` | First explicit reason the evidence cannot currently qualify for automatic handoff, or `None` |

The snapshot copies no terminal content, command, argument, environment, or
socket data. It takes the manager lock only long enough to copy scalar values,
clone root records, and load each atomic counter. Procfs reads are not performed
while the lock is held.

The live-root scan is bounded by `MAX_LIVE_ROOTS_LIMIT` (256). More than 256
live roots returns an empty root vector with `ScanLimitExceeded` rather than a
truncated or falsely complete view. Other incomplete reasons are:

- `RootUnqualified` — a live root is `Uncertain` or `Unavailable`;
- `CounterSaturated` — a live root's raw sequence reached `u64::MAX`;
- `RevisionSaturated` — the manager input revision reached `u64::MAX`.

`is_complete()` is true only when `incomplete_reason` is `None`. Later automatic
policy code must treat an incomplete snapshot as unavailable, never as quiet,
empty, or zero-agent. Snapshot completeness does not itself identify an agent;
Phase 03 must qualify process names and descendants.

## `PtyActivityWatcher`

`PtyActivityWatcher` is a cloneable wrapper around a private Tokio
`watch::Receiver<u64>`. It is a coalescing wake-up seam, not an event log and
not a public status channel.

| Method | Behavior |
| --- | --- |
| `revision()` | Borrow the latest private invalidation revision without marking it seen |
| `mark_seen()` | Mark the current revision as observed |
| `borrow()` | Borrow the underlying latest revision |
| `changed().await` | Wait for a newer revision; returns `RecvError` if the channel closes |

`PtySessionManager::activity_watcher()` clones the manager receiver and marks
the clone seen before returning it. The manager advances this channel when
nonempty input is admitted and at create/respawn reservation and live-session
publication boundaries. `PtyFleetWatcher` remains the authoritative lifecycle
watcher for every fleet count/generation transition, including removal, EOF,
disposal, and handoff changes. A consumer that needs complete lifecycle
wakeups combines the fleet watcher with a fresh activity snapshot.

A watcher revision only says that some relevant state may have changed. It does
not identify the session, preserve one notification per event, or substitute
for the snapshot's generation, incarnation, root qualification, and atomic
counter values.

## Privacy and failure rules

- Root identity and terminal incarnation are private server-side evidence.
- Raw terminal output, input bytes, command lines, arguments, CWD, environment,
  and socket details do not enter the snapshot, watcher, audit, or public
  WebSocket hint.
- Observation failure does not prevent ordinary PTY creation, execution,
  resize, attach, or termination.
- Unknown, uncertain, saturated, or oversized evidence is explicit and
  fail-closed for later automatic handoff.
- Downstream warning/reporting phases may expose a currently attributable PID
  and safe executable identity only through an authenticated, no-store status
  contract. Phase 02 does not produce that report or log process identity.

## Verification coverage

The focused `pty_activity_tests` module covers the observable boundaries:

- raw sequence increment and saturation without wrap;
- safe `/proc/<pid>/stat` parsing and self-identity probing;
- empty input as a no-op and nonempty input advancing revision/time/watcher;
- handoff rejection without recording activity, followed by successful input
  after release;
- independent zeroed counters for reused public IDs and new incarnations;
- hydration, resize, and attach replay without output-counter increments;
- real local PTY root capture and output observation; and
- explicit incomplete snapshots for counter, root, and revision saturation.

The Phase 02 evidence report records 8/8 focused activity tests and 159 passed
PTY-module tests with one pre-existing ignored performance test.

## Next phases and limitations

Phase 02 is an evidence seam only. It does not inspect descendants, classify
configured agent executables, read owned TCP counters, calculate blocked
durations, expose status warnings, or claim automatic suspend eligibility.
Phase 03 consumes `ProcessIdentity` and the shared proc-stat parser while
retaining detached lineage. Phase 04 supplies typed owned-socket inputs. Phase
05 combines those inputs with raw output and accepted-input revisions under a
final generation-fenced claim. No automatic `agent-activity` policy claim ships
from this phase alone.

## Unresolved questions

None requiring a product decision. Platform procfs support, service
permissions, and observer latency remain qualification prerequisites; polling
cannot prove that autonomous work will not start immediately after a final
sample.
