---
parent: ./plan.md
dependencies:
  - ./phase-01-dashboard-session-list.md
---

# Phase 2: Deep-Link Navigation to Terminal Sessions

## Overview
- **Date**: 2026-03-26
- **Description**: Add URL search param support to TerminalsPage so dashboard can link directly to a specific terminal session
- **Priority**: P2
- **Implementation Status**: Done
- **Review Status**: Done

## Key Insights
- TerminalsPage manages tabs via internal state (`openTabs`, `activeTab`, `mountedSessions`)
- `openTerminalTab(sessionId, project, command)` is the entry point for activating a session
- `findSessionMeta(sessionId, tree, sessionMap)` resolves project+command from sessionId
- Need to read `?session=` param on mount and trigger tab open once sessions data is loaded

## Requirements
1. TerminalsPage reads `?session={sessionId}` from URL search params
2. On mount (or when sessions data loads), auto-open that session's tab
3. Clear the search param after processing to avoid re-triggering on re-renders
4. Gracefully handle invalid/expired session IDs (no-op)

## Architecture
```
TerminalsPage
  └── useSearchParams() → read ?session= param
      └── useEffect([sessionParam, sessions, tree])
            ├── if sessionParam && sessions loaded:
            │   ├── find session in sessionMap
            │   ├── findSessionMeta for project+command
            │   ├── openTerminalTab(sessionId, project, command)
            │   └── clear ?session= param
            └── if session not found: no-op (param cleared)
```

## Related Code Files
- `packages/web/src/pages/TerminalsPage.tsx` — main file to modify
- `packages/web/src/pages/DashboardPage.tsx` — produces the `?session=` links (Phase 1)

## Implementation Steps

### Step 1: Add useSearchParams
- Import `useSearchParams` from `react-router-dom`
- Read `session` param: `const [searchParams, setSearchParams] = useSearchParams()`

### Step 2: Add effect to process session param
```typescript
useEffect(() => {
  const sessionParam = searchParams.get("session");
  if (!sessionParam || sessions.length === 0) return;

  const meta = findSessionMeta(sessionParam, tree, sessionMap);
  if (meta) {
    openTerminalTab(sessionParam, meta.project, meta.command);
  }

  // Clear param to prevent re-triggering
  setSearchParams({}, { replace: true });
}, [searchParams, sessions, tree]);
```

### Step 3: Handle edge cases
- Session expired (not in sessionMap): clear param, no-op
- Session dead but in TTL window: still open tab (user can see exit code)
- Multiple rapid navigations: effect is idempotent (openTerminalTab deduplicates)

## Todo
- [x] Add useSearchParams to TerminalsPage
- [x] Add effect to auto-open session from URL param
- [x] Test navigation from dashboard → terminals with valid session
- [x] Test with invalid/expired session ID

## Success Criteria
- Clicking a session row on dashboard navigates to terminals page with that session's tab active
- URL param is cleared after processing
- Invalid session IDs don't cause errors
- Subsequent visits to `/terminals` (no param) work normally

## Risk Assessment
- **Low**: Additive change, no modification to existing tab logic
- `openTerminalTab` already handles deduplication (won't create duplicate tabs)

## Security Considerations
- Session IDs in URL are system-generated, no injection risk
- `searchParams.get()` returns plain string, passed directly to `findSessionMeta` which does Map lookup

## Next Steps
→ Feature complete after this phase
