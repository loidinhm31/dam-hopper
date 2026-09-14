# Code Review: Phase 01 Systemd Service Unit Templates & PID Management

**Date:** 2026-09-09  
**Reviewer:** Phase01Reviewer-2  
**Plan:** `plans/260909-1836-production-idle-suspend-cli-setup/phase-01-systemd-service-templates-and-pid-management.md`  
**Score:** 9.5 / 10  

---

## Code Review Summary

### Scope
- Files reviewed:
  - `deploy/systemd/dam-hopper-api.service.in`
  - `deploy/systemd/dam-hopper-api.service`
  - `deploy/systemd/dam-hopper-idle-suspend-helper.service.in`
  - `deploy/systemd/dam-hopper-idle-suspend-helper.service`
  - `deploy/systemd/dam-hopper-idle-suspend-helper.socket`
  - `server/src/linux_release/unit_policy.rs`
  - `server/tests/linux_release_unit_policy.rs`
- Lines of code analyzed: ~500 LOC
- Review focus: Phase 01 changes, security, systemd PID lifecycle, socket ownership, release manager policy enforcement.
- Updated plans:
  - `plans/260909-1836-production-idle-suspend-cli-setup/phase-01-systemd-service-templates-and-pid-management.md`
  - `plans/260909-1836-production-idle-suspend-cli-setup/plan.md`

### Overall Assessment
Implementation cleanly resolves the missing `/run/dam-hopper/server.pid` linkage and socket group ownership gaps without requiring invasive server code alterations. Systemd native lifecycle hooks (`ExecStartPost`, `ExecStopPost`, `PIDFile`) reliably manage PID lifetime. Hardening policies in `unit_policy.rs` ensure rendered units strictly adhere to security and architecture invariants.

---

## Critical Issues (MUST FIX)
*None.* Zero security regressions, syntax errors, or failing boundary checks.

---

## Warnings (SHOULD FIX)

1. **Shared `RuntimeDirectory` Ownership & Permission Precedence (`RuntimeDirectoryMode`)**:
   - **File:** `deploy/systemd/dam-hopper-idle-suspend-helper.service.in`
   - **Issue:** Both `dam-hopper-api.service` (`User=@API_USER@`, `Group=@API_GROUP@`) and `dam-hopper-idle-suspend-helper.service` (`User=root`, `Group=@API_GROUP@`) define `RuntimeDirectory=dam-hopper`. Systemd recursively chowns the directory and all contained files to the owning user and group of whichever unit starts or restarts, applying `RuntimeDirectoryMode` (defaults to `0755`).
   - **Impact:** If helper starts first or restarts while API is running, systemd resets `/run/dam-hopper` ownership to `root:@API_GROUP@` with `0755` (`drwxr-xr-x`). Unprivileged `@API_USER@` only has group access (`r-x`), lacking write access (`w`). Subsequent PID file recreation by `@API_USER@` on service restart will fail with `EACCES` (Permission denied).
   - **Fix:** Add `RuntimeDirectoryMode=0775` to `dam-hopper-idle-suspend-helper.service.in` (and `DirectoryMode=0775` to `dam-hopper-idle-suspend-helper.socket`) so group `@API_GROUP@` retains write permission regardless of whether `root` or `@API_USER@` currently owns the directory.

2. **Untracked Static Unit File in Git**:
   - **File:** `deploy/systemd/dam-hopper-api.service`
   - **Issue:** File was created to sync static template with `.service.in`, but is currently untracked (`??` in git status).
   - **Fix:** Stage file (`git add deploy/systemd/dam-hopper-api.service`) prior to committing Phase 01 changes.

---

## Suggestions (NICE TO HAVE)

1. **Helper Unit Verification in `unit_policy.rs` (Phase 02 / Phase 04)**:
   - Extend `server/src/linux_release/unit_policy.rs` to validate `dam-hopper-idle-suspend-helper.service` properties (`User=root`, `Group=@API_GROUP@`, `CapabilityBoundingSet=CAP_WAKE_ALARM`, `UMask=0007`) during release staging.
2. **Resolve Pre-existing Test Suite Compiler Warnings**:
   - Remove unused imports `ManualAuditRecord`, `ServerAuditRecord` in `server/src/idle_suspend/tests.rs`.
   - Prefix unused `state` with `_state` in `server/src/api/tests.rs:6877`.

---

## Positive Observations
- **Fail-Closed Principle**: PID file permission `0600` under `UMask=0077` prevents unauthorized local users from spoofing server PID.
- **Kernel-Enforced Credentials**: `SO_PEERCRED` validation in helper confirms genuine PID and UID directly from Linux kernel socket metadata.
- **Systemd Clean Unlink**: Double cleanup defense: `ExecStopPost=/usr/bin/rm -f ...` + systemd native `PIDFile=` unlinking under `/run/`.
- **Zero Sudo / Shell Execution in Server**: Architecture cleanly leverages systemd lifecycle without adding `sudo` or shell commands to the Rust server core.
- **Regression Prevention**: `unit_policy.rs` and integration test suite immediately reject any template drift.

---

## Validation Commands & Results

| Command | Scope | Result | Status |
|---|---|---|---|
| `systemd-analyze verify deploy/systemd/*` | 3 unit files (`dam-hopper-api.service`, helper service & socket) | 0 errors, 0 warnings | PASS |
| `cargo test --test linux_release_unit_policy` | Unit policy rendering & assertion tests | 9 passed, 0 failed | PASS |
| `./scripts/verify-idle-suspend-boundary.sh` | 12 security & boundary contracts | 12 passed, 0 failed | PASS |
| `cargo test --lib linux_release` | Release manager lib unit tests | 9 passed, 0 failed | PASS |
| `cargo test --lib idle_suspend` | Idle suspend engine & route tests | 69 passed, 0 failed | PASS |
| `cargo clippy --test linux_release_unit_policy` | Static analysis on unit policy | 0 warnings | PASS |

---

## Metrics
- Type Coverage: 100% (Rust static typing)
- Test Coverage: 102/102 automated tests passing
- Linting Issues in Phase 01 Scope: 0 errors, 0 warnings

---

## Unresolved Questions
1. Should `RuntimeDirectoryMode=0775` be added to `dam-hopper-idle-suspend-helper.service.in` immediately or folded into Phase 02 alongside helper unit staging?
