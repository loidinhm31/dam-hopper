# Frontend Components

Architecture and documentation for the shared React UI used by the DamHopper
browser host and Tauri native host.

## Overview

The frontend is split into thin hosts plus a shared React 19 UI package:

- `apps/web` mounts the browser host and initializes `WsTransport(getServerUrl())`.
- `apps/native` mounts the Tauri v2 host and uses `IdleTransport` until a server
  profile is configured.
- `packages/ui` owns the shared components, hooks, stores, API clients, styles,
  and tests consumed by both hosts.

Shared runtime libraries:

- **Vite** for bundling hosts
- **Zustand** for client state
- **TanStack Query** for server state
- **Tailwind CSS v4** for styling
- **xterm.js** for terminal rendering

## Shared File Decorations

**Location:** `packages/ui/src/lib/file-decoration.ts`

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

## Terminal Agent Notifications

**Locations:**

- `packages/ui/src/lib/agent-command-recognizer.ts`
- `packages/ui/src/lib/terminal-notification-signal-parser.ts`
- `packages/ui/src/lib/browser-notification-service.ts`
- `packages/ui/src/lib/agent-activity-tracker.ts`
- `packages/ui/src/lib/terminal-notification-navigation.ts`

**Purpose:** Pure frontend pipeline for xterm-driven agent notifications. It stays UI-side, has no server dependency, and is unit-test friendly.

**Flow:**

1. `recognizeAgentCommand()` extracts the executable token from a submitted terminal command and matches it against enabled literal or regex agent patterns.
2. `AgentActivityTracker` watches submitted commands, output, user input, and enhanced terminal exit state to decide when to emit activity events.
3. `terminal-notification-signal-parser.ts` normalizes BEL and OSC 9/777/99 terminal signals into a shared `TerminalAgentNotification` shape.
4. `BrowserNotificationService` gates browser delivery by permission, rate limit, and support checks, then dispatches native `Notification` objects whose body starts with `Project · Bash #N`; the original sanitized body retains its independent payload allowance below that context line.
5. Notification clicks dispatch a typed selection event keyed by stable `sessionId`; `WorkspacePage` preserves the current IDE/Terminal mode, reveals the existing IDE Terminal tool or compact Terminal surface, selects the exact session, and activates its registered xterm instance.

**Behavior notes:**

- Parsing is defensive: control sequences are stripped, titles/bodies are capped, and invalid regex patterns fail closed.
- Notifications are deduped per `sessionId` + `source` with a default 30s rate limit.
- Quiet tracking is optional; when enabled it emits a "may need attention" notification after configurable inactivity.
- Terminal exit notifications are suppressed when the session is expected to restart, so `willRestart` does not produce a finished notification.
- Cleanup disposes xterm handlers, timers, and tracker state when the panel unmounts or the session is replaced.
- Terminal ordinals are the current 1-based open-list position and are display context only. Navigation never relies on a project name or ordinal. A target must be mounted and either explicitly alive or, only while liveness is unknown, already registered with xterm; explicitly dead, unmounted, and stale targets are safe no-ops.
- In compact coarse-pointer layouts with the mobile custom keyboard enabled, selection still reveals and refits the exact terminal but deliberately avoids forcing native xterm focus so the browser keyboard is not opened unexpectedly.
- Settings live under `SettingsAppearanceSection` via the extracted `TerminalAgentNotificationSettings` and `AgentCommandPatternEditor` UI. Permission is requested only from the explicit button click and the app surfaces `unsupported`, `not requested`, `granted`, and `denied` states without persisting that browser permission.
- Client diagnostics for this feature are recorded under scope `terminal-agent-notifications` and must not include raw terminal output, OSC payloads, or command arguments beyond the executable token.

## IDE Tool Window System

Dam Hopper uses an extensible IDE-style Tool Window system, inspired by IntelliJ IDEA.

### ActivityBar

**Location:** `packages/ui/src/components/organisms/ActivityBar.tsx`

**Purpose:** Renders the vertical or horizontal strip of icons used to toggle tool windows.

