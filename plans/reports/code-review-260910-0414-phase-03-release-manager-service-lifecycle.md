# Code Review: Phase 03 Release Manager Service Lifecycle

**Date:** 2026-09-10  
**Reviewer:** Phase03Reviewer  
**Target:** Phase 03 Release Manager Service Lifecycle (`dam-hopper` CLI, `activate.rs`, `rollback.rs`, `recovery.rs`, `status.rs`)  
**Parent Plan:** `plans/260909-1836-production-idle-suspend-cli-setup/plan.md`  
**Phase Plan:** `plans/260909-1836-production-idle-suspend-cli-setup/phase-03-release-manager-service-lifecycle.md`  

---

## 1. Score: 9.2 / 10

Solid, resilient implementation respecting systemd service ordering, non-fatal fallbacks, unprivileged environments, and rollback lifecycle.

---

## 2. Executive Assessment

- **Startup Order**: Helper service (`dam-hopper-idle-suspend-helper.service`) starts strictly before API server (`dam-hopper-api.service`) when role includes server, ensuring `/run/dam-hopper/idle-suspend.sock` is ready before API initialization.
- **Non-Fatal Fallback**: Helper startup failure is caught and logged via `tracing::warn!`, allowing API server activation to continue without blocking hosts without RTC/suspend support.
- **Lifecycle Integration**: Unit is registered in `ALL_SERVICE_UNITS`, ensuring coordinated stopping, backups, and teardowns in `activate.rs`, `rollback.rs`, `recovery.rs`, `stage_transaction.rs`, and `dam-hopper stop`.
- **Status & Process Evidence**: `status.rs` queries helper unit active state and main process evidence via `inspect_service_process`, mapping unit to `server` role.
- **Resilience**: `disable_if_enabled` handles nonexistent units and unprivileged access denial idempotently (`Ok(())`).

---

## 3. Critical Issues (MUST FIX)

*None.* No security vulnerabilities, regressions, or breaking defects detected.

---

## 4. Warnings (SHOULD FIX)

### 1. Missing "Previous Release:" Heading in Plaintext CLI Status
- **Location**: `server/src/bin/dam-hopper.rs:259-264`
- **Issue**:
  ```rust
  if let Some(ref previous) = mgr_state.previous {
      println!("  Tag: {}", previous.tag);
      println!("  Role: {}", previous.role);
  } else {
      println!("  (none)");
  }
  ```
  The header `println!("Previous Release:");` is missing. Previous release metadata prints directly below the `Web:` service group without section context.
- **Fix**: Add `println!("Previous Release:");` before inspecting `mgr_state.previous`.

### 2. Recovery Service Omitted from Plaintext CLI Status
- **Location**: `server/src/bin/dam-hopper.rs:234-258`
- **Issue**: `collect_all_services_status()` gathers `dam-hopper-recovery.service` (role `"recovery"`), and `--json` exposes it, but plaintext output filters only for `role == "server"` and `role == "web"`. `dam-hopper-recovery.service` is invisible in CLI text output.
- **Fix**: Add a `Recovery:` group iteration in plaintext status display.

### 3. Newly Introduced Unit Retention on Activation Failure Rollback
- **Location**: `server/src/linux_release/rollback.rs:550-570`
- **Issue**: In `rollback_activation_failure`, `restore_unit_files` only copies files found in `tx.units_backup_dir`. If candidate introduced `HELPER_SERVICE_UNIT` for the first time on a system, that unit file is left in `/etc/systemd/system/` after rollback. While non-fatal start prevents catastrophic failure, explicitly disabling/removing newly introduced units ensures pure baseline restoration.
- **Fix**: Remove or disable any unit in `ALL_SERVICE_UNITS` that was not present in the backup directory during rollback.

---

## 5. Suggestions (NICE TO HAVE)

### 1. Operator Console Warning on Helper Fallback
- **Location**: `server/src/linux_release/activate.rs:484` and `rollback.rs:599`
- **Suggestion**: `tracing::warn!` may be suppressed if stdout subscriber or `RUST_LOG` is unconfigured. When running interactive `sudo dam-hopper start`, printing a brief stderr warning ensures the operator is aware idle-suspend helper daemon did not start.

### 2. Fast-Path for Non-Systemd Environments
- **Location**: `server/src/linux_release/systemd.rs:126-136`
- **Suggestion**: `systemctl_is_enabled` invokes `systemctl` binary directly. On non-systemd test containers or systems where `systemctl` is absent, `cmd.output()` returns `ReleaseError::Io`. Probing binary presence or `/run/systemd/system` early avoids raw I/O errors.

---

## 6. Reviewed Files

| File | Concern | Status |
|---|---|---|
| `server/src/linux_release/constants.rs` | Unit constant & `ALL_SERVICE_UNITS` registration | Clean |
| `server/src/linux_release/activate.rs` | Ordered startup, non-fatal fallback, unit install/enable | Clean |
| `server/src/linux_release/rollback.rs` | Pre-rollback stop, active restore, candidate rollback | Clean |
| `server/src/linux_release/recovery.rs` | Boot-time reconciliation, unit pointer repairs | Clean |
| `server/src/linux_release/status.rs` | Inspection, process evidence, role mapping | Clean |
| `server/src/linux_release/mod.rs` | Module visibility and re-exports | Clean |
| `server/src/linux_release/systemd.rs` | Command execution, access denial / missing unit idempotency | Clean |
| `server/src/linux_release/systemd_backup.rs` | Atomic installation and unit file restoration | Clean |
| `server/src/linux_release/privilege.rs` | CLI command EUID boundary enforcement | Clean |
| `server/src/linux_release/process.rs` | MainPID and `/proc/<pid>` evidence collection | Clean |
| `server/src/bin/dam-hopper.rs` | CLI lifecycle dispatch and status formatting | Warnings 1 & 2 |
| `server/tests/linux_release_state_machine.rs` | Unit and lifecycle invariant regression tests | Clean |

---

## 7. Validation Commands and Results

All targeted scoped commands executed cleanly:

```bash
# 1. Scoped unit tests for linux_release
cargo test --lib linux_release
# Result: 10 passed; 0 failed; finished in 0.04s

# 2. State machine & lifecycle invariant test suite
cargo test --test linux_release_state_machine
# Result: 11 passed; 0 failed; finished in 0.06s
# Includes:
# - test_helper_service_lifecycle_invariants: ok
# - test_disable_if_enabled_on_nonexistent_unit: ok
# - test_systemctl_disable_idempotent_on_nonexistent_unit: ok

# 3. Binary compilation check
cargo check --bin dam-hopper
# Result: Finished dev profile [unoptimized + debuginfo] target(s) in 0.28s (0 warnings)
```

---

## 8. Plan & Completeness Verification

- [x] Add helper service startup to `activate.rs` (Verified)
- [x] Add helper service stop/restart to `rollback.rs` and `recover.rs` (Verified)
- [x] Include helper status in `status.rs` (Verified)
- [x] Add unit tests for release manager lifecycle transitions (Verified)
- [x] Plan files updated:
  - `plans/260909-1836-production-idle-suspend-cli-setup/phase-03-release-manager-service-lifecycle.md` marked Completed
  - `plans/260909-1836-production-idle-suspend-cli-setup/plan.md` updated to 75% complete (Phases 01–03 DONE)

---

## 9. Unresolved Questions

*None.* Ready to proceed to Phase 04 (Verification, Boundary Enforcement & End-to-End Testing).
