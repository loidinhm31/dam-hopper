# Phase 05 Implementation Report: Sidebar project workspace rows

## Executed Phase
- Phase: phase-05-sidebar-project-workspace-rows
- Plan: plans/261106-0334-agent-hub-terminal-first-workspace/
- Status: completed

## Files Modified & Created
- `packages/ui/src/components/organisms/TraditionalProjectWorkspaceTree.tsx` (new, 97 lines)
- `packages/ui/src/components/organisms/TraditionalProjectWorkspaceTree.test.tsx` (new, 265 lines)
- `packages/ui/src/components/organisms/OpenProjectWorkspacePicker.tsx` (new, 260 lines)
- `packages/ui/src/components/organisms/OpenProjectWorkspacePicker.test.tsx` (new, 225 lines)
- `packages/ui/src/components/organisms/TraditionalTerminalProjectWorkspaceRow.tsx` (new, 331 lines)
- `packages/ui/src/components/organisms/TraditionalTerminalProjectWorkspaceRow.test.tsx` (new, 461 lines)
- `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx` (modified, 242 lines)
- `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx` (modified, 1545 lines)

## Tasks Completed
- [x] `p05-workspace-tree`: Per-project file tree region emitting owner-qualified float `file:open` payloads. Fails closed on missing or disconnected owner. File tree target matches `useProjectTarget` target for stable `explorerTreeScopeKey` persistence.
- [x] `p05-open-picker`: Presentational open-project workspace picker decoupled from TanStack Query. Groups by profile, marks open items, loading/empty states, keyboard listbox navigation.
- [x] `p05-workspace-row-navigator`: Workspace rows with sibling ARIA controls, compact worktree bar with 7-char commit chip, robust worktree error recovery preserving selector, collision-safe `useId` region IDs, and full P01 Navigator contract extension.

## Tests Status
- Unit tests: 72 passed across all 5 relevant test suites:
  - `TraditionalProjectWorkspaceTree.test.tsx`: 6 passed
  - `OpenProjectWorkspacePicker.test.tsx`: 5 passed
  - `TraditionalTerminalProjectWorkspaceRow.test.tsx`: 9 passed
  - `TraditionalTerminalProjectsNavigator.test.tsx`: 44 passed
  - `TraditionalTerminalWorktreeSelect.test.tsx`: 8 passed
- Type check: Clean (0 errors reported in Phase 05 files; two concurrent diagnostic items in `OsResourceHost.tsx` / `PaneContainer.tsx` / `editor.ts` owned by peer phases in Parallel Group A).

## Issues Encountered & Resolutions
- Missing worktree path fail-closed: strengthened `isWorktreeAvailable` to require positive matching, available, non-prunable worktree without query loading/errors.
- Worktree selector preservation: split base project Git capability from target-specific commit status query so selector remains available during worktree recovery.
- Collision-safe region IDs: backed disclosure `aria-controls` with component instance-local `useId()`.

## Next Steps
- P06 Display Integration: connect Agent Hub / `TraditionalTerminalProjectsDisplay` to forward `onOpenFile` to `dispatchIntent` and wire picker inventory.