**Features:**

- Active state highlighting
- Customizable icon/name for tools
- Supports side (left/right) layout configuration

### ToolPanel

**Location:** `packages/ui/src/components/organisms/ToolPanel.tsx`

**Purpose:** The container for active tool content.

**Features:**

- Handles resizing (integrated with `react-resizable-panels`)
- Header with tool title and action buttons
- Automatic focus management
- Close functionality
- Optional maximize/restore toggle (`maximizable`, `isMaximized`, `onToggleMaximize` props) rendered left of the close button; swaps `Maximize2`/`Minimize2` icons with an accessible `aria-label` ("Maximize panel" / "Restore panel"). Only bottom tool panels opt in.

### Integration in IdeShell

**Location:** `packages/ui/src/components/templates/IdeShell.tsx`

The `IdeShell` orchestrates the system:

```tsx
<IdeShell>
  <ActivityBar tools={toolDefinitions} activeId={activeId} />
  {activeTool && <ToolPanel tool={activeTool} />}
  <MainArea />
</IdeShell>
```

### Bottom Panel Maximize Toggle

The bottom tool panels (Terminal/Git/Ports — `position:"bottom"` tools) expose an IntelliJ-style maximize/restore toggle. When maximized, the bottom panel expands to cover the entire top area (explorer, source-control, editor, and right-top panels are hidden via `display:none`), while the activity bars stay visible so tools remain switchable. The state is **session-only** (not persisted): closing the maximized bottom tool, or switching workspace mode, resets it. The maximize is implemented as sibling-only CSS class flips in `IdeShell` — the terminal keep-alive element stays in the same React tree position, so no PTY is remounted or duplicated on toggle. Layout decisions are centralized in the pure `resolveBottomPanelLayout` helper (`packages/ui/src/lib/ide-shell-layout.ts`) so the maximize/restore/reset-on-close contract is unit-testable under the SSR test harness. Maximizing also unselects any active top tools on both sides (the activity bar no longer highlights them while the bottom panel covers the top area); selecting a top tool from the activity bar again — or triggering a reveal-active-file request — restores the normal layout. The maximize/top-tool state transitions are extracted into pure `resolveMaximizeToggle` / `resolveTopToolToggle` helpers for SSR unit testing.

### Workspace Mode Shell

**Location:** `packages/ui/src/components/pages/WorkspacePage.tsx`

**Purpose:** Owns the persisted workspace mode for the main workspace shell.

**Behavior:**

- Stores `workspaceMode` in `localStorage` key `dam-hopper:workspace-mode`.
- Valid values: `ide` and `terminal`; fallback is `ide`.
- Passes optional mode props through `IdeShell` to `TopNav`.
- `TopNav` renders a compact IDE/Terminal toggle only when mode props are supplied.
- `IdeShell` keeps the mode contract optional, so existing callers without mode props render unchanged.
- Uses `terminalWorkspaceShortcut` from UI config for the global mode toggle.
- Default binding is `Mod+Shift+Backquote`.
- Uses `gitPanelShortcut`, `portsPanelShortcut`, and `fleetTerminalShortcut` for
  keyboard access to the Git, Ports, and Fleet Terminal tools in IDE and Terminal
  modes. Defaults are
  `Mod+Shift+KeyG`, `Mod+Shift+KeyP`, and `Mod+Shift+KeyM`.
- Those three shortcuts toggle their target and keep the target group exclusive;
  xterm custom key handlers suppress the bindings before PTY input.
- In terminal mode, `WorkspacePage` renders a full-height terminal workspace below the top nav.
- The same terminal manager state is reused across mode switches, so PTY lifecycle is not duplicated.
- Terminal panes refit when switching modes or when the Fleet Terminal rail changes size/collapse state.
- Compact view swaps to `MobileWorkspaceShell`, which shows one surface at a time with bottom-tab navigation for Explorer, Editor, Terminal, Git, Ports, and Project.

**Persistence keys:**

- `dam-hopper:workspace-mode` stores the active shell mode (`ide` or `terminal`).

