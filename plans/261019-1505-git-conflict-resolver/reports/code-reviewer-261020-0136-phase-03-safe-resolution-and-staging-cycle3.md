# Code Review — Phase 03 Safe Resolution & Staging (Cycle 3)

Score: **7.0/10** (cycle 2: 6.5). 1 critical open (undo_last_commit guard released before mutation), 5 warnings.

## Scope
- Files: `git/mutation_coordination.rs`, `git/conflict_resolve.rs` (637 LOC), `git/diff.rs`, `git/repository.rs`, `git/commit_file_ops.rs`, `git/commit_message_rewrite.rs`, `git/squash_commits.rs`, `git/types.rs`, `git/mod.rs`, `git/tests.rs`, `api/git_diff.rs`, `tests/git_conflict_exact_staging.rs`, `tests/git_conflict_discovery_api.rs`, phase-03 plan.
- Focus: cycle-2 fixes C1, W1, W3, W7, W8, W9.

## Fix verification
| Item | Status | Evidence |
|---|---|---|
| C1 keying via commondir | OK | `try_acquire_for_repo` reads `<gitdir>/commondir`, canonicalizes → linked worktree + main share key; else canonical gitdir. git2 0.19 has no `Repository::commondir()` so manual parse justified. |
| C1 writer coverage | **PARTIAL** | Guard present: checkout_branch, reset_to_commit, cherry_pick, drop_commit, revert_commit, cherry_pick/drop/revert_commit_files, squash_commits (inside spawn_blocking, held across rewrite), edit_commit_message (idem), stage/unstage/discard_file/discard_hunk/commit_files, apply_conflict_resolution (guard held through oracle). **undo_last_commit: guard scoped to inner block → dropped before `reset --mixed HEAD~1`.** No nested acquire/self-deadlock found (create_branch→checkout_branch acquires once only). |
| W1 `Delete {}` | OK | `types.rs:585`, `deny_unknown_fields`; test rejects `"delete"+extraField` and top-level unknown; passes. |
| W3 IndexSide bounds | OK | stage ∈ {2,3} else FailedBeforeWrite; side/stage mismatch; Missing → FailedBeforeWrite; Unsupported kind → Unsupported; `byte_size > MAX_STAGE_BYTES` → Unsupported; before any write. |
| W7 DTO deletion | OK (Rust) | Rust `ConflictFile`, `get_conflicts`, `read_blob_utf8`, `resolve_conflict`, re-exports, legacy test removed; no refs left. UI `client.ts:2443 ConflictFile` remains (plan: Phase 05 owns). |
| W9 oracle helpers | OK, weak | `verify_applied_oracle` / `verify_deleted_oracle` extracted, 3 call sites reduced. File still 637 LOC (was 646). |
| W8 CUT1 preflight | OK, partial | trimmed `./` + exact path stages 1-3 + directory prefix over unmerged entries; mixed batch test passes, no entry staged. |

## Critical
1. **C1 residual — `repository.rs:1561-1574` `undo_last_commit`**: `_guard` lives in the `{ ... }` block returning `(head_hash, parent_count)`; released before `is_commit_pushed`/`active_git_operation` awaits and the `run_git(["reset","--mixed","HEAD~1"])` mutation at :1608. The actual index+ref writer is uncoordinated; head/parent_count checked under lock are TOCTOU vs. the reset. Fix: hoist `repo` + `_guard` to function scope (like `reset_to_commit`) — guard is `Send`, safe across `.await`.

