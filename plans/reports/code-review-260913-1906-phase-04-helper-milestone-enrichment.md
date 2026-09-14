# Code Review: Phase 04 — Helper Audit Milestone Enrichment

**Score:** 8.5 / 10  
**Date:** 2026-09-13  
**Reviewer:** Phase04Reviewer  
**Branch:** `feat/terminal-idle-suspend`  

## Code Review Summary

### Scope
- Files reviewed:
  - `server/src/idle_suspend/audit.rs`
  - `server/src/idle_suspend/helper_server.rs`
  - `server/src/idle_suspend/mod.rs`
  - `server/src/bin/dam-hopper-idle-suspend-helper.rs`
  - `server/src/idle_suspend/tests.rs`
  - `plans/260912-0027-production-idle-suspend-diagnostics/phase-04-helper-milestone-enrichment.md`
  - `plans/260912-0027-production-idle-suspend-diagnostics/design-contract.md`
- Lines of code analyzed: ~1,500 lines across modified audit, helper server, daemon, and test modules.
- Review focus: Privileged helper fail-closed semantics, single-frame bounds, intent gate before mutation, RTC and suspend milestone enrichment, and legacy deserialization compatibility.
- Updated plans: `plans/260912-0027-production-idle-suspend-diagnostics/phase-04-helper-milestone-enrichment.md`

### Overall Assessment
Phase 04 implementation is well-architected, robust, and rigorously tested. Helper audit v2 evolves in place with `HELPER_AUDIT_SCHEMA_VERSION = 2`, preserving byte-level backward compatibility with legacy v1 records. Critical security semantics hold: accepted intent is durable and `sync_all` synchronized before any mutation (RTC or suspend), and intent failure fails closed without mutating host state. Capability probes and rejections never fabricate correlation UUIDs. The 22 focused helper tests and 171 module tests pass with zero failures. One security vulnerability (symlink following on unconstrained temporary file in `prune_if_needed`), one performance inefficiency (reading entire audit file on every append), and one minor outcome code classification gap were identified.

---

### Critical Issues / Vulnerabilities

1. **Insecure Temporary File Creation in Privileged Context (`prune_if_needed`)**
   - **Location:** `server/src/idle_suspend/audit.rs:702-718`
   - **Description:** Helper runs as `root`. When pruning triggers (lines > `max_records`), it opens `self.path.with_extension("tmp")` via `OpenOptions::new().create(true).write(true).truncate(true).open(&tmp_path)` without `O_NOFOLLOW` or `mode(0o600)`. It sets mode `0600` via `set_permissions` *after* truncating. If a local user or compromised member of `API_GROUP` places a symlink at `/var/log/dam-hopper/idle-suspend-helper.tmp`, root will follow the symlink and truncate arbitrary host targets (CWE-59 / CWE-377).
   - **Remediation:**
     ```rust
     let mut open_options = OpenOptions::new();
     open_options.create(true).write(true).truncate(true);
     #[cfg(unix)]
     {
         use std::os::unix::fs::OpenOptionsExt;
         open_options.mode(0o600);
         open_options.custom_flags(libc::O_NOFOLLOW);
     }
     let mut tmp_file = open_options.open(&tmp_path).map_err(...)?;
     ```

---

### High Priority Findings / Warnings

1. **Unbounded Full-File Read on Every Audit Record Append**
   - **Location:** `server/src/idle_suspend/audit.rs:651`, `687-696`
   - **Description:** On *every* single `record()` call, `prune_if_needed` opens `self.path`, reads all lines with `BufReader::lines().collect::<Vec<String>>()`, and checks `lines.len() <= self.max_records`. At 10,000 records (~2–3 MB), every request attempt invokes 5–6 audit records, causing 5–6 complete multi-megabyte file reads, allocations of 10,000 strings, and line parses.
   - **Impact:** Significant unnecessary disk read I/O and heap allocations under steady state.
   - **Remediation:** Track approximate line count in `HelperAuditState` (initialized once on startup or cached) and only read/check lines when line count crosses `max_records`, or check file metadata size before reading lines.

