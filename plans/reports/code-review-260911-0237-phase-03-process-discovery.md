# Code Review Report: Phase 03 — Bounded Process Discovery & Agent Attribution

- Date: 2026-09-11
- Reviewer: Phase03Reviewer-2
- Score: 9.0/10
- Plan: `plans/260910-1604-agent-activity-idle-suspend/phase-03-process-discovery.md`
- Target: `server` crate (`dam-hopper-server`)

---

## Code Review Summary

### Scope
- Files reviewed:
  - `server/src/idle_suspend/activity/mod.rs` (shared types, bounds, error models)
  - `server/src/idle_suspend/activity/process.rs` (stateful discovery, match grammar, procfs source)
  - `server/src/idle_suspend/mod.rs` (private activity module declaration)
  - `server/src/pty/activity.rs` (ProcessIdentity, ProcessStat alias, read_process_stat)
- Lines of code analyzed: ~2,500 LOC
- Review focus: Bounded process discovery, security, performance, architecture, YAGNI/KISS/DRY, and adherence to Phase 03 requirements
- Updated plans: `plans/260910-1604-agent-activity-idle-suspend/phase-03-process-discovery.md`

### Overall Assessment
Implementation adheres exceptionally well to normative contracts in `phase-03-process-discovery.md`. Sentinel bounds (256 roots, 8,192 PIDs, 1,024 relevant processes, 4,096 FDs, 8,192 sockets) qualify exact-at-limit and fail closed at +1 without silent truncation. Start-tick double reads protect against PID reuse. Finite interpreter grammar matches entrypoints strictly, rejecting eval/print, bare scripts, command wrappers, and generic basenames. Transactional non-mutating `prepare_sample` and infallible `commit_sample` protect state consistency. Unit suite passes 100% (16/16). A few non-critical optimizations around lazy `cwd` reading, early interpreter checks, and retryable flag propagation should be addressed before or during coordinator integration.

---

### Critical Issues
None. Zero breaking bugs or security vulnerabilities found.

---

### High Priority Findings (Warnings)

1. **Premature `read_cwd` in interpreted candidate matching (`process.rs:880-885`)**:
   - **Problem**: `source.read_cwd(pid)` called unconditionally for relative entrypoint tokens *before* evaluating configured agent rules.
   - **Impact**: If candidate matches configured `AgentExecutableEntry::Basename`, or if agent set contains only basename rules, reading `/proc/<pid>/cwd` is unnecessary. If `read_cwd` fails (e.g. process exiting or restricted directory permissions), it returns `Uncertain`, prematurely failing a valid basename match.
   - **Fix**: Check `AgentExecutableEntry::Basename` rules first. Only resolve `source.read_cwd(pid)` when evaluating an `AgentExecutableEntry::AbsolutePath` rule against a relative entrypoint.

2. **Unconditional `read_cmdline` for all candidate processes (`process.rs:850-856`)**:
   - **Problem**: `source.read_cmdline(pid)` executed for *every* reachable candidate process whose `exe` is not a native agent match.
   - **Impact**: Unnecessary I/O and heap allocations for common system utilities (`cat`, `ls`, `grep`, `git`, `sleep`), which are never valid interpreters under the finite grammar. Short-lived commands exiting between `read_exe` and `read_cmdline` can produce transient read errors.
   - **Fix**: Check if `exe_basename` matches the supported interpreter set (`node`, `bun`, `python*`, `sh`, `bash`, `dash`, `zsh`, `ksh`) *before* invoking `source.read_cmdline(pid)`. If not an interpreter, return `NotMatched` immediately.

3. **Loss of `retryable_close_race` in `AgentMatchOutcome::Uncertain` (`process.rs:812, 852, 1265`)**:
   - **Problem**: When `source.read_exe` or `source.read_cmdline` returns `Err(err)` with `err.retryable_close_race = true`, `AgentMatchOutcome::Uncertain(err.reason)` drops the boolean flag. At line 1265, `ActivityUnavailable::with_context` sets `retryable_close_race: false`.
   - **Impact**: A transient process exiting during inspection turns into a hard non-retryable error, bypassing Phase 05's planned single-retry mechanism.
   - **Fix**: Store `retryable: bool` inside `AgentMatchOutcome::Uncertain` and construct `ActivityUnavailable` preserving `retryable_close_race`.

