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

**Purpose:** Renders a single terminal session using xterm.js. Handles lifecycle events (output, exit, restart, reconnect) and session attachment (Phase 3).

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

**Lifecycle & Attachment (Phase 3):**

TerminalPanel implements smart session persistence via the attach protocol:

1. **Mount Detection** (`useEffect`):
   - Checks if session already exists via `terminal:list`
   - If exists → call `terminalAttach()` to reconnect with buffer replay
   - If not exists → call `terminal:create` to spawn new session

2. **Attach Flow**:
   ```ts
   // Setup listener BEFORE sending attach (Phase 3)
   unsubBuffer = transport.onTerminalBuffer(sessionId, ({ data, offset }) => {
     term.clear();
     term.write(data);  // Replay buffered output
     setAttachState("attached");
   });

   // Send attach request to server
   transport.terminalAttach(sessionId);

   // Timeout fallback: if no buffer within 3s, create new session
   attachTimeout = setTimeout(() => {
     createSession();
   }, 3000);
   ```

3. **UI Feedback** (`attachState`):
   - State machine: `idle` → `attaching` → `attached` (or → `creating`)
   - When `attachState === "attaching"`: Show spinner overlay
   ```tsx
   {attachState === "attaching" && (
     <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center backdrop-blur-sm">
       <div className="text-sm text-slate-300 flex items-center gap-2 animate-pulse">
         <svg className="animate-spin h-4 w-4" ...> {/* spinner */} </svg>
         Reconnecting...
       </div>
     </div>
   )}
   ```

**Key Hooks Inside:**
- `useEffect` — initializes xterm, sets up event listeners, manages PTY lifecycle
- Transport event subscriptions:
  - `onTerminalBuffer()` — receives replayed buffer on attach (Phase 3)
  - `onTerminalExitEnhanced()` → writes exit banner, calls `onExit`
  - `onProcessRestarted()` → writes restart banner, updates session state
  - `onStatusChange()` → writes reconnect status banners on WS disconnect/reconnect

