# Phase 01 object rewrite — validation report

## Test results overview

**Targeted result: PASS.** Both requested filtered test commands passed; server `cargo check` passed.

| Command | Passed | Failed | Ignored | Filtered | Wall time |
|---|---:|---:|---:|---:|---:|
| `cargo test --manifest-path server/Cargo.toml git::tests::edit_commit_message -- --nocapture` | 11 | 0 | 0 | 1,660 | 46.42 s |
| `cargo test --manifest-path server/Cargo.toml git_get_and_edit_commit_message_api -- --nocapture` | 1 | 0 | 0 | 1,670 | 1.23 s |
| **Total tests run** | **12** | **0** | **0** | — | — |

Filtered counts are Cargo's aggregate across 58 test suites for each invocation; they are not additional executed tests. No flaky behavior assessment: each filter ran once.

## Build and performance

- `cargo check --manifest-path server/Cargo.toml`: **PASS**, finished in 6.62 s (6.75 s wall time); no warnings.
- First test build emitted existing warnings in `tests/browser_debug_artifacts.rs` (unused `jsonwebtoken` imports) and `tests/idle_suspend.rs` (unused imports and dead `TestClaims`). Tests still passed.
- No dedicated benchmark, memory check, or coverage run; coverage percentages are **not measured**.

## Requirements exercised

- Engine tests cover HEAD edit/tree and author preservation, older/root descendant rewrite, dirty and pushed commit acceptance with remote OID unchanged, active-operation/detached/unreachable/empty-message blocks, a manually resolved merge tree, no-op/ref-log stability, stale expected snapshot precedence, `gpgsig` consent, non-UTF-8 encoding rejection, and linked-worktree branch handling.
- API test covers GET `{message, branch, headOid}`, stale `expectedHeadOid` response, and successful POST using the GET snapshot.
- Compilation/type checking passed.

## Phase acceptance status

**Cannot certify all Phase 01 requirements as met from this run.** The phase file still says Pending/0% and has all 01A–01E todo items unchecked (`plans/260929-2204-object-plumbing-commit-message/phase-01-object-rewrite.md:180-186`). The requested commands establish the above subset, not the full success matrix (`:188-216`).

Acceptance cases not exercised by these requested tests include:

- Actual started-server smoke with a registered project, selected `worktreePath`/`root`, and post-edit branch/reflog/index/worktree/remote-OID inspection. The API case is an in-process route test using a temporary repository; it does not use those selectors or run a server process.
- Real concurrent HEAD switch/tip advance between snapshot and publication; same-OID branch switch; branch-lock/ref-lock permission failures; failed-transaction uncertainty behavior; successful edit reflog verification.
- Non-first/side-only-parent and octopus histories; byte-exact author/committer/date and unknown-header preservation; full dirty index-byte/status comparison.
- `gpgsig-sha256`, signed no-op object-write absence, merge-tag removal/retention and malformed merge-tag fixtures.
- UTF-8 encoding-header retention, invalid raw target message bytes via GET, and non-UTF-8 untouched descendant bytes.
- Unborn HEAD, missing/shallow parents, replace/graft ambiguity, malformed raw headers, and comprehensive no-write assertions on blocked/error paths.

The source has a raw-object DAG rewrite and two-lock/one-ref transaction path, but presence of that code is not evidence for every matrix case. Complete the remaining phase qualification scenarios and the required actual-server smoke before marking Phase 01 complete. The requested `cargo fmt --check` and broader settled-change validation were not run here; project-wide validation remains with the integration owner.

## Critical issues and recommendations

1. **Phase completion gate remains open:** run the missing 01A/01C/01D/01E acceptance cases and record results before changing Pending status.
2. **Run actual-server GET/POST smoke** with selected project/worktree/root; verify stale request ordering and inspect refs, reflog, object/tree/parent data, index/worktree bytes, and unchanged remote ref.
3. **Coverage unknown:** collect scoped coverage when the integration owner runs the settled validation; no threshold conclusion can be made from these commands.

## Unresolved questions

None requiring product input. Technical qualification cases above remain outstanding.
