# Phase 01 -- Collapsible Sidebar

> Parent: [plan.md](./plan.md)
> Dependencies: None
> Docs: [codebase-summary](../../docs/codebase-summary.md)

## Overview

- **Date**: 2026-03-24
- **Description**: Add collapse/expand toggle to main sidebar. Collapsed = 48px icon rail, expanded = 240px full labels.
- **Priority**: P2
- **Implementation status**: done
- **Review status**: approved
- **Completed**: 2026-03-24

## Key Insights

- Sidebar rendered in two places: `AppLayout` (3 pages) and `TerminalsPage` (directly)
- Both must share collapsed state via localStorage
- lucide-react already installed -- use `ChevronsLeft`/`ChevronsRight` icons
- WorkspaceSwitcher impractical at 48px -- show folder icon only when collapsed

## Requirements

1. Toggle button at sidebar bottom (above ConnectionDot)
2. Collapsed: 48px, icons only, native `title` tooltips
3. Expanded: 240px (current), full labels
4. Smooth transition: `transition-all duration-200 ease-in-out`
5. Works on all 4 pages (Dashboard, Terminals, Git, Settings)

## Architecture

```
AppLayout / TerminalsPage
  └── Sidebar({ collapsed, onToggle })
        ├── WorkspaceSwitcher (hidden when collapsed, or folder icon)
        ├── NavLinks (icon + conditional label)
        ├── Toggle button (ChevronsLeft / ChevronsRight)
        └── ConnectionDot (always visible)
```

## Related Code Files

- `packages/web/src/components/organisms/Sidebar.tsx` -- main component
- `packages/web/src/components/templates/AppLayout.tsx` -- layout wrapper (Dashboard, Git, Settings)
- `packages/web/src/pages/TerminalsPage.tsx` -- renders Sidebar directly

## Implementation Steps

### 1. Update Sidebar.tsx

- Add props: `collapsed?: boolean`, `onToggle?: () => void`
- Replace `w-60` with `${collapsed ? "w-12" : "w-60"} transition-all duration-200 ease-in-out overflow-hidden`
- NavLinks: wrap label text in `{!collapsed && <span className="truncate">{label}</span>}`
- Add `title={label}` on each nav item for tooltip when collapsed
- WorkspaceSwitcher: `{!collapsed ? <WorkspaceSwitcher /> : <FolderIcon />}`
- Add toggle button before ConnectionDot:
  ```tsx
  <button onClick={onToggle} className="p-2 hover:bg-[var(--color-surface-2)] rounded">
    {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
  </button>
  ```
- Ensure `shrink-0` on sidebar to prevent flex shrinking

### 2. Update AppLayout.tsx

- Add state: `const [collapsed, setCollapsed] = useState(() => localStorage.getItem("devhub:sidebar-collapsed") === "true")`
- Toggle handler: flip state + `localStorage.setItem("devhub:sidebar-collapsed", String(!collapsed))`
- Pass to Sidebar: `<Sidebar collapsed={collapsed} onToggle={handleToggle} />`

### 3. Update TerminalsPage.tsx

- Same pattern as AppLayout: local state from localStorage, pass to Sidebar
- Sidebar is at line ~220: `<Sidebar collapsed={collapsed} onToggle={handleToggle} />`

## Todo

- [ ] Add `collapsed` + `onToggle` props to Sidebar component
- [ ] Conditional rendering: icon-only when collapsed, full when expanded
- [ ] CSS transition on sidebar width
- [ ] Toggle button with ChevronsLeft/ChevronsRight
- [ ] AppLayout: manage + persist collapsed state
- [ ] TerminalsPage: manage + persist collapsed state
- [ ] Verify all 4 pages render correctly in both states

## Success Criteria

- Sidebar collapses to 48px with smooth animation
- Icons visible with native tooltips when collapsed
- State persists across page navigation and app restart
- No layout shift or content overflow issues

## Risk Assessment

- **Low**: WorkspaceSwitcher dropdown may need adjustments when collapsed
- **Low**: Page content may need `min-width` guard if sidebar expands pushes content

## Security Considerations

None -- purely visual/layout change.

## Next Steps

Phase 02: Resizable Terminal TreeView
