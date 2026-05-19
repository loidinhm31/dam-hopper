# Phase 03: Terminal Workspace Layout

## Context Links

- Overview: [./plan.md](./plan.md)
- Phase 01: [./phase-01-workspace-mode-shell.md](./phase-01-workspace-mode-shell.md)
- Phase 02: [./phase-02-configurable-mode-shortcut.md](./phase-02-configurable-mode-shortcut.md)

## Overview

Priority: P1  
Status: Completed 2026-05-20 00:33
Goal: render Terminal mode as a full workspace with terminal split view as the main tool and Fleet Terminal as the right control rail.

## Key Insights

- Current `terminalPanel` in `WorkspacePage` already contains launch form, save prompt, project info fallback, empty states, and `MultiTerminalDisplay`.
- Fleet Terminal is already a right tool definition using `TerminalTreeView`.
- Reusing the same terminal manager state is mandatory. Creating a second terminal manager would duplicate tabs/sessions.
- Terminal mode should not unmount `MultiTerminalDisplay` unnecessarily when switching modes if avoidable.

## Requirements

- Terminal mode layout:
  - top nav remains visible
  - main area = terminal panel full height
  - right rail = Fleet Terminal
  - no left activity bar/editor/bottom panel
- Fleet rail supports existing operations:
  - select project
  - select terminal
  - launch/kill terminal
  - launch profile/custom/suggested/free terminal
  - edit profiles/custom commands
  - save/remove free terminal
- Empty terminal workspace has clear launch CTA.
- Mode switching must not create duplicate PTY sessions.
- Terminal fit must run after mode switch.

## Architecture

Extract reusable render blocks from `WorkspacePage`:

- `terminalWorkspaceContent`: wraps current terminal panel content.
- `fleetTerminalContent`: wraps current `TerminalTreeView`.
- `renderNewTerminalAction`: shared fallback action.

Add a focused terminal-mode shell component:

- `TerminalWorkspaceShell`
  - props: top nav mode props, `terminalContent`, `fleetContent`
  - owns only layout widths/collapse for Fleet rail
  - uses same visual language as `IdeShell`

Keep this component in `packages/web/src/components/templates/TerminalWorkspaceShell.tsx` if non-trivial. Do not bloat `WorkspacePage`.

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/pages/WorkspacePage.tsx`: extract shared content and branch render by `workspaceMode`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/templates/TerminalWorkspaceShell.tsx`: terminal-first layout shell.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/templates/IdeShell.tsx`: only if top-nav props from Phase 01 need refinement.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/MultiTerminalDisplay.tsx`: add optional fit trigger prop only if resize observer is insufficient.

## Implementation Steps

1. Extract current `terminalPanel` body into a memoized `terminalContent`.
2. Extract current Fleet Terminal `rightTools[0].content` into memoized `fleetContent`.
3. Build IDE mode from existing `IdeShell` using `leftTools`/`rightTools` unchanged.
4. Build Terminal mode with `TerminalWorkspaceShell`.
5. In `TerminalWorkspaceShell`:
   - render `TopNav`
   - render main terminal content in `flex-1 min-w-0`
   - render right Fleet rail with persisted width key `dam-hopper:terminal-workspace-fleet-width`
   - include collapse/expand button for Fleet rail
6. Ensure mode switch focuses/fits active terminal:
   - rely first on existing ResizeObserver
   - if flaky, add `layoutRevision` prop to `MultiTerminalDisplay` and fit registry entries on change.
7. Add visible empty state:
   - "Terminal workspace"
   - "Open terminal"
   - shortcut hint for new terminal and mode toggle.

## Todo List

- [ ] Extract terminal and Fleet content from current tool arrays.
- [ ] Add `TerminalWorkspaceShell`.
- [ ] Branch workspace rendering by mode.
- [ ] Add Fleet rail resize/collapse.
- [ ] Confirm terminal fit on mode switch.

## Success Criteria

- IDE mode behavior is unchanged.
- Terminal mode fills available body below top nav.
- Fleet Terminal remains visible and functional.
- Switching modes keeps active terminal and selected Fleet item.
- Active terminal resizes correctly after switch.

## Risk Assessment

- `TerminalPanel` hidden keep-alive can remount if component tree changes too much. Mitigation: reuse same `terminalContent` and keep keys stable.
- Two shells may duplicate top-nav logic. Mitigation: keep shared props and do not fork nav internals.

## Security Considerations

- No new backend/API authorization paths.
- Existing terminal operations stay behind current transport/auth.

## Next Steps

Phase 04 improves split terminal docking UX inside the terminal workspace and existing IDE terminal panel.
