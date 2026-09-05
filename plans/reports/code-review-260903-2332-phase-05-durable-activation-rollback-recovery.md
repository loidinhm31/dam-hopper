# Code Review (Cycle 2): Phase 05 — Durable Activation, Rollback, and Recovery

**Date:** 2026-09-03
**Score:** 9.8/10
**Reviewer:** Phase05Reviewer2
**Status:** Approved (Ready for Phase 06)

---

## Executive Summary

Cycle 2 review validates durable activation, rollback, and recovery implementations in Phase 05. All four durability warnings from Cycle 1 have been resolved cleanly:
1. Overall probe deadline (`overall_deadline = startup_deadline + 30s`) in `health.rs` eliminates unbounded loop risk during service flapping.
2. `RECOVERY_SERVICE_UNIT` added to `ALL_SERVICE_UNITS` in `constants.rs` and included in unit backups, restores, and first-install baseline cleanups across `activate.rs`, `rollback.rs`, and `recovery.rs`.
3. `host-config.json` backed up prior to candidate overwrite in `activate.rs`, restored on rollback, and removed on first-install failure.
4. `dam-hopper-recovery.service` explicitly enabled during activation commit and pointer repair.

All 13 new production code files in `server/src/linux_release/` strictly respect the <200 LOC ceiling. All 77 tests in the test suite pass cleanly with 0 warnings.

---

## Reviewed Files

### Core Engine & State Primitives
- `server/src/linux_release/durable_fs.rs` (162 LOC) — atomic tempfile write, fsync, directory fsync, atomic symlink
- `server/src/linux_release/state_record.rs` (145 LOC) — strict schema records for release, candidate, transaction, failure
- `server/src/linux_release/state.rs` (166 LOC) — authoritative `/var/lib/dam-hopper-manager/state.json`, monotonic generation, 0600 permissions
- `server/src/linux_release/journal.rs` (111 LOC) — strict lifecycle graph, transition validation, recovery classification
- `server/src/linux_release/transaction.rs` (119 LOC) — lock-scoped transaction context, phase logging, sanitized failure recording
- `server/src/linux_release/systemd_backup.rs` (87 LOC) — transactional unit backups, atomic unit installation, rollback restoration

### Process & Health Verification
- `server/src/linux_release/health.rs` (194 LOC) — loopback JSON health verification, process identity check, bounded stability probe loop with overall deadline
- `server/src/linux_release/process_holders.rs` (196 LOC) — `/proc/net/tcp{,6}` port parser, cgroup PID discovery, `/proc/<pid>/fd` SQLite and `-wal`/`-shm` holder inspection
- `server/src/linux_release/activate_preflight.rs` (147 LOC) — manifest digest preflight, legacy port 4800 rejection, SQLite path resolution, health target generation

### Activation, Rollback & Lifecycle
- `server/src/linux_release/activate.rs` (176 LOC) — lock-scoped activation pipeline: quiesce -> backup -> switch -> probe -> commit -> GC
- `server/src/linux_release/rollback.rs` (148 LOC) — first-install baseline cleanup, previous active restoration, manual rollback
- `server/src/linux_release/recovery.rs` (87 LOC) — boot-time one-shot reconciliation and fail-closed pointer repair
- `server/src/linux_release/retention.rs` (175 LOC) — reference-safe two-pass release pruning with integrity validation
- `server/src/linux_release/constants.rs` (68 LOC) — `ALL_SERVICE_UNITS`, `RECOVERY_SERVICE_UNIT`, network ports, timeouts

### Units & CLI
- `deploy/systemd/dam-hopper-recovery.service.in` (20 LOC) — root one-shot boot recovery unit ordered before app units
- `deploy/systemd/dam-hopper-api.service.in` (32 LOC) — API unit ordering, recovery dependency, uncoupled from web
- `deploy/systemd/dam-hopper-web.service.in` (39 LOC) — Web unit sandboxing, recovery dependency, uncoupled from API
- `server/src/bin/dam-hopper.rs` (194 LOC) — CLI dispatch for `start`, `rollback`, `recover`, `status`, `install`
- `server/src/linux_release/cli.rs` (139 LOC) — CLI argument definitions

### Test Suites
- `server/tests/linux_release_state_machine.rs` (261 LOC) — state transitions, generation increments, crash classification, retention GC
- `server/tests/linux_release_health.rs` (128 LOC) — `/proc/net/tcp` parsing, axum health endpoints, SQLite holder rejection
- `server/tests/linux_release_unit_policy.rs` (149 LOC) — unit sandboxing and policy enforcement

---

## Validation Commands and Results

1. **Compilation Check:**
   ```bash
   cargo check --manifest-path server/Cargo.toml --all-targets --features vendored
   ```
   *Result:* Clean build, 0 warnings, 0 errors (6.27s).

2. **Phase 05 Test Suites:**
   ```bash
   cargo test --manifest-path server/Cargo.toml --test linux_release_state_machine --test linux_release_health --test linux_release_unit_policy --features vendored
   ```
   *Result:* 19 passed across 3 test suites (0.16s).

3. **Full Linux Release Test Matrix:**
   ```bash
   cargo test --manifest-path server/Cargo.toml --test 'linux_release*' --features vendored
   ```
   *Result:* 77 passed across 12 test suites (0.15s).

4. **Line Count Verification (<200 LOC per file):**
   ```bash
   wc -l server/src/linux_release/*.rs
   ```
   *Result:* All 13 newly created Phase 05 production files are strictly <= 196 lines.

---

## Critical Issues

None.

---

## Warnings (High / Medium Priority Findings)

None. All 4 warnings from Cycle 1 resolved and verified.

---

## Suggestions (Low Priority Improvements)

1. **DRY Constant Reuse in `recovery.rs`:**
   - In `recovery.rs:60`, replace local array literal `["dam-hopper-api.service", "dam-hopper-web.service", "dam-hopper-recovery.service"]` with `ALL_SERVICE_UNITS` from `constants.rs`.
   - In `recovery.rs:77`, replace `"dam-hopper-recovery.service"` with `RECOVERY_SERVICE_UNIT`.
2. **Handle/Log Host Config Backup Error:**
   - In `activate.rs:94`, `let _ = copy_file_durable(&layout.host_config_json_path(), &tx.public_config_backup_path, Some(0o644));` suppresses errors. While the backup directory exists, propagating or logging non-NotFound errors guarantees backup integrity.

---

## Positive Observations

- **Crash Consistency:** Strict write-sync-rename-sync discipline across `durable_fs.rs`, preventing zero-length files or lost directory entries upon power loss.
- **Fail-Closed Preflight:** Proactive verification prevents broken transitions before switching units or touching listeners.
- **Flap Resistance:** Bounded 50s overall probe deadline protects against indefinite retry loops while requiring 10s of continuous health stability.
- **Uncoupled Systemd Units:** API and Web units depend exclusively on `dam-hopper-recovery.service`, preventing cascading failure loops between independent services.

---

## Unresolved Questions

None.
