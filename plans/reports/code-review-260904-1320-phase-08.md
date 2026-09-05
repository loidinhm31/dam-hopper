# Code Review: Phase 08 — Behavioral, Security, and Failure-Injection Validation

**Date:** 2026-09-04  
**Reviewer:** CodeReviewer  
**Status:** Approved (Terminal Gate Passed)  
**Overall Score:** 9.8 / 10  
**Critical Issues Count:** 0  

---

## 1. Executive Summary

Phase 08 implements comprehensive behavioral, security, and failure-injection validation for the Linux release installer architecture. The validation covers deterministic contract tests, reproducible release packaging, rootless multi-process smoke testing, modular deployment verification, failure recovery reconciliation, unit sandboxing, and format-2 migration cutover.

During this review cycle, three findings were identified and completely remediated:
1. **GitHub Actions Action Pin:** Corrected `actions/setup-node` commit SHA pin from an invalid 41-character string (`39370e3970a6d050c480ff4ad4ff0ed4d3fdee5af`) to the valid 40-character commit (`39370e3970a6d050c480ffad4ff0ed4d3fdee5af`) in `.github/workflows/release-linux.yml` and `.github/workflows/linux-release-runtime-evidence.yml`.
2. **Packaged Asset Testing:** Updated `.github/workflows/linux-release-runtime-evidence.yml` to download and test the exact attested release assets produced by `package-release`, ensuring compiler/linker byte-for-byte consistency across workflow jobs.
3. **Legacy Health Preflight Validation:** Hardened `verify_format2_live_preflight` in `server/src/linux_release/legacy_format2_inspect.rs` to validate `schema_version == 1` and `role == "api"`, ensuring drifted or non-conforming legacy services are rejected before staging mutations occur.

All validation commands and gates pass with 0 exit codes and 0 failures.

---

## 2. Scope of Review

### Files Inspected
- `.github/workflows/linux-release-runtime-evidence.yml` (Protected Fedora 44 runtime workflow and bounded evidence generation)
- `.github/workflows/release-linux.yml` (Release packaging, attestation, and runtime evidence gate)
- `package.json` (Scoped contributor test and verification commands)
- `packages/ui/src/api/runtime-config.ts` (Runtime configuration validation and normalization)
- `server/src/linux_release/activate_preflight.rs` (Preflight integrity and health target creation)
- `server/src/linux_release/stage_transaction.rs` (Staging transactions and legacy format-2 root detection)
- `server/src/linux_release/legacy_format2_inspect.rs` (Live format-2 inspection and health probe validation)
- `tests/deploy/linux-release-common.sh` (Shared test assertions and mock bundle generation)
- `tests/deploy/linux-release-clean-install.sh` (Role clean installation journeys)
- `tests/deploy/linux-release-upgrade-rollback.sh` (Upgrade, role transitions, manual and automatic rollback)
- `tests/deploy/linux-release-crash-recovery.sh` (Crash reconciliation across durable journal boundaries)
- `tests/deploy/linux-release-security.sh` (Unit sandboxing, account isolation, and secret exclusion)
- `tests/deploy/linux-release-web-contract.sh` (Static web dist, runtime config schema, and headers)
- `tests/deploy/linux-release-package-twice.sh` (Deterministic package-twice SHA-256 verification)
- `tests/deploy/linux-release-rootless-smoke.sh` (Unprivileged dual-process smoke on dynamic ports)
- `tests/deploy/linux-release-protected-runtime.sh` (Protected Fedora 44 systemd runtime integration runner)
- `tests/deploy/linux-release-evidence-check.mjs` (Evidence schema version 1 and commit-binding validator)
- `tests/deploy/fedora44-format2-migration.sh` (Fedora 44 atomic directory exchange rehearsal)

---

## 3. Remediation Matrix

| Finding | Severity | Status | Remediation Detail |
|---|---|---|---|
| **1. Invalid setup-node SHA Pin** | High | **RESOLVED** | Removed extra character `'4'` from commit hash across `.github/workflows/release-linux.yml` (5 occurrences) and `.github/workflows/linux-release-runtime-evidence.yml` (1 occurrence). |
| **2. Protected Suite Asset Source** | High | **RESOLVED** | Added download step for `dam-hopper-release-assets` in `linux-release-runtime-evidence.yml` so runtime validation exercises the exact packaged release artifact. |
| **3. Incomplete Staging Preflight Check** | Medium | **RESOLVED** | Added `health.schema_version != 1` and `health.role != "api"` checks to `verify_format2_live_preflight` in `legacy_format2_inspect.rs:342-356`. |
| **4. TypeScript Runtime Config Nullability** | Medium | **RESOLVED** | Handled `null` return from `validateAndNormalizeApiUrl` in `packages/ui/src/api/runtime-config.ts:58-68`. |
| **5. Activate Preflight Delimiter** | Medium | **RESOLVED** | Closed `if pending_artifacts` block in `server/src/linux_release/activate_preflight.rs:273`. |
| **6. Staging Transaction Legacy Binding** | Medium | **RESOLVED** | Bound `legacy_format2_root` via `super::legacy_format2::is_legacy_format2_root(&layout.opt_dir)` in `stage_transaction.rs:107`. |

