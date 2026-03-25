---
parent: ./plan.md
dependencies: none
---

# Phase 1: Dashboard Active Terminals Session List

## Overview
- **Date**: 2026-03-26
- **Description**: Add an active terminal sessions section to DashboardPage showing all running sessions with navigate and terminate actions
- **Priority**: P2
- **Implementation Status**: Done
- **Review Status**: Done

## Key Insights
- `useTerminalSessions()` already polls `listDetailed()` every 3s — reuse instead of manual polling
- SessionInfo provides all needed metadata: project, command, type, alive, startedAt
- Existing glass-card + color token design system should be followed
- Dashboard currently derives `activeSessions` count via separate `useEffect` — can be replaced

## Requirements
1. Display list of alive terminal sessions between repo status bar and recent activity
2. Each row: type badge, project name, command (truncated), uptime, alive dot, kill button
3. Click row navigates to `/terminals?session={sessionId}`
4. Kill button calls `window.devhub.terminal.kill(id)` and invalidates query
5. Empty state: "No active terminals" message
6. Replace manual `useEffect`/`setInterval` count with `useTerminalSessions()` derived count

## Architecture
```
DashboardPage
  └── useTerminalSessions() → sessions
      ├── aliveSessions = sessions.filter(s => s.alive)
      ├── activeSessions count = aliveSessions.length (for overview card)
      └── <ActiveTerminalsList sessions={aliveSessions} />
            ├── Session row (clickable → navigate)
            │   ├── Type icon (Hammer/Play/Terminal/Wrench based on type)
            │   ├── Project name
            │   ├── Command (truncated to ~40 chars)
            │   ├── Uptime (derived from startedAt)
            │   ├── Green status dot
            │   └── Kill button (X or Square icon)
            └── Empty state
```

## Related Code Files
- `packages/web/src/pages/DashboardPage.tsx` — main file to modify
- `packages/web/src/api/queries.ts` — `useTerminalSessions()` hook (no changes needed)
- `packages/web/src/types/electron.d.ts` — `SessionInfo` type reference
- `packages/web/src/components/molecules/OverviewCard.tsx` — design reference

## Implementation Steps

### Step 1: Replace manual polling with useTerminalSessions
- Import `useTerminalSessions` from `@/api/queries.js`
- Remove the `useEffect` block (lines 24-40) that polls `terminal.list()`
- Remove `activeSessions` state
- Derive count: `const aliveSessions = sessions.filter(s => s.alive); const activeSessions = aliveSessions.length;`

### Step 2: Add uptime helper
- Create `formatUptime(startedAt: number): string` — returns "2m", "1h 5m", etc.
- Inline in DashboardPage or extract to a util

### Step 3: Add type icon mapping
- Map session type → Lucide icon: build→Hammer, run→Play, terminal/shell→Terminal, custom→Wrench
- Inline mapping object in component

### Step 4: Build Active Terminals section
- New glass-card section between status bar and recent activity
- Header: `// ACTIVE_TERMINALS`
- List of session rows with: icon, project, command, uptime, status dot, kill button
- Click handler: `navigate(\`/terminals?session=${session.id}\`)`
- Kill handler: `window.devhub.terminal.kill(id)` + invalidate `["terminal-sessions"]`
- Empty state: "No active terminals" italic message

### Step 5: Add imports
- `useNavigate` from react-router-dom
- `useQueryClient` from @tanstack/react-query
- Lucide icons: Hammer, Play, Terminal, Wrench, Square (kill icon)

## Todo
- [x] Replace manual polling with useTerminalSessions
- [x] Add formatUptime helper
- [x] Add type-to-icon mapping
- [x] Build active terminals section JSX
- [x] Wire up navigate and kill handlers
- [x] Test with running sessions

## Success Criteria
- Dashboard shows list of alive sessions with correct metadata
- Clicking a session navigates to `/terminals?session={id}`
- Kill button terminates the session and list updates within 3s
- Empty state shown when no sessions alive
- Overview card count stays accurate

## Risk Assessment
- **Low**: All infrastructure exists; purely UI work
- `useTerminalSessions` shared cache means dashboard and terminals page stay in sync

## Security Considerations
- Kill action is local-only (IPC), no auth concerns
- No user input sanitization needed (session IDs are system-generated)

## Next Steps
→ Phase 2: Deep-link navigation in TerminalsPage
