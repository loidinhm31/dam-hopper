# Phase 02 — PTY root identity, raw output and input admission

## Context links

- [Plan](plan.md), [normative contract](design-contract.md), [policy prerequisite](phase-01-policy-contracts.md).
- [Manager](../../server/src/pty/manager.rs), [live session](../../server/src/pty/session.rs), [fleet state](../../server/src/pty/fleet_state.rs), [WebSocket input](../../server/src/api/ws.rs).
- Consumers: [process discovery](phase-03-process-discovery.md), [sampler/coordinator](phase-05-sampler-coordinator.md).

## Overview

- Date: 2026-09-10.
- Description: expose bounded private evidence from actual PTY boundaries and serialize accepted input with suspend handoff.
- Priority: P2. Estimated implementation effort: 8h.
- Implementation status: Pending. Review status: user validation incorporated; implementation contract review remains required.
- Dependencies: Phase01 policy/type decisions. No procfs collector or coordinator state machine in this phase.

## Key Insights

- `LiveSession` currently retains a killer and master PTY, not the immutable root child identity. `MasterPty::process_group_leader()` returns current foreground process group and cannot supply the required root PID.
- `create_with_buffer` and supervisor respawn must initialize identical per-incarnation observation state. A restored scrollback buffer is not evidence of new process output.
- `reader_thread` receives raw bytes before its `process_chunk` closure strips shell integration/control data. Put the counter at this boundary, not into terminal rendering or persisted scrollback offsets.
- `PtySessionManager::write` already holds the manager lock across `LiveSession::write`; it currently records neither input revision nor a handoff rejection. Preserve this serialization while adding the gate; do not redesign writer concurrency in this feature.
- Fleet snapshots must continue reporting real live sessions. A live service is not a dead/tombstone session merely because the new automatic policy may ignore its activity.

## Requirements

1. Private `ProcessIdentity { pid: u32, start_ticks: u64 }` and `TerminalIdentity { session_id, incarnation }`. Use existing incarnation allocator, never derive identity from display label, command, current PGID or persisted metadata.
2. Each live incarnation owns one shared `Arc<AtomicU64>` raw output sequence, initialized to zero. `u64::MAX` is an unavailable/saturated sentinel. Never wrapping-add this evidence counter.
3. Successful nonempty raw reads increment once per chunk, before parser/decoder/buffer/persistence/event work. No new output copies, content inspection, manager locks, per-byte loops or per-chunk activity events.
4. Manager owns monotonic `input_revision` and `last_input_at`. Accepted nonempty input anywhere resets quiet, even when no configured agent exists. Empty payload is a no-op, not an activity generator.
5. Writes after accepted automatic OR manual handoff return `AppError::IdleSuspendHandoffInProgress` before touching the writer. Do not queue or replay rejected input.
6. Phase02 supplies snapshot handles and immediate input/lifecycle invalidation. Phase05 owns observation publication and final agent-policy claim; do not accidentally add a permissive claim before its validator exists.
7. Observation failure never prevents ordinary PTY creation or execution. Missing/uncertain root identity is an explicit unavailable observation, not PID zero or an absent managed root.
8. Validated warnings may expose an attributable PID and safe executable identity downstream through authenticated/no-store status, but never from the raw reader/input/lifecycle event path. This phase supplies exact private root/incarnation evidence only; Phase03 qualifies safe names, Phase05 owns blocked duration/DTO, and Phase06 renders it. No added per-byte cost or command/argument collection.

## Architecture

Suggested private seam in existing PTY module (a small `pty/activity.rs` is justified for types and identity probing; no public API route):

- `PtyActivitySnapshot`: current fleet snapshot, captured input revision/time, bounded vector of live root records, capture time, explicit incomplete reason when root limit/identity cannot qualify.
- Root record: terminal identity, actual child PID/root identity qualification state, cloned atomic output handle. Retain no terminal contents, arguments or environment.
- `capture_activity_snapshot()`: lock manager, inspect bounded authoritative live records, clone scalar identity/Arc handles, unlock. Slow procfs reads never occur here.
- `activity_watcher()`: coalescing private watch/revision invalidation for accepted input and lifecycle changes; use existing fleet watcher for lifecycle where possible. Never add input contents to fleet/public status.
- Final claim integration later compares input revision, incarnation/root set, current relevant raw sequences, lifecycle state and observation ticket under this same admission mutex.

