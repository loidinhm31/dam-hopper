# Dev-Hub Codebase Summary

**Phase 01: Project Setup** — Complete
**Phase 02: Core: Config & Discovery** — Complete
**Phase 03: Core: Git Operations** — Complete
**Phase 04: Core: Build & Run** — Complete
**Phase 05: CLI: Commands & Components** — Complete
**Phase 06: Server API** — Complete

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

### Phase 03: Git Operations

**@dev-hub/core** now includes comprehensive git operations with real-time progress events:

#### Types & Events (types.ts)
- **GitStatus**: Project git state (branch, ahead/behind, staged/modified/untracked files, stash, last commit)
- **GitOperationResult**: Fetch/pull/push outcome with success flag, summary, error, duration
- **Worktree**: Worktree metadata (path, branch, commit hash, isMain, isLocked)
- **WorktreeAddOptions**: Branch, path, createBranch, baseBranch parameters
- **BranchInfo**: Branch metadata (name, isRemote, isCurrent, tracking, ahead/behind counts)
- **BranchUpdateResult**: Branch update outcome (name, success, reason)
- **GitProgressEvent**: Real-time progress events (projectName, operation, phase, message, percent)

#### Status Queries (status.ts)
- **getStatus(projectPath, projectName)**: Retrieve complete GitStatus for a project
  - Queries branch name, tracking status, commit info, stash presence
  - Counts staged, modified, untracked files
  - Calculates ahead/behind commit counts via git rev-list

#### Core Operations (operations.ts)
- **gitFetch(projectPath, projectName, emitter)**: Fetch all remotes with prune
  - Emits progress events for UI/CLI feedback
  - Returns GitOperationResult with duration
  - Error wrapping via wrapGitError
- **gitPull(projectPath, projectName, emitter)**: Pull current branch with progress tracking
  - Same event emission pattern as fetch
- **gitPush(projectPath, projectName, emitter)**: Push current branch (signature consistent with fetch/pull)

#### Worktree Management (worktree.ts)
- **listWorktrees(projectPath)**: Query all worktrees in repo
  - Returns array of Worktree objects with all metadata
- **addWorktree(projectPath, options)**: Create new worktree
  - Supports createBranch flag for new branch worktrees
  - Optional path and baseBranch parameters
- **removeWorktree(projectPath, worktreePath)**: Delete worktree safely
- **lockWorktree(projectPath, worktreePath, reason)**: Prevent accidental removal
- **unlockWorktree(projectPath, worktreePath)**: Release lock

#### Branch Operations (branch.ts)
- **listBranches(projectPath)**: List all local and remote branches
  - Includes tracking info, ahead/behind counts per branch
- **updateBranch(projectPath, branchName, strategy)**: Update single branch
  - Strategies: merge, rebase, fast-forward
  - Returns BranchUpdateResult
- **updateAllBranches(projectPath, emitter)**: Batch update all branches with progress events
  - Filters out detached HEAD or special branches

#### Error Handling (errors.ts)
- **GitError**: Base error class extending Error with projectName, originalError, cause chain
- **wrapGitError(err, projectName)**: Normalize any error into GitError with context

#### Bulk Operations (bulk.ts)
- **BulkGitService**: Concurrent operations across multiple projects
  - Configurable concurrency (default: 4) via p-limit
  - **fetchAll(projects)**: Fetch across all projects with progress aggregation
  - **pullAll(projects)**: Pull across all projects with progress aggregation
  - **statusAll(projects)**: Query status for all projects concurrently
  - **updateAllBranches(projects)**: Batch branch updates returning Map<projectName, results[]>
  - Progress emitter bubbles up individual and overall completion events

### Phase 04: Build & Run (Core)

**@dev-hub/core** now includes build and process management:

#### Build Operations (build.ts)
- **BuildCommand**: Enum for build, dev, run operations
- **BuildResult**: Success flag, output, duration, exit code
- **buildProject(projectPath, command, emitter)**: Execute build/dev/run commands
  - Returns BuildResult with full output and timing
  - Emits progress events for real-time streaming

#### Process Management (process.ts)
- **ProcessManager**: Stream-based process execution
  - **start(projectPath, command)**: Start long-running process (server, dev)
  - **getLogs(sessionId)**: Retrieve logs for active process
  - **stop(sessionId)**: Terminate process gracefully
  - **getStatus(sessionId)**: Query process state

