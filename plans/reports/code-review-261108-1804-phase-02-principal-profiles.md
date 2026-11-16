# Code Review Report: Phase 02 — Configure and Supervise Principal Profiles

## Code Review Summary

### Scope
- **Files reviewed**:
  - `server/src/config/schema.rs`
  - `server/src/config/parser.rs`
  - `server/src/config/tests.rs`
  - `server/src/browser_host/mod.rs`
  - `server/src/browser_host/config.rs`
  - `server/src/browser_host/manager.rs`
  - `server/src/browser_host/profile.rs`
  - `server/src/state.rs`
  - `server/src/main.rs`
  - `server/src/persistence/restore.rs`
  - `server/tests/browser_host_lifecycle.rs`
  - `server/tests/browser_host_shutdown.rs`
- **Lines of code analyzed**: ~2,500 LOC
- **Review focus**: Security, concurrency, OS file locks, lifecycle state transitions, crash recovery, reset idempotence, process containment, resource budgeting, YAGNI/KISS/DRY.
- **Updated plans**: `plans/261108-0237-host-browser-cdp-streaming/phase-02-managed-lifecycle.md`

### Overall Assessment
The implementation introduces solid foundation structures: SHA-256 hashed principal directories, strict prod/dev namespace isolation, 0700/0600 Unix permission enforcement, external advisory OS locks on `manager.lock` outside `user-data/`, and capability DTO evaluation without spawning Chromium. However, critical concurrency and lifecycle bugs exist:
1. `reset_profile` self-deadlocks against its own held `ProfileLock` when resetting a running instance.
2. Crash recovery in `ensure_running` fails to drop `_held_lock`, causing subsequent launches to deadlock against their own lock.
3. Reset reconciliation traps profiles permanently in `CleanupPending` on failure, and duplicate reset calls with the same `operation_id` increment `profile_epoch` multiple times instead of behaving idempotently.
4. `shutdown_all` wraps `proc.terminate()` in a 3s timeout, cancelling the grace period right before SIGKILL is dispatched.

**Score: 5.8 / 10**

---

### Critical Issues

1. **Self-Deadlock in `reset_profile` on Running Browser Instances**
   - **Path & Line**: `server/src/browser_host/manager.rs:415`
   - **Description**: While a managed browser is running, `InnerInstance._held_lock` holds an exclusive advisory OS lock on `manager.lock`. When `reset_profile` is invoked, line 415 executes `let lock = inst.profile.lock_with_timeout(DEFAULT_LOCK_TIMEOUT)?;`. On Unix, opening a new file descriptor to `manager.lock` and calling `flock(LOCK_EX | LOCK_NB)` fails with `EWOULDBLOCK` because fd1 (held by `_held_lock`) already owns the exclusive lock. `lock_with_timeout` loops for 5 seconds and returns `ProfileError::LockBusy`. Resetting an active instance always fails.
   - **Correction**: Reuse or take the existing held lock:
     ```rust
     let lock = match inst._held_lock.take() {
         Some(existing) => existing,
         None => inst.profile.lock_with_timeout(DEFAULT_LOCK_TIMEOUT)?,
     };
     ```

2. **Self-Deadlock on Crash Recovery in `ensure_running`**
   - **Path & Line**: `server/src/browser_host/manager.rs:280-287`
   - **Description**: When `ensure_running` detects an unexpected process exit (`!is_alive`), it cleans up `inst.process`, `inst.state`, and targets, but **leaves `inst._held_lock` populated**. As execution continues to line 301 (`inst.profile.lock_with_timeout(DEFAULT_LOCK_TIMEOUT)?`), it opens a new file descriptor and tries to acquire `flock(LOCK_EX)`. It blocks against its own `_held_lock`, stalls the worker thread for 5 seconds, and returns `ProfileError::LockBusy`. Crash relaunch always fails.
   - **Correction**: Explicitly clear `inst._held_lock = None;` in the `!is_alive` crash detection branch.

