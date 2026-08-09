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

## Error Boundary and stale lazy-chunk recovery

**Location:** `packages/ui/src/components/ui/ErrorBoundary.tsx`

`ErrorBoundary` keeps the existing custom fallback and client diagnostics for
normal render failures. For a conservative set of browser module-load errors—
`ChunkLoadError`, `Loading chunk <n> failed`, `Failed to fetch dynamically
imported module`, or `Importing a module script failed`—it attempts one full
page reload per tab session. The boundary first stores
`dam-hopper:stale-chunk-reload-attempted` in `window.sessionStorage`; an existing
value suppresses another reload. If session storage is unavailable or throws on
read/write, recovery fails closed and the normal fallback remains visible.

The classifier intentionally rejects approximate or unrelated application
errors, so a second stale failure and ordinary render failures follow the same
fallback/diagnostic path. Focused tests in
`packages/ui/src/components/ui/ErrorBoundary.test.tsx` cover these boundaries,
guard ordering, and storage failures.

## Usage Insights Settings

**Locations:** `packages/ui/src/components/pages/SettingsPage.tsx`,
`packages/ui/src/components/organisms/SettingsUsageInsightsSection.tsx`, and
`packages/ui/src/components/organisms/SettingsUsageInsightsCodexRow.tsx`

The Settings page exposes a **Usage insights** section backed by the authenticated
`usage:setupStatus` and `usage:configure` transport methods. It lets users enable or pause
privacy-safe local terminal capture, retry an unavailable loopback receiver, and explicitly
manage optional Codex token export. Codex setup is reported as `notConfigured`, `managed`, or
`conflict`; conflicts disable management and leave existing Codex configuration untouched.
Managing export does not restart Codex, so the UI indicates that a new/restarted Codex session
is required. When capture is disabled, the Usage page links back to Settings and explains that a
new terminal is required for complete run boundaries.

## Usage Session Audit

**Locations:** `packages/ui/src/components/pages/UsagePage.tsx`,
`packages/ui/src/components/usage/UsageSessionAudit.tsx`, `UsageSessionList.tsx`,
`UsageSessionTree.tsx`, and `UsageSessionTokens.tsx`.

The Usage page has Overview and Sessions tabs. Sessions shows bounded aggregate model/delegation
summaries and a selected session's bounded node tree with lineage, token, and terminal-correlation
status. Opaque URL parameters (`view=sessions`, `session`, and authenticated `cursor`) preserve
selection and pagination deep links. Model values are dynamic provider-qualified display strings.

Primary tokens are input + output + reasoning; cached input is displayed separately and excluded.
Partial or unavailable lineage is surfaced, never inferred. Session and terminal identities are
derived HMAC references; raw commands, prompts, responses, tool content, and storage paths are not
rendered or persisted by the UI. List/detail queries poll every 15 seconds only in a visible
document; hidden tabs stop polling. Browser and native hosts share this behavior. Paused collection
keeps stored summaries readable and marks the view paused; deletion remains explicit and destructive.

## Latest Commit in Terminal

**Locations:** `packages/ui/src/components/organisms/SettingsAppearanceSection.tsx`,
`packages/ui/src/components/organisms/TerminalCommitStatusChip.tsx`, and
`packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx`

Settings > Appearance exposes one **Show latest commit in terminal** toggle. When
enabled, the active terminal header renders a compact status chip containing the
current branch, latest commit message, localized timestamp, and seven-character short
hash; hovering exposes full values through the tooltip, and the complete details are
also included in the chip's accessible label. The chip is passive and does not add a refresh action or polling:
the shared project-status query supplies data and Git mutations invalidate it when
fresh status is needed. Missing, invalid, non-Git, or unavailable project status is
handled fail-closed by hiding the chip.

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
- `packages/ui/src/lib/terminal-notification-sound.ts`
- `packages/ui/src/lib/browser-notification-service.ts`
- `packages/ui/src/lib/agent-activity-tracker.ts`
- `packages/ui/src/lib/terminal-notification-navigation.ts`
- `packages/ui/src/stores/terminal-notifications.ts`
- `packages/ui/src/components/organisms/TerminalNotificationCenter.tsx`
- `packages/ui/src/components/organisms/TerminalNotificationFeedItem.tsx`
- `packages/ui/src/components/organisms/TerminalNotificationToastViewport.tsx`

