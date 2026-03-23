# Current Terminal & Command UI System Analysis

## 1. BuildPage.tsx (86 lines)
**Purpose:** Dedicated page for building a single project with project selector dropdown.
**State:** `selected`, `buildKey`, `buildStarted`, `exitCode`
**Redundancy:** Nearly identical to UnifiedCommandPanel's build section. Both use `build:${projectName}` session ID pattern.

## 2. ProjectDetailPage.tsx (370 lines)
**Purpose:** Project detail view with tabbed interface (Overview, Git, Worktrees, Commands).
**Tabs:** Button-based with styled underline indicator. Only one tab visible at a time.
**State:** `tab`, `worktreePath`, `worktreeBranch`, `createBranch`, `showAddWorktree`

## 3. UnifiedCommandPanel.tsx (580 lines)
**Purpose:** Centralized UI for build/run/custom commands per project.
**State:** `filter`, `expanded` (Set), `buildStarted`, `runStarted`, `runKey`, `customStarted` (Set), `customKeys`, `customExitCodes`
**Session IDs:** `build:${project}`, `run:${project}`, `custom:${project}:${key}`
**Features:** Filter tabs, expandable command cards, run lifecycle (start/stop/restart), custom command CRUD

## 4. TerminalPanel.tsx (156 lines)
**Props:** `sessionId`, `project`, `command`, `onExit?`, `className?`
**Lifecycle:** Creates/reconnects PTY, replays scrollback, does NOT kill on unmount
**Features:** ResizeObserver, Ctrl+Shift+C/V, 5000 line scrollback, dark theme

## 5. ProcessesPage.tsx (87 lines)
**Purpose:** List active PTY sessions. Polls every 3s. Shows ID + status badge + kill button.
**Limitation:** No metadata (project, command, runtime) — only raw session IDs.

## 6. Sidebar.tsx (63 lines)
**Nav:** Dashboard, Projects, Git, Build, Processes, Settings

## 7. AppLayout.tsx (25 lines)
**Structure:** Sidebar (240px) + scrollable main area. Optional page title.

## 8. App.tsx (59 lines)
**Routes:** 7 routes + WelcomePage gate on workspace status.

## Key Limitations for Redesign

1. **Redundant Build UI** — BuildPage duplicates UnifiedCommandPanel build section
2. **Flat Session ID Namespace** — No hierarchy for grouping by project
3. **Limited Process Metadata** — ProcessesPage shows only IDs, no context
4. **Single Terminal Per Command** — One build/run per project at a time
5. **No Cross-Project Terminal View** — No unified view of all terminals across projects
6. **Expand State Complexity** — UnifiedCommandPanel manages expand for 1 build + 1 run + N custom per project
