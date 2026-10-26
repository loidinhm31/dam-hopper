# QA Test Report: Phase 03 — Pinned Tool Provisioning and Resource Controls

- **Date**: 2026-10-23
- **Operation**: `run` (code validation)
- **Scope**: Phase 03 test suite execution
  1. `cargo test --manifest-path server/Cargo.toml --test semantic_tool_profile`
  2. `cargo test --manifest-path server/Cargo.toml --test semantic_resources`
  3. `cargo test --manifest-path server/Cargo.toml --test linux_release_manifest`
  4. `cargo test --manifest-path server/Cargo.toml --lib semantic::`
  5. `cargo test --manifest-path server/Cargo.toml --test semantic_child_process`
- **Authority**: Execution and reporting only; zero code, test, or CI edits authorized.
- **Policy/Procedure Loaded**:
  - `~/.omp/agent/skills/test/references/test-principles.md`
  - `~/.omp/agent/skills/test/references/code-validation.md`
  - Monorepo rules (`.omp/evcrate/AGENTS.md`)

---

## 1. Test Results Overview

| Target / Suite | Total Run | Passed | Failed | Skipped / Ignored | Not Selected (Filtered) | Duration | Status |
|---|---|---|---|---|---|---|---|
| `semantic_tool_profile` | 9 | 9 | 0 | 0 | 0 | 0.00s | **PASS** |
| `semantic_resources` | 6 | 6 | 0 | 0 | 0 | 0.00s | **PASS** |
| `linux_release_manifest` | 10 | 10 | 0 | 0 | 0 | 0.00s | **PASS** |
| `--lib semantic::` | 13 | 13 | 0 | 0 | 1,466 | 0.00s | **PASS** |
| `semantic_child_process` | 11 | 11 | 0 | 0 | 0 | 8.55s | **PASS** |
| **Total per run** | **49** | **49** | **0** | **0** | **1,466** | **8.55s** | **PASS (100%)** |

*Note: 1,466 tests filtered out in `--lib semantic::` were unselected server unit tests, not skipped or passing.*

---

## 2. Individual Test Breakdown

### 1. `semantic_tool_profile` (9 integration tests)
- `test_supported_languages_and_extensions`: `ok`
- `test_missing_tsls_entrypoint_fails_integrity`: `ok`
- `test_valid_toolchain_passive_integrity`: `ok`
- `test_missing_package_json_fails_integrity`: `ok`
- `test_non_executable_node_binary_fails_integrity`: `ok`
- `test_missing_node_binary_fails_integrity`: `ok`
- `test_digest_verification`: `ok`
- `test_missing_tsserver_fails_integrity`: `ok`
- `test_symlink_escaping_release_root_fails_integrity`: `ok`

### 2. `semantic_resources` (6 integration tests)
- `test_frame_size_validation`: `ok`
- `test_adaptive_sync_threshold_boundary`: `ok`
- `test_document_size_validation`: `ok`
- `test_resource_policy_defaults_match_phase01_spec`: `ok`
- `test_header_size_validation`: `ok`
- `test_linux_cgroup_controller_portable_fallback_when_unavailable`: `ok`

### 3. `linux_release_manifest` (10 integration tests)
- `test_release_and_manager_state_versions_are_independent`: `ok`
- `test_role_projections`: `ok`
- `test_manifest_accepts_valid_semantic_engine_entries`: `ok`
- `test_installed_release_accepts_v1_manifest_with_root_identity`: `ok`
- `test_manifest_rejects_non_executable_semantic_node`: `ok`
- `test_installed_release_rejects_unsupported_schemas`: `ok`
- `test_manifest_rejects_tsbuildinfo_disallowed_file`: `ok`
- `test_installed_release_rejects_v1_with_invalid_identity`: `ok`
- `test_v2_manifest_serialization_omits_api_identity`: `ok`
- `test_valid_manifest_roundtrip`: `ok`

### 4. `--lib semantic::` (13 unit tests)
- `semantic::framing::tests::test_body_too_large`: `ok`
- `semantic::framing::tests::test_duplicate_content_length`: `ok`
- `semantic::framing::tests::test_invalid_content_length_format`: `ok`
- `semantic::framing::tests::test_encode_and_parse_simple`: `ok`
- `semantic::framing::tests::test_astral_unicode_byte_length`: `ok`
- `semantic::framing::tests::test_extra_headers_and_case_insensitivity`: `ok`
- `semantic::framing::tests::test_invalid_utf8`: `ok`
- `semantic::framing::tests::test_malformed_header_no_colon`: `ok`
- `semantic::framing::tests::test_missing_content_length`: `ok`
- `semantic::framing::tests::test_split_frames_and_coalesced`: `ok`
- `semantic::framing::tests::test_header_too_large`: `ok`
- `semantic::framing::tests::test_invalid_json`: `ok`
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

Executed two consecutive full-suite runs:
- **Run 1**: 49/49 passed across 5 targets (0 failures, 0 ignored).
- **Run 2**: 49/49 passed across 5 targets (0 failures, 0 ignored).
- Test execution was fully repeatable under identical conditions.

---

## 4. Process Table & Leaked Process Audit

- Baseline inspection: Two pre-existing system zombies observed prior to test execution (`rustdesk` PID 1405142, `python3` PID 3239081).
- Post-test inspection: Process table inspected via `ps -ef` and `ps aux | awk '$8 ~ /Z/'`.
- **Finding**: No new matching test processes or new zombies were observed after either run. Pre-existing zombies remained unchanged.

---

## 5. Scope Boundaries & Coverage Caveats

1. **Pass Rate vs Coverage**: Pass rate is 100% (49/49). Code coverage percentage was not measured.
2. **Cgroup Hard Controls**: Live delegated cgroup hard-control enforcement was not demonstrated by this run; `test_linux_cgroup_controller_portable_fallback_when_unavailable` verified portable fallback when cgroups are unavailable.
3. **Packaging Qualification**: Packaged offline installation/update/rollback, archive creation, and SBOM verification were not exercised in this test run and belong to deployment qualification.
4. **Conclusion**: **Requested test scope passed** (49/49 tests).

---

## 6. Unresolved Questions

- None for the executed test commands. Live cgroupv2 delegation qualification remains deferred to environment with active systemd/cgroup delegation authority.
