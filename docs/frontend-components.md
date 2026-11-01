# Frontend Components

DamHopper delivers a shared React 19 UI package (`packages/ui`) hosted by the Vite web application (`apps/web`). (The former desktop Tauri host `apps/native` was retired in Phase 02). The host entry point is thin; `packages/ui` owns the shell, profile-scoped connections, components, state, and API clients (canonical export `packages/ui/src/embed/dam-hopper-app.tsx`).

Design guidelines, color tokens, and typography are defined in [Platform Integrations](./frontend-components/platform-integrations.md#shared-design-system-and-embedding-contract) and `packages/ui/src/index.css`.

## Contents

- [Workbench and profile components](./frontend-components/workbench.md) — Shell modes, profile connection lifecycle, Git history, and Settings.
- [Terminal and IDE components](./frontend-components/terminal-and-ide.md) — Terminal workspace, PaneContainer splitting, PortsPanel tunnels, and Explorer/editor UI.
- [Platform integrations](./frontend-components/platform-integrations.md) — Shared design system, Browser Debug bridge, and native host contracts.
- [Host resources and usage](./frontend-components/host-and-usage.md) — Host-resource fleet deck, usage analytics, idle-suspend status, and terminal integration.
- [File and media components](./frontend-components/files-and-media.md) — Explorer decorations, image/video previews, and sandboxed HTML preview.
- [Privacy and agent notifications](./frontend-components/notifications-and-privacy.md) — Cognito Privacy Mode, agent status notifications, and terminal title ordinals.
- [Workflow Context Surface](./workflow-context-surface.md) — Responsive workflow context UI, component ownership, and interaction contracts.
- [Session Changes Review Components](#session-changes-review-components) — Read-only Monaco review modal, keyboard isolation, and changed files list.

## Legacy Section Links

These headings preserve links from earlier documentation versions.

### Profile-owned enrollment and MFA UI

See [Workbench and profile components](./frontend-components/workbench.md#profile-owned-enrollment-and-mfa-ui).

### Host-resource fleet deck and cards

See [Host resources and usage](./frontend-components/host-and-usage.md#host-resource-fleet-deck-and-cards).

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
