# Codebase Analysis: Dashboard Active Terminals

## Current State

### DashboardPage (`packages/web/src/pages/DashboardPage.tsx`)
- Shows 4 overview cards: Total Projects, Clean Repos, Dirty Repos, Active Terminals
- "Active Terminals" card shows count only, links to `/terminals`
- Uses manual `useEffect` + `setInterval(5s)` polling via `window.devhub.terminal.list()` (returns IDs only)
- Activity feed shows IPC events but no terminal-specific info
- No session list, no kill/navigate actions

### Terminal Infrastructure (already built)
- `useTerminalSessions()` hook polls `listDetailed()` every 3s — returns `SessionInfo[]`
- `SessionInfo`: `{ id, project, command, cwd, type, alive, exitCode, startedAt }`
- `window.devhub.terminal.kill(id)` terminates a session
- `window.devhub.terminal.listDetailed()` returns both alive and dead (within 60s TTL)

### TerminalsPage (`packages/web/src/pages/TerminalsPage.tsx`)
- Full terminal management: tree view, tabs, launch, kill, save profiles
- Tab opening via `openTerminalTab(sessionId, project, command)` — internal state, no URL params
- No mechanism to deep-link to a specific session from outside

### Navigation
- React Router: `/` (Dashboard), `/terminals`, `/git`, `/settings`
- No URL search params used anywhere currently

## Key Findings

1. **`useTerminalSessions()` is reusable** — already exported, polls every 3s, returns full metadata
2. **Dashboard manual polling can be replaced** with `useTerminalSessions()` (better: detailed data + shared cache)
3. **Deep-linking gap** — TerminalsPage has no URL-param-based session activation; needs `?session=` support
4. **Design tokens** — glass-card, color vars, 10px uppercase labels well-established in Dashboard

## Unresolved Questions
- Should dead/exited sessions (within 60s TTL) appear in the dashboard list? → Recommend: NO, filter `alive === true` only
- Should kill require confirmation? → Recommend: NO, direct kill is fine (consistent with tree view behavior)
