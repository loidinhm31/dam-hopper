## Code Review Summary

**Score: 7.5/10**  
Scope: `apps/native/src-tauri/src/ssh_forward/manager.rs` (2,447 LOC), terminal-cleanup paths only. No edits.

### Critical Issues
- None.

### Warnings
- **High — `apps/native/src-tauri/src/ssh_forward/manager.rs:1164-1182`**: `force_close()` clears `abort_handles` before a fallible `runtimes.try_lock()`. If that lock is briefly held, workers are aborted but their `RuntimeEntry.worker` / `stop_tx` remain in the manager map. Because aborting the wrapper prevents `finished_tx.send()`, `worker_finished()` will not later remove those stale handles. Retry/schedule map cleanup after lock contention, or make cleanup ownership independent of `try_lock`.
- **High — `apps/native/src-tauri/src/ssh_forward/manager.rs:1271-1273, 1636-1658`**: a `TcpListener::accept()` error breaks the worker without calling `fail_runtime`. `worker_finished()` removes the handle but leaves the matching runtime state as `Running`/`Starting` with no worker. UI and active-forward accounting can report a live forward that has ended. Mark matching generation failed before breaking.

### Verified behavior
- Normal worker completion after explicit failure, connection failure, reconnect exhaustion, or graceful stop signals `finished_tx`; external notifier removes only matching-generation `worker`, `stop_tx`, and abort handle.
- Worker never awaits its own `JoinHandle`; `close_workers_until` owns and awaits moved handles externally.
- Stop/restart retires old worker handles before registering a replacement; generation comparison prevents old completion from removing newer-generation handles.
- Graceful shutdown signals all workers before waiting; forced phase aborts recorded workers and attempts joins.
- Existing tests cover graceful worker signaling, forced cancellation/drop behavior, and channel-task drainage. They do **not** cover the two map/state failure cases above.

### Validation
- `cargo fmt --manifest-path apps/native/src-tauri/Cargo.toml --check` passed.
- `git diff --check -- apps/native/src-tauri/src/ssh_forward/manager.rs` passed.
- Runtime tests/typecheck deferred per supplied Windows error `0xc0000139`.

### Unresolved Questions
- None.