**Purpose:** Pure frontend pipeline for xterm-driven agent notifications. It stays UI-side, has no server dependency, and is unit-test friendly.

**Flow:**

1. `recognizeAgentCommand()` extracts the executable token from a submitted terminal command and matches it against enabled literal or regex agent patterns.
2. `AgentActivityTracker` watches submitted commands, output, user input, and enhanced terminal exit state to decide when to emit activity events.
3. `terminal-notification-signal-parser.ts` normalizes BEL and OSC 9/777/99 terminal signals into a shared `TerminalAgentNotification` shape.
4. `terminal-agent-notification-integration.ts` reads the master and child delivery preferences once for each accepted event. It always records history while the master is on, independently adds a toast, plays the selected synthesized chime at its saved volume, and creates a browser popup only when each corresponding child preference permits it.
5. `TerminalNotificationCenter` renders the TopNav bell, unread count, bounded history, mark-read/all, and clear actions. Selecting an item dispatches a typed event keyed by stable `sessionId`.
6. `TerminalNotificationToastViewport` renders up to three live top-right alerts with a six-second timeout. Toast and feed selection both route through the existing `WorkspacePage` terminal navigation path.
7. `BrowserNotificationService` independently gates native delivery by permission, rate limit, and support checks, then dispatches native `Notification` objects whose body starts with `Project · Bash #N`; the original sanitized body retains its independent payload allowance below that context line.

**Behavior notes:**

- Parsing is defensive: control sequences are stripped, titles/bodies are capped, and invalid regex patterns fail closed.
- Notifications are deduped per `sessionId` + `source` with a default 30s rate limit.
- Quiet tracking is optional; when enabled it emits a "may need attention" notification after configurable inactivity.
- Terminal exit notifications are suppressed when the session is expected to restart, so `willRestart` does not produce a finished notification.
- Retained `terminal:buffer` replay is rendered unchanged but never delivers OSC 9 alerts: a session-local gate opens before xterm writes replay data and closes only from that write's completion callback. Live PTY chunks received while xterm is parsing replay queue in arrival order and flush after the gate closes; data received before any attach buffer keeps the existing fail-closed path.
- Cleanup disposes xterm handlers, timers, and tracker state when the panel unmounts or the session is replaced.
- In-app history is memory-only and capped at 50 records; toast IDs are capped at three. The master Codex setting is the OSC 9 capture gate and the only setting that synchronizes the Codex TUI. While it is enabled, disabling **In-app toast** still records the bell/history entry; **Browser popup** and **Notification sound** are independent delivery gates. Child choices remain saved but are disabled in the UI while the master is off.
- `terminal-notification-sound.ts` reuses one Web Audio context to synthesize four fixed built-in in-app chimes: `default`, `soft`, `two-tone`, and `urgent`. `default` preserves the existing single-chime behavior for compatible saved configurations. Sound does not affect native browser popups and needs no audio assets or dependencies. Unsupported, SSR, autoplay-blocked, and audio-failure paths are silent no-ops; the persisted Sound switch, Sound style selector, and Volume slider control only this best-effort channel. **Play sound** previews the current style and volume from an explicit click; it neither creates a browser popup nor requests browser permission.
- Terminal ordinals are the current 1-based open-list position and are display context only. Navigation never relies on a project name or ordinal. A target must be mounted and either explicitly alive or, only while liveness is unknown, already registered with xterm; explicitly dead, unmounted, and stale targets are safe no-ops.
- In compact coarse-pointer layouts with the mobile custom keyboard enabled, selection still reveals and refits the exact terminal but deliberately avoids forcing native xterm focus so the browser keyboard is not opened unexpectedly.
- Settings live under `SettingsAppearanceSection` via the extracted `TerminalAgentNotificationSettings`, `TerminalNotificationSoundControls`, and `AgentCommandPatternEditor` UI. Browser permission is requested only by the explicit **Request permission** click; changing the Browser popup toggle or saving another preference never requests, revokes, or persists that browser-managed permission. The app surfaces `unsupported`, `not requested`, `granted`, and `denied` states.
- Client diagnostics for this feature are recorded under scope `terminal-agent-notifications` and must not include raw terminal output, replay data, OSC payloads, or command arguments beyond the executable token; replay state may use metadata-only counts.

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
- Compact view swaps to `MobileWorkspaceShell`, which shows one surface at a time with a safe-area-aware floating **Panels** selector. IDE compact surfaces are Explorer, Search, Editor, Terminal, Browser, Git, and Project; terminal compact surfaces are Terminal, Fleet, Ports, Browser, Git, and Project. The selector uses the existing Radix Select focus and dismissal behavior; inactive surfaces stay mounted but hidden/inert so terminal, editor, and Browser state survives switching. Its placement accounts for safe-area insets and short terminal viewports; the compact trigger can be dragged within the viewport without changing its session-only position contract, while a normal tap still opens the selector. The normal compact shell omits the redundant companion header, while optional toolbar actions use a slim single-line row. Wide layouts continue using the existing `IdeShell` and `TerminalWorkspaceShell` desktop shells unchanged.
- On wide screens, Browser opens inside the Terminal tool beside its active terminal. Compact layouts retain Browser as a separate surface. It does not create a PTY.

