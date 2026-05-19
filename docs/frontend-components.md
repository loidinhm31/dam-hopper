# Frontend Components

Architecture and documentation for React components in the Dam Hopper web UI.

## Overview

The frontend is a React 19 SPA (packages/web/) using:

- **Vite** for bundling
- **Redux Toolkit** for state management
- **TanStack Query** for server state
- **Tailwind CSS** for styling
- **xterm.js** for terminal rendering

## Shared File Decorations

**Location:** `packages/web/src/lib/file-decoration.ts`

**Purpose:** Central source of truth for file icons, badge text, display language, and Monaco language.

**Visible consumers:**

- `FileTree`
- `EditorTab`
- `SearchPanel`
- `FilePathLabel`

**Notes:**

- Exact filename lookup takes priority, then extension, then MIME, then neutral fallback.
- `file-decoration-icon.tsx` only renders the shared lookup result.
- Git change rows can reuse the same lookup for file identity while keeping VCS badges separate.

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

**Purpose:** Combined panel for port detection, tunnel management, and confirmed session kill control for detected ports.

**Data flow:** `usePorts()` preserves `sessionId` on detected rows and exposes `killPortSession(sessionId)` so the panel can terminate the owning terminal session without direct process handling.

## Git Workspace Panel

**Location:** `packages/web/src/components/pages/GitPage.tsx`

**Purpose:** Primary Git workspace view for branch management, history browsing, and local change review.

### WorkspaceGitPanel

**Location:** `packages/web/src/components/organisms/WorkspaceGitPanel.tsx`

**Purpose:** Composes the Git page into branch controls, commit history, and working tree sections.

### GitBranchControl

**Location:** `packages/web/src/components/organisms/GitBranchControl.tsx`

**Purpose:** Handles branch-focused actions such as checkout, create, and update flows.

**Visible consumers:**

- `WorkspaceGitPanel`
- `FileTree` Explorer header

**Behavior:**

- Lists local and remote branches through the shared Git API client.
- Creates branches from the current or selected base branch.
- Checks out branches from both Git workspace and Explorer surfaces.
- On dirty checkout, offers normal retry, stash then checkout, force checkout, or cancel.
- Uses `invalidateGitProjectQueries()` as the cache invalidation source of truth after mutations.
- Branch mutations refresh `branches`, `projects`, `project-status`, and `git-log`; checkout paths also refresh `git-diff`, `git-conflicts`, and `fs-tree`.

**Dialogs:** `GitBranchControlDialogs.tsx` contains the supporting create/checkout/update dialogs.

### GitLogTree

**Location:** `packages/web/src/components/organisms/GitLogTree.tsx`

**Purpose:** Renders the commit history tree and anchors history actions.

### GitHistoryActions

**Location:** `packages/web/src/components/organisms/GitHistoryActions.tsx`

**Purpose:** Provides commit-level actions from the log view.

**Behavior:**

- Maps Git mutation results into a shared status model with `success`, `blocked`, `conflict`, `dirty`, and `error` states.
- Cherry-picks the selected commit and surfaces conflict/dirty result flags.
- Opens a reset confirmation dialog for soft, mixed, hard, and keep reset modes.
- Marks destructive history actions clearly before invoking the backend.
- Prevents local commit drops for pushed commits and shows a shared revert recommendation instead.
- Branch-history operations refresh Git, project status, file tree, and open editor tabs through scoped Git invalidation helpers.

### GitLocalChanges

**Location:** `packages/web/src/components/organisms/GitLocalChanges.tsx`

**Purpose:** Shows staged and unstaged working tree changes for the active project.

### ChangedFilesList

**Location:** `packages/web/src/components/organisms/ChangedFilesList.tsx`

**Purpose:** Renders the file-level change list used by the local changes view.

### FileTree integration

**Location:** `packages/web/src/components/organisms/FileTree.tsx`

**Purpose:** Reuses shared file decorations in Git-aware file rows so file identity stays consistent across the explorer and Git views. The Explorer header area also hosts `GitBranchControl` so users can switch or create branches without leaving the file browser.

### GitPage

**Location:** `packages/web/src/components/pages/GitPage.tsx`

**Purpose:** Standalone Git operations page for bulk fetch/pull actions across selected projects, with shared commit-history and diff interactions.

**Behavior:**

- Uses the shared Git history action hook and the same commit-details/diff flow as the workspace panel.
- Resets the selected commit state when project selection changes.
- Supports file double-click diffing from the selected commit in the Git view.

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
