# Frontend Components

Architecture and documentation for React components in the Dam Hopper web UI (Phase 06+).

## Overview

The frontend is a React 19 SPA (packages/web/) using:
- **Vite** for bundling
- **Redux Toolkit** for state management
- **TanStack Query** for server state
- **Tailwind CSS** for styling
- **xterm.js** for terminal rendering

Key architectural pattern: **Consumer components** subscribe to Transport events (WebSocket, HTTP) and update local state via hooks.

## Component Structure

```
packages/web/src/
├── api/
│   ├── client.ts         — Type definitions (SessionInfo, ProjectConfig, etc.)
│   ├── ws-transport.ts   — WebSocket transport + event subscriptions
│   └── transport.ts      — Generic transport interface
├── lib/
│   ├── session-status.ts — Lifecycle status helpers (NEW: Phase 6)
│   └── utils.ts          — Utility functions
├── components/
│   ├── atoms/            — Small building blocks (inputs, buttons)
│   ├── organisms/        — Complex interactive components
│   │   ├── TerminalPanel.tsx        — Main terminal rendering + lifecycle
│   │   ├── TerminalTreeView.tsx     — Sidebar: projects + terminals
│   │   └── ...
│   └── pages/            — Page-level components
│       ├── DashboardPage.tsx        — Session list + status
│       └── ...
└── hooks/
    ├── useTerminalTree.ts          — Sidebar state management
    └── ...
```

## Key Components (Phase 6)

### TerminalPanel

**Location:** `packages/web/src/components/organisms/TerminalPanel.tsx`

**Purpose:** Renders a single terminal session using xterm.js. Handles lifecycle events (output, exit, restart, reconnect).

**Props:**
```ts
interface TerminalPanelProps {
  sessionId: string;           // Unique session ID
  project: string;             // Project name for context
  command: string;             // Shell command to execute
  cwd?: string;                // Working directory (if creating new session)
  onExit?: (code: number | null) => void;
  onNewTerminal?: () => void;
  className?: string;
}
```

**Key Hooks Inside:**
- `useEffect` — initializes xterm, sets up event listeners, manages PTY lifecycle
- Transport event subscriptions:
  - `onTerminalExit()` → writes exit banner, calls `onExit`
  - `onProcessRestarted()` → writes restart banner, updates session state
  - `onTransportStatus()` → writes reconnect status banners

