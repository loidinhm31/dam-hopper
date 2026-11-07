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

### OS Desktop Integration & Legacy Shell Retirement

Following Phase 08 root cutover, the monolithic legacy shell wrappers (`IdeShell`, `WorkspacePage`, `TerminalWorkspaceShell`, `MobileWorkspaceShell`, `TopNav`, `AppLayout`) were permanently retired and deleted.

In DamHopper OS, terminal workspaces and tool panels operate as independent, windowed applications within `OsShell`:
- **Windowed Application Adapters (`packages/ui/src/os/apps/`):** Terminals (`TerminalsApp`), editor (`EditorApp`), Git operations (`GitApp`), ports and tunnels (`PortsTunnelsApp`), and files (`FilesApp`) run as separate windows within the hybrid tiling + float desktop window manager (`TileTree<T>`).
- **Root Keep-Alive Reparenting (`OsResourceHost`):** Live xterm terminal instances and Monaco editor instances are owned by root keepalive hosts (`TerminalKeepAliveHost`, `MonacoKeepAliveHost`) inside `OsResourceHost`. Moving windows between tiled slots, floating frames, or different desktops imperatively attaches DOM nodes to visible slots without unmounting or re-creating PTY sessions.
- **Zero Placement Attach/Replay Invariant (F2):** Repositioning or docking an existing terminal window preserves the identical xterm DOM instance with zero re-attachment, zero scrollback replays, and zero terminal resets. Reconnects are strictly bounded to actual network reconnects.
- **Generic Terminal Input Policy (`terminal-input-policy.ts`):** Web-mobile virtual keyboards and coarse-pointer layout hooks are retired. Stdin suppression is enforced generically via `syncTerminalInputSuppression`, disabling xterm stdin and unfocusing the hidden textarea across Cognito privacy mode, disconnected profiles, and modal focus traps.
- **Guarded Session Termination:** Terminal closing evaluates live vs. dead processes, offering guarded OS process termination via atomic `POST /api/terminal/{id}/terminate` with manager-lifetime UUID epoch fencing (`X-DamHopper-PTY-Epoch`).
### Browser Debug Tool

**Locations:** `packages/ui/src/components/organisms/BrowserDebugPanel.tsx`, `packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx`, `packages/ui/src/hooks/use-browser-debug.ts`

The Browser tool previews a development target and lets the user select one semantic DOM element for later artifact/terminal handoff. It accepts HTTP loopback URLs and URLs whose origin matches a currently-ready DamHopper tunnel, including paths, query strings, and hashes; credentials, the workspace origin, and unready or stale tunnel origins are rejected.

The iframe is hosted by a singleton `BrowserDebugKeepAliveHost` outside the conditional IDE/Terminal/compact shells. The host keeps its DOM node stable and positions it over the active viewport, avoiding Chromium reloads caused by physical iframe reparenting. Switching surfaces, maximizing panels, or changing compact tabs therefore does not unload the target document. A load handshake uses a fresh nonce and request IDs; incoming `postMessage` events must match the active `iframe.contentWindow`, exact target origin, nonce, request ID, protocol version, and schema before they are accepted. Redirected or opaque-origin frames fail closed. A timeout keeps the target visible and presents the extension setup flow.

The panel renders bridge status, a live address bar, Back/Forward/Reload controls, a bounded local console, picker controls, and bounded selection metadata. Successfully loaded browser targets are retained as 12 local-only recent-address suggestions in the address input; saved entries contain only origin and path (never credentials, query strings, or hashes), are deduplicated, and are revalidated before each load. The bridge reports full same-origin paths after document loads, History API changes, browser back/forward, and hash changes, so the address bar tracks the actual iframe location. Navigation and console forwarding require an extension built for the exact DamHopper parent origin; they are unavailable to generic loopback parents. Console data is bounded, redacted for common credentials, rendered as text, retained only in the browser session, and never included in terminal artifacts. It does not execute page commands or expose raw HTML, cookies, storage, credentials, or other browser secrets. In wide Terminal and IDE mode, the Browser is a resizable sibling of the focused terminal; that ready terminal is selected automatically for artifact preparation, and a prepared artifact remains bound to it through review/insertion. The compact Browser surface retains its explicit live-terminal chooser. When a selection exists, capture controls can request a browser-tab capture from an explicit user gesture, crop the selected region locally, or accept a PNG/JPEG file or pasted image. Manual JPEG input is converted to PNG locally because the authenticated artifact endpoint accepts PNG only. Capture is optional: denial, unsupported APIs, wrong-surface selection, or crop failure leave semantic selection available. Images remain local until the explicit artifact attach action; closing the Browser surface stops every capture track but intentionally does not unload the iframe.

