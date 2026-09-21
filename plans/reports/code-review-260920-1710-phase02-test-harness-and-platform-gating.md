# Code Review: Phase 02 — Test harness and platform gating

**Date:** 2026-09-20 17:15 +07:00  
**Score:** 9.5/10  
**Status:** Approved with recommendations  
**Reviewer:** Phase02Reviewer  

---

## Scope

- **Files reviewed (12):**
  - `server/src/api/tests.rs`
  - `server/src/git/diff.rs`
  - `server/src/git/tests.rs`
  - `server/src/system/alerts.rs`
  - `server/src/system/monitor.rs`
  - `server/src/system/tests.rs`
  - `server/tests/common/mod.rs`
  - `server/tests/browser_debug_artifacts.rs`
  - `server/tests/idle_suspend.rs`
  - `server/tests/idle_suspend_phase07.rs`
  - `server/tests/project_worktree_lifecycle.rs`
  - `server/tests/workflow_api.rs`
- **Lines of code analyzed:** ~230 net changed lines across 12 files.
- **Review focus:** Windows MSVC compatibility, path normalization, line-ending hygiene, resource cleanup, security, performance, architecture, KISS/YAGNI/DRY, and Linux parity preservation.

---

## Overall Assessment

Phase 02 achieves its core goal: unit and integration suites run reliably on Windows MSVC without modifying production API, PTY, or security contracts. The harness properly abstracts platform command differences (`cmd.exe` vs `/bin/sh`, bounded loopback `ping` vs `sleep`, interactive `cmd.exe` vs `cat`), normalizes CRLF only at terminal assertion boundaries, isolates Git line endings per test repository, and target-gates Linux-specific block device and diagnostic tests.

A critical production bug in `server/src/git/diff.rs` was resolved: `discard_hunk` now drops `patch` and `diff` before writing back to disk, preventing `ERROR_SHARING_VIOLATION` (os error 32) caused by libgit2 holding open file handles on Windows.

During review, two unused test helper functions in `server/src/system/alerts.rs` (`disk`, `persistent_disk`) were identified as emitting dead-code compiler warnings on non-Linux platforms due to their calling tests being gated to Linux; `#[cfg(target_os = "linux")]` was applied to silence the warnings.

All 978 integration and unit tests pass with zero failures and 3 expected platform/binary-gated ignores.

---

## Critical Issues (MUST FIX)

None.

---

## Warnings (SHOULD FIX)

1. **Dead code warning on non-Linux in `server/src/system/alerts.rs` [RESOLVED]**
   - **Problem:** `disk` and `persistent_disk` test helpers were only invoked by Linux-gated tests (`disk_targets_are_independent_and_virtual_filesystems_do_not_alert` and `target_state_is_capped_and_repeated_samples_are_deduplicated`). On Windows/macOS, compiling the test module generated dead-code warnings.
   - **Resolution:** Added `#[cfg(target_os = "linux")]` to both functions in `server/src/system/alerts.rs:1247,1268`. Verified compilation with `cargo check --lib --tests`.

2. **Unused struct `PanicExecutor` in `server/tests/idle_suspend.rs:1355`**
   - **Problem:** `struct PanicExecutor;` is defined at line 1355 but only constructed at line 1459 inside `activity_live_linux_pty_tcp_smoke`, which early-returns on `#[cfg(not(target_os = "linux"))]`. On Windows, the compiler flags `PanicExecutor` as dead code.
   - **Impact:** Compiler warning during `cargo test --tests`.
   - **Recommendation:** Add `#[allow(dead_code)]` or `#[cfg(target_os = "linux")]` to `struct PanicExecutor;`.

---

## Suggestions (NICE TO HAVE)

1. **DRY Command String Interpolation in `server/src/api/tests.rs`**
   - **Location:** `server/src/api/tests.rs:90,100`
   - **Details:** `print_env_and_hold_command` and `print_cwd_and_hold_command` re-implement the Windows loopback ping delay string `format!("... ping 127.0.0.1 -n {} >NUL", seconds.saturating_add(1))` rather than calling `hold_command(seconds)`. Calling `format!("echo %{var}%& {}", hold_command(seconds))` improves DRY.
2. **Explicit Session Cleanup in `terminal_create_defaults_project_cwd_to_project_root`**
   - **Location:** `server/src/api/tests.rs:4000-4031`
   - **Details:** The test relies on the bounded 2-second ping to terminate the session process. Adding an explicit `state.pty_manager.remove("project-default-cwd-session").ok();` at test conclusion guarantees immediate teardown and matches the pattern in sibling lifecycle tests.

---

## Architectural & Security Verification

| Dimension | Assessment | Evidence |
|---|---|---|
| **Security** | PASS | `hold_command` and environment helpers use strongly typed parameters (`u64`) and static identifiers. Traversal rejection tests remain strict (403 Forbidden on cwd escapes). Secret redaction (`[REDACTED]`) preserved and verified. |
| **Performance** | PASS | Early drop of `patch` and `diff` in `discard_hunk` frees libgit2 memory before file rewrite. Bounded loopback pings eliminate idle timeouts. Zero overhead added to production hot paths. |
| **Architecture** | PASS | Test helpers kept strictly within test harnesses (`src/api/tests.rs` and `tests/common/mod.rs`). No runtime dependencies added. Production contracts intact. |
| **YAGNI / KISS / DRY** | PASS | Minimal, boring helpers. Common integration helpers shared across 4 integration tests in `tests/common/mod.rs`. |
| **Linux Parity** | PASS | 100% of Linux assertions preserved. `#[cfg(not(windows))]` blocks reproduce identical previous commands (`sleep`, `cat`, `printf`). Gated `/dev` tests run only on Linux where valid. |
| **Windows Hygiene** | PASS | `target_path_identity` normalizes Windows drive casing and slash directions without losing path containment semantics. `core.autocrlf=false` isolates git fixtures from host settings. |

---

## Validation Commands & Metrics

| Command | Suites | Passed | Failed | Ignored | Result |
|---|---:|---:|---:|---:|---|
| `cargo test api::tests -j 1` | 38 | 160 | 0 | 0 | PASS |
| `cargo test git::tests -j 1` | 38 | 90 | 0 | 0 | PASS |
| `cargo test system:: -j 1` | 38 | 36 | 0 | 0 | PASS |
| `cargo test --tests -j 1` | 38 | 978 | 0 | 3 | PASS |
| `cargo check --lib --tests` | 1 | - | 0 | - | CLEAN |

---

## Unresolved Questions

None.
