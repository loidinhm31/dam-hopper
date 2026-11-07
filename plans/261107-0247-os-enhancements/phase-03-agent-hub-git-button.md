# Phase 03: Agent Hub Git Float Button

## Objective
Add a dedicated button in Agent Hub header and contextual project areas to open Git as a floating window for the active/selected project.

## Target Files
- `packages/ui/src/os/agent-hub/AgentHubHeader.tsx`
- `packages/ui/src/os/agent-hub/AgentHubHeader.test.tsx`
- `packages/ui/src/os/apps/AgentHubApp.tsx`
- `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx`

## Changes
1. **`AgentHubHeader.tsx`**:
   - Add `onOpenGit?: () => void;` to `AgentHubHeaderProps`.
   - Place Git button in the header right-hand action cluster between `Recipes` and `Files`.
   - Icon: `GitBranch` from `lucide-react`.
   - Enabled when `selectedGroup?.projectName` is non-empty; disabled with tooltip when no project selected.
   - Accessible label: `Open Git panel (${selectedGroup.projectName})` when project selected; `Open Git panel (no project selected)` when null.
2. **`TraditionalTerminalProjectsDisplay.tsx`**:
   - Add `onOpenGit?: () => void;` to `TraditionalTerminalProjectsDisplayProps`.
   - Add contextual Git button on the empty project terminal surface (beside New Terminal and Recipes).
   - Add compact header Git icon button (44x44px touch target) for compact/mobile view.
3. **`AgentHubApp.tsx`**:
   - Define `handleOpenGit`:
     - Dispatches `createIntent("git:status", { profileId: selectedGroup.profileId, projectId: selectedGroup.projectName, worktreeId: selectedWorktree ?? undefined, mode: "float" }, window.id)`.
   - Passes `onOpenGit={handleOpenGit}` to `AgentHubHeader` and `TraditionalTerminalProjectsDisplay`.
4. **`AgentHubHeader.test.tsx`**:
   - Test rendering of Git button:
     - Disabled when `selectedGroup` is null.
     - Enabled with correct aria-label and triggers `onOpenGit` when clicked.

## Acceptance Criteria
- Unit tests in `AgentHubHeader.test.tsx` pass.
- Dispatched intent matches `{ profileId, projectId, worktreeId, mode: "float" }`.

## Implementation Status
- **Status**: Completed
- **Date**: 2026-11-07
- **Report**: `plans/reports/phase-03-261107-0308-agent-hub-git-button.md`
- **Validation**:
  - `pnpm --filter @dam-hopper/ui exec vitest run src/os/agent-hub/AgentHubHeader.test.tsx` (6/6 passed)
  - `pnpm --filter @dam-hopper/web exec tsc --noEmit` (0 errors)
  - `pnpm --filter @dam-hopper/ui exec vitest run src/os/` (459/459 passed across 49 test files)