The former desktop Tauri child WebView host was permanently retired in Phase 02 (P0a). `BrowserDebugKeepAliveHost` collapsed to its standard web iframe path across all platforms.

The web host exposes Responsive and Custom viewport controls. Custom width and height are whole CSS-pixel values bounded to 160–4096. The top-bar `+` probe and the symmetric stepper buttons change both dimensions by 16px, with state persisted in browser-local storage under a platform-scoped key. Keyboard shortcuts are intentionally not part of this feature. A custom stage may overflow and scroll with stage-aware remeasurement.

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

### Native SSH forwarding host (Retired in Phase 02)

> **Retirement Notice (Phase 02 / P0a):**
> The native Windows desktop SSH forwarding host (`apps/native/src/native-ssh-forward-host.ts`), UI contexts (`SshForwardHostContext.tsx`), hooks (`use-ssh-forward.ts`), and contract libraries (`ssh-forward-host.ts`) were deleted in Phase 02 (P0a). Route navigation to `/ssh-forwarding` displays retired-feature guidance in the web application. Remote Git-over-SSH authentication remains supported through server APIs and UI retry helpers.

### Multi Terminal Display

**Location:** `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx`

**Purpose:** Renders the active terminal panes inside the terminal workspace.

**Behavior:**

- Reuses existing mounted session state from the terminal manager.
- Does not create a second PTY lifecycle for terminal-mode rendering.
- Refits visible panes when the workspace shell layout changes.
- Threads the global `activeSessionId` through `SplitLayout` into each `PaneContainer`.

### Terminal Input Policy & Accessory Controls (Phase 08 Cutover)

> **Retirement Notice (Phase 08):**
> Web-mobile virtual keyboard modules (`MobileTerminalAccessoryBar.tsx`, `MobileTerminalCustomKeyboard.tsx`, `TerminalFloatingControlShell.tsx`, `android-chrome-input-policy.ts`, and coarse-pointer layout hooks) were permanently deleted in Phase 08.
> Terminal stdin suppression is now enforced generically via `syncTerminalInputSuppression` (`packages/ui/src/lib/terminal-input-policy.ts`), synchronizing xterm's hidden textarea (`inputMode = "none"`, `tabIndex = -1`, `blur()`) and `disableStdin = true` across Cognito Privacy Mode, disconnected server profiles, and modal focus traps. `TerminalScrollButtons` and `TerminalAccessoryControls` provide non-intrusive navigation without virtual keyboard overlays.
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

**Purpose:** Renders a single terminal session using xterm.js and handles output, exit, restart, reconnect, and buffer attachment. Semantic agent status and notification ownership are handled by the app-root agent-status bridge, not by terminal output parsing.

**Behavior:** Filters out the terminal workspace shortcut so xterm input does not swallow the global mode toggle. Attach/reconnect uses a session-local replay gate: live chunks queue until xterm completes retained-buffer rendering, with authoritative byte offsets preventing replay/live overlap. Historical parsing cannot send terminal replies into the live PTY. Full replacement replay drains preceding parser writes and resets xterm buffers, cursor, and modes; delta replay preserves them. Stream gaps or broadcast lag trigger reattachment. Truncated history cannot reconstruct missing terminal state.

Offsets are scoped to the PTY incarnation, so manual replacement under the same session ID starts a fresh replay rather than discarding the new process's output as duplicates. Parser completion remains fenced across connection rebinding and restart. Native input is temporarily disabled during attach/replay and restored with the current mobile-input policy once replay drains; legitimate live terminal queries still receive responses.

Terminal fitting skips hidden, disconnected, parked, and zero-size surfaces, preserving their last usable PTY dimensions. Renderer selection is committed before fitting a visible host, avoiding transient DOM-to-WebGL column changes on reveal. Hidden terminals release WebGL resources.

`TerminalPanel` does not attach Codex OSC 9 notification callbacks or derive semantic agent state from terminal bytes. Attach recovery retries an alive session with capped exponential backoff; session creation belongs to the terminal manager's explicit launch action. Cleanup disposes owned resources on unmount/reconnect/session replacement.

### Terminal touch scrolling and page-gesture containment

`TerminalPanel` binds `bindTerminalTouchScroll` from
`packages/ui/src/lib/terminal-touch-scroll.ts` after xterm v6 opens. xterm's
scrollback is a custom buffer surface, so the helper translates vertical
swipes into `terminal.scrollLines()` calls rather than relying on a native
scroll container. It listens only when `(any-pointer: coarse)` matches, and
uses capturing, passive `touchstart`, `touchmove`, `touchend`, and
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

#### Inline terminal suggestions

