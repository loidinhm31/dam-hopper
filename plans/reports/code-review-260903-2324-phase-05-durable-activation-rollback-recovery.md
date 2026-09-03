# Code Review: Phase 05 — Durable Activation, Rollback, and Recovery

**Date:** 2026-09-03
**Score:** 8.5/10
**Reviewer:** Phase05Reviewer

## Executive Summary

Phase 05 introduces durable activation, transactional rollback, crash recovery, and reference-safe retention for the Linux release installer architecture. Implementation adheres closely to functional requirements: strict state envelope, monotonic generations, atomic fsync/rename primitives, process holder checks (cgroups, ports, SQLite -wal/-shm), and uncoupled systemd service dependencies. Several edge cases require attention: unconstrained stability probe window during service flapping, recovery unit omission in unit backup/restore, and unbacked-up host config prior to overwrite.

---

## Reviewed Files

- `server/src/linux_release/durable_fs.rs` (162 lines) — atomic writes, fsync, directory commit, symlink replacement
- `server/src/linux_release/state_record.rs` (145 lines) — records for release, candidate, transaction, failure
- `server/src/linux_release/state.rs` (166 lines) — authoritative state envelope (`/var/lib/dam-hopper-manager/state.json`), monotonic generations, 0600 permissions
- `server/src/linux_release/journal.rs` (111 lines) — deployment state machine, allowed transition graph, recovery classification
- `server/src/linux_release/transaction.rs` (119 lines) — lock-scoped transaction context, phase logging, failure redaction
- `server/src/linux_release/systemd_backup.rs` (87 lines) — transactional unit backup, atomic installation, restore
- `server/src/linux_release/process_holders.rs` (196 lines) — proc parsing for listening ports, cgroup procs, and open SQLite/WAL/SHM holders
- `server/src/linux_release/health.rs` (186 lines) — loopback JSON health verification, process identity check, stability probe loop
- `server/src/linux_release/activate_preflight.rs` (147 lines) — manifest SHA-256 verification, port 4800 rejection, SQLite path discovery
- `server/src/linux_release/activate.rs` (170 lines) — quiesce -> switch -> probe -> commit orchestration
- `server/src/linux_release/rollback.rs` (145 lines) — first-install baseline cleanup, active release restore, manual rollback
- `server/src/linux_release/recovery.rs` (86 lines) — boot-time one-shot reconciliation
- `server/src/linux_release/retention.rs` (175 lines) — two-pass reference-safe garbage collection
- `deploy/systemd/dam-hopper-recovery.service.in` (20 lines) — boot-time root one-shot unit
- `deploy/systemd/dam-hopper-api.service.in` (32 lines) — API unit ordering and recovery requirement
- `deploy/systemd/dam-hopper-web.service.in` (39 lines) — Web unit ordering and sandboxing
- `server/src/bin/dam-hopper.rs` (194 lines) — CLI command dispatching (start, status, rollback, recover)
- `server/src/linux_release/stage.rs` & `stage_transaction.rs` (updates) — state envelope integration
- `server/src/linux_release/unit.rs` (updates) — recovery unit rendering and verification
- `server/tests/linux_release_state_machine.rs` (261 lines) — transitions, recovery classification, retention
- `server/tests/linux_release_health.rs` (128 lines) — port parsing, mock health validation, SQLite holder rejection

---

## Validation Commands and Results

1. **Compilation Check:**
   ```bash
   cargo check --manifest-path server/Cargo.toml --all-targets --features vendored
   ```
   *Result:* Clean build, 0 warnings, 0 errors (7.56s).

2. **Integration Test Suites:**
   ```bash
   cargo test --manifest-path server/Cargo.toml --test linux_release_state_machine --test linux_release_health --test linux_release_unit_policy --features vendored
   ```
   *Result:* 19 passed across 3 test suites (0.18s):
   - `linux_release_health`: 5 passed
   - `linux_release_state_machine`: 6 passed
   - `linux_release_unit_policy`: 8 passed

---

## Critical Issues

None. (No direct remote code execution or data corruption vulnerability in normal operation).

---

## Warnings (High / Medium Priority Findings)

