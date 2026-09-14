# Code Review: Phase 03 — Preflight SQLite discovery, installer/reset scripts, and smoke tests (Cycle 2)

Date: 2026-09-14
Reviewer: Phase03ReviewerCycle2
Target: System daemon state configuration migration — Phase 03
Plan: `plans/260914-0854-system-daemon-state-config/phase-03-preflight-installer-reset-and-smoke-tests.md`

---

## Code Review Summary

### Scope
- Files reviewed:
  - `server/src/linux_release/activate_preflight.rs`
  - `server/tests/linux_release_preflight_sqlite.rs`
  - `deploy/release/dam-hopper-install.sh`
  - `deploy/reset-linux-production.sh`
  - `tests/deploy/linux-release-clean-install.sh`
  - `tests/deploy/linux-release-security.sh`
  - `tests/deploy/linux-release-reset-smoke.sh`
  - `package.json`
  - `artifacts/final/dam-hopper-install.sh`
- Lines of code analyzed: ~850 lines across Rust, Bash, and Python
- Review focus: Cycle 2 review of Phase 03 changes, verification of Cycle 1 remediations, security, performance, architecture, and YAGNI/KISS/DRY compliance.
- Updated plans: `plans/260914-0854-system-daemon-state-config/phase-03-preflight-installer-reset-and-smoke-tests.md`

### Score
**10/10** (Exemplary implementation; Cycle 1 warnings resolved cleanly; full test coverage across security, preflight, install, and reset journeys)

---

### Overall Assessment
Cycle 2 review confirms that all feedback from Cycle 1 has been addressed with high quality:
1. **Resolved Non-String `server.session_db_path`:** `activate_preflight.rs` now explicitly checks `val.as_str().ok_or_else(...)`, failing closed with `ReleaseError::Config` if `server.session_db_path` exists but is non-string. Verified by new dedicated unit test `test_preflight_sqlite_non_string_session_path_fails`.
2. **Synchronized Release Artifacts:** `artifacts/final/dam-hopper-install.sh` is now bit-for-bit identical with `deploy/release/dam-hopper-install.sh`, eliminating stale legacy `/etc` provisioning in checked-in artifacts.
3. **Reset CLI & Robustness Enhancements:** Added `--api-unit <path>` option to `deploy/reset-linux-production.sh`, updated usage documentation, and structured file descriptor cleanup (`try...finally` on `verify_fd` and `dir_fd`).
4. **Comprehensive Reset Smoke Suite:** `tests/deploy/linux-release-reset-smoke.sh` exercises canonical default help, nonexistent config refusal, symlink refusal, directory refusal, permission mode mismatch (0644 vs 0600) refusal, dry-run immutability, and live atomic replacement with TOML/permission verification. Integrated into `pnpm test:deploy`.
5. **Zero Invariant Breakage:** Zero filesystem mutation in preflight, rootless smoke passes without regressions, format-2 migration rehearsal untouched and passing.

---

### Critical Issues
*None.*

---

### Warnings
*None.* (All Cycle 1 warnings resolved).

---

### Suggestions

1. **Inner Descriptor Cleanup in Reset Script Helper**
   - **Location:** `deploy/reset-linux-production.sh:218-229`
   - **Context:** In `deploy/reset-linux-production.sh`, `temp_fd` is created before `try:`, but `os.close(temp_fd)` is called inside the block. If an exception occurs before line 225 (e.g. during `f.write`), `temp_fd` closure relies on process termination.
   - **Recommendation:** Wrap `temp_fd` operations in an inner `try...finally: os.close(temp_fd)` or check `temp_fd` status in `finally` to ensure explicit descriptor closure on abnormal aborts prior to unlinking.

2. **Explicit `--api-unit` Flag Exercise in Reset Smoke Suite**
   - **Location:** `tests/deploy/linux-release-reset-smoke.sh:41-86`
   - **Context:** The smoke test exports `DAM_HOPPER_API_UNIT="$MOCK_UNIT"` globally, so all invocation tests exercise the environment variable path.
   - **Recommendation:** Add one assertion passing `--api-unit "$MOCK_UNIT"` explicitly via CLI arguments while unsetting `DAM_HOPPER_API_UNIT` to verify the CLI argument precedence directly.

---

### Positive Observations

- **Fail-Closed Type Safety:** `activate_preflight.rs` enforces strict schema conformity; non-string types or malformed entries fail closed rather than falling through to default paths.
- **Atomic and Unprivileged State Mutation:** `deploy/reset-linux-production.sh` executes the config modification only after dropping root privileges to the exact parsed service account, eliminating any risk of root ownership hijacking or mode loosening.
- **Comprehensive Negative Testing:** `tests/deploy/linux-release-reset-smoke.sh` and `server/tests/linux_release_preflight_sqlite.rs` rigorously validate failure modes (symlinks, non-regular files, bad modes, foreign file holders).
- **Zero-Mutation Preflight Assertion:** `test_preflight_sqlite_zero_filesystem_mutation` asserts timestamp and byte invariants on config and candidate targets to ensure discovery remains strictly read-only.

---

### Validation Commands & Results

| Command | Status | Details |
|---|---|---|
| `cargo test --test linux_release_preflight_sqlite` | PASS | 11/11 tests passed (0.00s) |
| `bash -n deploy/release/*.sh deploy/*.sh tests/deploy/*.sh` | PASS | Clean syntax across all deployment and test scripts |
| `bash tests/deploy/linux-release-clean-install.sh` | PASS | Clean install verified for server, web, and both roles |
| `bash tests/deploy/linux-release-security.sh` | PASS | Unit sandboxing, role identities, and secret exclusion verified |
| `bash tests/deploy/linux-release-reset-smoke.sh` | PASS | Reset script canonical default, refusal checks, dry-run safety, and atomic edit verified |
| `bash tests/deploy/linux-release-upgrade-rollback.sh` | PASS | Upgrade, role change, and rollback journeys verified |
| `bash tests/deploy/linux-release-crash-recovery.sh` | PASS | Crash recovery and reconciliation boundaries verified |
| `bash tests/deploy/linux-release-web-contract.sh` | PASS | Web contract, health schema, and runtime config verified |
| `bash tests/deploy/fedora44-format2-migration.sh` | PASS | Format-2 fixture migration and rollback rehearsal passed |
| `bash tests/deploy/linux-release-rootless-smoke.sh` | PASS | Rootless process smoke passed (ports 35309/34747) |
| `diff -u deploy/release/dam-hopper-install.sh artifacts/final/dam-hopper-install.sh` | PASS | Bit-for-bit identical |

---

### Unresolved Questions
*None.*