`useTerminalSuggestions` owns one `TerminalSuggestionController` per mounted terminal and
exposes its immutable snapshot to React. The controller observes only typed,
server-validated `terminal:lifecycle` events; a `submitted` event with an exact command is the
only automatic local-history write path. `TerminalPanel` notifies the controller for each
streamed output write, on attach/replay and process restart, and on composition/paste, so all
of those boundaries invalidate an in-flight search before it can surface a stale result.
Already-opaque output state does not republish a new suggestion snapshot for every
TUI chunk; genuine lifecycle, input, and replay transitions still invalidate
pending suggestion work.

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

Semantic agent attention notifications carry their owning profile and terminal
incarnation; in-app selection routes to that exact live session and ignores
stale or closed targets. OMP supports turn-ended and needs-attention alerts.
Claude supports only qualified needs-attention alerts; Codex provides status
only and has no notification delivery. DamHopper does not use Codex OSC 9
notifications or write Codex TUI notification settings.

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

**Data flow:** `usePorts()` scopes port/tunnel snapshots, incarnation fences, events, and captured actions to profile/generation. Detected rows retain `sessionId` for confirmed terminal Kill; tunnel-only rows remain origin untracked with URL/Stop but no invented terminal action. Origin or PTY loss never stops an explicit tunnel.

**OS Desktop:** In DamHopper OS, `PortsTunnelsApp` (`packages/ui/src/os/apps/PortsTunnelsApp.tsx`) embeds `PortsPanel` as an independent windowed application inside `OsShell`.

### TunnelReminderBanner

**Location:** `packages/ui/src/components/organisms/TunnelReminderBanner.tsx`; mounted globally in the shared web/native app inside the Cognito inert boundary.

**Behavior:** The server's three-hour `reminderDue` snapshot and `tunnel:reminder` event drive profile/port/URL reminders, not a browser timer. Dismiss persists per profile/tunnel in browser sessionStorage without stopping the connector. Stop captures the rendered connection generation, reports failure with Retry, and cannot rebind after reconnect. Cognito hides reminders; stacked reminders scroll within a bounded area and route shells consume the remaining viewport.


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

- In DamHopper OS, `OsResourceHost` owns `TerminalKeepAliveHost`, preserving live xterm DOM instances with zero-placement attach/replay/reset (F2 invariant) across docking, tiling, floating, and desktop switches.

## Git Workspace Panel

**Location:** `packages/ui/src/components/pages/GitPage.tsx`

**Purpose:** Primary Git workspace view for branch management, history browsing, and local change review.


