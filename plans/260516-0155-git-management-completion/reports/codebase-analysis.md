# Codebase Analysis: Git Management Completion

Date: 2026-05-16

## Summary

DamHopper already has more Git support than the F-09 backlog entry implies. Commit creation and branch listing exist, but branch checkout/create, history mutation actions, and shared branch controls are incomplete.

## Existing Backend Shape

- `server/src/api/router.rs` registers existing Git routes:
  - bulk fetch/pull/push
  - worktrees
  - `GET /api/git/{project}/branches`
  - `POST /api/git/{project}/branches/update`
  - log, diff, stage, unstage, discard, conflicts, commit, commit-file diff
- `server/src/api/git.rs` handles branch listing, worktrees, log, and bulk operations.
- `server/src/api/git_diff.rs` handles diff/stage/unstage/discard/resolve/commit.
- `server/src/git/repository.rs` has `list_branches`, `update_branch`, and `get_log`.
- `server/src/git/diff.rs` has `commit_files`, but it only accepts a message and does not support amend.
- `server/src/git/cli_fallback.rs` already contains safe `git` CLI execution helpers and branch-name validation for worktree creation.

## Existing Frontend Shape

- `packages/web/src/api/client.ts`, `queries.ts`, and `ws-transport.ts` already expose commit, branches, log, diff, staging, and worktree methods.
- `ChangedFilesList.tsx` is the primary workspace source-control panel and already supports staging, unstaging, discard, paged untracked files, and inline commit.
- `GitLocalChanges.tsx` is a simpler Git-page local changes panel with duplicate commit behavior.
- `WorkspaceGitPanel.tsx` shows current branch as static text and embeds `GitLogTree`.
- `GitLogTree.tsx` renders the history graph but has no context menu.
- `FileTree.tsx` has an Explorer header with project label, hidden toggle, Lock mode controls, and file context menu.

## Gaps

- No branch checkout endpoint.
- No create branch endpoint.
- No cherry-pick endpoint.
- No reset endpoint.
- Commit endpoint lacks `amend`.
- No reusable branch control.
- No Git history context menu.
- File tree cannot change branches.
- Query invalidation after Git mutations is incomplete for status/log/branches/fs tree.

## Recommended Architecture

- Keep Rust service split:
  - general branch/history mutations in `server/src/git/repository.rs`
  - route handlers in `server/src/api/git.rs`
  - commit amend remains near `commit_files` in `server/src/git/diff.rs`, or a small commit helper can be extracted if file size demands it.
- Use `Command::new("git").args(...)`, never shell interpolation, for operations where Git CLI semantics are clearer than git2.
- Add a compact `GitBranchControl` React component and reuse it in `WorkspaceGitPanel` and `FileTree`.

## Unresolved Questions

None. User selected reset option dialog copy and checkout dirty behavior during planning chat.
