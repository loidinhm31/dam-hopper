## Code Review Summary

### Scope
- Files: `manager.rs`, `shutdown.rs`, `lib.rs`, IPC/model/store/trust changes.
- Focus: force-close cleanup, listener accept failures, concurrent auto-start/reaping.
- Static only; native test executables externally blocked (`0xc0000139`).

### Overall Assessment
**Score: 8/10.** Targeted fixes are statically sound: workers receive stop before concurrent join/reap; reconnect drops accepted clients while handshake proceeds; auto-start reserves deterministic candidates and bounds handshakes to four.

### Critical Issues
- None.

### Warnings
- **Medium** — `apps/native/src-tauri/src/ssh_forward/manager.rs:1164`: `force_close()` clears `abort_handles` only if `runtimes.try_lock()` succeeds. Under lock contention, aborted-handle map entries remain until process termination. Clear `abort_handles` independently of `runtimes` acquisition.
- **Low** — `apps/native/src-tauri/src/ssh_forward/manager.rs:1376,1404`: listener `accept()` failure during reconnect returns `LocalPortInUse`, although the listener is already bound. Use `BindFailed`/dedicated accept failure to preserve accurate diagnostics.

### Positive Observations
- `close_workers_until()` signals every worker before awaiting and uses a single aggregate deadline with cancellation/reap reserve.
- Main accept loop fails safely rather than panicking; reconnect rejects new local clients while preserving listener reservation.
- Auto-start sort `(created_at, id)`, pre-reservation, cap visibility, and semaphore-based four-handshake concurrency match Phase 04 requirements.
- `worker_finished()` removes completed worker and abort-handle entries for its generation.

### Recommended Next Phase
Resolve the `force_close` map-cleanup warning, then proceed to **Phase 05 adapter** while retaining Phase 04 as blocked pending runtime tests on a known-good Windows host. Before Phase 07/release, run manager/commands/shutdown executable tests plus listener closure probes.

### Metrics
- Static formatting/type/lint: passed.
- Runtime tests: not run; external `0xc0000139` block.
- Critical: 0; warnings: 2.

### Unresolved Questions
- Does Tauri exit guarantee no runtime lock holder when `force_close()` executes? If not, current map cleanup is incomplete.