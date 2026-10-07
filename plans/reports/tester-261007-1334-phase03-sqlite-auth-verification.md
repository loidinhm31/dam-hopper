# Phase 03 SQLite Auth Lite Mode Test Verification Report

- Date: 2026-10-07
- Branch: feat/sqlite-auth
- Worktree: /home/loidinh/WS/worktrees/dam-hopper-sqlite-auth/server
- MongoDB endpoint: mongodb://127.0.0.1:27018 (reachable)

## 1. Test Results Overview

- Total test suites executed: 60
- Total tests: 1934
- Passed: 1822
- Failed: 106
- Ignored: 6
- Runtime skips (MongoDB missing): 0

### Suite Totals Breakdown

| Suite | Status | Passed | Failed | Ignored |
|---|---|---|---|---|
| src/lib.rs | FAILED | 1371 | 62 | 2 |
| src/bin/dam-hopper.rs | ok | 0 | 0 | 0 |
| src/bin/dam-hopper-idle-suspend-helper.rs | ok | 0 | 0 | 0 |
| src/main.rs | ok | 3 | 0 | 0 |
| src/bin/dam-hopper-web.rs | ok | 0 | 0 | 0 |
| tests/advisor_history_api.rs | ok | 12 | 0 | 0 |
| tests/advisor_policy_evaluations.rs | ok | 12 | 0 | 0 |
| tests/agent_status_hooks.rs | ok | 7 | 0 | 0 |
| tests/agent_status_integration.rs | ok | 17 | 0 | 0 |
| tests/agent_status_runtime.rs | ok | 8 | 0 | 0 |
| tests/auth_lite_mode.rs | ok | 6 | 0 | 0 |
| tests/auth_mfa.rs | ok | 13 | 0 | 0 |
| tests/auth_mfa_api.rs | ok | 8 | 0 | 0 |
| tests/auth_no_auth.rs | ok | 13 | 0 | 0 |
| tests/auth_sqlite_store.rs | ok | 13 | 0 | 0 |
| tests/auth_state_and_policy.rs | ok | 6 | 0 | 0 |
| tests/browser_debug_artifacts.rs | FAILED | 0 | 5 | 0 |
| tests/codex_app_server_compatibility.rs | ok | 1 | 0 | 1 |
| tests/fs_mutate.rs | FAILED | 0 | 9 | 0 |
| tests/fs_sandbox.rs | ok | 13 | 0 | 0 |
| tests/fs_upload.rs | FAILED | 0 | 9 | 0 |
| tests/fs_write_streaming.rs | FAILED | 0 | 5 | 0 |
| tests/git_blame_api.rs | ok | 12 | 0 | 0 |
| tests/git_commit_message_api.rs | ok | 6 | 0 | 0 |
| tests/git_leased_publish_api.rs | ok | 9 | 0 | 0 |
| tests/git_sha256_inspection.rs | ok | 6 | 0 | 0 |
| tests/git_squash_api.rs | ok | 8 | 0 | 0 |
| tests/host_resource_baseline.rs | ok | 7 | 0 | 0 |
| tests/host_resource_events.rs | ok | 9 | 0 | 0 |
| tests/host_resource_sse_qualification.rs | ok | 11 | 0 | 0 |
| tests/idle_suspend.rs | FAILED | 17 | 2 | 2 |
| tests/idle_suspend_diagnostics.rs | ok | 8 | 0 | 0 |
| tests/idle_suspend_diagnostics_linux_smoke.rs | ok | 0 | 0 | 1 |
| tests/idle_suspend_phase07.rs | ok | 2 | 0 | 0 |
| tests/linux_release_acquisition.rs | ok | 3 | 0 | 0 |
| tests/linux_release_archive.rs | ok | 6 | 0 | 0 |
| tests/linux_release_cli.rs | ok | 13 | 0 | 0 |
| tests/linux_release_format2_migration_drift.rs | ok | 10 | 0 | 0 |
| tests/linux_release_format2_migration_exchange.rs | ok | 3 | 0 | 0 |
| tests/linux_release_format2_migration_fixture.rs | ok | 1 | 0 | 0 |
| tests/linux_release_health.rs | ok | 7 | 0 | 0 |
| tests/linux_release_manifest.rs | ok | 7 | 0 | 0 |
| tests/linux_release_manifest_errors.rs | ok | 32 | 0 | 0 |
| tests/linux_release_native_phase07.rs | ok | 9 | 0 | 0 |
| tests/linux_release_ownership.rs | ok | 5 | 0 | 0 |
| tests/linux_release_platform.rs | ok | 7 | 0 | 0 |
| tests/linux_release_preflight_sqlite.rs | ok | 11 | 0 | 0 |
| tests/linux_release_publisher_contract.rs | ok | 10 | 0 | 0 |
| tests/linux_release_staging.rs | ok | 9 | 0 | 0 |
| tests/linux_release_state_machine.rs | ok | 13 | 0 | 0 |
| tests/linux_release_unit_policy.rs | ok | 21 | 0 | 0 |
| tests/linux_release_web_host.rs | ok | 8 | 0 | 0 |
| tests/plans_api.rs | ok | 16 | 0 | 0 |
| tests/project_worktree_lifecycle.rs | ok | 4 | 0 | 0 |
| tests/settings_import_export.rs | FAILED | 0 | 5 | 0 |
| tests/transport_enforcement_phase03.rs | ok | 5 | 0 | 0 |
| tests/workflow_api.rs | ok | 14 | 0 | 0 |
| tests/workspace_targets.rs | ok | 10 | 0 | 0 |
| tests/ws_fs_subscribe.rs | FAILED | 0 | 9 | 0 |
| Doc-tests dam_hopper_server | ok | 0 | 0 | 0 |

