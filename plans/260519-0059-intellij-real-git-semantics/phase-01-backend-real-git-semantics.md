# Phase 01: Backend Real Git Semantics

## Context Links

- Brainstorm: [../reports/brainstorm-260519-0043-intellij-git-operations.md](../reports/brainstorm-260519-0043-intellij-git-operations.md)
- Current Git architecture: [../../docs/system-architecture.md](../../docs/system-architecture.md)
- API docs: [../../docs/api-reference.md](../../docs/api-reference.md)

## Overview

Priority: P1  
Status: Completed 2026-05-19  
Goal: make Rust server execute Git mutations using real `git` porcelain semantics and explicit repo-state contracts.

## Key Insights

- Current app already has many Git endpoints.
- The failure is operation semantics, not missing UI controls.
- `drop_commit_files()` is too implicit: it rewrites history through detached checkout, reverse patch, amend, and rebase without strong recovery modeling.
- IntelliJ behavior is not "git2 everywhere"; it delegates low-level behavior to Git.

## Requirements

- Use `Command::new("git").args(...)`, never shell strings.
- Validate project path and pathspecs before running Git.
- Add operation preflight checks:
  - clean working tree when operation requires it
  - no active merge/rebase/cherry-pick unless operation is a recovery command
  - commit reachable from current branch when rewriting
  - pushed commit blocked for drop by default
- Return structured results for conflicts and recovery states.
- Add tests with real temporary Git repos, no mocks.

## Architecture

Extend current `server/src/git/cli_fallback.rs` into the primary porcelain executor for mutating operations:

- `run_git(args, cwd)` remains the low-level safe runner.
- Add helpers for `rev-parse`, `status --porcelain`, `merge-base`, `branch --show-current`, active operation detection, and pathspec-safe commands.
- Keep `server/src/git/diff.rs` for read/status/diff until a specific behavior mismatch appears.
- Move history mutation semantics out of UI assumptions and into backend result contracts.

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/git/cli_fallback.rs`: promote safe porcelain helpers.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/git/commit_file_ops.rs`: make drop behavior explicit and recoverable.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/git/repository.rs`: align reset/cherry-pick/drop helpers with porcelain contracts.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/git/types.rs`: add operation-state/result fields if needed.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/git.rs`: expose new result contracts.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/git/tests.rs`: add regression tests.

## Implementation Steps

1. Add repo-state preflight helpers:
   - `current_branch()`
   - `is_clean_worktree()`
   - `active_git_operation()`
   - `is_commit_reachable_from_head(hash)`
   - `is_commit_pushed(hash)`
2. Add `GitRecoveryState` result data for merge/rebase/cherry-pick in progress.
3. Refactor full commit drop:
   - For unpushed `HEAD`: use direct reset to parent after preflight.
   - For non-HEAD unpushed commit: use `git rebase --onto <hash>^ <hash> <branch>`.
   - For pushed commit: return blocked result recommending revert.
4. Keep selected-change drop as patch/amend/rebase only if tests prove it. Add explicit recovery state on failure.
5. Add safe revert endpoint primitives:
   - whole commit: `git revert <hash>`
   - selected files: apply inverse patch to working tree or staged state, not history rewrite.
6. Add tests:
   - drop HEAD commit
   - drop non-HEAD commit with descendants
   - block pushed drop
   - active rebase blocks new destructive op
   - selected file drop only changes selected path
   - conflict returns recoverable result, not generic error

## Todo List

- [x] Add preflight helper tests.
- [x] Refactor full drop commit away from selected-file shortcut.
- [x] Add pushed/shared history blocked result.
- [x] Add rebase/cherry-pick/merge detection.
- [x] Add selected-file drop regression tests.

## Success Criteria

- `cd server && cargo test git::tests::drop` passes.
- Full Git test suite passes.
- Drop commit produces deterministic repo state for HEAD and non-HEAD local commits.
- Failure states include actionable recovery information.

## Risk Assessment

- Rebase conflicts may leave repo mid-operation. Mitigation: detect and surface recovery state.
- Root commits are special. Mitigation: explicitly block initially.
- Force-push semantics are dangerous. Mitigation: block pushed drop by default.

## Security Considerations

- No shell interpolation.
- Validate relative paths and reject traversal.
- Do not expose arbitrary Git command execution through API.

## Next Steps

After backend contracts exist, update frontend mutation hooks and UI status handling in Phase 02.
