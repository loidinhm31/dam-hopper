# Terminal and IDE Components

Detailed component architecture split from [Frontend Components](../frontend-components.md) to keep each guide focused and maintainable.

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
- Optional maximize/restore toggle (`maximizable`, `isMaximized`, and `onToggleMaximize` props) sits left of the close button, provides accessible "Maximize panel"/"Restore panel" labels, and appears only on bottom tool panels.

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
- Uses `gitPanelShortcut`, `projectPanelShortcut`, `portsPanelShortcut`, and
  `fleetTerminalShortcut` for keyboard access to the Git, Project, Ports, and
  Fleet Terminal tools in IDE and Terminal modes. Defaults are
  `Mod+Shift+KeyG`, `Mod+Shift+KeyZ`, `Mod+Shift+KeyP`, and `Mod+Shift+KeyM`.
- Those four shortcuts toggle their target and keep the target group exclusive;
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

- Renders the selected Files, Git, Project, Ports, or Fleet Terminal panel as a floating overlay in terminal mode. The Project panel reuses the same target-aware Project content as the IDE Project tool, including its Worktrees disclosure and project/worktree selection state.
- The floating panel matches the Explorer interaction model: it can be dragged or resized within the terminal workspace.
- Files and tool overlays share a base `z-index` of `20`; activating either panel raises it to `25`, while higher-priority global overlays such as Browser/debug capture remain above them.
- Git, Project, Ports, and Fleet controls are mutually exclusive. Re-selecting the active Project control closes the floating tool; selecting another control replaces it. Browser is not a floating tool; it is rendered by the active terminal pane.
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

Both native and web hosts expose Responsive and Custom viewport controls.
Custom width and height are whole CSS-pixel values bounded to 160–4096. The
top-bar `+` probe and the symmetric stepper buttons change both dimensions by
16px, with state persisted in browser-local storage under a platform-scoped
key. Keyboard shortcuts are intentionally not part of this feature. A custom
stage may overflow and scroll; the native child and fallback iframe both use
stage-aware remeasurement. The native child receives the complete requested
viewport rectangle so responsive layout keeps the selected width and height;
only the fallback iframe is clipped to the visible stage intersection. This
does not resize the main window; main-window resizing is a separate native
shell concern.

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

### Native SSH forwarding host (Phase 08)

**Locations:** `apps/native/src/native-ssh-forward-host.ts`,
`packages/ui/src/lib/ssh-forward-host.ts`,
`packages/ui/src/contexts/SshForwardHostContext.tsx`,
`packages/ui/src/hooks/use-ssh-forward.ts`

The native host is constructed only for enabled Windows desktop support. It
opens one client context, stores a `ScopeHandle` per server-profile scope, and
passes an explicit `NativeScopeRef` with every snapshot, connection, rule,
credential, and trust operation. Mutations serialize per scope; equal IDs in
different scopes remain independent. The host validates exact DTO keys, UUIDs,
counters, timestamps, identity, scope generation, and revisions before state
enters React.

`SshForwardScopeBridge` derives native scope IDs from the saved profile list,
calls `reconcileKnownScopes` when that list changes, and purges a deleted scope
only after profile absence and available storage are confirmed. `useSshForward`
can consume an explicit scope reference or open the requested scope through the
host. Project focus, route changes, Settings focus, and SSH-page focus do not
switch native scope. Browser and mobile hosts render the shared UI without an
SSH-forward host.

`ssh-forward:changed` is a bounded refetch hint. It must match the current
desktop/manager/client context, activation token, scope, generation, and
numeric revisions before a scoped snapshot is requested; events never patch
React state directly.

Native Browser Debug is independent: `NativeBrowserDebugHost.setTarget` receives
the Phase 05 `BrowserDebugTarget` with explicit `owner`, creates one
`browser-debug` child, and rejects stale owner/origin/session/generation relay
messages. It must not infer Browser ownership from the most recently opened SSH
scope or active project.

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