Root start-time probing takes place after `Child::process_id()` is captured and outside the manager lock, before publishing a qualified root. A spawn-time probe result may be uncertain; subsequent sampler qualification must validate against the originally captured PID and child/incarnation lifetime, not attach to a reused PID. Phase02 owns the minimum shared `/proc/<pid>/stat` parser/identity reader in `pty/activity.rs` (PID, PPID, start ticks; parse parenthesized command safely). Phase03 reuses it for full discovery and PID-reuse validation. This avoids a Phase02→03→02 implementation dependency and duplicate parsers.

A root whose original identity could not be captured cannot later be declared safe solely because a process now has that PID. Keep that incarnation unqualified unless a child-lifetime-aware proof is available; next real respawn naturally creates a new qualification opportunity. User terminal remains operational. Do not attempt to repair uncertainty by killing the child.

## Related code files

Modify:

- `server/src/pty/session.rs`: ephemeral root/observation fields, constructor and handle accessors.
- `server/src/pty/manager.rs`: `Inner`, initializers, `create_with_buffer`, supervisor respawn, `reader_thread`, `write`, snapshot seam, lifecycle bookkeeping.
- `server/src/pty/mod.rs`: private module/type visibility if a small new `activity.rs` is introduced.
- `server/src/pty/fleet_state.rs`: only private invalidation integration if necessary; preserve `is_quiescent`, public counts and existing legacy/forced claim semantics.
- Existing inline PTY manager/session tests: meaningful raw-output, input and incarnation regressions.

Inspect/migrate callers:

- `server/src/api/ws.rs`: `ClientMsg::TermWrite`; current transport logs write failure and has no generic terminal-write acknowledgement. Preserve wire protocol, never report rejected bytes as accepted. Existing diagnostics may count attempted input only; do not reinterpret it as activity authority.
- Every `LiveSession::new`, manager write and reader-loop callsite identified using LSP references. Direct session writer bypasses must not remain in production paths.
- `server/src/error.rs`: reuse existing handoff error; do not introduce a second error code for this gate.

Do not modify shell adapters, terminal persistence format, transcript rendering, helper protocol or terminal termination semantics.

## Implementation Steps

1. Read full create, respawn, reader, exit and write paths before editing. Run LSP references on exported constructors/write functions when available. Record each place that establishes or destroys an incarnation.
2. Add private identity and output-handle state. Keep fields out of serde `SessionMeta` and persisted session records. Allocate one counter with the incarnation, clone only Arc handles into the reader and snapshots.
3. Capture child process ID immediately after successful spawn, before handing child ownership to reader/wait logic. Resolve the start-time identity outside the manager mutex; preserve an explicit uncertain state on failure. Never use foreground PGID as fallback.
4. Initialize raw counter identically for create, auto-respawn and restored live sessions. Restored buffer hydration must leave it at zero. A replacement with the same public ID gets a different incarnation and counter; stale reader handles cannot advance the replacement's evidence.
5. Increment counter at raw reader `Ok(n)` for `n > 0`, before `process_chunk`. Use a checked/saturating atomic update with `u64::MAX` as sentinel. Atomic accesses use one documented ordering consistently; ordering does not claim to fence kernel/network work. Counter overflow makes observation unavailable until a new incarnation rather than wrapping.
6. Add manager input revision/time. Under existing lock, check closing/disposal/handoff according to current admission rules, validate a live target, then record nonempty input before invoking writer. Failed writer attempts may reset conservatively; not-found and handoff rejection do not constitute accepted activity. Checked revision overflow becomes unavailable rather than equality reuse.
7. Publish a private coalesced invalidation when input is admitted. Fleet reservations already invalidate lifecycle; ensure create and restart reservations do so before slow spawn starts. Do not produce a public status event or copy keystrokes at this boundary.
8. Implement bounded capture: if more than 256 live roots, return `scanLimit` unavailable rather than truncate. Capture fleet generation/input revision/time and all root handles atomically under lock; readers update raw counters independently. No filesystem reads while locked.
9. Define disposition of snapshot handles after removal: Phase03 retains identities of already-discovered agent descendants independently. Handle removal is not proof that every descendant exited; removed-root callback cannot erase that retained lineage. Live session counts remain accurate.
10. Integrate write gate with existing error handling without adding an acknowledgement protocol. Phase06 will show handoff state; server rejection remains authoritative even if UI state lags.
11. Add deterministic tests below and a real PTY smoke using a harmless local process, not a model CLI or suspend helper. Remove disposable smoke scripts after observation. Preserve the failed-prechange/pass-postchange handoff-input regression.
12. Hand Phase05 exact snapshot/invalidation types and Phase03 root identities. Serialize later edits to `manager.rs`: Phase02 owns this phase; Phase05 becomes integration owner after handoff.
13. Hand off private qualified root evidence for blocked-measurement diagnostics without serializing it at the PTY boundary. Root qualification failure preserves terminal usability and unavailable measurement; downstream warning may omit PID or use null executable when current evidence cannot safely identify a blocker.

