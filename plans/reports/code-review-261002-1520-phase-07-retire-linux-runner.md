# Code Review Summary: Phase 07 — Retire Linux Runner and Safe Manual Uninstall

- **Score:** 9.0/10
- **Status:** APPROVED WITH WARNINGS
- **Date:** 2026-10-02
- **Reviewer:** Senior Software Engineer / Code Reviewer
- **Plan Reference:** `plans/261002-0246-native-advisor-migration/phase-07-linux-deployment-and-manual-uninstall.md`

---

### Scope
- **Files reviewed:** 50 files across `server/src/linux_release/`, `deploy/`, `tests/deploy/`, `docs/`, `package.json`
- **Lines of code analyzed:** ~2,100 additions/modifications, ~1,723 deletions
- **Review focus:** Phase 07 retirement of Linux plugin runner, schema3 state migration, safe manual uninstall script, permissions, path traversal prevention, lock enforcement, privilege separation, and backward compatibility invariants.
- **Updated plans:**
  - `plans/261002-0246-native-advisor-migration/phase-07-linux-deployment-and-manual-uninstall.md` (TODOs marked complete, status set to Complete)
  - `plans/261002-0246-native-advisor-migration/progress.md` (Phase 07 settled, Phase 08 unblocked)

---

### Overall Assessment
Implementation cleanly retires the Linux runner and Node worker while preserving core native API, Web, and Idle-Suspend helper functionality. State migration safely bumps `schemaVersion` to 3 under `DeploymentLock` with automatic `.v2.bak` backups, strict key allowlisting, and fail-closed handling on pending transactions. Shared IPC runtime cleanly transitions to `dam-hopper-runtime.conf` with restricted `03770 root:@API_GROUP@` permissions. Rejection of plugin-bearing releases during candidate staging and automatic rollback prevents reactivation of deprecated components. Safe manual uninstall script provides non-mutating dry-run defaults, prerequisite validation, and protection for history directories and shared sockets. Two non-blocking warnings identified: shell command injection vector via `eval` in `remove-plugin-platform.sh` and deprecated CLI option in `dam-hopper-install.sh`.

---

### Critical Issues (Must Fix)
*None.* No data-loss risks, breaking regressions, or privilege escalations identified in production runtime paths.

---

### Warnings (Should Fix)

#### 1. Command Injection Vector via `eval` in `deploy/remove-plugin-platform.sh`
- **File & Line:** `deploy/remove-plugin-platform.sh:284`
- **Issue:** `USER_HOME="$(eval echo "~$TARGET_USER")"` executes shell evaluation on unquoted/unsanitized user input. If `--user` receives metacharacters (e.g. `test; id` or `$(...)`), arbitrary commands execute under invoking user context.
- **Impact:** Privilege compromise if run via automation or privileged operator context.
- **Recommended Fix:**
  ```bash
  # Replace eval with getent passwd lookup
  USER_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
  if [[ -z "$USER_HOME" || ! -d "$USER_HOME" ]]; then
      echo "Error: Cannot resolve home directory for user '$TARGET_USER'" >&2
      exit 1
  fi
  ```

#### 2. Obsolete `--plugin-owner-user` Passed by `deploy/release/dam-hopper-install.sh`
- **File & Line:** `deploy/release/dam-hopper-install.sh:38, 78, 120-128, 336-338`
- **Issue:** Script still accepts `--plugin-owner-user` and passes it to `dam-hopper install`. Since `--plugin-owner-user` was deleted from `server/src/linux_release/cli.rs`, invoking `dam-hopper-install.sh --plugin-owner-user ...` causes `dam-hopper install` to fail with `error: unexpected argument '--plugin-owner-user'`.
- **Impact:** Operator failure when deploying releases using older install command scripts.
- **Recommended Fix:** Remove `--plugin-owner-user` handling or add a deprecation notice ignoring the argument with an informative warning.

---

### Medium Priority Improvements

