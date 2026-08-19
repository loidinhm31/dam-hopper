## Code Review Summary

**Score: 8/10 — warning**

### Scope
- Reviewed: `apps/native/src-tauri/src/ssh_forward/manager.rs`
- Focus: `force_close` abort-map cleanup; reconnect `accept()` errors.
- No edits made.

### Critical
- None.

### Warnings
- **High** — `apps/native/src-tauri/src/ssh_forward/manager.rs:1380`: the reconnect-backoff `listener.accept()` error still maps to `LocalPortInUse`, while the later reconnect `accept()` error maps to `BindFailed` (`:1412`). An already-bound listener cannot meaningfully report local-port contention here; this leaves one reconnect accept-failure path misclassified. Map `:1380` to `BindFailed` too.

### Positive
- `force_close` now snapshots/aborts handles then clears `abort_handles` before attempting `runtimes.try_lock()` (`manager.rs:1164-1189`), so runtime-lock contention cannot retain abort handles.
- Cleanup repeats after runtime shutdown; harmless defense-in-depth.
- `cargo check --lib` passes.
- `git diff --check` passed.

### Residual risks
- Runtime test execution intentionally not performed: external Windows loader failure `0xc0000139`.
- Static review found the early reconnect-backoff accept-error classification above.

### Unresolved questions
- None.