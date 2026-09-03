# Code Review: Phase 07 — Format-2 Migration and Old Runner Retirement

**Date:** 2026-09-04  
**Reviewer:** Phase07Reviewer  
**Status:** Changes Requested  
**Overall Score:** 6.5 / 10  

---

## 1. Executive Summary

Phase 07 implements format-2 migration and old runner retirement:
- Format-2 read-only inspection, manifest verification, and legacy asset import (`imported-format-2`).
- Isolated same-filesystem side-staging in `/opt/.dam-hopper-migration.<tx_id>`.
- Atomic root exchange via `renameat2(RENAME_EXCHANGE)` and rollback restoration.
- Pre-activation quiescence and post-activation cleanup verification.

Architecture direction aligns well with parent PDR and Phase 05/06 invariants. However, critical runtime defects were identified in retention tag parsing, transaction ownership during activation, rollback backup unit paths, and format-2 inventory/link/process verification completeness. Old runner script retirement remains pending resolution of these findings and gate execution.

---

## 2. Scope of Review

### Target Files Reviewed
- `server/src/linux_release/legacy_format2.rs`
- `server/src/linux_release/legacy_format2_manifest.rs`
- `server/src/linux_release/legacy_format2_root.rs`
- `server/src/linux_release/legacy_format2_unit.rs`
- `server/src/linux_release/legacy_format2_inspect.rs`
- `server/src/linux_release/migration.rs`
- `server/src/linux_release/durable_fs.rs` (`atomic_exchange_directories`)
- `server/src/linux_release/stage_transaction.rs`
- `server/src/linux_release/activate.rs`
- `server/src/linux_release/rollback.rs`
- `server/src/linux_release/retention.rs`
- `server/src/linux_release/state_record.rs`
- `server/src/linux_release/error.rs`
- `server/tests/linux_release_format2_migration_fixture.rs`
- `server/tests/linux_release_format2_migration_drift.rs`
- `server/tests/linux_release_format2_migration_exchange.rs`
- `server/tests/common/format2_fixtures.rs`
- `tests/deploy/fedora44-format2-migration.sh`

### Supporting Context Inspected
- `deploy/run-linux-production.sh` (legacy format-2 runner reference)
- `package.json` (runner script aliases)
- `plans/260903-0919-linux-release-installer-architecture/phase-07-format-2-migration-runner-retirement.md`

---

## 3. Critical Issues (Must Fix Before Gate / Merge)

### Issue 1: Retention `apply_retention` Aborts on `imported-format-2` Tag Format
- **Location:** `server/src/linux_release/retention.rs:84-86`
- **Impact:** System-wide failure of retention GC whenever an imported format-2 release exists in `/opt/dam-hopper/releases/`.
- **Details:**
  `apply_retention` scans all directory entries in `releases/` and invokes `validate_tag_format(&tag_str)` before checking references or candidate integrity:
  ```rust
  let tag_str = name.to_string_lossy();
  validate_tag_format(&tag_str).map_err(|e| ReleaseError::Config(format!(
      "invalid directory name in releases dir '{}': {e}", entry.path().display()
  )))?;
  ```
  `validate_tag_format` enforces `v<SemVer>`. Because `"imported-format-2"` does not start with `'v'`, `apply_retention` returns `ReleaseError::Config` and aborts entire garbage collection. Although `verify_candidate_integrity` explicitly supports `imported-format-2`, execution never reaches that check.
- **Remediation:**
  Exempt `"imported-format-2"` from `validate_tag_format` in `retention.rs:84`:
  ```rust
  if tag_str != super::legacy_format2::LEGACY_FORMAT2_TAG {
      validate_tag_format(&tag_str).map_err(...)?;
  }
  ```

### Issue 2: Transaction ID Ownership Conflict Blocks Activation of Staged Migration
- **Location:** `server/src/linux_release/stage_transaction.rs:135-149`, `server/src/linux_release/activate.rs:60`, `server/src/linux_release/transaction.rs:25-27, 61-68`
- **Impact:** Migration cannot be activated after staging; `dam-hopper start` fails immediately with ownership violation.
- **Details:**
  1. `stage_release_bundle` generates staging `tx_id = Uuid::new_v4()` and persists `mgr_state.transaction = Some(TransactionRecord { tx_id, phase: Staged, migration, ... })`.
  2. Next, `execute_activation` initializes a new transaction via `ActivationTransaction::new(layout)?`, which generates an unrelated fresh `Uuid::new_v4()`.
  3. Calling `tx.record_phase(layout, &mut state, DeploymentState::Quiesced, TransactionPhase::Quiesced)` checks:
     ```rust
     if let Some(existing_tx) = &state.transaction {
         if existing_tx.tx_id != self.tx_id {
             return Err(ReleaseError::Config(format!(
                 "transaction ownership violation: expected {}, found {}",
                 self.tx_id, existing_tx.tx_id
             )));
         }
     }
     ```
  4. Mismatch triggers immediate return with error.
- **Remediation:**
  Update `ActivationTransaction` to support resuming or adopting an in-flight transaction from `state.transaction` (e.g. `ActivationTransaction::for_state(layout, &state)?`). Reuse the staged transaction ID and existing backup/migration paths.

