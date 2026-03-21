# Dev-Hub Codebase Summary

**Phase 01: Project Setup** — Complete
**Phase 02: Core: Config & Discovery** — Complete

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

## Core Implementations

### Phase 01: Project Setup
All packages are functional stubs ready for feature development:

- **@dev-hub/core**: Exports `VERSION` constant (0.1.0)
- **@dev-hub/cli**: Basic Commander program with `--version` flag
- **@dev-hub/server**: Hono app with `/` health check endpoint on port 4800
- **@dev-hub/web**: React + Vite scaffold with Tailwind CSS v4

### Phase 02: Config & Discovery

**@dev-hub/core** now includes complete configuration system:

#### Configuration Schema (schema.ts)
- **ProjectTypeSchema**: Enum of supported project types (maven, gradle, npm, pnpm, cargo, custom)
- **ProjectConfig**: Runtime representation with camelCase fields (name, path, type, buildCommand, runCommand, envFile, tags)
  - Parsed from snake_case TOML format (build_command, run_command, env_file)
  - Validates non-empty project names
- **WorkspaceInfo**: Workspace metadata (name, root directory)
- **DevHubConfig**: Top-level config structure (workspace + projects array)
  - Enforces unique project names via Zod refine

#### Build Presets (presets.ts)
- **PRESETS**: Predefined build configurations for each project type
  - **maven**: mvn clean install / mvn spring-boot:run
  - **gradle**: ./gradlew build / ./gradlew bootRun
  - **npm**: npm run build / npm start / npm run dev
  - **pnpm**: pnpm build / pnpm start / pnpm dev
  - **cargo**: cargo build / cargo run
  - **custom**: Empty (user-defined)
- **getPreset(type)**: Retrieves preset for project type
- **getEffectiveCommand(project, command)**: Returns user-defined or preset command for build/run/dev operations

#### Config I/O (parser.ts)
- **validateConfig(raw)**: Zod validation returning Result<DevHubConfig, ZodError>
- **readConfig(filePath)**: Parse TOML file with validation
  - Throws ConfigParseError on file read, TOML parse, or schema validation failure
  - Resolves relative project paths to absolute at runtime
- **writeConfig(filePath, config)**: Atomic write (temp file + rename)
  - Converts absolute paths back to relative in output TOML
  - Omits optional fields if undefined
- **ConfigParseError**: Custom error with cause chain for debugging
- **Result<T, E>**: Discriminated union type for validation results

#### Config Discovery (finder.ts)
- **findConfigFile(startDir)**: Walk-up algorithm from startDir to filesystem root
  - Stops at home directory to avoid system scans
  - Returns null if not found (not an error)
- **loadWorkspaceConfig(startDir)**: Convenience wrapper (find + read)
  - Throws ConfigNotFoundError if config not located
- **CONFIG_FILENAME**: Constant "dev-hub.toml"
- **ConfigNotFoundError**: Custom error for missing config

#### Project Discovery (discovery.ts)
- **detectProjectType(projectDir)**: Marker-file detection with priority order
  - Order: cargo → maven → gradle → pnpm → npm (first match wins)
  - Fallback: npm if package.json exists
  - Returns null if no recognized markers found
- **discoverProjects(rootDir)**: Scan directory for projects
  - Filters out hidden dirs (.*) and node_modules
  - Concurrently detects types and checks for .git directory
  - Returns DiscoveredProject array (name, path, type, isGitRepo)
- **DiscoveredProject**: Interface with git repo detection flag

#### File Utilities (utils/fs.ts)
- **fileExists(path)**: Async wrapper around fs.access() for path existence checks

## Key Files Reference

| File | Purpose |
|------|---------|
| packages/core/src/index.ts | VERSION + config module export |
| packages/core/src/config/schema.ts | Zod schemas for config validation |
| packages/core/src/config/presets.ts | Build presets for each project type |
| packages/core/src/config/parser.ts | TOML read/write + validation |
| packages/core/src/config/finder.ts | Walk-up config file discovery |
| packages/core/src/config/discovery.ts | Project type detection + directory scan |
| packages/core/src/config/index.ts | Config module barrel exports |
| packages/core/src/utils/fs.ts | Shared fileExists utility |
| packages/cli/src/index.ts | Commander CLI bootstrap |
| packages/server/src/index.ts | Hono API server + conditional startup |
| packages/web/src/main.tsx | React entry point |
| package.json | Root workspace config (Node 20+, pnpm 9+) |
| tsconfig.base.json | Base TS compiler options |
| eslint.config.js | ESLint flat config (TS support) |
| .prettierrc | Code formatter settings |
| pnpm-workspace.yaml | Workspace package filter |
| dev-hub.toml | Example workspace configuration |

## Testing Coverage (Phase 02)

Five test files with 43 tests covering:
- **schema.test.ts**: Schema validation, type inference, unique name constraint
- **presets.test.ts**: Preset retrieval, effective command resolution
- **finder.test.ts**: Walk-up directory traversal, home directory boundary
- **parser.test.ts**: TOML read/write, validation errors, path resolution
- **discovery.test.ts**: Project type detection, directory scanning, git detection

## Next Steps (Phase 03+)

- Implement core git operations (clone, pull, worktree management)
- Add CLI subcommands (init, add, build, run) with config integration
- Build server API routes for workspace management and config endpoints
- Develop web dashboard components and state management
- Add real-time project discovery and status monitoring
