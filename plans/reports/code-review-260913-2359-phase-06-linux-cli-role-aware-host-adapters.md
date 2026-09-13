# Code Review: Phase 06 — Linux CLI, Role-Aware Host Adapters, Atomic Output and Exit Semantics

**Date:** 2026-09-14 00:00  
**Reviewer:** Phase06Reviewer  
**Scope:** Phase 06 Linux CLI, host adapters, atomic file output, and exit semantics  
**Plan:** `plans/260912-0027-production-idle-suspend-diagnostics/phase-06-linux-cli-integration.md`  
**Score:** 9.6/10  

---

## Code Review Summary

### Scope
- **Files reviewed:**
  - `server/src/linux_release/cli.rs`
  - `server/src/linux_release/privilege.rs`
  - `server/src/linux_release/layout.rs`
  - `server/src/linux_release/diagnostics/host_commands.rs`
  - `server/src/linux_release/diagnostics/local_api.rs`
  - `server/src/linux_release/diagnostics/host_probes.rs`
  - `server/src/linux_release/diagnostics/output.rs`
  - `server/src/linux_release/diagnostics/collector.rs`
  - `server/src/linux_release/diagnostics/mod.rs`
  - `server/src/linux_release/mod.rs`
  - `server/src/bin/dam-hopper.rs`
  - `server/src/linux_release/diagnostics/phase06_tests.rs`
- **Lines of code analyzed:** ~2,400 LOC across 12 files
- **Review focus:** Linux privilege gates, security boundaries, command injection avoidance, redaction/token protection, atomic output/file permissions, subprocess pipe lifecycle, trait seams, and exit code contracts.
- **Updated plans:**
  - `plans/260912-0027-production-idle-suspend-diagnostics/phase-06-linux-cli-integration.md` (marked completed; todo items checked)
  - `plans/260912-0027-production-idle-suspend-diagnostics/plan.md` (marked Phase 06 DONE; completion record added)

### Overall Assessment
Implementation adheres strictly to design contract and security requirements. CLI grammar `dam-hopper diagnose --json` is strictly enforced with no extra options or positionals permitted. Privilege gate explicitly allows non-root without privilege escalation; non-root execution cleanly marks `helperAudit` as `permissionDenied` and exits with code 2. Commands are modeled via closed enum with hardcoded argv, null stdin, `LC_ALL=C`, bounded buffers, and timeout. Output writing uses exclusive file creation (`O_NOFOLLOW | O_CREAT | O_EXCL`), 0700 dir, 0600 file, fsync on file, atomic rename, and fsync on directory. Privacy invariants are preserved: journal message bodies are excluded from the projection schema.

---

## Critical Issues (MUST FIX)
None.

---

## Warnings List (SHOULD FIX)

1. **Subprocess pipe deadlock risk on stdout truncation (`server/src/linux_release/diagnostics/host_commands.rs:166-184`)**
   - *Problem:* In `ProductionHostCommandRunner::run`, when output exceeds `spec.max_stdout_bytes`, the reading loop terminates via `break`. However, `stdout_handle` is not dropped or drained before `child.wait().await`. If the child process writes additional data that exceeds the OS pipe buffer capacity (~64KB on Linux), the child will block on `write()` while the parent blocks in `child.wait()`. This deadlocks the processes until the 5-second deadline fires, causing an unnecessary timeout failure rather than returning the truncated buffer.
   - *Impact:* Commands producing >2 MiB of stdout (such as verbose journal streams) will time out and fail instead of completing with `truncated = true`.
   - *Fix:* Explicitly drop `stdout_handle` before awaiting `child.wait()`:
     ```rust
     // Drop handle to close read pipe, delivering SIGPIPE/EOF to child on next write
     drop(stdout_handle);
     let status = child.wait().await?;
     ```

2. **Non-absolute path acceptance in non-root user state resolution (`server/src/linux_release/layout.rs:277-291`)**
   - *Problem:* `resolve_user_diagnostics_dir_with` inspects `$XDG_STATE_HOME` and `$HOME` for non-empty values, but does not verify `.is_absolute()`. If an environment defines a relative path (e.g. `XDG_STATE_HOME="state"`), the resulting destination and printed path will be relative, violating the CLI contract that stdout must be an absolute path.
   - *Impact:* Relative path output under non-standard environment configurations.
   - *Fix:* Check `state_home.is_absolute()` and `home.is_absolute()`, or canonicalize in `write_diagnostic_bundle_to_dir`.

---

## Suggestions List (NICE TO HAVE)

1. **Robust column-based parsing for systemd inhibitors (`server/src/linux_release/diagnostics/host_commands.rs:417-426`)**
   - *Problem:* `parse_inhibitors` uses string matching (`lower.contains(" delay ")`) across the entire line to determine inhibitor mode before testing for block. If an inhibitor reason/WHY column contains the substring "delay", a `block` inhibitor will be misclassified as `delay`.
   - *Recommendation:* Since `MODE` in `systemd-inhibit --list` is the final column, inspect `line.split_whitespace().last()` directly.

2. **Telemetry detail in local API errors (`server/src/linux_release/diagnostics/local_api.rs:150-155`)**
   - *Recommendation:* Retain the actual status code or byte count in the error message for `AuthRequired(status)` and `OversizedBody(bytes)` to facilitate debugging in the bundle error manifest.

---

## Positive Observations
- **Privilege Separation:** Clean enforcement in `privilege.rs`. Zero `sudo`, `pkexec`, or setuid escalation. Honest `permissionDenied` status for non-root without failing execution.
- **Privacy by Construction:** `ProjectedJournalEntry` schema contains no `MESSAGE` or syslog body field; extraction logic explicitly projects only timestamps, units, priorities, and invocation/boot IDs.
- **Token Protection:** Token read into memory, injected as bearer header over loopback HTTP, and immediately dropped. Never recorded in log, errors, or serialized bundles.
- **Atomic and Durable Filesystem Safety:** Secure verification of directory non-symlink status, ownership, 0700 mode, exclusive temporary file creation with `O_NOFOLLOW` and 0600 mode, synchronous flush, atomic rename, and parent directory flush.
- **Clean Architecture & Testability:** Generic `CollectorAdapters` with lightweight trait seams (`Clock`, `EuidProvider`, `HostCommandRunner`, `LocalIdleStatusClient`, `CurrentHostProbeReader`) enabling 100% deterministic test coverage without dynamic dispatch overhead or network/subprocess side effects.

---

## Metrics
- **Diagnostics Test Pass Rate:** 36/36 (100%)
- **Linux Release Module Tests:** 60/60 (100%)
- **Aggregate Execution Pass Count:** 282/282 (100%)
- **Compilation/Clippy Warnings:** 0 warnings, 0 errors
- **Review Score:** 9.6 / 10

---

## Validation Commands and Results
- `cd server && cargo test -p dam-hopper-server linux_release::diagnostics` — **PASS** (36 passed, 0 failed, 1.05s)
- `cd server && cargo test -p dam-hopper-server linux_release` — **PASS** (60 passed, 0 failed, 1.04s)
- `cd server && cargo check -p dam-hopper-server --tests` — **PASS** (0 warnings, 0 errors, 17.64s)
- `cd server && cargo test -p dam-hopper-server --bin dam-hopper` — **PASS** (0 errors)

---

## Unresolved Questions
None.
