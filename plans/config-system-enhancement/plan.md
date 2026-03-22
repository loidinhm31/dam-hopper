---
title: "Config System Enhancement: Services, Custom Commands & Web Editor"
description: "Add multi-service support per project, custom commands, and a form-based config editor in the web dashboard"
status: pending
priority: P1
effort: 10h
branch: master
tags: [config, services, web-editor, breaking-change]
created: 2026-03-22
---

# Config System Enhancement

## Context

Currently each dev-hub project supports only a single `build_command` and `run_command`. Users need to run multiple processes within a single project (e.g., frontend + backend dev servers) and define custom commands beyond build/run (test, lint, migrate). Additionally, there's no way to edit the config from the web dashboard — users must manually edit `dev-hub.toml`.

This plan introduces:

1. **Project services** — named sub-processes that run in parallel within a project
2. **Custom commands** — arbitrary named commands per project
3. **Web config editor** — form-based UI to manage workspace config

## New Config Format

```toml
[[projects]]
name = "my-app"
path = "./my-app"
type = "pnpm"
env_file = ".env"
tags = ["fullstack"]

[[projects.services]]
name = "frontend"
run_command = "pnpm dev:frontend"
build_command = "pnpm build:frontend"

[[projects.services]]
name = "backend"
run_command = "pnpm dev:backend"
build_command = "pnpm build:backend"

[projects.commands]
test = "pnpm test"
lint = "pnpm lint"
migrate = "pnpm db:migrate"
```

**Breaking change**: `build_command` and `run_command` removed from project level. Projects without services fall back to type presets.

## Implementation Phases

| #   | Phase                                                              | Effort | Status  | Depends On |
| --- | ------------------------------------------------------------------ | ------ | ------- | ---------- |
| 01  | [Schema & Presets](./phase-01-schema-and-presets.md)               | 1.5h   | done    | —          |
| 02  | [Build & Run Services](./phase-02-build-run-services.md)           | 2h     | done    | 01         |
| 03  | [CLI Updates](./phase-03-cli-updates.md)                           | 1.5h   | done    | 02         |
| 04  | [Server Config API](./phase-04-server-config-api.md)               | 1.5h   | done    | 01         |
| 05  | [Web Config Editor](./phase-05-web-config-editor.md)               | 2.5h   | done    | 04         |
| 06  | [Server Build/Run Updates](./phase-06-server-build-run-updates.md) | 1h     | pending | 02, 04     |

### Dependency Graph

```
Phase 01 (Schema) ──┬──> Phase 02 (Build/Run) ──┬──> Phase 03 (CLI)
                    │                            │
                    └──> Phase 04 (Server API) ──┼──> Phase 05 (Web Editor)
                                                 │
                                                 └──> Phase 06 (Server Routes)
```

Phases 02+04 can run in parallel after Phase 01.

## Key Files Modified

**Core (Phase 01-02):**

- `packages/core/src/config/schema.ts` — new ServiceConfigSchema, updated ProjectConfigSchema
- `packages/core/src/config/presets.ts` — getProjectServices(), updated resolution
- `packages/core/src/config/parser.ts` — writeConfig serialization for new fields
- `packages/core/src/build/build-service.ts` — multi-service build support
- `packages/core/src/build/run-service.ts` — multi-process management per project

**CLI (Phase 03):**

- `packages/cli/src/commands/build.ts` — --service flag
- `packages/cli/src/commands/run.tsx` — --service flag, multi-service Runner
- `packages/cli/src/index.ts` — new exec command

**Server (Phase 04, 06):**

- `packages/server/src/routes/config.ts` — NEW: config CRUD routes
- `packages/server/src/app.ts` — mount config routes
- `packages/server/src/services/context.ts` — configPath, reloadConfig
- `packages/server/src/routes/build.ts` — service-aware builds
- `packages/server/src/routes/processes.ts` — service-aware processes

**Web (Phase 05):**

- `packages/web/src/api/client.ts` — config API methods
- `packages/web/src/api/queries.ts` — config query/mutation hooks
- `packages/web/src/pages/SettingsPage.tsx` — config editor integration
- `packages/web/src/components/organisms/ConfigEditor.tsx` — NEW: form editor

## Verification Plan

1. **Unit tests**: Run `pnpm test:run` — all 152+ tests pass (updated for new schema)
2. **Config round-trip**: Write a config with services/commands, read it back, verify equality
3. **CLI smoke test**:
   - `dev-hub build <project>` builds all services
   - `dev-hub build <project> --service frontend` builds one service
   - `dev-hub run <project>` starts all services
   - `dev-hub exec <project> test` runs custom command
4. **API test**: `curl localhost:4800/api/config` returns full config with services
5. **Web editor**: Open dashboard settings page, add a service, save, verify dev-hub.toml updated
6. **E2E**: Run existing e2e test suite to verify no regressions

## Unresolved Questions

- Should `dev-hub run` with multiple services show interleaved or split output in CLI? (Can decide during Phase 03)
- Should services support `env_file` override per-service, or inherit from project? (Start with inherit, add later if needed)
