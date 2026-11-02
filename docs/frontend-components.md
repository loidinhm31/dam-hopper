# Frontend Components

DamHopper delivers a shared React 19 UI package (`packages/ui`) hosted by the Vite web application (`apps/web`). (The former desktop Tauri host `apps/native` was retired in Phase 02). The host entry point is thin; `packages/ui` owns the shell, profile-scoped connections, components, state, and API clients (canonical export `packages/ui/src/embed/dam-hopper-app.tsx`).

Design guidelines, color tokens, and typography are defined in [Platform Integrations](./frontend-components/platform-integrations.md#shared-design-system-and-embedding-contract) and `packages/ui/src/index.css`.

## Contents

- [Workbench and profile components](./frontend-components/workbench.md) — Shell modes, application routing and hidden `/os` route boundary, profile connection lifecycle, Git history, and Settings.
- [Terminal and IDE components](./frontend-components/terminal-and-ide.md) — Terminal workspace, PaneContainer splitting, PortsPanel tunnels, and Explorer/editor UI.
- [Platform integrations](./frontend-components/platform-integrations.md) — Shared design system, Browser Debug bridge, and native host contracts.
- [Host resources](./frontend-components/host-and-usage.md) — Host-resource fleet deck, idle-suspend status, and terminal integration.
- [File and media components](./frontend-components/files-and-media.md) — Explorer decorations, image/video previews, and sandboxed HTML preview.
- [Privacy and agent notifications](./frontend-components/notifications-and-privacy.md) — Cognito Privacy Mode, agent status notifications, and terminal title ordinals.
- [Workflow Context Surface](./workflow-context-surface.md) — Responsive workflow context UI, component ownership, and interaction contracts.
- [Session Changes Review Components](#session-changes-review-components) — Read-only Monaco review modal, keyboard isolation, and changed files list.
- [AI Dev OS Lifecycle Components](#ai-dev-os-lifecycle-components) — Multi-window OS shell, desktop canvas, window frame, resource keep-alive host, and generic tile renderer.

## Legacy Section Links

These headings preserve links from earlier documentation versions.

### Profile-owned enrollment and MFA UI

See [Workbench and profile components](./frontend-components/workbench.md#profile-owned-enrollment-and-mfa-ui).

### Host-resource fleet deck and cards

See [Host resources](./frontend-components/host-and-usage.md#host-resource-fleet-deck-and-cards).

### PortsPanel

See [Terminal and IDE components](./frontend-components/terminal-and-ide.md#portspanel).

### PaneContainer

See [Terminal and IDE components](./frontend-components/terminal-and-ide.md#panecontainer).

## Session Changes Review Components

- **`SessionChangesHost` (`packages/ui/src/components/organisms/SessionChangesHost.tsx`):** Top-level modal host dialog mounted once in `WorkspacePage.tsx` above responsive shells, mounting `SessionChangesPanel` keyed by the full terminal tuple (`profileId:generation:terminalId:terminalIncarnation:ompSessionId:rootId`). Fails closed if the owning server is disabled or disconnected, canceling and purging owner query cache. Enforces modal event containment (`stopPropagation()` on `DialogPrimitive.Content` `onKeyDown`) and suppresses window keyboard shortcut dispatch in `WorkspacePage` to prevent keystrokes and shortcuts from leaking into underlying live xterm PTYs while preserving internal list and Monaco navigation (full mounted xterm keyboard isolation remains governed by live journey qualification).
- **`SessionChangesPanel` (`packages/ui/src/components/organisms/SessionChangesPanel.tsx`):** Orchestrates session metadata status queries, lazy comparison bootstrapping without requiring a prior revision on initial `GET /files` fetch, manual refresh actions, split vs. inline unified diff layout toggle, bounded cursor pagination (up to 500 paths display bound, UI page size 200), and stale revision recovery (`refreshRequired`, `serverRestarted`). Legacy `fromNow` adoption removed.
- **`ReadonlyMonacoDiffViewer` (`packages/ui/src/components/organisms/ReadonlyMonacoDiffViewer.tsx`):** Capability-free Monaco diff editor rendering first-touch original bytes versus current working tree bytes with side-by-side or inline unified toggle. Disables edit commands, drop, and paste; isolates model URIs by full owner tuple; and uses deferred model disposal to eliminate cleanup race conditions.
- **`SessionChangedFilesList` (`packages/ui/src/components/organisms/SessionChangedFilesList.tsx`):** Keyset-paginated list displaying changed files with change kinds (`added`, `deleted`, `modified`, `modeOnly`, `unknown`), line addition/deletion counts, verified historical absence proofs (`absentAtFirstTouch`), and bounded "Load more" pagination.
- **Launch Entry Points:**
  - **Desktop TabBar (`packages/ui/src/components/organisms/TabBar.tsx`):** Action button in active terminal tab bar, gated by `useSessionChangesEnabled(terminalOwner)`.
  - **Mobile Accessory Bar (`packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx` / `TerminalAccessoryControls.tsx`):** 44px touch-accessible action button, gated by `useSessionChangesEnabled(terminalOwner)`.
  - **Runtime Header (`packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx`):** Header action button in Runtime terminal presentation, gated by `useSessionChangesEnabled(terminalOwner)`.

## AI Dev OS Lifecycle Components

Phase 01 of the AI Dev OS redesign introduces modular windowing and resource management components (`packages/ui/src/os/`) to provide multi-window, multi-desktop operations while preserving live resource instances across layout adjustments:

- **`OsShell` (`packages/ui/src/os/OsShell.tsx`):** Root shell container mounted via the lazy, unadvertised `/os` route in `packages/ui/src/embed/dam-hopper-app.tsx` (gated by `AuthenticatedOsRoute` and protected by `GlobalShortcuts` terminal shortcut isolation; see [Workbench and profile components](./frontend-components/workbench.md#application-routing-and-hidden-authenticated-os-route)). Renders the top header bar, application launchers (+ Terminals, + Editor, + Browser), desktop switcher tabs, debounced session persistence to `dam-hopper:os:v1:session`, and operator `PersistenceNotice` alerts. Wraps desktop rendering in `OsResourceHost`.
- **`DesktopCanvas` (`packages/ui/src/os/DesktopCanvas.tsx`):** Container for the active desktop. Renders tiled window trees via `GenericTileRenderer` and floating windows via `WindowFrame`. Automatically tracks viewport dimensions via `ResizeObserver` and reclamps floating window coordinates on resize.
- **`WindowFrame` (`packages/ui/src/os/WindowFrame.tsx`):** Frame chrome providing drag handles for floating windows, maximize/minimize/restore controls, tile/float mode toggling, desktop migration dropdowns, and keyboard capture (`data-os-window-slot`).
- **`OsResourceHost` (`packages/ui/src/os/OsResourceHost.tsx`):** Top-level keep-alive boundary mounted above desktop and window render trees. Hosts `TerminalKeepAliveHost` (xterm DOM reparenting), `MonacoKeepAliveHost` (off-screen parking, registry, and slot attachment), and `OsBrowserKeepAliveHost` (persistent iframe overlays), designed to keep xterm instances, Monaco editor DOM nodes, and browser iframe previews mounted across window docking, floating, and desktop switches (full lifecycle preservation and zero attach/replay/reset remain an open qualification gate pending Task 4; warning W2 tracks React DOM ownership safety across disposable window slots).
- **`MonacoKeepAliveHost` (`packages/ui/src/os/MonacoKeepAliveHost.tsx`):** Off-screen parking container (`getMonacoParkingHost()`, `data-monaco-parking-host="true"` at `top: -10000px`, `left: -10000px`, 1024x768) and DOM registry (`parkedMonacoRegistry`) supporting imperative attachment (`attachMonacoToSlot`) and parking (`parkMonacoElement`) of Monaco editor elements across window movements.
- **`GenericTileRenderer` (`packages/ui/src/components/organisms/SplitLayout.tsx`):** Generic recursive binary split renderer parameterized over arbitrary pane item type `T`. Coordinates `react-resizable-panels` with debounced resize propagation.
- **Application Adapters (`packages/ui/src/os/apps/`):**
  - `TerminalsApp`: Terminal slot attachment via `attachTerminalsToHost`, visible slot claim via `useResourceClaim` (reactively refreshed via `[key, formattedKey, windowId]` and `[key, windowId]` dependencies), disconnected profile banner, and denied-claim fallback overlay.
  - `EditorApp`: Owner-qualified tab key derivation (`editorFileTabKey`), Monaco slot attachment via `attachMonacoToSlot`, and claim conflict resolution.
  - `BrowserApp`: Coordinates iframe slot geometry and visibility with `OsResourceHost` via slot registration (`registerBrowserSlot`, `updateBrowserSlot`).
  - `FilesApp`: Embeds `FileTree`, connecting file clicks to `file:edit` intents and directory context to `useFileWatch` subscriptions.
  - `SearchApp`: Embeds `SearchPanel` with `isolatedState: true` and delivery keying, decoupling search queries per mode (files vs content) without mutating global search stores, and routing match selections with generation metadata to `file:open` or `file:edit` intents.
  - `ChangesApp`: Embeds `ChangedFilesList`, `GitLocalChanges`, and `DiffViewer`. Canonical path resolution matches canonical project paths first via `createChangedFileSelection`. Consumes delivered `changes:diff` intents once per delivery ID to prevent repeating tab activation on unrelated query refreshes.
  - `GitApp`: Embeds `WorkspaceGitPanel` with commit history search, branch operations, and commit inspection.
  - `ConflictResolverApp`: Embeds `ConflictResolverPanel` and `MergeConflictEditor`. Verifies active conflict operations against `requestedOperation` (`requestedOperation !== undefined && (!liveOp || liveOp === "none" || liveOp !== requestedOperation)`), uniformly displaying fail-closed notices and blocking abort/continue actions when the requested operation is inactive or mismatched.
  - `SessionChangesApp`: Embeds `SessionChangesPanel`, enforcing an exact 6-part owner tuple (`profileId`, `generation`, `terminalId`, `terminalIncarnation`, `ompSessionId`, `rootId`), stable generation capture via `useState` on mount, resource claim acquisition, and mounted-window teardown and query cache purge on disable or disconnect (offscreen/hidden review retirement remains open).
  - `WorkflowPlansApp`: Embeds `WorkflowContextSurface`, routing plan selections and task tracking.
  - `PortsTunnelsApp`: Embeds `PortsPanel`, providing discovered port status, cloudflared tunnel lifecycle controls, and browser launch intents.
  - `ProjectInfoApp`: Embeds `ProjectOverview` and `ConfigEditor`, binding edits to the current project owner.
  - `AgentStoreApp`: Embeds `AgentStorePage` with controlled props (`AgentStorePageProps`), managing tab and profile selections in window `appState` without mutating global route query parameters.
  - `SettingsApp`: Embeds `SettingsPage` with controlled props (`SettingsPageProps`), managing target profile selection in window `appState` without mutating global `useWorkbenchSelectionsStore.settingsProfileId`.

## Decoupled Management Page Components

- **`AgentStorePage` (`packages/ui/src/components/pages/AgentStorePage.tsx`):** Supports `AgentStorePageProps` (`noLayout`, `profileId`, `tab`, `onTabChange`, `onProfileChange`). When embedded in OS windows, operates in controlled mode without writing to `useSearchParams`.
- **`SettingsPage` (`packages/ui/src/components/pages/SettingsPage.tsx`):** Supports `SettingsPageProps` (`noLayout`, `targetProfileId`, `onTargetProfileChange`). When in controlled/noLayout mode, maintains local target selection and enforces capture-and-recheck async ownership via `getCurrentEffectiveProfileId()` before applying post-await mutations to avoid mutating global store state or experiencing stale profile references.
- **`DevicesPage` (`packages/ui/src/components/pages/DevicesPage.tsx`):** Supports `DevicesPageProps` (`noLayout`, `profileId`, `onProfileChange`). Displays server selector whenever `profiles.length > 0` with explicit `(Current / Default Server)` fallback option.
