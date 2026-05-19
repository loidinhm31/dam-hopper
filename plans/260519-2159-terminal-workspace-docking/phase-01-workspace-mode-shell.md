# Phase 01: Workspace Mode Shell

## Context Links

- Overview: [./plan.md](./plan.md)
- Architecture: [../../docs/system-architecture.md](../../docs/system-architecture.md)
- Frontend docs: [../../docs/frontend-components.md](../../docs/frontend-components.md)

## Overview

Priority: P1  
Status: Completed 2026-05-19  
Goal: add explicit IDE/Terminal workspace mode state and UI shell boundaries without changing terminal behavior yet.

## Key Insights

- `WorkspacePage.tsx` currently owns terminal manager state and builds all tool windows.
- `IdeShell.tsx` owns top nav, activity bars, side rails, editor area, and bottom panel.
- Terminal mode should not be modeled as "bottom panel height = full page" because that fights existing shell layout.
- Terminal mode needs same top nav and same terminal manager state.

## Requirements

- Add workspace mode state:
  - allowed values: `ide`, `terminal`
  - localStorage key: `dam-hopper:workspace-mode`
  - fallback: `ide`
- Add mode toggle button in top nav.
- Preserve current IDE mode rendering exactly.
- Do not change terminal session creation/attach behavior in this phase.
- Make mode state easy for later shortcut and layout phases to consume.

## Architecture

Introduce a small workspace-mode boundary:

- `WorkspacePage` owns `workspaceMode` and `setWorkspaceMode`.
- `TopNav` receives optional `workspaceMode`, `onWorkspaceModeChange`, and `workspaceModeShortcutLabel`.
- `IdeShell` receives optional mode props and passes them to `TopNav`.
- Later phase can render a separate `TerminalWorkspaceShell` when mode is `terminal`.

Keep localStorage helpers close to `WorkspacePage` unless reused by more than one module. If logic grows past a few lines, extract `packages/web/src/lib/workspace-mode.ts`.

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/pages/WorkspacePage.tsx`: own mode state and pass mode props.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/templates/IdeShell.tsx`: accept/pass top-nav mode props.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/TopNav.tsx`: render workspace mode toggle.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/web/src/lib/workspace-mode.ts` only if helper extraction is cleaner.

## Implementation Steps

1. Define `WorkspaceMode = "ide" | "terminal"`.
2. Add safe localStorage load/save helpers.
3. Add `workspaceMode` state to `WorkspacePage`.
4. Add `toggleWorkspaceMode()` and `setWorkspaceMode()`.
5. Extend `IdeShell` props:
   - `workspaceMode?: WorkspaceMode`
   - `onWorkspaceModeChange?: (mode: WorkspaceMode) => void`
   - `workspaceModeShortcutLabel?: string`
6. Extend `TopNavProps` with same optional mode props.
7. Add compact segmented button or two-state button near project/git controls:
   - active `IDE`
   - active `Terminal`
   - title includes shortcut label if available.
8. Verify current IDE mode renders same when mode props absent or `ide`.

## Todo List

- [x] Add workspace mode type and persistence.
- [x] Add top nav mode toggle.
- [x] Wire mode state through `WorkspacePage` and `IdeShell`.
- [x] Verify no behavior change in IDE mode.

## Success Criteria

- Page boots in `ide` mode when no localStorage value exists.
- Toggling mode persists across reload.
- Invalid stored value is ignored and reset by next write.
- Existing navigation and project controls remain usable.

## Risk Assessment

- Top nav can become crowded. Mitigation: compact two-state control, hide text on smaller widths if needed.
- LocalStorage can throw. Mitigation: wrap load/save in try/catch.

## Security Considerations

- No server data or auth changes.
- Do not trust localStorage values; validate exact enum.

## Next Steps

Phase 02 adds configurable shortcut support for this mode state.
