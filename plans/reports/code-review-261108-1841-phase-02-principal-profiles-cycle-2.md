# Code Review Report: Phase 02 — Configure and Supervise Principal Profiles (Cycle 2)

## Code Review Summary

### Scope
- **Files reviewed**:
  - `server/src/browser_host/manager.rs`
  - `server/src/browser_host/profile.rs`
  - `server/src/browser_host/config.rs`
  - `server/src/browser_host/mod.rs`
  - `server/src/config/schema.rs`
  - `server/src/config/parser.rs`
  - `server/src/config/tests.rs`
  - `server/src/state.rs`
  - `server/src/main.rs`
  - `server/src/persistence/restore.rs`
  - `server/tests/browser_host_lifecycle.rs`
  - `server/tests/browser_host_shutdown.rs`
- **Lines of code analyzed**: ~2,650 LOC
- **Review focus**: Security, concurrency, OS file locks, lifecycle state transitions, crash recovery, reset idempotence, process containment, resource budgeting, YAGNI/KISS/DRY after Review Cycle 1 fixes.
- **Updated plans**: `plans/261108-0237-host-browser-cdp-streaming/phase-02-managed-lifecycle.md`

### Overall Assessment
All Critical and High Priority issues identified in Cycle 1 review have been remediated cleanly:
1. `reset_profile` self-deadlock resolved by consuming/reusing `inst._held_lock.take()`.
2. Crash recovery self-deadlock in `ensure_running` resolved by explicitly clearing `inst._held_lock = None;`.
3. Reset reconciliation and idempotence resolved: matching operation ID tombstone resumes cleanup without epoch bump; completed operations record `last_reset_operation_id` in metadata and return idempotent `Completed` status with existing epoch.
4. `shutdown_all` terminate timeout increased to 10s (`DEFAULT_TERMINATE_TIMEOUT`), guaranteeing 3s SIGTERM grace followed by SIGKILL and child reaping.
5. Async hygiene improved: synchronous sleep replaced with `tokio::time::sleep`, synchronous `remove_dir_all` wrapped in `tokio::task::spawn_blocking`.
6. Medium/Low priority items resolved: missing executable marks `engine_qualified: false`, origin trailing slashes rejected, bracketed IPv6 destinations (`[::1]:8080`) parse and validate cleanly, temp file PID collisions eliminated via UUID v4.

Compiler diagnostics show zero warnings in `browser_host`. Full suite validation across 6 targets passes cleanly: 221 tests passed, 0 failures. Phase 02 satisfies all architecture and security contracts.

**Score: 9.6 / 10**

---

### Critical Issues
None. All 3 critical concurrency and lifecycle defects from Cycle 1 have been remediated and verified.

---

### High Priority Findings (Warnings)
None. All high priority process supervision and async worker blocking issues have been resolved.

---

### Medium Priority Improvements (Warnings)
1. **Unbounded Growth of In-Memory Principal Map across Prolonged Server Lifetime**
   - **Path & Line**: `server/src/browser_host/manager.rs:164-199` (`instances`)
   - **Description**: `BrowserHostManager.instances` stores an entry for every queried principal (`HashMap<String, Arc<Mutex<InnerInstance>>>`). In multi-tenant environments with thousands of unique principals over time, dormant instance handles persist indefinitely in memory.
   - **Impact**: Minor heap retention (~250 bytes per principal). Does not leak active browser processes or OS locks.
   - **Recommendation**: In Phase 08 (selection / credential reset lifecycle), consider adding an LRU eviction or periodic sweep for instances whose state is `Dormant` and `_held_lock` is `None`.

2. **Atomic Counter Underflow Defense in `fetch_sub`**
   - **Path & Line**: `server/src/browser_host/manager.rs:287, 369, 494`
   - **Description**: `self.global_process_count.fetch_sub(1, Ordering::SeqCst)` is executed across 3 teardown paths. While current logic strictly gates each call behind `inst.process.take()` or dead process detection, defense-in-depth would benefit from saturating subtraction:
     ```rust
     self.global_process_count.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |c| Some(c.saturating_sub(1)));
     ```
   - **Impact**: Minimal given current state guards; prevents counter wrapping on unexpected double-decrement.

---

### Low Priority Suggestions
1. **Durable Tombstone Cleanup Error Propagation**
   - **Path & Line**: `server/src/browser_host/manager.rs:605`
   - **Description**: `inst.profile.clear_tombstone()?;` occurs after saving metadata with `last_reset_operation_id`. If deleting `reset.json` fails due to unexpected filesystem permission errors, `reset_profile` returns an error even though metadata was already persisted. A retry with the same `operation_id` succeeds via the idempotent check at line 423.
   - **Recommendation**: Log a warning instead of aborting if metadata has already marked the reset completed, or combine metadata + tombstone status in a single state file.