### 1. [High] Unbounded Health Stability Loop on Service Flapping
- **Location:** `server/src/linux_release/health.rs:150-185`
- **Issue:** Condition `if !initial_readiness_achieved && start.elapsed() > startup_deadline` only terminates before first readiness. Once `initial_readiness_achieved = true` after a single probe passes, any subsequent transient failure (e.g., process crash where `systemctl_is_active` returns `false`, or listener drop) resets `consecutive` to 0 without bounded overall timeout. The loop continues indefinitely every 500ms instead of timing out and triggering automatic rollback.
- **Fix:** Enforce overall stability deadline (e.g., `startup_deadline + Duration::from_secs(30)`) bounding the entire probe phase. If consecutive successes are not achieved before deadline, return `ReleaseError::ProcessInspectionFailed`.

### 2. [High] Omission of `dam-hopper-recovery.service` from Unit Backups and Rollbacks
- **Location:** `server/src/linux_release/activate.rs:101`, `server/src/linux_release/rollback.rs:50`
- **Issue:** `unit_names` is hardcoded as `["dam-hopper-api.service", "dam-hopper-web.service"]`. `stage_units.rs` renders `dam-hopper-recovery.service` with candidate's `release_root` and `install_unit_file` installs it to `/etc/systemd/system/`. On activation failure:
  - First-install rollback leaves candidate's `dam-hopper-recovery.service` behind in `/etc/systemd/system/`.
  - Upgrade rollback does not restore previous `dam-hopper-recovery.service`. The candidate's unit points to candidate directory; if candidate directory is pruned, recovery unit fails on reboot.
- **Fix:** Include `"dam-hopper-recovery.service"` in `unit_names` for backup, restore, stop, and disable across `activate.rs`, `rollback.rs`, and `recovery.rs`.

### 3. [Medium] `host-config.json` Not Backed Up Prior to Candidate Overwrite
- **Location:** `server/src/linux_release/activate.rs:117-122`, `server/src/linux_release/rollback.rs:85-90`
- **Issue:** `ActivationTransaction::new` initializes `public_config_backup_path` under `backups/<tx_id>/host-config.json`, and `rollback.rs` attempts to restore it. But `activate.rs` overwrites `layout.host_config_json_path()` directly without copying existing file to `tx.public_config_backup_path`. On rollback, previous config cannot be restored.
- **Fix:** Copy `layout.host_config_json_path()` to `tx.public_config_backup_path` if it exists before installing candidate config. On first-install rollback, remove `layout.host_config_json_path()` if present.

### 4. [Medium] `dam-hopper-recovery.service` Not Explicitly Enabled
- **Location:** `server/src/linux_release/activate.rs:140-150`, `server/src/linux_release/recovery.rs:65-85`
- **Issue:** Recovery service has `WantedBy=multi-user.target`. It is pulled via `Requires=` by API and Web, but neither `activate.rs` nor `recovery.rs` explicitly enables it via `systemctl_enable("dam-hopper-recovery.service")`.
- **Fix:** Explicitly enable `dam-hopper-recovery.service` during activation and pointer repair.

---

## Suggestions (Low Priority)

1. **Test Coverage for `probe_target` Rejections:**
   `linux_release_health.rs` tests HTTP parsing via direct reqwest requests rather than `wait_for_health_stability` directly (due to systemd dependencies). Suggest extracting payload validation into standalone function (e.g., `validate_health_http_response`) for direct unit testing.
2. **Consolidate Unit Name Constants:**
   Define `RECOVERY_SERVICE_UNIT = "dam-hopper-recovery.service"` in `constants.rs` and introduce `ALL_SERVICE_UNITS: &[&str]` to avoid repeated string literals across activation, rollback, and recovery.
3. **Transaction Directory Cleanup on Success:**
   Ensure `tx_dir` and `backups_root` are cleanly purged after commit or during retention to prevent disk growth under `/var/lib/dam-hopper-manager/backups/`.

---

## Positive Observations

- **Crash Durability:** `durable_fs.rs` correctly implements temporary file write, sync, rename, and directory sync for all atomic mutations.
- **Authoritative State:** Strict generation-incrementing state envelope (`0600`) with fail-closed unknown-field rejection (`deny_unknown_fields`).
- **Resource Holder Verification:** `process_holders.rs` comprehensively checks `/proc/net/tcp{,6}`, cgroup PIDs, and SQLite `-wal`/`-shm` companion files.
- **Two-Pass Retention:** Validates manifest and ownership of all unreferenced releases before pruning any tree, ensuring referenced or corrupted trees are never removed.
- **Strict Decoupling:** API and Web systemd service units have zero dependencies on each other; both depend exclusively on boot recovery.

---

## Unresolved Questions

None.