### Phase 05: CLI Commands & Components

**@dev-hub/cli** now includes full command suite with Ink-based terminal UI:

#### Command Implementations (commands/)
- **init.ts**: Interactive workspace initialization via @clack/prompts
  - Guided project discovery and config generation
- **status.ts**: Display git status for all projects via StatusTable component
- **build.ts**: Build single or all projects with progress streaming
- **run.tsx**: Run/stop/logs commands with live process output (Ink components)
- **ui.ts**: Start @dev-hub/server and open browser automatically
- **git/fetch.ts**: Bulk fetch with concurrent progress bars (ProgressList)
- **git/pull.ts**: Bulk pull with dirty working directory warnings
- **git/push.ts**: Push single project with basic output
- **git/worktree.ts**: Add/list/remove worktrees interactively
- **git/branch.ts**: List and update branches with strategy selection

#### CLI Utilities (utils/)
- **workspace.ts**:
  - **loadWorkspace()**: Load config from current directory
  - **resolveProjects(name?, type?)**: Filter projects by name or type
- **format.ts**:
  - Color helpers: success (green), error (red), warn (yellow), info (cyan)
  - **formatDuration()**: Human-readable duration formatting
  - **printSuccess/Error/Warn()**: Colored console output

#### Ink Components (components/)
- **StatusTable.tsx**: Render git status in table format (project, branch, status, commits)
- **ProgressList.tsx**: Display concurrent progress bars for bulk operations
- **BuildOutput.tsx**: Live-streaming build command output
- **LogViewer.tsx**: Tail and scroll logs from running processes

#### Dependencies
- **chalk**: Colored terminal text
- **open**: Open URLs/files in default browser
- **ink-table**: Terminal table rendering
- **@clack/prompts**: Interactive CLI prompts
- **vitest**: Unit testing framework

#### Testing (src/__tests__/)
- **help.test.ts**: CLI help text and command discovery
- **workspace.test.ts**: Config loading and project resolution
- **format.test.ts**: Color and formatting utilities

### Phase 06: Server API

**@dev-hub/server** now includes complete HTTP API with Hono, SSE streaming, and type-safe RPC export:

#### Server Context (services/context.ts)
- **ServerContext**: Factory function returning shared state container
  - **emitter**: EventEmitter3 for progress events across routes
  - **sseClients**: Set tracking active SSE connections
  - **statusCache**: Per-context cache invalidated on status:changed events
  - **inProgressBuilds**: Per-context map of concurrent builds by project name
- Isolation ensures multiple server instances don't interfere

#### Error Handler (middleware/error-handler.ts)
- **onError**: Hono error handler mapping GitError categories to HTTP status codes
  - GitError with "fetch" operation → 503 Service Unavailable
  - GitError with "merge" operation → 409 Conflict
  - Other GitErrors → 400 Bad Request
  - Uses `err.name === "GitError"` check (ESM module identity safe)
  - Logs errors with cause chain for debugging
  - Returns JSON error response with message and operation context

#### Workspace API Routes (routes/workspace.ts)
- **GET /api/workspace**: Return workspace info (name, root directory)
  - 404 if no config loaded
- **GET /api/projects**: List all projects with cached status
  - Returns array of ProjectWithStatus (config + cached git status)
  - Cache invalidated on status:changed events
- **GET /api/projects/:name**: Get single project details + status
  - 404 if project not found
  - Returns ProjectWithStatus
- **GET /api/projects/:name/status**: Get fresh git status (bypasses cache)
  - Queries via core's getStatus API
  - 404 if project not found

#### Git API Routes (routes/git.ts)
- **POST /api/git/fetch**: Bulk fetch across all projects
  - Streams progress events via SSE connection
  - Returns { success: boolean, duration: number }
- **POST /api/git/pull**: Bulk pull across all projects with dirty check
  - Warns if working directory has uncommitted changes
  - Returns GitOperationResult
- **POST /api/git/worktrees/:project**: Create worktree
  - Body: { branch, baseBranch?, createBranch? }
  - Returns Worktree object
  - 404 if project not found
- **GET /api/git/worktrees/:project**: List worktrees for project
  - Returns Worktree[] array
  - 404 if project not found
- **DELETE /api/git/worktrees/:project**: Remove worktree
  - Query: ?path={worktreePath} (required)
  - 404 if project or worktree not found
- **GET /api/git/branches/:project**: List branches with tracking info
  - Returns BranchInfo[] array
  - 404 if project not found
