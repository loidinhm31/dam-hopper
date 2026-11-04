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
- [AI Dev OS Lifecycle Components](#ai-dev-os-lifecycle-components) — Multi-window OS shell, desktop canvas, window frame, resource keep-alive host, generic tile renderer, and 17-application adapter catalog.
- [Recipe Management & Review Components](#recipe-management--review-components-packagesuisrcosrecipes) — Declarative recipe editor, save-subset preflight, and launch review dialogs.
- [OS Session Management & Interaction Components](#os-session-management--interaction-components) — Guarded terminal close dialog, shell input arbitration context, Agent Hub inventory filters, and Recipe source/target capture.

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
- **`MonitorTray` (`packages/ui/src/os/MonitorTray.tsx`):** TopBar tray component rendering mini CPU and memory utilization meters and unread alert indicator dot with status mapping (`Live`, `Stale`, `Connecting`, `Offline`). Reuses `useMultiHostResources`, `useHostMetrics`, and `useIdleSuspendStatus` backed by canonical `HostResourceStreamCoordinator` (runtime verification of zero duplicate leases, background unmount lifecycle, and canonical freshness mapping remains tracked under W1); dispatches typed intents `monitor:alert` and `system:monitor` on interaction.
- **Application Adapters (`packages/ui/src/os/apps/`):**
  - `TerminalsApp`: Terminal slot attachment via `attachTerminalsToHost`, visible slot claim via `useResourceClaim` (reactively refreshed via `[key, formattedKey, windowId]` and `[key, windowId]` dependencies), disconnected profile banner, and denied-claim fallback overlay.
  - `EditorApp`: Owner-qualified tab key derivation (`editorFileTabKey`), Monaco slot attachment via `attachMonacoToSlot`, and claim conflict resolution.
  - `BrowserApp`: Coordinates iframe slot geometry and visibility with `OsResourceHost` via slot registration (`registerBrowserSlot`, `updateBrowserSlot`).
  - `FilesApp`: Embeds `FileTree`, connecting file clicks to `file:edit` intents and directory context to `useFileWatch` subscriptions.
  - `SearchApp`: Embeds `SearchPanel` with `isolatedState: true` and delivery keying, decoupling search queries per mode (files vs content) without mutating global search stores, and routing match selections with generation metadata to `file:open` or `file:edit` intents.
  - `ChangesApp`: Embeds `ChangedFilesList`, `GitLocalChanges`, and `DiffViewer`. Canonical path resolution matches canonical project paths first via `createChangedFileSelection`. Consumes delivered `changes:diff` intents once per delivery ID to prevent repeating tab activation on unrelated query refreshes.
  - `GitApp`: Embeds `WorkspaceGitPanel` with commit history search, branch operations, and commit inspection.
  - `ConflictResolverApp`: Embeds `ConflictResolverPanel` and `MergeConflictEditor`. Verifies active conflict operations against `requestedOperation` (`requestedOperation !== undefined && (!liveOp || liveOp === "none" || liveOp !== requestedOperation)`), uniformly displaying fail-closed notices and blocking abort/continue actions when the requested operation is inactive or mismatched.
  - `SessionChangesApp`: Embeds `SessionChangesPanel`. (Superseded by the immutable 8-tuple and `ReviewRetirementGuard` below: requires complete 8-tuple `(profileId, generation, terminalId, terminalIncarnation, ompSessionId, serverEpoch, rootId, baselineId)`, stably captures generation via `useState` on mount, acquires `session-changes` resource claim, and closes the mounted window while purging query cache if Session Changes becomes disabled or disconnected).
  - `WorkflowPlansApp`: Embeds `WorkflowContextSurface`, routing plan selections and task tracking.
  - `PortsTunnelsApp`: Embeds `PortsPanel`, providing discovered port status, cloudflared tunnel lifecycle controls, and browser launch intents.
  - `ProjectInfoApp`: Embeds `ProjectOverview` and `ConfigEditor`, binding edits to the current project owner.
  - `AgentStoreApp`: Embeds `AgentStorePage` with controlled props (`AgentStorePageProps`), managing tab and profile selections in window `appState` without mutating global route query parameters.
  - `SettingsApp`: Embeds `SettingsPage` with controlled props (`SettingsPageProps`), managing target profile selection in window `appState` without mutating global `useWorkbenchSelectionsStore.settingsProfileId`.
  - `SystemMonitorApp`: Embeds fleet resource monitoring, project counts, and active terminal sessions into a single window. Reuses `HostResourceFleetDeck`, `HostResourceGlance`, `HostResourceDiagnosis`, `HostIdleSuspendStatus`, and `ForceSleepDialog`. Supports profile-filtered fleet inspection (`inspectedProfileId`), alert drilldown (`selectedIncidentId`), process termination with owner-qualified generation verification dialog (client checks reject observed mismatches; authoritative replacement safety remains open under C2), terminal focus jumps (`terminal:focus`), and Cognito privacy masking for hostnames (`protected-host`) and kill commands (loaded drilldown masking remains open under C3).
  - `AgentHubApp`: Embeds multi-profile AI agent home (`agent-hub`, `single-instance`, `none` context). Aggregates active terminals (`useAggregatedTerminalSessions`) and projects (`useAggregatedProjects`) across connected profiles via `buildTraditionalTerminalAgentRows` without eager file scanning or diff computations. Applies urgency ordering (`needs-attention` -> `working` -> `idle` -> `unavailable`), urgency/profile/harness/search filtering, and terminal focus jumps. Jump locates existing windows across desktops by terminal session ID; full action-time incarnation verification on jump remains an open carryover (W3).
  - `RecipesApp`: Embeds declarative launch recipe manager (`recipes`, `single-instance`, `none` context, float placement). Provides catalog browsing, recipe deletion, portable JSON export/import with schema validation, and embeds `RecipeEditor` and `LaunchReview`.

### Recipe Management & Review Components (`packages/ui/src/os/recipes/`)

- **`RecipeEditor` (`packages/ui/src/os/recipes/RecipeEditor.tsx`):** Authoring interface for saving active desktop state to portable `RecipeV1` models or manually editing recipe steps. In save-subset mode, prompts for target server profile and project; displays pre-confirmation preview of matching windows vs. excluded windows (with explicit names, contexts, and exclusion reasons) via `calculateSaveSubset`; prunes excluded branches for canonical binary trees; and requires UI-level authoring/confirmation of command steps (noting W7 that confirmation is a UI guard, not an invariant bound to saved values across subsequent edits) and app steps.
- **`LaunchReview` (`packages/ui/src/os/recipes/LaunchReview.tsx`):** Preflight inspection and execution review dialog. Displays step preflight checks, consent prompts for window reuse, resume of captured runs vs. independent New Run execution, step execution state progress (`pending` -> `dispatched` -> `confirmed` / `failed` / `outcomeUnknown`), and blocked unknown-outcome controls (dismiss step without relaunch, open terminal list). Note: cross-tab new-run locking and action-time epoch gating remain tracked carryovers (C1, C2).

### Shell Chrome & Navigation Integrations

- **`Dock` (`packages/ui/src/os/Dock.tsx`):** Launcher dock rendering pinned application launchers (`dam-hopper:os:v1:dock`) with running/minimized pip indicators (`.os-dock-pip`, `.os-dock-pip-active`). Manifest registry now registers 17 applications, adding launchers for `agent-hub` (🤖) and `recipes` (📜) with single-instance focus and restore semantics.
- **`CommandPalette` (`packages/ui/src/os/CommandPalette.tsx`):** Operational search palette supporting 5 modes (`>` commands, `@` agents, `#` windows, `/` files, `!` recipes). In recipes mode (`!`), lists local recipes, executing launch flows via `recipes:launch` intents or opening the recipe manager.
- **`DesktopTemplates` (`packages/ui/src/os/desktop-templates.ts`):** Supplies `createProjectDesktopTemplate` (60/40 binary split for projects) and `createAgentHubDesktopTemplate` (Desktop 1 "Hub" template hosting a maximized `agent-hub` singleton window).
## OS Session Management & Interaction Components

- **`TerminalCloseDialog` (`packages/ui/src/os/TerminalCloseDialog.tsx`):** Tri-choice confirmation dialog invoked by window frames, pane tab bars, and window lists when closing terminal sessions (`Close View` / `End Session` or `Cancel Restart` / `Cancel`). Evaluates target authority and availability: live sessions offer guarded OS process termination (HTTP 202); dead sessions with pending restart offer restart cancellation (HTTP 200); disconnected, unverified, or legacy headerless server sessions disable End with explanatory reason text while preserving presentation close. Registers modal mount in `ShellInputContext` to isolate xterm PTY keyboard input.
- **`ShellInputContext` (`packages/ui/src/os/shell-input-context.tsx`):** Coordinates shell input suppression and layer focus across `OsShell`. Manages monotonic token-based modal depth registration (`registerModalMount`), nonmodal popover state (`target-selector`, `window-list`, `notification-center`), command palette open state, and Cognito privacy mode. Derives `isTerminalSuppressed` to synchronize physical terminal stdin disabling across nested layers.
- **`AgentHubApp` (`packages/ui/src/os/apps/AgentHubApp.tsx`):** Fleet-wide agent monitor and launcher with inventory-first scope filters: All sessions (`all`), Agents (`agents`), and Background (`background`, matching active sessions that have no open qualified window across any desktop, including minimized and offscreen windows). Provides urgency ranking (`needs-attention` -> `working` -> `idle` -> `unavailable`), harness filtering (`OMP`, `Codex`, `Claude`), search, and placement intents (`focus-existing`, `open-beside`, `move-beside`).
- **`RecipeEditor` (`packages/ui/src/os/recipes/RecipeEditor.tsx` & `recipe-source-context.ts`):** Authoring UI for saving active desktop state to portable `RecipeV1` models. Stabilizes explicit source desktop selection on mount without resets during outer shell navigation. Projects desktop windows into counted canonical `(profileId, projectId)` candidate pairs, grouping same-project worktrees and excluding contextless fleet utilities (`system-monitor`, `settings`, `agent-hub`, `recipes`). Provides pre-confirmation preview of matching vs excluded windows with explicit exclusion reasons, and enforces value-bound command authoring where manual edits invalidate prior confirmation.
- **`ReviewRetirementGuard` (`packages/ui/src/os/review-retirement.tsx`):** Desktop-wide guard mounted per protected Review window (including minimized and offscreen windows). Binds to immutable 8-tuple `(profileId, generation, terminalId, terminalIncarnation, ompSessionId, serverEpoch, rootId, baselineId)`. On session tracking disable or disconnect, it cancels in-flight TanStack queries, purges cache, and strips target tuples from window runtime/app state while retaining content-free explanation UI.
- **`TerminalSessionActionCoordinator` (`packages/ui/src/lib/terminal-session-action-coordinator.ts`):** Presentation-independent external store (`useTerminalActionState`, `useAllTerminalActions`, `terminalActionCoordinator`) coordinating destructive terminal operations across `PortsPanel`, `SystemMonitorApp`, and `TerminalCloseDialog`. Centralizes in-flight reservations and retained action states across component unmount, minimize, tab switching, and dialog dismissal, preventing lost reconciliation ownership. Enforces single-flight reservation per target (`reserveDispatch`) and authoritative settlement preservation (retained terminal states `"ended"` and `"restartCancelled"` are never overwritten).
- **Token Domain Separation:** Establishes explicit architectural boundaries between network dispatch fencing and UI modal presentation lifecycles:
  - *Network / Action Domain (`attemptToken`):* Strictly monotonic integer incremented on each reservation in `TerminalSessionActionCoordinator`. Used to fence stale, out-of-order, or superseded network responses (`recordOutcome`).
  - *UI Presentation Domain (`presentationToken` / `promptToken`):* Component ref-based token (`promptTokenRef` in `PortsPanel` and `terminal-close-context.tsx`) tracking the active modal prompt lifecycle, preventing completed async terminations from leaking outcome notifications or error banners into new or reopened modal dialogs after dismissal.

## Decoupled Management Page Components

- **`AgentStorePage` (`packages/ui/src/components/pages/AgentStorePage.tsx`):** Supports `AgentStorePageProps` (`noLayout`, `profileId`, `tab`, `onTabChange`, `onProfileChange`). When embedded in OS windows, operates in controlled mode without writing to `useSearchParams`.
- **`SettingsPage` (`packages/ui/src/components/pages/SettingsPage.tsx`):** Supports `SettingsPageProps` (`noLayout`, `targetProfileId`, `onTargetProfileChange`). When in controlled/noLayout mode, maintains local target selection and enforces capture-and-recheck async ownership via `getCurrentEffectiveProfileId()` before applying post-await mutations to avoid mutating global store state or experiencing stale profile references.
- **`DevicesPage` (`packages/ui/src/components/pages/DevicesPage.tsx`):** Supports `DevicesPageProps` (`noLayout`, `profileId`, `onProfileChange`). Displays server selector whenever `profiles.length > 0` with explicit `(Current / Default Server)` fallback option.