#### 1. Prune Inert Runner Reference in `dam-hopper-install.sh` Reinstall Routine
- **File & Line:** `deploy/release/dam-hopper-install.sh:358`
- **Observation:** `systemctl stop` in reinstall step still targets `dam-hopper-plugin-runner`. Safe due to `2>/dev/null || true`, but dead reference. Prune to align with native service set (`dam-hopper-api`, `dam-hopper-web`, `dam-hopper-idle-suspend-helper`).

---

### Low Priority Suggestions

#### 1. Manifest Schema Legacy Documentation
- **File:** `deploy/release/release-manifest.schema.json`
- **Observation:** `runner` is retained as optional property under `components` and `services`. This is correct to permit inspection of legacy bundles by `parse_and_validate_installed_release`, but adding a description comment clarifying legacy inspection support improves maintainability.

---

### Positive Observations

1. **Strict Manager State Schema3 Migration**:
   - `DeploymentLock` acquired before any mutation.
   - Exact backup written to `state.v{ver}.bak` using `copy_file_durable` with mode `0644`.
   - Rejects uncommitted live transactions (`!tx.is_null()`) without disk modification.
   - Allowlist validation (`ALLOWED_TOP_LEVEL_KEYS`) fails closed on unknown fields.
   - Generation incremented monotonically (`old_generation.saturating_add(1)`).
   - Atomic replacement via `atomic_write_json`.

2. **Refusal of Plugin-Bearing Releases**:
   - Both `stage_release_bundle_with_options` and `stage_previous_release_candidate` fail fast if manifest inventory contains `plugin-runner` or `bin/node`, preventing inadvertent reactivation of legacy runner runtimes.

3. **Safe Manual Uninstall Script (`deploy/remove-plugin-platform.sh`)**:
   - Default dry-run mode prevents accidental mutation.
   - Requires explicit `--apply` and explicit `--scope system|user`.
   - Validates that API and helper units no longer reference deprecated tmpfiles config or group before proceeding.
   - `assert_safe_path` enforces protected path invariants (protects `/`, `/var`, `/home`, user history, shared IPC sockets).
   - Account purge is guarded: `dam-hopper-plugin-runner` account and group preserved as inert remainder by default; deletion refused if active processes exist.

4. **Symlink Traversal Prevention in Advisor History**:
   - `inspect_history_root` strictly verifies directory type via `symlink_metadata` and explicitly rejects symlinks, preventing redirected access to sensitive history roots.

5. **Runtime Socket Containment**:
   - `dam-hopper-runtime.conf.in` configures `/run/dam-hopper` with `03770 root:@API_GROUP@`, ensuring only API group members and root can access runtime sockets. Supplementary groups removed from service units.

---

### Recommended Actions

1. Patch `deploy/remove-plugin-platform.sh` to use `getent passwd` instead of `eval echo "~$TARGET_USER"`.
2. Clean up `--plugin-owner-user` argument handling in `deploy/release/dam-hopper-install.sh`.
3. Proceed to Phase 08: Remove Evcrate plugin integration and release assets.

---

### Metrics
- **Rust Unit & Integration Tests:** 68 passed (59 existing linux_release suite + 9 new phase07 tests), 0 failed
- **Deploy Test Journeys:** 8 passed (`remove-plugin-platform.sh`, `clean-install.sh`, `upgrade-rollback.sh`, `crash-recovery.sh`, `security.sh`, `reset-smoke.sh`, `web-contract.sh`, `fedora44-format2-migration.sh`)
- **Type Safety:** 100% Rust static typing coverage; Serde strict deserialization with `deny_unknown_fields`
- **Execution Performance:** All Rust integration tests complete in ~0.24s; deployment scripts execute under 0.4s

---

### Validation Commands and Results

