---
title: "Welcome/Init Page for First Launch"
description: "Replace OS folder picker with in-app welcome page on first launch"
status: pending
priority: P2
effort: 5h
branch: master
tags: [ux, electron, welcome-page, first-launch]
created: 2026-03-23
---

# Welcome/Init Page for First Launch

## Summary

Replace the native OS folder-picker dialog on first launch with a polished in-app
welcome page. Shows options to open a folder, select from recent workspaces, or
(future) create a new workspace. Requires restructuring Electron main process to
create the window before resolving a workspace.

## Architecture Decision

**Deferred workspace resolution**: Create BrowserWindow immediately on app start.
Introduce a "no-workspace" state in the main process. The renderer detects this
state via a new IPC query and conditionally renders the WelcomePage instead of the
normal AppLayout routes. Once the user selects a workspace (via folder picker or
known list), the main process initializes context and the renderer transitions to
the dashboard.

**No new IPC patterns**: Reuse existing `workspace.openDialog()`,
`workspace.switch()`, `workspace.known()`, and `workspace.addKnown()`. Add one
new channel: `workspace:status` returning `{ ready: boolean }`.

## Phases

| Phase | Title                    | Status | Effort | File                                              |
| ----- | ------------------------ | ------ | ------ | ------------------------------------------------- |
| 01    | Electron Main Changes    | done   | 2h     | [phase-01](./phase-01-electron-main-changes.md)   |
| 02    | Welcome Page UI          | done   | 2h     | [phase-02](./phase-02-welcome-page-ui.md)         |
| 03    | Integration Testing      | pending | 1h     | [phase-03](./phase-03-integration-testing.md)     |

## Dependency Chain

Phase 01 (main process restructure) -> Phase 02 (welcome page UI) -> Phase 03 (testing)

## Affected Packages

- `@dev-hub/electron` -- main process startup, preload, IPC channels
- `@dev-hub/web` -- new WelcomePage, App.tsx routing, new queries

## Unresolved Questions

1. Should "Create New Workspace" be a Phase 02 stretch goal or deferred entirely?
2. Should the welcome page support drag-and-drop of a folder onto the window?
3. Should electron-store track a "hasLaunchedBefore" flag separate from lastWorkspacePath?
