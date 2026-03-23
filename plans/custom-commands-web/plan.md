---
title: "Custom Commands in Web UI"
description: "Wire custom commands from Settings into ProjectDetailPage with exec, inline editing, and command visibility"
status: done
priority: P1
effort: 4h
branch: master
tags: [web, commands, dx]
created: 2026-03-22
---

# Custom Commands in Web UI

## Summary

Custom commands (`project.commands`) are configurable in Settings but invisible and
unusable in the Projects pages. This plan wires the exec API to the web client, adds
a Commands tab to ProjectDetailPage, shows effective build/run commands, and allows
inline command management without navigating to Settings.

## Problem

1. Build/Run tabs show no command — users don't know what will execute
2. Custom commands defined in Settings have no execution UI
3. `POST /api/exec/:project` server endpoint exists but has no web client
4. No way to add/edit commands from ProjectDetailPage

## Phases

| Phase | Title                             | Status  | Effort | Parallel Group | File                                           |
| ----- | --------------------------------- | ------- | ------ | -------------- | ---------------------------------------------- |
| 01    | API Client + Hooks                | pending | 0.5h   | A              | [phase-01](./phase-01-api-client-hooks.md)     |
| 02    | Commands Tab in ProjectDetailPage | pending | 2h     | A              | [phase-02](./phase-02-commands-tab.md)         |
| 03    | Build & Run Command Visibility    | pending | 1.5h   | A              | [phase-03](./phase-03-build-run-visibility.md) |

## Dependency Graph

```
Phase 01 (API client + hooks)
    ↓
Phase 02 (Commands tab — consumes Phase 01 hooks)
Phase 03 (Build/Run visibility — consumes Phase 01 hooks)

Execution: Phase 01 first, then Phase 02 + 03 in parallel
```

## File Ownership Matrix

| File                                                            | Phase |
| --------------------------------------------------------------- | ----- |
| `packages/web/src/api/client.ts`                                | 01    |
| `packages/web/src/api/queries.ts`                               | 01    |
| `packages/web/src/pages/ProjectDetailPage.tsx`                  | 02    |
| `packages/web/src/components/organisms/CommandRunner.tsx` (new) | 02    |
| `packages/web/src/pages/BuildPage.tsx`                          | 03    |
| `packages/web/src/components/organisms/BuildLog.tsx`            | 03    |

## Affected Packages

- `@dev-hub/web` — All changes are frontend-only

## No Server Changes Needed

The server already has:

- `POST /api/exec/:project` — executes custom commands
- `PATCH /api/config/projects/:name` — updates project config
- SSE `command:progress` events — real-time output streaming
- `PUT /api/config` — full config updates

## Research

- [Exec flow analysis](./research/researcher-01-exec-flow.md)
- [Web UI components analysis](./research/researcher-02-web-ui.md)
