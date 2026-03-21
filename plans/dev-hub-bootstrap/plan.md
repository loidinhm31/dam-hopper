# Dev-Hub Bootstrap Plan

> Workspace management CLI + web dashboard for multi-project development environments.

## Goal

Build a tool that manages a workspace of multiple sub-projects (Java/Maven, Gradle, Node, Rust) from a single CLI and web UI. Core capabilities: git operations (bulk fetch/pull, worktrees, branch management), build/run orchestration, and a real-time web dashboard.

## Tech Stack

- **Language**: TypeScript (ESM throughout)
- **Monorepo**: pnpm workspaces + tsup (libraries) + Vite (web)
- **CLI**: Commander.js + @clack/prompts + Ink (React-based terminal UI)
- **Server**: Hono (lightweight, Hono RPC for type-safe client)
- **Web**: React 19 + Tailwind v4 + shadcn/ui + TanStack Query
- **Config**: TOML (smol-toml)
- **Git**: simple-git
- **Process**: execa

## Phases

| # | Phase | Status | File |
|---|-------|--------|------|
| 1 | Project Setup (monorepo, tooling) | `done` | [phase-01-project-setup.md](./phase-01-project-setup.md) |
| 2 | Core: Config & Discovery | `done` | [phase-02-core-config.md](./phase-02-core-config.md) |
| 3 | Core: Git Operations | `pending` | [phase-03-core-git.md](./phase-03-core-git.md) |
| 4 | Core: Build & Run | `pending` | [phase-04-core-build-run.md](./phase-04-core-build-run.md) |
| 5 | CLI | `pending` | [phase-05-cli.md](./phase-05-cli.md) |
| 6 | Server API | `pending` | [phase-06-server-api.md](./phase-06-server-api.md) |
| 7 | Web Dashboard | `pending` | [phase-07-web-dashboard.md](./phase-07-web-dashboard.md) |
| 8 | Integration & Testing | `pending` | [phase-08-integration-testing.md](./phase-08-integration-testing.md) |

## Dependency Graph

```
Phase 1 (setup)
  └─> Phase 2 (core/config)
       ├─> Phase 3 (core/git)
       └─> Phase 4 (core/build-run)
            ├─> Phase 5 (cli)        -- depends on phases 2, 3, 4
            └─> Phase 6 (server)     -- depends on phases 2, 3, 4
                 └─> Phase 7 (web)   -- depends on phase 6
                      └─> Phase 8 (testing) -- depends on all
```

## Package Structure

```
dev-hub/
  pnpm-workspace.yaml
  tsconfig.base.json
  dev-hub.toml              # example workspace config
  packages/
    core/                   # @dev-hub/core — config, git, build/run services
    cli/                    # @dev-hub/cli — Commander.js + Ink terminal UI
    server/                 # @dev-hub/server — Hono REST + SSE API
    web/                    # @dev-hub/web — React dashboard
```

## Milestones

1. **M1 — CLI MVP**: Phases 1-5 complete. `dev-hub status`, `dev-hub git fetch`, `dev-hub build` work from terminal.
2. **M2 — Web MVP**: Phases 6-7 complete. `dev-hub ui` opens browser dashboard with live updates.
3. **M3 — Stable**: Phase 8 complete. Tests pass, ready for daily use.

## Notes

- All packages use ESM (`"type": "module"` in package.json).
- The core package is the only one with business logic; cli/server/web are thin wrappers.
- SSE is the bridge between server and web for real-time updates (git progress, build logs).
- Config file (`dev-hub.toml`) lives at workspace root; CLI auto-discovers it by walking up directories.
