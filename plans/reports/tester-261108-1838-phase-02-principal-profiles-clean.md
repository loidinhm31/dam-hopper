# Phase 02 Test Suite Execution Report: Principal Profiles (Clean Verification)

## 1. Request & Scope
- **Operation:** `run` (code and contract validation)
- **Target Suite:** Plan phase `phase-02-managed-lifecycle` (Phase 02: Configure and supervise principal profiles)
- **Scope / Verification Targets:**
  1. `cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle -- --nocapture`
  2. `cargo test --manifest-path server/Cargo.toml --test browser_host_shutdown -- --nocapture`
  3. `cargo test --manifest-path server/Cargo.toml --test auth_no_auth -- --nocapture`
  4. `cargo test --manifest-path server/Cargo.toml config -- --nocapture`
  5. `cargo test --manifest-path server/Cargo.toml --test browser_host_process -- --nocapture`
  6. `cargo test --manifest-path server/Cargo.toml --test browser_host_adapter -- --nocapture`
- **Working Directory:** `/home/loidinh/WS/dam-hopper`
- **Environment:** Linux 7.2.15-200.fc44.x86_64, Cargo 1.91.0, Rustc 1.91.0

---

## 2. Execution Summary & Exact Counts

| # | Test Target | Exit Code | Duration | Passed | Failed | Skipped / Ignored | Status |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | `browser_host_lifecycle` | 0 | 0.44s | 10 | 0 | 0 | **PASS** |
| 2 | `browser_host_shutdown` | 0 | 0.46s | 3 | 0 | 0 | **PASS** |
| 3 | `auth_no_auth` | 0 | 1.27s (1.49s wall) | 14 | 0 | 0 | **PASS** |
| 4 | `config` unit & integration tests | 0 | 0.36s (1.83s wall) | 157 | 0 | 0 (1948 filtered) | **PASS** |
| 5 | `browser_host_process` | 0 | 15.27s (15.49s wall) | 19 | 0 | 2 (subprocess fixtures) | **PASS** |
| 6 | `browser_host_adapter` | 0 | 0.32s | 18 | 0 | 0 | **PASS** |
| **Total** | **All 6 Targets** | **0** | **18.12s (test runtime)** | **221** | **0** | **2** | **PASS** |

---

## 3. Failure Details
- **Failures Observed:** None (0 failures across all 6 targets).
- **Cycle 2 Regression Status:** Resolved. The previous assertion failure in `config::tests::browser_host_config_defaults_and_validation` (`BrowserHostConfig::validate_destination("[::1]:8080").is_ok()`) is now fixed and passing cleanly in `config` tests.

---

## 4. Per-Target Detailed Breakdown

### Target 1: `browser_host_lifecycle` (10/10 passed)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle -- --nocapture`
- **Result:** `test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.44s`
- **Tests Executed:**
  1. `test_managed_profile_layout_and_lock` — `ok`
  2. `test_reset_tombstone_lifecycle` — `ok`
  3. `test_metadata_persistence_and_profile_epoch` — `ok`
  4. `test_reset_profile_stale_epoch_rejected` — `ok`
  5. `test_reset_profile_simulated_kill_failure` — `ok`
  6. `test_reset_profile_successful_sequence` — `ok`
  7. `test_manager_capabilities_dto` — `ok`
  8. `test_reset_profile_simulated_delete_failure` — `ok`
  9. `test_browser_lifecycle_reconnect_and_stop` — `ok`
  10. `test_reset_profile_while_browser_running` — `ok`

### Target 2: `browser_host_shutdown` (3/3 passed)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test browser_host_shutdown -- --nocapture`
- **Result:** `test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.46s`
- **Tests Executed:**
  1. `test_server_startup_without_browser_use_launches_no_engine` — `ok`
  2. `test_shutdown_timeout_leaves_recoverable_tombstone_and_never_reports_deleted_credentials` — `ok`
  3. `test_shutdown_reaps_browser_descendants_and_preserves_credentials` — `ok`