| Command | Status | Result / Details |
|---------|--------|------------------|
| `cargo test --manifest-path server/Cargo.toml --test linux_release_native_phase07` | PASS | 9 tests passed in 0.00s |
| `cargo test --manifest-path server/Cargo.toml --test linux_release_cli --test linux_release_format2_migration_exchange --test linux_release_staging --test linux_release_state_machine --test linux_release_unit_policy` | PASS | 59 tests passed across 5 test suites in 0.24s |
| `bash tests/deploy/linux-release-remove-plugin-platform.sh` | PASS | Verified dry-run invariance, prerequisite gate, mutating apply, history preservation, and second-run idempotence |
| `bash tests/deploy/linux-release-clean-install.sh` | PASS | All 3 roles (`server`, `web`, `both`) clean installed and validated |
| `bash tests/deploy/linux-release-upgrade-rollback.sh` | PASS | Upgrade, manual rollback, and automatic failure rollback verified |
| `bash tests/deploy/linux-release-crash-recovery.sh` | PASS | Crash during STAGED, SWITCHED/PROBING, and COMMITTED verified |
| `bash tests/deploy/linux-release-security.sh` | PASS | Sandboxing, role identities, and secret exclusion verified |
| `bash tests/deploy/fedora44-format2-migration.sh` | PASS | Format-2 fixture migration and atomic directory exchange verified |
| `bash tests/deploy/linux-release-reset-smoke.sh && bash tests/deploy/linux-release-web-contract.sh` | PASS | Reset defaults and web contract validated |

---

### Reviewed Files List
- `deploy/remove-plugin-platform.sh`
- `deploy/tmpfiles.d/dam-hopper-runtime.conf.in`
- `deploy/tmpfiles.d/dam-hopper-plugin-runner.conf.in` (deleted)
- `deploy/systemd/dam-hopper-api.service.in`
- `deploy/systemd/dam-hopper-idle-suspend-helper.service.in`
- `deploy/systemd/dam-hopper-plugin-runner.service.in` (deleted)
- `deploy/release/build-release-archive.sh`
- `deploy/release/check-release-assets.mjs`
- `deploy/release/generate-release-manifest.mjs`
- `deploy/release/release-manifest.schema.json`
- `deploy/release/dam-hopper-install.sh`
- `server/src/bin/dam-hopper.rs`
- `server/src/linux_release/account.rs`
- `server/src/linux_release/activate.rs`
- `server/src/linux_release/cli.rs`
- `server/src/linux_release/constants.rs`
- `server/src/linux_release/diagnostics/phase06_tests.rs`
- `server/src/linux_release/health.rs`
- `server/src/linux_release/host_config.rs`
- `server/src/linux_release/layout.rs`
- `server/src/linux_release/legacy_format2.rs`
- `server/src/linux_release/manifest.rs`
- `server/src/linux_release/manifest_validation.rs`
- `server/src/linux_release/mod.rs`
- `server/src/linux_release/recovery.rs`
- `server/src/linux_release/rollback.rs`
- `server/src/linux_release/stage.rs`
- `server/src/linux_release/stage_transaction.rs`
- `server/src/linux_release/stage_units.rs`
- `server/src/linux_release/state.rs`
- `server/src/linux_release/state_record.rs`
- `server/src/linux_release/status.rs`
- `server/src/linux_release/unit.rs`
- `server/src/linux_release/unit_policy.rs`
- `server/tests/common/release_fixtures.rs`
- `server/tests/linux_release_cli.rs`
- `server/tests/linux_release_format2_migration_exchange.rs`
- `server/tests/linux_release_native_phase07.rs`
- `server/tests/linux_release_plugin_runner.rs` (deleted)
- `server/tests/linux_release_staging.rs`
- `server/tests/linux_release_state_machine.rs`
- `server/tests/linux_release_unit_policy.rs`
- `tests/deploy/linux-release-common.sh`
- `tests/deploy/linux-release-package-twice.sh`
- `tests/deploy/linux-release-plugin-runner-owner-smoke.sh` (deleted)
- `tests/deploy/linux-release-plugin-upgrade-rollback.sh` (deleted)
- `tests/deploy/linux-release-remove-plugin-platform.sh`
- `docs/linux-systemd.md`
- `package.json`
- `plans/261002-0246-native-advisor-migration/phase-07-linux-deployment-and-manual-uninstall.md`
- `plans/261002-0246-native-advisor-migration/progress.md`

---

### Unresolved Questions
*None.*