**Banner Logic:**
```ts
// Exit banner (green/red/yellow based on willRestart)
const color = sess.willRestart ? "\x1b[33m" : sess.exitCode === 0 ? "\x1b[32m" : "\x1b[31m";
term.write(`\r\n${color}[banner text]\x1b[0m\r\n`);

// Reconnect status
if (status === "disconnected") term.write("\r\n\x1b[2m[Reconnecting…]\x1b[0m\r\n");
if (status === "connected") term.write("\r\n\x1b[2m[Reconnected]\x1b[0m\r\n");
```

### TerminalTreeView

**Location:** `packages/web/src/components/organisms/TerminalTreeView.tsx`

**Purpose:** Sidebar tree showing projects and their terminal sessions. Displays status dots (NEW: Phase 6).

**Components:**
- `StatusDot` — Renders session lifecycle indicator (🟢🟡🔴⚪)
- `CommandRow` — Project command with launch/kill buttons
- `ProfileRow` — Expandable saved profile with instance children
- `FreeTerminalRow` — Standalone terminal in "Terminals" section

**StatusDot Usage:**
```tsx
function StatusDot({ session }: { session?: SessionInfo | null }) {
  if (!session) return <span className="h-2 w-2 rounded-full bg-[...]/30" />;
  const status = getSessionStatus(session);
  const dotColor = getStatusDotColor(status);
  return <span className={`h-2 w-2 rounded-full ${dotColor}`} />;
}
```

### DashboardPage

**Location:** `packages/web/src/components/pages/DashboardPage.tsx`

**Purpose:** Main view showing all sessions with metadata (uptime, exit code, restart count).

**Key Features:**
- **SessionRow component** — Displays status dot + session info + restart badge
- **Restart Badge** — Shows `↻ N` when `session.restartCount > 0`
- Badge styling: `bg-yellow-500/10 text-yellow-600`
- Tooltip: "Restarted N time(s)"

**Example:**
```tsx
{session.restartCount > 0 && (
  <span
    className="badge bg-yellow-500/10 text-yellow-600"
    title={`Restarted ${session.restartCount} time(s)`}
  >
    ↻ {session.restartCount}
  </span>
)}
```

## Session Status Helpers

**Location:** `packages/web/src/lib/session-status.ts`

**Purpose:** Centralize session lifecycle logic for consistent UI rendering.

### SessionStatus Type
```ts
export type SessionStatus = "alive" | "restarting" | "crashed" | "exited";
```

### getSessionStatus()
```ts
export function getSessionStatus(sess: SessionInfo): SessionStatus {
  if (sess.alive) return "alive";
  if (sess.willRestart) return "restarting";
  if (sess.exitCode !== 0 && sess.exitCode !== null) return "crashed";
  return "exited";
}
```

### getStatusDotColor()
```ts
export function getStatusDotColor(status: SessionStatus): string {
  switch (status) {
    case "alive": return "bg-green-500";
    case "restarting": return "bg-yellow-500";
    case "crashed": return "bg-red-500";
    case "exited": return "bg-[var(--color-text-muted)]/30";
  }
}
```

### getStatusGlowClass()
```ts
export function getStatusGlowClass(status: SessionStatus): string {
  switch (status) {
    case "alive": return "status-glow-green";
    case "restarting": return "status-glow-orange";
    default: return "";
  }
}
```

**Tests:** `session-status.test.ts` covers all transitions and color mappings.

## WebSocket Transport (Phase 6 Extensions)

**Location:** `packages/web/src/api/ws-transport.ts`

**Key Event Handlers:**

### onTerminalExit()
```ts
transport.onTerminalExit(sessionId, (event) => {
  // event: { id, exitCode, willRestart, restartInMs, restartCount }
  // Write colored banner to terminal
  // Update session state
});
```

### onProcessRestarted()
```ts
transport.onProcessRestarted(sessionId, (event) => {
  // event: { id, restartCount, previousExitCode }
  // Write restart banner with count
  // Invalidate dashboard queries
});
```

### onTransportStatus()
```ts
transport.onTransportStatus((status) => {
  // status: "connected" | "reconnecting" | "disconnected"
  // Write reconnect status banners
});
```

## SessionInfo Type

**Location:** `packages/web/src/api/client.ts`

```ts
export interface SessionInfo {
  id: string;
  project?: string;
  command: string;
  cwd: string;
  type: "build" | "run" | "custom" | "shell" | "terminal" | "free" | "unknown";
  alive: boolean;
  exitCode?: number | null;
  startedAt: number;
  // Phase 3 restart fields
  restartPolicy?: "never" | "on-failure" | "always";
  restartCount?: number;
  lastExitAt?: number;
  // Phase 5 exit event fields
  willRestart?: boolean;
  restartInMs?: number;
}
```

## Data Flow: Terminal Lifecycle

```
┌──────────────────────────────────────┐
│  User clicks "Launch" in DashboardPage│
└────────────────┬─────────────────────┘
                 │
                 ▼
        ┌────────────────────┐
        │  terminal:spawn    │ (WS command)
        │  → Backend creates │
        └─────────┬──────────┘
                  │
                  ▼
        ┌────────────────────┐
        │ terminal:spawned   │ (WS event)
        │ → SessionInfo      │
        │   received, store  │
        └─────────┬──────────┘
                  │
                  ▼ (TerminalPanel mounts)
        ┌────────────────────┐
        │  xterm renders     │
        │  streams output    │
        │  (alive=true)      │
        └─────────┬──────────┘
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
┌─────────────┐    ┌──────────────────────┐
│  Process    │    │  Terminal killed by  │
│  exits      │    │  user or crashes     │
└──────┬──────┘    └──────────┬───────────┘
       │                      │
       ▼                      ▼
   ┌────────────────────────────────┐
   │ terminal:exit event with:      │
   │ - exitCode                     │
   │ - willRestart (if applicable)  │
   │ - restartInMs (if applicable)  │
   └────────┬─────────────────────────┘
            │
            ▼ (TerminalPanel handler)
   ┌──────────────────────────┐
   │ Write colored exit banner│
   │ Update SessionInfo state │
   │ Trigger dashboard refresh│
   └──────────┬───────────────┘
              │
    ┌─────────┴──────────┐
    │ If willRestart=true│
    │ (wait & restart)   │
    └─────────┬──────────┘
              │
              ▼
    ┌────────────────────┐
    │ process:restarted  │ (WS event)
    │ - new session state│
    │ - restart count    │
    └──────────┬─────────┘
               │
               ▼ (TerminalPanel handler)
    ┌──────────────────────┐
    │ Write restart banner │
    │ Continue xterm stream│
    │ Update dash badge   │
    └──────────────────────┘
```

## Banner ANSI Formatting

**Exit Banner:**
```
\r\n<color>[Process exited with code X]\x1b[0m\r\n
```
- Green (`\x1b[32m`): exit code = 0
- Red (`\x1b[31m`): exit code ≠ 0, no restart
- Yellow (`\x1b[33m`): exit code ≠ 0, willRestart=true

**Restart Banner:**
```
\r\n\x1b[33m[Process restarted (#N)]\x1b[0m\r\n
```

**Reconnect Banners:**
```
\r\n\x1b[2m[Reconnecting…]\x1b[0m\r\n
\r\n\x1b[2m[Reconnected]\x1b[0m\r\n
```
- Dim (`\x1b[2m`): reduces visual noise during reconnect

## Styling with Tailwind

**Color Variables:**
- `var(--color-text-muted)` — Secondary text for muted states
- `var(--color-primary)` — Accent color for selection
- `var(--color-surface-2)` — Elevated background

**Status Dot Styles:**
```tsx
// Alive (with glow)
<span className="h-2 w-2 rounded-full bg-green-500 status-glow-green" />

// Restarting (with glow)
<span className="h-2 w-2 rounded-full bg-yellow-500 status-glow-orange" />

// Crashed
<span className="h-2 w-2 rounded-full bg-red-500" />

// Exited (muted)
<span className="h-2 w-2 rounded-full bg-[var(--color-text-muted)]/30" />
```

**Restart Badge:**
```tsx
<span className="px-1 rounded bg-yellow-500/10 text-yellow-600 text-[10px]">
  ↻ {count}
</span>
```

## Testing

### Unit Tests (`session-status.test.ts`)
- Status determination for all four lifecycle states
- Color class mapping validation
- Glow class logic verification

### Manual Tests (`phase-06-test-plan.md`)
- **T1:** Status dots display correctly in all states
- **T2:** Restart badge increments and shows tooltip
- **T3:** Exit banner color and text branches on exit code + willRestart
- **T4:** Restart banner appears with correct count
- **T5:** Reconnect indicators (dim banners) on WS events
- **T6:** Dashboard auto-refreshes on restart
- **T7:** TerminalTreeView mirrors dashboard status dots

## Performance Considerations

- **StatusDot:** Pure functional component, re-renders only when `session` object changes
- **Query Invalidation:** Only triggered on `process:restarted` (not on every output line)
- **Banner Writing:** Async text operations in xterm don't block React rendering
- **Event Subscriptions:** Transport listeners scoped to component lifecycle (cleanup on unmount)

## Accessibility

- **Color + Icon:** Status dots use both color and glow effect for redundant information
- **Keyboard:** Terminal focus managed via xterm's built-in focus/blur
- **Tooltips:** Restart badge includes title attribute for screen readers
- **Semantic HTML:** Banners are text streams (no hidden markup)

## Common Patterns

### Subscribing to Transport Events in a Component
```tsx
useEffect(() => {
  const unsub = transport.onTerminalExit(sessionId, (event) => {
    // Handle exit
  });
  return unsub;  // Cleanup on unmount
}, [sessionId, transport]);
```

### Updating Queries on Event
```ts
transport.onProcessRestarted(sessionId, (event) => {
  queryClient.invalidateQueries({ queryKey: ["terminal:list"] });
  // Triggers auto-refetch of dashboard
});
```

### Conditional Rendering Based on Status
```tsx
const status = getSessionStatus(session);
if (status === "restarting") {
  // Show yellow indicator
} else if (status === "crashed") {
  // Show red indicator + error message
}
```

## Related Documentation

- [Phase 06 Implementation Plan](../plans/20260415-terminal-enhancement/phase-06-frontend-lifecycle-ui.md)
- [WebSocket Protocol](./ws-protocol-guide.md) — Event payload shapes
- [System Architecture](./system-architecture.md) — Backend integration
