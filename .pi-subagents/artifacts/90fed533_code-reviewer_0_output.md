## Code Review Summary

**Score: 7/10 — do not continue to Phase 05 until High finding fixed.**

### Scope
- Reviewed: Phase 04 manager, command boundary, shutdown integration, plan status.
- Validation: static only; runtime tests intentionally not run (`0xc0000139` deferred).

### Critical Issues
- None.

### Warnings

1. **High — completed workers remain retained in manager maps**
   - `apps/native/src-tauri/src/ssh_forward/manager.rs:1177-1335,1601-1625`
   - A worker that fails initial connect, exhausts reconnect, or exits after listener failure calls `fail_runtime()` then returns, but never removes its own `worker` `JoinHandle` or corresponding `abort_handles` entry.
   - This violates Phase 04 requirement that no task/handle remains in manager maps, retains completed task resources indefinitely, and makes runtime ownership inaccurate until a later Stop/Restart/dispose.
   - Fix: on all worker terminal paths, conditionally remove/reap the matching generation’s stored handle and abort-handle. Avoid a task awaiting/removing its own handle; hand off reaping or centralize worker completion notification.

2. **Medium — plan marks unexecuted runtime assertions as passed**
   - `plans/260808-1310-ssh-port-forwarding-control/phase-04-native-manager-tauri-ipc.md:157-161`
   - These items say activation, reload, restart, and auto-start behavior “prove/pass,” while line 28 states native test executables fail before assertions and runtime validation is deferred.
   - Keep implementation claims, but mark proof/pass evidence pending (or explicitly static-only) until tests execute. Main plan correctly remains blocked.

### Positive Observations
- Auto-start reservation precedes concurrent launches; active cap is deterministic.
- Handshake semaphore correctly limits connection attempts to four.
- Reconnect accept loop drops new sockets while retaining bind reservation.
- Command allowlist, manifest, capability, handler registration, and main-window guard are consistently 12 commands.
- `cargo check` passes; `git diff --check` passes.

### Validation Evidence
- `cargo check --manifest-path apps/native/src-tauri/Cargo.toml` — passed.
- `git diff --check` — passed.
- Runtime tests — not run per requested Windows runtime deferral.

### Recommended Actions
1. Fix terminal worker handle/abort-map cleanup and add a static async test for failed worker completion cleanup.
2. Correct Phase 04 TODO evidence wording; retain overall blocked status.

### Unresolved Questions
- None.