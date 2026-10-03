# Backend validation — Git squash

## Test results overview

**Integration-owner update:** After terminal review corrections, the latest squash unit suite passed 14 tests and the commit-message/squash/leased-publish API suites passed 20 tests. The broad server library suite passed 1,322, failed 2 notification/usage tests, and ignored 2; this broad gate is not green. See [integrated qualification](./qualification.md) for exact failures, actual full-stack smoke and resolved review findings. Counts below describe this independent validation slice's earlier observed source state.

Initial focused suites passed **79 tests, 0 failed, 0 ignored** across eight suites. After the parent changed commit-message snapshot reads, the latest-source targeted rerun passed **38 tests, 0 failed, 0 ignored** across three suites, including the new lock-contention regression. The latest source also passed `cargo check` and built the server executable target. The 38 latest-source tests overlap the original 79; counts below are kept separate. No broad server suite was run.

| Command / target | Result | Test time |
|---|---:|---:|
| `cargo test --manifest-path server/Cargo.toml --lib squash_commits` | 13 passed; 0 failed; 1,312 filtered | 0.46s |
| `cargo test --manifest-path server/Cargo.toml --lib git::tests::edit_commit_message` | 21 passed; 0 failed; 1,304 filtered | 0.15s |
| `auth_no_auth` | 13 passed; 0 failed | 3.95s |
| `git_commit_message_api` | 3 passed; 0 failed | 0.49s |
| `git_leased_publish_api` | 8 passed; 0 failed | 1.96s |
| `git_squash_api` | 7 passed; 0 failed | 0.82s |
| `project_worktree_lifecycle` | 4 passed; 0 failed | 0.05s |
| `workspace_targets` | 10 passed; 0 failed | 0.04s |

The six integration targets were run together in one invocation:

```bash
cargo test --manifest-path server/Cargo.toml --test git_squash_api --test git_commit_message_api --test git_leased_publish_api --test workspace_targets --test project_worktree_lifecycle --test auth_no_auth
```

Each command exited 0. The first unit-test compilation waited for Cargo's artifact-directory lock, then compiled in 1m26s; subsequent integration-target compilation took 8.05s.

## Post-change revalidation

After the initial passing checks, the parent changed `get_commit_message` snapshot reading to avoid read-side contention on Git ref locks and added `test_api_message_reads_do_not_contend_with_ref_locks`.

The first post-change API test attempt failed during compilation with two `E0277` errors because `git2::Error` from `repo.find_reference("HEAD")?` (line 338) and `repo.find_reference(&captured.branch)?` (line 339) could not convert to `AppError`. The parent fixed both by mapping the errors explicitly. I did not retry the unchanged failing state.

Latest-source rechecks after that fix:

| Command / target | Result | Test time |
|---|---:|---:|
| `cargo test --manifest-path server/Cargo.toml --test git_commit_message_api` | 4 passed; 0 failed; new lock-contention test included | 0.58s |
| `cargo test --manifest-path server/Cargo.toml --lib git::tests::edit_commit_message` | 21 passed; 0 failed; 1,304 filtered | 0.15s |
| `cargo test --manifest-path server/Cargo.toml --lib squash_commits` | 13 passed; 0 failed; 1,312 filtered | 0.52s |
| `cargo check --manifest-path server/Cargo.toml` | exited 0 | 6.14s |
| `cargo build --manifest-path server/Cargo.toml --bin dam-hopper-server` | exited 0 | 0.21s |

The targeted latest-source tests total 38 passing executions across three suites; the unit suites overlap with the initial run. Cargo reported an artifact-directory lock wait before rebuilding for the API test. `cargo check` completed the dev profile; the updated server binary target built. This establishes executable build readiness, not live HTTP/browser readiness; this validation slice did not launch the binary.

## Git/API evidence and uncertainty boundary

- The initial squash Git/ODB tests and API suites passed, including the authored real-repository and in-process Axum regressions. The leased-publish suite passed its bare-remote squash/lease cases; the auth, registered-worktree, nested-root, and target-ownership regressions also passed.
- `squash_commits_publication_uncertainty_does_not_claim_candidate_oids_installed` passed in the initial run, but this is **fault-injected uncertainty** at the test-only transaction-commit boundary after real ODB work/locks. It does not establish that a transaction-commit failure was naturally reproduced. No claim of natural publication uncertainty is made.
- Initial backend test fixtures (79 passing) exercised real temporary repositories and in-process Axum routes. The latest-source API lock-contention test also passed: concurrent message reads completed while HEAD and branch transaction locks were held.

## Build status

- Initial source state: `cargo check --manifest-path server/Cargo.toml` exited 0 in 19.97s; `cargo build --manifest-path server/Cargo.toml --bin dam-hopper-server` exited 0 in 0.27s.
- Latest integrated source after the parent's read-snapshot fix: `cargo check --manifest-path server/Cargo.toml` exited 0 in 6.14s and `cargo build --manifest-path server/Cargo.toml --bin dam-hopper-server` exited 0 in 0.21s. The current server executable target builds; this slice did not launch it or establish full-stack runtime readiness. Parent-owned isolated Axum/Vite/Chromium smoke remains separate.

## Coverage, performance, warnings, issues

- Coverage percentages were not collected; no coverage command was run.
- No benchmark or memory-leak run was performed. Cargo-reported focused test times are listed above.
- Initial test compilation emitted one warning: unused import `atomic::Ordering` at `server/src/pty/tests.rs:14:16` (`unused_imports`). The test target reported one generated warning. Post-change API test compiled without a reported warning; post-change unit test runs repeated the same unused-import warning. No test failed in either passing run.

## Unrun gates

- Full server test suite and broader repository gates were intentionally not run; parent may choose the broad gate after its full-stack acceptance checks.
- `cargo clippy`, `cargo fmt --check`, coverage, performance checks, and isolated live Axum/Vite/Chromium smoke were not run by this validation slice. No post-change focused backend check remains unrun.

## Unresolved questions

None. Live application startup and browser smoke remain the parent's separate qualification gate.