- Keys and Type are host-local, absolute `z-10` overlays within each positioned
  terminal output surface. The group uses the same translucent surface and
  dismissal conventions as the scroll controls, with a raised lower-right
  anchor at `3rem + var(--safe-area-bottom, 0px)` (48px plus the safe-area
  inset) and the existing right safe-area handling.
- TerminalScrollButtons shares the terminal output footer's positioned
  containing block. In the closed state it keeps the 48px bottom baseline,
  `6.25rem` accessory reservation, and 8px gap. When an accessory panel opens,
  the scroll trigger and Keys/Type shell lift above that in-flow panel; short
  viewports switch the trigger and shell to adjacent horizontal lanes instead
  of stacking them vertically.
- The scroll rail toggle opens a four-action group for jumping to the top or
  bottom and moving by the configured terminal scroll step. Escape or a
  pointerdown outside the controls closes the group, and the trigger maintains
  its `aria-expanded`/`aria-controls` linkage.
- Pointerdown cancellation and touchstart propagation guards cover the toggle
  and all four actions: they prevent pointer focus and host bubbling, blur a
  focused `.xterm-helper-textarea`, and preserve click and keyboard activation.
  Coarse-pointer taps therefore do not hand focus back to xterm and reopen the
  Android IME.
- Terminal Keys exposes Esc, Tab, Ctrl+C (shown as ^C), Enter, PgUp, PgDn, Up,
  Down, Left, and Right in matching visual and keyboard order.
- Custom Type defaults to a five-row US 60%-style physical layout with the
  existing arrow cluster, duplicate modifier keys, `Fn`, and `Win`. On compact
  coarse-pointer surfaces it switches to a minimized alpha layout: one
  `Shift`, `Ctrl`, and `Alt`, no arrow/`Fn`/`Win` keys, and `Enter` in the
  navigation row. Terminal Keys continues to expose the removed arrow actions
  and can remain open alongside Type.
- Expanded special keys and custom/native Type input stay in the existing local
  component state and continue writing through the active session's
  authenticated terminal transport. The native Type input remains focusable;
  control presses prevent xterm focus and stop host propagation. Escape and
  outside pointer dismissal close open panels and Escape restores the invoking
  trigger focus.
- Rendering the group is independent from native-input suppression. Android
  policy and the existing compact/coarse/custom-keyboard policy still control
  xterm/native input behavior; showing desktop controls alone never suppresses
  xterm input.
- The custom keyboard is selected when Android suppression is active or when
  `mobileCustomKeyboardEnabled` is enabled; otherwise Type uses the focusable
  native input, including on fine-pointer desktop surfaces.
- Every custom key keeps a 44px minimum height, responsive 14px-to-44px
  width, 4px-to-8px horizontal gap, and accessible title/ARIA label. The full
  layout remains five rows and uses the existing width-responsive 60% geometry.
  The minimized layout keeps word characters on four alpha/navigation rows and
  moves digits and punctuation to a three-row `123` sublayout. Its panel clips
  horizontal overflow instead of creating a page or panel scroll track.
- Shift changes the visible number/symbol labels to the character that will be
  sent. Ctrl letter chords are announced as `Ctrl+X`; Alt/Meta combinations
  include their active modifier prefix. Both layouts grow rows to fill the
  available width and stay centered without horizontal scrolling.

- Expanded content remains a full-width, trailing in-flow panel with
  `overflow-x-hidden overflow-y-auto` and
  `max-height: min(20rem, calc(100dvh - 6rem - var(--safe-area-bottom, 0px)))`.
  The Keys/Type shell moves above the panel when it opens. At short viewport
  heights, Keys/Type and the scroll trigger use a horizontal lane so all three
  44px controls remain reachable; an opened scroll rail occupies the adjacent
  compact lane. Safe-area padding accounts for viewport insets, while flex
  sizing keeps the panel within the positioned host. The outer terminal surface
  stays fixed while the flex output host yields available height without
  collapsing.
