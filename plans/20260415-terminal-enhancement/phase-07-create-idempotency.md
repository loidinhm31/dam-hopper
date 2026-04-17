# Phase 07 — Tombstone Idempotency on terminal:create

## Context
- Parent: [plan.md](./plan.md)
- Source: [terminal-crash-debug.md § Unresolved Q2, Failure Mode 4/5](./terminal-crash-debug.md)
- Dependencies: Phase 1 (predicate still there as belt-and-suspenders). Not blocked by Phase 4, but safer to land after restart engine is stable.

## Overview
- Date: 2026-04-16
- Description: Make `terminal:create` drop any matching `DeadSession` tombstone before spawning, so clients never have to distinguish live from dead. Deprecates the client-side `alive` filter.
- Priority: P2
- Implementation status: completed
- Review status: approved (9.5/10)
- Completed: 2026-04-17

## Key Insights
- `PtySessionManager::create` currently kills any live session with the same id but does NOT remove a dead tombstone. Client must detect.
- Making create fully idempotent simplifies the web client and aligns with how process supervisors behave.
- Interaction with Phase 4: supervisor may hold an id in either `live` (after respawn) or pending in `RespawnCmd` queue with delay. Create should cancel any scheduled respawn for that id before spawning fresh.

## Requirements
- `create(opts)` removes `Inner.dead[id]` if present.
- `create(opts)` cancels any pending respawn for that id (e.g., by inserting id into `killed` set, which supervisor re-checks after sleep).
- Client no longer needs `&& s.alive` predicate from Phase 1, but keep it as defensive code.

## Architecture
Server-only change within `PtySessionManager::create`.

## Related Code Files
- `server/src/pty/manager.rs::create`
- `server/src/pty/tests.rs`

## Implementation Steps
1. In `create`, after killing any live session with same id, also `inner.dead.remove(id)`.
2. Insert id into `killed` set before releasing lock so a racing supervisor respawn bails.
3. After successful spawn, remove id from `killed` set.
4. Integration test: spawn process that exits with code 1, policy=on-failure, during backoff window issue `terminal:create` — assert new session starts immediately, supervisor's pending respawn is a no-op.
5. Update Phase 1 comment to note this is now defense-in-depth.

## Todo
- [x] `create` drops dead tombstone
- [x] `create` inserts into `killed` pre-spawn, removes post-spawn
- [x] Supervisor re-check after backoff respects `killed`
- [x] Race integration test
- [x] Comment update in Phase 1 code site

## Success Criteria
- `cargo test` passes including new race test.
- Calling `terminal:create` with an id that has a dead tombstone always produces a live session.

## Risk Assessment
- Low. Manager is the single source of truth; the race is well-contained.
- Edge: during Phase 4 backoff, user clicks "run" again — should NOT result in two shells. Killed-set guard ensures at most one winner.

## Security Considerations
None.

## Next Steps
Feature complete. Open unresolved-question items on default policy + clean-exit counter reset (see plan.md).
