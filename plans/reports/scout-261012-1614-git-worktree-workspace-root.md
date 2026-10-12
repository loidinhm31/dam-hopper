# Preflight & Research: Git Panel Worktree Workspace Retention

## Context & Problem
- In Git, worktrees store `.git` as a file pointing to gitdir, or in monorepos/nested project directories `.git` is absent from subfolders.
- Currently, when switching a project to a worktree target (`useProjectTargetStore.selectTarget`), `WorkspacePage` propagates `projectTarget.target` (which includes `worktreePath`) to all three mounts of `WorkspaceGitPanel` (`terminalGitContent`, `leftTools.git`, and `compactGitSurface`).
- The backend and git operations for the Git panel (`/api/git/:project/roots`, `/api/git/:project/branches`, `/api/git/:project/log`) resolve against `worktreePath`, where `.git` is not an authentic root folder, leading to `GIT_NOT_INITIALIZED` or failure.
- The Git panel presents repository-wide branches, roots, commit history, and object-based commit mutations (message edit, squash, push), which belong to the configured project root.

## Scope Boundary
- Target files:
  - `packages/ui/src/components/pages/WorkspacePage.tsx`: Git panel mounts (`terminalGitContent`, bottom tool `git`, `compactGitSurface`) retain root project target and `${projectName}:root` key; `handleRevealGitCommit` allows matching root target when reveal request originates from any worktree in the project.
  - `packages/ui/src/lib/git-commit-reveal.ts`: `isGitCommitRevealRequestMatchingTarget` accommodates root `currentTarget` (`worktreePath == null`) matching any worktree within the same project.
  - `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`: commit reveal consumption permits worktree reveal requests matching project and profile when the panel operates at root.
  - Test suites: update browser test `packages/ui/browser-tests/project-worktree-target.browser.tsx` and unit tests in `WorkspacePageBlameReveal.test.tsx` and `WorkspacePage.test.tsx`.
- Non-goals:
  - Do not change `FileTree`, `EditorTabs`, or `SearchPanel` worktree scoping; they must still target the selected worktree.
  - Do not alter terminal PTY launch directory resolution (`worktreePath` remains bound for new shells).

## Side Effects & Risks
- Risk: Git blame commit reveal from a worktree editor tab could be rejected if target matching strictly compares `worktreePath`.
  - Mitigation: Allow root `currentTarget` to accept reveal requests for the same project/profile.
- Risk: Invalidation of Git queries across project root vs worktree cache keys.
  - Mitigation: Git queries in `WorkspaceGitPanel` remain scoped to `[profileId, project, null]`, ensuring steady cache keys.

## Testing Strategy
- Unit tests: `WorkspacePageBlameReveal.test.tsx` & `WorkspacePage.test.tsx`.
- Browser tests: `project-worktree-target.browser.tsx` proving `WorkspaceGitPanel` captures root target while `fileSearch`, `fsSubscription`, `explorerLanguageScan`, `media`, and terminals capture feature worktree target.
