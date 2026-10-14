# Phase 3: Navigator Integration & Browser Tests

## Target Files
- `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx`
- `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx`
- `packages/ui/browser-tests/terminal-traditional-projects.browser.tsx`
- `docs/system-architecture.md`

## Requirements
1. Navigator Integration:
   - Use `TraditionalAgentStatusSelection` in `TraditionalTerminalProjectsNavigator`.
   - Update empty status message:
     - When no observations match filter:
       `No observed agents match {formatTraditionalAgentStatusFilter(selectedFilter)}.`
     - For single status: `No observed agents match Working.`
     - For multiple statuses: `No observed agents match Working, Idle.`
2. Navigator Unit Tests:
   - Update existing filter tests to verify multi-status selection.
   - Verify selecting multiple statuses combines their agent groups.
   - Verify unselecting or resetting to all restores full roster.
   - Verify empty matching message with multi-status formatting.
   - Verify persistence across remount for multi-status selection.
3. Chromium Browser Tests:
   - Update `terminal-traditional-projects.browser.tsx` to verify:
     - Single status selection persistence.
     - Multi-status selection (e.g. selecting Working and Idle) and roster updates.
     - Roster splitting and combination under multi-select filter.
     - Dismissal via Escape and click-outside.
4. Documentation:
   - Update `docs/system-architecture.md` to note multi-select capabilities of traditional terminal agent status filter.