- **POST /api/git/branches/:project**: Update single branch
  - Body: { name, strategy? } (strategy: merge | rebase | fast-forward)
  - Returns BranchUpdateResult
  - 404 if project not found

#### Build API Routes (routes/build.ts)
- **POST /api/build/:project**: Trigger build with concurrency limit
  - Body: { command } (build | dev | run)
  - Returns { success: boolean, output: string, duration: number }
  - **409 Conflict** if build already in progress for project
  - Removes from inProgressBuilds on completion
  - 404 if project not found

#### Processes API Routes (routes/processes.ts)
- **GET /api/processes**: List all active process sessions
  - Returns ProcessSession[] array (id, projectName, command, startTime, status)
- **POST /api/run/:project**: Start long-running process
  - Body: { command } (run | dev | server)
  - Returns { sessionId: string }
  - 404 if project not found
- **GET /api/run/:project/logs**: Stream logs from active process
  - Query: ?sessionId={id}
  - Streams via SSE text/event-stream
  - 404 if project or session not found
- **DELETE /api/run/:project**: Stop process
  - Query: ?sessionId={id}
  - Returns { success: boolean }
- **POST /api/run/:project/restart**: Restart process
  - Query: ?sessionId={id}
  - Returns { sessionId: string } (new session)

#### Events API (routes/events.ts)
- **GET /api/events**: SSE endpoint for real-time progress events
  - Streams GitProgressEvent objects as event data
  - Includes 30-second heartbeat to keep connection alive
  - Accepts Accept: text/event-stream header
  - Promise resolves on stream.onAbort() (client disconnect)
  - Manages SSE client set (add on connect, remove on disconnect)

#### App Setup (app.ts)
- **Hono app**: All routes mounted with middleware
  - **onError handler**: Global error catching (Hono v4 requirement)
  - Routes: workspace, git, build, processes, events
  - Static file serving: Pre-built web dashboard from dist/
  - **AppType export**: For type-safe Hono RPC client in web package
- Clean middleware composition with error context propagation

#### Server Startup (index.ts)
- **startServer(configPath?)**: Bootstrap Hono server
  - Loads workspace config from path or discovery
  - Creates shared ServerContext
  - Listens on port 4800 (NODE_PORT env override)
  - Returns Hono app instance
- **Graceful shutdown**: SIGINT/SIGTERM handlers
  - Closes all SSE connections
  - Stops all active processes
  - Allows 5-second grace period
  - Exits with code 0

#### Testing (src/__tests__/)
27 tests covering:
- **workspace.test.ts**: GET /api/workspace, /api/projects, /api/projects/:name, status caching
- **git.test.ts**: Fetch, pull, worktrees, branches endpoints with GitError mapping
- **build.test.ts**: Build endpoint with 409 concurrency conflict, inProgressBuilds cleanup
- **processes.test.ts**: Process lifecycle (start, logs, stop, restart)
- **events.test.ts**: SSE stream, heartbeat, client connection management
- **error-handler.test.ts**: Error mapping and HTTP status code response
- **app.test.ts**: App setup, route mounting, static file serving, AppType export

## Key Files Reference