3. **Permanent Trap in `CleanupPending` and Broken Reset Idempotence**
   - **Path & Line**: `server/src/browser_host/manager.rs:418-432` and `server/tests/browser_host_lifecycle.rs:341-351`
   - **Description**:
     - When a reset fails or is interrupted, `reset.json` tombstone is written with `stage: ResetStage::Failed`. If the caller retries with the same `operation_id`, lines 418-425 immediately return `ResetOutcome::CleanupPending` without resuming or executing the remaining cleanup steps. If called with a new `operation_id`, line 427 returns `Err(ManagerError::CleanupPending)`. No method exists to retry or clear the tombstone, permanently trapping the profile in `CleanupPending`.
     - When a reset completes successfully, `reset.json` is cleared. Subsequent calls with the same `operation_id` are treated as new requests, incrementing `profile_epoch` again. Architecture contract §11.7 states: *"same operation never increments epoch twice"*. `browser_host_lifecycle.rs:341-351` even codified this bug by asserting `new_profile_epoch: 3` for an identical `operation_id`.
   - **Correction**:
     - When an active tombstone matches `operation_id`, resume the remaining reset sequence (terminate, delete, recreate, clear tombstone) using the previously assigned `tombstone.target_profile_epoch`.
     - Record the last completed `operation_id` in `ManagerMetadata` so duplicate calls after completion return `Completed` with the existing epoch without re-wiping.

---

### High Priority Findings

1. **Premature 3s Timeout in `shutdown_all()` Aborts `proc.terminate()` Before SIGKILL**
   - **Path & Line**: `server/src/browser_host/manager.rs:606`
   - **Description**: `shutdown_all()` wraps `proc.terminate()` in `timeout(Duration::from_secs(3), proc.terminate())`. In `BrowserProcess::terminate()`, the SIGTERM grace period is 3 seconds (`SHUTDOWN_GRACE_PERIOD_SECS = 3`). If Chromium does not exit within 3 seconds, Tokio cancels the future right before step 4 (SIGKILL) is dispatched. Descendants are not reaped and remain orphaned. Contract §3 requires: *"terminate-and-wait 10s total (TERM grace 3s then KILL/wait within remaining)"*.
   - **Correction**: Change the timeout in `shutdown_all()` to `DEFAULT_TERMINATE_TIMEOUT` (10 seconds).

2. **Synchronous `std::thread::sleep` on Tokio Worker Thread in `acquire_with_timeout`**
   - **Path & Line**: `server/src/browser_host/profile.rs:143`
   - **Description**: `ProfileLock::acquire_with_timeout` is invoked from async functions (`ensure_running`, `reset_profile`). It loops using `std::thread::sleep(Duration::from_millis(50))`, blocking the Tokio worker thread for up to 5 seconds during lock contention.
   - **Correction**: Use async `tokio::time::sleep` or execute the loop in `tokio::task::spawn_blocking`.

3. **Synchronous File Deletion Wrapped in Fake Async Block**
   - **Path & Line**: `server/src/browser_host/manager.rs:531-534`
   - **Description**: `timeout(DEFAULT_DELETE_TIMEOUT, async { inst.profile.delete_user_data() })` wraps synchronous `fs::remove_dir_all`. Because there are no `.await` points, `tokio::time::timeout` cannot interrupt disk I/O if the filesystem hangs.
   - **Correction**: Use `tokio::fs::remove_dir_all` or `tokio::task::spawn_blocking`.

---

### Medium Priority Improvements

1. **`evaluate_capabilities` Reports `engine_qualified: true` When Executable Is Missing**
   - **Path & Line**: `server/src/browser_host/config.rs:598`
   - **Description**: When `find_browser_executable` returns `Err(err)` (missing executable), `evaluate_capabilities` reports `available: false` but leaves `engine_qualified: true`. If no browser binary is found, the engine cannot be considered qualified.
   - **Correction**: Set `engine_qualified: false` when the executable is unavailable.

2. **Dead Code Warnings in `manager.rs`**
   - **Path & Line**: `server/src/browser_host/manager.rs:116-119, 314`
   - **Description**: Compiler flags `warning: variable does not need to be mutable` at line 314 (`let mut process = ...`) and `warning: fields global_target_count, global_viewer_count, global_raw_cdp_count, and cancellation_token are never read` at lines 116-119.
   - **Correction**: Remove unused `mut` and prefix unused fields with `_`.