### Terminal Workspace Shell

**Location:** `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx`

**Purpose:** Wraps the terminal-mode workspace layout.

**Behavior:**

- Renders the selected Git, Ports, or Fleet Terminal panel in a persisted right rail in terminal mode.
- Terminal panel shortcuts are mutually exclusive: opening one panel replaces the other two, and repeating the same shortcut collapses the rail.
- Persists rail width and collapse state with `dam-hopper:terminal-workspace-fleet-width` and `dam-hopper:terminal-workspace-fleet-collapsed`.
- Keeps the main terminal area full-height below the top nav.
- Triggers terminal refit on rail resize and collapse changes.

### Multi Terminal Display

**Location:** `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx`

**Purpose:** Renders the active terminal panes inside the terminal workspace.

**Behavior:**

- Reuses existing mounted session state from the terminal manager.
- Does not create a second PTY lifecycle for terminal-mode rendering.
- Refits visible panes when the workspace shell layout changes.

### Resize Handle Hook

**Location:** `packages/ui/src/hooks/use-resize-handle.ts`

**Purpose:** Shared resize state helper for workspace shell rails and split panes.

**Behavior:**

- Persists terminal rail width and collapse state where the caller opts in.
- Emits layout updates that trigger terminal refit after mode or rail changes.

---

## Key Components

### TerminalPanel

**Location:** `packages/ui/src/components/organisms/TerminalPanel.tsx`

**Purpose:** Renders a single terminal session using xterm.js. Handles lifecycle events (output, exit, restart, reconnect), session attachment, and browser agent notification integration. Phase 1 adds the session-local find controller; TerminalPanel lifecycle wiring follows in Phase 2.

**Behavior:** Filters out the terminal workspace shortcut so xterm input does not swallow the global mode toggle. Wires xterm BEL and OSC 9/777/99 handlers into the shared agent-activity path so submitted command, output, user input, and exit signals can drive browser notifications without any backend protocol change. The terminal session cleanup path disposes signal handlers and timers; search controller cleanup is added with the Phase 2 lifecycle wiring.

Codex OSC 9 notifications include `Project · Bash #N`, where `N` is the
terminal's current 1-based position in the open list. Selecting the native
notification focuses Dam Hopper, preserves the current IDE/Terminal mode,
reveals the IDE Terminal tool or compact Terminal surface when needed, selects
the originating live session by stable session ID, and focuses its xterm. Notifications for
sessions closed before selection are ignored safely. On compact coarse-pointer
devices with the mobile custom keyboard enabled, selection reveals and refits
the xterm without forcing focus or opening the native keyboard.

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

**Location:** `packages/ui/src/components/organisms/TerminalTreeView.tsx`

**Purpose:** Sidebar tree showing projects and their terminal sessions.

### PortsPanel

**Location:** `packages/ui/src/components/organisms/PortsPanel.tsx`

**Purpose:** Combined panel for port detection, tunnel management, and confirmed session kill control for detected ports.

**Data flow:** `usePorts()` preserves `sessionId` on detected rows and exposes `killPortSession(sessionId)` so the panel can terminate the owning terminal session without direct process handling.

**Terminal workspace:** The same `PortsPanel` is available in the Terminal workspace right rail through its configurable shortcut, so detected ports and tunnel actions remain available without switching back to IDE mode.

### PaneContainer

**Location:** `packages/ui/src/components/organisms/PaneContainer.tsx`

**Behavior:** Suppresses the same terminal workspace shortcut inside split-pane terminal containers, matching `TerminalPanel` input handling.

### Terminal Docking

**Locations:**

- `packages/ui/src/components/organisms/SplitLayout.tsx`
- `packages/ui/src/components/organisms/PaneContainer.tsx`
- `packages/ui/src/components/organisms/TabBar.tsx`
- `packages/ui/src/lib/terminal-layout-docking.ts`
- `packages/ui/src/lib/terminal-layout-tree.ts`

**Purpose:** Provides intent-based terminal docking for the terminal workspace without changing PTY lifecycle ownership.

