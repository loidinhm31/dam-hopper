# Code Review: Phase 02 Release Manager Unit Staging (`stage_units.rs`)

**Date:** 2026-09-09  
**Reviewer:** Phase02Reviewer-2  
**Plan:** `plans/260909-1836-production-idle-suspend-cli-setup/phase-02-release-manager-unit-staging.md`  
**Score:** 9.5 / 10  

---

## Code Review Summary

### Scope
- Files reviewed:
  - `server/src/linux_release/constants.rs`
  - `server/src/linux_release/stage_units.rs`
  - `server/src/linux_release/unit.rs`
  - `server/src/linux_release/unit_policy.rs`
  - `server/src/linux_release/inventory_validation.rs`
  - `server/src/linux_release/mod.rs`
  - `server/tests/linux_release_unit_policy.rs`
  - `server/tests/common/release_fixtures.rs`
  - `server/tests/linux_release_staging.rs`
- Lines of code analyzed: ~680 LOC
- Review focus: Phase 02 Release Manager unit staging, dynamic template rendering, token validation, systemd sandbox invariants, policy enforcement, test fixtures, and staging isolation.
- Updated plans:
  - `plans/260909-1836-production-idle-suspend-cli-setup/phase-02-release-manager-unit-staging.md` (Implementation Status: Complete, Review Status: Complete, 4/4 TODO items checked)
  - `plans/260909-1836-production-idle-suspend-cli-setup/plan.md` (Phase 02 status: DONE)
  - `plans/260909-1836-production-idle-suspend-cli-setup/cmd-plan.md` (Phase 02 status: DONE 100%)

### Overall Assessment
Implementation cleanly satisfies Phase 02 acceptance criteria. `dam-hopper-idle-suspend-helper.service` is dynamically rendered, validated against strict systemd unit policies, and staged to `pending_units` whenever release role includes server (`TargetRole::Server` or `TargetRole::Both`). All staged units are passed to `systemd_analyze_verify` before commit. Allowlisted tokens (`@RELEASE_ROOT@`, `@API_GROUP@`) are substituted securely with full injection defense (control char and character set rejection). Scoped tests pass 100%.

---

## Critical Issues (MUST FIX)
None. No security vulnerabilities, regression risks, or breaking changes identified within Phase 02 scope.

---

## Warnings (SHOULD FIX)

### 1. Missing `HELPER_SERVICE_UNIT` in `activate.rs` Handshake (Phase 03 Requirement)
- **Severity**: High (Cross-Phase Lifecycle Gap)
- **Location**: `server/src/linux_release/activate.rs:409-422` & `constants.rs:56`
- **Issue**: `stage_candidate_units` places `dam-hopper-idle-suspend-helper.service` in `pending_units_dir`. However, `activate.rs:410` currently matches only:
  ```rust
  API_SERVICE_UNIT | WEB_SERVICE_UNIT | RECOVERY_SERVICE_UNIT => {
      install_unit_file(&path, &layout.systemd_unit_dir)?;
  }
  ```
  Any unrecognized pending unit triggers `ReleaseError::InvalidBundle { reason: "unexpected pending unit entry..." }`. Furthermore, `constants.rs:56` defines `ALL_SERVICE_UNITS: &[&str] = &[API_SERVICE_UNIT, WEB_SERVICE_UNIT, RECOVERY_SERVICE_UNIT];`, which omits `HELPER_SERVICE_UNIT`. This means `backup_unit_files(ALL_SERVICE_UNITS, ...)` will not back up the helper unit, and rollback/recovery won't stop it.
- **Recommendation for Phase 03**: Phase 03 (`activate.rs`, `rollback.rs`, `recover.rs`) MUST:
  1. Update `ALL_SERVICE_UNITS` to include `HELPER_SERVICE_UNIT` (or handle helper backup/rollback explicitly).
  2. Add `HELPER_SERVICE_UNIT` to `activate.rs:410` match arm for installation into `/etc/systemd/system/`.

