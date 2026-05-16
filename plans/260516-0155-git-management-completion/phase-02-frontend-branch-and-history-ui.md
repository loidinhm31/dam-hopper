# Phase 02: Frontend Branch And History UI

## Context Links

- Parent plan: `./plan.md`
- Backend phase: `./phase-01-backend-git-operations.md`
- Research: `./research/ui-workflow-research.md`
- Existing UI: `WorkspaceGitPanel.tsx`, `GitLogTree.tsx`, `FileTree.tsx`, `ChangedFilesList.tsx`

## Overview

- Date: 2026-05-16
- Priority: P2
- Implementation status: DONE 2026-05-16 03:12
- Review status: APPROVED 2026-05-16 03:12
- Description: Add branch controls and history actions to existing Git surfaces.

## Key Insights

- `WorkspaceGitPanel` currently shows a static branch label.
- `FileTree` Explorer header is the selected location for branch controls.
- `ChangedFilesList` already has the stronger source-control UI; keep it and improve invalidation.
- `GitLocalChanges` duplicates local commit behavior on `GitPage`; avoid major redesign unless needed for API compatibility.

## Requirements

- Add reusable `GitBranchControl`.
- Use it in Git panel and Explorer header.
- Add create branch dialog.
- Add dirty checkout options dialog with Normal, Stash then checkout, Force checkout, Cancel.
- Add right-click context menu to history rows.
- Add reset dialog with Soft, Mixed, Hard, Keep copy exactly matching user intent.
- Invalidate all relevant query keys after Git mutations.

## Architecture

- API methods live in `client.ts`.
- React Query hooks live in `queries.ts`.
- Transport mappings live in `ws-transport.ts`.
- `GitBranchControl` owns branch list, current branch display, checkout action, create-branch dialog, and checkout dirty retry flow.
- `GitLogTree` should emit `onCherryPick(entry)` and `onReset(entry)` or accept action callbacks, keeping Git mutations outside the graph renderer when possible.

## Related Code Files

- Modify `packages/web/src/api/client.ts`
- Modify `packages/web/src/api/queries.ts`
- Modify `packages/web/src/api/ws-transport.ts`
- Modify `packages/web/src/components/organisms/WorkspaceGitPanel.tsx`
- Modify `packages/web/src/components/organisms/GitLogTree.tsx`
- Modify `packages/web/src/components/organisms/FileTree.tsx`
- Create `packages/web/src/components/organisms/GitBranchControl.tsx`

## Implementation Steps

1. Add TypeScript types for Git action requests/results and branch fields.
2. Add client methods and transport mappings.
3. Add mutation hooks with query invalidation:
   - `branches`
   - `project-status`
   - `projects`
   - `git-log`
   - `git-diff`
   - `git-conflicts`
   - `fs-tree`
4. Build `GitBranchControl` using existing `Select`, `Dialog`, and `Button` components.
5. Integrate `GitBranchControl` into `WorkspaceGitPanel`.
6. Integrate `GitBranchControl` into `FileTree` Explorer header.
7. Add history context menu in `GitLogTree`.
8. Add reset confirmation dialog and cherry-pick feedback in `WorkspaceGitPanel` and `GitPage` if both use `GitLogTree`.
9. Ensure text fits in compact side panels and no controls overlap on narrow widths.

## Todo List

- [x] Add client/transport contracts
- [x] Add React Query hooks
- [x] Create branch control
- [x] Add checkout dirty dialog
- [x] Add create branch dialog
- [x] Add history context menu
- [x] Add reset dialog
- [x] Integrate in Git panel and Explorer
- [x] Run web build/tests

## Success Criteria

- User can checkout branches from Git panel and Explorer header.
- User can create a new branch from current or selected base and checkout it.
- Dirty checkout gives the selected retry choices.
- User can cherry-pick a commit from history.
- User can choose reset Soft, Mixed, Hard, or Keep from history.
- Local changes, branch display, Git log, and Explorer tree refresh after mutations.

## Risk Assessment

- Query invalidation gaps can make UI look stale. Mitigate with broad invalidation for Git and fs tree keys.
- Context menus can be clipped in scroll containers. Use fixed positioning with viewport clamping like existing menus.
- Duplicate Git surfaces can drift. Keep mutation hooks and branch control shared.

## Security Considerations

- Frontend must clearly mark hard reset and force checkout as destructive.
- Do not hide Git errors; show concise backend messages.
- Do not auto-pop stashes after checkout.

## Next Steps

- Run Phase 03 validation after integration.
