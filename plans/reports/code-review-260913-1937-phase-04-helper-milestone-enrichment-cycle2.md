# Code Review: Phase 04 — Helper Audit Milestone Enrichment (Cycle 2)

**Score:** 9.8 / 10  
**Date:** 2026-09-13  
**Reviewer:** Phase04ReviewerCycle2  
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
- Lines of code analyzed: ~1,600 lines across modified audit, helper server, daemon, and test modules.
- Review focus: Cycle 2 verification of CWE-59/CWE-377 fix in `prune_if_needed`, `record_count` I/O optimization, `RtcBusy` mapping refinement in `new_completed`, regression test additions, and YAGNI/KISS/DRY compliance.
- Updated plans: `plans/260912-0027-production-idle-suspend-diagnostics/phase-04-helper-milestone-enrichment.md`

### Overall Assessment
Cycle 2 implementation successfully resolves all previously raised critical vulnerabilities, high-priority performance bottlenecks, and error-mapping gaps. Privileged helper runs with robust fail-closed semantics. The temporary file creation vulnerability (CWE-59/CWE-377) is resolved via atomic exclusive creation (`create_new(true)`, mode `0600`, `O_NOFOLLOW | O_CLOEXEC`) using an unpredictable name (`.audit-prune-{pid}-{uuid}.tmp`). Disk read overhead on record append is eliminated: `record_count` tracks log size in-memory under lock, only inspecting and pruning when exceeding `max_records`. Preflight `RtcAlarmBusy` mapping correctly maps to `HelperReasonCode::RtcBusy`. All 23 helper unit tests and 172 idle_suspend module tests pass with 0 warnings.

---

### Critical Issues
None. The CWE-59/CWE-377 symlink and temporary file truncation vulnerability in `prune_if_needed` has been remediated and verified.

---

### High Priority Findings / Warnings
None. The I/O inefficiency in `record()` and the `RtcBusy` classification gap have both been resolved.

---

### Medium Priority Improvements
1. **Parent Directory Explicit Ownership Assertion**:
   - `HelperAudit::with_identity_and_clock` inspects `symlink_metadata` to reject non-directories or symlinks at the parent path. For full production defense-in-depth, helper systemd deployment relies on `LogsDirectory=dam-hopper` to enforce `root:API_GROUP` ownership. An optional runtime UID/GID check on Unix could be added if running outside systemd. (Low operational risk given systemd sandbox).

---

### Low Priority Suggestions
1. **Preflight Failure Detail String Bounding**:
   - In `helper_server.rs:180`, `preflight_result.as_ref().err().map(|e| e.to_string())` is logged to `detail`. While bounded by `MAX_HELPER_AUDIT_LINE_BYTES` (16 KiB), explicit 512-byte truncation on the source detail string prior to audit emission would maintain consistency with collector boundary limits.

---

### Positive Observations
1. **Secure Atomic Pruning (CWE-59 / CWE-377 Fix):** `prune_if_needed` uses `create_new(true)` (`O_CREAT | O_EXCL`), Unix mode `0600`, `O_NOFOLLOW | O_CLOEXEC`, an unpredictable filename with process ID and UUID v4, explicit cleanup on failure, and parent directory `sync_all()`.
2. **I/O Optimization:** In-memory `record_count` in `HelperAuditState` avoids reading the audit log on every append. Full-file scan occurs only when `record_count > max_records`, self-healing to the retained count.
3. **Correct Error Code Mapping:** `new_completed` checks `already programmed` and `busy` before generic `RTC` strings, ensuring `PreflightError::RtcAlarmBusy` maps to `HelperReasonCode::RtcBusy`.
4. **Observable Sequence Gap Preservation:** Tested by `test_helper_audit_sequence_gap_preservation_on_write_failure`; sequence numbers are incremented before write attempts and never rolled back on error.
5. **No Synthetic Correlations:** Auth, frame decode, and capability probe records strictly omit request/correlation IDs, preventing forged or hallucinated traces.
6. **Intent Gate Durability:** Intent record is flushed and synced with `file.sync_all()` before invoking RTC or suspend backends.

---

### Recommended Actions
1. **Proceed to Phase 05:** Phase 04 helper milestone enrichment is complete, hardened, and verified.
2. **Phase 05 Consumption:** Ensure Phase 05 diagnostic bundle collector maps helper audit records according to privacy and redaction rules (omitting `detail` and free-text strings from final bundles).

---

### Metrics
- Type Coverage: 100% (Strict Rust typing, closed enums for outcome/reason codes)
- Test Coverage: 23/23 focused helper tests passing, 172/172 idle_suspend tests passing
- Linting / Compiler Diagnostics: 0 warnings, 0 errors
- Schema Versions: `HELPER_AUDIT_SCHEMA_VERSION = 2`, `HELPER_PROTOCOL_VERSION = 1`

---

### Unresolved Questions
None.