- Terminal compact shells leave the bottom safe-area inset to the terminal
  accessory controls rather than reserving it again on the terminal root;
  non-terminal compact workspace modes retain root safe-area padding.

**Verification/status:**

- Focused UI unit coverage for the accessory controls passed: 27 tests across
  five files.
- The `packages/ui` TypeScript build passed.
- Direct Chromium accessory-browser coverage passed all 10 checks.

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

### Terminal touch scrolling and page-gesture containment

`TerminalPanel` binds `bindTerminalTouchScroll` from
`packages/ui/src/lib/terminal-touch-scroll.ts` after xterm v6 opens. xterm's
scrollback is a custom buffer surface, so the helper translates vertical
swipes into `terminal.scrollLines()` calls rather than relying on a native
scroll container. It listens only when `(any-pointer: coarse)` matches, and
uses capture-phase, passive `touchstart`, `touchmove`, `touchend`, and
`touchcancel` handlers. Single-touch movement is accumulated by screen line
height, flushed on animation frames, and a bounded decaying fling continues
after release; multi-touch and helper-textarea/scrollbar touches are ignored
or cancel the gesture.

The xterm viewport and scrollable element use `touch-action: none` and
`overscroll-behavior: contain` (with the `.xterm` root also contained). This
keeps terminal swipes from panning the browser page or triggering pull-to-refresh.
The binding returns an idempotent cleanup function that cancels pending move and
inertia frames and removes all four listeners; `TerminalPanel` invokes it when
the terminal effect is disposed.

Focused unit coverage is in
`packages/ui/src/lib/terminal-touch-scroll.test.ts`. Run it with:

```bash
pnpm --filter @dam-hopper/ui test -- src/lib/terminal-touch-scroll.test.ts
```

The scroll-button/browser integration surface is covered by
`packages/ui/browser-tests/terminal-scroll-buttons.browser.tsx`; run the focused
browser test with:

```bash
pnpm --filter @dam-hopper/ui test:browser -- browser-tests/terminal-scroll-buttons.browser.tsx
```

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

`command-history.ts` stores local v3 entries with exact command text kept apart from normalized
Unicode search text. Entry IDs are salted with `profileId`, and reads are filtered by profile so
identical commands never cross profile boundaries. Ranking is shared by terminal and
command-search consumers: exact raw prefixes outrank Unicode token-prefix matches, with recency
and use count breaking the latter. Browser storage errors and the local-history disabled
preference prevent persistence.

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
  worktreePath?: string;
  profileId?: string;
  terminalRef?: { profileId: string; id: string };
  onExit?: (code: number | null) => void;
  onNewTerminal?: () => void;
  onTerminalReady?: (sessionId: string) => void;
  suppressAutoFocus?: boolean;
  suppressNativeKeyboard?: boolean;
  terminalOrder?: number;
  webglEnabled?: boolean;
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
- Terminal pin/unpin is browser-tab state shared by the IDE tab bar and Runtime navigator. Pinned live sessions survive a page reload through profile-partitioned, IDs-only `sessionStorage` (`dam-hopper:terminal-pins:v2:<encoded-profileId>`; payload v2), but never leave the browser tab or reach the server. Unpinning and explicit terminal removal clear the stored ID; stale IDs are removed after a successful terminal-session refresh. Pinned sessions hide their close action and cannot be closed until unpinned. IDE and Runtime terminal output use the theme background, with Runtime output adding an inset border and focus ring for clearer contrast.
- Terminal layout persistence uses owner/group-qualified localStorage keys in the form `dam-hopper:terminal-layout:v3:<encoded-[profileId,groupId]>` with payload version 2. Traditional terminal projects intentionally do not migrate the legacy global layout tree; each owner/group starts with its default pane on first visit.

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

### Project worktree target lifecycle

`ProjectWorktreesSection` owns the Project panel's target selector and keeps
the configured project identity separate from the selected Git worktree. One
session-memory selection is shared by Explorer, search/replace, Git, editor,
diff, media, and terminal creation; switching the target changes their scoped
query/cache inputs without changing the project name or configured root.

