---
parent: plan.md
phase: "01"
status: done
completed: 2026-03-24
priority: P1
effort: 30m
depends_on: []
---

# Phase 01: Remove Redundant Pages

## Context

- Parent: [plan.md](./plan.md)
- Depends on: none
- Next: Phase 04 (after 02, 03 also complete)

## Overview

Delete BuildPage, ProjectsPage, ProjectDetailPage, and ProcessesPage. Remove their routes and sidebar nav items. These pages are being replaced by the unified Terminals page in Phase 04.

**Status:** done | **Priority:** P1

## Key Insights

- BuildPage (86 lines) — redundant with UnifiedCommandPanel
- ProjectsPage (~200 lines) — project browsing moves to tree view
- ProjectDetailPage (370 lines) — project info moves to context-switching panel
- ProcessesPage (87 lines) — terminal management moves to tree view
- All pages are leaf components with no cross-dependencies between them
- UnifiedCommandPanel.tsx is still useful as reference but will be superseded by the new components

## Requirements

1. Delete 4 page files
2. Remove all routes for `/build`, `/projects`, `/projects/:name`, `/processes` from App.tsx
3. Remove corresponding nav items from Sidebar.tsx
4. Keep only: Dashboard (`/`), Git (`/git`), Settings (`/settings`) + Terminals (`/terminals` — added in Phase 04)
5. Temporarily, sidebar will have 3 items until Phase 04 adds Terminals

## Related Code Files

| File | Action |
| ---- | ------ |
| `packages/web/src/pages/BuildPage.tsx` | Delete |
| `packages/web/src/pages/ProjectsPage.tsx` | Delete |
| `packages/web/src/pages/ProjectDetailPage.tsx` | Delete |
| `packages/web/src/pages/ProcessesPage.tsx` | Delete |
| `packages/web/src/App.tsx` | Remove 4 imports + 4 routes |
| `packages/web/src/components/organisms/Sidebar.tsx` | Remove Build, Projects, Processes nav items |

## Implementation Steps

1. Delete all 4 page files
2. Remove imports and routes from App.tsx
3. Remove nav items from Sidebar.tsx (keep Dashboard, Git, Settings)
4. Remove unused icon imports from Sidebar.tsx (Hammer, FolderGit2, Activity, etc.)
5. Search codebase for stale references to deleted pages
6. Run `pnpm build` to verify

## Todo List

- [ ] Delete BuildPage.tsx
- [ ] Delete ProjectsPage.tsx
- [ ] Delete ProjectDetailPage.tsx
- [ ] Delete ProcessesPage.tsx
- [ ] Remove imports + routes from App.tsx
- [ ] Remove nav items from Sidebar.tsx
- [ ] Clean up unused icon imports
- [ ] Verify no stale references
- [ ] Run pnpm build

## Success Criteria

1. No deleted page files exist
2. Sidebar shows 3 items: Dashboard, Git, Settings
3. `pnpm build` succeeds
4. No runtime errors

## Risk Assessment

**Low**: All deleted pages are leaf components.

## Security Considerations

None. Pure deletion.
