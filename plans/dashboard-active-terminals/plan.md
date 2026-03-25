---
title: "Dashboard Active Terminals List"
description: "Add active terminal session list to dashboard with navigate & terminate actions"
status: done
priority: P2
effort: 2h
branch: main
tags: [dashboard, terminals, ui]
created: 2026-03-26
---

# Dashboard Active Terminals List

## Goal
Add an "Active Terminals" section to the DashboardPage listing all running terminal sessions with ability to navigate to them or terminate them directly.

## Current State
- Dashboard shows terminal count only (overview card)
- `useTerminalSessions()` hook already exists with 3s polling
- TerminalsPage has no deep-link support for opening specific sessions

## Implementation Phases

| Phase | Description | Status | Effort |
|-------|-------------|--------|--------|
| [Phase 1](./phase-01-dashboard-session-list.md) | Add active sessions list to DashboardPage | done | 1h |
| [Phase 2](./phase-02-deep-link-navigation.md) | Add URL param deep-linking to TerminalsPage | done | 1h |

## Architecture

```
DashboardPage
├── Overview Cards (existing)
├── Repo Status Bar (existing)
├── **NEW: Active Terminals Section**
│   ├── Session rows (type icon, project, command, uptime, status dot)
│   ├── Click row → navigate(`/terminals?session={id}`)
│   └── Kill button per row → terminal.kill(id)
├── Recent Activity (existing)

TerminalsPage (updated)
├── reads `?session=` search param on mount
└── auto-opens tab for that session if found
```

## Key Decisions
- Replace manual `useEffect`/`setInterval` polling with `useTerminalSessions()` hook (shared TanStack Query cache)
- Filter to `alive === true` sessions only on dashboard
- No kill confirmation (matches existing tree view behavior)
- Deep-link via URL search param `?session={sessionId}`
