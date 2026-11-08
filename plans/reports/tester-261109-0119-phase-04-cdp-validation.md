# Phase 04 Test Suite Execution Report: Raw CDP Gateway & Qualification

## 1. Request & Scope
- **Operation:** `run` (code and contract validation)
- **Target Suite:** Phase 04 (Expose authenticated instance-scoped raw CDP)
- **Scope / Verification Targets:**
  1. `cargo test --manifest-path server/Cargo.toml --test browser_host_gateway -- --nocapture`
  2. `cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle --test browser_host_shutdown --test browser_host_admission --test browser_host_auth --test browser_host_input`
  3. `cargo check --manifest-path server/Cargo.toml --example browser_host_qualification`
  4. `pnpm --filter @dam-hopper/ui test:e2e:typecheck`
  5. `pnpm --filter @dam-hopper/ui exec playwright test e2e/os-host-browser/agent.spec.ts`
- **Working Directory:** `/home/loidinh/WS/dam-hopper`
- **Environment:** Linux 7.2.15-200.fc44.x86_64, Node.js v24.2.0, pnpm 10.4.1, Cargo 1.91.0, Rustc 1.91.0

---

## 2. Execution Summary & Exact Counts

| # | Test Target | Exit Code | Duration | Passed | Failed | Skipped | Status |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | `browser_host_gateway` (Rust integration) | 0 | 0.83s | 13 | 0 | 0 | **PASS** |
| 2 | Regression suites (5 Rust integration targets) | 0 | 0.51s | 33 | 0 | 0 | **PASS** |
| 3 | `browser_host_qualification` (Rust example check) | 0 | 0.18s | N/A (build) | 0 | 0 | **PASS** |
| 4 | UI E2E typecheck (`tsc -p tsconfig.e2e.json`) | 0 | 1.30s | N/A (typecheck) | 0 | 0 | **PASS** |
| 5 | `agent.spec.ts` (Playwright E2E qualification) | 0 | 10.7s | 8 | 0 | 0 | **PASS** |
| **Total** | **All Verification Targets** | **0** | **13.52s** | **54** | **0** | **0** | **PASS** |

**Pass Rate:** 100% (54/54 automated test assertions passed, 0 failures, 0 ignored).

---

## 3. Failure Details
- **Failures Observed:** None.
- **Instability / Retries:** 0 retries required. All checks passed cleanly on first execution.

---

## 4. Per-Target Detailed Breakdown

### Target 1: `browser_host_gateway` (13/13 passed)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test browser_host_gateway -- --nocapture`
- **Result:** `test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.83s`
- **Tests Executed:**
  1. `test_capacity_limit_dynamic_budget` — `ok`
  2. `test_global_agent_capacity_limit_rejects_busy_429` — `ok`
  3. `test_write_with_cancel_aborts_immediately` — `ok`
  4. `test_origin_less_capability_only_denied_401` — `ok`
  5. `test_origin_less_without_bearer_denied_401` — `ok`
  6. `test_agent_target_registration_in_manager` — `ok`
  7. `test_native_geometry_mutation_fences_managed_input` — `ok`
  8. `test_unauthenticated_discovery_denied_401` — `ok`
  9. `test_ws_upgrade_unauthenticated_denied_401` — `ok`
  10. `test_non_admin_discovery_denied_403` — `ok`
  11. `test_ws_upgrade_wrong_origin_denied_403` — `ok`
  12. `test_discovery_wrong_origin_denied_403` — `ok`
  13. `test_live_revocation_detection` — `ok`

