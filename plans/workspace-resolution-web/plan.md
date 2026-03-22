---
title: "Workspace Resolution — Web UI"
description: "Workspace switcher, XDG parity on server, and global config editor in the web dashboard"
status: done
priority: P1
effort: 6.5h
branch: master
tags: [web, server, core, workspace, dx]
created: 2026-03-22
---

# Workspace Resolution — Web UI

## Summary

Extends workspace resolution from CLI-only to a full web UI experience. Users can
switch workspaces from the browser, the server gains XDG global config parity with
the CLI, and the Settings page gets a global config editor for managing defaults and
known workspaces.

## Architecture Decision

**Context mutation strategy**: The server's `ServerContext` is captured by reference
in route closures. Instead of recreating the Hono app or HTTP server, we mutate the
context object in place — replacing `config`, `configPath`, `workspaceRoot`, and
all service instances. The `broadcast()` function (closure over `sseClients` Set)
remains valid across swaps. A `workspace:changed` SSE event triggers nuclear cache
invalidation on the web client.

**Known workspaces registry**: Extend `GlobalConfig` with a `workspaces` array
stored in the XDG config file. Auto-register workspaces on open/switch.

## Phases

| Phase | Title                          | Status  | Effort | File |
|-------|--------------------------------|---------|--------|------|
| 01    | Core & Server Foundation       | done    | 2.5h   | [phase-01](./phase-01-core-server-foundation.md) |
| 02    | Web UI Workspace Switcher      | done    | 2h     | [phase-02](./phase-02-web-workspace-switcher.md) |
| 03    | Web UI Global Config Editor    | done    | 1.5h   | [phase-03](./phase-03-web-global-config-editor.md) |

## Dependency Chain

```
Phase 01 (core + server APIs)
    ↓
Phase 02 (web switcher — consumes Phase 01 APIs)
    ↓
Phase 03 (global config editor — extends Phase 02 UI)
```

## Affected Packages

- `@dev-hub/core` — GlobalConfig type extension, new helper functions
- `@dev-hub/server` — XDG fallback, switchWorkspace(), new routes, SSE event type
- `@dev-hub/web` — WorkspaceSwitcher component, SSE handler, Settings extension

## Related Plans

- [Workspace Resolution (CLI)](../workspace-resolution/plan.md) — predecessor, all 3 phases done

## Validation Summary

**Validated:** 2026-03-22
**Questions asked:** 4

### Confirmed Decisions

- **Concurrency during switch**: Add a request-level mutex — block incoming API requests during `switchWorkspace()` with middleware. Guarantees consistency during the swap window.
- **Path validation for adding workspaces**: Auto-init if missing — when adding a workspace path that lacks `dev-hub.toml`, auto-discover projects via `discoverProjects()` and create a config. Adds ~30min to Phase 01.
- **Auto-register on startup**: Yes — auto-register current workspace in known workspaces on every server startup. Deduped by path, atomic writes.
- **UI duplication**: Keep both views — sidebar switcher for quick switching, Settings page for full management. Different purposes, acceptable duplication.

### Action Items

- [ ] Phase 01: Add request-blocking middleware during workspace switch (new `switching` boolean on ctx + Hono middleware that returns 503)
- [ ] Phase 01: Add auto-init logic using `discoverProjects()` + `writeConfig()` when adding a workspace without `dev-hub.toml`
- [ ] Phase 01: Increase effort estimate from 2h → 2.5h (mutex + auto-init scope)