### Target 3: `auth_no_auth` (14/14 passed)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test auth_no_auth -- --nocapture`
- **Result:** `test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.27s`
- **Tests Executed:**
  1. `test_production_missing_mongodb_fails` — `ok`
  2. `test_no_auth_with_mongodb_fails` — `ok`
  3. `test_no_auth_in_production_env_fails` — `ok`
  4. `test_no_auth_status_shows_dev_mode` — `ok`
  5. `test_no_auth_login_response_structure` — `ok`
  6. `test_normal_auth_protects_routes` — `ok`
  7. `test_no_auth_bypasses_middleware` — `ok`
  8. `test_no_auth_login_returns_dev_token` — `ok`
  9. `test_no_auth_allows_diagnostics_export` — `ok`
  10. `test_normal_auth_requires_credentials` — `ok`
  11. `test_no_auth_status_response_structure` — `ok`
  12. `test_normal_auth_status_without_token` — `ok`
  13. `device_sessions_are_explicitly_unavailable_without_authentication` — `ok`
  14. `test_normal_auth_login_error_response_structure` — `ok`

### Target 4: `config` Unit & Integration Tests (157 passed, 0 failed, 1948 filtered out)
- **Command:** `cargo test --manifest-path server/Cargo.toml config -- --nocapture`
- **Result:**
  - `src/lib.rs` (unit tests): `136 passed; 0 failed; 0 ignored; finished in 0.36s` (includes `config::tests::browser_host_config_defaults_and_validation`)
  - Remaining 79 test suites matching `config`: `21 passed; 0 failed; 0 ignored`
  - Total: `157 passed; 0 failed; 0 ignored; 1948 filtered out`

### Target 5: `browser_host_process` (19 passed, 0 failed, 2 ignored)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test browser_host_process -- --nocapture`
- **Result:** `test result: ok. 19 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 15.27s`
- **Ignored Subprocess Fixtures:**
  - `helper_supervisor_sigkill_parent`
  - `helper_supervisor_sigkill_startup_window`
- **Tests Executed:**
  1. `test_browser_lifecycle_and_descendant_cleanup` — `ok`
  2. `test_find_browser_executable_requires_explicit_configuration` — `ok`
  3. `test_supervisor_sigkill_containment` — `ok`
  4. `test_watcher_pre_exec_failure_fails_closed_and_cleans_up_chrome` — `ok`
  5. `test_supervisor_sigkill_startup_window` — `ok`
  6. `test_watcher_exec_failure_fails_closed_and_cleans_up_chrome` — `ok`
  7. `test_is_canonical_uuid` — `ok`
  8. `test_validate_browser_path` — `ok`
  9. `test_allowlist_rejects_copied_overrides_and_insecure_flags` — `ok`
  10. `test_port_file_rejects_non_canonical_uuid` — `ok`
  11. `test_validate_loopback_endpoint_strict_rejections` — `ok`
  12. `test_loopback_validation` — `ok`
  13. `test_corroboration_matching_succeeds` — `ok`
  14. `test_corroboration_mismatch_fails` — `ok`
  15. `test_stderr_overflow_rejection` — `ok`
  16. `test_stderr_endpoint_without_trailing_newline_at_eof` — `ok`
  17. `test_delayed_stderr_corroboration_matching_succeeds` — `ok`
  18. `test_delayed_stderr_corroboration_mismatch_fails` — `ok`
  19. `test_guard_kills_descendants_on_early_failure` — `ok`

### Target 6: `browser_host_adapter` (18/18 passed)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test browser_host_adapter -- --nocapture`
- **Result:** `test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.32s`
- **Tests Executed:**
  1. `test_bhjf_rejects_dimension_mismatch` — `ok`
  2. `test_geometry_limits` — `ok`
  3. `test_geometry_css_viewport_ceilings` — `ok`
  4. `test_decimal_sequence_validation` — `ok`
  5. `test_header_rejects_zero_counters` — `ok`
  6. `test_bhjf_rejects_malformed_framing` — `ok`
  7. `test_bhjf_frame_roundtrip` — `ok`
  8. `test_media_control_camel_case_json_fixtures` — `ok`
  9. `test_cdp_screencast_frame_routing` — `ok`
  10. `test_cdp_actor_id_only_response_rejected` — `ok`
  11. `test_cdp_command_dispatch_and_response` — `ok`
  12. `test_cdp_command_too_large_rejection` — `ok`
  13. `test_cdp_oversized_incoming_message_closes_actor` — `ok`
  14. `test_cdp_routeable_error_envelopes_fail_owner_immediately` — `ok`
  15. `test_cdp_unrouteable_framing_closes_actor_and_fails_pending` — `ok`
  16. `test_cdp_unknown_event_ignore_counter` — `ok`
  17. `test_cdp_pending_commands_bound_enforcement` — `ok`
  18. `test_cdp_byte_budget_shared_across_queued_and_inflight_commands` — `ok`

---

## 5. Unresolved Questions
None. All 6 targets execute and pass without errors or regressions.