### Issue 3: Rollback Restoration Points to Deleted Live Unit Instead of Backup
- **Location:** `server/src/linux_release/migration.rs:125-132, 184-188`, `server/src/linux_release/activate.rs:122-128`
- **Impact:** Failed activation rollback cannot restore the legacy `dam-hopper.service` unit file, leaving system in broken state.
- **Details:**
  1. In `stage_migration_candidate`, `mig_record.old_unit_backup_path` is initialized to:
     `layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT)` (i.e. `/etc/systemd/system/dam-hopper.service`).
  2. During `execute_activation_pipeline`, activation explicitly deletes:
     `layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT)`.
  3. When rollback runs (`rollback_migration_exchange`):
     ```rust
     let backup_unit = Path::new(&migration_record.old_unit_backup_path);
     let target_unit = layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT);
     if backup_unit.exists() {
         let _ = copy_file_durable(backup_unit, &target_unit, Some(0o644));
     }
     ```
     `backup_unit.exists()` evaluates to `false` because the live unit was removed. The unit is never restored.
  4. Furthermore, `backup_unit` and `target_unit` had identical paths, which would have been a no-op self-copy.
- **Remediation:**
  Save the backup copy to a persistent location during staging or activation (e.g. `tx.units_backup_dir.join(LEGACY_FORMAT2_UNIT)` or retrieve from imported legacy release `releases/imported-format-2/server/systemd/dam-hopper.service`), and set `old_unit_backup_path` to that actual backup file.

---

## 4. High Priority Findings (Security & Correctness)

### Issue 4: Incomplete Format-2 Directory Inventory and Symlink Checks
- **Location:** `server/src/linux_release/legacy_format2_root.rs:48-85`
- **Impact:** Tampered or compromised legacy root with extra binaries, scripts, or symlinks bypasses validation.
- **Details:**
  `inspect_format2_root` checks that `root_dir` entries are exactly `[".systemd-fresh-install", "bin"]`. However:
  1. It does NOT read entries of `bin/` to verify that `bin/` contains ONLY `dam-hopper-server`. Extra executables or files in `bin/` are ignored.
  2. It does NOT read entries of `.systemd-fresh-install/` to verify that it contains ONLY `manifest` and `nonce`. Extra injected files are ignored.
  3. It does NOT verify that no symlinks exist in the tree.
  Legacy runner `run-linux-production.sh:834-854` strictly enforced:
  `[[ "$(find "$BIN_DIR" -mindepth 1 -maxdepth 1 -printf '%f\n')" == dam-hopper-server ]]`
  `[[ "$actual_marker" == "$expected_marker" ]]` (manifest, nonce)
  `[[ -z "$(find "$INSTALL_ROOT" -type l -print -quit)" ]]`
- **Remediation:**
  Enumerate and sort entries of `bin/` (must be `["dam-hopper-server"]`) and `.systemd-fresh-install/` (must be `["manifest", "nonce"]`), and ensure no symlinks exist anywhere in `root_dir`.

### Issue 5: Systemd Wants Link Target and Ownership Not Validated
- **Location:** `server/src/linux_release/legacy_format2_inspect.rs:77-85`, `server/src/linux_release/migration.rs:90-97`
- **Impact:** Malicious or invalid symlinks in `multi-user.target.wants` (e.g. pointing to `/dev/null` or `/etc/shadow`) pass inspection.
- **Details:**
  The code checks:
  ```rust
  if !wants_meta.file_type().is_symlink() {
      return Err(ReleaseError::LegacyMigrationRejected { ... });
  }
  ```
  It never reads the symlink destination via `fs::read_link`. It must verify that target points to `dam-hopper.service` or `../dam-hopper.service`. Additionally, ownership should be verified if `require_root` is set.
- **Remediation:**
  Call `fs::read_link(&wants_link_path)`. Verify target equals `unit_path` or `Path::new("../").join(LEGACY_FORMAT2_UNIT)`.

### Issue 6: Process Identity (UID/Executable) and Wildcard Listener Checks Missing
- **Location:** `server/src/linux_release/legacy_format2_inspect.rs:94-118`
- **Impact:** Foreign process or non-wildcard listener on port 4801 falsely accepted as eligible format-2 service.
- **Details:**
  Requirement 33/34 mandates:
  - Active and healthy service as `loidinh`.
  - Process executable matching `/opt/dam-hopper/bin/dam-hopper-server`.
  - Wildcard `0.0.0.0:4801` listener.
  `inspect_format2_installation` extracts `proc.pid`, `proc.uid`, `proc.gid` but never asserts `proc.uid` equals `loidinh`'s UID or that `proc.exe_path` matches the server binary. Moreover, `is_port_listening(4801)` checks if port 4801 is open, but does not check that socket address is `0.0.0.0` or `::`.
- **Remediation:**
  Use `verify_service_identity_and_exe` to check UID and exe path. Parse `/proc/net/tcp` to ensure local address is wildcard (`00000000:12C1` or `:::12C1`).

