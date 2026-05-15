# Phase 01: Backend Git Operations

## Context Links

- Parent plan: `./plan.md`
- Scout: `./scout/git-files-scout.md`
- Research: `./research/git-operation-semantics.md`
- Existing routes: `server/src/api/router.rs`
- Existing Git modules: `server/src/api/git.rs`, `server/src/api/git_diff.rs`, `server/src/git/repository.rs`, `server/src/git/diff.rs`

## Overview

- Date: 2026-05-16
- Priority: P2
- Implementation status: DONE 2026-05-16 02:20
- Review status: pending
- Description: Add missing backend Git operations needed by F-09 and history context actions.

## Key Insights

- `POST /api/git/{project}/commit` already exists but only accepts `message`.
- `GET /api/git/{project}/branches` already exists.
- CLI fallback is appropriate for checkout/reset/cherry-pick because Git CLI semantics are mature and easier to match exactly.
- Existing tests use real temp repos and should be extended instead of mocked.

## Requirements

- Add `amend?: boolean` to commit request.
- Add checkout endpoint with strategy support: `normal`, `stash`, `force`.
- Add create branch endpoint.
- Add cherry-pick endpoint.
- Add reset endpoint with `soft`, `mixed`, `hard`, `keep`.
- Return structured action results for dirty/conflict states.
- Validate project path through existing `state.project_path`.
- Validate branch names and commit hashes before invoking Git.

## Architecture

- Route handlers live in `server/src/api/git.rs`, except commit remains in `git_diff.rs`.
- Git operation functions live in `server/src/git/repository.rs` unless commit-specific.
- Add shared result type in `server/src/git/types.rs`:
  - `ok`
  - `message`
  - `branch`
  - `hash`
  - `stashed`
  - `conflict`
  - `dirty`
- Use `tokio::task::spawn_blocking` for blocking git2 helpers and async command execution for CLI helpers.
- Do not introduce shell command strings.

## Related Code Files

- Modify `server/src/api/router.rs`
- Modify `server/src/api/git.rs`
- Modify `server/src/api/git_diff.rs`
- Modify `server/src/git/repository.rs`
- Modify `server/src/git/diff.rs`
- Modify `server/src/git/types.rs`
- Modify `server/src/git/mod.rs`
- Modify `server/src/git/tests.rs`

## Implementation Steps

1. Add Git action request/result structs.
2. Expose or duplicate branch validation in a shared private helper; keep validation rules aligned with `cli_fallback.rs`.
3. Implement `create_branch(project_path, name, start_point, checkout)`.
4. Implement `checkout_branch(project_path, branch, start_point, create, strategy)`.
5. Implement `cherry_pick(project_path, hash)`.
6. Implement `reset_to_commit(project_path, hash, mode)`.
7. Extend `commit_files` or add `commit_index(project_path, message, amend)` to support amend.
8. Register new routes in `router.rs`.
9. Add tests for success, dirty, conflict, force/hard safety, and validation failures.

## Todo List

- [ ] Add backend types
- [ ] Add Git operation helpers
- [ ] Add route handlers
- [ ] Extend commit amend
- [ ] Add route registrations
- [ ] Add Rust tests
- [ ] Run focused backend tests

## Success Criteria

- All new endpoints work against real temp Git repos.
- Existing commit, diff, branch list, worktree, fetch/pull/push behavior remains compatible.
- Dirty checkout returns structured dirty result unless strategy resolves it.
- Cherry-pick conflict returns structured conflict result.
- Invalid branch names and invalid hashes are rejected before command execution.

## Risk Assessment

- Hard reset and force checkout are destructive. Mitigate with explicit frontend confirmation and clear backend mode names.
- Stash checkout can leave recovery state. Mitigate by returning `stashed: true` and not auto-popping.
- Remote branch checkout naming can collide with local branches. Frontend should prefer existing local branch if present.

## Security Considerations

- Never execute Git through a shell.
- Validate branch names and hashes.
- Keep all operations scoped to the resolved project path.
- Do not expose arbitrary command arguments through request payloads.

## Next Steps

- Implement Phase 02 after endpoints and client contracts are stable.
