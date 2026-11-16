# Phase 02 Test Suite Execution Report: Principal Profiles (Cycle 2)

## 1. Request & Scope
- **Operation:** `run` (code & contract validation)
- **Target Suite:** Plan phase `phase-02-managed-lifecycle` (Cycle 2 re-verification)
- **Scope / Targets:**
  1. `cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle -- --nocapture`
  2. `cargo test --manifest-path server/Cargo.toml --test browser_host_shutdown -- --nocapture`
  3. `cargo test --manifest-path server/Cargo.toml --test auth_no_auth -- --nocapture`
  4. `cargo test --manifest-path server/Cargo.toml config -- --nocapture`
  5. `cargo test --manifest-path server/Cargo.toml --test browser_host_process -- --nocapture`
  6. `cargo test --manifest-path server/Cargo.toml --test browser_host_adapter -- --nocapture`
- **Working Directory:** `/home/loidinh/WS/dam-hopper`
- **Environment:** Linux 7.2.15-200.fc44.x86_64, Cargo 1.91.0, Google Chrome 157.0.8103.38 (`/usr/bin/google-chrome`)

---

## 2. Execution Summary & Exact Test Counts

| # | Test Target | Exit Code | Duration | Passed | Failed | Skipped / Ignored | Status |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | `browser_host_lifecycle` | 0 | 0.24s | 10 | 0 | 0 | **PASS** |
| 2 | `browser_host_shutdown` | 0 | 0.48s | 3 | 0 | 0 | **PASS** |
| 3 | `auth_no_auth` | 0 | 1.24s | 14 | 0 | 0 | **PASS** |
| 4 | `config` unit tests | 101 | 0.39s (suite) / 123.87s (build) | 135 | 1 | 0 (1296 filtered) | **FAIL** |
| 5 | `browser_host_process` | 0 | 15.26s | 19 | 0 | 2 (subprocess helpers) | **PASS** |
| 6 | `browser_host_adapter` | 0 | 0.33s | 18 | 0 | 0 | **PASS** |
| **Total** | **6 Targets** | **101** | **17.94s (suite)** | **199** | **1** | **2** | **FAIL (1 target failed)** |

---

## 3. Failure Details

### Target 4: `config` Unit Tests
- **Command:** `cargo test --manifest-path server/Cargo.toml config -- --nocapture`
- **Exit Code:** `101`
- **Failing Test:** `config::tests::browser_host_config_defaults_and_validation`
- **Failure Location:** `server/src/config/tests.rs:2354:5`
- **Diagnostic / Assertion Message:**
  ```text
  thread 'config::tests::browser_host_config_defaults_and_validation' panicked at src/config/tests.rs:2354:5:
  assertion failed: BrowserHostConfig::validate_destination("[::1]:8080").is_ok()
  ```
- **Root Cause Analysis (Syntax/Logic Diagnosis, No Repair Auth):**
  In `server/src/browser_host/config.rs:308-328` (`BrowserHostConfig::validate_destination`):
  When evaluating `"[::1]:8080"`, `trimmed.starts_with('[') && trimmed.contains("]:")` splits `rsplit_once(':')` into host `"[::1]"` and port `"8080"`.
  Line 326 then executes:
  ```rust
  if host.is_empty() || !host.chars().all(|c| c.is_alphanumeric() || c == '.' || c == '-' || c == '[' || c == ']') {
      return Err(format!("invalid characters in destination hostname: {host}"));
  }
  ```
  The character set does not include `:` (colon), which is required for IPv6 addresses inside brackets (e.g. `[::1]`). Consequently, `validate_destination("[::1]:8080")` returns `Err("invalid characters in destination hostname: [::1]")` instead of `Ok(())`.

---

## 4. Per-Target Detailed Breakdown

### Target 1: `browser_host_lifecycle` (10/10 passed)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle -- --nocapture`
- **Result:** `test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.24s`
- **Tests Executed:**
  1. `test_managed_profile_layout_and_lock` — `ok`
  2. `test_metadata_persistence_and_profile_epoch` — `ok`
  3. `test_reset_tombstone_lifecycle` — `ok`
  4. `test_reset_profile_simulated_kill_failure` — `ok`
  5. `test_reset_profile_stale_epoch_rejected` — `ok`
  6. `test_reset_profile_simulated_delete_failure` — `ok`
  7. `test_manager_capabilities_dto` — `ok`
  8. `test_reset_profile_successful_sequence` — `ok`
  9. `test_reset_profile_while_browser_running` — `ok`
  10. `test_browser_lifecycle_reconnect_and_stop` — `ok`

