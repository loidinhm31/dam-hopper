# Phase 01 object rewrite — cycle 2 validation report

## Test Results Overview

**Targeted tests: PASS, 17/17 (100%).** Both requested filters passed; `cargo check` passed.

| Command | Passed | Failed | Ignored | Filtered out | Test time |
|---|---:|---:|---:|---:|---:|
| `cargo test --manifest-path server/Cargo.toml git::tests::edit_commit_message -- --nocapture` | 16 | 0 | 0 | 1,660 | 0.13 s |
| `cargo test --manifest-path server/Cargo.toml git_get_and_edit_commit_message_api -- --nocapture` | 1 | 0 | 0 | 1,675 | 0.31 s |
| **Total executed** | **17** | **0** | **0** | — | — |

Filtered-out counts are Cargo's aggregate across the test binaries; they are not additional executed cases. Each filter ran once, so no flakiness conclusion.

The 16 engine cases exercised HEAD/older/root and descendant rewrites, dirty and pushed commits, detached/unborn/unreachable/active-operation rejection, manually resolved merge and octopus parent preservation, no-op reflog stability, stale-snapshot precedence, signatures/mergetag, non-UTF-8 encoding rejection, linked worktrees, graft/replace rejection, and malformed metadata. The API case exercised paired GET snapshot fields, stale-head rejection, and POST success.

## Coverage Metrics

Coverage was not collected; line, branch, and function percentages are **not measured**. No conclusion against an 80% threshold is possible.

## Failed Tests

None. 17 passed; 0 failed; 0 ignored.

## Performance Metrics

- Engine-filter test execution: 0.13 s.
- API-filter test execution: 0.31 s.
- No benchmark, memory, or leak run; no slow test identified in this small targeted run.

## Build Status

`cargo check --manifest-path server/Cargo.toml`: **PASS**, finished in 0.17 s, no warnings.

The test commands emitted warnings from unrelated test targets: unused `jsonwebtoken` imports in `tests/browser_debug_artifacts.rs` and `tests/idle_suspend.rs`, unused `chrono::Utc`, and dead `TestClaims` in `tests/idle_suspend.rs`. No test failed because of these warnings.

## Phase Acceptance Assessment

**Do not claim that every Phase 01 success criterion is verified 100% by this run.** The requested filtered tests pass 100%, and the phase file records implementation completion, but the formal success criteria include qualification outside these 17 cases. In particular, the specified actual-server smoke using a registered project plus selected `worktreePath`/`root` was not run; the API test is in-process and does not exercise those selectors or a started server.

Current targeted output also does not establish all listed cases, including a publication-time same-OID HEAD switch/tip race, lock/permission failure and uncertain `tx.commit()` behavior, successful edit reflog entry, exact raw author/committer/date and unknown-header preservation, invalid raw UTF-8 GET behavior, signed no-op/no-object-write, invalidated-mergetag consent/removal and malformed mergetag, unchanged non-UTF-8 descendant preservation, and missing/shallow-parent rejection. Thus these commands provide strong scoped regression evidence, not a full acceptance-matrix pass.

## Reviewer Follow-up

The current implementation includes the review's concrete parent-serialization allocation improvement (`write!` into the output buffer), reports observed symbolic-HEAD state on snapshot mismatch, and uses `tokio::task::spawn_blocking` for synchronous Git/ODB work. The review listed no critical/high findings. Its conditional module-size suggestion remains a maintainability consideration, not a Phase 01 correctness gate.

## Critical Issues

No failures or compile errors. **Acceptance evidence remains incomplete** for the qualification cases above; this is the only blocker to certifying every Phase 01 requirement.

## Recommendations / Next Steps

1. Run the plan-required started-server GET/POST smoke against a disposable registered project and selected worktree/root; inspect branch/ref, object/tree/parents, reflog, index/worktree bytes, unchanged remote ref, and stale-request result.
2. Add or run focused qualification for the listed publication race/error and raw-object/signature cases, especially those not represented by the current test names.
3. Collect scoped coverage only if a numeric coverage threshold is required; none was measured here.

## Unresolved Questions

None requiring product input. Technical qualification cases above remain outstanding before independently certifying all Phase 01 acceptance criteria.
