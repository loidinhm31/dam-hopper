# Code Review: Phase 02 — Systemd unit template, checked-in unit, and unit policy

**Date:** 2026-09-14  
**Reviewer:** Phase02Reviewer  
**Score:** 10/10  

## Code Review Summary

### Scope
- **Files reviewed:**
  - `server/src/linux_release/unit_policy.rs`
  - `server/tests/linux_release_unit_policy.rs`
  - `server/tests/linux_release_staging.rs`
  - `deploy/systemd/dam-hopper-api.service.in`
  - `deploy/systemd/dam-hopper-api.service`
- **Lines analyzed:** ~380 lines across touched files and staging integration.
- **Review focus:** Canonical API unit path cutover, single ExecStart policy enforcement, negative policy testing, unit hardening contract preservation, and staging verification.
- **Updated plans:**
  - `plans/260914-0854-system-daemon-state-config/phase-02-systemd-unit-template-checked-in-unit-and-policy.md`
  - `plans/260914-0854-system-daemon-state-config/plan.md`

### Overall Assessment
Phase 02 implementation is clean, robust, and completely adheres to architectural and security contracts:
1. Exact equality and single `ExecStart` enforcement in `validate_api_unit_policy` prevents duplicate directives, option tampering, and shell injection.
2. Template rendering reuses allowlisted `@API_HOME@` (`/var/lib/dam-hopper`), satisfying DRY without new token churn.
3. Unit template, checked-in unit, unit policy, and staging tests agree on `/var/lib/dam-hopper/dam-hopper.toml`.
4. Staging assertions verify that staged units contain the canonical path, omit legacy paths, and leave no unexpanded tokens.
5. All systemd unit contracts (prestart privilege, non-root identity, forbidden StateDirectory, hardening directives) remain intact.

---

## Detailed Check Verification

### 1. Exact Equality and Single ExecStart Enforcement
- `unit.get_all_values("Service", "ExecStart").len() != 1` rejects zero or duplicate `ExecStart` directives with `ReleaseError::UnitPolicyViolation`.
- `expected_exec` formatted with `ctx.release_root` and `ctx.api_home`:
  `{ctx.release_root}/bin/dam-hopper-server --config {ctx.api_home}/dam-hopper.toml --host 0.0.0.0 --port 4801`
- `assert_eq_prop` enforces exact string equality; forbids extra arguments, alternate flags, and unmanaged config paths.
- `ctx.api_home` is validated against `API_SERVICE_HOME` (`/var/lib/dam-hopper`) during context construction.

### 2. Positive and Negative Policy Assertions
- `test_render_api_unit_success`:
  - Asserts parsed `Service.ExecStart` matches canonical expected command.
  - Positive assertion: `assert!(rendered.contains("/var/lib/dam-hopper/dam-hopper.toml"))`.
  - Negative assertion: `assert!(!rendered.contains("/etc/dam-hopper/dam-hopper.toml"))`.
  - Unexpanded token assertion: `assert!(!rendered.contains('@'))`.
- `test_api_unit_identity_and_start_gate_are_single_and_final`:
  - Asserts `parsed.get_all_values("Service", "ExecStart").len() == 1`.

### 3. Negative Policy Tests for Legacy Path and Duplicate Directives
- `test_api_unit_policy_rejects_legacy_etc_config_path`:
  - Replaces `--config @API_HOME@/dam-hopper.toml` with `--config /etc/dam-hopper/dam-hopper.toml`.
  - Asserts render fails with `ReleaseError::UnitPolicyViolation` matching `"ExecStart"`.
- `test_api_unit_policy_rejects_state_directory_and_duplicate_prestart`:
  - Injects duplicate `ExecStart` directive into template.
  - Asserts render fails with `ReleaseError::UnitPolicyViolation` matching `"ExecStart"`.

### 4. Staging Assertions for Canonical Path
- `test_staging_fresh_install_success`:
  - Parses staged API unit in candidate transaction directory.
  - Asserts `parsed_api.get_all_values("Service", "ExecStart")` equals expected command.
  - Asserts presence of canonical path, absence of legacy path, and absence of `@` tokens.
- `test_staging_helper_unit_and_pidfile_content`:
  - Asserts single `ExecStart` in staged API unit.
  - Asserts canonical path present, legacy path absent, and no `@` tokens.

### 5. Unit Contract Preservation
- **ExecStartPre**: Exactly one `ExecStartPre=+@RELEASE_ROOT@/bin/dam-hopper-manager provision-api-runtime` retained with root privilege `+`.
- **Identity**: Single non-root `User=@API_USER@` and `Group=@API_GROUP@` enforced.
- **StateDirectory**: `StateDirectory` and `StateDirectoryMode` absent and strictly rejected by policy to protect descriptor-relative provisioning.
- **Hardening**: `UMask=0077`, `NoNewPrivileges=false`, `KillSignal=SIGTERM`, `KillMode=mixed`, `TimeoutStopSec=20s`, `RuntimeDirectory=dam-hopper`, `PIDFile=/run/dam-hopper/server.pid`, `Restart=on-failure`, `RestartSec=5s`, and `EnvironmentFile` inputs preserved.

### 6. YAGNI / KISS / DRY Principles
- **YAGNI**: No extra config fallback flags or redundant unit wrappers.
- **KISS**: Plain format string construction and exact string equality checks.
- **DRY**: Reused existing `@API_HOME@` token across `WorkingDirectory`, `Environment=HOME`, `Environment=XDG_CONFIG_HOME`, and `ExecStart`.

---

## Critical Issues
None.

## Warnings
None.

## Suggestions
1. **Automated Checked-in Unit Drift Test**: Consider adding an automated integration test in `linux_release_unit_policy.rs` that verifies `deploy/systemd/dam-hopper-api.service` passes `validate_api_unit_policy` under standard production context (`/opt/dam-hopper/current`, `dam-hopper:dam-hopper`).
2. **Test Granularity**: `test_api_unit_policy_rejects_state_directory_and_duplicate_prestart` tests three separate rejections (StateDirectory, duplicate ExecStartPre, duplicate ExecStart). Renaming or splitting this test in future cleanups would make failure diagnostics more direct.

---

## Reviewed Files
- `server/src/linux_release/unit_policy.rs`
- `server/tests/linux_release_unit_policy.rs`
- `server/tests/linux_release_staging.rs`
- `deploy/systemd/dam-hopper-api.service.in`
- `deploy/systemd/dam-hopper-api.service`

## Validation Commands and Results
- `cd server && cargo test -p dam-hopper-server --test linux_release_unit_policy`:
  - Passed: 18/18 (0.24s)
- `cd server && cargo test -p dam-hopper-server --test linux_release_staging`:
  - Passed: 9/9 (0.28s)
- Total tests executed and passed: 27/27

## Unresolved Questions
None.
