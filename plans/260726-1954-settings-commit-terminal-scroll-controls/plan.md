---
title: Settings commit status and terminal scroll controls
description: Add a manual latest-commit summary to Settings and modernize terminal scroll controls.
status: in-progress
priority: medium
effort: medium
branch: main
tags: [settings, git-status, terminal, ui]
created: 2026-07-26
---

# Settings commit status and terminal scroll controls

Status: planned · Date: 2026-07-26 · Priority: medium

## Pre-flight contract

- **Output:** a manual-refresh, active-project commit summary in Settings plus a modern expandable terminal scroll navigation control.
- **Acceptance:** Settings can display branch, message, formatted date, and seven-character hash after an explicit refresh; no extra API exists; the terminal retains all four scroll actions, focus, mobile spacing, keyboard dismissal, and accessible controls.
- **In scope:** TypeScript status-contract alignment, a Project status Settings accordion, focused tests, and the terminal-control redesign.
- **Out of scope:** backend/API changes, polling, new persistence, Git actions, data migration, terminal scroll heuristics, visual assets.
- **Risk/public contracts:** `GitStatus` must mirror Rust camelCase payloads; Settings must use the persisted active project and not imply data is fresh before explicit refresh.
- **Affected:** `client.ts`, `queries.ts` or a narrow wrapper, Settings page/components, terminal scroll component/tests; no server changes expected.
- **Validation:** frontend typecheck/build, focused Vitest, browser keyboard/outside-click/mobile-layout coverage, then project-native checks.
- **Open questions:** none.

## Placement decision

| Option | Outcome | Decision |
| --- | --- | --- |
| Appearance card | Associates it with terminal preference but mixes project data with global preferences. | Reject |
| Workspace Config | Close to project definitions but turns an editor section into a runtime dashboard. | Reject |
| **Project status accordion** | Read-only runtime context near Workspace Config, independently collapsible and easy to find. | **Chosen** |

## Phases

1. [Phase 01 — Settings commit summary](phase-01-settings-commit-summary.md) — completed 2026-07-26
2. [Phase 02 — Terminal scroll control](phase-02-terminal-scroll-control.md) — planned

## Side-effect review

- Auth/session/permissions: existing authenticated `projects:status` transport only.
- API compatibility: extend the client type to the current Rust payload; no endpoint change.
- Data/migrations: none.
- Business logic: manual request only; cached values must not be labeled current without the user action.
- Security/privacy/logging: render Git metadata as text; no terminal output or secrets; no new logging.
- Performance/concurrency: no polling; one request per explicit refresh; no terminal lifecycle changes.
- Docs/config/deploy: no configuration or deploy effect; update docs only if project conventions need the Settings surface documented.