---

### Positive Observations
- **Robust Advisory OS Lock Invariants**: `manager.lock` lives in `principal_dir` outside `user-data/`, ensuring credential deletion never deletes or unlinks the lock inode. `flock(LOCK_EX | LOCK_NB)` prevents concurrent process collisions across multiple server workers or manual CLI interventions.
- **Strict Cryptographic Profile Isolation**: Hashed principal directories using SHA-256 (`64` hex characters) under `dev/` vs `prod/` completely eliminate path traversal, symlink spoofing, and dev/prod cross-contamination.
- **Fail-Closed Permissions**: Directories enforced with `0700` and metadata/tombstones with `0600` on Unix platforms. Executables checked against world-writable permissions (`0o002`).
- **Full Idempotent Reset Protocol**: Durable tombstones (`reset.json`) enable uninterrupted multi-stage resets (Initiated → Terminating → DeletingUserData → RecreatingUserData → Completed) across server crashes. Retrying an interrupted reset resumes without incrementing profile epoch.
- **Safe Capabilities Probing**: Capabilities evaluation returns protocol limits, qualified engine status, and human-readable unavailable reasons without launching Chromium, creating sockets, or exposing loopback ports.
- **Descendant Reaping on Shutdown**: Server graceful shutdown explicitly invokes `state.browser_host.shutdown_all().await`, guaranteeing process termination with 10s total timeout and preventing orphaned child processes.

---

### Recommended Actions
1. Mark all Phase 02 tasks complete in `plans/261108-0237-host-browser-cdp-streaming/phase-02-managed-lifecycle.md`. (Done)
2. Proceed to Phase 03: Admission control and route registration (`phase-03-admission-control.md`).
3. Retain test suites in CI:
   - `server/tests/browser_host_lifecycle.rs`
   - `server/tests/browser_host_shutdown.rs`
   - `server/src/config/tests.rs`

---

### Metrics
- **Compilation / Lint**: 0 warnings in `browser_host`; 11 unrelated warnings in `fs`/`ws`.
- **Test Coverage**: 6 test suites / 221 tests passed (0 failed, 2 ignored subprocess fixtures).
- **Security Audit**: OWASP Top 10 evaluated; no injection, directory traversal, credential leakage, or insecure permissions detected.
- **Concurrency / Deadlock**: Verified clean under concurrent access, crash recovery, and active browser resets.

---

### Validation Commands & Results

```bash
# 1. Browser Host Lifecycle Behavioral Suite
cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle -- --nocapture
# Result: 10 passed; 0 failed; finished in 0.24s

# 2. Browser Host Server Shutdown & Process Containment Suite
cargo test --manifest-path server/Cargo.toml --test browser_host_shutdown -- --nocapture
# Result: 3 passed; 0 failed; finished in 0.49s

# 3. Authentication & No-Auth Middleware Isolation Suite
cargo test --manifest-path server/Cargo.toml --test auth_no_auth -- --nocapture
# Result: 14 passed; 0 failed; finished in 1.18s

# 4. Configuration Schema, Validation & Capabilities Unit Suite
cargo test --manifest-path server/Cargo.toml config -- --nocapture
# Result: 157 passed; 0 failed; 1948 filtered out; finished in 0.00s

# 5. Browser Host Platform Process Primitives & Signals Suite
cargo test --manifest-path server/Cargo.toml --test browser_host_process -- --nocapture
# Result: 19 passed; 0 failed; 2 ignored; finished in 15.26s

# 6. Browser Host CDP Adapter Serialization & Dispatch Suite
cargo test --manifest-path server/Cargo.toml --test browser_host_adapter -- --nocapture
# Result: 18 passed; 0 failed; finished in 0.33s

# Total across all 6 validation targets: 221 passed, 0 failed, 2 ignored.
```

---

### Unresolved Questions
1. In Phase 03, will HTTP capability routes return `429 Too Many Requests` or `503 Service Unavailable` when `global_process_count >= max_processes`? (Contract specifies typed 429 busy for viewer/process saturation, 409 conflict for cleanup pending).
2. For headless execution in constrained CI environments without `/usr/bin/google-chrome`, will Phase 09 integration testing require a mock Chromium fixture or real Chromium installation?
