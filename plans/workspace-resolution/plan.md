---
title: "Workspace Resolution Enhancement"
description: "Layered workspace discovery: flag → env var → walk-up → XDG global config"
status: pending
priority: P1
effort: 4h
branch: master
tags: [cli, workspace, dx, config]
created: 2026-03-22
---

# Workspace Resolution Enhancement

## Summary

Adds a full priority-layered workspace resolution chain to the CLI and server so
users can point dev-hub at a workspace from multiple convenient entry points.

## Resolution Priority (highest → lowest)

1. `--workspace` CLI flag (already wired — flows via `cmd.optsWithGlobals()`)
2. `DEV_HUB_WORKSPACE` environment variable (new)
3. CWD walk-up to `dev-hub.toml` (existing behavior in `findConfigFile()`)
4. `~/.config/dev-hub/config.toml` XDG global defaults (new, deferred)

## Phases

| Phase | Title                        | Status   | Effort | File |
|-------|------------------------------|----------|--------|------|
| 01    | Layered Resolution Core      | done     | 2h     | [phase-01](./phase-01-layered-resolution-core.md) |
| 02    | Server Workspace Parity      | done     | 1.5h   | [phase-02](./phase-02-server-workspace-parity.md) |
| 03    | Global XDG Config            | deferred | 1h     | [phase-03](./phase-03-global-xdg-config.md) |

## Known Gaps (pre-implementation)

- `loadWorkspace()` ignores `DEV_HUB_WORKSPACE` env var entirely
- `init` command hardcodes `process.cwd()` — ignores `--workspace` flag
- `createServerContext()` accepts only a file path, not a directory
- `dev-hub ui` calls `startServer(port)` — no workspace forwarding to server
- `server/src/index.ts` reads `DEV_HUB_CONFIG` (file path only), not `DEV_HUB_WORKSPACE`
- No `GlobalOptions` type — each command manually types the generic
- Error messages do not mention `--workspace` or `DEV_HUB_WORKSPACE`
- No tests for env var override, flag override, or walk-up interaction

## Affected Files

- `packages/cli/src/utils/workspace.ts` — resolution chain lives here
- `packages/cli/src/commands/init.ts` — hardcoded `process.cwd()`
- `packages/cli/src/commands/ui.ts` — must forward workspace to server
- `packages/cli/src/utils/types.ts` (new) — `GlobalOptions` type
- `packages/server/src/services/context.ts` — directory-path support + env var
- `packages/server/src/index.ts` — `DEV_HUB_WORKSPACE` env var support
- `packages/core/src/config/finder.ts` — untouched (walk-up already correct)
