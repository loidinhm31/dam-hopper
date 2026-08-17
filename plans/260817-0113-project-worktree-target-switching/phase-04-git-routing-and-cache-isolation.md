# Phase 04 — Git routing and cache isolation

## Context links

- [Plan](./plan.md)
- [Phase 01](./phase-01-target-contract-and-resolution.md)
- [Phase 03](./phase-03-session-selection-and-discovery.md)
- [Architecture](../../docs/system-architecture.md#project-worktree-targets-planned)

## Overview

- Date: 2026-08-17
- Description: Route status, branches, logs, diffs, commits, conflicts, and decorations to the selected target without conflating nested repositories.
- Priority: P2
- Implementation status: completed
- Review status: completed

## Key Insights

- Existing Git `root` identifies a nested repository relative to the operation root; it cannot represent the project worktree.
- React Query keys and invalidation must include target identity or data will bleed across worktrees.
- Top-bar branch data should follow the selected target while the top-bar project selector does not.

## Requirements

- Add optional target input to every project-root Git API while preserving nested `root` separately.
- Resolve the target before applying nested-repository validation.
- Partition status, branch, root, log, diff, untracked, commit, conflict, and decoration caches by `targetKey`.
- Invalidate only affected target caches after mutations, with explicit project-wide invalidation where required.
- Keep worktree management operations anchored to the configured repository.

## Architecture

Git addressing becomes `(project, target, nestedRoot?)`. The Phase 01 resolver supplies the target repository root; existing nested-root checks then operate beneath it. Query keys use the same ordering so cache identity mirrors backend resolution.

## Related code files

- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/api/git.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/api/git_diff.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/git/repository.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/git/vcs_roots.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/api/client.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/api/queries.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/lib/git-fs-invalidation.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/organisms/ChangedFilesList.tsx`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/organisms/GitBranchControl.tsx`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/api/queries-git-diff.test.ts`

## Implementation Steps

1. Inventory every Git endpoint/query/mutation and add target before optional nested root in its contract.
2. Resolve target roots server-side, then reuse current nested-repository containment and Git command adapters.
3. Centralize target-aware query key factories and update mutation invalidation/decorations.
4. Route Git panel, changed files, diff/commit/conflict actions, and top-bar branch control through selected target.
5. Ensure worktree list/add/remove/prune still use the configured repository context, not the selected worktree as a new project identity.
6. Add tests with identical branches/paths but different status in root and worktrees, including a nested repository case.

## Todo list

- [x] Extend all Git API contracts with target identity.
- [x] Preserve nested-root validation as an independent axis.
- [x] Partition query keys and invalidation by target.
- [x] Route all Git UI surfaces and branch control.
- [x] Add cross-target and nested-root regressions.

## Success Criteria

- Git panels immediately reflect the selected worktree and never show another target's cached result.
- Branch checkout/commit/diff operations affect only the requested target.
- Nested repository selection continues to work within each target.
- The top-bar project remains stable while its branch control follows target selection.

## Validation notes

- Git/status/diff/commit/conflict/branch requests carry validated `ProjectTargetRef` before nested-root handling.
- REST/WebSocket target payloads, target-key cache partitioning, target-only invalidation, Fetch/Pull target lists, and stage/unstage status invalidation complete.
- Worktree-vs-nested-root coverage complete. QA validation passed server format/check/tests, UI build, lint, and diff checks; see `plans/reports/qa-260817-1052-project-worktree-target-validation.md`.

## Risk Assessment

- Missing one query key or invalidation path can produce stale cross-target UI; central factories reduce this risk.
- Worktree management invoked from a selected worktree could compute incorrect main identity; keep it configured-root anchored.
- Concurrent Git changes may race refreshes; mutation completion must invalidate the exact target.

## Security Considerations

- Validate nested roots only after target resolution and canonical containment.
- Never concatenate raw target or nested-root values into shell command strings.
- Preserve current auth and SSH credential boundaries for each Git endpoint.

## Next steps

Phase 5 editor/diff isolation and Phase 6 terminal target identity remain deferred.
