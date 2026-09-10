# Test Validation Report: Phase 02 PTY Root Identity & Input Admission

- Date: 2026-09-11
- Phase: Phase 02: PTY root identity, raw output counter, and input admission
- Target: `server` crate (`dam-hopper-server`)
- Status: PASSED (100% pass rate)

## Test Results Overview

| Test Command | Scope | Passed | Failed | Ignored | Filtered | Pass Rate |
|---|---|---|---|---|---|---|
| `cargo test --manifest-path server/Cargo.toml pty_activity_tests` | PTY activity & input admission unit/smoke tests | 8 | 0 | 0 | 945 | 100% |
| `cargo test --manifest-path server/Cargo.toml pty::` | All PTY module unit & integration tests | 159 | 0 | 1 | 793 | 100% |

Total across PTY suites: 159 passed, 0 failed, 1 ignored (`test pty::tests::pty_tests::codex_usage_enabled_and_disabled_pty_performance_is_equivalent` - pre-existing manual performance gate). 100% pass rate.

## Test Names Covered

### Targeted Phase 02 Suite (`pty_activity_tests`)
1. `pty::tests::pty_activity_tests::test_raw_output_sequence_increments_and_saturates`
   - Verifies raw output sequence increments monotonically and saturates at sentinel (`u64::MAX - 1`) without wrapping.
2. `pty::tests::pty_activity_tests::test_proc_stat_parser_and_self_probe`
   - Verifies `/proc/<pid>/stat` parsing with standard names, spaces, nested parentheses, and self-process probing under Linux.
3. `pty::tests::pty_activity_tests::test_activity_snapshot_incomplete_reasons`
   - Verifies activity snapshot correctly identifies completeness and marks incomplete reasons: counter saturated, uncertain qualification, and input revision saturated.
4. `pty::tests::pty_activity_tests::test_hydration_and_resize_does_not_advance_raw_output_counter`
   - Verifies terminal creation with initial scrollback hydration, terminal resize, and attach snapshot generation do not increment raw output sequence.
5. `pty::tests::pty_activity_tests::test_handoff_gate_rejects_write_without_recording_activity`
   - Verifies write operations during active host suspend handoff are rejected (`IdleSuspendHandoffInProgress`) and do not advance input revision. Write succeeds and increments revision after handoff release.
6. `pty::tests::pty_activity_tests::test_input_revision_advances_only_on_nonempty_input`
   - Verifies empty write is no-op (revision remains unchanged, watcher not notified); non-empty write advances input revision and notifies activity watcher.
7. `pty::tests::pty_activity_tests::test_reused_session_id_has_independent_output_counter`
   - Verifies re-created session reusing identical public session ID has independent monotonic counter; old session counter mutation does not leak into replacement session.
8. `pty::tests::pty_activity_tests::test_real_pty_root_activity_smoke_and_observation`
   - End-to-end smoke test with real child shell (`/bin/sh`): validates root process qualification, pid, start_ticks, input revision advancement on command write, and raw output counter advancement upon command execution.

### Activity Unit Suite (`pty::activity::tests`)
1. `pty::activity::tests::test_parse_proc_stat_standard`
2. `pty::activity::tests::test_parse_proc_stat_with_spaces_and_parentheses`
3. `pty::activity::tests::test_parse_proc_stat_invalid`
4. `pty::activity::tests::test_increment_raw_output_sequence_saturating`

### Broader PTY Suite (`pty::`)
- 159 tests passed covering buffer management, offset tracking, delta replay, session manager lifecycle, attach snapshots, tombstones, replacement semantics, restart policies, shell integration hooks, and event sinks.

## Build & Compiler Diagnostics
- 0 compiler errors.
- 0 compiler warnings after removing unused import (`MAX_LIVE_ROOTS_LIMIT`) and handling `must_use` results on `manager.kill(id)` in test harnesses.

## Phase 02 Acceptance Verification
- [x] Process identity probing: Linux `/proc/<pid>/stat` parser extracts `pid`, `comm`, `state`, `ppid`, `start_ticks` safely handling spaces/parentheses.
- [x] Root qualification: Live sessions track `RootQualification` (Qualified vs Uncertain).
- [x] Raw output tracking: Incarnation-bound `raw_output_sequence` advances on child output, saturates safely, not advanced by scrollback hydration, resize, or attach reads.
- [x] Input admission & gating: `write()` checks handoff gate and shutdown state before admitting input; empty input is no-op; nonempty input monotonically increments `input_revision` and updates `last_input_at`; failures roll back revision.
- [x] Activity watcher: Coalescing `tokio::sync::watch` channel invalidates on admitted input.
- [x] Activity snapshots: Captures fleet snapshot, input revision, and root process activity records with completeness guarantees.

## Unresolved Questions
- None.
