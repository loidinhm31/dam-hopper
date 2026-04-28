# Frontend Components

Architecture and documentation for React components in the Dam Hopper web UI.

## Overview

The frontend is a React 19 SPA (packages/web/) using:
- **Vite** for bundling
- **Redux Toolkit** for state management
- **TanStack Query** for server state
- **Tailwind CSS** for styling
- **xterm.js** for terminal rendering

## IDE Tool Window System

Dam Hopper uses an extensible IDE-style Tool Window system, inspired by IntelliJ IDEA.

### ActivityBar

**Location:** `packages/web/src/components/organisms/ActivityBar.tsx`

**Purpose:** Renders the vertical or horizontal strip of icons used to toggle tool windows.

**Features:**
- Active state highlighting
- Customizable icon/name for tools
- Supports side (left/right) layout configuration

### ToolPanel

**Location:** `packages/web/src/components/organisms/ToolPanel.tsx`

**Purpose:** The container for active tool content.

**Features:**
- Handles resizing (integrated with `react-resizable-panels`)
- Header with tool title and action buttons
- Automatic focus management
- Close functionality

### Integration in IdeShell

**Location:** `packages/web/src/components/templates/IdeShell.tsx`

The `IdeShell` orchestrates the system:
```tsx
<IdeShell>
  <ActivityBar tools={toolDefinitions} activeId={activeId} />
  {activeTool && <ToolPanel tool={activeTool} />}
  <MainArea />
</IdeShell>
```

---

## Key Components

### TerminalPanel

**Location:** `packages/web/src/components/organisms/TerminalPanel.tsx`

**Purpose:** Renders a single terminal session using xterm.js. Handles lifecycle events (output, exit, restart, reconnect) and session attachment.

**Props:**
```ts
interface TerminalPanelProps {
  sessionId: string;
  project: string;
  command: string;
  cwd?: string;
  onExit?: (code: number | null) => void;
  className?: string;
}
```

### TerminalTreeView

**Location:** `packages/web/src/components/organisms/TerminalTreeView.tsx`

**Purpose:** Sidebar tree showing projects and their terminal sessions.

### PortsPanel

**Location:** `packages/web/src/components/organisms/PortsPanel.tsx`

**Purpose:** Combined panel for port detection and tunnel management.

---

## Session Status Helpers

**Location:** `packages/web/src/lib/session-status.ts`

**Purpose:** Centralize session lifecycle logic.

### SessionStatus Type
```ts
export type SessionStatus = "alive" | "restarting" | "crashed" | "exited";
```

## Related Documentation

- [System Architecture](./system-architecture.md)
- [Configuration Guide](./configuration-guide.md)