### Target 2: Regression Suites (33/33 passed across 5 test binaries)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle --test browser_host_shutdown --test browser_host_admission --test browser_host_auth --test browser_host_input`
- **Result:** `33 passed across 5 test binaries; finished in 0.51s`
- **Suites Breakdown:**
  - `browser_host_admission` (7/7 passed, 0.57s):
    1. `test_dev_mode_loopback_and_origin_gates` — `ok`
    2. `test_unauthenticated_request_rejected` — `ok`
    3. `test_ordinary_user_rejected_with_admin_required` — `ok`
    4. `test_idempotent_session_creation_retry_and_caps` — `ok`
    5. `test_url_policy_enforcement` — `ok`
    6. `test_admin_admission_success_and_capabilities` — `ok`
    7. `test_disabled_user_rejected_with_account_disabled` — `ok`
  - `browser_host_auth` (6/6 passed, 0.20s):
    1. `test_purpose_and_origin_swap_rejected` — `ok`
    2. `test_ticket_expiry_clipped_by_auth_deadline` — `ok`
    3. `test_targeted_revocation_preserves_sibling_login` — `ok`
    4. `test_paired_media_control_connection_and_cancellation` — `ok`
    5. `test_rest_issue_ticket_and_consume` — `ok`
    6. `test_live_auth_verification_demotion` — `ok`
  - `browser_host_input` (7/7 passed, 0.30s):
    1. `test_fraction_to_css_mapping_and_boundaries` — `ok`
    2. `test_lease_renewal_clipped_to_auth_deadline` — `ok`
    3. `test_reliable_queue_coalescing_and_sequence_gap` — `ok`
    4. `test_saturation_queue_overflow_releases_held_keys` — `ok`
    5. `test_viewport_update_and_epochs` — `ok`
    6. `test_rest_control_lease_lifecycle` — `ok`
    7. `test_selected_text_and_find_commands` — `ok`
  - `browser_host_lifecycle` (10/10 passed, 0.22s):
    1. `test_metadata_persistence_and_profile_epoch` — `ok`
    2. `test_managed_profile_layout_and_lock` — `ok`
    3. `test_reset_profile_stale_epoch_rejected` — `ok`
    4. `test_reset_tombstone_lifecycle` — `ok`
    5. `test_manager_capabilities_dto` — `ok`
    6. `test_reset_profile_simulated_kill_failure` — `ok`
    7. `test_reset_profile_simulated_delete_failure` — `ok`
    8. `test_reset_profile_successful_sequence` — `ok`
    9. `test_reset_profile_while_browser_running` — `ok`
    10. `test_browser_lifecycle_reconnect_and_stop` — `ok`
  - `browser_host_shutdown` (3/3 passed, 0.51s):
    1. `test_server_startup_without_browser_use_launches_no_engine` — `ok`
    2. `test_shutdown_timeout_leaves_recoverable_tombstone_and_never_reports_deleted_credentials` — `ok`
    3. `test_shutdown_reaps_browser_descendants_and_preserves_credentials` — `ok`

### Target 3: `browser_host_qualification` Example Check
- **Command:** `cargo check --manifest-path server/Cargo.toml --example browser_host_qualification`
- **Result:** Finished `dev` profile [unoptimized + debuginfo] in 0.18s, 0 errors, status **PASS**.

### Target 4: UI E2E Typecheck
- **Command:** `pnpm --filter @dam-hopper/ui test:e2e:typecheck`
- **Result:** `tsc -p tsconfig.e2e.json` completed with 0 errors in 1.30s, status **PASS**.

### Target 5: Playwright E2E Agent Qualification (8/8 passed)
- **Command:** `pnpm --filter @dam-hopper/ui exec playwright test e2e/os-host-browser/agent.spec.ts`
- **Result:** `8 passed (10.7s)`
- **Tests Executed:**
  1. `rejects unauthenticated discovery request with HTTP 401 and no-store` — `passed`
  2. `rejects discovery with unapproved Origin even with valid bearer` — `passed`
  3. `rejects WebSocket upgrade with unapproved Origin even with valid bearer` — `passed`
  4. `rejects Origin-less capability-only upgrade with HTTP 401` — `passed`
  5. `accepts discovery with valid bearer and rewrites webSocketDebuggerUrl to gateway` — `passed`
  6. `proves Playwright connectOverCDP connects to production gateway using Bearer on both paths and mutates target` — `passed`
  7. `proves agent Page.disable or stopScreencast cannot stop the independent native session` — `passed`
  8. `proves revocation of one agent login closes its connection while sibling session persists` — `passed`

---

## 5. Unresolved Questions
None.
