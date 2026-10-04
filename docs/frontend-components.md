# Frontend Components

Dam-Hopper shares one React UI between the browser and Tauri hosts. The host entry points are thin; `packages/ui` owns the shell, profile-scoped connections, components, state, and API clients.

## Contents

- [Workbench and profile components](./frontend-components/workbench.md) — shell, profiles, Git history, Settings, and Native Advisor.
- [Host resources and usage](./frontend-components/host-and-usage.md) — host-resource fleet, usage, idle-suspend status, and terminal integration.
- [File and media components](./frontend-components/files-and-media.md) — Explorer decorations and image, video, and HTML previews.
- [Privacy and agent notifications](./frontend-components/notifications-and-privacy.md) — Cognito Mode, agent status notifications, and terminal title ordinals.
- [Component detail index](./frontend-components/index.md) — terminal/IDE and platform integration guides.
- [Workflow Context Surface](./workflow-context-surface.md) — workflow component ownership and interaction contracts.

## Legacy section links

These headings preserve links from the former single-page guide.

### Profile-owned enrollment and MFA UI (Phase 04)

See [Workbench and profile components](./frontend-components/workbench.md#profile-owned-enrollment-and-mfa-ui-phase-04).

### Host-resource fleet deck and cards (Phase 02)

See [Host resources and usage](./frontend-components/host-and-usage.md#host-resource-fleet-deck-and-cards-phase-02).