3. **`validate_destination` Fails on Bracketed IPv6 with Port (`[::1]:8080`)**
   - **Path & Line**: `server/src/browser_host/config.rs:306`
   - **Description**: `trimmed.split_once(':')` splits at the first colon inside `[::1]:8080`, producing host `[` and invalid port `:1]:8080`.
   - **Correction**: Use `rsplit_once(':')` or strip brackets before parsing the port.

4. **Origin Validation Permits Trailing Slashes (`http://localhost:3000/`)**
   - **Path & Line**: `server/src/browser_host/config.rs:277`
   - **Description**: `if !path.is_empty() && path != "/"` allows configured origins to end in `/`. Standard HTTP `Origin` headers (RFC 6454) never have trailing slashes. Exact matching in Phase 03 will fail against valid client origins if configured with a slash.
   - **Correction**: Reject trailing slashes in `validate_origin` or strip with `.trim_end_matches('/')`.

---

### Low Priority Suggestions

1. **Profile Root Permission Re-validation False Positive**
   - **Path & Line**: `server/src/browser_host/config.rs:400`
   - **Description**: `fs::create_dir_all` creates uncreated `profile_root` with the process umask (0755), setting 0700 only on the leaf principal directory. Subsequent config validation checks `profile_root` for `mode & 0o077 != 0` and fails.
   - **Correction**: Ensure `profile_root` itself is chmod 0700 when created.

2. **Temp Files for Atomic Metadata Writes Share Process PID**
   - **Path & Line**: `server/src/browser_host/profile.rs:301, 333`
   - **Description**: `manager.json.tmp.{pid}` and `reset.json.tmp.{pid}` could collide across concurrent tasks in the same process.
   - **Correction**: Append a random UUID or task identifier to the temp file path.

---

### Positive Observations
- Strict SHA-256 principal hashing and dev/prod namespace separation prevent directory traversal and cross-tenant pollution.
- `manager.lock`, `manager.json`, and `reset.json` are placed safely outside `user-data/`, preventing credential wipes from unlinking the lock inode or metadata.
- Domain capabilities probe (`evaluate_capabilities`) evaluates status, budgets, and unavailability reasons safely without launching browser processes or exposing internal ports.
- Comprehensive TOML schema and parser roundtrip tests covering nested and aliased structures.

---

### Recommended Actions
1. **Fix `reset_profile` self-deadlock**: In `reset_profile`, take `inst._held_lock` if already held instead of re-acquiring `lock_with_timeout`.
2. **Fix crash recovery deadlock**: In `ensure_running`, clear `inst._held_lock = None;` when the process is found dead.
3. **Fix reset reconciliation & idempotence**: In `reset_profile`, if a tombstone matches `operation_id`, resume the reset steps without incrementing epoch. Record completed `operation_id` to make subsequent calls idempotent.
4. **Fix `shutdown_all` timeout**: Increase timeout from 3s to 10s to permit SIGKILL and leader child reaping.
5. **Fix compiler warnings**: Remove unused `mut` and suppress/prefix unused struct fields.

---

### Validation Commands & Results
- `cargo check --manifest-path server/Cargo.toml` — PASS (with 2 warnings in browser_host).
- `cargo test --manifest-path server/Cargo.toml --test auth_no_auth -- --nocapture` — PASS (14 passed).
- `cargo test --manifest-path server/Cargo.toml config -- --nocapture` — PASS (157 passed).
- `cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle -- --nocapture` — PASS (9 passed).
- `cargo test --manifest-path server/Cargo.toml --test browser_host_shutdown -- --nocapture` — PASS (3 passed).

---

### Unresolved Questions
1. Should `BrowserHostManager` start an automatic background reconciliation loop on startup to sweep stale tombstones, or should reconciliation remain lazy on next principal access?
2. When Phase 03 wires HTTP routes, will `requires_restart` trigger an explicit HTTP reload response requiring server restart, or will config changes be blocked while instances are active?