**Banner Logic:**
```ts
// Exit banner (green/red/yellow based on willRestart)
const color = sess.willRestart ? "\x1b[33m" : sess.exitCode === 0 ? "\x1b[32m" : "\x1b[31m";
term.write(`\r\n${color}[banner text]\x1b[0m\r\n`);

// Reconnect status
if (status === "disconnected") term.write("\r\n\x1b[2m[Reconnecting…]\x1b[0m\r\n");
if (status === "connected") term.write("\r\n\x1b[2m[Reconnected]\x1b[0m\r\n");
```

**Cleanup (Phase 3):**
- Unsubscribe buffer listener on unmount or when attached
- Clear attach timeout if pending
- PTY session persists across navigation for user recall

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

## Drag-to-Split Terminal Layout (Phase 02)

**Feature:** Interactive terminal pane splitting via drag-and-drop. Users drag terminal tabs to pane edges to create new splits, or to pane centers to move tabs between existing panes.

**Dependencies:** `@dnd-kit/core@6.3.1`, `@dnd-kit/utilities@3.2.2`

### SplitLayout

**Location:** `packages/web/src/components/organisms/SplitLayout.tsx`

**Purpose:** Root layout container wrapping dnd-kit context with drag handlers. Manages split layout tree and implements drag-end logic.

**Key Features:**
- **DndContext** — Wraps entire split layout tree
- **PointerSensor** — 8px activation threshold (prevents accidental drags from clicks)
- **pointerWithin** collision strategy — Accurate zone detection for edge/center targets
- **DragOverlay** — Floating label showing dragged tab name during drag
- **handleDragEnd()** — Implements split/transfer logic:
  - Drag to **edge zone** (top/bottom/left/right) → calls `layout.splitPane()` with direction
  - Drag to **center zone** → calls `layout.moveTabToPane()` to transfer tab
  - Validates source ≠ target pane before transfer
  - Collapses source pane if last tab left

**Props:**
```ts
interface SplitLayoutProps {
  layout: UseTerminalLayoutResult;        // Layout state + methods
  mountedSessions: MountedSession[];      // Active terminal sessions
  openTabs: TabEntry[];                   // Open tabs from TerminalTabBar
  onNewTerminal: () => void;              // Callback: launch new terminal
  onSessionExit: (sessionId: string) => void;
  onSelectTab: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
}
```

**Drag End Handler Pattern:**
```ts
const handleDragEnd = (event: DragEndEvent) => {
  const { over } = event;
  if (!over) return;
  
  const [paneId, zone] = over.id.toString().split(":");
  const dragData = event.active.data.current as DragItem;
  
  if (zone === "center") {
    layout.moveTabToPane(dragData.sessionId, dragData.sourcePaneId, paneId);
  } else {
    const direction = zone === "top" || "bottom" ? "horizontal" : "vertical";
    layout.splitPane(paneId, direction, dragData.sessionId);
  }
};
```

### TabBar

**Location:** `packages/web/src/components/organisms/TabBar.tsx`

**Purpose:** Draggable tab bar for a single pane. Each tab shows session label and close button.

**Exports:**
- `TabBar` — Tab bar component
- `DragItem` — Interface for drag payload

**DragItem Interface:**
```ts
export interface DragItem {
  type: "terminal-tab";
  sessionId: string;
  sourcePaneId: string;  // Pane tab was dragged from
}
```

**DraggableTab Component:**
- Grip handle (≡ icon) with listeners — Only listeners here to avoid blocking tab click
- Tab label — Clickable to select/focus, click doesn't trigger drag
- Close button (✕) — Kill session in pane
- **isDragging** state — Opacity reduced while dragging

**Props:**
```ts
interface TabBarProps {
  paneId: string;
  tabs: TabEntry[];
  activeSessionId?: string | null;
  onSelectTab: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
}
```

**Styling:**
- Active tab: `border-b-2 border-[var(--color-primary)]`
- Inactive: `border-transparent` (underline hidden)
- Dragging: `opacity-40`
- Grip handle: Hover shows opacity toggle (30% → 70%)

### PaneContainer

**Location:** `packages/web/src/components/organisms/PaneContainer.tsx`

**Purpose:** Individual pane container that renders terminals and manages drop zones. One `PaneContainer` per pane node in the layout tree.

**PaneDropZones Component:**
Five droppable zones around the pane edges (always rendered but display-toggled):

```tsx
function PaneDropZones({ paneId, isDragging }: PaneDropZonesProps) {
  const top = useDroppable({ id: `${paneId}:top` });
  const bottom = useDroppable({ id: `${paneId}:bottom` });
  const left = useDroppable({ id: `${paneId}:left` });
  const right = useDroppable({ id: `${paneId}:right` });
  const center = useDroppable({ id: `${paneId}:center` });
  // ... render zones with absolute positioning
}
```

**Zone Configuration:**
| Zone | Position | Size | Action |
|------|----------|------|--------|
| **top** | `inset-x-0 top-0` | `h-5` | Split horizontal above |
| **bottom** | `inset-x-0 bottom-0` | `h-5` | Split horizontal below |
| **left** | `inset-y-0 left-0` | `w-5` | Split vertical left |
| **right** | `inset-y-0 right-0` | `w-5` | Split vertical right |
| **center** | `inset-5` (rest of pane) | Interior | Transfer tab (no split) |

**Visual Feedback:**
- **Dragging state active** → Zones have `pointer-events: auto`
- **Over edge/center** → `bg-blue-500/30 ring-2 ring-blue-400` (20ms transition)
- **Not dragging** → `pointer-events-none` (doesn't block terminal input)

**PaneContainer Props:**
```ts
interface PaneContainerProps {
  node: PaneNode;                        // Pane metadata
  layout: UseTerminalLayoutResult;       // Layout state + splitPane(), moveTabToPane()
  mountedSessions: MountedSession[];     // Terminal DOM elements
  openTabs: TabEntry[];                  // Tabs available in this pane
  onNewTerminal: () => void;
  onSessionExit: (sessionId: string) => void;
  onSelectTab: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
}
```

**Drag State Tracking:**
```ts
const [isDragging, setIsDragging] = useState(false);
useDndMonitor({
  onDragStart: () => setIsDragging(true),
  onDragEnd: () => setIsDragging(false),
  onDragCancel: () => setIsDragging(false),
});
```

### useTerminalLayout — New Methods (Phase 02)

**Location:** `packages/web/src/hooks/useTerminalLayout.ts`

#### moveTabToPane(sessionId, fromPaneId, toPaneId)

**Purpose:** Atomically move a tab from one pane to another without splitting.

**Signature:**
```ts
moveTabToPane(sessionId: string, fromPaneId: string, toPaneId: string): void
```

**Behavior:**
1. Add `sessionId` to target pane's session list
2. Remove from source pane's session list
3. If source pane is now empty → collapse (delete pane node from tree)
4. Auto-focus target pane after transfer
5. If sessions list exists in both panes, set target as active session

**Usage:**
```ts
// Called from SplitLayout handleDragEnd when dropping on center zone
layout.moveTabToPane(draggedSessionId, currentPaneId, targetPaneId);
```

### Drag-to-Split User Flow

```
User drags tab by grip handle
       ↓
[DragOverlay shows floating tab label]
       ↓
    ┌──────────────────────────────┐
    │ Pointer moves over pane      │
    │ (5 zones now visible)        │
    └──────────────────────────────┘
       ↓
    ┌──────────────────────────────┐
    │ User hovers over zone:       │
    │ - Edge (top/bottom/left/r)   │
    │ - Center                     │
    └──────────────────────────────┘
       ↓
    [Blue highlight appears on zone]
       ↓
    [User releases mouse]
       ↓
    ┌──────────────────────────────┐
    │ handleDragEnd fires:         │
    │ - If edge → splitPane()      │
    │ - If center → moveTabToPane()│
    └──────────────────────────────┘
       ↓
    ┌──────────────────────────────┐
    │ Layout tree updates          │
    │ React reconciliation         │
    │ New pane rendered            │
    │ Tab moves or splits          │
    └──────────────────────────────┘
```

### Edge Case Behaviors

| Scenario | Behavior |
|----------|----------|
| Drag to **same pane center** | No-op (ignored) |
| Drag **last tab** from source pane | Source pane collapses if other panes exist |
| Drag to **pane with other tabs** | Tab appended, target pane assumes focus |
| **Rapid successive drags** | Each drag is independent; layout updates after each release |
| Drag **outside any drop zone** | Cancel (no effect) |

### Performance Notes

- **PaneDropZones:** Rendered always but invisible when not dragging (no React unmount cost)
- **DndContext:** Singleton per SplitLayout; all panes share same context
- **Collision Detection:** `pointerWithin` — Fast spatial queries
- **DragOverlay:** Only renders during active drag (no background cost)
- **useDndMonitor:** Lightweight event listener (no polling)

## Combined Ports & Tunnel Panel

**Phases 02-04 Complete ** — Unified sidebar panel combining port detection and tunnel management.

### PortsPanel

**Location:** `packages/web/src/components/organisms/PortsPanel.tsx`

**Purpose:** Single panel replacing both deprecated `TunnelPanel` and `PortsPanel`. Displays detected network ports with integrated tunnel creation/management UI.

**Key Features:**
- Merges detected ports (`DetectedPort[]` from `/api/ports`) with active tunnels (`TunnelInfo[]` from `/api/tunnels`)
- Three row states per port:
  - **State A:** No tunnel — shows "Open localhost" (if same-host) and "Start tunnel" button
  - **State B:** Tunnel starting — spinner overlay on "☁" button
  - **State C:** Tunnel ready — displays public URL, copy/QR buttons, "Stop" button
- "Open localhost" button visible only when `isLocalServer()` returns true
- Custom port form at bottom allows starting tunnels for specific ports
- cloudflared installer row (missing binary state) preserved from TunnelPanel
- Public URL warning banner (localStorage-gated, shown once)
- Full state machine with error recovery

**Props:**
```ts
interface PortsPanelProps {
  // No props — uses hooks internally (usePorts, etc.)
}
```

### usePorts Hook

**Location:** `packages/web/src/hooks/usePorts.ts`

**Purpose:** Merges port detection and tunnel state, manages tunnel operations.

**Return Type:**
```ts
{
  ports: PortEntry[];                                  // Merged ports + tunnels
  isLoading: boolean;                                  // Query pending
  isError: boolean;                                    // Query failed
  createTunnel: (port: number, label: string) => Promise<void>;
  stopTunnel: (id: string) => Promise<void>;
  installCloudflared: () => Promise<void>;
  installState: InstallState;
}
```

**PortEntry Interface:**
```ts
interface PortEntry {
  port: number;                                        // Port number
  project: string | null;                              // Project name if detected
  state: "provisional" | "listening" | "lost";         // Port state
  tunnel: TunnelInfo | null;                           // Active tunnel or null
}
```

**Data Flow:**
1. Query `/api/ports` → `DetectedPort[]` (project, state, port)
2. Query `/api/tunnels` → `TunnelInfo[]` (port, url, status, id)
3. Merge by port number into `PortEntry[]`
4. Subscribe to WS push events: `port:discovered`, `port:lost`, `tunnel:ready`, `tunnel:failed`, `tunnel:stopped`
5. Invalidate queries on reconnect (via `useSSE` integration)

### isLocalServer()

**Location:** `packages/web/src/api/server-config.ts`

**Purpose:** Determines if configured server is on same host as browser.

**Signature & Behavior:**
```ts
export function isLocalServer(): boolean {
  try {
    return new URL(getServerUrl()).host === location.host;
  } catch {
    return true;  // Safe default for dev mode
  }
}
```

When true, "Open localhost" shortcuts appear in PortsPanel. In Vite dev mode, always returns true (server is local).

### DetectedPort Type

**Location:** `packages/web/src/api/client.ts`

**Definition:**
```ts
export interface DetectedPort {
  port: number;                      // Port number
  project: string | null;            // Associated project, if known
  state: "provisional" | "listening" | "lost";
  proxy_url?: string;                // Vestigial, ignored (tunnels handled separately)
}
```

### WebSocket Events (Port-Related)

**port:discovered** — Fired when port first detected in `/proc/net/tcp` or stdout scanner
```ts
transport.onPortDiscovered((port: DetectedPort) => {
  // Update ports list
  queryClient.invalidateQueries({ queryKey: ["ports"] });
});
```

**port:lost** — Fired when port closes and is no longer listening
```ts
transport.onPortLost((port: number) => {
  // Remove from display
  queryClient.invalidateQueries({ queryKey: ["ports"] });
});
```

**tunnel:ready** — Fired when cloudflared establishes public URL
```ts
transport.onTunnelReady((info: TunnelInfo) => {
  // Show URL, hide spinner
  queryClient.invalidateQueries({ queryKey: ["tunnels"] });
});
```

**tunnel:failed** — Fired when tunnel creation fails
```ts
transport.onTunnelFailed((id: string, reason: string) => {
  // Show error, revert to State A
  queryClient.invalidateQueries({ queryKey: ["tunnels"] });
});
```

**tunnel:stopped** — Fired when user stops tunnel
```ts
transport.onTunnelStopped((id: string) => {
  // Remove tunnel from list
  queryClient.invalidateQueries({ queryKey: ["tunnels"] });
});
```

### Component Deletion

**TunnelPanel.tsx** — DELETED (functionality merged into PortsPanel)
- Sub-components (WarningBanner, InstallerRow, QR display) now inlined in PortsPanel
- `useTunnels.ts` kept for Phase 05 evaluation (not currently used by PortsPanel)

### Sidebar Integration

**Location:** `packages/web/src/components/organisms/Sidebar.tsx`

Before Phase 04, panel stack was:
```tsx
{!collapsed && <TunnelPanel />}
{!collapsed && <PortsPanel />}
```

Now (Phase 04+):
```tsx
{!collapsed && <PortsPanel />}  {/* Combined panel replaces both */}
```

## Related Documentation

- [Phase 02-04 Implementation Plans](../plans/20260425-port-detection-tunnel-combined/plan.md)
- [Phase 02 Implementation Plan](../plans/20260424-terminal-split-and-port-forward/plan.md)
- [Phase 06 Implementation Plan](../plans/20260415-terminal-enhancement/phase-06-frontend-lifecycle-ui.md)
- [WebSocket Protocol](./ws-protocol-guide.md) — Event payload shapes
- [System Architecture](./system-architecture.md) — Backend integration
