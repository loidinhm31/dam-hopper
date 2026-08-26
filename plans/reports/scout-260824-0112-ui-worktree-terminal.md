# Local scout: UI worktree panel in Terminal mode

## Findings

- `packages/ui/src/components/pages/WorkspacePage.tsx:1838-1878` defines the
  IDE right-side `project-info` tool. Its content renders `ProjectInfoPanel`
  with the active `projectTarget`.
- `packages/ui/src/components/organisms/ProjectInfoPanel.tsx:43-124` is the
  reusable Project panel. Its Worktrees section renders
  `ProjectWorktreesSection` and passes the current target plus visibility.
- `packages/ui/src/components/organisms/ProjectWorktreesSection.tsx:44-327`
  owns worktree discovery, target selection, add/remove, unavailable-target
  recovery, and removal blockers. It already uses the session target store and
  needs no Terminal-specific behavior.
- `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx:19-97`
  renders one generic `TerminalFloatingToolPanel` for the active
  `TerminalWorkspacePanelId` (`git`, `ports`, or `terminals`) and a separate
  Files overlay.
- `packages/ui/src/lib/terminal-workspace-panel.ts:1-39` contains the panel
  request/activation and z-index contracts. The generic floating tool already
  supports drag, resize, Escape, close, focus activation, and stacking.
- `WorkspacePage.tsx:2056-2136` builds the Files overlay content and
  `WorkspacePage.tsx:2157-2168` passes it into the Terminal shell.

## Recommended integration

1. Build one memoized `projectContent` element in `WorkspacePage` from the
   existing Project panel wrapper and reuse it for IDE `rightTools` and the
   Terminal shell.
2. Extend the Terminal workspace panel request/active-id union with `project`,
   pass `projectContent` to `TerminalWorkspaceShell`, and select the Project
   label/content in its existing generic floating panel.
3. Add a Project toolbar affordance next to Git/Ports/Fleet in Terminal mode;
   the keyboard shortcut should use the same request bridge.
4. Keep compact/mobile behavior unchanged; the current shortcut guard already
   no-ops for compact workspaces and compact surfaces already include Project.

## Tests to touch

- `packages/ui/src/components/pages/WorkspacePage.test.tsx`
- `packages/ui/src/components/templates/TerminalWorkspaceShell.test.tsx`
- `packages/ui/browser-tests/terminal-floating-panels.browser.tsx`
- Existing `project-worktree-target.browser.tsx` remains the source of truth for
  real target selection and propagation.

## Unresolved questions

- Product wording can be `Project panel` while the acceptance check should
  assert that its Worktrees selector is visible and selectable.