**Persistence keys:**

- `dam-hopper:workspace-mode` stores the active shell mode (`ide` or `terminal`).

### Terminal Workspace Shell

**Location:** `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx`

**Purpose:** Wraps the terminal-mode workspace layout.

**Behavior:**

- Renders the selected Files, Git, Ports, or Fleet Terminal panel as a floating overlay in terminal mode.
- The floating panel matches the Explorer interaction model: it can be dragged or resized within the terminal workspace.
- Files and tool overlays share a base `z-index` of `20`; activating either panel raises it to `25`, while higher-priority global overlays such as Browser/debug capture remain above them.
- Git, Ports, and Fleet controls are mutually exclusive. Browser is not a floating tool; it is rendered by the active terminal pane.
- Keeps the main terminal area full-height below the top nav.

### Browser Debug Tool

**Locations:** `packages/ui/src/components/organisms/BrowserDebugPanel.tsx`, `packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx`, `packages/ui/src/hooks/use-browser-debug.ts`

The Browser tool previews a development target and lets the user select one semantic DOM element for later artifact/terminal handoff. It accepts HTTP loopback URLs and URLs whose origin matches a currently-ready DamHopper tunnel, including paths, query strings, and hashes; credentials, the workspace origin, and unready or stale tunnel origins are rejected.

The iframe is hosted by a singleton `BrowserDebugKeepAliveHost` outside the conditional IDE/Terminal/compact shells. The host keeps its DOM node stable and positions it over the active viewport, avoiding Chromium reloads caused by physical iframe reparenting. Switching surfaces, maximizing panels, or changing compact tabs therefore does not unload the target document. A load handshake uses a fresh nonce and request IDs; incoming `postMessage` events must match the active `iframe.contentWindow`, exact target origin, nonce, request ID, protocol version, and schema before they are accepted. Redirected or opaque-origin frames fail closed. A timeout keeps the target visible and presents the extension setup flow.

The panel renders bridge status, a live address bar, Back/Forward/Reload controls, a bounded local console, picker controls, and bounded selection metadata. Successfully loaded browser targets are retained as 12 local-only recent-address suggestions in the address input; saved entries contain only origin and path (never credentials, query strings, or hashes), are deduplicated, and are revalidated before each load. The bridge reports full same-origin paths after document loads, History API changes, browser back/forward, and hash changes, so the address bar tracks the actual iframe location. Navigation and console forwarding require an extension built for the exact DamHopper parent origin; they are unavailable to generic loopback parents. Console data is bounded, redacted for common credentials, rendered as text, retained only in the browser session, and never included in terminal artifacts. It does not execute page commands or expose raw HTML, cookies, storage, credentials, or other browser secrets. In wide Terminal and IDE mode, the Browser is a resizable sibling of the focused terminal; that ready terminal is selected automatically for artifact preparation, and a prepared artifact remains bound to it through review/insertion. The compact Browser surface retains its explicit live-terminal chooser. When a selection exists, capture controls can request a browser-tab capture from an explicit user gesture, crop the selected region locally, or accept a PNG/JPEG file or pasted image. Manual JPEG input is converted to PNG locally because the authenticated artifact endpoint accepts PNG only. Capture is optional: denial, unsupported APIs, wrong-surface selection, or crop failure leave semantic selection available. Images remain local until the explicit artifact attach action; closing the Browser surface stops every capture track but intentionally does not unload the iframe.

