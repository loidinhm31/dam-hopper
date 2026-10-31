# Frontend Components

DamHopper shares one React UI between the browser and Tauri hosts. The host entry points are thin; `packages/ui` owns the shell, profile-scoped connections, components, state, and API clients (canonical export `packages/ui/src/embed/dam-hopper-app.tsx`).

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

- **`SessionChangesHost` (`packages/ui/src/components/organisms/SessionChangesHost.tsx`):** Top-level modal host dialog mounted once in `WorkspacePage.tsx` above responsive shells. Manages open/close state, renders `SessionChangesPanel`, coordinates dialog arbitration, and enforces capture-phase keyboard event isolation to prevent keystrokes and shortcuts from leaking into underlying live xterm terminals.
- **`SessionChangesPanel` (`packages/ui/src/components/organisms/SessionChangesPanel.tsx`):** Orchestrates session baseline queries, coverage and change count chips, status error banners, manual/settled refresh actions, split vs. inline diff layout toggle, explicit `fromNow` adoption, and file list navigation.
- **`ReadonlyMonacoDiffViewer` (`packages/ui/src/components/organisms/ReadonlyMonacoDiffViewer.tsx`):** Capability-free Monaco diff editor rendering original session-start bytes versus current working tree bytes with side-by-side or inline unified toggle. Disables edit commands, drop, and paste; isolates model URIs by full owner tuple; and uses deferred model disposal to eliminate cleanup race conditions.
- **`SessionChangedFilesList` (`packages/ui/src/components/organisms/SessionChangedFilesList.tsx`):** Keyset-paginated and virtualized list displaying changed files with change kinds (`added`, `deleted`, `modified`, `modeOnly`, `unknown`), line addition/deletion counts, and verified historical absence proofs.
- **Launch Entry Points:**
  - **Desktop TabBar (`packages/ui/src/components/organisms/TabBar.tsx`):** "Session changes" action button in active terminal tab bar.
  - **Mobile Accessory Bar (`packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx` / `TerminalAccessoryControls.tsx`):** 44px touch-accessible action button.
  - **Runtime Header (`packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx`):** Header action button in Runtime terminal presentation.
