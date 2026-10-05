
# Scout Report: Frontend Surface Architecture, Runtime Flow & Contracts

**Report Target**: `plans/reports/scout-261005-1653-frontendsurface.md`  
**Date**: 2026-10-05  
**Scope**: `packages/ui/src/components/`, `packages/ui/src/advisor/`, `packages/ui/src/embed/`, `packages/ui/src/index.css`, `apps/web/`, `apps/browser-extension/`, `patches/`, `packages/ui/vite.config.ts`, `packages/ui/vitest.browser.config.ts`, `packages/ui/playwright.config.ts`, `scripts/`  
**Inventory Source**: `plans/reports/context-261005-1653-docs-inventory.json`  

---

## 1. Directory and Symbol Map

### 1.1 `packages/ui/src/embed/`
- `dam-hopper-app.tsx`: Central application root and routing shell.
  - **Symbols**: `DamHopperApp`, `GlobalShortcuts` (`Ctrl+`` to `/workspace?action=new-terminal`), `GlobalTerminalFontSizeShortcuts`, `RouteDiagnostics`, `FreshResetBanner`, `LegacyDeepLinkNotice`, `LegacyRedirect` (`/terminals`, `/ide` -> `/workspace`).
  - **Providers & Context Exports**: `AppZoomProvider`, `useAppZoom`, `EncryptProvider`, `AndroidChromeInputPolicyProvider`, `SshForwardHostProvider`, `useSshForwardHost`, `BrowserDebugHostProvider`, `useBrowserDebugHost`.
  - **Guards & Overlays**: `useCognitoModeInputGuard`, `CognitoModeOverlay`, `useBrowserShortcutGuard`, `useBrowserContextMenuSuppression`, `AndroidChromeKeyboardNotice`, `PassphrasePrompt`, `TerminalNotificationToastViewport`, `AgentStatusBridge`.
  - **Routes**: `/` (`DashboardPage`), `/workspace` (`WorkspacePage`), `/git` (`GitPage`), `/settings` (`SettingsPage`), `/agent-store` (`AgentStorePage`), `/usage` (`UsagePage`), `/ssh-forwarding` (`SshForwardingPage`, conditional on `nativeDesktop`).

### 1.2 `packages/ui/src/advisor/`
- **Root & Provider**:
  - `AdvisorPanel.tsx`: Native Evcrate Advisor panel (`AdvisorPanel`, `AdvisorPanelProps`). Uses `useReducer(appReducer)`.
  - `advisor-data-provider.ts`: `AdvisorDataProvider`, `ProviderContextDescriptor`, `ProviderEvent`.
  - `native-advisor-provider.ts`: `NativeAdvisorProvider` (REST client calling `/api/advisor/*`, managing `AbortController` maps for request cancellation).
  - `policy-routing-validation.ts`: Pure validation logic (`validateRoute`, `validateRoutingPolicyDraft`, `ENABLED_BACKENDS` = `["omp", "codex", "claude", "pi"]`, `BACKEND_EFFORTS`, `CUSTOM_MODEL_SENTINEL`).
  - `advisor-types.ts`: DTOs (`AdvisorBackend`, `AdvisorRouteTarget`, `AdvisorPolicyV2`, `AdvisorModelsResultDto`, `EvaluationsListResultDto`).
- **Views (`packages/ui/src/advisor/views/`)**:
  - `OverviewView.tsx`: Health, routing glance, and summary metrics.
  - `HistoryView.tsx` & `HistoryDetail.tsx`: Query execution history and details.
  - `ConfigurationView.tsx`: Routing policy editor and model selector.
  - `EvaluationsView.tsx` & `EvaluationDetail.tsx`: Comparative evaluation runs and benchmarks.
- **Components (`packages/ui/src/advisor/components/`)**:
  - `PolicySummaryCard.tsx`, `RouteFieldset.tsx`, `CandidatePerformanceTable.tsx`, `ComparableGroupsSection.tsx`, `EvaluationGroupCard.tsx`, `ScoreProvenanceCard.tsx`, `EvaluationDescriptorCard.tsx`, `EvaluationDescriptorsSection.tsx`, `PanelTabs.tsx`, `EvaluationsHeader.tsx`, `RouteGroupCard.tsx`, `TextBlock.tsx`, `PaginationControls.tsx`, `MetricRatio.tsx`, `ActivityScopeControl.tsx`, `DiagnosticPanel.tsx`, `StatusBanner.tsx`, `DataControls.tsx`.

### 1.3 `packages/ui/src/components/`
- **Pages (`packages/ui/src/components/pages/`)**:
  - `WorkspacePage.tsx`: Core multi-paradigm workbench controller. Manages shell mode (`IdeShell` vs `TerminalWorkspaceShell` vs `MobileWorkspaceShell`), docked panel allocations, floating overlays, project targets, terminal managers, and browser debug keep-alive.
  - `DashboardPage.tsx`: Welcome landing page, project switcher, and system health status.
  - `GitPage.tsx`: Full-screen repository inspection, branch logs, and batch git actions.
  - `SettingsPage.tsx`: Multi-profile settings dashboard. Accompanying folder `settings-page/` contains `SettingsSectionAccordion.tsx` (default collapsed), `SettingsConfigPanels.tsx`, `SettingsImportExportPanel.tsx`, `SettingsMaintenancePanel.tsx`, `AdvisorSettingsSection.tsx`.
  - `AgentStorePage.tsx`: Agent templates, distribution matrix, install/uninstall flows.
  - `UsagePage.tsx`: Token metrics, session audit trees, and cost breakdown charts (`packages/ui/src/components/usage/`).
  - `SshForwardingPage.tsx`: SSH port forwarding and tunnel supervisor.
- **Templates (`packages/ui/src/components/templates/`)**:
  - `IdeShell.tsx`: Standard IDE workspace (resizable left/right sidebars, top nav, editor tabs, collapsible bottom panel).
  - `TerminalWorkspaceShell.tsx`: Full-screen terminal workspace with floating popover panels (`TerminalFloatingToolPanel`, `TerminalFloatingFilePanel`).
  - `MobileWorkspaceShell.tsx`: Adaptive compact layout for touch and small-screen viewports.
  - `AppLayout.tsx`: Standard page container wrapping settings, usage, and dashboard.
- **Organisms (`packages/ui/src/components/organisms/`)**:
  - `TerminalPanel.tsx`: xterm.js instance with WebGL renderer, stream replay gate, search addon, suggestions ghost, and attach recovery controller.
  - `PaneContainer.tsx` & `TerminalKeepAliveHost.tsx`: Multi-terminal pane splitting (`@dnd-kit`, `react-resizable-panels`) and offscreen terminal preservation (`-10000px`).
  - `GitSquashDialog.tsx` & `GitSquashFlow.tsx`: Commit squash configuration, preview, and commit message editor.
  - `GitForcePushDialog.tsx`: Leased push dialog with two-phase CAS verification.
  - `GitHistoryActions.tsx`: Dialogs for `GitEditCommitMessageDialog`, `GitDropCommitDialog`, `GitRevertCommitDialog`, `GitResetDialog` (Soft, Mixed, Hard, Keep), `GitUndoLastCommitDialog`.
  - `WorkspaceGitPanel.tsx` & `GitLogTree.tsx`: Docked Git commit tree and branch controls (`GitBranchControl`, `GitBranchContextMenu`).
  - `FileTree.tsx`: Virtualized tree explorer (`react-arborist`) with CRUD context menu.
  - `EditorTabs.tsx`, `MonacoHost.tsx`, `LargeFileViewer.tsx`: Multi-type editor host with chunked range reading for large files.
  - `VideoPreview.tsx` & `ImagePreview.tsx`: Native browser preview components using short-lived capability tickets and session cookies.
  - `HostResourcePopover.tsx`, `HostResourceFleetDeck.tsx`, `HostResourceFleetCard.tsx`, `HostResourceGlance.tsx`: Multi-profile system monitoring popover and fleet card grid.
  - `CognitoModeOverlay.tsx`: Full-screen privacy overlay masking content during capture phase.
  - `PortsPanel.tsx`: Local listening port detection and Cloudflared quick tunnel supervisor.
  - `ForceSleepDialog.tsx`: Dialog initiating terminal idle suspend force-sleep.
  - `BrowserDebugPanel.tsx` & `BrowserDebugKeepAliveHost.tsx`: Framed browser debugging interface.
- **Molecules & Atoms (`packages/ui/src/components/{molecules,atoms,ui}/`)**:
  - `GitHistoryToolbar.tsx`, `TopNavBrand.tsx`, `TopNavRouteLink.tsx`, `TopNavWorkspaceModeSwitch.tsx`, `TopNavConnectionButton.tsx`, `WorkflowContextRibbon.tsx`.
  - `TerminalFindBar.tsx`, `TerminalSuggestionGhost.tsx`, `ProfileBadge.tsx`, `AgentStatusBadge.tsx`, `GitStatusBadge.tsx`, `Button.tsx`.
  - `Dialog.tsx`, `AlertDialog.tsx`, `ConfirmDialog.tsx`, `ContextMenu.tsx`, `Input.tsx`, `Select.tsx`, `Textarea.tsx`.

### 1.4 `packages/ui/src/index.css`
- **Tailwind CSS v4 `@theme`**: JetBrains Mono IDE monospace aesthetic, slate dark theme (`--color-background: hsl(222, 47%, 5%)`, `--color-surface: hsl(217, 33%, 11%)`, `--color-primary: hsl(217, 91%, 60%)`), glassmorphism cards (`.glass-card`), scanline effects, glowing accents (`.glow-blue`, `.border-glow`), `.btn-bracket`, safe-area variables (`--safe-area-top`, etc.), `.dialog-viewport-fit`, `.compact-scroll-region`, and `.cognito-mode-overlay`.

### 1.5 `apps/web/`
- `src/main.tsx`: Web host entry point. Runs `configureLogger()`, `initializeClientDiagnostics()`, `performFreshStateReset()`, `initTransport(new IdleTransport())`, `migrateToProfiles()`, `reconcileManagedProfile()`, initializes `QueryClient`, and renders `DamHopperApp`.
- `vite.config.ts`: Vite 6 configuration with Tailwind v4 `@tailwindcss/vite`, `@` alias to `packages/ui/src`, release version injection, proxy (`/api`, `/ws` -> `http://127.0.0.1:4803`), and vendor chunk splitting (`monaco`, `terminal`, `markdown`, `tree`, `qr`).
- `scripts/stage-browser-debug-extension.mjs`: Stages zipped MV3 extension in `apps/web/public/browser-debug-extension/dam-hopper-browser-debug.zip` prior to web packaging or development execution.

### 1.6 `apps/browser-extension/`
- `public/manifest.json`: Chrome MV3 manifest with `content.js` configured for `all_frames: true`, `world: "MAIN"`, and `run_at: "document_start"`.
- `src/content.ts`: Injects `@dam-hopper/browser-bridge` postMessage communication into child iframes for DOM element inspection and marks browser extension presence via `markBrowserExtensionPresence()`.
- `vite.config.ts`: Bundles IIFE with parent origins injected from `VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS`.

### 1.7 `patches/`
- `@radix-ui__react-compose-refs@1.1.2.patch`: Patch stabilizing `useComposedRefs` callback via `useRef` to eliminate ref callback infinite churn under React 19.
- `patch.txt`: Empty 0-byte placeholder.

### 1.8 Test Runner Configs
- `packages/ui/vite.config.ts`: Headless Vitest unit test runner (jsdom, excludes e2e and browser-tests).
- `packages/ui/vitest.browser.config.ts`: Vitest browser mode runner on port 15173 with Playwright provider, Chromium, headless, serial execution (`fileParallelism: false`), and custom media fixture mock plugin (`mediaFixturePlugin`) for `/api/fs/{video,image}/{tickets,stream}`.
- `packages/ui/playwright.config.ts`: Application E2E test runner (`@playwright/test`), Desktop Chrome (1440x900), `workers: 1`, `fullyParallel: false`, 60s timeout, system Chromium detection.

### 1.9 `scripts/`
- `run-all-tests.sh`: Authoritative repository test runner executing backend Rust, shared, browser bridge, UI unit, native host, UI browser, UI E2E, and optional native SSH-forward E2E.
- `run-uat.sh`: Production UAT script deploying Rust API on 4803 and Web on 4804.
- `qualify-host-resource-sse.mjs`: SSE qualification runner for Phase 05 / Q05-B.
- `qualify-phase09-workbench.mjs`: Multi-profile concurrent workbench test harness.
- `verify-idle-suspend-boundary.sh`: Idle suspend boundary and hardening integrity checks.
- `compare-servers.sh`: Retired legacy comparison script between Rust and obsolete Node server.
- `bench.sh`: HTTP endpoint baseline tool using hey/wrk.
- `profile-host-resource-monitor.sh` & `profile-host-resource-deep-scan.sh`: Performance profiling for host resource background monitors.

---

## 2. Runtime and Data Flow

### 2.1 Profile, Transport, and Query Lifecycle
```
[Startup: apps/web/src/main.tsx]
   │
   ├── 1. performFreshStateReset() ──> Clears obsolete browser-local storage
   ├── 2. initTransport(new IdleTransport()) ──> Fallback before React mount
   ├── 3. migrateToProfiles() ──> Legacy single-server to multi-profile
   ├── 4. fetchRuntimeConfig() ──> Reconciles managed daemon profile
   ├── 5. QueryClientProvider ──> Standard TanStack QueryClient
   └── 6. DamHopperApp mounts ──> Auto-login for "none" auth profiles & connectProfile()
```
- Active server profile determines owner tuple `profileId@generation`.
- `connectProfile(profileId)` establishes live WebSocket transport (`WsTransport`), registering it in `connectionRegistry`.
- React Query hooks (`useConfig`, `useHostResourceSnapshot`, `useProjects`, etc.) accept `targetOwner` to scope queries to specific server profiles.

### 2.2 Workbench Mode and Viewport Navigation
- **Workspace Modes**: Stored in `localStorage` via `loadWorkspaceMode()` / `saveWorkspaceMode()`.
  - **IDE Mode (`IdeShell.tsx`)**: Traditional multi-pane IDE layout. Left sidebar holds FileTree/Search/Git; right sidebar holds ProjectInfo/Fleet/Advisor; bottom panel holds Terminal/Git/Ports; center holds EditorTabs/MonacoHost/LargeFileViewer.
  - **Terminal Mode (`TerminalWorkspaceShell.tsx`)**: Terminal takes full canvas. Tools, FileTree, Git, and Advisor open as floating overlays (`TerminalFloatingToolPanel`, `TerminalFloatingFilePanel`).
  - **Compact Mode (`MobileWorkspaceShell.tsx`)**: Activated automatically by `useCompactWorkspace()` on mobile/touch viewports. Provides drawer sheets and bottom tab navigation.
- **Offscreen Keep-Alive Host**:
  - `TerminalKeepAliveHost.tsx` docks inactive/background terminal sessions at `style={{ transform: "translate(-10000px, -10000px)" }}`. Keeps xterm instances and WebSocket PTY streams alive without losing buffer state or re-instantiating terminals during layout shifts.
  - `BrowserDebugKeepAliveHost.tsx` applies the same pattern to retain inspected iframe sessions across shell transitions.

### 2.3 Native Evcrate Advisor Routing Flow
```
AdvisorPanel (useReducer: appReducer)
   │
   ├── NativeAdvisorProvider
   │     │
   │     ├── probeStatus() ──> GET /api/advisor/status
   │     │      ├── enabled && available ──> DEFAULT_CAPABILITIES (all 10 actions)
   │     │      └── enabled && !available ──> ROUTING_CAPABILITIES (policy + models only)
   │     │
   │     ├── fetchPolicy() ──> GET /api/advisor/policy (returns policy_bytes_etag)
   │     │
   │     └── updatePolicy() ──> POST /api/advisor/policy
   │            ├── Validates via policy-routing-validation.ts (backends, effort, syntax)
   │            └── Sends CAS header/payload with policy_bytes_etag
   │
   └── Views: OverviewView, HistoryView, ConfigurationView, EvaluationsView
```
- Fully native: zero iframes, no plugin-sdk, no window hash routing.
- Validates 4 backends: `omp`, `codex`, `claude`, `pi`. For `omp` and `pi`, models must match `provider/model` syntax.
- Backend efforts enforced: `codex` (4 levels), `claude` (5 levels), `omp`/`pi` (7 levels: `off` to `max`).

### 2.4 Media Preview and Streaming Flow
- `VideoPreview.tsx` / `ImagePreview.tsx`:
  - Request short-lived preview capability ticket from `/api/fs/video/tickets` or `/api/fs/image/tickets` passing client UUID (`mediaClientId`).
  - Server sets `damhopper-media-session-*` cookie and returns ticket metadata.
  - Native `<video src="/api/fs/video/stream/{ticket}">` or `<img src="/api/fs/image/stream/{ticket}">` streams directly from server via native browser engine. Zero JavaScript array buffer buffering.
  - On unmount or selection retry, client issues best-effort DELETE to revoke ticket lease.
  - Video download uses an independent ticket through `startVideoDownload` to avoid revoking the active playback session.

### 2.5 Cognito Privacy Mode Flow
- Triggered via shortcut (default `Ctrl+Alt+P` / `Cmd+Alt+P`) or store toggle.
- `CognitoModeOverlay.tsx` mounts via React Portal directly into `document.body` with `z-index: 10000`.
- `useCognitoModeInputGuard.ts` registers window capture-phase listeners (`pointerdown`, `mousedown`, `keydown`, `touchstart`, etc.), swallowing all user inputs except designated shortcut keys.
- App content container marked with `inert` and `aria-hidden="true"`.
- `TerminalPanel` suppresses xterm keyboard event propagation via `shouldConsumeCognitoModeTerminalKey`.
- Visual presentation: `.cognito-mode-overlay--heavy-blur` (`blur(16px) saturate(180%)`) with fail-opaque black screen fallback when `backdrop-filter` is unsupported or `prefers-reduced-transparency: reduce`.

### 2.6 Safe Git Operations & Leased Force Push
- **Squash Flow (`GitSquashFlow.tsx`, `GitSquashDialog.tsx`)**:
  - Validates contiguous commit selection from `GitLogTree`.
  - Normalizes squash message, previews combined commit hashes, and executes branch/HEAD CAS commit squash.
- **Leased Force Push (`GitForcePushDialog.tsx`, `useLeasedGitPush.ts`)**:
  - Two-phase lease contract:
    1. `preview`: Fetches remote branch snapshot and confirms local OID base matches remote upstream OID.
    2. `publish`: Submits push with lease token. If remote changed between preview and publish, state enters `stale` or `blocked` and rejects force-push.

---

## 3. Authoritative Commands, Config, and Contracts

### 3.1 Authoritative Verification Commands
| Target | Command | Notes |
| :--- | :--- | :--- |
| **All Test Suites** | `bash scripts/run-all-tests.sh` | Top-level authoritative runner running all suites in detached process group |
| **Rust Backend Tests** | `pnpm test` (`cargo test`) | Axum server, CAS, PTY, Git ODB, and idle-suspend tests |
| **UI Unit Tests** | `pnpm --filter @dam-hopper/ui test` | Vitest jsdom unit tests |
| **UI Browser Tests** | `pnpm --filter @dam-hopper/ui test:browser` | Vitest browser mode (Chromium, port 15173, serial) |
| **Application E2E Tests** | `pnpm --filter @dam-hopper/ui test:e2e` | Playwright E2E journeys (Chromium, workers: 1, port 14801/4800) |
| **Web Production Build** | `pnpm --filter @dam-hopper/web build` | Must have `VITE_DAM_HOPPER_SERVER_URL` unset |
| **Browser Extension Build**| `pnpm --filter @dam-hopper/browser-extension build` | Staged into `apps/web/public` |
| **Production UAT Run** | `bash scripts/run-uat.sh start` | Runs release server (4803) and web daemon (4804) |

### 3.2 Configuration Invariants & Contracts
- **Web Build Backend Invariant**: `VITE_DAM_HOPPER_SERVER_URL` must remain **unset** during production build (`apps/web/vite.config.ts`). Setting it triggers a hard build error. Production serves web assets from the same origin as the daemon.
- **Vitest Browser Runner Invariants (`vitest.browser.config.ts`)**:
  - `fileParallelism: false`: Tests run serially because they share the Vite media fixture server and Chromium has a strict resource budget.
  - Strict port `15173`.
  - System Chromium detection order: `BROWSER_EXECUTABLE_PATH`, `/usr/bin/chromium-browser`, `/usr/bin/chromium`.
- **Playwright E2E Runner Invariants (`playwright.config.ts`)**:
  - `workers: 1`, `fullyParallel: false`.
  - Desktop Chrome viewport 1440x900.
  - Timeout 60,000ms; expect timeout 10,000ms.
- **React 19 Radix UI Patch**: `patches/@radix-ui__react-compose-refs@1.1.2.patch` must be applied by pnpm; without it, React 19 triggers infinite re-rendering loops during ref attachment.

---

## 4. Product Capabilities and Limits

### 4.1 Implemented Capabilities
1. **Unified Dual Workbench**: Seamless switching between full IDE mode and terminal workspace; state persisted across reloads.
2. **Terminal Offscreen Parking**: Background terminals maintain live PTY connection, output streaming, and scrollback via offscreen positioning (`-10000px`), preventing socket teardown.
3. **Native Advisor**: Complete server-native Evcrate routing, CAS-governed policy modification, and comparative evaluation dashboards.
4. **Safe Git History Mutations**: Message rewrites, multi-commit squashing, soft/mixed/hard/keep reset, and leased force-push with remote conflict detection.
5. **Zero-JS Media Streaming**: Direct browser audio/video streaming via capability tickets, protecting server credentials while offloading decoding to native browser media engines.
6. **Multi-Profile Fleet Health Deck**: Concurrent monitoring of multiple backend servers via SSE with snapshot polling fallbacks.
7. **In-App Cognito Privacy Mask**: Real-time visual blackout/blur with complete window input event capture suppression.
8. **In-Iframe Browser Debugging**: MV3 Chrome extension enabling live element selection in framed target applications.

### 4.2 Known Product Limits & Boundaries
1. **Single Daemon Backend**: Rust daemon (`dam-hopper-server`) is the sole supported backend. Node server is completely retired.
2. **Retired Plugin Platform**: No third-party plugin SDK, iframe plugins, or MessagePort runners.
3. **SSH Forwarding Restrictions**: SSH port forwarding page (`/ssh-forwarding`) is restricted to the Tauri native desktop environment (`nativeDesktop`); disabled in standard web browsers.
4. **Media Codec Constraints**: Playback depends strictly on browser codecs (VP8/VP9/H.264/AV1). Unsupported containers/codecs fail gracefully with an explicit message prompting direct download.
5. **Cookie Privacy Constraints**: Capability tickets require site session cookies; third-party cookie blocking or aggressive incognito settings trigger `MEDIA_SESSION_UNSUPPORTED`.
6. **Cognito Scope**: Strictly an in-browser viewport and input barrier. Does not mask OS window switchers, taskbars, or host OS screenshots.

---

## 5. Design Guidelines Source

**Design System Authority**: `packages/ui/src/index.css` and `docs/frontend-components/platform-integrations.md` (§ Shared design-system and embedding contract).
- **Aesthetic**: Developer-tool monospace dark theme.
- **Typography**: JetBrains Mono for both UI and code surfaces (`--font-sans` and `--font-mono`: `"JetBrains Mono", ui-monospace, monospace`).
- **Color Tokens**: Full HSL CSS variables in `index.css`:
  - Background: `hsl(222, 47%, 5%)` (`#0D1117`)
  - Surface: `hsl(217, 33%, 11%)` (`#1E293B`)
  - Primary / Accent: `hsl(217, 91%, 60%)` (`#3B82F6` VS Code blue)
  - Border: `hsl(215, 25%, 22%)` (`#2A3A52`)
- **Interactive Primitives**: Radix UI wrappers in `packages/ui/src/components/ui/` (`Dialog`, `ContextMenu`, `Select`, `Textarea`, `AlertDialog`) patched for React 19.
- **Control Sizing**: 44px compact touch-friendly minimum targets for buttons and interactive controls.
- **Safe-Area Insets**: Variables `--safe-area-top`, `--safe-area-bottom`, `--safe-area-left`, `--safe-area-right` enforced via `.safe-area-inline`, `.safe-area-top`, `.safe-area-bottom`.
- **Accessibility**: High-contrast focus rings (`focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]`), live-region announcements, and explicit ARIA descriptors.

---

## 6. Doc Updates Needed (with Source Evidence)

1. **Retire `scripts/compare-servers.sh`**:
   - *Evidence*: `scripts/compare-servers.sh` references a legacy Node server artifact and compares the Rust daemon against the Node server. The Node server package does not exist in the repository; the Node server has been completely retired.
   - *Action*: Mark script as retired/archived in scripts documentation or remove from active tooling guides.
2. **Version Discrepancy in `apps/browser-extension/public/manifest.json`**:
   - *Evidence*: `apps/browser-extension/public/manifest.json:4` specifies `"version": "0.2.0"`, whereas `apps/browser-extension/package.json:3` specifies `"version": "0.10.2"`.
   - *Action*: Update release bump checklist docs to highlight `apps/browser-extension/public/manifest.json` as one of the 13 required versioned files.
3. **Cross-Reference Design Guidelines**:
   - *Evidence*: The design guidelines are clearly stated in `docs/frontend-components/platform-integrations.md` and `packages/ui/src/index.css`, but not linked in `docs/frontend-components/index.md` or `docs/codebase-summary.md`.
   - *Action*: Add an explicit reference in `docs/frontend-components/index.md` pointing to `docs/frontend-components/platform-integrations.md` and `packages/ui/src/index.css` as the single design guidelines source.
4. **Roadmap Claims Verification**:
   - *Evidence*: `docs/project-roadmap.md` lists Native Advisor, Git rewrite/squash, Quick tunnels, 4-tier testing, Cognito Mode, and Multi-profile workbench as complete. All of these claims match current code in `packages/ui/` and `apps/web/`.
   - *Action*: Confirm roadmap reflects 100% current code reality. No outdated completion claims found in `docs/project-roadmap.md`.

---

## 7. Retired versus Active Functionality

| Component / Subsystem | Status | Current Code Reality |
| :--- | :--- | :--- |
| **Node.js API Server** | **Retired** | Deleted from repository (`packages/server` does not exist). |
| **Rust Backend Daemon** | **Active** | Rust server release binary is the single daemon authority. |
| **Plugin Platform & SDK** | **Retired** | Untrusted plugin runner, iframe host, and MessagePort bridge eliminated. |
| **Evcrate Native Advisor** | **Active** | Implemented as native React component tree in `packages/ui/src/advisor/` communicating via `/api/advisor/*`. |
| **Single Server Config** | **Retired** | Migrated automatically on startup via `migrateToProfiles()`. |
| **Multi-Profile Workbench**| **Active** | Fully integrated in `useWorkbenchSelectionsStore`, `useServerProfile`, and connection registry. |
| **Legacy URL Paths (`/ide`, `/terminals`)** | **Retired / Redirected** | Routed via `<LegacyRedirect to="/workspace" />` preserving search params. |
| **Side-by-side Server Diff Script** | **Retired** | `scripts/compare-servers.sh` is obsolete. |
| **React 19 Compose-Refs** | **Active Patch** | Handled via pnpm patch in `patches/@radix-ui__react-compose-refs@1.1.2.patch`. |

---

## 8. Unresolved Questions

1. Should `scripts/compare-servers.sh` be removed immediately or retained in an `archive/` directory for historical reference?
2. Should `apps/browser-extension/public/manifest.json` version bump to `0.10.2` be automated via standard pnpm version scripts or documented in the release playbook?