| File | Purpose |
|------|---------|
| packages/core/src/index.ts | VERSION + config + git + build module exports |
| packages/core/src/config/schema.ts | Zod schemas for config validation |
| packages/core/src/config/presets.ts | Build presets for each project type |
| packages/core/src/config/parser.ts | TOML read/write + validation |
| packages/core/src/config/finder.ts | Walk-up config file discovery |
| packages/core/src/config/discovery.ts | Project type detection + directory scan |
| packages/core/src/config/index.ts | Config module barrel exports |
| packages/core/src/git/types.ts | Git operation interfaces and enums |
| packages/core/src/git/errors.ts | GitError wrapper + error handling |
| packages/core/src/git/progress.ts | GitProgressEmitter + event utilities |
| packages/core/src/git/status.ts | getStatus branch/file queries |
| packages/core/src/git/operations.ts | gitFetch, gitPull, gitPush implementations |
| packages/core/src/git/worktree.ts | Worktree CRUD operations |
| packages/core/src/git/branch.ts | Branch listing and update operations |
| packages/core/src/git/bulk.ts | BulkGitService concurrent operations |
| packages/core/src/git/index.ts | Git module barrel exports |
| packages/core/src/build/build.ts | buildProject command execution |
| packages/core/src/build/process.ts | ProcessManager for long-running commands |
| packages/core/src/utils/fs.ts | Shared fileExists utility |
| packages/cli/src/index.ts | Commander CLI bootstrap + command wiring |
| packages/cli/src/utils/workspace.ts | loadWorkspace, resolveProjects helpers |
| packages/cli/src/utils/format.ts | Color helpers + formatting utilities |
| packages/cli/src/commands/init.ts | Interactive workspace initialization |
| packages/cli/src/commands/status.ts | Git status table display |
| packages/cli/src/commands/build.ts | Build single/all projects |
| packages/cli/src/commands/run.tsx | Run/stop/logs with Ink components |
| packages/cli/src/commands/ui.ts | Start server + open dashboard |
| packages/cli/src/commands/git/*.ts | fetch, pull, push, worktree, branch |
| packages/cli/src/components/*.tsx | StatusTable, ProgressList, BuildOutput, LogViewer |
| packages/cli/src/__tests__/*.ts | help, workspace, format unit tests |
| packages/server/src/index.ts | startServer + graceful shutdown |
| packages/server/src/app.ts | Hono app setup with onError, routes, static serving, AppType export |
| packages/server/src/services/context.ts | ServerContext factory (emitter, SSE clients, caches) |
| packages/server/src/middleware/error-handler.ts | Error type mapping and HTTP status codes |
| packages/server/src/routes/workspace.ts | GET /api/workspace, /api/projects, /api/projects/:name, /api/projects/:name/status |
| packages/server/src/routes/git.ts | POST/GET/DELETE /api/git/{fetch,pull,worktrees,branches} |
| packages/server/src/routes/build.ts | POST /api/build/:project with 409 concurrency conflict |
| packages/server/src/routes/processes.ts | GET /api/processes, POST/DELETE/POST-restart /api/run/:project |
| packages/server/src/routes/events.ts | GET /api/events SSE endpoint with heartbeat |
| packages/server/src/__tests__/*.ts | workspace, git, build, processes, events, error-handler, app tests |
| packages/web/src/main.tsx | React entry point |
| package.json | Root workspace config (Node 20+, pnpm 9+) |
| tsconfig.base.json | Base TS compiler options |
| eslint.config.js | ESLint flat config (TS support) |
| .prettierrc | Code formatter settings |
| pnpm-workspace.yaml | Workspace package filter |
| dev-hub.toml | Example workspace configuration |

## Testing Coverage

### Phase 02 (Config & Discovery)
Five test files with 43 tests covering:
- **schema.test.ts**: Schema validation, type inference, unique name constraint
- **presets.test.ts**: Preset retrieval, effective command resolution
- **finder.test.ts**: Walk-up directory traversal, home directory boundary
- **parser.test.ts**: TOML read/write, validation errors, path resolution
- **discovery.test.ts**: Project type detection, directory scanning, git detection

### Phase 03 (Git Operations)
Three test files covering:
- **errors.test.ts**: Error wrapping and cause chain preservation
- **worktree.test.ts**: Worktree CRUD and lock operations
- **integration.test.ts**: End-to-end git operations (fetch, pull, push, status)

### Phase 05 (CLI Commands & Components)
Three test files covering:
- **help.test.ts**: CLI help text discovery and command parsing
- **workspace.test.ts**: Config loading from filesystem and project filtering
- **format.test.ts**: Color output and duration formatting utilities

### Phase 06 (Server API)
Seven test files with 27 tests covering:
- **workspace.test.ts**: Workspace info endpoint and project listing with status caching
- **git.test.ts**: Git fetch/pull/worktrees/branches endpoints with error type detection
- **build.test.ts**: Build concurrency limit and in-progress tracking
- **processes.test.ts**: Process lifecycle (start, logs, stop, restart)
- **events.test.ts**: SSE stream setup, heartbeat, client connection lifecycle
- **error-handler.test.ts**: GitError category mapping and HTTP status codes
- **app.test.ts**: App initialization, route mounting, static file serving, AppType export

## Next Steps (Phase 07+)

- Develop web dashboard components for project status, git workflows, and builds
- Implement TanStack Query integration in web client for data fetching and caching
- Add web-based project discovery and workspace management UI
- Expand CLI with advanced features (multi-workspace, custom scripts, hooks)
- Add project cloning and remote management capabilities
- Implement background task queue for long-running operations
