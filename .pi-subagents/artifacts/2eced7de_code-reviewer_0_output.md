## Code Review Summary

### Scope
- Reviewed: Phase 04 plan/status; `manager.rs`, `shutdown.rs`, `lib.rs`, commands; Phase 05 adapter.
- Focus: fresh Windows native validation.
- Updated plans: none (requested no edits).

### Overall Assessment
Implementation and fresh native validation are strong. Prior `0xc0000139` blocker is cleared locally: full native suite passed. But Phase 04 TODO status cannot honestly become fully Complete yet: two required test claims lack deterministic evidence.

### High Priority Findings
1. **Challenge approval → explicit new Start untested**
   - `repeated_challenge_blocks_restart_until_stop_clears_it` manually seeds the challenge and verifies Start/Restart remain blocked, then approval leaves runtime `Failed` (`manager.rs:2616–2730`).
   - It never calls the required explicit **new Start after approval** and proves listener/running generation succeeds.
   - Thus Phase 04 TODO “Challenge repeat/approval/explicit restart behavior passes” remains incomplete.

2. **Pending-intent purge race test is not deterministic**
   - Guard exists and is correct-looking: rejects active scope or `intent.desired_scope_id` (`manager.rs:1129–1137`).
   - Test releases `command_gate` before invoking purge (`2577–2610`). Activation can acquire that fair gate, commit scope, and make purge fail solely via active-scope check.
   - It does not prove the pending-intent branch blocks purge before activation commits. Keep purge TODO incomplete until a controlled barrier asserts `active_scope == None`, pending desired scope exists, then purge returns `SCOPE_ACTIVE`.

### Positive Observations
- **Production russh test passed:** real in-process `russh` server, key auth, trusted host key, production worker reaches `Running`, loopback listener accepts, Stop makes it unreachable (`2737–2875`).
- **1,000 real randomized activations passed:** concurrent manager activation schedule commits token `1000` and expected scope.
- **force_close coverage passed:** runtime lock contention and call from a non-Tokio thread both reap runtime entries.
- **Shutdown seams passed:** close prevention/trigger and exit prevention seam tests; mock-app coordinator proves one-shot cleanup, bounded coordinator state, and manager shutdown.
- Listener closure tests pass for Stop, scope switch, dispose, and production worker.
- `cargo fmt --check`, clippy with `-D warnings`, targeted tests, and full Cargo suite pass.
- No relevant code TODO/FIXME/HACK found.

### Recommended Actions
1. Add a real unknown-host flow: Start → emitted challenge → approve → explicit Start → `Running`/listener reachable; then Stop.
2. Make staged-purge race deterministic with an activation barrier between intent admission and scope commit.
3. After those pass, replace stale Phase 04 “blocked due `0xc0000139`” wording with completed validation evidence. Keep Phase 07 packaged/release gates explicitly deferred; they do not block Phase 04 completion.

### Metrics
- Native Cargo tests: **138 passed, 1 ignored, 0 failed**
- Manager subset: **21 passed**
- Commands: **1 passed**
- Shutdown: **3 passed**
- Lint/format: **0 reported issues**

### Unresolved Questions
- None.