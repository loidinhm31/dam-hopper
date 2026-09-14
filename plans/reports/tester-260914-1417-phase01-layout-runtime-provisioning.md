# Test Execution & Verification Report: Phase 01 Layout and Runtime Provisioning

**Date:** 2026-09-14 14:17  
**Scope:** Phase 01 — Layout and descriptor-relative runtime provisioning  
**Environment:** Linux x86_64  
**Working directory:** `server/`

## Test Results Overview

All four requested Cargo invocations exited successfully. Active execution pass rate: **100%**.

| Requested command | Test targets | Passed | Failed | Ignored | Filtered | Wall time | Status |
|---|---:|---:|---:|---:|---:|---:|---|
| `cargo test -p dam-hopper-server linux_release::api_runtime::tests` | 36 | 24 | 0 | 0 | 1,364 | 0.39s | PASS |
| `cargo test -p dam-hopper-server linux_release::layout::tests` | 36 | 2 | 0 | 0 | 1,386 | 0.37s | PASS |
| `cargo test -p dam-hopper-server --test idle_suspend_diagnostics_linux_smoke -- --ignored` | 1 | 1 | 0 | 0 | 0 | 0.34s | PASS |
| `cargo test -p dam-hopper-server` | 37 | 1,383 | 0 | 5 | 0 | 40.49s | PASS |
| **Aggregate invocation executions** | — | **1,410** | **0** | **5** | — | **41.59s** | **PASS** |

Aggregate counts are invocation executions, not unique-test counts; focused tests overlap with the full package run. Full package Cargo result: `1,383 passed; 0 failed; 5 ignored`.

## Phase 01 Scenario Coverage

### Canonical configuration and fixed layout

- `canonical_precedence_over_legacy`: valid canonical bytes/inode retained; legacy is not inspected or mutated.
- `canonical_invalid_content_refuses_without_mutation`: oversized, invalid UTF-8, and invalid TOML canonical content refuse safely.
- `missing_paths_are_created_with_final_metadata_and_valid_rerun_is_read_only`: fixed `/var`, `/var/lib`, API state directories, canonical `dam-hopper.toml`, and adjacent audit are created with expected type, UID:GID, mode, and seed/audit bytes; rerun preserves inode/content and performs no mutation.
- `every_preexisting_metadata_mismatch_refuses_without_mutation`: type, UID, GID, and mode mismatches across managed objects refuse without mutation.
- `special_files_are_refused_without_mutation`: symlink/other objects for canonical config and audit refuse safely.
- `test_canonical_and_legacy_paths_default_root` and `test_canonical_and_legacy_paths_with_root`: canonical config/audit and migration-only legacy paths resolve correctly for production and synthetic roots.

### Legacy migration and refusal handling

- `legacy_migration_copies_exact_bytes_and_preserves_legacy`: accepted root-owned `0644` legacy TOML is copied byte-for-byte; legacy inode, metadata, and contents remain unchanged; rerun is read-only.
- `legacy_metadata_mismatches_refuse_without_mutation`: unsafe legacy mode and non-root legacy parent ownership refuse before canonical creation.
- `legacy_migration_refuses_oversized_legacy_config`: >64 KiB source refuses.
- `legacy_migration_refuses_invalid_utf8_and_toml`: invalid UTF-8 and TOML refuse.
- `legacy_migration_refuses_relative_project_paths_without_mutation` and `legacy_migration_refuses_traversing_project_paths_without_mutation`: relative/traversing project roots refuse without canonical mutation.
- `root_identity_is_rejected_before_opening_the_trusted_root`: root API identity is rejected before filesystem traversal.

### Staged publication, race, and cleanup invariants

- `publication_failure_branches_clean_temp_before_rename`: write, file-sync, chown, and chmod failures clean the unpublished temporary and never publish canonical config.
- `race_condition_on_rename_no_replace_preserves_winner_and_cleans_temp`: no-replace race retains winner bytes and removes only the owned temporary.
- `sync_dir_failure_preserves_published_canonical_config`: post-publication directory-sync failure reports an error but retains complete canonical bytes; valid rerun is read-only.
- `unidentifiable_temp_creation_refuses_cleanup_and_retains_temp` and `unpublished_temp_replacement_refuses_cleanup_and_retains_temp`: uncertain/replaced temporary identity is retained, not guessed or deleted.
- `each_post_creation_failure_removes_only_call_created_objects`: reverse cleanup removes only objects created by the current call across chown/chmod/fstat failures.
- `cleanup_failure_reports_primary_and_cleanup_errors`: primary and cleanup failures are both surfaced.
- `cleanup_retains_nonempty_created_file` and `cleanup_retains_replacement_with_different_identity`: nonempty/replaced files are retained and reported.
- `existing_fifo_metadata_open_is_nonblocking_and_no_follow`: Linux special-file inspection is nonblocking and no-follow.
- `provision_to_start_seam_calls_starter_once_after_success_only`: starter runs exactly once after successful provisioning and never after refusal/failure.

### Diagnostics smoke

`test_idle_suspend_diagnostics_read_only_linux_smoke` passed when explicitly enabled. It validated secure diagnostics output shape/schema and permissions, and compared before/after host config, canonical server config, helper audit, server events, RTC wakealarm, and API/helper unit properties. No monitored state changed.

## Failed Tests

None. All requested commands reported zero failures and exit status 0.

## Coverage Metrics

Not generated. The requested commands did not invoke a Rust coverage instrumenter or define a line/branch/function threshold. Percentages not inferred from pass counts.

## Performance Metrics

- Focused API runtime and layout test processes: Cargo-reported test time `0.00s` each.
- Explicit Linux smoke Cargo-reported test time: `0.08s`.
- Full package library target: `1,123 passed; 1 ignored` in `23.18s`; integration targets added the remaining active tests/ignored cases.
- Full package wall time: `40.49s`.
- No timeout, hang, flake, or resource failure observed.

## Build Status

PASS. All requested commands completed using the Cargo test profile. No compiler warnings were present in the captured output. No release build, formatter, or linter was run because they were outside the requested scope.

## Critical Issues

None blocking. Phase 01 focused unit, layout, publication/refusal, no-mutation, and explicit Linux smoke checks are green.

## Recommendations / Next Steps

- Treat Phase 01 focused acceptance as ready for the next plan phase.
- Keep the explicitly ignored Linux diagnostics smoke in Linux release qualification; default full-package execution correctly leaves it ignored.
- Generate numeric coverage only if the project establishes a coverage instrumenter and threshold for this phase.

## Unresolved Questions

None for the requested verification scope.