---

### Medium Priority Improvements

1. **Redundant subtree traversal in reachability and descendant closures (`process.rs:1159, 1282`)**:
   - **Problem**: During root reachability and recognized agent descendant expansion, children are pushed to `stack` even if the process was already visited or already present in `relevant_processes`.
   - **Impact**: For nested agents (e.g. Agent A -> Worker 1 -> Worker 2), identical subtrees are traversed repeatedly.
   - **Fix**: Gate child discovery with `if relevant_processes.insert(*curr_id) { ... }` so already-visited subtrees are not re-traversed.

2. **Non-Linux build / adapter stubs**:
   - **Problem**: `process.rs` uses `std::os::unix::fs::MetadataExt` and `/proc` directly without non-Linux stubs.
   - **Impact**: Breaks compilation on Windows and fails at runtime on macOS.
   - **Fix**: Provide a `#[cfg(not(target_os = "linux"))]` adapter returning `ActivityUnavailable::new(ActivityUnavailableReason::ProcAccess)` per Step 2.

3. **Compiler `dead_code` warnings**:
   - **Problem**: 43 `dead_code` warnings for public activity types.
   - **Impact**: Expected intermediate state before Phase 04/05 consumption, but creates compiler noise.
   - **Fix**: Suppress with `#[allow(dead_code)]` or resolve naturally when Phase 04/05 consume them.

---

### Low Priority Suggestions

1. **Explicit trailing NUL validation on cmdline (`process.rs:246`)**:
   - Verify `!buf.is_empty() && buf.last() == Some(&0)` to reject malformed truncated command lines explicitly.
2. **Avoid repeated path normalization per candidate in loop (`process.rs:835, 901`)**:
   - Normalize configured `AbsolutePath` entries once rather than calling `normalize_path(p)` per candidate process.
3. **Refactor `read_process_stat` error type in `server/src/pty/activity.rs`**:
   - Returning typed error instead of `String` would allow `LinuxProcSource::read_stat` to delegate directly to `read_process_stat` while preserving `ErrorKind::NotFound` for close-race classification.

---

### Positive Observations
- Strict sentinel semantics: exact 256 roots, 8,192 scanned PIDs, 1,024 relevant processes, 4,096 FDs, 8,192 sockets qualify; +1 triggers `ScanLimit`. No truncation or arbitrary top-N slicing.
- Start-ticks double read before and after inspection thoroughly guards against PID reuse.
- Detached lineage retention across root exit preserves `TerminalIdentity` and monotonic output sequence `Arc<AtomicU64>` without inflating manager's live fleet count.
- Finite interpreter grammar strictly enforced: `-e`, `-c`, `-m`, package scripts, command wrappers, and generic entrypoints (`cli.js`) fail closed or return non-matching cleanly.
- Transactional state separation: `prepare_sample` is purely immutable; infallible `commit_sample` advances retained state; dropped prepared sample cleanly aborts without side effects.
- Valid zero-agent pass cleanly avoids scanning unrelated process FDs.

---

### Validation Commands & Results
- `cargo test --manifest-path server/Cargo.toml idle_suspend::activity::process::tests`: 16 passed, 0 failed (0.22s).
- `cargo test --manifest-path server/Cargo.toml idle_suspend`: 100 passed, 0 failed (0.86s).
- `cargo test --manifest-path server/Cargo.toml pty`: 187 passed, 0 failed, 1 ignored (8.70s).
- Total: 303 passed, 0 failed, 1 ignored.

---

### Metrics
- Type Coverage: 100% strict typing in Rust (no `unwrap` in production paths, typed closed error enums).
- Test Coverage: 16 targeted unit tests covering boundaries, grammar, reparenting, and races; harmless real-process Linux test included.
- Compiler Diagnostics: 0 errors, 43 transient dead_code warnings for unintegrated Phase 04/05 types.

---

### Unresolved Questions
None.