## Warnings
- W-A **Coverage proof thin**: only test is `stage_files` blocked while an external guard is held. No test for linked-worktree key sharing (create `git worktree add`, acquire via main repo, assert acquire via linked repo is rejected) — the actual C1 fix has zero evidence. No async writer (checkout/cherry-pick/reset/undo) contention test; this would have caught the undo bug.
- W-B **Other app writers uncoordinated** (plan todo lists them): `pull`, `update_branch`, `create_branch` (no-checkout path), `delete_branch`, `fetch` (ref writes), cli_fallback continue/abort/merge/rebase/stash/worktree ops. Decide: cover or document explicitly as out-of-scope with rationale; plan todo #1 must not be ticked until then.
- W-C **CUT1 perf/shape** (`diff.rs:663-684`): for each path, `index.iter()` over whole index (clones every entry; O(P×N) allocs) inside nested loop. Single pass: collect unmerged (flags&0x3000) paths once into a Vec/set, then test each selected path (exact/prefix). The preceding three `get_path(…,1..3)` are subsumed. Normalization still partial: trailing `/` (`dir/`), `a//b`, `a/./b`, `.`/`""` pathspec, Windows `\` not handled. Mitigated because `add_path` rejects dirs and `safe_join` pre-validates, but add one test for dir-prefix + `./`.
- W-D **W9 incomplete vs <200 LOC rule**: `conflict_resolve.rs` 637 LOC; `apply_conflict_resolution` ≈ 437-line fn. `verify_applied_oracle` and `verify_deleted_oracle` duplicate repo-reopen/index-reload/4-stage-lookup (~25 lines). Extract one `open_verify_index(root)` + `stage_presence`, and split file (e.g. `conflict_resolve_oracle.rs`, per-action handlers `apply_reviewed_text/apply_index_side/apply_delete`).
- W-E **Tests**: no positive parse test for `{"type":"delete"}` (only rejection); no apply-level W3 gating tests (oversized stage, stage/side mismatch) — plan todo #6 still open; `test_injected_stage_failure_after_worktree_write` relies on `chmod 0555 .git` → false failure under root.

## Suggestions
- `clippy::redundant_closure_call` at `conflict_resolve.rs:562` (and 466, 614): replace `(|| {…})()` with direct calls/`?` in helper fn.
- `try_acquire_for_repo` swallows canonicalize errors into raw path → key divergence possible if canonicalize fails once; prefer error/Unavailable.
- Guard error type `&'static str` → typed error to avoid repeated `AppError::Unavailable(e.to_string())` boilerplate (≈15 sites); add `GitMutationCoordinator::acquire_app(repo, path) -> Result<_, AppError>` (DRY).
- Per-gitdir index lock vs commondir ref lock: commondir key serializes all worktrees (conservative, fine); document in module doc.
- Docs: update `docs/codebase-summary.md` mutation-coordination note once W-B resolved.

## Positive
- Serialization shape (`deny_unknown_fields`, `rename_all_fields`), truthful outcome taxonomy, oracle re-open after drop(index/repo), atomic write w/ nonce temp, guard kept through verification.
- stage_files preflight before any `add_path`; index written once at end (all-or-nothing).
- Legacy Rust resolver fully retired, no shims.

## Validation
| Command | Result |
|---|---|
| `cargo test --lib -- git::` (server) | 203 passed, 0 failed |
| `cargo test --test git_conflict_exact_staging --test git_conflict_discovery_api` | 10 + 11 passed |
| `cargo clippy --all-targets` (filtered to touched files) | warnings only: redundant_closure_call (conflict_resolve), pre-existing commit_message_rewrite (`unnecessary_unwrap`, `write_with_newline`); no errors |
| not run | full workspace tests, UI tsc/eslint, `cargo fmt --check` (repo-wide drift pre-existing) |

## Recommended actions
1. Fix `undo_last_commit` guard scope (critical).
2. Add linked-worktree key test + async writer contention test (checkout/undo).
3. Decide/record scope for pull/update_branch/branch create/delete/cli_fallback ops.
4. Single-pass CUT1 preflight + dir-prefix/`./` test.
5. Collapse oracle helpers, split `conflict_resolve.rs`.
6. Add W3 gating + positive `delete` parse tests; guard root-euid test.

## Unresolved questions
1. Are `pull`/`update_branch`/branch create-delete/cli_fallback continue-abort ops in Phase 03 scope or deferred to Phase 04 (operation lifecycle)?
2. Should coordinator contention surface as 409/503 consistently (`AppError::Unavailable` mapping) for app writers vs `ResolveOutcome::Busy` for resolver — confirm API contract.
3. CI runs as root? (affects `.git` 0555 injection test).
