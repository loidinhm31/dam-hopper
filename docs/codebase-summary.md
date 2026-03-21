# Dev-Hub Codebase Summary

**Phase 01: Project Setup** — Complete

## Project Overview

Dev-Hub is a workspace management tool for multi-project development environments. It provides both CLI and web dashboard interfaces to manage git-based projects, build configurations, and development workflows.

## Monorepo Structure

```
dev-hub/
├── packages/
│   ├── core/        # @dev-hub/core — shared logic, git ops, config parsing
│   ├── cli/         # @dev-hub/cli — CLI entry point (Commander.js)
│   ├── server/      # @dev-hub/server — Local HTTP API (Hono on port 4800)
│   └── web/         # @dev-hub/web — React 19 dashboard (Vite + Tailwind v4)
├── dev-hub.toml     # Example workspace config file
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.js
└── .prettierrc
```

## Tech Stack

| Component | Technology | Version | Notes |
|-----------|-----------|---------|-------|
| Runtime | Node.js | 20+ LTS | Server & CLI execution |
| Language | TypeScript | 5.7.x | Strict mode across all packages |
| Package Manager | pnpm | 9.x | Workspaces support |
| **CLI** | Commander | 12.x | Subcommand framework |
| **CLI UI** | Ink + React | 5.x / 18.3.x | Terminal UI |
| **Server** | Hono | 4.7.x | Lightweight HTTP API (14KB) |
| **Web** | React + Vite | 19.x / 6.x | Modern build & HMR |
| **Styling** | Tailwind CSS | 4.x | v4 with Vite plugin |
| **State** | TanStack Query | 5.67.x | Server state + SSE |
| **Build** | tsup | 8.x | Fast bundler for packages |
| **Linting** | ESLint + TypeScript | 9.x / 8.x | Flat config |
| **Format** | Prettier | 3.x | Opinionated formatting |

## Architecture

```
CLI Flow:
  user → dev-hub (cli bin) → Commander → @dev-hub/core → git/execa

Web Flow:
  browser → React dashboard → Hono API (4800) → @dev-hub/core → git/execa
                                    ↑
                                    └─── SSE (real-time progress)
```

The CLI can spawn `dev-hub ui` to start the server and open the dashboard.

## Core Package Dependencies

- **@dev-hub/core**: eventemitter3, execa, p-limit, simple-git, smol-toml, zod
- **@dev-hub/cli**: Commander, @clack/prompts, Ink, React 18, @dev-hub/core
- **@dev-hub/server**: Hono, @hono/node-server, @dev-hub/core
- **@dev-hub/web**: React 19, React DOM, TanStack Query, Vite, Tailwind, TypeScript

## Build & Development

```bash
# Root scripts (pnpm workspaces)
pnpm install      # Install all packages
pnpm build        # Build all packages (tsup + vite)
pnpm dev          # Run all packages in watch mode (parallel)
pnpm lint         # Lint packages/ directory
pnpm format       # Format with Prettier
```

Each package has its own `build` and `dev` scripts. Web package uses Vite dev server.

## Configuration Files

- **pnpm-workspace.yaml**: Defines monorepo structure (`packages/*`)
- **tsconfig.base.json**: Base TypeScript config (ES2022 target, strict mode, declaration maps)
- **eslint.config.js**: Flat config with @typescript-eslint rules
- **.prettierrc**: Semi-colons, double quotes, 2-space tabs, trailing commas
- **dev-hub.toml**: Example workspace config (TOML format via smol-toml)

## Stub Implementations (Phase 01)

All packages are functional stubs ready for feature development:

- **@dev-hub/core**: Exports `VERSION` constant (0.1.0)
- **@dev-hub/cli**: Basic Commander program with `--version` flag
- **@dev-hub/server**: Hono app with `/` health check endpoint on port 4800
- **@dev-hub/web**: React + Vite scaffold with Tailwind CSS v4

## Key Files Reference

| File | Purpose |
|------|---------|
| packages/core/src/index.ts | VERSION export |
| packages/cli/src/index.ts | Commander CLI bootstrap |
| packages/server/src/index.ts | Hono API server + conditional startup |
| packages/web/src/main.tsx | React entry point |
| package.json | Root workspace config (Node 20+, pnpm 9+) |
| tsconfig.base.json | Base TS compiler options |
| eslint.config.js | ESLint flat config (TS support) |
| .prettierrc | Code formatter settings |
| pnpm-workspace.yaml | Workspace package filter |

## Next Steps (Phase 02+)

- Implement core git operations (clone, pull, worktree management)
- Add CLI subcommands (init, add, build, run)
- Build server API routes for workspace management
- Develop web dashboard components and state management
- Add configuration file parsing and validation
