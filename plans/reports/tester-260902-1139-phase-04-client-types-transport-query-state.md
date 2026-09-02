# Phase 04 Test Report — Client Types, Transport, and Query State

- **Scope:** `packages/ui` Phase 04 tests plus full UI suite and Rust server suite
- **Overall status:** PASS — 0 failures in all requested test commands
- **Phase 04 gate:** PASS for the requested behavioral test contract

## Test Results Overview

| Command | Test files/targets | Discovered | Passed | Failed | Ignored/skipped | Test duration | Wall time |
|---|---:|---:|---:|---:|---:|---:|---:|
| `pnpm --filter @dam-hopper/ui exec vitest run src/api/workflow-types.test.ts src/api/ws-transport.test.ts src/api/workflow-queries.test.tsx --reporter=verbose` | 3 | 51 | 51 | 0 | 0 | 181 ms | 1.32 s |
| `pnpm --filter @dam-hopper/ui test` | 215 | 1,452 | 1,452 | 0 | 0 | 14.16 s | 10.37 s |
| `cargo test` (from `server/`) | 14 targets | 909 | 907 | 0 | 2 | 10.70 s library; 1.53 s workflow API | 20.07 s |

Pass rates:

- Targeted Phase 04 UI tests: **100% (51/51)**
- Full UI suite: **100% (1,452/1,452)**
- Rust server executed tests: **100% (907/907)**; two existing tests reported ignored, zero failed
- Combined executed tests: **100% (2,410/2,410)**

## Targeted Phase 04 Coverage Breakdown

The targeted JSON reporter rerun confirmed the per-file assertion counts:

| Test file | Passed | Failed | Behavioral areas |
|---|---:|---:|---|
| `workflow-types.test.ts` | 13 | 0 | Plan-first hierarchy, status/resource predicates, factual tracked-task progress, ISO/session timestamps, elapsed formatting, deterministic item ordering |
| `ws-transport.test.ts` | 30 | 0 | Existing transport contracts plus workflow overview/events/item/session/resource/note/purge REST mapping, URL encoding, HTTP methods, and request bodies |
| `workflow-queries.test.tsx` | 8 | 0 | Workflow query-key root/generation, profile hash isolation, UUID request IDs, overview/events hooks, successful mutation invalidation, failure preservation, all mutation wrappers |

The full UI run expands this to 1,452 passing assertions across all 215 UI test files. The Rust workflow integration target inside `cargo test` passed all 8 tests, covering Plan-first/hierarchy behavior, overview, session lifecycle and notes, invalid transitions, replay/CAS, event pagination/history purge, validation limits, unknown projects, and auth enforcement.

## Rust Target Breakdown

- `src/lib.rs` unit tests: **825 passed, 1 ignored**
- `src/main.rs` unit tests: **0 passed**
- `tests/auth_no_auth.rs`: **12 passed**
- `tests/browser_debug_artifacts.rs`: **4 passed**
- `tests/codex_app_server_compatibility.rs`: **1 passed, 1 ignored**
- `tests/fs_mutate.rs`: **9 passed**
- `tests/fs_sandbox.rs`: **13 passed**
- `tests/fs_upload.rs`: **9 passed**
- `tests/fs_write_streaming.rs`: **5 passed**
- `tests/project_worktree_lifecycle.rs`: **4 passed**
- `tests/workflow_api.rs`: **8 passed**
- `tests/workspace_targets.rs`: **10 passed**
- `tests/ws_fs_subscribe.rs`: **7 passed**
- Doc-tests: **0 passed**

Ignored tests are existing environment/performance gates:

1. `pty::tests::pty_tests::codex_usage_enabled_and_disabled_pty_performance_is_equivalent` — manual PTY performance gate.
2. `codex_0146_schema_proves_thread_list_cannot_exclude_content` — requires pinned local Codex 0.146.0 binary.

## Source Coverage Metrics

Formal line/branch/function coverage was **not generated**:

- UI coverage attempt: `pnpm --filter @dam-hopper/ui exec vitest run --coverage` failed before test execution because `@vitest/coverage-v8` is not installed.
- No `cargo-llvm-cov`, `cargo-tarpaulin`, or `grcov` executable is available in this checkout.
- Counts above are test/assertion execution coverage, not source-coverage percentages.

## Build / Runtime Status

- Rust `cargo test` compiled the test profile successfully and completed all targets.
- UI Vitest transform/import/runtime execution completed successfully for both targeted and full suites.
- No production UI build was run; it was outside the requested validation commands.

## Warnings / Issues

- Targeted query-hook tests emit the non-failing React warning: `The current testing environment is not configured to support act(...)`. All assertions still pass.
- No test failures, blocking defects, or flaky outcomes observed. The targeted set also passed on the JSON-reporter rerun used for the per-file breakdown.

## Recommendations / Next Steps

1. Add `@vitest/coverage-v8` as a pinned UI dev dependency (or configure an approved provider) if formal source coverage percentages are required.
2. Provision/pin Codex 0.146.0 in CI if the currently ignored compatibility test must execute.
3. Decide whether the React `act(...)` environment warning should be cleaned up before treating warning-free output as a release requirement.

## Unresolved Questions

- Should CI install a pinned UI coverage provider and enforce line/branch/function thresholds for Phase 04?
- Should CI provision Codex 0.146.0 to execute the ignored compatibility test?
- Is the existing React `act(...)` environment warning acceptable for this phase, or should the Vitest setup be updated?