Before app-initiated removal, the section refreshes Git discovery and checks
the exact `(project, targetPath)` against editor tabs and live terminal
sessions. Dirty tabs and live sessions are listed in an accessible blocker
message, so the app never removes a target while it owns unsaved work or an
active PTY. Git's own dirty/untracked protection remains authoritative after
that UI check.

External disappearance and prunable discovery rows remain visible as
unavailable. New requests use the configured root only after the target store
has recorded the unavailable target; existing dirty editor tabs are preserved,
and live sessions whose immutable server-validated `worktreePath` matches that
path display an `orphaned` warning in `TerminalTreeView`. Older sessions
without that metadata fall back to their `project`/`cwd` for reconciliation.
Target-scoped build, run, custom-command, and profile IDs use stable opaque
target discriminators, while the server keeps the canonical path in metadata.
A failed target-scoped launch or respawn records the exact worktree as
unavailable through the shared terminal event bridge only after fresh
validation confirms target loss. Reloading the browser starts from the
configured root, while compact and floating surfaces consume the same target
snapshot.

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

**Locations:** `packages/ui/src/components/organisms/FileTree.tsx`, `packages/ui/src/stores/explorer-tree.ts`

**Purpose:** Reuses shared file decorations in Git-aware file rows so file identity stays consistent across the explorer and Git views. The Explorer header area also hosts `GitBranchControl` so users can switch or create branches without leaving the file browser.

**Persistent Tree Expansion:** Directory open/closed states are managed by `useExplorerTreeStore` (`packages/ui/src/stores/explorer-tree.ts`) and persisted in `localStorage` under `dam-hopper:explorer-tree-state`. This ensures that expanded folders survive sidebar tool switching (e.g. Explorer ↔ Search), sidebar collapses, workspace mode transitions (IDE ↔ Terminal), and full browser page reloads.

- **Target scoping:** Scoped per project target via `explorerTreeScopeKey(target)` (`${normalized.project}::${projectTargetCacheKey(normalized)}`), isolating regular project trees and worktree targets.
- **Initial open state & toggle:** `FileTree` supplies `initialOpenState={openMap}` to `react-arborist` and synchronizes toggle events via `onToggle` and `setFolderOpen`. Toggling closed removes the key to keep persisted storage compact.
- **Cascading child auto-hydration:** When mounting with persisted open folders, `FileTree` scans for open folders with unloaded children (`children === null`) and automatically triggers `loadChildren(id)`. If loading fails (e.g. directory deleted externally), `prunePath` cleans up the invalid path.
- **Path mutation synchronization:** Renames and Drag-and-Drop moves invoke `renamePath(scopeKey, oldPath, newPath)` to update exact folder keys and all descendant path prefixes; deletions call `prunePath(scopeKey, path)` to clear the folder and its subtree.

**Terminal mode:** The floating Files panel defaults to its Explorer left-pane tab each time it opens and adds a sibling Changes tab. Closing it unmounts its content, so it reopens in Explorer rather than retaining a prior Changes selection. Explorer continues to render `FileTree` with its Git status badges; Changes reuses `ChangedFilesList` for local stage/unstage, discard, commit, and diff-opening actions. The separate floating Git panel remains the surface for branch, history, and remote operations.

### Editor viewState persistence

**Locations:** `packages/ui/src/components/organisms/MonacoHost.tsx`, `packages/ui/src/components/organisms/EditorTabs.tsx`, `packages/ui/src/stores/editor.ts`

**Purpose:** Preserves Monaco editor view states (cursor position, column, scroll offsets, and code folds) across tab switching, component unmounting (such as sidebar/panel toggling), and page reloads.

