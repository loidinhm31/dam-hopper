# Phase 03: IntelliJ-Compatible Actions

## Context Links

- Backend semantics: [phase-01](./phase-01-backend-real-git-semantics.md)
- Frontend state: [phase-02](./phase-02-frontend-operation-state.md)

## Overview

Priority: P2
Status: Completed 2026-05-19
Goal: add missing IntelliJ-style action separation while keeping the current web UI.

## Key Insights

- IntelliJ distinguishes safe history preservation from destructive rewrite.
- DamHopper should not make "drop" the only answer for committed changes.
- Pushed commits should default to revert, not drop.

## Requirements

- Add "Revert Commit" as safe action for pushed/shared history.
- Add "Revert Selected Changes" separate from "Drop Selected Changes".
- Add "Undo Last Commit" to move last commit changes back to local changes.
- Keep destructive actions behind explicit confirmation.
- Show operation consequences in copy similar to IntelliJ.

## Architecture

Action groups:

- Local changes:
  - stage, unstage, rollback file, rollback hunk, commit, amend
- Safe committed-history actions:
  - revert commit
  - revert selected changes into worktree/staged changes
- Rewrite committed-history actions:
  - undo last commit
  - drop commit
  - drop selected changes
  - reset branch

UI can remain in `GitLogTree`, `CommitDetailsPanel`, and `GitHistoryActions`, but action labels and availability must map to backend operation safety.

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/git.rs`: add revert/undo routes.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/git/repository.rs`: implement revert and undo via Git porcelain.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/git/commit_file_ops.rs`: implement selected revert if not placed elsewhere.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/api/client.ts`: add typed API methods.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/api/ws-transport.ts`: map REST endpoints.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/api/queries.ts`: add mutation hooks.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/GitLogTree.tsx`: add safe/rewrite menu grouping.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/CommitDetailsPanel.tsx`: add selected revert action.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/GitHistoryActions.tsx`: add dialogs and handlers.

## Implementation Steps

1. Add backend `revert_commit(hash)` using `git revert <hash>`.
2. Add backend `revert_commit_files(hash, paths)`:
   - build selected commit patch
   - apply reverse patch to worktree
   - leave changes uncommitted by default
3. Add backend `undo_last_commit(mode)`:
   - default mixed reset to `HEAD~1`, preserving changes as unstaged
   - optional soft variant later
4. Update history context menu:
   - Pushed commit: show Revert, disable Drop by default
   - Unpushed commit: show Drop and Revert
   - HEAD: show Undo Last Commit
5. Update selected-file context menu:
   - Revert Selected Changes
   - Drop Selected Changes only when unpushed and clean preflight passes
6. Add confirmation dialogs with exact consequence copy.

## Todo List

- [ ] Add revert commit endpoint and tests.
- [ ] Add revert selected changes endpoint and tests.
- [ ] Add undo last commit endpoint and tests.
- [ ] Update menu grouping and labels.
- [ ] Add confirmation dialogs.

## Success Criteria

- Pushed commits have a safe revert path.
- Drop remains available for local rewrite only.
- Selected revert does not rewrite history.
- UI labels match operation semantics.

## Risk Assessment

- Selected revert patches can conflict. Mitigation: return recoverable result and keep changes visible.
- Undo last commit on root commit unsupported. Mitigation: explicit block.

## Security Considerations

- Same path validation as other commit-file operations.
- No arbitrary Git args exposed.

## Next Steps

Verify operation matrix and update docs in Phase 04.