The native Tauri host preserves this UI contract with a Rust-owned child WebView
instead of the singleton iframe and extension setup. Its controller keeps one
browsing context while changing bounds or visibility, invalidates selection and
capture state on navigation-generation changes, and uses profile-scoped storage.
The extension setup below applies only to the web/browser host; native clients
use the embedded bridge asset.

#### Browser Debug extension

The target application does not install a bridge. Every DamHopper web `dev` or
`build` command creates and serves
`/browser-debug-extension/dam-hopper-browser-debug.zip`. When the Browser tool
does not receive a bridge response, it shows a Download extension ZIP action.
The client must extract the ZIP, open `chrome://extensions`, enable Developer
mode, select Load unpacked, and choose the extracted
`dam-hopper-browser-debug` folder. This one-time Chromium setup is required
because a website cannot install an extension silently. Its content script runs
in the target page's main world so it can observe the page console and History
API, then uses the bounded bridge protocol to return semantic DOM metadata,
location updates, and redacted console previews to DamHopper. It never receives
DamHopper tokens; console output stays local and users should avoid logging
target secrets.

The iframe still must be embeddable: target `X-Frame-Options` or restrictive
`Content-Security-Policy: frame-ancestors` can reject the preview before the
extension runs.

### Multi Terminal Display

**Location:** `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx`

**Purpose:** Renders the active terminal panes inside the terminal workspace.

**Behavior:**

- Reuses existing mounted session state from the terminal manager.
- Does not create a second PTY lifecycle for terminal-mode rendering.
- Refits visible panes when the workspace shell layout changes.
- Threads the global `activeSessionId` through `SplitLayout` into each
  `PaneContainer`. The active pane renders one host-local floating
  `MobileTerminalAccessoryBar` inside its terminal output host, before any
  browser split; it is never mounted over the whole split surface or once per
  pane.

### Floating Terminal Keyboard Controls

**Locations:**

- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx`
- `packages/ui/src/components/organisms/TerminalAccessoryControls.tsx`
- `packages/ui/src/components/organisms/TerminalFloatingControlShell.tsx`
- `packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx`
- `packages/ui/src/components/organisms/TerminalScrollButtons.tsx`
- `packages/ui/src/components/organisms/PaneContainer.tsx`
- `packages/ui/src/components/organisms/SplitLayout.tsx`

**Behavior:**

- Keys and Type are a host-local, absolute `z-10` overlay inside each positioned
  terminal output host. The group uses the same translucent surface and dismissal
  conventions as the scroll controls, with a safe-area-aware lower-right anchor.
- TerminalScrollButtons keeps the outer lower-right rail. The keyboard group uses
  the adjacent safe-area-aware lane, including the expanded rail width and an 8px
  gap, when scrolling is enabled and reclaims that lane when it is disabled; its
  outer wrapper is pointer-inert so empty overlay space does not steal xterm,
  pane, or docking events.
- Expanded special keys and custom/native Type input stay in the existing local
  component state and continue writing through the active session's authenticated
  terminal transport. The native Type input remains focusable; control presses
  prevent xterm focus and stop host propagation. Escape and outside pointer
  dismissal close open panels and Escape restores the invoking trigger focus.
- Rendering the group is independent from native-input suppression. Android policy
  and the existing compact/coarse/custom-keyboard policy still control xterm/native
  input behavior; showing desktop controls alone never suppresses xterm input.
  The custom keyboard is selected only for Android suppression or compact/coarse
  pointers with the setting enabled; fine-pointer desktop Type always uses the
  focusable native input.
- Expanded content is bounded by the host and visual viewport (`dvh`), safe-area
  insets, and a 22rem width cap, so opening a panel does not add an in-flow row or
  reduce the xterm host height.

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

**Purpose:** Renders a single terminal session using xterm.js. Handles lifecycle events (output, exit, restart, reconnect), session attachment, and in-app/native agent notification integration. Phase 1 adds the session-local find controller; TerminalPanel lifecycle wiring follows in Phase 2.

**Behavior:** Filters out the terminal workspace shortcut so xterm input does not swallow the global mode toggle. Wires xterm BEL and OSC 9/777/99 handlers into the shared agent-activity path so submitted command, output, user input, and exit signals can drive in-app and native browser notifications without any backend protocol change. During retained buffer replay, it keeps the OSC 9 delivery gate active through xterm's asynchronous write callback, then FIFO-flushes queued live data so historical alerts stay silent and subsequent live alerts are preserved. Attach recovery permits only one in-flight attach per panel, retries an alive session with capped exponential backoff, and creates a replacement only after a `terminal:listDetailed` check confirms the session is missing or dead. The terminal session cleanup path disposes signal handlers and timers; search controller cleanup is added with the Phase 2 lifecycle wiring.

#### Inline terminal suggestions (Phase 04)

`useTerminalSuggestions` owns one `TerminalSuggestionController` per mounted terminal and
exposes its immutable snapshot to React. The controller observes only typed,
server-validated `terminal:lifecycle` events; a `submitted` event with an exact command is the
only automatic local-history write path. `TerminalPanel` notifies the controller for each
streamed output write, on attach/replay and process restart, and on composition/paste, so all
of those boundaries invalidate an in-flight search before it can surface a stale result.

The input adapter remains deliberately passive: it returns original input through the regular
`terminalWrite` path without replacement bytes. In desktop layouts, `TerminalPanel` renders only
the remaining suffix from a current verified `ghost` snapshot. `TerminalSuggestionGhost` is
unfocusable, `aria-hidden`, pointer-inert, single-line, and clipped/faded at narrow widths, so it
cannot cover or replace the typed prefix.

The composed xterm key handler owns exactly three desktop actions. `Alt+Right` accepts the full
verified suffix and `Alt+Shift+Right` accepts its next token; each action atomically consumes the
snapshot before sending that suffix once through the ordinary PTY write path. It never sends the
typed prefix, `Ctrl+U`, or Enter. `Ctrl+Alt+H` opens the history dialog only when suggestions are
enabled. Every other key, including Tab, Enter, Escape, Ctrl+R, arrows, paste, IME composition,
and TUI input, continues to xterm unchanged. Coarse-pointer and native-keyboard-suppressed
surfaces disable automatic ghosts and the history shortcut rather than risking stale UI.

`TerminalCursorGeometryAdapter` is the sole cursor anchor implementation. It validates public
textarea measurements relative to the current terminal host and has one validated screen-grid
fallback; unknown, detached, scrolled-back, alternate-buffer, or out-of-bounds geometry hides
the ghost. Cursor/write/resize/scroll/zoom/font changes are coalesced to one animation frame,
and terminal host attachment explicitly invalidates geometry after reparenting.

`TerminalHistoryList` is a deliberate, keyboard-focused dialog rather than a passive menu. It
shows full command text with accessible names, search, Copy, and Use actions. Use inserts the
chosen one-line command without executing it; multi-line commands remain visible and copy-only.

`command-history.ts` stores local v2 entries with exact command text kept apart from normalized
Unicode search text. Ranking is shared by terminal and command-search consumers: exact raw
prefixes outrank Unicode token-prefix matches, with recency and use count breaking the latter.
Entries retain total and per-project usage without creating project-specific copies of the raw
command. Browser storage errors and the local-history disabled preference prevent persistence.

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

**Terminal workspace:** The same `PortsPanel` is available in a floating Terminal workspace overlay through its configurable shortcut, so detected ports and tunnel actions remain available without switching back to IDE mode.

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
- Terminal pin/unpin is session-only open-tab state shared by the IDE tab bar and Runtime navigator; pinned sessions hide their close action and cannot be closed until unpinned. IDE and Runtime terminal output use the theme background, with Runtime output adding an inset border and focus ring for clearer contrast.
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
- Detects `ApiRequestError` with code `GIT_NOT_INITIALIZED` from root or branch
  queries and renders an unavailable state with `git init` guidance instead of
  showing empty branch controls.

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
- Handles the typed `GitDiffResult` unavailable variant (`gitAvailable: false`)
  and shows `Git is not initialized for this project` with `git init` guidance;
  no stage, discard, or commit controls are offered in that state.

### Workspace Git Panel

**Location:** `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`

**Purpose:** Orchestrates root selection, scoped branch/history views, and the selected commit details panel.

**Behavior:**

- Fetches VCS roots with `useGitRoots(project)` and shows a root selector above the history controls.
- Falls back to the primary root while discovery is loading so branch/history controls keep a stable query scope.
- Keeps branch and history queries scoped to the selected root id.
- Refreshes root-aware query keys for branches, history, and commit-file details.
- Treats the selected root as the active context for commit details and double-click diff opens.
- If root or branch discovery reports `GIT_NOT_INITIALIZED`, replaces the panel
  with the shared unavailable message and initialization guidance. Usable nested
  roots remain selectable when discovery succeeds.
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

**Terminal mode:** The floating Files panel defaults to its Explorer left-pane tab each time it opens and adds a sibling Changes tab. Closing it unmounts its content, so it reopens in Explorer rather than retaining a prior Changes selection. Explorer continues to render `FileTree` with its Git status badges; Changes reuses `ChangedFilesList` for local stage/unstage, discard, commit, and diff-opening actions. The separate floating Git panel remains the surface for branch, history, and remote operations.

### Explorer language filter

**Locations:** `packages/ui/src/components/organisms/FileTree.tsx`, `packages/ui/src/hooks/use-fs-subscription.ts`, `packages/ui/src/api/queries.ts`, and `packages/ui/src/lib/explorer-language-scan.ts`

**Behavior:**

- `All` continues to use the existing live, lazy filesystem tree. Phase 03 will
  consume the bounded project scan to build the filtered navigation-only hierarchy.
- Scanning is explicit through `Scan`/`Rescan`; hydrating the persisted filter, changing projects, or receiving filesystem events never starts a request automatically. The typed QueryClient entry is keyed by `['explorer-language-scan', project]` and stores the result, generation, stale flag, and last completed timestamp in memory only.
- A filesystem event increments the project generation and marks an existing scan stale without refetching. If an event arrives during a scan, the response remains usable but stays stale. Failed rescans preserve the previous result; workspace changes remove all language-scan entries, and query-client reset/reload clears them naturally.
- The selected `explorerLanguageFilter` is persisted through the global UI settings path, defaulting to `all`. Scan results, stale state, timestamps, and expanded scan-tree folders are not persisted.

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

## Cooperative Browser Debug Bridge

**Package:** `@dam-hopper/browser-bridge` (used by `apps/browser-extension`)

The extension content script runs inside a framed development target without
requiring target application changes. It has no DamHopper token, filesystem,
PTY, storage, or network capability. Its only task is to return a bounded,
semantic selection after a user click; returned text is preview data, never
HTML.

The host uses the exact `iframe.contentWindow` when parsing messages. It issues
a fresh nonce after every load/navigation or reconnect and accepts only request
IDs it created for that nonce. The extension and host fail closed on source,
exact-origin, nonce, request-ID, version, and schema mismatches; redirects and
opaque-origin frames are rejected.

Every DamHopper web build includes
`/browser-debug-extension/dam-hopper-browser-debug.zip`. In the client
browser, extract that download, open `chrome://extensions`, enable Developer
mode, select Load unpacked, and choose the extracted
`dam-hopper-browser-debug` folder. The target app does not install a package
or script.

The extension marks the parent and framed documents with a versioned DOM
presence marker for onboarding only. Bridge activation still requires an
allowed parent origin: loopback parents work by default; deployed parent
origins must be compiled into the archive with
`VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS` as a comma-separated exact-origin
list. The extension download is intentionally a single setup-card action.

An existing `X-Frame-Options` or restrictive CSP header may still prevent
embedding; the Browser tool surfaces that load failure instead of weakening
browser framing policy.

Selection payloads are versioned semantic data only: bounded tag/role/name/text,
an allow-listed set of attributes, a bounded locator, and finite bounds. They
never contain HTML, input values, passwords/files, cookies, storage, or other
browser secrets. The bridge package is used by the browser extension; the
Phase 3 host provides the long-lived iframe owner, exact-origin navigation
policy, handshake/load-error UX, and CSP framing guidance.

## Related Documentation

- [System Architecture](./system-architecture.md)
- [Configuration Guide](./configuration-guide.md)
