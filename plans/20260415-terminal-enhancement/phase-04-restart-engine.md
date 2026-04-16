# Phase 04 — F-01 Auto-Restart Engine (CORE)

## Context
- Parent: [plan.md](./plan.md)
- Source: [f01-feasibility-plan.md § Phase 3](./f01-feasibility-plan.md)
- Dependencies: Phase 2 (enum), Phase 3 (respawn template on `LiveSession`).

## Overview
- Date: 2026-04-16
- Description: Make PTY reader thread decide whether to respawn on EOF. Exponential backoff 1s→30s, max retries, suppress on manual kill, reset counter on clean-after-restart.
- Priority: P1
- Implementation status: pending
- Review status: pending

## Key Insights
- Reader thread runs on a blocking OS thread (portable-pty reader). It cannot call `async fn create` directly. Schedule respawn via `tokio::runtime::Handle::current().spawn(...)` captured at manager construction, or pass a `tokio::sync::mpsc::UnboundedSender<RespawnCmd>` consumed by a supervisor task.
- Recommended: **supervisor task** pattern. Cleaner separation; avoids capturing a Handle in the blocking thread. Manager spawns a long-lived `supervisor_loop` that owns the async respawn logic.
- `was_killed` must be set BEFORE the process is signaled, so the reader thread sees it when it observes EOF.
- Reuse the same session ID on respawn — existing `create()` kills any prior session with the same id, so the supervisor path should call a dedicated `respawn_internal()` that skips that kill and writes directly into `Inner.live`.

## Requirements
- Decision matrix from plan's test matrix must be honored exactly.
- Backoff: `min(1000 * 2^restart_count, 30_000)` ms.
- `restart_count` resets to 0 when a clean exit (code=0) occurs on a previously restarted session.
- Manual kill (`kill`, `remove`, session drop from API) never restarts.
- Respawn reuses same id, same command, fresh PID; fires `process:restarted` WS event (Phase 5).
- Supervisor is crash-safe: a panic inside respawn must not poison the manager lock.

## Architecture
```
┌──────────────────┐   EOF       ┌──────────────────┐
│  reader_thread   │────────────▶│  harvest_exit    │
│ (blocking OS thr)│             │  decide_restart  │
└──────────────────┘             └────────┬─────────┘
                                          │ respawn decision
                                          ▼
                            mpsc::UnboundedSender<RespawnCmd>
                                          │
                                          ▼
                                ┌──────────────────────┐
                                │  supervisor_loop     │
                                │  (tokio task)        │
                                │   - sleep backoff    │
                                │   - respawn_internal │
                                │   - emit events      │
                                └──────────────────────┘
```

## Related Code Files
- `server/src/pty/manager.rs` — reader thread, `Inner` struct (add `killed: HashSet<String>`), new `supervisor_loop`, `respawn_internal`.
- `server/src/pty/session.rs` — no changes beyond Phase 3.
- `server/src/pty/tests.rs` — unit + integration tests.

## Implementation Steps
1. Add `killed: HashSet<String>` to `Inner`. `kill()`/`remove()` insert id before actual termination.
2. Add `fn decide_restart(policy, exit_code, was_killed, restart_count, max_retries) -> Option<u64>` pure function returning `Some(delay_ms)` or `None`.
3. Add `fn restart_delay_ms(n: u32) -> u64` with cap at 30_000.
4. Add `RespawnCmd { id, prev_exit, restart_count, respawn_template, delay_ms }` enum + `mpsc::UnboundedChannel`.
5. In reader_thread EOF branch: after `harvest_exit_code`, call `decide_restart`; if Some, dispatch `RespawnCmd` and set `DeadSession.will_restart = true`, `restart_in_ms = Some(delay)`.
6. Supervisor task: loops on channel, `tokio::time::sleep(delay)`, checks `killed` flag again (user may have removed session during backoff), then calls `respawn_internal`.
7. `respawn_internal`: builds fresh PTY from template, bumps `restart_count`, keeps same id, moves from `dead` back to `live`. Fire `process:restarted` event.
8. Clean-exit reset: in reader_thread, if `exit_code == 0` and previous `restart_count > 0`, fire event with `restart_count` but supervisor sets next spawn's counter to 0 (encoded in the template — actually simpler: reset counter when deciding not-to-restart on clean exit so subsequent failures start fresh).

## Todo
- [ ] `Inner.killed` set + invariant docs
- [ ] `decide_restart` pure fn + unit tests (8 cases from plan matrix)
- [ ] `restart_delay_ms` + unit test
- [ ] RespawnCmd channel + supervisor task wired in `PtySessionManager::new`
- [ ] Reader thread EOF integration
- [ ] `respawn_internal` keeps same id
- [ ] Integration test: spawn `sh -c 'exit 1'` with policy=on-failure → assert 3 restarts then give up at max_retries=3
- [ ] Integration test: kill via API mid-run → no restart
- [ ] Integration test: always-policy + clean exit → restart

## Success Criteria
- All unit + integration tests pass.
- No orphaned child processes after kill.
- Crash loops logged at `warn` with throttling.

## Risk Assessment
- **Medium-High**. Highest complexity phase.
- Race: `killed` flag set after EOF already observed → reader sees clean exit and respawns. Mitigation: set `killed` synchronously under the same lock that removes from `live`.
- Race: supervisor wakes up while user calls `terminal:create` for same id → both try to insert into `live`. Mitigation: `respawn_internal` takes the lock and bails if id already live.
- Thread-runtime mixing: blocking reader thread must not hold Tokio mutex across .await — it doesn't (only uses std locks + mpsc::UnboundedSender which is sync-safe).

## Security Considerations
- Infinite crash loops bounded by `restart_max_retries`. Default 5 is conservative.
- Env vars in respawn template are the same as initial spawn — no escalation surface.

## Next Steps
Phase 5 adds the wire events the supervisor emits.
