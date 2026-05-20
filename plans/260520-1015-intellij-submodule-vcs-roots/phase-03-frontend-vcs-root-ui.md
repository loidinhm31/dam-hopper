# Phase 03: Frontend VCS Root UI

## Context Links

- Parent plan: [plan.md](./plan.md)
- Backend root operations: [phase-02](./phase-02-root-aware-git-operations.md)
- Existing Git panel: `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/WorkspaceGitPanel.tsx`

## Overview

Date: 2026-05-20
Priority: P1
Implementation status: Pending
Review status: Pending
Goal: make the Git panel usable for multi-root/submodule projects with explicit root context.

## Key Insights

- IntelliJ picks the current repository from the selected file/editor context, but still exposes other roots.
- DamHopper can start simpler: root selector plus grouped aggregate local changes.
- Parent gitlink rows must not pretend to be normal files.

## Requirements

- Add root selector to `WorkspaceGitPanel`.
- Add aggregate local changes grouped by root.
- Pass `rootId` through query hooks and mutation hooks.
- Keep branch/log/history views scoped to selected root.
- Show parent submodule rows with “Open root” behavior.
- Block commit UI when staged entries span multiple roots.

## Architecture

Frontend state:

- `selectedRootId`: defaults to `"."`.
- `rootMode`: selected root for history/branch controls; aggregate mode only for local changes if needed.
- Query keys include root id: `["git-diff", project, rootId]`, `["branches", project, rootId]`, `["git-log", project, rootId, ...]`.

Component changes:

- `WorkspaceGitPanel`: fetch roots, render selector, thread root to hooks.
- `GitLocalChanges`: group by `rootId`, render submodule entries distinctly, call mutations with root.
- `GitBranchControl`: branch actions against selected root.
- `GitHistoryActions`: history actions against selected root.

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/api/client.ts`: add `VcsRoot` and root-aware API methods.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/api/queries.ts`: add `useGitRoots` and root-aware hooks.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/WorkspaceGitPanel.tsx`: selector and root state.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/GitLocalChanges.tsx`: root grouping and mixed-root commit guard.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/GitBranchControl.tsx`: root-aware branch actions.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/GitHistoryActions.tsx`: root-aware mutations.

## Implementation Steps

1. Add `VcsRoot` type and `api.git.roots(project)`.
2. Add `useGitRoots(project)`.
3. Add root-aware params to Git hooks without breaking old call sites.
4. Render root selector near branch controls.
5. Update local changes to group entries by root label.
6. Render submodule rows with status text: dirty, commit changed, missing mapping, uninitialized.
7. Update mutation invalidation keys to include root id and invalidate parent root when a child commit may change gitlink state.
8. Add commit guard for mixed-root staged entries.

## Todo List

- [ ] Add root API client types.
- [ ] Add root selector.
- [ ] Root-scope branch/log/history views.
- [ ] Group local changes by root.
- [ ] Add mixed-root commit guard.
- [ ] Add frontend tests.

## Success Criteria

- User can select `embed-app/code-notes` and see its branch/history/local changes.
- Parent root still shows gitlink rows for submodule commit changes.
- Commit button message explains selected-root or mixed-root constraints.
- No full page reload is used for root changes.

## Risk Assessment

- UI can become noisy for many roots. Mitigation: compact selector, grouped local changes, and root-level counts.
- Existing tests may assume old query keys. Mitigation: keep default root and update tests intentionally.

## Security Considerations

- Frontend sends root IDs from server responses only.
- Do not let users type arbitrary root paths into Git action requests.

## Next Steps

Complete regression tests and documentation in Phase 04.
