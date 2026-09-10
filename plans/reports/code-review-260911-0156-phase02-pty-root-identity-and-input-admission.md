# Code Review: Phase 02 — PTY Root Identity, Raw Output Counter, and Input Admission

- **Date**: 2026-09-11
- **Reviewer**: CodeReviewer
- **Target**: Phase 02 Implementation Files
- **Plan File**: `plans/260910-1604-agent-activity-idle-suspend/phase-02-pty-observation.md`
- **Score**: 9.5/10

---

## Code Review Summary

### Scope
- **Files Reviewed**:
  - `server/src/pty/activity.rs` (336 LOC, new module)
  - `server/src/pty/manager.rs` (+237 / -11 LOC)
  - `server/src/pty/session.rs` (+18 / -1 LOC)
  - `server/src/pty/mod.rs` (+7 / -0 LOC)
  - `server/src/pty/tests.rs` (+328 / -0 LOC)
- **Lines of Code Analyzed**: ~920 lines of changes and surrounding architecture.
- **Review Focus**: Security, memory safety, lock contention, atomics ordering, YAGNI/KISS/DRY adherence, Phase 01/02/03/05 contracts.

---

### Overall Assessment
Exemplary implementation. All 8 Phase 02 requirements and design constraints from `phase-02-pty-observation.md` are satisfied:
1. **Root Identity & Qualification**: `ProcessIdentity` correctly captures `pid` and `start_ticks` via safe Linux `/proc/<pid>/stat` parsing (handling nested parentheses and spaces in `comm`). Probing runs *outside* the manager lock (`Inner`), preventing lock stalls. Uncertain or non-Linux roots cleanly report `RootQualification::Uncertain` / `Unavailable` without breaking terminal usability.
2. **Raw Output Counter**: Incarnation-scoped `Arc<AtomicU64>` monotonically increments once per non-empty chunk read at the PTY master boundary before any parsing/decoding/buffering. Saturates at `u64::MAX` sentinel without wrapping. Hydration, scrollback replay, resize, and attach reads do not advance the counter.
3. **Input Admission & Monotonic Revisions**: `PtySessionManager::write()` verifies handoff state (`fleet.is_handoff_active()`), shutdown, and disposal before admitting input. Empty input is a zero-cost no-op. Non-empty input atomically advances `input_revision`, updates `last_input_at`, and notifies the coalescing `activity_watcher` watch channel. Write failures cleanly roll back revisions under the manager lock.
4. **Safety & Zero Content Leakage**: No terminal text, commands, environment variables, or keystrokes enter snapshots, logs, or watcher channels.
5. **Bounded Snapshots**: `MAX_LIVE_ROOTS_LIMIT` bounds live root collection to 256 items, reporting `ScanLimitExceeded` rather than allocating unbounded memory or truncating silently.

---

## Critical Issues (0)
*No critical issues or security vulnerabilities identified.*

---

## Warnings (1)

### 1. Inter-Phase Contract Alignment: Phase 03 Type & Function Names
- **Location**: `server/src/pty/activity.rs:186-252` and `server/src/pty/mod.rs:21`
- **Impact**: `plans/260910-1604-agent-activity-idle-suspend/phase-03-process-discovery.md` (Step 1 and Step 3) states:
  > *"Reuse Phase02 `pty::activity::{ProcessIdentity, ProcessStat, TerminalIdentity, PtyActivitySnapshot, read_process_stat}`. `read_process_stat` must safely parse a parenthesized `comm` containing spaces or `)` and expose PID, PPID, state and start ticks."*
  Phase 02 named the struct `ParsedProcStat` and the parsing function `parse_proc_stat`.
- **Recommendation**: Add type alias and function re-export in `server/src/pty/activity.rs` and `server/src/pty/mod.rs` so Phase 03 compiles seamlessly without friction:
  ```rust
  pub type ProcessStat = ParsedProcStat;
  pub use parse_proc_stat as read_process_stat;
  ```

---

## Suggestions (2)

### 1. Deterministic Root Ordering in `capture_activity_snapshot`
- **Location**: `server/src/pty/manager.rs:696-749`
- **Details**: `self.live` is a `HashMap<String, LiveSession>`. Iterating over `&self.live` populates `snapshot.roots` in non-deterministic order. If multiple incomplete reasons exist (e.g. multiple uncertain probes), `incomplete_reason` captures whichever HashMap returns first.
- **Recommendation**: Sorting `roots` by `(terminal.session_id, terminal.incarnation)` or selecting the earliest/deterministic reason provides perfectly deterministic snapshots for tests and logging diagnostics, with negligible cost on <= 256 roots.

### 2. Constructor Parameter Count on `LiveSession::new`
- **Location**: `server/src/pty/session.rs:217`
- **Details**: `LiveSession::new` now takes 10 parameters (pre-existing 8 + `root_qualification` + `raw_output_sequence`), triggering `clippy::too_many_arguments`.
- **Recommendation**: Bundle session initialization parameters or add `#[allow(clippy::too_many_arguments)]` on `LiveSession::new`.

---

## Positive Observations
- **Lock Ordering & Concurrency**: Probing `/proc/<pid>/stat` occurs outside `self.inner` lock, avoiding stalls.
- **Atomics**: Consistent `Ordering::Relaxed` used across atomic sequence loads and updates. Saturating atomic helper avoids wrapping.
- **Zero-Allocation Hot Path**: Raw output sequence increment uses an in-place `fetch_update` with no channel dispatch or allocation per chunk.
- **Monotonic Input Rollback Safety**: Write failure rollback for `input_revision` occurs strictly under the held `self.inner` mutex, ensuring no concurrent observer can ever read an uncommitted revision.
- **Comprehensive Test Coverage**: Targeted suite covers all edge cases (sentinel saturation, spaces/nested parentheses in proc stat, hydration/resize independence, handoff write rejection, empty write no-op, incarnation separation, and real shell PTY smoke).

---

## Reviewed Files
1. `server/src/pty/activity.rs`
2. `server/src/pty/manager.rs`
3. `server/src/pty/session.rs`
4. `server/src/pty/mod.rs`
5. `server/src/pty/tests.rs`

---

## Validation Commands and Results
- `cargo test --manifest-path server/Cargo.toml pty_activity_tests`:
  - Result: **8 passed, 0 failed, 1175 filtered out (0.00s)**.
- `cargo test --manifest-path server/Cargo.toml pty::`:
  - Result: **159 passed, 0 failed, 1 ignored (performance benchmark), 1023 filtered out (8.57s)**.
- `cargo clippy --manifest-path server/Cargo.toml` on `pty::activity`:
  - Result: **0 errors, 0 warnings**.

---

## Plan Status
- Plan file `plans/260910-1604-agent-activity-idle-suspend/phase-02-pty-observation.md` updated:
  - Implementation status: `Completed`
  - Review status: `Passed code review`
  - All 9 Todo items verified and marked complete (`[x]`).

---

## Unresolved Questions
- None.
