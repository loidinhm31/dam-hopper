# Phase 01: Extract Terminal State into Hook

## Context
- Parent: [plan.md](./plan.md)
- No dependencies — first phase

## Overview
- **Priority:** P1
- **Status:** Pending
- **Description:** Extract TerminalsPage's state management (~15 useState/useMemo/useEffect + ~15 handlers) into a reusable `useTerminalManager` hook, enabling the combined WorkspacePage to consume terminal logic without the 727-LOC monolith.

## Key Insights
- TerminalsPage has 7 useState, 3 useMemo, 2 useEffect, ~15 handler functions
- State is self-contained — no cross-page dependencies
- `useTerminalTree` already extracted; this extracts the session/tab management layer above it
- `sessionMap`, `freeTerminalIndexMap`, `profileSessionIds` are pure derivations — stay as useMemo
- URL-based effects (deep-link, action param) need router access — pass via params or keep in page

## Requirements
- Hook must expose: state bag (openTabs, activeTab, mountedSessions, launchForm, savePrompt, freeTerminalSavePrompt, selection) + all handler functions
- Hook must accept: `searchParams` + `setSearchParams` (for URL-based deep-linking)
- Derived data (tabsWithLiveSession, selectedId, sessionMap) exposed as readonly
- All existing behavior preserved — no functional changes
- File under 200 LOC

## Architecture

```
useTerminalManager(searchParams, setSearchParams)
  ├── consumes: useTerminalTree(), useTerminalSessions(), useProjects()
  ├── state: openTabs, activeTab, mountedSessions, selection, forms
  ├── derived: sessionMap, tabsWithLiveSession, selectedId, freeTerminalIndexMap
  ├── handlers: openTerminalTab, handleSelectProject, handleKillTerminal, ...
  └── returns: { state, actions, derived }
```

## Related Code Files
- **Modify:** `packages/web/src/components/pages/TerminalsPage.tsx` — gut state into hook, keep as thin layout
- **Create:** `packages/web/src/hooks/useTerminalManager.ts` — new hook (~180 LOC)

## Implementation Steps

1. Create `packages/web/src/hooks/useTerminalManager.ts`
2. Define return type interface: `TerminalManagerState`, `TerminalManagerActions`, `TerminalManagerDerived`
3. Move all useState/useMemo from TerminalsPage into hook
4. Move all handler functions (handleSelectProject, handleSelectTerminal, handleLaunchTerminal, handleLaunchProfile, handleLaunchFormSubmit, handleDeleteProfile, handleSaveProfile, handleAddFreeTerminal, handleLaunchFreeWithCommand, handleLaunchSuggestedCommand, handleAddShell, handleSelectTab, handleCloseTab, handleKillTerminal, handleRemoveFreeTerminal, handleOpenFreeTerminalSavePrompt, handleSaveFreeTerminalToProject, handleSessionExit)
5. Move useEffect hooks for URL params (accept searchParams as arg)
6. Move derived computations: tabsWithLiveSession, selectedId
7. Move helper functions: tabLabel, openTerminalTab, findSessionMeta, validateProfileName
8. Update TerminalsPage to consume `useTerminalManager` — verify identical render output
9. Run `pnpm lint` and `pnpm build` to verify no regressions

## Todo
- [ ] Create useTerminalManager.ts with full state + actions
- [ ] Define TypeScript interfaces for return type
- [ ] Update TerminalsPage.tsx to consume hook
- [ ] Verify lint + build pass
- [ ] Manual test: terminal create/kill/tab/save/deep-link all work

## Success Criteria
- TerminalsPage renders identically
- useTerminalManager.ts under 200 LOC
- TerminalsPage.tsx under 200 LOC (layout only)
- `pnpm build` passes
- All terminal features work: create, kill, tabs, save profile, free terminals, deep-linking

## Risk Assessment
- **Medium:** Large refactor of working code. Mitigate with incremental extraction + immediate manual testing.
- **Low:** Hook closure semantics might differ subtly from inline functions. Test URL deep-linking carefully.

## Security Considerations
- No security changes — pure refactor

## Next Steps
- Phase 02 consumes this hook in WorkspacePage
