# Phase 02: Create WorkspacePage with Tabbed Sidebar

## Context
- Parent: [plan.md](./plan.md)
- Depends on: [Phase 01](./phase-01-extract-terminal-hook.md) (useTerminalManager hook)

## Overview
- **Priority:** P1
- **Status:** Pending
- **Description:** Create `WorkspacePage` component that replaces both IdePage and TerminalsPage. Uses IdeShell's 3-panel layout with a tabbed left sidebar (Files / Terminals) and conditionally shows editor based on `ide_explorer` feature flag.

## Key Insights
- IdeShell already accepts `tree`, `editor`, `terminal` as ReactNode props — composable
- Left panel needs tab switcher: Files tab (FileTree) + Terminals tab (TerminalTreeView)
- When `ide_explorer` disabled: hide Files tab, hide editor panel, terminal fills right side
- Both FileTree and TerminalTreeView have independent local state (expanded nodes) — no conflict
- Project selector in FileTree and terminal tree must share `activeProject` state

## Requirements
- Tabbed left sidebar with Files (gated by ide_explorer) and Terminals tabs
- Active project shared between file tree and terminal tree
- Editor panel: EditorTabs (existing, gated by ide_explorer)
- Terminal panel: placeholder for Phase 03 (use TerminalDock initially)
- Feature-flag degradation: without ide_explorer, show terminal-only layout (no editor, no file tree)

## Architecture

```
WorkspacePage
├── useFeatureFlag("ide_explorer")
├── useTerminalManager(searchParams, setSearchParams)
├── useEditorStore (existing)
├── useState: activeProject, leftTab ("files" | "terminals")
│
├── IdeShell (when ide_explorer enabled)
│   ├── tree: <LeftPanel>
│   │   ├── TabSwitcher: [Files, Terminals]
│   │   ├── if files: <FileTree project={activeProject} />
│   │   └── if terminals: <TerminalTreeView ... />
│   ├── editor: <EditorTabs />
│   └── terminal: (Phase 03 — MultiTerminalDisplay)
│
└── Terminal-only layout (when ide_explorer disabled)
    ├── Sidebar
    ├── TerminalTreeView (left)
    ├── resize handle
    └── MultiTerminalDisplay (right, full height)
```

## Related Code Files
- **Create:** `packages/web/src/components/pages/WorkspacePage.tsx` (~180 LOC)
- **Create:** `packages/web/src/components/molecules/SidebarTabSwitcher.tsx` (~40 LOC)
- **Modify:** `packages/web/src/components/templates/IdeShell.tsx` — add optional `hideEditor` prop for terminal-only mode
- **Keep unchanged:** FileTree, TerminalTreeView, EditorTabs, MultiTerminalDisplay

## Implementation Steps

1. Create `SidebarTabSwitcher` molecule — simple tab bar (Files | Terminals icons + labels)
2. Modify IdeShell to support optional editor hiding:
   - Add `hideEditor?: boolean` prop
   - When true: skip editor pane + vertical resize handle, terminal fills full right panel
3. Create `WorkspacePage`:
   - Import useTerminalManager, useEditorStore, useFeatureFlag
   - Share `activeProject` state between file tree + terminal operations
   - Compose left panel with SidebarTabSwitcher + conditional FileTree/TerminalTreeView
   - Pass EditorTabs as editor prop (gated)
   - Pass TerminalDock as terminal prop (temporary — Phase 03 upgrades this)
4. Handle inline forms (launchForm, savePrompt, freeTerminalSavePrompt) — render above terminal panel or as overlay
5. Verify layout works at various viewport sizes
6. Run `pnpm lint` and `pnpm build`

## Todo
- [ ] Create SidebarTabSwitcher component
- [ ] Add hideEditor prop to IdeShell
- [ ] Create WorkspacePage with feature-flag branching
- [ ] Integrate shared activeProject state
- [ ] Wire TerminalTreeView callbacks from useTerminalManager
- [ ] Verify lint + build

## Success Criteria
- WorkspacePage renders correctly with both tabs
- Files tab shows FileTree (when ide_explorer on)
- Terminals tab shows TerminalTreeView with all interactions
- Editor displays when ide_explorer on, hidden when off
- Layout responsive and handles resize properly
- `pnpm build` passes

## Risk Assessment
- **Medium:** Two independent tree components sharing a panel — must handle state isolation (expanded nodes) correctly
- **Low:** IdeShell modification for hideEditor — small, backward-compatible change

## Security Considerations
- Feature flag check must remain — no accidentally exposing file system when disabled

## Next Steps
- Phase 03 replaces TerminalDock with full multi-terminal in bottom panel
