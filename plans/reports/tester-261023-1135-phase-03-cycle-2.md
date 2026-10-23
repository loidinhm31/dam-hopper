# QA Test Report: Phase 03 — Pinned Tool Provisioning and Resource Controls (Cycle 2)

- **Date**: 2026-10-23
- **Operation**: `run` (code validation)
- **Scope**: Phase 03 test suite re-execution (Cycle 2)
  1. `cargo test --manifest-path server/Cargo.toml --test semantic_tool_profile`
  2. `cargo test --manifest-path server/Cargo.toml --test semantic_resources`
  3. `cargo test --manifest-path server/Cargo.toml --test linux_release_manifest`
  4. `cargo test --manifest-path server/Cargo.toml --lib semantic::`
  5. `cargo test --manifest-path server/Cargo.toml --test semantic_child_process`
- **Authority**: Execution and reporting only; zero code, test, or CI edits authorized.
- **Environment**: Linux 7.1.10-200.fc44.x86_64, cargo/rustc 2021 edition.
- **Worktree Context**: Revision `c9a83a5f5a6987d003ceb923edd2910d91380afa` (`feat/lsp-server-integration-reassess`); working tree contains 188 unstaged tracked modifications across monorepo and untracked Phase 03 files.
- **Policy/Procedure Loaded**:
  - `~/.omp/agent/skills/test/references/test-principles.md`
  - `~/.omp/agent/skills/test/references/code-validation.md`
  - Monorepo rules (`.omp/evcrate/AGENTS.md`)

---

## 1. Test Results Overview

| Target / Suite | Total Run | Passed | Failed | Skipped / Ignored | Not Selected (Filtered) | Duration | Status |
|---|---|---|---|---|---|---|---|
| `semantic_tool_profile` | 11 | 11 | 0 | 0 | 0 | 0.00s | **PASS** |
| `semantic_resources` | 8 | 8 | 0 | 0 | 0 | 0.00s | **PASS** |
| `linux_release_manifest` | 12 | 12 | 0 | 0 | 0 | 0.00s | **PASS** |
| `--lib semantic::` | 13 | 13 | 0 | 0 | 1,466 | 0.00s | **PASS** |
| `semantic_child_process` | 11 | 11 | 0 | 0 | 0 | 8.55s | **PASS** |
| **Total per run** | **55** | **55** | **0** | **0** | **1,466** | **8.55s** | **PASS (100%)** |

*Note: 1,466 tests filtered out in `--lib semantic::` were unselected server unit tests, not skipped or passing.*
*Delta vs Cycle 1: +6 tests added (+2 in `semantic_tool_profile`, +2 in `semantic_resources`, +2 in `linux_release_manifest`).*

---

## 2. Individual Test Breakdown

### 1. `semantic_tool_profile` (11 integration tests)
- `test_discover_does_not_inspect_environment_variables`: `ok` (NEW)
- `test_supported_languages_and_extensions`: `ok`
- `test_non_executable_node_binary_fails_integrity`: `ok`
- `test_digest_verification_tamper_detection`: `ok`
- `test_missing_package_json_fails_integrity`: `ok`
- `test_missing_tsls_entrypoint_fails_integrity`: `ok`
- `test_group_writable_file_fails_integrity`: `ok` (NEW)
- `test_missing_tsserver_fails_integrity`: `ok`
- `test_missing_node_binary_fails_integrity`: `ok`
- `test_valid_toolchain_passive_integrity`: `ok`
- `test_symlinks_prohibited_in_release_payload`: `ok`

### 2. `semantic_resources` (8 integration tests)
- `test_adaptive_sync_threshold_boundary`: `ok`
- `test_header_size_validation`: `ok`
- `test_resource_policy_defaults_match_phase01_spec`: `ok`
- `test_frame_size_validation`: `ok`
- `test_document_size_validation`: `ok`
- `test_linux_cgroup_invalid_session_id_fails_closed`: `ok` (NEW)
- `test_linux_cgroup_controller_portable_fallback_when_unavailable`: `ok`
- `test_cgroup_scope_attach_to_launch_spec`: `ok` (NEW)