## Todo list

- [ ] Capture actual root PID and qualified start identity.
- [ ] Add per-incarnation saturating raw output counter.
- [ ] Cover create respawn restore and stale-reader paths.
- [ ] Track accepted input before writer dispatch.
- [ ] Reject writes under existing handoff gate.
- [ ] Expose bounded private root/input snapshots.
- [ ] Verify no content or filesystem I/O enters admission lock.
- [ ] Prove real PTY evidence and input rejection.
- [ ] Keep validated diagnostic reporting downstream of PTY hot paths and lifecycle events.

## Success Criteria

Keep tests that exercise observable boundaries:

- Child emits raw ANSI/control bytes stripped from visible text; observation changes and automatic eligibility is invalidated when that terminal is agent-owned. Counter-only unit seam may support this; do not assert exact incidental read chunk counts.
- Hydrate/replay/clear/resize alone does not look like newly produced output.
- Reused session ID with new incarnation cannot inherit old counter/identity; late old reader activity cannot qualify the replacement.
- Non-newline input invalidates a pre-input snapshot before reaching writer, including input in a service-only terminal.
- Accepted handoff rejects input and create/restart; after release, a newly issued input is accepted, but rejected bytes are not replayed.
- Failed identity probe leaves a functioning terminal while agent observation is unavailable.
- Saturation/oversized root set is unknown, never quiet or zero-agent.

Future focused command from repository root:

```sh
cargo test --manifest-path server/Cargo.toml pty::
```

Runtime smoke: start a managed local shell, capture its actual child PID through private test instrumentation, write a non-newline byte, emit visible and control output, hydrate an independent replay, and inspect observations through the eventual coordinator status. Use fake executor for claim/release. Assert the accepted/rejected behavior, then close only fixture-owned sessions. This end-to-end portion waits for Phase05; Phase02's immediate proof uses the real manager/PTY seam.

## Risk Assessment

- A root PID captured late can already have exited: explicit uncertainty is safer than attaching to a reused PID.
- Missing respawn initialization would leave a permanent blind spot: creation and replacement smoke cases are mandatory.
- Input-only activity needs a wake path independent of fleet-count changes; a revision stored without notification delays invalidation.
- Current writer holds manager lock during I/O. Do not broaden scope to a new async writer queue; retain the existing lock order and measure responsiveness in Phase07.
- Raw output after the final atomic comparison can still race a claim; the overall heuristic does not freeze autonomous processes.

## Security Considerations

No raw command text, arguments, output, environment or input content in activity status/audit. Root start identity and terminal IDs remain private; only Phase05's authenticated/no-store warning may project a currently attributable PID and qualified safe executable identity. This phase never emits that report or adds identity logging. No additional privileged syscall, shell parsing or process control. Input gate applies to manual handoff too; document this admission change explicitly.

## Next steps

Phase03 consumes qualified roots and retains discovered lineage. Phase04 consumes its owned sockets. Phase05 combines them with raw output/input and implements the final ticketed claim. No automatic agent-policy claim may ship from Phase02 alone.

## Unresolved questions

None requiring product choice. Any platform that cannot qualify the root remains unavailable for agent policy; it must not guess identity to pass a fixture.
