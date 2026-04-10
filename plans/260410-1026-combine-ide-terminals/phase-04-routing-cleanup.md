# Phase 04: Update Routing, Nav, Shortcuts & Cleanup

## Context
- Parent: [plan.md](./plan.md)
- Depends on: [Phase 03](./phase-03-multi-terminal-panel.md) (WorkspacePage fully functional)

## Overview
- **Priority:** P2
- **Status:** Pending
- **Description:** Update router, sidebar navigation, keyboard shortcuts, and clean up old page files. Ensure backward compatibility with existing deep-links.

## Key Insights
- `Ctrl+backtick` currently navigates to `/terminals?action=new-terminal` — must update
- Sidebar has separate Terminals and IDE links — merge into single "Workspace" link
- Old routes (`/terminals`, `/ide`) need redirects for bookmarks/muscle memory
- TerminalsPage can be deleted; IdePage can be deleted
- TerminalDock component may still be useful for other contexts — keep if referenced elsewhere, delete if not

## Requirements
- Single `/workspace` route serving WorkspacePage
- Redirects: `/terminals` → `/workspace`, `/ide` → `/workspace`
- URL params preserved: `/terminals?session=X` → `/workspace?session=X`
- Sidebar: single "Workspace" link replacing both Terminals and IDE
- `Ctrl+backtick` → `/workspace?action=new-terminal`
- Feature flag still controls editor visibility within WorkspacePage (not route access)
- Clean up unused files

## Related Code Files
- **Modify:** `packages/web/src/App.tsx` — update routes, redirect old paths, update shortcut
- **Modify:** `packages/web/src/components/organisms/Sidebar.tsx` — merge nav links
- **Delete:** `packages/web/src/components/pages/TerminalsPage.tsx`
- **Delete:** `packages/web/src/components/pages/IdePage.tsx`
- **Evaluate:** `packages/web/src/components/organisms/TerminalDock.tsx` — delete if no other consumers

## Implementation Steps

1. Update `App.tsx`:
   - Add `/workspace` route → `WorkspacePage` (lazy-loaded with Suspense)
   - Add redirects: `/terminals` → `/workspace` (preserve search params), `/ide` → `/workspace`
   - Update `Ctrl+backtick` handler: navigate to `/workspace?action=new-terminal`
   - Remove old IdePage and TerminalsPage imports
2. Update `Sidebar.tsx`:
   - Replace Terminals + IDE links with single "Workspace" link (`{ to: "/workspace", icon: Code2, label: "Workspace" }`)
   - Label always "Workspace" regardless of feature flag state
   - Remove feature flag gating on nav link (workspace always accessible; feature flag controls content within)
3. Delete old files:
   - `packages/web/src/components/pages/TerminalsPage.tsx`
   - `packages/web/src/components/pages/IdePage.tsx`
4. Evaluate TerminalDock:
   - Grep for imports — if only used by old IdePage, delete
   - If used elsewhere, keep
5. Run `pnpm lint` and `pnpm build`
6. Manual test:
   - Navigate to `/workspace` directly
   - Visit `/terminals` — verify redirect
   - Visit `/ide` — verify redirect
   - `Ctrl+backtick` — verify new terminal opens
   - Deep-link: `/workspace?session=xxx` — verify terminal opens

## Todo
- [ ] Update App.tsx routes + redirects
- [ ] Update Ctrl+backtick shortcut target
- [ ] Merge sidebar nav links
- [ ] Delete old page files
- [ ] Evaluate + delete TerminalDock if unused
- [ ] Verify all redirects work
- [ ] Run lint + build

## Success Criteria
- `/workspace` loads WorkspacePage
- `/terminals` and `/ide` redirect to `/workspace`
- Deep-links with `?session=` param work
- `Ctrl+backtick` opens new terminal in workspace
- Sidebar shows single Workspace link
- No dead imports or unused files
- `pnpm build` passes with no warnings about missing modules

## Risk Assessment
- **Low:** Route changes are straightforward. Redirects handle backward compat.
- **Low:** Users with bookmarks to `/terminals` or `/ide` get seamless redirect.

## Security Considerations
- Feature flag no longer gates route access (workspace always accessible) — but editor/file-tree features still gated within the page. This is acceptable: terminal access was never gated.

## Next Steps
- Done. Full workspace page operational.