## 2. Skips: Runtime vs Compile-Time

- Runtime Skips (MongoDB missing): 0 tests (MongoDB accessible on 127.0.0.1:27018).
- Compile-time #[ignore]: 6 tests:
  1. `api::resource_events::tests::live_host_resource_qualification` (src/lib.rs)
  2. `pty::tests::pty_tests::codex_usage_enabled_and_disabled_pty_performance_is_equivalent` (src/lib.rs)
  3. `codex_0146_schema_proves_thread_list_cannot_exclude_content` (tests/codex_app_server_compatibility.rs)
  4. `activity_live_linux_pty_tcp_child_worker` (tests/idle_suspend.rs)
  5. `activity_live_linux_pty_tcp_smoke` (tests/idle_suspend.rs)
  6. `test_idle_suspend_diagnostics_read_only_linux_smoke` (tests/idle_suspend_diagnostics_linux_smoke.rs)

## 3. Specific Required Tests Confirmation

- lib `auth::config` (8 tests): PASS (8/8)
  - `absent_empty_false_zero_select_mongo_even_with_a_path`: ok
  - `any_other_selector_is_an_error_never_a_default`: ok
  - `auth_database_must_not_alias_another_subsystem_database`: ok
  - `invalid_path_is_ignored_when_lite_mode_is_off`: ok
  - `missing_or_blank_path_defaults_to_auth_db_in_global_config_dir`: ok
  - `path_forms_resolve_once_at_startup`: ok
  - `true_and_one_select_sqlite_case_and_space_insensitively`: ok
  - `unsupported_paths_are_rejected`: ok
- `--test auth_lite_mode` (6 tests): PASS (6/6)
  - `register_never_reports_success_when_storage_fails_or_is_absent`: ok
  - `reauthentication_verifies_same_subject_password_against_sqlite`: ok
  - `administrator_gate_follows_the_selected_store`: ok
  - `host_action_availability_is_derived_from_the_selected_store`: ok
  - `register_stores_a_disabled_user_and_rejects_duplicates`: ok
  - `startup_guards_apply_to_the_selected_store`: ok
- `--test auth_no_auth` (13 tests): PASS (13/13)
- `--test auth_mfa_api` (8 tests): PASS (8/8)
- `--test transport_enforcement_phase03` (5 tests): PASS (5/5)
- `--test auth_sqlite_store` (13 tests): PASS (13/13)
- lib `api::tests::idle_suspend_actor_gate_uses_selected_store_account_state`: PASS (1/1)

## 4. Failed Tests Details (106 total)

Root cause common to all 106 failures: HTTP 503 `AUTH_UNAVAILABLE` with body `{"error":"Authentication backend unavailable: Database not configured","code":"AUTH_UNAVAILABLE"}`. In Phase 03, implicit runtime fallback to `AuthService::mock()` when `auth_store` is `None` was removed from `AppState::new`. Test fixtures initializing `AppState` with `auth_store: None` while passing mock credentials (`damhopper-auth` cookie) now fail with 503 instead of authenticating.

