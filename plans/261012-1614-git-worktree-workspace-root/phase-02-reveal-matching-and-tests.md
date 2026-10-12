# Phase 2: Qualification and Test Updates

## Objective
Update and qualify test suites ensuring:
1. `WorkspacePage` Git panel mounts retain project root target when worktree is switched.
2. `FileTree`, `SearchPanel`, `EditorTabs`, and terminal launch remain correctly bound to the selected worktree.
3. Commit reveal requests from worktree tabs are accepted by the root Git panel for the same project/profile.
4. Mismatched profile or project reveal requests are rejected.

## Changes
1. `packages/ui/browser-tests/project-worktree-target.browser.tsx`:
   - Split expectations:
     - FileTree subscription, search, explorer scan, media tickets, and terminal creation capture `featureTarget` (`{ project: PROJECT, worktreePath: FEATURE_PATH }`).
     - Git panel captures (`testState.captures.gitRoots`, `branches`, `gitLog`) capture the root target (`{ project: PROJECT }`).
2. `packages/ui/src/components/pages/WorkspacePageBlameReveal.test.tsx`:
   - Add test case verifying reveal request from a worktree tab (`worktreePath: "/tmp/wt"`) successfully opens and consumes in the root-scoped Git panel when targeting the same project.

## Acceptance Criteria
- `pnpm --filter @dam-hopper/ui test src/components/pages/WorkspacePageBlameReveal.test.tsx` passes.
- `pnpm --filter @dam-hopper/ui test src/components/organisms/WorkspaceGitPanelBlame.test.tsx` passes.
- `pnpm --filter @dam-hopper/ui test src/components/pages/WorkspacePage.test.tsx` passes.
- Vitest browser run passes.