2. **Classification Collapses `RtcBusy` to `RtcProgrammingFailed` in `new_completed`**
   - **Location:** `server/src/idle_suspend/audit.rs:204-210`
   - **Description:** When preflight encounters active RTC wakealarm (`PreflightError::RtcAlarmBusy`), it creates `SuspendOutcome::ExecutionFailed { error: "RTC alarm already programmed: ..." }`. In `new_completed`, the heuristic `if error.contains("RTC") || error.contains("wakealarm")` sets `reason_code = Some(HelperReasonCode::RtcProgrammingFailed)` instead of `HelperReasonCode::RtcBusy`.
   - **Remediation:** In `new_completed`, match `if error.contains("already programmed") || error.contains("busy")` prior to `"RTC"` check to emit `HelperReasonCode::RtcBusy`.

---

### Medium Priority Improvements

1. **Unused Descriptor in `prune_if_needed` (TOCTOU Risk)**
   - **Location:** `server/src/idle_suspend/audit.rs:687`
   - **Description:** `prune_if_needed(&self, _file: &File)` accepts `_file` (the open, verified file descriptor from `record()`), but ignores it and reopens `self.path` via `File::open(&self.path)`. This is both an unused parameter code smell and introduces a TOCTOU path reopen.
   - **Remediation:** Use the already-opened descriptor or eliminate the unused parameter.

2. **Parent Directory Ownership Validation at Startup**
   - **Location:** `server/src/idle_suspend/audit.rs:530-540`, `613-620`
   - **Description:** Requirement 68 states "Startup validates fixed parent/file ownership and boot ID before binding/serving". `HelperAudit::with_identity_and_clock` checks parent metadata only if it exists, but does not validate owner/mode (`root:API_GROUP`, `0755`). If absent, `record()` creates it lazily with `create_dir_all`. While practical for unit tests, production startup should verify parent attributes when running under standard systemd path `/var/log/dam-hopper`.

---

### Low Priority Suggestions

1. **Add Legacy Reader Simulation Test**
   - `test_helper_audit_v2_schema_serialization_and_legacy_v1_compatibility` verifies v1 lines deserialized by v2 reader and v2 lines serialized. Add an explicit test deserializing v2 action lines (`acceptedIntent`, `executionCompleted`) into a mock legacy struct (without v2 fields) to verify older reader skips milestone variants without failing on action lines.

2. **Helper Audit Reason Code `AuditWriteFailed`**
   - `HelperReasonCode::AuditWriteFailed` exists in enum matching design contract, but helper server cannot log its own audit failure to audit log. Document this asymmetry explicitly.

---

### Positive Observations

1. **Strict Fail-Closed Intent Gate:** If `audit.record(&intent)` fails, helper aborts immediately, returning `ExecutionFailed` to caller. Neither `program_rtc_wake` nor `trigger_suspend` is ever invoked. Verified by test `test_helper_server_audit_failure_fails_closed`.
2. **Synchronous Durable Flushes:** Mode `0600`, `O_NOFOLLOW`, and `file.sync_all()` executed on every audit append.
3. **No Credential/Frame Leaks:** Untrusted frame/auth rejections do not fabricate request IDs or leak raw payloads into audit records.
4. **Post-Action Outcome Fidelity:** If completion audit write fails post-suspend, backend outcome is never overwritten; actual resume result is returned to client.
5. **Clean Mutex Boundary:** `parking_lot::Mutex` for deduplicator is dropped inside synchronous blocks before any `.await` point, preventing deadlock risks in async runtime.
6. **Robust Test Suite:** 22 focused helper unit and async IPC tests covering framing, deduplication, fault injection, authorization, preflight suppression, RTC busy, and v1/v2 schema compatibility.

---

### Recommended Actions

1. **Apply `O_NOFOLLOW` and `mode(0o600)` to temporary file in `prune_if_needed` (Priority 1).**
2. **Optimize `prune_if_needed` to avoid scanning entire log file on every record (Priority 2).**
3. **Refine `new_completed` error mapping to correctly identify `HelperReasonCode::RtcBusy` (Priority 3).**

---

### Metrics
- Test Pass Rate: 100% (22/22 focused helper tests, 171/171 idle_suspend tests)
- Compiler Warnings: 0
- Build Status: Clean dev build (`Finished in 0.17s`)
- Protocol Version: 1 (Unchanged, 4-KiB cap preserved)
- Helper Audit Schema Version: 2

---

### Unresolved Questions
None. The implementation satisfies Phase 04 requirements and contracts. Proceed to Phase 05 once recommendations are addressed or tracked.
