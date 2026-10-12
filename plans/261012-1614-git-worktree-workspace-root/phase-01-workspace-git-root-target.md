# Phase 1: WorkspacePage Git Panel Root Target Definition & Mounts

## Objective
Decouple `WorkspaceGitPanel` mounts in `WorkspacePage.tsx` from `projectTarget` worktree path, ensuring that when worktrees are switched, the Git panel in Workspace stays bound to the project root.

## Changes
1. `packages/ui/src/components/pages/WorkspacePage.tsx`:
   - Compute `rootGitTarget`:
     ```ts
     const rootGitTarget = useMemo<ProjectTargetRef | undefined>(() => {
       if (!projectName) return undefined;
       return activeProfileId
         ? { profileId: activeProfileId, project: projectName }
         : { project: projectName };
     }, [activeProfileId, projectName]);
     ```
   - Compute `isRootGitAvailable`: check if project is configured and connection is available (`Boolean(projectName && (!activeProfileId || workspaceConnection?.status === "connected"))`).
   - Use `rootGitTarget` and key `${activeProfileId ?? "ambient"}:${projectName}:root` for:
     - `terminalGitContent`
     - `leftTools` bottom tool `"git"`
     - `compactGitSurface`
   - In `handleRevealGitCommit`: validate `request.target.project === projectName`, verify owner matches `currentOwner`, and check `isRootGitAvailable`.

2. `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`:
   - When consuming `revealRequest`:
     - If `targetRef.worktreePath == null`: verify `revealRequest.target.project === targetRef.project` and (if present) `revealRequest.target.profileId === targetRef.profileId`.
     - If `targetRef.worktreePath != null`: verify exact `projectTargetKey(revealRequest.target) === projectTargetKey(targetRef)`.

## Acceptance Criteria
- `WorkspaceGitPanel` in `WorkspacePage` always receives `target` with `worktreePath: undefined`.
- When switching worktrees, the Git panel does not remount with worktree target or query Git endpoints using worktreePath.
- TypeScript compiles cleanly.
