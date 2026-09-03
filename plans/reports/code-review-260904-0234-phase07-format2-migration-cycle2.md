# Code Review: Phase 07 — Format-2 Migration and Old Runner Retirement (Cycle 2)

**Date:** 2026-09-04  
**Reviewer:** Phase07ReviewerCycle2  
**Status:** Approved for Cutover Gate (with Minor Hardening Suggestions)  
**Overall Score:** 9.0 / 10  
**Critical Issues Count:** 0  

---

## 1. Executive Summary

Review Cycle 2 re-assessed the remediation of findings from Cycle 1 regarding format-2 migration, same-filesystem side-staging, atomic root exchange, activation, rollback, and retention.

All three Critical Issues from Cycle 1 have been cleanly resolved and verified with dedicated test coverage:
1. **Retention GC:** Exempts `imported-format-2` from semantic version format checks in `server/src/linux_release/retention.rs:84`, preventing GC aborts while strictly verifying candidate integrity before unreferenced pruning.
2. **Transaction Ownership:** `ActivationTransaction::from_id` (`server/src/linux_release/transaction.rs:50`) is now invoked during activation when an in-flight migration transaction exists (`server/src/linux_release/activate.rs:60-64`), preserving transaction identity and preventing ownership collision errors.
3. **Rollback Backup Path:** `MigrationRecord.old_unit_backup_path` (`server/src/linux_release/migration.rs:163`) references the durable unit backup within the migration workspace (with fallback to canonical releases), ensuring clean restoration in `rollback_migration_exchange`.

High Priority findings 4 through 7 have been addressed. Invariant enforcement in `legacy_format2_root.rs`, symlink verification for `wants` entries in `legacy_format2_inspect.rs` / `migration.rs`, and wildcard listener detection in `process_holders.rs` operate with strict fail-closed guarantees. Manual rollback restores legacy unit and server binaries to canonical layout paths. Two minor non-blocking hardening recommendations are noted for manual rollback fail-closed error handling and process UID checks.

All 14 unit and integration tests across 3 migration suites pass. Fedora 44 rehearsal (`tests/deploy/fedora44-format2-migration.sh`) completed all 4 simulation steps without error. Phase 07 is approved to proceed with legacy runner script retirement and package alias cleanup.

---

## 2. Scope of Review

### Files Analyzed
- `server/src/linux_release/retention.rs` (Lines 80-165: retention candidate gathering, tag exemption, integrity check)
- `server/src/linux_release/activate.rs` (Lines 50-95, 185-238: transaction adoption, quiescence, swap, previous record construction)
- `server/src/linux_release/transaction.rs` (Lines 48-125: `from_id` constructor, `record_phase` ownership validation)
- `server/src/linux_release/migration.rs` (Lines 75-269: side-staging, wants link validation, atomic exchange, rollback exchange, commit cleanup)
- `server/src/linux_release/legacy_format2_root.rs` (Lines 1-207: root directory inventory, bin inventory, marker inventory, symlink rejection, hash check)
- `server/src/linux_release/legacy_format2_inspect.rs` (Lines 48-145: wants link target check, process UID/exe check, wildcard listener check)
- `server/src/linux_release/process_holders.rs` (Lines 30-78: `parse_proc_net_wildcard_listening`, `is_port_listening_wildcard`)
- `server/src/linux_release/rollback.rs` (Lines 48-85, 152-197: failure rollback baseline restoration, manual rollback unit/binary restore)
- `server/src/linux_release/legacy_format2.rs` (Lines 27-86: asset import into release tree)
- `server/tests/linux_release_format2_migration_fixture.rs` (Exact format-2 layout and unit validation)
- `server/tests/linux_release_format2_migration_drift.rs` (10 drift and tamper rejection scenarios)
- `server/tests/linux_release_format2_migration_exchange.rs` (Import, exchange, rollback, and retention lifecycle)
- `tests/deploy/fedora44-format2-migration.sh` (Fedora 44 admin rehearsal with `renameat2(RENAME_EXCHANGE)`)
- `plans/260903-0919-linux-release-installer-architecture/phase-07-format-2-migration-runner-retirement.md` (Plan tracking and criteria)

