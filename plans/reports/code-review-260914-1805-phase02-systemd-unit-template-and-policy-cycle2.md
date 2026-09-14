# Code Review: Phase 02 — Systemd Unit Template, Checked-in Unit, and Unit Policy (Cycle 2)

**Date:** 2026-09-14  
**Reviewer:** Phase02Reviewer2  
**Score:** 10/10  

## Code Review Summary

### Scope
- **Files reviewed:**
  - `server/src/linux_release/unit_policy.rs`
  - `server/tests/linux_release_unit_policy.rs`
  - `server/tests/linux_release_staging.rs`
  - `deploy/systemd/dam-hopper-api.service.in`
  - `deploy/systemd/dam-hopper-api.service`
  - `plans/260914-0854-system-daemon-state-config/phase-02-systemd-unit-template-checked-in-unit-and-policy.md`
  - `plans/260914-0854-system-daemon-state-config/plan.md`
- **Lines of code analyzed:** ~420 lines across touched source, templates, and integration test suites.
- **Review focus:** Verification of cycle 1 feedback resolution, exact equality and single `ExecStart` enforcement, negative policy testing, checked-in unit drift detection, staging assertions, and unit contract preservation.
- **Updated plans:**
  - `plans/260914-0854-system-daemon-state-config/phase-02-systemd-unit-template-checked-in-unit-and-policy.md` (Status: complete, all checklist items verified)
  - `plans/260914-0854-system-daemon-state-config/plan.md` (Phase 02 marked DONE, next step updated to Phase 03)

### Overall Assessment
Cycle 2 implementation completely addresses all previous cycle suggestions. The codebase is in exemplary condition:
1. `validate_api_unit_policy` enforces single `ExecStart` check (`unit.get_all_values("Service", "ExecStart").len() != 1`) and exact match against `{ctx.release_root}/bin/dam-hopper-server --config {ctx.api_home}/dam-hopper.toml --host 0.0.0.0 --port 4801`.
2. Negative policy tests are clearly isolated: `test_api_unit_policy_rejects_duplicate_execstart` and `test_api_unit_policy_rejects_legacy_etc_config_path` run separately with distinct diagnostic assertions.
3. Automated checked-in unit drift test (`test_checked_in_api_unit_passes_policy_and_omits_legacy_path`) confirms checked-in unit properties, single `ExecStart`, single `ExecStartPre`, absence of `StateDirectory*`, absence of `/etc/dam-hopper/dam-hopper.toml`, and exact presence of `/var/lib/dam-hopper/dam-hopper.toml`.
4. Staging assertions verify staged candidate units on disk for canonical path, absence of legacy path, and zero unrendered `@` tokens.
5. All systemd unit contracts, prestart privilege, non-root user/group, and security hardening directives are preserved without regression.

---

## Detailed Check Verification

### 1. Exact Equality and Single ExecStart Enforcement
- `unit.get_all_values("Service", "ExecStart").len() != 1` rejects multiple or missing `ExecStart` directives with `ReleaseError::UnitPolicyViolation`.
- `expected_exec` dynamically formatted with `ctx.release_root` and `ctx.api_home`:
  `{}/bin/dam-hopper-server --config {}/dam-hopper.toml --host 0.0.0.0 --port 4801`
- `assert_eq_prop(unit, name, "Service", "ExecStart", &expected_exec)` enforces strict string equality.
- Any extraneous arguments, path deviations, or shell escapes rejected immediately.

### 2. Positive and Negative Policy Assertions in `render_api_unit` Tests
- `test_render_api_unit_success`:
  - `parsed.get_all_values("Service", "ExecStart")` matches `vec![expected_exec.as_str()]`.
  - Canonical positive assertion: `assert!(rendered.contains("/var/lib/dam-hopper/dam-hopper.toml"))`.
  - Legacy negative assertion: `assert!(!rendered.contains("/etc/dam-hopper/dam-hopper.toml"))`.
  - Unrendered token assertion: `assert!(!rendered.contains('@'))`.
- `test_api_unit_identity_and_start_gate_are_single_and_final`:
  - Enforces `parsed.get_all_values("Service", "ExecStart").len() == 1`.

### 3. Negative Policy Tests for Legacy Path and Duplicate Directives
- `test_api_unit_policy_rejects_duplicate_execstart`:
  - Injects second `ExecStart` directive.
  - Verifies rejection with `UnitPolicyViolation` matching `"ExecStart"`.
