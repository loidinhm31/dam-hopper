# Frontend Components

DamHopper shares one React UI between the browser and Tauri hosts. The host entry points are thin; `packages/ui` owns the shell, profile-scoped connections, components, state, and API clients (canonical export `packages/ui/src/embed/dam-hopper-app.tsx`).

Design guidelines, color tokens, and typography are defined in [Platform Integrations](./frontend-components/platform-integrations.md#shared-design-system-and-embedding-contract) and `packages/ui/src/index.css`.

## Contents

- [Workbench and profile components](./frontend-components/workbench.md) — Shell modes, profile connection lifecycle, Git history, Settings, and Native Advisor.
- [Terminal and IDE components](./frontend-components/terminal-and-ide.md) — Terminal workspace, PaneContainer splitting, PortsPanel tunnels, and Explorer/editor UI.
- [Platform integrations](./frontend-components/platform-integrations.md) — Shared design system, Browser Debug bridge, and native host contracts.
- [Host resources and usage](./frontend-components/host-and-usage.md) — Host-resource fleet deck, usage analytics, idle-suspend status, and terminal integration.
- [File and media components](./frontend-components/files-and-media.md) — Explorer decorations, image/video previews, and sandboxed HTML preview.
- [Privacy and agent notifications](./frontend-components/notifications-and-privacy.md) — Cognito Privacy Mode, agent status notifications, and terminal title ordinals.
- [Workflow Context Surface](./workflow-context-surface.md) — Responsive workflow context UI, component ownership, and interaction contracts.

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
