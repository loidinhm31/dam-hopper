# Dev-Hub Tech Stack

## Core

| Layer | Choice | Version | Purpose |
|-------|--------|---------|---------|
| Runtime | Node.js | 20+ LTS | TypeScript execution |
| Language | TypeScript | 5.x | Type safety across all packages |
| Package Manager | pnpm | 9.x | Workspaces, fast installs |
| Config Format | TOML | 1.0 | Workspace config via smol-toml |

## CLI

| Library | Purpose |
|---------|---------|
| commander | CLI framework, subcommands |
| ink + ink-* | React-based terminal UI (progress, tables, status) |
| @clack/prompts | Interactive prompts (confirmations, selections) |
| simple-git | Git operations (clone, pull, fetch, worktree) |
| execa | Process spawning for build/run commands |
| p-limit | Concurrency control for parallel git ops |

## Server (Local API)

| Library | Purpose |
|---------|---------|
| hono | Lightweight HTTP server (~14KB), native TS, RPC type-safety |
| hono/client | End-to-end type-safe API client for web GUI |
| SSE (native) | Real-time progress streaming to web GUI |

## Web Dashboard

| Library | Purpose |
|---------|---------|
| React 19 | UI framework |
| Vite | Build tool, dev server |
| Tailwind CSS v4 | Styling |
| shadcn/ui | Component library (copy-paste, zero runtime) |
| TanStack Query | Server state management + SSE integration |
| Lucide React | Icons |

## Build & Tooling

| Tool | Purpose |
|------|---------|
| tsup | Build core/cli/server packages (esbuild-based) |
| Vite | Build web dashboard |
| TypeScript project references | Cross-package type checking |

## Monorepo Structure

```
dev-hub/
├── packages/
│   ├── core/        # @dev-hub/core — shared logic (git ops, config, workspace)
│   ├── cli/         # @dev-hub/cli — Commander + ink entry point
│   ├── server/      # @dev-hub/server — Hono API + static file serving
│   └── web/         # @dev-hub/web — React dashboard
├── dev-hub.toml     # Example workspace config
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Architecture

```
User ──► CLI (Commander + ink) ──► @dev-hub/core ──► git / execa
                                        ▲
User ──► Browser ──► Web Dashboard ──► Hono API ──► @dev-hub/core
                         ▲                  │
                         └──── SSE ─────────┘
```

CLI spawns `dev-hub ui` → starts Hono server → serves pre-built React static files + API → opens browser.