> **Git Conflict Resolution:** For interactive 3-way merge conflict resolution, see the floating [ConflictResolverPanel](./workbench.md#floating-git-conflict-resolver-panel), which mounts inside `ConflictResolverApp` or as an OS floating frame governed by OS frame authority (`OS_RESOLVER_PANEL_TOPMOST_Z_INDEX = 30`).
### WorkspaceGitPanel

**Location:** `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`

**Purpose:** Composes the Git page into branch controls, commit history, and working tree sections.

### GitBranchControl

**Location:** `packages/ui/src/components/organisms/GitBranchControl.tsx`

**Purpose:** Handles branch checkout, creation, and deletion flows.

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
- The default `mode="checkout"` retains branch-name checkout behavior. History views use `mode="view"` with `selectedBranchRef` and `onSelectedBranchRefChange`; canonical local/remote refs remain distinct and selection does not check out a branch.

**Dialogs:** `GitBranchControlDialogs.tsx` contains the supporting create, delete, and dirty-checkout dialogs.

### GitLogTree

**Location:** `packages/ui/src/components/organisms/GitLogTree.tsx`

**Purpose:** Renders the commit history tree and anchors history actions.
**Presentation:** `presentation="graph"` (default) draws parent lanes; `presentation="list"` skips ancestry layout while preserving the same refs, messages, author/date/hash rows, keyboard selection, and context-menu actions. `emptyMessage` supplies surface-specific empty-state text.

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
- Provides independent squash checkboxes in graph and filtered-list history. Select at least two parent-contiguous commits on an active or inactive local branch, then edit the complete oldest-first combined message in `GitSquashDialog`.
- Squash supports pushed, older, and root-inclusive linear ranges without changing the final tree, index, dirty files, or remote. Selected merges and rewritten-descendant merges are blocked; invalidated signatures require explicit consent.
- After a proven local squash, `GitSquashFlow` offers separately prepared and confirmed leased publication bound to the same history owner/root and receipt branch tip (`receipt.branch`). Git-page bulk-root selection cannot redirect it; closing or changing scope cancels pending SSH retries.
- Consumes blame-annotation commit reveal requests (`GitCommitRevealRequest`) by exact OID after verifying root readiness. Renders `CommitDetailsPanel` in read-only inspect mode with full commit message and diff opening independent of history log pagination; does not close if already active.

### Project Info Panel

**Locations:** `packages/ui/src/components/organisms/ProjectInfoGitSection.tsx`, `packages/ui/src/components/organisms/ProjectInfoPanel.tsx`

**Purpose:** Provides the project-level Git action strip used in the workspace sidebar.

**Behavior:**

- Fetches VCS roots with `useGitRoots(projectName)` and shows a root selector when the project exposes more than one root.
- Falls back to the project root when discovery has not returned any roots yet, so fetch/pull/push still have a stable scope.
- Normal `Push` uses the selected root's fast-forward-only path; it does not take a force flag.
- The separate `Force Push` action opens a live preview and confirmation. It publishes only the configured destination if the expected remote OID still matches the approved snapshot; missing or ambiguous mappings are blocked rather than guessed.
- The leased-publish dialog is shared with Workspace Git and the Git page. Canceling leaves a local commit-message rewrite intact; editing a message never publishes automatically.
- The approved lease is bound to the selected profile/project/worktree/root, branch, source OID, remote, and destination ref. A stale local, remote, or config snapshot requires a fresh preview and confirmation.
- Fetch, pull, and normal Push use shared SSH retry. Leased publication retries only a known pre-write authentication failure with the same approved snapshot; unknown, rejected, and stale outcomes are not blindly replayed.
- Fetch/pull/push use the shared backend libgit2 credential callbacks and SSH passphrase prompt; mutation results invalidate only the selected target's caches.
- Non-auth normal-push failures and leased-publish outcomes remain visible in their respective UI status/dialog flows.
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

**OS Applications:** In DamHopper OS, `FilesApp` and `ChangesApp` operate as distinct windowed applications with independent state. `FilesApp` renders `FileTree` with Git status badges; `ChangesApp` manages `ChangedFilesList` and `DiffViewer` for local stage/unstage, discard, and diff review.

### Editor viewState persistence

**Locations:** `packages/ui/src/components/organisms/MonacoHost.tsx`, `packages/ui/src/components/organisms/EditorTabs.tsx`, `packages/ui/src/stores/editor.ts`

**Purpose:** Preserves Monaco editor view states (cursor position, column, scroll offsets, and code folds) across tab switching, component unmounting (such as sidebar/panel toggling), and page reloads.

- **Storage & Hydration:** View state is part of persisted editor tab state under `dam-hopper:editor-state` in `localStorage`. Hydrated tabs retain view state across `loadContent` invocations so opening the file restores line and column positions.
- **Race-Safe State Capture:** `MonacoHost` captures the originating tab's view state prior to switching active `tabKey` using `prevTabKeyRef` and on unmount, passing `targetKey` explicitly to prevent view states from polluting newly selected tabs.


### Git Blame Annotations in Editor

**Locations:** `packages/ui/src/components/organisms/EditorGitBlameGutter.tsx`, `EditorGitBlameContextMenu.tsx`, `packages/ui/src/components/molecules/EditorGitBlameRow.tsx`, `packages/ui/src/hooks/use-editor-git-blame.ts`, `packages/ui/src/stores/editor.ts`

**Purpose:** Renders per-line native Git blame attribution in the Monaco editor line-number gutter without modifying repository refs, working-tree files, or local storage.

- **Toggle & Gutter Mounting:** Right-clicking line numbers in Monaco or selecting "Toggle Git Blame Annotations" mounts `EditorGitBlameGutter`. Session toggle (`tab.blameEnabled`) is ephemeral and deliberately excluded from persistence and hydration.
- **Normal vs. Compact Layout:** Container widths ≥640px display full author and formatted date (220px). Narrow viewports (<640px) automatically adapt to compact author-only mode (`min(120px, wrapperWidth / 3)`). Hovering or focusing a row surfaces full metadata tooltips (commit hash, author, email, authored date, subject).
- **Buffer Edits & Dynamic Invalidation:** Keystrokes immediately wipe stale attribution, debounce 250ms, and query in-memory buffer blame. Unsaved buffer additions display as "Uncommitted" while retaining unchanged neighboring line attributions.
- **Workspace Git Commit Reveal:** Right-clicking an attributed row or line number exposes "Show Commit in Git". Clicking reveals the exact commit in the Workspace Git panel in read-only inspection mode (`mode: "inspect"`), displaying the full multiline commit body, author metadata, and changed files without mutation controls.
- **Host Lifecycle & Tier Gating:** Blame operations pause and cancel during inactive tabs, minimized panels, or Markdown/HTML Preview modes, resuming when returning to active Edit or Split modes. Binary, diff, image, video, and large files (≥5 MiB) are excluded from blame.
### Files, editor, and search ownership

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

See [Workbench Files, Editor, Search, and Git Architecture](../architecture/workbench-files-editor-and-git.md)
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