### Issue 7: Post-Commit Manual Rollback Fails to Provide Server Binary Path
- **Location:** `server/src/linux_release/rollback.rs:160-182`
- **Impact:** Manual rollback to `imported-format-2` after a committed activation fails on service startup.
- **Details:**
  In `execute_manual_rollback`:
  When rolling back to `imported-format-2`, it restores `dam-hopper.service` and executes `systemctl_start("dam-hopper.service")`.
  However, legacy `dam-hopper.service` executes:
  `ExecStart=/opt/dam-hopper/bin/dam-hopper-server ...`
  After commit, `/opt/dam-hopper` is the new release layout (with `releases/` and `current`), and `commit_migration_cleanup` deleted the old root. The imported binary resides at `/opt/dam-hopper/releases/imported-format-2/server/bin/dam-hopper-server`. Because `/opt/dam-hopper/bin/dam-hopper-server` does not exist, systemd fails to start the unit.
- **Remediation:**
  In manual rollback to `imported-format-2`, ensure `/opt/dam-hopper/bin` is symlinked or populated to point to `releases/imported-format-2/server/bin/dam-hopper-server`.

---

## 5. Medium & Low Priority Findings

### Issue 8: Retirement of Legacy Production Scripts Pending Gate
- **Location:** `deploy/run-linux-production.sh`, `deploy/reset-linux-production.sh`, `deploy/systemd/dam-hopper.service`, `tests/deploy/linux-production-fixtures.sh`, `package.json`
- **Details:**
  These files are scheduled for deletion after test and reviewer gates pass. Current retention is acceptable until remediation is verified.

### Issue 9: DRY / Duplicated Verification Logic
- **Location:** `server/src/linux_release/migration.rs:85-98` vs `legacy_format2_inspect.rs:69-85`
- **Details:**
  `stage_migration_candidate` partially re-implements checks from `inspect_format2_installation` rather than reusing the evidence struct directly.
- **Suggestion:** Refactor `stage_migration_candidate` to accept or call `inspect_format2_installation` directly to keep inspection logic in a single module.

---

## 6. Positive Observations

1. **Robust Atomic Exchange:** `atomic_exchange_directories` cleanly invokes Linux `renameat2(AT_FDCWD, path_a, AT_FDCWD, path_b, RENAME_EXCHANGE)` and includes parent directory syncing.
2. **Device Isolation Enforcement:** `verify_same_device` checks `MetadataExt::dev()` between `/opt/dam-hopper` and its parent, preventing cross-device exchange failures.
3. **Format-1 Strict Rejection:** Clear detection and fail-closed errors (`UnsupportedFormat1Migration`) preventing invalid states from entering manager migration.
4. **Rehearsal Script:** `tests/deploy/fedora44-format2-migration.sh` exercises the full simulated migration lifecycle using real `renameat2` syscalls via Python ctypes.
5. **Durable File Operations:** Durable atomic file copy with strict permissions (`0755` for binary, `0644` for unit, `0700` for migration workspace).

---

## 7. Verification Evidence

Commands executed:
```bash
$ cargo check --manifest-path server/Cargo.toml --all-targets --features vendored
Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.35s

$ jq empty package.json
(exit code 0)

$ bash -n tests/deploy/fedora44-format2-migration.sh
(exit code 0)

$ cargo test --manifest-path server/Cargo.toml \
    --test linux_release_format2_migration_fixture \
    --test linux_release_format2_migration_drift \
    --test linux_release_format2_migration_exchange
test result: ok. 11 passed; 0 failed; 0 ignored

$ bash tests/deploy/fedora44-format2-migration.sh
[rehearsal] Step 1: Format-2 fixture established
[rehearsal] Step 2: Migration side-staging established without touching canonical root
[rehearsal] Step 3: Atomic directory exchange succeeded
[rehearsal] Step 4: Rollback directory exchange succeeded
[rehearsal] Fedora 44 format-2 migration and rollback rehearsal passed cleanly.
```

---

## 8. Prioritized Remediation Actions

1. **Fix Retention Tag Validation:** Allow `super::legacy_format2::LEGACY_FORMAT2_TAG` in `retention.rs:84`.
2. **Support Transaction Resumption:** Allow `ActivationTransaction` to reuse an in-flight `tx_id` and backup paths when `state.transaction` exists.
3. **Correct Backup Unit Path in Migration Record:** Store true unit backup path (e.g. inside `tx.units_backup_dir` or the imported release) in `mig_record.old_unit_backup_path`.
4. **Harden Format-2 Invariants:**
   - Enforce exact `bin/` and `.systemd-fresh-install/` entry contents and reject any symlinks in the root tree.
   - Enforce wants link target (`dam-hopper.service`) and ownership.
   - Enforce process UID (`loidinh`), exe path, and wildcard `0.0.0.0:4801` socket binding.
5. **Handle Manual Rollback Executable Path:** Ensure `/opt/dam-hopper/bin/dam-hopper-server` exists upon manual rollback to `imported-format-2`.
6. **Execute Final Gate:** Re-run Fedora rehearsal and integration suite, then delete legacy shell runner scripts and remove package aliases.

---

## 9. Unresolved Questions
None.