- **Storage & Hydration:** View state is part of persisted editor tab state under `dam-hopper:editor-state` in `localStorage`. Hydrated tabs retain view state across `loadContent` invocations so opening the file restores line and column positions.
- **Race-Safe State Capture:** `MonacoHost` captures the originating tab's view state prior to switching active `tabKey` using `prevTabKeyRef` and on unmount, passing `targetKey` explicitly to prevent view states from polluting newly selected tabs.

### Phase 03 files/editor/search ownership

The IDE surfaces consume one qualified target:
`{ profileId, project, worktreePath? }`. `editorTargetScopeKey()` and
`projectTargetCacheKey()` keep equal paths on different profiles or worktrees
separate. `MonacoHost` uses the qualified tab key in its in-memory URI, so
Monaco view state and dirty state cannot leak between targets.

`use-fs-ops`, `use-fs-subscription`, and `use-fs-upload` route CRUD, writes,
watchers, and uploads through the captured profile transport. Filesystem events
update or refetch only the matching target. `LargeFileViewer` uses read-only
64 KiB range reads for files at least 5 MiB; image/video preview components use
their owner-scoped media-ticket adapters.

`useFsSubscription` resolves a qualified target through
`captureConnection(profileId)` and `getTransport(owner)`, with no ambient
fallback when that owner is unavailable. The transport captured by
`fs:subscribe_tree` remains the owner for event binding, lazy child listing,
unsubscribe, and cache cleanup. Cleanup retires the exact subscription payload,
so a remount creates a fresh watch; profile generation changes follow the same
teardown/rebind path. `IdleTransport` keeps the seam callable while offline:
event/unsubscribe methods are no-ops, and subscription/mutation methods reject
with `Server profile required`.

`SearchPanel` exposes Project target and All connected profiles scopes. The
search hook preserves profile/project/target metadata, reports per-profile
status, sorts deterministically, and warns when its 500-result aggregate cap or
the server truncation signal makes results incomplete. The replace hook resolves
each match's target and never overwrites a dirty tab; Replace All reports
replaced, skipped-dirty, and failed files.

Git fetch/pull results stay target-specific. The shared SSH retry hook keeps
successful initial results and retries only authentication-failed targets after
owner-generation validation. A changed connection cancels the retry.

See [Phase 03: Files, Editor, Search, and Git](../phase-03-files-editor-search-git.md)
for the transport and invalidation source map.

### Explorer language filter

**Locations:** `packages/ui/src/components/organisms/FileTree.tsx`, `packages/ui/src/hooks/use-fs-subscription.ts`, `packages/ui/src/api/queries.ts`, and `packages/ui/src/lib/explorer-language-scan.ts`

**Behavior:**

- All uses the existing live, lazy filesystem tree. Rust, JS/TS, and Java
  project the bounded scan result into a complete, navigation-only synthetic
  hierarchy; these rows are not live filesystem nodes and file mutations are
  disabled while a language filter is active.
- Scanning is explicit through the Scan/Rescan actions; hydrating the persisted filter, changing projects, or receiving filesystem events never starts a request automatically. The typed QueryClient entry is keyed by `['explorer-language-scan', project]` and stores the result, generation, stale flag, and last completed timestamp in memory only.
- A filesystem event increments the project generation and marks an existing scan stale without refetching. If an event arrives during a scan, the response remains usable but stays stale. Failed rescans preserve the previous result; workspace changes remove all language-scan entries, and query-client reset/reload clears them naturally. Each successfully committed result increments `resultVersion`, including same-generation rescans, so the synthetic tree remounts from the committed snapshot.
- The selected `explorerLanguageFilter` is persisted through the global UI settings path, defaulting to `all`. Scan results, stale state, timestamps, and expanded scan-tree folders are not persisted.
- Scan presentation exposes the last completed time, stale warning, in-progress rescan status, truncation warning, and scan errors; a filter with no result prompts to scan, while an empty committed result reports no matching files.
- Revealing an active file safely switches a filtered view back to `All`, then waits for the live tree's committed lazy-child render before opening parents, selecting, and scrolling. A reveal is marked handled only after success and its request nonce makes retries independently triggerable.

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
