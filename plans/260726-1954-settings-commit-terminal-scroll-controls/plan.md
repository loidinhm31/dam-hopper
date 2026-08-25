---
title: Terminal commit status and terminal scroll controls
description: Add an opt-in terminal-panel latest-commit status chip and modernize terminal scroll controls.
status: in-progress
priority: P2
effort: 8h
branch: main
tags: [settings, git-status, terminal, ui]
created: 2026-07-26
---

# Settings commit status and terminal scroll controls

Status: in-progress · Date: 2026-07-26 · Priority: medium

## Pre-flight contract

- **Output:** a persisted global ON/OFF preference and an opt-in latest-commit status chip in each active Terminal panel, plus the separate expandable terminal scroll control.
- **Acceptance:** the Settings page exposes only the git-status ON/OFF switch; when enabled, each panel header resolves its active session's project and shows branch, message, formatted date, and short hash; invalid/no-Git/no-commit states hide the chip; no polling or new endpoint; all scroll actions and focus behavior remain intact.
- **In scope:** UI config contract/defaults, Settings switch, removal of the superseded Settings metadata card, reuse of `projects:status`, terminal panel/tab-header status UI, focused tests, and the terminal-control redesign.
- **Out of scope:** backend/API endpoint changes, polling/manual refresh, Git actions, data migration, terminal scroll heuristics, xterm overlays, visual assets.
- **Risk/public contracts:** the persisted UI key must default off and round-trip through Rust camelCase/legacy snake_case mappings; session-to-project resolution must be panel-local and must not show another project's cached result.
- **Affected:** `client.ts`, `queries.ts`, UI config/store and Settings, terminal panel/header components, config schema/global mappings, focused unit/browser tests; no new API.
- **Validation:** frontend typecheck/build, Rust config tests, focused Vitest, browser responsive/accessibility coverage, then project-native checks.
- **Open questions:** none.

## Placement decision

| Option | Outcome | Decision |
| --- | --- | --- |
| Settings project-status card | Mixed project runtime data into global preferences and required a manual-refresh state. | **Superseded** |
| Workspace Config | Turns an editor/config section into a runtime dashboard. | Reject |
| **Terminal panel/tab header** | Keeps status beside the terminal it describes; panel-local session mapping supports split panes. | **Chosen** |

## Phases

1. [Phase 01 — Settings commit summary](phase-01-settings-commit-summary.md) — completed 2026-07-26; placement superseded by Phase 03
2. [Phase 02 — Terminal scroll control](phase-02-terminal-scroll-control.md) — completed 2026-07-26
3. [Phase 03 — Terminal commit status](phase-03-terminal-commit-status.md) — planned

## Side-effect review

- Auth/session/permissions: existing authenticated `projects:status` transport only.
- API compatibility: reuse the existing endpoint and shared `GitStatus` payload; no endpoint change.
- Data/migrations: add one optional global UI boolean with a false default; existing TOML remains valid.
- Business logic: status is panel-local and only rendered when the global preference is on; no stale project result may cross a session/panel change.
- Security/privacy/logging: render commit metadata as React text; no terminal output, secrets, or new logging.
- Performance/concurrency: no polling or extra endpoint; TanStack Query cache may deduplicate same-project panels; query disabled while the toggle is off.
- Docs/config/deploy: update config contract/tests only; no deployment change. Phase 02 scroll work remains independent.