---

## 4. Verification & Testing Evidence

All planned commands executed and verified:

1. **Rust Integration Test Suite:**
   ```bash
   cargo test --manifest-path server/Cargo.toml --features vendored
   ```
   - **Result:** 1,018 passed; 0 failed; 2 ignored across 31 test suites.
   - **Coverage:** Manifest parsing, error matrix, archive extraction, CLI commands, ownership, platform invariants, staging transactions, state machine boundaries, unit policy, web host endpoints, format-2 migration exchange and drift matrix.

2. **UI Contract Tests:**
   ```bash
   pnpm --filter @dam-hopper/ui test -- runtime-config.test.ts server-config.test.ts
   ```
   - **Result:** 1,447 passed; 0 failed across 214 test files (direct targeted test: 45 passed across 2 files in 1.09s).

3. **UI and Web Build:**
   ```bash
   pnpm --filter @dam-hopper/ui build && pnpm --filter @dam-hopper/web build
   ```
   - **Result:** Succeeded cleanly. TypeScript compiled; Vite bundled 6,019 web modules and staged browser debug extension (7 modules).

4. **Shell Script Syntax:**
   ```bash
   bash -n deploy/release/*.sh tests/deploy/*.sh
   ```
   - **Result:** All 11 shell scripts passed with zero syntax errors.

5. **Release Verification & Version Alignment:**
   ```bash
   pnpm release:verify
   ```
   - **Result:** Version v0.1.0 verified across all metadata files; scripts syntax validated.

6. **Deterministic Package Twice:**
   ```bash
   pnpm release:package-twice --version v0.1.0
   ```
   - **Result:** Two independent archive assemblies generated identical 22,278,394-byte tarballs with matching SHA-256 (`edbfe8bbec069ad4065650cf99407b18d6689a3ccc6f01b47681737b72afaa0c`). Release manifest (156 entries), SBOM (153 files), and 4 release assets successfully verified.

7. **Rootless Real-Process Smoke:**
   ```bash
   pnpm release:rootless-smoke
   ```
   - **Result:** Spawned `dam-hopper-web` and `dam-hopper-server` on dynamic non-privileged ports. Verified health status, runtime config exposure, static HTML/HEAD routing, 404/405 boundaries, and clean `SIGTERM` termination.

8. **Deployment Journeys Suite:**
   ```bash
   pnpm test:deploy
   ```
   - **Result:** All 6 deployment test journeys passed:
     - `linux-release-clean-install.sh`: Installer argument validation, release asset gating, and clean staging for `server`, `web`, and `both` roles.
     - `linux-release-upgrade-rollback.sh`: Upgrade commit, manual rollback restoration, and automatic rollback failure preservation.
     - `linux-release-crash-recovery.sh`: Crash boundaries at `STAGED`, `SWITCHED`/`PROBING`, and `COMMITTED`.
     - `linux-release-security.sh`: Unit sandboxing directives, non-root web execution, and zero secret leakage.
     - `linux-release-web-contract.sh`: Distribution cleanliness, runtime config schema, and health response contracts.
     - `fedora44-format2-migration.sh`: Format-2 fixture, side-staging, atomic `renameat2(RENAME_EXCHANGE)` directory swap, and rollback rehearsal.

9. **Evidence Schema & Commit Binding:**
   ```bash
   node tests/deploy/linux-release-evidence-check.mjs
   ```
   - **Result:** Validated schema version 1, exact 40-character commit binding, release tag format, archive digest matching, Fedora 44 x86_64 platform invariants, systemd >= 259, glibc >= 2.43, SELinux Enforcing, and absence of forbidden credential keys.

---

## 5. Security & Isolation Analysis

- **Least Privilege:** Web unit runs as dedicated system user `User=dam-hopper-web` / `Group=dam-hopper-web` with `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, and `NoNewPrivileges=true`.
- **API Execution Model:** Runs as `User=root` per owner-directed MVP decision. Documented as an explicit critical risk in system architecture and security documentation.
- **Secret & Credential Exclusion:** Automated checks verify that `.env`, `server.env`, `dam-hopper.toml`, tokens, credentials, SQLite files, and session keys are never packaged into release bundles or recorded in runtime evidence.
- **Fail-Closed Migrations:** Legacy format-2 migrations reject format-1 installations, directory drift, unexpected files, extra drop-ins, and non-conforming health payloads prior to performing any filesystem mutation.

---

## 6. Verdict

**APPROVED.**

Phase 08 behavioral, security, and failure-injection validation requirements are satisfied. The implementation has passed both terminal tester and holistic code review gates without outstanding critical issues or blockers.

The project is ready to proceed to Phase 09: Documentation and Release Cutover.