**Behavior:**

- Dock targets are explicit: pane center, pane edge, and tab insertion index.
- `SplitLayout` parses dnd-kit droppable IDs and delegates one atomic `dockSession()` action to the layout hook.
- `terminal-layout-docking.ts` removes the session from the source pane, inserts or splits into the target, collapses safe-empty source panes, and focuses the destination pane in one state transition.
- `TabBar` exposes insertion droppables before the first tab, between tabs, and after the last tab for reorder and cross-pane insertion.
- `PaneContainer` renders labeled five-zone docking previews only while dragging, keeping pointer interference off the live terminal during normal input.
- Re-dropping onto the same pane center only changes active tab focus; invalid self-edge splits are ignored.
- Terminal layout persistence remains in localStorage under `dam-hopper:terminal-layout`.

**Runtime verification notes:**

- Manual verification is still required for xterm reparenting, focus retention, resize/refit timing, and PTY reuse across IDE/Terminal mode switches.
- Automated coverage currently proves shortcut normalization, workspace mode persistence, and pure docking-tree transitions.

## Git Workspace Panel

**Location:** `packages/ui/src/components/pages/GitPage.tsx`

**Purpose:** Primary Git workspace view for branch management, history browsing, and local change review.

### WorkspaceGitPanel

**Location:** `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`

**Purpose:** Composes the Git page into branch controls, commit history, and working tree sections.

### GitBranchControl

**Location:** `packages/ui/src/components/organisms/GitBranchControl.tsx`

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
- Accepts an optional `root` so the selector can target a specific VCS root instead of the project default.

**Dialogs:** `GitBranchControlDialogs.tsx` contains the supporting create/checkout/update dialogs.

### GitLogTree

**Location:** `packages/ui/src/components/organisms/GitLogTree.tsx`

**Purpose:** Renders the commit history tree and anchors history actions.

### GitHistoryActions

**Location:** `packages/ui/src/components/organisms/GitHistoryActions.tsx`

**Purpose:** Provides commit-level actions from the log view.

**Behavior:**

- Maps Git mutation results into a shared status model with `success`, `blocked`, `conflict`, `dirty`, and `error` states.
- Cherry-picks the selected commit and surfaces conflict/dirty result flags.
- Opens a reset confirmation dialog for soft, mixed, hard, and keep reset modes.
- Marks destructive history actions clearly before invoking the backend.
- Groups history actions into safe vs rewrite actions.
- Scopes mutations by `root` and keeps action state isolated per `project + root` pair.

### GitLocalChanges

**Location:** `packages/ui/src/components/organisms/GitLocalChanges.tsx`

**Purpose:** Renders local diff state, stage/unstage/discard actions, and commit entry.

**Behavior:**

- Reads the root-aware diff query and mutation hooks.
- Groups staged and unstaged entries by `rootId` when the diff payload includes multiple VCS roots.
- Uses the root metadata from the server to keep submodule/gitlink rows distinct from normal files.
- Blocks commit submission when staged entries span multiple roots, so mixed-root commits are rejected in the UI before the request is sent.

### Workspace Git Panel

**Location:** `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`

**Purpose:** Orchestrates root selection, scoped branch/history views, and the selected commit details panel.

**Behavior:**

- Fetches VCS roots with `useGitRoots(project)` and shows a root selector above the history controls.
- Falls back to the primary root while discovery is loading so branch/history controls keep a stable query scope.
- Keeps branch and history queries scoped to the selected root id.
- Refreshes root-aware query keys for branches, history, and commit-file details.
- Treats the selected root as the active context for commit details and double-click diff opens.
- Converts root-relative commit file paths back to project-relative editor paths before opening diffs.
- Exposes undo last commit and safe revert paths for local history recovery.
- Prevents local commit drops for pushed commits and shows a shared revert recommendation instead.
- Branch-history operations refresh Git, project status, file tree, and open editor tabs through scoped Git invalidation helpers.

### Project Info Panel

**Location:** `packages/ui/src/components/organisms/ProjectInfoPanel.tsx`

