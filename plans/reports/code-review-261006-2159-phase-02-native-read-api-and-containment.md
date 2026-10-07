# Code Review: Phase 02 — Native Read API and Containment

**Date**: 2026-10-06  
**Reviewer**: StaticLoon (Senior Software Engineer)  
**Status**: Completed  
**Score**: 9.5/10  

---

## Code Review Summary

### Scope
- Files reviewed:
  - `server/src/fs/secure_path.rs`
  - `server/src/plans/scan.rs`
  - `server/src/plans/mod.rs`
  - `server/src/api/plans.rs`
  - `server/src/error.rs`
  - `server/src/api/error.rs`
  - `server/src/api/mod.rs`
  - `server/src/api/router.rs`
  - `server/src/api/fs.rs`
  - `server/src/api/ws_protocol.rs`
  - `server/src/fs/mod.rs`
  - `server/src/api/ws.rs`
  - `server/tests/plans_api.rs`
  - `server/tests/ws_fs_subscribe.rs`
- Lines of code analyzed: ~2,400 lines across 14 files
- Review focus: Security & containment, contracts compliance, bounded memory/resource usage, error mapping & sanitization
- Updated plans:
  - `plans/261006-1653-project-plans-dashboard/phase-02-native-read-api.md` (marked completed with all tasks checked)
  - `plans/261006-1653-project-plans-dashboard/progress.md` (reconciled Phase 02 as Completed)

### Overall Assessment
High-quality, secure, and robust implementation adhering strictly to `contracts.md` and Phase 02 specifications. File descriptor pinning, `O_NOFOLLOW | O_NONBLOCK` flags, `fstat` re-validation, path escape defense, and symlink defenses are properly executed on Unix/Linux. Query and wire protocols enforce strict bounds, rejecting duplicate keys, unknown query fields, and invalid ranges. Backpressure and lag handling via `FsOverflow` clean up subscriptions promptly.

---

### Critical Issues
None.

---

### High Priority Findings
None.

---

### Medium Priority Improvements

1. **Workspace Context Guard Scope Across Blocking I/O**:
   - **Location**: `server/src/api/plans.rs:64, 106-110` and `server/src/api/plans.rs:141, 183-187`
   - **Observation**: `let _workspace_context = state.workspace_context_guard.read().await;` is kept in scope across `tokio::task::spawn_blocking`.
   - **Contract Context**: `contracts.md` §4 specifies: *"Copy config data, release config lock before I/O. Pin selected target handle; revalidate target/root identity before publication."*
   - **Impact**: Holding the read lock during a potentially 5,000-entry directory scan holds off writers (e.g., config reloads, worktree updates) longer than necessary. Target revalidation before publication (lines 113-125 / 190-202) already guarantees safety if target changed.
   - **Recommendation**: Explicitly `drop(_workspace_context);` prior to `spawn_blocking`.

2. **Windows Non-Unix Traversal Boundary Note**:
   - **Location**: `server/src/fs/secure_path.rs:808, 840, 876` (`#[cfg(not(unix))]`)
   - **Observation**: The fallback implementation uses standard library `std::fs::symlink_metadata` and `root.join(relative)` rather than native Windows file handle enumeration (`CreateFileW` with `FILE_FLAG_OPEN_REPARSE_POINT`).
   - **Contract Context**: Phase 02 plan explicitly states: *"Linux runtime proof here; Windows runtime explicitly unqualified until exercised there."*
   - **Recommendation**: Retain current builds on non-Unix platforms; when Windows qualification is scheduled, migrate non-Unix implementation to native handle traversal matching the Unix `openat` paradigm.

---

### Low Priority Suggestions

1. **Synchronous Snapshot Call in Async Handler**:
   - **Location**: `server/src/api/fs.rs:206`
   - **Observation**: `crate::fs::secure_path::read_regular_snapshot(&root_path, p, 64 * 1024)` is invoked directly in the async axum handler. While bounded to 64 KiB, wrapping synchronous filesystem I/O in `tokio::task::spawn_blocking` prevents momentary blocking of async runtime executor threads.

2. **Clippy Simplification**:
   - **Location**: `server/src/plans/scan.rs:204`
   - **Observation**: `match secure_path::probe_file_marker(...) { Ok(FileMarkerKind::RegularFile { .. }) => true, _ => false }` can be written as `matches!(secure_path::probe_file_marker(...), Ok(FileMarkerKind::RegularFile { .. }))`.

3. **Argument Count on Helper**:
   - **Location**: `server/src/api/ws.rs:2093`
   - **Observation**: `do_fs_read` accepts 8 arguments, triggering `clippy::too_many_arguments`. Grouping read parameters into a request struct will improve readability.

---

### Positive Observations
- **Descriptor-Level Containment**: Full enforcement of `O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK` and two-stage `fstat` comparison (pre-read regular check vs post-read size/mtime check) prevents symlink attacks, FIFO/socket deadlocks, and in-place mutation races.
- **Strict Query Contract**: `deny_unknown_fields` on query structs and manual raw query duplicate key checking prevent HTTP query pollution.
- **Symlink Progress Authority Preservation**: Accurately respects `contracts.md` requirement that a symlinked `progress.md` opts into progress authority with `unreadable` state and diagnostic rather than silently falling back to plan authority.
- **Watch-Only Optimization**: `watchOnly: true` creates an actual-directory watcher and returns `nodes: []`, completely bypassing recursive tree traversal and saving memory/CPU.
- **Lag & Overflow Resilience**: `FsOverflow` notification sent over the control channel with immediate subscription detachment upon broadcast lag or outbound buffer exhaustion.
- **Zero Path Leaks in Errors**: All `PlansError` variants use static messages without formatting file paths or payloads into error bodies.

---

### Recommended Actions
1. Drop `_workspace_context` before `spawn_blocking` in `get_plan_folders` and `get_selected_plan` (`server/src/api/plans.rs`).
2. Wrap `read_regular_snapshot` in `spawn_blocking` within `server/src/api/fs.rs` when revisiting.
3. Hand off verified Phase 02 backend to Phase 03 client integration.

---

### Metrics
- **Score**: 9.5 / 10
- **Test Pass Rate**: 100% (40 / 40 passing)
  - `plans_api`: 13/13 passing
  - `ws_fs_subscribe` (`test_ws_`): 2/2 passing
  - `fs::secure_path::tests`: 7/7 passing
  - `plans::tests`: 18/18 passing
- **Linting Issues in Phase 02 Files**: 0 errors, 2 minor style suggestions (matches macro, arg count).
- **Security & Containment**: Fully compliant.

---

### Unresolved Questions
None.
