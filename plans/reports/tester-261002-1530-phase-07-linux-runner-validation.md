# Tester Validation Report: Phase 07 — Retire Linux Runner and Safe Manual Uninstall

- **Date:** 2026-10-02
- **Plan:** `plans/261002-0246-native-advisor-migration/phase-07-linux-deployment-and-manual-uninstall.md`
- **Result:** ALL 1,728 TESTS PASSED (100%)

## Executed Test Suites

### 1. Phase 07 Dedicated Rust Unit & Integration Tests
Command: `cargo test --manifest-path server/Cargo.toml --test linux_release_native_phase07`
- `test_managed_service_units_exclude_runner`: PASSED (asserted `ALL_SERVICE_UNITS.len() == 4`)
- `test_manager_state_schema3_migration_from_legacy_v2`: PASSED (verified auto-backup `state.v2.bak`, schemaVersion 3, generation bump, stripped runner fields, preserved asset digests)
- `test_manager_state_migration_fails_closed_on_unfinished_transaction`: PASSED (fails closed without mutation)
- `test_manager_state_migration_fails_closed_on_unknown_top_level_field`: PASSED (fails closed without mutation)
- `test_host_config_normalization_removes_obsolete_plugin_fields`: PASSED (auto-normalizes `plugin_owner_user` and `plugin_admin_subjects`)
- `test_native_api_and_helper_unit_policy`: PASSED (verifies `dam-hopper-runtime.conf`, rejects `SupplementaryGroups`)
- `test_advisor_history_directory_validation_rejects_symlink`: PASSED (real directory succeeds, symlink rejected)
- `test_legacy_manifest_inspection_and_native_manifest_validation`: PASSED (narrow reader parses installed legacy bundles, native manifest validated)
- `test_staging_rejects_plugin_bearing_candidate_bundle`: PASSED (rejects candidate containing runner)

### 2. Full Server Backend Test Suite
Command: `cargo test --manifest-path server/Cargo.toml`
- 1,719 passed, 0 failed, 6 ignored across 54 suites

### 3. Deploy Integration Journeys
Command: `pnpm test:deploy`
- `linux-release-clean-install.sh`: PASSED
- `linux-release-upgrade-rollback.sh`: PASSED
- `linux-release-crash-recovery.sh`: PASSED
- `linux-release-security.sh`: PASSED
- `linux-release-reset-smoke.sh`: PASSED
- `linux-release-web-contract.sh`: PASSED
- `fedora44-format2-migration.sh`: PASSED
- `linux-release-remove-plugin-platform.sh`: PASSED (dry-run invariance, prerequisite gate, mutating apply, history preservation, idempotence)

### 4. UI Unit Tests
Command: `pnpm --filter @dam-hopper/ui test`
- 2,206 passed, 0 failed across 293 test files