- `test_api_unit_policy_rejects_legacy_etc_config_path`:
  - Replaces `--config @API_HOME@/dam-hopper.toml` with `--config /etc/dam-hopper/dam-hopper.toml`.
  - Verifies rejection with `UnitPolicyViolation` matching `"ExecStart"`.

### 4. Checked-in Unit Drift and Legacy Omission Test
- `test_checked_in_api_unit_passes_policy_and_omits_legacy_path`:
  - Parses `deploy/systemd/dam-hopper-api.service`.
  - Asserts single `ExecStart` points to `/var/lib/dam-hopper/dam-hopper.toml`.
  - Asserts `ExecStartPre` matches canonical privileged manager provisioner.
  - Verifies `User=dam-hopper`, `Group=dam-hopper`.
  - Verifies absence of `StateDirectory` and `StateDirectoryMode`.
  - Asserts `Type=exec`, `WorkingDirectory=/var/lib/dam-hopper`, `UMask=0077`, `PIDFile=/run/dam-hopper/server.pid`, `Restart=on-failure`, `RestartSec=5s`, `KillSignal=SIGTERM`, `KillMode=mixed`, `TimeoutStopSec=20s`, `NoNewPrivileges=false`, `SyslogIdentifier=dam-hopper-api`.
  - Asserts absence of `/etc/dam-hopper/dam-hopper.toml` in both checked-in unit and template.
  - Asserts presence of `/var/lib/dam-hopper/dam-hopper.toml` in checked-in unit and `@API_HOME@/dam-hopper.toml` in template.

### 5. Staging Assertions for Canonical Path
- `test_staging_fresh_install_success`:
  - Reads staged `dam-hopper-api.service` in temporary pending units transaction folder.
  - Asserts `parsed_api.get_all_values("Service", "ExecStart")` matches canonical command under dynamic role release root.
  - Asserts canonical path present, legacy path absent, zero `@` tokens.
- `test_staging_helper_unit_and_pidfile_content`:
  - Asserts single `ExecStart` in staged API unit.
  - Asserts canonical path present, legacy path absent, zero `@` tokens.

### 6. Unit Contract Preservation
- **ExecStartPre**: Exactly one `ExecStartPre=+@RELEASE_ROOT@/bin/dam-hopper-manager provision-api-runtime` retained with root privilege `+`.
- **Identity**: Single non-root `User=@API_USER@` and `Group=@API_GROUP@` required and verified.
- **StateDirectory**: `StateDirectory` and `StateDirectoryMode` forbidden to avoid race with descriptor-relative provisioning.
- **Hardening**: `UMask=0077`, `NoNewPrivileges=false`, `KillSignal=SIGTERM`, `KillMode=mixed`, `TimeoutStopSec=20s`, `RuntimeDirectory=dam-hopper`, `PIDFile=/run/dam-hopper/server.pid`, `ExecStartPost`, `ExecStopPost`, `Restart=on-failure`, `RestartSec=5s`, and environment files preserved.

### 7. YAGNI / KISS / DRY Principles
- **YAGNI**: No speculative CLI configuration parameters, shell shims, or fallback chains.
- **KISS**: String interpolation, direct exact match policy, clean test separation.
- **DRY**: Reuses existing `@API_HOME@` token. Single policy source of truth in `validate_api_unit_policy`.

---

## Critical Issues
None.

## Warnings
None.

## Suggestions
None. All prior suggestions successfully resolved.

---

## Reviewed Files
- `server/src/linux_release/unit_policy.rs`
- `server/tests/linux_release_unit_policy.rs`
- `server/tests/linux_release_staging.rs`
- `deploy/systemd/dam-hopper-api.service.in`
- `deploy/systemd/dam-hopper-api.service`
- `plans/260914-0854-system-daemon-state-config/phase-02-systemd-unit-template-checked-in-unit-and-policy.md`
- `plans/260914-0854-system-daemon-state-config/plan.md`

## Validation Commands and Results
- `cd server && cargo test -p dam-hopper-server --test linux_release_unit_policy`:
  - Results: 20 passed; 0 failed; 0 ignored (0.25s)
- `cd server && cargo test -p dam-hopper-server --test linux_release_staging`:
  - Results: 9 passed; 0 failed; 0 ignored (0.28s)
- Total tests executed and passed: 29/29

## Unresolved Questions
None.