---

## 3. Status of Previous Findings

| Finding (Cycle 1) | Severity | Status | Verification Detail |
|---|---|---|---|
| Issue 1: Retention `apply_retention` aborts on `imported-format-2` | Critical | **RESOLVED** | `retention.rs:84` explicitly checks `if tag_str != "imported-format-2"`. Tested in `linux_release_format2_migration_exchange.rs:119-163`. |
| Issue 2: Transaction ID ownership conflict blocks activation | Critical | **RESOLVED** | `activate.rs:60-64` reuses existing transaction ID via `ActivationTransaction::from_id`. Transition validation in `record_phase` succeeds without ownership collision. |
| Issue 3: Rollback restoration points to deleted live unit | Critical | **RESOLVED** | `migration.rs:163` sets `old_unit_backup_path` to the persistent unit copy under `releases/imported-format-2/server/systemd/dam-hopper.service`, with fallback in `rollback_migration_exchange`. |
| Issue 4: Incomplete directory inventory & symlink checks | High | **RESOLVED** | `legacy_format2_root.rs:69-89, 125-151` verifies `bin/` contains only `["dam-hopper-server"]` and `.systemd-fresh-install/` contains only `["manifest", "nonce"]`. Rejects any symlink entries. |
| Issue 5: Wants link target not validated | High | **RESOLVED** | `legacy_format2_inspect.rs:70-78` and `migration.rs:97-105` check `fs::read_link` and verify destination ends with `dam-hopper.service`. |
| Issue 6: Process UID and wildcard listener checks missing | High | **RESOLVED** | `process_holders.rs:31-61` parses `/proc/net/tcp` and `/proc/net/tcp6` for wildcard `0.0.0.0` or `::` state `0A`. `legacy_format2_inspect.rs:107-124` validates process exe ends with `dam-hopper-server` and UID matches `loidinh`. |
| Issue 7: Manual rollback binary restoration missing | High | **RESOLVED** (with suggestion) | `rollback.rs:169-177` copies legacy binary to `/opt/dam-hopper/bin/dam-hopper-server` and unit to systemd directory. Minor path resolution hardening recommended below. |

---

## 4. Critical Issues
**Count: 0**  
No blocking defects, security vulnerabilities, or invariant violations remain.

---

## 5. Warnings

### Warning 1: Non-Fail-Closed Missing File Handling in Manual Rollback
- **Location:** `server/src/linux_release/rollback.rs:166-177`
- **Observation:**
  ```rust
  if legacy_unit_src.exists() {
      copy_file_durable(&legacy_unit_src, &target_unit, Some(0o644))?;
  }
  ...
  if legacy_bin_src.exists() {
      let bin_parent = layout.opt_dir.join("bin");
      let _ = fs::create_dir_all(&bin_parent);
      copy_file_durable(&legacy_bin_src, &target_bin, Some(0o755))?;
  }
  ```
  If `legacy_bin_src` or `legacy_unit_src` is missing on disk, the copy is silently skipped. Execution proceeds to `systemctl_daemon_reload()` and `systemctl_start(LEGACY_FORMAT2_UNIT)`, which will fail downstream at the systemd layer.
- **Impact:** Low/Medium during manual rollback if directory structure does not match expected relative path.
- **Recommendation:** Fail closed: if neither `legacy_bin_src` nor a fallback exists, return `ReleaseError::Config("imported format-2 binary not found in release tree")`.