### src/lib.rs (62 failed)
- `api::tests::agent_store_absorb_skill_into_store`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::agent_store_matrix_returns_map`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::agent_store_ship_and_unship_skill`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::config_and_settings_reload_revoke_shared_media_tickets`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::config_put_preserves_idle_suspend`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::config_put_rejects_agent_executables_delta`: assert status left 503 != right 400 (auth unavailable)
- `api::tests::config_put_rejects_automatic_policy_delta`: assert status left 503 != right 400 (auth unavailable)
- `api::tests::config_put_rejects_idle_suspend_delta`: assert status left 503 != right 400 (auth unavailable)
- `api::tests::fs_rest_validates_against_selected_project_root`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::git_branches_returns_list_for_valid_project`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::git_branches_returns_typed_unavailable_for_plain_directory`: assert status left 503 != right 409 (auth unavailable)
- `api::tests::git_bulk_routes_accept_and_validate_selected_targets`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::git_delete_branch_blocks_checked_out_branch`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::git_diff_returns_typed_unavailable_for_plain_directory`: assert status left 503 != right 409 (auth unavailable)
- `api::tests::git_get_and_edit_commit_message_api`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::git_log_api_supports_message_query_search_and_pagination`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::git_log_api_validation_and_error_handling`: assert status left 503 != right 400 (auth unavailable)
- `api::tests::git_roots_accepts_nested_repository_in_plain_project`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::git_roots_returns_primary_root_for_valid_project`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::git_roots_returns_typed_unavailable_for_plain_directory`: assert status left 503 != right 409 (auth unavailable)
- `api::tests::git_routes_isolate_selected_worktree_and_nested_roots`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::git_worktree_add_and_remove_routes_use_project_targets`: assert status left 503 != right 400 (auth unavailable)
- `api::tests::git_worktree_prune_route_invalidates_removed_worktree_metadata`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::git_worktree_remove_dirty_worktree_requires_force`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::git_worktree_remove_prunable_worktree_cleans_up_metadata`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::git_worktree_routes_return_typed_unavailable_for_plain_project`: assert status left 503 != right 409 (auth unavailable)
- `api::tests::git_worktree_target_on_plain_project_returns_stable_error`: assert status left 503 != right 400 (auth unavailable)
- `api::tests::git_worktrees_returns_list_for_valid_project`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::image_revoke_requires_auth_and_context_reload_revokes_both_media_kinds`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::image_stream_is_session_bound_inline_mime_typed_and_rangeable`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::image_stream_rejects_video_kind_revokes_and_fails_closed_on_stale_files`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::image_stream_uses_bound_ticket_capability_and_logout_revokes_it`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::image_ticket_issuance_is_not_limited_by_live_ticket_count`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::image_ticket_issuance_rejects_symlinks_and_fifos`: assert status left 503 != right 404 (auth unavailable)
- `api::tests::image_ticket_issuance_requires_auth_and_rejects_unsafe_inputs`: assert status left 503 != right 400 (auth unavailable)
- `api::tests::image_tickets_use_a_closed_allowlist_and_fixed_preview_contract`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::language_files_returns_normalized_contract_and_enforces_project_boundary`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::media_tickets_stream_only_the_resolved_worktree_and_expire_when_it_is_removed`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::settings_import_rejects_idle_suspend_delta`: assert status left 503 != right 400 (auth unavailable)
- `api::tests::terminal_create_defaults_project_cwd_to_project_root`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::terminal_create_loads_project_env_file_for_terminal_sessions`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::terminal_create_loads_target_worktree_env_file`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::terminal_create_rejects_cwd_outside_target_without_creating_session`: assert status left 503 != right 403 (auth unavailable)
- `api::tests::terminal_create_rejects_malformed_project_env_file`: assert status left 503 != right 400 (auth unavailable)
- `api::tests::terminal_create_rejects_project_cwd_escape`: assert status left 503 != right 403 (auth unavailable)
- `api::tests::terminal_create_request_env_overrides_project_env_file`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::terminal_target_metadata_blocks_concurrent_worktree_removal`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::terminal_target_metadata_projects_absolute_configured_root_cwd`: assert status left 503 != right 200 (auth unavailable)
- `api::tests::v2_media_suite_verifies_namespace_isolation_and_negative_cases`: assert status left 503 != right 422 (auth unavailable)
- `api::tests::video_stream_head_ignores_range_and_if_range_mismatch_falls_back_to_full_body`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::video_stream_is_session_bound_and_serves_media`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::video_stream_rejects_invalid_ranges_without_disclosing_filename_or_type`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::video_stream_revokes_stale_files_and_handles_sparse_ranges_without_full_buffering`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::video_stream_serves_zero_byte_files_but_rejects_zero_byte_ranges`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::video_stream_uses_bound_ticket_capability_and_logout_revokes_it`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::video_stream_uses_one_range_core_for_inline_and_attachment_purposes`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::video_ticket_issuance_is_not_limited_by_live_ticket_count`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::video_ticket_issuance_rejects_fifo_before_opening_it`: assert status left 503 != right 404 (auth unavailable)
- `api::tests::video_ticket_issuance_requires_auth_and_rejects_non_video_or_unsafe_paths`: assert status left 503 != right 400 (auth unavailable)
- `api::tests::video_tickets_are_opaque_purpose_bound_and_independently_revocable`: assert status left 503 != right 201 (auth unavailable)
- `api::tests::workspace_reinitialization_revokes_every_media_ticket`: Option::unwrap on None (503 response header missing cookie)
- `api::tests::workspace_switch_preserves_startup_idle_suspend_policy`: assert status left 503 != right 200 (auth unavailable)

### tests/browser_debug_artifacts.rs (5 failed)
- `artifact_routes_require_auth_and_validate_terminal_and_selection`: assert status left 503 != right 404 (auth unavailable)
- `artifact_routes_write_private_files_and_delete_them`: assert status left 503 != right 201 (auth unavailable)
- `artifact_handoff_writes_once_and_requires_acknowledgement`: assert status left 503 != right 201 (auth unavailable)
- `png_upload_enforces_the_four_megabyte_cap`: Option::unwrap on None (ticket issuance failed with 503)
- `replaced_terminal_incarnation_rejects_handoff_without_writing_to_replacement_pty`: assert status left 503 != right 201 (auth unavailable)

### tests/fs_mutate.rs (9 failed)
- `delete_file_gone_after_op`: WS connect failed with 503 AUTH_UNAVAILABLE
- `create_dir_nested_exists_after_op`: WS connect failed with 503 AUTH_UNAVAILABLE
- `delete_dir_recursive_gone`: WS connect failed with 503 AUTH_UNAVAILABLE
- `create_file_exists_after_op`: WS connect failed with 503 AUTH_UNAVAILABLE
- `delete_git_head_allowed_with_force`: WS connect failed with 503 AUTH_UNAVAILABLE
- `delete_project_root_refused`: WS connect failed with 503 AUTH_UNAVAILABLE
- `delete_git_head_refused_without_force`: WS connect failed with 503 AUTH_UNAVAILABLE
- `move_across_dirs_succeeds`: WS connect failed with 503 AUTH_UNAVAILABLE
- `rename_file_succeeds`: WS connect failed with 503 AUTH_UNAVAILABLE

### tests/fs_upload.rs (9 failed)
- `upload_commit_rejects_removed_and_recreated_worktree_target`: WS connect failed with 503 AUTH_UNAVAILABLE
- `upload_len_over_100mb_rejected`: WS connect failed with 503 AUTH_UNAVAILABLE
- `upload_commit_without_matching_bytes_rejected`: WS connect failed with 503 AUTH_UNAVAILABLE
- `upload_happy_path_file_content_matches`: WS connect failed with 503 AUTH_UNAVAILABLE
- `upload_out_of_order_seq_rejected`: WS connect failed with 503 AUTH_UNAVAILABLE
- `upload_multi_chunk_large_file`: WS connect failed with 503 AUTH_UNAVAILABLE
- `upload_zip_slip_filename_rejected`: WS connect failed with 503 AUTH_UNAVAILABLE
- `upload_targets_registered_worktree_and_rejects_unregistered_sibling`: WS connect failed with 503 AUTH_UNAVAILABLE
- `write_commit_rejects_removed_and_recreated_worktree_target`: WS connect failed with 503 AUTH_UNAVAILABLE

### tests/fs_write_streaming.rs (5 failed)
- `write_base64_backward_compatibility`: WS connect failed with 503 AUTH_UNAVAILABLE
- `write_binary_out_of_order_rejected`: WS connect failed with 503 AUTH_UNAVAILABLE
- `write_binary_occ_conflict`: WS connect failed with 503 AUTH_UNAVAILABLE
- `write_binary_happy_path`: WS connect failed with 503 AUTH_UNAVAILABLE
- `write_to_nonexistent_file_fails`: WS connect failed with 503 AUTH_UNAVAILABLE

### tests/idle_suspend.rs (2 failed)
- `test_idle_suspend_cross_module_lifecycle_empty_to_armed_to_resumed`: assert status left 503 != right 200 (auth unavailable)
- `test_idle_suspend_pre_handoff_timing_patch_rearms`: assert status left 503 != right 403 (auth unavailable)

### tests/settings_import_export.rs (5 failed)
- `test_import_prunes_backups_retaining_five`: assert status left 503 != right 200 (auth unavailable)
- `test_import_rejects_malformed_toml`: assert status left 503 != right 400 (auth unavailable)
- `test_import_rejects_unsupported_content_type`: assert status left 503 != right 415 (auth unavailable)
- `test_export_workspace_settings_preserves_comments_and_formatting`: assert status left 503 != right 200 (auth unavailable)
- `test_import_workspace_settings_success_and_backup`: assert status left 503 != right 200 (auth unavailable)

### tests/ws_fs_subscribe.rs (9 failed)
- `watcher_events_are_isolated_between_project_roots`: WS connect failed with 503 AUTH_UNAVAILABLE
- `test_ws_fs_subscribe_watch_only`: WS connect failed with 503 AUTH_UNAVAILABLE
- `test_ws_fs_read_strict_plan_document_mode`: WS connect failed with 503 AUTH_UNAVAILABLE
- `root_and_worktree_reads_and_watchers_are_isolated_on_one_connection`: WS connect failed with 503 AUTH_UNAVAILABLE
- `ws_fs_subscribe_receives_snapshot`: WS connect failed with 503 AUTH_UNAVAILABLE
- `ws_fs_subscribe_nonexistent_project_returns_error`: WS connect failed with 503 AUTH_UNAVAILABLE
- `watcher_shared_between_two_connections`: WS connect failed with 503 AUTH_UNAVAILABLE
- `ws_fs_subscribe_receives_create_event`: WS connect failed with 503 AUTH_UNAVAILABLE
- `ws_fs_unsubscribe_stops_events`: WS connect failed with 503 AUTH_UNAVAILABLE

## 5. Clippy Findings in Touched Files

### src/auth/config.rs
- 0 findings (clean)

### src/api/auth.rs
- 0 findings (clean)

### src/api/host_actions.rs
- 0 findings (clean)

### src/state.rs (1 finding)
- `src/state.rs:248:5`: `clippy::too_many_arguments` — `pub fn new(...) -> anyhow::Result<Self>` has 15 arguments (threshold: 7).

### src/main.rs (1 finding)
- `src/main.rs:336:1`: `clippy::items_after_test_module` — items after test module (`init_auth_store` at line 497 and `main` at line 552 declared after `mod tests` block at line 336).

### src/api/idle_suspend.rs (1 finding)
- `src/api/idle_suspend.rs:75:6`: `clippy::result_large_err` — `verify_idle_suspend_admin_permission` returns `Result<(), Response>` where `Response` is ≥128 bytes.

### tests/auth_lite_mode.rs (2 findings)
- `tests/auth_lite_mode.rs:110:9`: `clippy::await_holding_lock` — `let env = ENV_LOCK.lock()` holds `std::sync::MutexGuard` across `.await` at line 113:50 (`AuthStore::open_sqlite`).
- `tests/auth_lite_mode.rs:358:9`: `clippy::await_holding_lock` — `let _env = ENV_LOCK.lock()` holds `std::sync::MutexGuard` across `.await` at line 360:68 (`AuthStore::open_sqlite`).

## 6. Unresolved Questions

1. How should test fixture helpers in `src/api/tests.rs` and the other 7 integration suites (`browser_debug_artifacts.rs`, `fs_mutate.rs`, `fs_upload.rs`, `fs_write_streaming.rs`, `idle_suspend.rs`, `settings_import_export.rs`, `ws_fs_subscribe.rs`) configure their auth state? Should a dedicated test constructor or fixture helper pass `Some(AuthStore::mock())` or an explicit in-memory SQLite store, without re-introducing an implicit fallback in production `AppState::new`?
2. Should `tests/auth_lite_mode.rs` migrate `ENV_LOCK` from `std::sync::Mutex` to `tokio::sync::Mutex` or scope the lock guard before `.await` to address `clippy::await_holding_lock`?
3. Should `init_auth_store` and `main` in `src/main.rs` be moved before `mod tests` to satisfy `clippy::items_after_test_module`?