### Target 2: `browser_host_shutdown` (3/3 passed)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test browser_host_shutdown -- --nocapture`
- **Result:** `test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.48s`
- **Tests Executed:**
  1. `test_server_startup_without_browser_use_launches_no_engine` — `ok`
  2. `test_shutdown_timeout_leaves_recoverable_tombstone_and_never_reports_deleted_credentials` — `ok`
  3. `test_shutdown_reaps_browser_descendants_and_preserves_credentials` — `ok`

### Target 3: `auth_no_auth` (14/14 passed)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test auth_no_auth -- --nocapture`
- **Result:** `test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.24s`
- **Tests Executed:**
  1. `test_no_auth_in_production_env_fails` — `ok`
  2. `test_no_auth_with_mongodb_fails` — `ok`
  3. `test_production_missing_mongodb_fails` — `ok`
  4. `test_no_auth_status_response_structure` — `ok`
  5. `test_normal_auth_requires_credentials` — `ok`
  6. `test_normal_auth_protects_routes` — `ok`
  7. `test_no_auth_login_returns_dev_token` — `ok`
  8. `test_normal_auth_login_error_response_structure` — `ok`
  9. `test_no_auth_login_response_structure` — `ok`
  10. `test_no_auth_bypasses_middleware` — `ok`
  11. `device_sessions_are_explicitly_unavailable_without_authentication` — `ok`
  12. `test_normal_auth_status_without_token` — `ok`
  13. `test_no_auth_allows_diagnostics_export` — `ok`
  14. `test_no_auth_status_shows_dev_mode` — `ok`

### Target 4: `config` Unit Tests (135 passed, 1 failed, 1296 filtered out)
- **Command:** `cargo test --manifest-path server/Cargo.toml config -- --nocapture`
- **Result:** `test result: FAILED. 135 passed; 1 failed; 0 ignored; 0 measured; 1296 filtered out; finished in 0.39s`
- **Failure:** `config::tests::browser_host_config_defaults_and_validation` at `src/config/tests.rs:2354:5`

### Target 5: `browser_host_process` (19 passed, 0 failed, 2 ignored)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test browser_host_process -- --nocapture`
- **Result:** `test result: ok. 19 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 15.26s`
- **Ignored:**
  - `helper_supervisor_sigkill_parent` (subprocess fixture invoked by test)
  - `helper_supervisor_sigkill_startup_window` (subprocess fixture invoked by test)
- **Tests Executed:**
  1. `test_is_canonical_uuid` — `ok`
  2. `test_validate_browser_path` — `ok`
  3. `test_watcher_exec_failure_fails_closed_and_cleans_up_chrome` — `ok`
  4. `test_supervisor_sigkill_containment` — `ok`
  5. `test_browser_lifecycle_and_descendant_cleanup` — `ok`
  6. `test_find_browser_executable_requires_explicit_configuration` — `ok`
  7. `test_supervisor_sigkill_startup_window` — `ok`
  8. `test_watcher_pre_exec_failure_fails_closed_and_cleans_up_chrome` — `ok`
  9. `test_allowlist_rejects_copied_overrides_and_insecure_flags` — `ok`
  10. `test_port_file_rejects_non_canonical_uuid` — `ok`
  11. `test_validate_loopback_endpoint_strict_rejections` — `ok`
  12. `test_loopback_validation` — `ok`
  13. `test_corroboration_mismatch_fails` — `ok`
  14. `test_corroboration_matching_succeeds` — `ok`
  15. `test_stderr_overflow_rejection` — `ok`
  16. `test_stderr_endpoint_without_trailing_newline_at_eof` — `ok`
  17. `test_delayed_stderr_corroboration_mismatch_fails` — `ok`
  18. `test_delayed_stderr_corroboration_matching_succeeds` — `ok`
  19. `test_guard_kills_descendants_on_early_failure` — `ok`

### Target 6: `browser_host_adapter` (18/18 passed)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test browser_host_adapter -- --nocapture`
- **Result:** `test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.33s`
- **Tests Executed:**
  1. `test_decimal_sequence_validation` — `ok`
  2. `test_geometry_limits` — `ok`
  3. `test_bhjf_rejects_dimension_mismatch` — `ok`
  4. `test_geometry_css_viewport_ceilings` — `ok`
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
1. Should `BrowserHostConfig::validate_destination` permit colons within bracketed IPv6 host sections (e.g. `[::1]:port` or `[fd00:...]:port`), or should IPv6 host parsing use `h.trim_start_matches('[').trim_end_matches(']').parse::<Ipv6Addr>()` before verifying the optional port?