### 3. `linux_release_manifest` (12 integration tests)
- `test_release_and_manager_state_versions_are_independent`: `ok`
- `test_role_projections`: `ok`
- `test_installed_release_accepts_v1_manifest_with_root_identity`: `ok`
- `test_manifest_rejects_group_writable_semantic_node`: `ok` (NEW)
- `test_manifest_accepts_valid_semantic_engine_entries`: `ok`
- `test_manifest_rejects_tsbuildinfo_disallowed_file`: `ok`
- `test_installed_release_rejects_unsupported_schemas`: `ok`
- `test_installed_release_rejects_v1_with_invalid_identity`: `ok`
- `test_manifest_rejects_non_executable_semantic_node`: `ok`
- `test_valid_manifest_roundtrip`: `ok`
- `test_v2_manifest_serialization_omits_api_identity`: `ok`
- `test_manifest_rejects_unknown_lib_path`: `ok` (NEW)

### 4. `--lib semantic::` (13 unit tests)
- `semantic::framing::tests::test_astral_unicode_byte_length`: `ok`
- `semantic::framing::tests::test_invalid_content_length_format`: `ok`
- `semantic::framing::tests::test_invalid_json`: `ok`
- `semantic::framing::tests::test_extra_headers_and_case_insensitivity`: `ok`
- `semantic::framing::tests::test_malformed_header_no_colon`: `ok`
- `semantic::framing::tests::test_body_too_large`: `ok`
- `semantic::framing::tests::test_split_frames_and_coalesced`: `ok`
- `semantic::framing::tests::test_encode_and_parse_simple`: `ok`
- `semantic::framing::tests::test_missing_content_length`: `ok`
- `semantic::framing::tests::test_duplicate_content_length`: `ok`
- `semantic::framing::tests::test_invalid_utf8`: `ok`
- `semantic::framing::tests::test_header_too_large`: `ok`
- `semantic::framing::tests::test_async_reader_writer_roundtrip`: `ok`

### 5. `semantic_child_process` (11 integration tests)
- `test_event_receiver_drop_triggers_cleanup`: `ok`
- `test_crash_reporting_and_reap`: `ok`
- `test_malformed_stdout_triggers_crashed_and_reap`: `ok`
- `test_handle_drop_triggers_cleanup`: `ok`
- `test_normal_lsp_lifecycle_and_reap`: `ok`
- `test_queue_overflow_protection`: `ok`
- `test_descendant_spawn_and_reap`: `ok`
- `test_fragmented_frame_handling`: `ok`
- `test_stubborn_descendant_forced_sigkill`: `ok`
- `test_stuck_shutdown_signal_escalation`: `ok`
- `test_stderr_flood_bounded_drain`: `ok`

---

## 3. Repeatability & Consecutive Runs

- **Run 1**: 55/55 passed across 5 targets (0 failed, 0 ignored).
- **Run 2**: 55/55 passed across 5 targets (0 failed, 0 ignored).
- Execution fully repeatable under identical conditions.

---

## 4. Process Table & Leaked Process Audit

- Baseline inspection: Two pre-existing unrelated system zombies (`rustdesk` PID 2224497, `python3` PID 3239081).
- Post-run snapshots: Checked via `ps -ef | grep -E 'cargo|test|semantic' | grep -v grep` and `ps aux | awk '$8 ~ /Z/'`.
- **Finding**: No matching lingering test processes or new zombies observed in post-run snapshots. Pre-existing zombies remained unchanged.

---

## 5. Scope Boundaries, Coverage & Acceptance Findings

1. **Requested scope result**: Requested five-target regression scope passed twice: 55/55 tests per run, zero failures or ignored tests. No new zombies or matching lingering test processes were observed.
2. **Cgroup hard controls**: Live hard-control enforcement was not demonstrated. Passing portable fallback and launch-spec attachment tests does not prove actual controller limits, pre-exec containment, or complete-tree teardown in an active delegated cgroup v2 environment.
3. **Packaging qualification**: Offline assembly, installation/update/rollback, and SBOM license validation were not exercised in this test run.
4. **Review closure**: Phase 03 acceptance remains unestablished: live cgroup enforcement and packaging qualification were not exercised, and closure of prior review findings requires separate code review and packaging verification.

---

## 6. Unresolved Questions

1. Will offline packaging assembly, update/rollback, and SBOM relationship validation be tested via an end-to-end integration/qualification suite prior to Phase 03 completion sign-off?
2. Does the target Linux test environment support live cgroup v2 controller delegation to validate real kernel hard limits (`memory.max`, `cpu.max`, `pids.max`) and pre-exec containment without fallback?
