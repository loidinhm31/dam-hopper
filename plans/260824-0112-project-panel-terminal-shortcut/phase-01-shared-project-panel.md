# Phase 01 — Shared Project panel in Terminal shell

## Context links

- [UI scout](../reports/scout-260824-0112-ui-worktree-terminal.md)
- [Project target architecture](../../docs/system-architecture.md)
- [Frontend components](../../docs/frontend-components.md)
- `packages/ui/src/components/pages/WorkspacePage.tsx`
- `packages/ui/src/components/organisms/ProjectInfoPanel.tsx`
- `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx`

## Overview

- Priority: P1
- Status: pending
- Goal: render the existing Project/worktree UI in the desktop Terminal floating tool panel.

## Key insights

- `ProjectInfoPanel` already owns the correct Worktrees disclosure and uses the shared target store.
- `TerminalFloatingToolPanel` already provides drag, resize, Escape, close, focus activation, and z-index behavior.
- `WorkspacePage` currently creates Project content only in IDE `rightTools`; Terminal has a generic panel request bridge that can carry one more target.

## Requirements

- Add a Terminal panel target `project` without changing Files overlay behavior.
- Project content must receive the same `projectName` and `projectTarget` as Explorer, Git, and IDE Project.
- Terminal toolbar must expose an accessible Project button.
- Repeated selection of the active Project target closes the floating tool; switching targets replaces the active tool.
- Escape, close, drag/resize, focus activation, and overlap z-index must keep existing behavior.
- Compact/mobile mode remains on its existing Project surface and does not render the desktop floating tool.

## Architecture

`WorkspacePage` creates one memoized Project content element. The IDE branch
passes it as `rightTools` id `project-info`; the Terminal branch passes it as
`projectContent`. `TerminalWorkspaceShell` resolves `activePanelId ===
"project"` to `{ label: "Project", content: projectContent }`, then uses the
existing `TerminalFloatingToolPanel`. `TerminalWorkspacePanelRequest` and
`TerminalPanelToolId` both include `project`; pure activation helpers keep
toggle semantics in one place.

## Related code files

Modify:

- `packages/ui/src/components/pages/WorkspacePage.tsx`
- `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx`
- `packages/ui/src/lib/terminal-workspace-panel.ts`
- `packages/ui/src/lib/ide-shell-layout.ts`
- `packages/ui/src/lib/reveal-active-file.ts`
- `packages/ui/src/components/templates/TerminalWorkspaceShell.test.tsx`
- `packages/ui/src/components/pages/WorkspacePage.test.tsx`
- `packages/ui/browser-tests/terminal-floating-panels.browser.tsx`
- `packages/ui/browser-tests/project-worktree-target.browser.tsx` if needed for the Terminal target scenario

Create/delete: none.

## Implementation steps

1. Extract the current `project-info` React element into a memoized
   `projectContent` value; preserve `data-testid`, lazy fallback, target key,
   project fallback, and launch-command callback.
2. Reuse `projectContent` in IDE `rightTools` and pass it to
   `TerminalWorkspaceShell`.
3. Extend the terminal panel ID/request unions and the shell's active-panel
   label/content switch with `project`.
4. Add a Project toolbar control that requests `project` through the existing
   nonce/activation bridge.
5. Extend IDE shortcut target resolution so a Project request maps to
   `project-info` and toggles the right tool without disturbing bottom panels.
6. Keep the generic floating panel's close/activation callbacks unchanged.

## Todo list

- [ ] Share Project content between IDE and Terminal branches.
- [ ] Add Project terminal request/button/label.
- [ ] Extend IDE target activation and pure helper tests.
- [ ] Confirm no duplicate Project query/polling tree is mounted.

## Success criteria

- Terminal desktop shows the Project panel as a draggable floating tool.
- Opening Worktrees and selecting a row calls the existing target store and remounts target-aware surfaces.
- Existing Files/Git/Ports/Fleet behavior and z-index tests remain green.

## Risk assessment

- A duplicated inline Project element could diverge from IDE behavior; use one memoized content value.
- Extending unions may expose stale test harness IDs; update all request fixtures explicitly.
- Project panel content is vertically dense in a floating frame; retain existing scroll container and generic panel constraints.

## Security considerations

No new authority or path handling. Worktree selection, unavailable-target
fallback, removal blockers, and API validation remain in `ProjectWorktreesSection`
and the existing target-aware server contract.

## Next steps

Implement Phase 02's shortcut/config field after the shell accepts Project
requests, then run the focused shell/page tests before browser validation.