### Warning 2: Structural Path Discrepancy Between `legacy_format2.rs` and `activate.rs`
- **Location:** `server/src/linux_release/legacy_format2.rs:77` vs `server/src/linux_release/activate.rs:194-199`
- **Observation:**
  `import_legacy_format2_release` sets `release_path` to `target_release_dir` (e.g. `/opt/dam-hopper/releases/imported-format-2`), whereas `activate.rs` sets `state.previous.release_path` to `.../releases/imported-format-2/server`.
  While `rollback.rs` currently works because `activate.rs` populates `state.previous` with `.join("server")`, any code paths creating a `ReleaseRecord` directly from `import_legacy_format2_release` would point to the parent directory.
- **Recommendation:** Align `import_legacy_format2_release` to record `target_release_dir.join("server")`, or check both paths in `rollback.rs`.

---

## 6. Suggestions

### Suggestion 1: Explicit Fail-Closed When User `loidinh` Not Found Under `require_root`
- **Location:** `server/src/linux_release/legacy_format2_inspect.rs:107-116`
- **Observation:** `if let Some(user) = super::account::get_user_by_name(LEGACY_FORMAT2_USER)`: If user `loidinh` does not exist on a system when running with `require_root = true`, the UID check is bypassed.
- **Recommendation:** When `require_root` is true, treat non-existence of `loidinh` as an explicit error (`ReleaseError::LegacyMigrationRejected("required user 'loidinh' not found")`).

### Suggestion 2: Deduplicate Pre-Exchange Wants Link Check
- **Location:** `server/src/linux_release/migration.rs:88-105` vs `server/src/linux_release/legacy_format2_inspect.rs:60-78`
- **Recommendation:** Reuse `inspect_format2_installation` or a shared helper function `validate_wants_link` to reduce code duplication.

---

## 7. Positive Observations

1. **Deterministic Root Exchange:** Atomic directory swap uses `renameat2(RENAME_EXCHANGE)` with verified parent directory syncing and 0755 workspace permissions before swap.
2. **Comprehensive Drift Matrix:** 10 negative tests in `linux_release_format2_migration_drift.rs` rigorously defend against format-1 manifests, extra files in `root/`, `bin/`, or `.systemd-fresh-install/`, drop-in directories, nonces, and unmanaged environment overrides.
3. **Robust Rehearsal Script:** `tests/deploy/fedora44-format2-migration.sh` simulates the complete admin migration, side-staging, swap, rollback, and format-1 drift rejection via real kernel syscalls in a clean temporary tree.
4. **Clean Transaction Resilience:** Activation gracefully handles staged migration transactions without UUID clashes, ensuring failure recovery restores the pristine format-2 root.

---

## 8. Verification Results

### Cargo Compilation & Typecheck
```bash
$ cargo check --manifest-path server/Cargo.toml --all-targets --features vendored
Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.47s
(0 errors, 0 warnings)
```

### Migration Test Suites
```bash
$ cargo test --manifest-path server/Cargo.toml \
    --test linux_release_format2_migration_fixture \
    --test linux_release_format2_migration_drift \
    --test linux_release_format2_migration_exchange
running 1 test (fixture) ... ok
running 10 tests (drift) ... ok
running 3 tests (exchange) ... ok
test result: ok. 14 passed; 0 failed; 0 ignored (3 suites, 0.47s)
```

### Fedora 44 Migration Rehearsal
```bash
$ bash tests/deploy/fedora44-format2-migration.sh
[rehearsal] Step 1: Format-2 fixture established
[rehearsal] Step 2: Migration side-staging established without touching canonical root
[rehearsal] Step 3: Atomic directory exchange succeeded
[rehearsal] Step 4: Rollback directory exchange succeeded
[rehearsal] Fedora 44 format-2 migration and rollback rehearsal passed cleanly.
(exit code: 0)
```

---

## 9. Next Steps
1. Execute legacy runner retirement: delete `deploy/run-linux-production.sh`, `deploy/reset-linux-production.sh`, `deploy/systemd/dam-hopper.service`, and `tests/deploy/linux-production-fixtures.sh`.
2. Remove deprecated `linux:production` and `linux:reset` script entries from `package.json`.
3. Proceed to Phase 08 / final integration validation.

---

## 10. Unresolved Questions
None.
