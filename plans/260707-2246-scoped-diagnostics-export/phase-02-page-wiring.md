# Phase 02 - Page Wiring

Date: 2026-07-07
Priority: high
Status: complete

## Requirements

- Dashboard exports dashboard-scoped diagnostics.
- Workspace exports active-project diagnostics and selected terminal ids for that project.
- Git exports selected project diagnostics when a single project is selected.
- Settings exports settings-scoped diagnostics.
- Agent Store exports agent-store-scoped diagnostics.

## Related Files

- `packages/ui/src/components/templates/AppLayout.tsx`
- `packages/ui/src/components/pages/DashboardPage.tsx`
- `packages/ui/src/components/pages/WorkspacePage.tsx`
- `packages/ui/src/components/pages/GitPage.tsx`
- `packages/ui/src/components/pages/SettingsPage.tsx`
- `packages/ui/src/components/pages/AgentStorePage.tsx`

## Success Criteria

- Each routed page has an export button.
- Workspace export does not dump all terminal tails by default.

## Result

- Wired Dashboard, Workspace, Git, Settings, and Agent Store.
- Workspace prefers the active project terminal, then mounted project terminals.
- Non-terminal pages disable terminal output unless scoped terminal ids exist.
