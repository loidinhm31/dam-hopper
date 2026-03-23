---
parent: plan.md
phase: "05"
status: done
completed: 2026-03-24
priority: P2
effort: 1h
depends_on: ["01", "02", "03", "04"]
---

# Phase 05: Cleanup & Integration

## Context

- Parent: [plan.md](./plan.md)
- Depends on: All previous phases
- Final phase

## Overview

Remove unused components (UnifiedCommandPanel, etc.), update DashboardPage to reflect new navigation, verify no stale references, and ensure the app is fully functional with the new page structure.

**Status:** pending | **Priority:** P2

## Key Insights

- UnifiedCommandPanel (580 lines) is fully replaced by ProjectInfoPanel + TerminalTreeView
- DashboardPage "Active Terminals" card should link to `/terminals`
- DashboardPage project count cards may need updated links (no longer /projects)
- Sidebar and App.tsx should already be clean from Phases 01 + 04

## Requirements

1. Delete UnifiedCommandPanel.tsx (replaced by ProjectInfoPanel + tree)
2. Delete any other orphaned components only used by deleted pages
3. Update DashboardPage: Active Terminals card → link to `/terminals`
4. Update DashboardPage: project-related cards → link to `/terminals` (or remove links)
5. Final codebase search for stale references
6. Run full build + lint

## Related Code Files

| File | Action |
| ---- | ------ |
| `packages/web/src/components/organisms/UnifiedCommandPanel.tsx` | Delete (replaced) |
| `packages/web/src/pages/DashboardPage.tsx` | Update links |
| `packages/web/src/App.tsx` | Verify clean |
| `packages/web/src/components/organisms/Sidebar.tsx` | Verify clean |

## Implementation Steps

1. Delete UnifiedCommandPanel.tsx
2. Search for any components only imported by deleted pages — delete them too
3. Update DashboardPage:
   - "Active Terminals" card → clickable, navigates to `/terminals`
   - "Total Projects" card → clickable, navigates to `/terminals`
   - "Clean Repos" / "Dirty Repos" cards → link to `/terminals` or keep non-clickable
4. Search codebase for stale references: `BuildPage`, `ProjectsPage`, `ProjectDetailPage`, `ProcessesPage`, `UnifiedCommandPanel`, `/build`, `/projects`, `/processes`
5. Run `pnpm build` and `pnpm lint`
6. Manual test: complete navigation flow

## Todo List

- [ ] Delete UnifiedCommandPanel.tsx
- [ ] Identify and delete other orphaned components
- [ ] Update DashboardPage card links
- [ ] Codebase search for stale references
- [ ] pnpm build + lint
- [ ] Manual test: Dashboard → Terminals (via card click)
- [ ] Manual test: all sidebar navigation works
- [ ] Manual test: no console errors

## Success Criteria

1. No orphaned component files remain
2. Dashboard cards link to appropriate pages
3. `pnpm build` and `pnpm lint` pass cleanly
4. Sidebar: Dashboard, Terminals, Git, Settings (4 items)
5. No stale imports or route references anywhere
6. No runtime console errors

## Risk Assessment

**Low**: Pure cleanup of already-replaced code.

## Security Considerations

None. Cleanup only.

## Next Steps

Plan complete. Future enhancements:
- Persistent bottom terminal panel (global, not page-scoped)
- Terminal split view (side-by-side terminals)
- Terminal search/filter in tree
- Session persistence across app restart
- Drag-and-drop tab reordering
- Resizable tree sidebar width