### 2. `bin/dam-hopper-idle-suspend-helper` Omitted in Inventory Validation
- **Severity**: Medium (Integrity Risk)
- **Location**: `server/src/linux_release/inventory_validation.rs:88-175`
- **Issue**: `inventory_validation.rs` validates `systemd/dam-hopper-idle-suspend-helper.service` (regular file, Server role), but `bin/dam-hopper-idle-suspend-helper` falls through `_ => {}` in `RequiredPathsTracker::check_entry`. If a malformed bundle contains the helper binary with non-executable mode (e.g. `0644`) or wrong role (e.g. `ReleaseRole::Web`), inventory validation passes, but execution fails at runtime with exit code 203/EXEC (`Permission denied`).
- **Recommendation**: Add validation arm in `RequiredPathsTracker::check_entry`:
  ```rust
  "bin/dam-hopper-idle-suspend-helper" => {
      if entry.kind != EntryKind::File
          || !entry.roles.contains(&ReleaseRole::Server)
          || entry.mode & 0o111 == 0
      {
          return Err(ReleaseError::InvalidRequiredPath {
              path: "bin/dam-hopper-idle-suspend-helper",
          });
      }
  }
  ```
  (Keep optional in `assert_complete()` for backwards compatibility with older releases).

---

## Suggestions (NICE TO HAVE)

### 1. Assert `AmbientCapabilities` in `validate_helper_unit_policy`
- **Location**: `server/src/linux_release/unit_policy.rs:94-128`
- **Context**: The helper template contains `AmbientCapabilities=` to strip ambient capabilities from child processes.
- **Suggestion**: Add `assert_eq_prop(unit, name, "Service", "AmbientCapabilities", "")?` or verify it is not non-empty to ensure accidental capabilities cannot be passed down.

### 2. Guard Against Cross-Service Coupling in Helper Unit
- **Location**: `server/src/linux_release/unit_policy.rs:94-128`
- **Context**: `validate_api_unit_policy` checks `if unit.has_coupling("web") { ... }`.
- **Suggestion**: Add a similar check in `validate_helper_unit_policy` to verify helper unit never introduces dependencies to `web` or other unprivileged units.

### 3. Use Unit Constants in `stage_units.rs` (DRY)
- **Location**: `server/src/linux_release/stage_units.rs:155,167,191`
- **Context**: `stage_units.rs` uses string literals `"dam-hopper-api.service"`, `"dam-hopper-recovery.service"`, and `"dam-hopper-web.service"` while using `HELPER_SERVICE_UNIT`.
- **Suggestion**: Use `API_SERVICE_UNIT`, `RECOVERY_SERVICE_UNIT`, and `WEB_SERVICE_UNIT` from `constants.rs` uniformly.

---

## Positive Observations
1. **Strict Sandboxing Policy**: `validate_helper_unit_policy` enforces 19 directives including `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, and `CapabilityBoundingSet=CAP_WAKE_ALARM`.
2. **Robust Token Replacement & Defense-in-Depth**: Pre-scan and post-scan in `render_unit` reject unexpected tokens and ensure 0 unresolved placeholders. Control characters and illegal identity characters fail closed.
3. **Role-Aware Staging**: Helper unit is conditionally staged only when `role.includes_server()`. Web-only installs cleanly omit it.
4. **Safe Fallback Handling**: `allow_checked_in_fallback` enables backwards compatibility for transitions while release staging enforces production presence.
5. **High Test Quality**: Fixture generation and unit policy tests cover success paths, role variations, and injection edge cases.

---

## Validation Commands & Results

| Command | Scope | Result | Status |
|---|---|---|---|
| `systemd-analyze verify deploy/systemd/*.service deploy/systemd/*.socket` | 4 systemd services, 1 socket | 0 errors, 0 warnings | PASS |
| `cargo test --manifest-path server/Cargo.toml --test linux_release_unit_policy` | Unit policy rendering & staging assertions | 10 passed, 0 failed (0.23s) | PASS |
| `cargo test --manifest-path server/Cargo.toml --test linux_release_staging` | Staging lifecycle and role isolation | 6 passed, 0 failed (0.21s) | PASS |
| `./scripts/verify-idle-suspend-boundary.sh` | 12 security & boundary contracts | 12 passed, 0 failed (0.08s) | PASS |

---

## Metrics
- Type Coverage: 100% (Rust static typing)
- Test Coverage: 16/16 scoped integration tests passing (100% pass rate)
- Linting Issues in Phase 02 Scope: 0 errors, 0 warnings

---

## Unresolved Questions
1. Should `dam-hopper-idle-suspend-helper.socket` (socket activation) be retained in `deploy/systemd/` as legacy/alternative, or should it be removed now that the standalone daemon architecture (`dam-hopper-idle-suspend-helper.service`) is the approved design?
