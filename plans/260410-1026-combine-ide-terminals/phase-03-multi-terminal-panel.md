# Phase 03: Integrate Multi-Terminal into Bottom Panel

## Context
- Parent: [plan.md](./plan.md)
- Depends on: [Phase 02](./phase-02-workspace-page.md) (WorkspacePage exists with TerminalDock placeholder)

## Overview
- **Priority:** P1
- **Status:** Pending
- **Description:** Replace TerminalDock (single terminal) in WorkspacePage's bottom panel with TerminalTabBar + MultiTerminalDisplay, giving full multi-session terminal management within the IDE layout.

## Key Insights
- IdeShell's terminal slot is a ReactNode — can receive any component tree
- TerminalTabBar + MultiTerminalDisplay are already production-ready organisms
- Bottom panel needs `flex flex-col`: tab bar fixed height on top, MultiTerminalDisplay fills remaining
- Inline forms (launch form, save prompt, free terminal save) currently render above the tab bar in TerminalsPage — same pattern works in bottom panel
- When `ide_explorer` disabled and no editor: terminal fills full right panel height — tab bar + multi-terminal still compose the same way
- TerminalDock's single `ide:shell:{project}` session should auto-open as first tab for continuity

## Requirements
- Bottom panel: TerminalTabBar + MultiTerminalDisplay replacing TerminalDock
- All terminal operations work: create, kill, switch tabs, save profile, free terminals
- Inline forms (launch, save profile, save free terminal) render in bottom panel
- Auto-open a project shell tab when project selected (replicates TerminalDock UX)
- ProjectInfoPanel shows when project selected in terminal tree (replaces right panel content in old TerminalsPage — now shows as overlay or dedicated view)

## Architecture

```
terminal prop to IdeShell:
<div className="flex flex-col h-full">
  {/* Inline forms */}
  {freeTerminalSavePrompt && <SaveFreeTerminalForm ... />}
  {launchForm && <LaunchForm ... />}

  {/* Tab bar */}
  {openTabs.length > 0 && <TerminalTabBar ... />}

  {/* Terminal display */}
  <div className="flex-1 min-h-0">
    <MultiTerminalDisplay ... />
  </div>
</div>
```

## Related Code Files
- **Modify:** `packages/web/src/components/pages/WorkspacePage.tsx` — replace TerminalDock with multi-terminal composition
- **Modify:** `packages/web/src/hooks/useTerminalManager.ts` — add auto-open shell behavior for IDE context
- **Keep unchanged:** MultiTerminalDisplay, TerminalTabBar, TerminalPanel

## Implementation Steps

1. In WorkspacePage, replace TerminalDock with composed terminal panel:
   - Wrap TerminalTabBar + MultiTerminalDisplay in flex column container
   - Wire all callbacks from useTerminalManager
2. Add inline forms (launchForm, savePrompt, freeTerminalSavePrompt) above tab bar
3. Auto-open a shell tab when `activeProject` changes and no terminal tab exists:
   - Create session with ID pattern `ide:shell:{project}` (matches TerminalDock convention)
   - Open as first tab automatically
4. Handle ProjectInfoPanel display:
   - When terminal tree selection is a project (not a session), show info panel in terminal area
   - Same conditional logic as TerminalsPage: `selection.type === "project"` → ProjectInfoPanel
5. Handle empty state: no tabs open, no project selected → show "Open Terminal" prompt
6. Verify vertical resize still works with tab bar added (IdeShell's percentage split)
7. Test: create terminal from tree, switch tabs, kill session, save profile, free terminal, deep-link
8. Run `pnpm lint` and `pnpm build`

## Todo
- [ ] Compose terminal panel (tab bar + multi-display)
- [ ] Wire inline forms in bottom panel
- [ ] Add auto-open shell behavior
- [ ] Handle ProjectInfoPanel in terminal area
- [ ] Handle empty state
- [ ] Verify resize behavior
- [ ] Manual test all terminal features

## Success Criteria
- Multi-terminal tabs work in bottom panel
- All 15+ terminal operations functional (create, kill, tabs, profiles, free terminals)
- Auto-opens shell on project selection
- Vertical resize handles tab bar height correctly
- No xterm rendering glitches (display:flex/none toggling works)
- `pnpm build` passes

## Risk Assessment
- **Medium:** xterm.js rendering in resizable panel — xterm needs explicit `fit()` calls on resize. MultiTerminalDisplay already handles this, but verify with vertical resize.
- **Low:** Tab bar height reduces terminal area — ensure min-height constraint on editor (20%) leaves enough space.

## Security Considerations
- No new security surface — same PTY sessions, same auth

## Next Steps
- Phase 04 updates routing and cleans up old pages