**Purpose:** Provides the project-level Git action strip used in the workspace sidebar.

**Behavior:**

- Fetches VCS roots with `useGitRoots(projectName)` and shows a root selector when the project exposes more than one root.
- Falls back to the project root when discovery has not returned any roots yet, so fetch/pull/push still have a stable scope.
- Builds the push payload from the selected root: project-root pushes stay `api.git.push(project)`, while child-root pushes pass `{ project, root }`.
- Exposes a separate `Force Push` action that confirms before sending the same root-aware payload with `force: true`.
- Uses force push only as an explicit publish step for an already-rewritten branch; it does not bypass the pushed-history safety guards in the history actions UI.
- Routes fetch, pull, and push through the SSH retry hook so passphrase prompts are reused for all three actions.
- Relies on the shared backend libgit2 credential callback path for fetch/pull/push, so retry behavior is consistent across all three operations instead of being push-specific.
- Reuses the shared retry status banner for push completion feedback, so successful push and force-push actions confirm visibly in the same place as SSH and failure feedback.
- Retries exactly once after a successful SSH key load; if the retry still fails with SSH auth, the hook surfaces the failure status and a later action can reopen the prompt instead of getting stuck behind stale cache state.
- Surfaces non-auth push failures, including non-fast-forward rejections, through the shared retry status banner instead of dropping them on the floor.
- Uses the same root labels and mapping-state descriptions as the workspace Git panel, so project-level and branch-level root selectors stay consistent.
- Renders a root selector only when a project actually has multiple discovered roots, keeping the sidebar compact for single-root repos.
- Keeps the root-aware project selector test-covered, including default-root fallback, child-root push payloads, and selector rendering.
- Reuses the shared retry status model so SSH retry feedback matches the Git page and other callers.

### Passphrase Dialog

**Location:** `packages/ui/src/components/organisms/PassphraseDialog.tsx`

**Purpose:** Captures the SSH key passphrase for fetch/pull/push retries and optionally requests saved persistence.

**Behavior:**

- Defaults to the first discovered SSH key when one is available.
- Keeps "Default key" explicit in the selector instead of silently binding the first discovered key into the submitted payload; the label explains that the server chooses automatically.
- Submits `(passphrase, keyPath, saveForLater)` to the shared retry hook.
- Resets the passphrase, selected key, and save checkbox on submit or cancel.
- Explains that saved persistence is best-effort and session-only fallback still works when device credential storage is unavailable.

### ChangedFilesList

**Location:** `packages/ui/src/components/organisms/ChangedFilesList.tsx`

**Purpose:** Renders the file-level change list used by the local changes view.

### FileTree integration

**Location:** `packages/ui/src/components/organisms/FileTree.tsx`

**Purpose:** Reuses shared file decorations in Git-aware file rows so file identity stays consistent across the explorer and Git views. The Explorer header area also hosts `GitBranchControl` so users can switch or create branches without leaving the file browser.

### GitPage

**Location:** `packages/ui/src/components/pages/GitPage.tsx`

**Purpose:** Standalone Git operations page for bulk fetch/pull actions across selected projects, with shared commit-history and diff interactions.

**Behavior:**

- Uses the shared Git history action hook and the same commit-details/diff flow as the workspace panel.
- Resets the selected commit state when project selection changes.
- Supports file double-click diffing from the selected commit in the Git view.
- Uses the same safe-vs-rewrite action labeling as the workspace Git panel.
- Exposes single-project push with root-aware payload selection, matching the sidebar Git action strip.
- Reuses the same backend credential model as the sidebar strip, so page-level push retry behavior stays aligned with fetch and pull.

---

## Session Status Helpers

**Location:** `packages/ui/src/lib/session-status.ts`

**Purpose:** Centralize session lifecycle logic.

### SessionStatus Type

```ts
export type SessionStatus = "alive" | "restarting" | "crashed" | "exited";
```

## Related Documentation

- [System Architecture](./system-architecture.md)
- [Configuration Guide](./configuration-guide.md)
