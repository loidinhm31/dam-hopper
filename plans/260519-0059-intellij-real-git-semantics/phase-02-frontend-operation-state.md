# Phase 02: Frontend Operation State

## Context Links

- Backend phase: [phase-01](./phase-01-backend-real-git-semantics.md)
- UI components: `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/`
- API client: `/mnt/data/ws/sharing/dam-hopper/packages/web/src/api/client.ts`

## Overview

Priority: P1
Status: Completed 2026-05-19
Goal: keep the current IntelliJ-like UI, but make operation state and cache refresh scoped and predictable.

## Key Insights

- Current Git UI already resembles IntelliJ enough to keep.
- The "whole app reload" is likely broad query invalidation and editor/file-tree churn, not browser reload.
- Git mutations need refresh scopes: file-only, commit-history, branch-wide, workspace-wide.

## Requirements

- No Git operation should call or indirectly require `window.location.reload()`.
- Local file rollback must not invalidate unrelated panels.
- Open editor tabs must be updated or marked stale after Git changes.
- Operation results must stay visible in the Git UI until dismissed or replaced.
- UI must distinguish blocked, conflict, dirty, and success states.

## Architecture

Introduce frontend operation refresh scopes without changing the visual structure:

- `file-local`: local rollback/stage/unstage/hunk discard.
- `history-local`: drop selected changes, revert selected changes.
- `branch-history`: drop commit, reset, cherry-pick, revert commit.
- `workspace`: branch checkout/worktree/config changes only.

These scopes should live in API/query helpers, not duplicated in components.

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/api/queries.ts`: replace broad invalidation with scope-based helpers.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/GitHistoryActions.tsx`: use structured backend result states.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/GitLocalChanges.tsx`: improve rollback/discard pending/error state.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/WorkspaceGitPanel.tsx`: keep selected commit stable after refresh where possible.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/stores/editor.ts`: add stale/open-file handling after Git mutation.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/CommitDetailsPanel.tsx`: keep existing visual UI, refine action availability.

## Implementation Steps

1. Add a small refresh helper in `queries.ts`:
   - `invalidateGitFileOperation(project, path)`
   - `invalidateGitHistoryOperation(project, affectedPaths)`
   - `invalidateGitBranchOperation(project)`
2. Update `useGitDiscard` and `useGitDiscardHunk` to avoid broad refresh.
3. Add editor integration:
   - if affected file tab is clean, reload content silently
   - if affected file tab is dirty, mark stale and show prompt
4. Update `GitHistoryActions` to render blocked/recovery/conflict state from backend result.
5. Preserve selected commit after refresh when commit still exists. Clear only when dropped.
6. Add tests for invalidation scope and status banner state.

## Todo List

- [x] Add refresh scope helper.
- [x] Narrow discard invalidation.
- [x] Add editor stale state.
- [x] Update Git history result banner.
- [x] Add frontend tests.

## Success Criteria

- Discard file updates Git diff and affected file UI only.
- File tree does not collapse unnecessarily.
- Open editor tab behavior is deterministic.
- Drop commit refreshes history without blanking unrelated workspace state.

## Risk Assessment

- Too narrow invalidation can leave stale UI. Mitigation: test each operation scope.
- Editor stale handling can be intrusive. Mitigation: only prompt for dirty tabs.

## Security Considerations

- Do not expose file paths outside current project in UI mutation payloads.
- Preserve existing auth/transport behavior.

## Next Steps

After state is stable, add IntelliJ-compatible safe/rewrite actions in Phase 03.

## Review Notes

- Current implementation covers the planned frontend operation-state work.
- Code review found branch-history rewrites did not reconcile open editor tabs; fixed with project-wide tab reconciliation for branch-level Git operations.
