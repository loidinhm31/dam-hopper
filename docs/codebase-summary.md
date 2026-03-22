# Dev-Hub Codebase Summary

**Phase 01: Project Setup** — Complete
**Phase 02: Core: Config & Discovery** — Complete
**Phase 03: Core: Git Operations** — Complete
**Phase 04: Core: Build & Run** — Complete
**Phase 05: CLI: Commands & Components** — Complete
  - **Phase 03 (Config Enhancement): CLI Service-Aware Updates** — Complete
**Phase 06: Server API** — Complete
**Phase 07: Web Dashboard** — Complete
**Phase 08: Integration & Testing** — Complete (152 tests, 23 test files)

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

| Component       | Technology          | Version      | Notes                           |
| --------------- | ------------------- | ------------ | ------------------------------- |
| Runtime         | Node.js             | 20+ LTS      | Server & CLI execution          |
| Language        | TypeScript          | 5.7.x        | Strict mode across all packages |
| Package Manager | pnpm                | 9.x          | Workspaces support              |
| **CLI**         | Commander           | 12.x         | Subcommand framework            |
| **CLI UI**      | Ink + React         | 5.x / 18.3.x | Terminal UI                     |
| **Server**      | Hono                | 4.7.x        | Lightweight HTTP API (14KB)     |
| **Web**         | React + Vite        | 19.x / 6.x   | Full dashboard implementation   |
| **Web Routing** | React Router        | 7.x          | Client-side navigation          |
| **Web Icons**   | Lucide React        | 0.577.x      | Icon library (30+ icons)        |
| **Styling**     | Tailwind CSS        | 4.x          | v4 with Vite plugin             |
| **State**       | TanStack Query      | 5.67.x       | Server state + SSE              |
| **Build**       | tsup                | 8.x          | Fast bundler for packages       |
| **Linting**     | ESLint + TypeScript | 9.x / 8.x    | Flat config                     |
| **Format**      | Prettier            | 3.x          | Opinionated formatting          |

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
- **ServiceConfigSchema**: Service-level build/run configuration
  - Fields: name (required), buildCommand (optional), runCommand (optional)
  - Parsed from snake_case TOML (build_command, run_command)
  - Converts to camelCase at runtime
- **ServiceConfig**: Runtime type with name, buildCommand, runCommand fields
- **ProjectConfig**: Runtime representation with camelCase fields (name, path, type, services, commands, envFile, tags)
  - BREAKING CHANGE: buildCommand/runCommand removed; use services array instead
  - Parsed from snake_case TOML format (env_file, build_command/run_command now nested in services)
  - services: Optional array of ServiceConfig objects
  - commands: Optional map of custom command overrides (e.g., "lint": "eslint .")
  - Validates non-empty project names
  - Enforces unique service names within each project via Zod refine
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
  - **custom**: Empty strings (undefined after conversion) for user-defined only
- **getPreset(type)**: Retrieves preset for project type
- **getProjectServices(project)**: NEW — Returns project services with preset fallback
  - Returns explicit services if defined and non-empty
  - Falls back to synthetic "default" service with preset commands
  - For custom type: returns ["default"] with undefined buildCommand/runCommand so callers can check !command
- **getEffectiveCommand(project, command)**: Returns command for build/run/dev operations
  - build/run: Resolved from first service (user-defined or preset fallback) via getProjectServices()
  - dev: Always from preset — services do not define devCommand in this version
  - Returns empty string if no command defined

#### Config I/O (parser.ts)

- **validateConfig(raw)**: Zod validation returning Result<DevHubConfig, ZodError>
- **readConfig(filePath)**: Parse TOML file with validation
  - Throws ConfigParseError on file read, TOML parse, or schema validation failure
  - Resolves relative project paths to absolute at runtime
- **writeConfig(filePath, config)**: Atomic write (temp file + rename)
  - Converts absolute paths back to relative in output TOML
  - Serializes services array with snake_case fields (build_command, run_command)
  - Serializes commands record as-is
  - Omits optional fields if undefined
- **ConfigParseError**: Custom error with cause chain for debugging
- **Result<T, E>**: Discriminated union type for validation results

#### Config System Enhancement: Services & Commands (Phase Update)

- **ServiceConfig** now exported from schema.ts (available as @dev-hub/core export)
- **BREAKING CHANGE**: ProjectConfig no longer includes buildCommand/runCommand fields
  - Projects without explicit services fall back to synthetic "default" service from type preset
  - Consumers must call getProjectServices() or getEffectiveCommand() instead of direct property access
  - Custom type projects return undefined for buildCommand/runCommand in fallback service
- **Design decision**: dev command always from preset (services don't define devCommand)

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
  - Filters out hidden dirs (.\*) and node_modules
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

#### Build Operations (build-service.ts)

- **BuildResult**: Success flag, output, duration, exit code, optional `serviceName`
- **BuildProgressEvent**: Real-time progress with optional `serviceName` context
- **BuildService**:
  - **build(project, workspaceRoot, serviceName?)**: Build a service (or first default)
    - Emits BuildProgressEvent for each phase: started/output/completed/failed
    - Never throws — errors captured in BuildResult
  - **buildAll(project, workspaceRoot)**: Build all services within a project concurrently
    - Services are independent; parallel execution is intentional
  - **buildMultiple(projects, workspaceRoot, concurrency?)**: Build across multiple projects
    - Cross-project concurrency controlled via p-limit (default: 4)

#### Process Management (run-service.ts)

- **RunningProcess**: Process state with optional `serviceName`, pid, status (running|stopped|crashed)
- **RunProgressEvent**: Real-time progress with optional `serviceName` context
- **RunService**:
  - **start(project, workspaceRoot, serviceName?)**: Start a service (or first default)
  - **startAll(project, workspaceRoot)**: Start all services concurrently
  - **stop(projectName, serviceName?)**: Stop one service or all for project
  - **restart(projectName, serviceName?)**: Stop and restart a service
  - **getProcess(projectName, serviceName?)**: Get process state (or first running)
  - **getProcessesForProject(projectName)**: Get all running services for a project
  - **getAllProcesses()**: Get all running processes system-wide
  - **getLogs(projectName, lines?)**: Get logs for first service
  - **getServiceLogs(projectName, serviceName, lines?)**: Get logs for specific service
  - **stopAll()**: Stop all running processes
  - Processes keyed internally as `projectName:serviceName` for multi-service projects

#### Custom Commands (command-service.ts)

- **CommandService**:
  - **execute(project, commandName, workspaceRoot)**: Execute named custom command
    - Looks up command in `project.commands[commandName]`
    - Emits BuildProgressEvent (reuses same event type)
    - Never throws — errors captured in BuildResult

#### Streaming Utilities (stream-utils.ts)

- **pipeLines(stream, onLine)**: Shared line-splitter for stdout/stderr
  - Splits chunks on newlines, buffers partial lines
  - Flushes remaining partial on stream end

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

#### Testing (src/**tests**/)

- **help.test.ts**: CLI help text and command discovery
- **workspace.test.ts**: Config loading and project resolution
- **format.test.ts**: Color and formatting utilities

### Phase 03 (Config Enhancement): CLI Service-Aware Updates

**@dev-hub/cli** commands updated to support multi-service projects and custom commands:

#### Enhanced build Command

- **--service <name>** flag to build specific service
- Single project without --service: builds all services via buildAll()
- Calls getProjectServices() to determine available services
- Service names shown in progress output via serviceLabel() helper

#### Enhanced run Command

- **--service <name>** flag to start specific service
- Single project without --service: starts all services concurrently
- **MultiRunner** component (new Ink) manages multiple services
  - Each service displays independently with status (starting/running/stopped/crashed)
  - Output limited to last 9 lines per service to avoid terminal bloat
  - Auto-exit when all services terminate
- Single-service path uses existing **Runner** component

#### New exec Command

- **exec <project> [command-name]**: Execute custom command from project config
  - Looks up command in `project.commands[commandName]`
  - Reuses BuildOutput component for command output streaming
- **--list** flag: Display available custom commands for project
  - Shows command name and shell command side-by-side

#### Build Progress Bridge (utils/buildProgress.ts)

- **bridgeBuildToGitEmitter()**: Adapts BuildProgressEvent to GitProgressEmitter
  - Maps started/completed/failed phases to ProgressList-compatible events
  - Applies service labeling for display
- **serviceLabel()**: Format (projectName, serviceName) as display string
  - Omits "default" service label to keep output clean

#### Command Registration

- **index.ts**: registerExec() added to top-level commands

### Phase 06: Server API

**@dev-hub/server** now includes complete HTTP API with Hono, SSE streaming, and type-safe RPC export:

#### Server Context (services/context.ts)

- **ServerContext**: Factory function returning shared state container
  - **bulkGitService**: BulkGitService for concurrent git operations
  - **buildService**: BuildService for project builds with service targeting
  - **runService**: RunService for long-running processes
  - **commandService**: CommandService for arbitrary command execution
  - **sseClients**: Set tracking active SSE connections for real-time events
- **SSE Event Types**: git:progress, build:progress, command:progress, process:event, status:changed, config:changed, heartbeat
- Emitter wiring: Each service's progress emitter broadcasts to SSE clients
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

- **POST /api/build/:project**: Trigger build with optional service targeting
  - Body: { service?: string } (optional service name for multi-service projects)
  - Returns BuildResult[] (single-element array if service specified, all services otherwise)
  - **409 Conflict** if build already in progress for project or specific service
  - Tracks per-project or per-project:service concurrency
  - 404 if project not found

#### Processes API Routes (routes/processes.ts)

- **GET /api/processes**: List all active process sessions
  - Returns ProcessSession[] array (id, projectName, command, startTime, status)
- **POST /api/run/:project**: Start long-running process
  - Body: { service?: string } (optional service name for multi-service projects)
  - Returns ProcessSession object
  - 409 Conflict if process already running for project/service
  - 404 if project not found
- **DELETE /api/run/:project**: Stop process
  - Query: ?service={name} (optional service name)
  - Returns 204 No Content
  - 404 if project not found
- **POST /api/run/:project/restart**: Restart process
  - Body: { service?: string }
  - Returns ProcessSession object (new session)
  - 404 if project not found
- **GET /api/run/:project/logs**: Get process logs
  - Query: ?service={name}&lines={n} (service optional, lines defaults to 100)
  - Returns string array of log lines
  - 404 if project not found
- **POST /api/exec/:project**: Execute arbitrary command and return result
  - Body: { command: string } (required)
  - Returns CommandResult object
  - 400 Bad Request if command field missing
  - 404 if project not found

#### Events API (routes/events.ts)

- **GET /api/events**: SSE endpoint for real-time progress events
  - Streams multiple event types: git:progress, build:progress, command:progress, process:event, status:changed, config:changed, heartbeat
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

#### Testing (src/**tests**/)

27 tests covering:

- **workspace.test.ts**: GET /api/workspace, /api/projects, /api/projects/:name, status caching
- **git.test.ts**: Fetch, pull, worktrees, branches endpoints with GitError mapping
- **build.test.ts**: Build endpoint with 409 concurrency conflict, inProgressBuilds cleanup
- **processes.test.ts**: Process lifecycle (start, logs, stop, restart)
- **events.test.ts**: SSE stream, heartbeat, client connection management
- **error-handler.test.ts**: Error mapping and HTTP status code response
- **app.test.ts**: App setup, route mounting, static file serving, AppType export

## Key Files Reference

| File                                                   | Purpose                                                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| packages/core/src/index.ts                             | VERSION + config + git + build module exports                                                   |
| packages/core/src/config/schema.ts                     | Zod schemas for config validation                                                               |
| packages/core/src/config/presets.ts                    | Build presets for each project type                                                             |
| packages/core/src/config/parser.ts                     | TOML read/write + validation                                                                    |
| packages/core/src/config/finder.ts                     | Walk-up config file discovery                                                                   |
| packages/core/src/config/discovery.ts                  | Project type detection + directory scan                                                         |
| packages/core/src/config/index.ts                      | Config module barrel exports                                                                    |
| packages/core/src/git/types.ts                         | Git operation interfaces and enums                                                              |
| packages/core/src/git/errors.ts                        | GitError wrapper + error handling                                                               |
| packages/core/src/git/progress.ts                      | GitProgressEmitter + event utilities                                                            |
| packages/core/src/git/status.ts                        | getStatus branch/file queries                                                                   |
| packages/core/src/git/operations.ts                    | gitFetch, gitPull, gitPush implementations                                                      |
| packages/core/src/git/worktree.ts                      | Worktree CRUD operations                                                                        |
| packages/core/src/git/branch.ts                        | Branch listing and update operations                                                            |
| packages/core/src/git/bulk.ts                          | BulkGitService concurrent operations                                                            |
| packages/core/src/git/index.ts                         | Git module barrel exports                                                                       |
| packages/core/src/build/build.ts                       | buildProject command execution                                                                  |
| packages/core/src/build/process.ts                     | ProcessManager for long-running commands                                                        |
| packages/core/src/utils/fs.ts                          | Shared fileExists utility                                                                       |
| packages/cli/src/index.ts                              | Commander CLI bootstrap + command wiring                                                        |
| packages/cli/src/utils/workspace.ts                    | loadWorkspace, resolveProjects helpers                                                          |
| packages/cli/src/utils/format.ts                       | Color helpers + formatting utilities                                                            |
| packages/cli/src/commands/init.ts                      | Interactive workspace initialization                                                            |
| packages/cli/src/commands/status.ts                    | Git status table display                                                                        |
| packages/cli/src/commands/build.ts                     | Build single/all projects                                                                       |
| packages/cli/src/commands/run.tsx                      | Run/stop/logs with Ink components                                                               |
| packages/cli/src/commands/ui.ts                        | Start server + open dashboard                                                                   |
| packages/cli/src/commands/git/\*.ts                    | fetch, pull, push, worktree, branch                                                             |
| packages/cli/src/components/\*.tsx                     | StatusTable, ProgressList, BuildOutput, LogViewer                                               |
| packages/cli/src/**tests**/\*.ts                       | help, workspace, format unit tests                                                              |
| packages/server/src/index.ts                           | startServer + graceful shutdown                                                                 |
| packages/server/src/app.ts                             | Hono app setup with onError, routes, static serving, AppType export                             |
| packages/server/src/services/context.ts                | ServerContext factory (emitter, SSE clients, caches)                                            |
| packages/server/src/middleware/error-handler.ts        | Error type mapping and HTTP status codes                                                        |
| packages/server/src/routes/workspace.ts                | GET /api/workspace, /api/projects, /api/projects/:name, /api/projects/:name/status              |
| packages/server/src/routes/git.ts                      | POST/GET/DELETE /api/git/{fetch,pull,worktrees,branches}                                        |
| packages/server/src/routes/build.ts                    | POST /api/build/:project with 409 concurrency conflict                                          |
| packages/server/src/routes/processes.ts                | Process lifecycle routes + new POST /api/exec/:project for arbitrary command execution           |
| packages/server/src/routes/events.ts                   | GET /api/events SSE endpoint with heartbeat                                                     |
| packages/server/src/**tests**/\*.ts                    | workspace, git, build, processes, events, error-handler, app tests                              |
| packages/web/src/main.tsx                              | React entry point with QueryClient setup                                                        |
| packages/web/src/App.tsx                               | BrowserRouter + route definitions                                                               |
| packages/web/src/index.css                             | Dark theme CSS variables and Tailwind v4 setup                                                  |
| packages/web/src/api/client.ts                         | Typed fetch API client with namespaced endpoints                                                |
| packages/web/src/api/queries.ts                        | TanStack Query hooks for all API endpoints                                                      |
| packages/web/src/hooks/useSSE.ts                       | EventSource connection with auto-reconnect and query invalidation                               |
| packages/web/src/hooks/useSSEEvents.ts                 | Per-event-type SSE subscription hook                                                            |
| packages/web/src/lib/utils.ts                          | cn() merger, formatDuration, timeAgo helpers                                                    |
| packages/web/src/components/atoms/\*.tsx               | Badge, Button, BranchBadge, GitStatusBadge, ConnectionDot                                       |
| packages/web/src/components/molecules/OverviewCard.tsx | Project status overview card                                                                    |
| packages/web/src/components/organisms/\*.tsx           | Sidebar, BuildLog, ProgressList                                                                 |
| packages/web/src/components/templates/AppLayout.tsx    | Page layout wrapper with sidebar                                                                |
| packages/web/src/pages/\*.tsx                          | DashboardPage, ProjectsPage, ProjectDetailPage, GitPage, BuildPage, ProcessesPage, SettingsPage |
| packages/web/tsconfig.json                             | TypeScript config with @/\* path alias                                                          |
| package.json                                           | Root workspace config (Node 20+, pnpm 9+)                                                       |
| tsconfig.base.json                                     | Base TS compiler options                                                                        |
| eslint.config.js                                       | ESLint flat config (TS support)                                                                 |
| .prettierrc                                            | Code formatter settings                                                                         |
| pnpm-workspace.yaml                                    | Workspace package filter                                                                        |
| dev-hub.toml                                           | Example workspace configuration                                                                 |

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

### Phase 07 (Web Dashboard)

No tests yet. Future test coverage should include:

- **components/\*.test.tsx**: Atom/molecule/organism snapshot and interaction tests
- **hooks/\*.test.ts**: useSSE reconnect, useSSEEvents subscriptions, custom hook behavior
- **pages/\*.test.tsx**: Page rendering, navigation, data loading
- **api/queries.test.ts**: Query hook behavior with TanStack Query testing utilities
- **api/client.test.ts**: API client request/response handling and error cases

### Phase 07: Web Dashboard

**@dev-hub/web** now includes a fully functional React 19 dashboard with routing, state management, components, and real-time updates:

#### Configuration & Setup (main.tsx)

- **QueryClient**: TanStack Query with 10-second staleTime and 1-retry defaults
- **QueryClientProvider**: Wraps App for global query caching
- **Root DOM mount**: Strict mode for development warnings

#### Routing (App.tsx)

- **BrowserRouter + Routes**: React Router v7 navigation
- **Route mappings**:
  - `/` → DashboardPage (overview + project status)
  - `/projects` → ProjectsPage (project listing + filters)
  - `/projects/:name` → ProjectDetailPage (individual project details)
  - `/git` → GitPage (fetch/pull/push, worktree, branch operations)
  - `/build` → BuildPage (build command execution + logs)
  - `/processes` → ProcessesPage (running process management)
  - `/settings` → SettingsPage (workspace configuration)

#### API Client (api/client.ts)

- **Typed interfaces**: ProjectType, ProjectConfig, GitStatus, Worktree, Branch, BuildResult, ProcessInfo, GitOpResult
- **Fetch-based HTTP client**: GET, POST, DELETE methods with error handling
- **Base path**: `/api` with URL-encoded project names for special characters
- **API object**: Namespace-organized endpoints (workspace, projects, git, build, processes)
  - Projects: list, get, status (fresh)
  - Git: fetch, pull, push, worktrees (CRUD), branches (list + update)
  - Build: start command
  - Processes: list, start, stop, restart, logs

#### State Management (api/queries.ts)

- **Query hooks**: useWorkspace, useProjects, useProject, useProjectStatus, useWorktrees, useBranches, useProcesses, useProcessLogs
- **Refetch intervals**: Projects (30s), Processes (5s), Process logs (3s)
- **Mutation hooks**: useGitFetch, useGitPull, useGitPush, useBuildStart, useProcessStart, useProcessStop, useProcessRestart
- **Auto-invalidation**: On mutation success, related queries re-fetch

#### Real-time Updates (hooks/useSSE.ts)

- **EventSource connection**: Connects to `/api/events` on mount
- **Event subscription system**: Global listener map for event type dispatch
- **Auto-reconnect**: Exponential backoff (1s → 30s max) on connection failure
- **Event types**: git:progress, build:progress, process:event, status:changed
- **Query invalidation**: Automatic cache invalidation on status:changed and process:event
- **Timer cleanup**: Cancels pending retry timers on unmount (memory leak fix)

#### Per-Event Subscriptions (hooks/useSSEEvents.ts)

- **useSSEEvents(type)**: Subscribe to specific event type with callback
- **Manual unsubscribe**: Returned cleanup function removes listener

#### Utilities (lib/utils.ts)

- **cn()**: Tailwind class merging (clsx + tailwind-merge)
- **formatDuration()**: Convert milliseconds to human-readable (1.5s, 2m 30s, etc)
- **timeAgo()**: Relative timestamps (2 minutes ago, just now)

#### Component Library

**Atoms** (reusable single-purpose components):

- **Badge.tsx**: Generic badge with color variants (default, success, error, warning, info)
- **Button.tsx**: Interactive button with size/variant props, loading state
- **BranchBadge.tsx**: Display branch name with icon and styling
- **GitStatusBadge.tsx**: Show git status (clean, dirty, ahead/behind)
- **ConnectionDot.tsx**: Visual indicator for SSE connection status (green/red)

**Molecules** (multi-atom compositions):

- **OverviewCard.tsx**: Dashboard card showing project overview (status, branch, last commit)

**Organisms** (feature-complete sections):

- **Sidebar.tsx**: Navigation menu with routes and active link highlighting
- **ProgressList.tsx**: Display concurrent operation progress bars (from CLI, adapted for web)
- **BuildLog.tsx**: Real-time build output streaming with scrolling

**Templates** (page-level layouts):

- **AppLayout.tsx**: Header + sidebar + main content wrapper with responsive grid

#### Page Components (pages/)

- **DashboardPage.tsx**: Overview dashboard with workspace info and project summary
- **ProjectsPage.tsx**: Full project listing with filtering and status
- **ProjectDetailPage.tsx**: Individual project view with git/build operations
- **GitPage.tsx**: Git operations hub (fetch/pull/push, worktrees, branches)
- **BuildPage.tsx**: Build command execution interface with live output
- **ProcessesPage.tsx**: Active process management (start/stop/restart/logs)
- **SettingsPage.tsx**: Workspace and user settings

#### Styling (index.css)

- **Dark theme**: CSS variables for colors (neutral, slate, brand colors)
- **Tailwind v4**: @-rules for utilities and components
- **Base styles**: Typography, spacing, transitions
- **Custom utilities**: Animation classes, grid layouts

#### Dependencies

- **react-router-dom@7.13.1**: Client-side routing with v7 API
- **@tanstack/react-query@5.67.0**: Server state management and caching
- **lucide-react@0.577.0**: Icon library (30+ icons for UI)
- **clsx@2.1.1**: Conditional class name utility
- **tailwind-merge@3.5.0**: Smart class merging for Tailwind conflicts
- **tailwindcss@4.0.0**: CSS framework with v4 features
- **@tailwindcss/vite@4.0.0**: Tailwind integration for Vite

#### TSConfig (tsconfig.json)

- **Path alias**: `@/*` → `src/*` for clean imports
- Extends base config (strict: true, ES2022, bundler resolution)

### Phase 08: Integration & Testing

Comprehensive test infrastructure with 152 passing tests across 23 test files, covering all packages and a full end-to-end stack test.

#### Test Infrastructure

**Vitest Workspace Configuration** (vitest.workspace.ts):

- Root workspace runner config: `export default ["packages/*/vitest.config.ts"];`
- Per-package vitest configs (core, cli, server):
  - Core: `environment: "node"`, `testTimeout: 30000` (git operations can be slow), `include: ["src/**/*.test.ts"]`
  - CLI: Same as core, includes Ink component testing setup
  - Server: Node environment, includes Hono route testing
- Web package: `environment: "jsdom"`, uses React Testing Library

**Test Files by Package**:

- **@dev-hub/core** (100 tests across 10 files):
  - `src/config/__tests__/`: schema.test.ts, parser.test.ts, discovery.test.ts, presets.test.ts, finder.test.ts
  - `src/git/__tests__/`: errors.test.ts, status.test.ts, operations.test.ts, worktree.test.ts, branch.test.ts, bulk.test.ts
  - `src/build/__tests__/`: build-service.test.ts, run-service.test.ts, env-loader.test.ts, log-buffer.test.ts
- **@dev-hub/cli** (14 tests across 3 files):
  - `src/__tests__/`: commands.test.ts, init.test.ts, status.test.ts
- **@dev-hub/server** (27 tests across 7 files):
  - `src/__tests__/`: workspace.test.ts, git.test.ts, build.test.ts, processes.test.ts, events.test.ts, error-handler.test.ts, app.test.ts
- **@dev-hub/web**: Framework in place for React component tests (jsdom environment ready)
- **Root E2E** (7 tests in 1 file):
  - `__tests__/e2e.test.ts`: Full stack testing (server startup, dashboard load, operations)

#### Test Utilities & Fixtures

**Test Utilities** (packages/core/src/**test-utils**/):

- **git-helpers.ts**:
  - `createTempGitRepo(options)`: Creates temp git repository with optional commits and branches
  - `createBareRemote()`: Creates bare git repository for remote testing
  - `createCloneWithRemote()`: Creates cloned repo with configured remote
- **workspace-helpers.ts**:
  - `createTempWorkspace(projects)`: Creates temp dev-hub.toml with marker files for project type detection

**Fixtures Directory** (**fixtures**/workspace/):

- **dev-hub.toml**: Workspace config with 3 projects (maven, pnpm, cargo)
- **maven-project/**: pom.xml marker file
- **pnpm-project/**: package.json + pnpm-lock.yaml
- **cargo-project/**: Cargo.toml marker file
- All fixtures use minimal valid configuration for fast test execution

#### Test Coverage by Area

**Config & Discovery Tests**:

- Schema validation: valid/invalid TOML, type constraints, unique names
- Parser: read/write, round-trip fidelity, path resolution, error handling
- Discovery: Project type detection, directory scanning, git repo detection
- Finder: Walk-up directory traversal, home directory boundary
- Presets: Build command defaults, effective command resolution

**Git Operation Tests** (integration with real temp repos):

- Status: Branch detection, file counting, ahead/behind calculation
- Operations: Fetch/pull/push with success/failure paths
- Worktrees: Add/list/remove/lock operations
- Branches: List, update with merge/rebase/fast-forward strategies
- Bulk operations: Concurrent fetch/pull across multiple projects with concurrency limit (default: 4), progress event aggregation

**Build & Process Tests** (integration):

- Env loader: .env file parsing with various formats
- Log buffer: Circular buffer eviction, retrieval, clearing
- Build service: Successful/failed builds, command execution, output capture
- Run service: Process lifecycle (start/stop/restart), log streaming, status tracking

**API Endpoint Tests** (using Hono's app.request() helper):

- Workspace routes: GET /api/workspace, /api/projects, /api/projects/:name, /api/projects/:name/status
- Git routes: POST /api/git/fetch, /api/git/pull, /api/git/branches/:project, worktree CRUD
- Build routes: POST /api/build/:project with concurrency conflict handling (409)
- Process routes: Lifecycle management (start, logs, stop, restart)
- Events routes: SSE endpoint with 30-second heartbeat
- Error handler: GitError category mapping to HTTP status codes

**E2E Test** (**tests**/e2e.test.ts):

- Creates temp workspace with pnpm project
- Initializes git repos with commits
- Starts server programmatically
- Verifies dashboard HTML serving
- Tests API project listing
- Triggers and validates build execution
- Confirms clean server shutdown
- 60-second timeout for full stack operations

#### CI/CD Integration

**Root package.json scripts**:

- `"test"`: Vitest watch mode (development)
- `"test:run"`: Vitest run mode (CI, single pass)
- `"test:coverage"`: Coverage report with @vitest/coverage-v8
- `"check"`: Full CI check (pnpm build && pnpm lint && pnpm test:run)

**CI Requirements**:

- Node.js 20+ LTS
- pnpm 9.x
- git (pre-installed in most CI environments)
- All tests pass in clean environment without manual setup

#### Test Quality Metrics

- **Total test count**: 152 passing tests
- **Test files**: 23 files (10 core, 3 cli, 7 server, 1 e2e, 2 web framework ready)
- **Execution time**: Under 60 seconds for full test suite
- **Coverage focus**: Business logic (core package), API contracts, integration paths
- **No external dependencies**: All git tests use local temp repos, no network access

## Next Steps (Phase 08+)

- Add project discovery UI for finding and adding new projects
- Implement advanced git workflows (rebase, squash, cherry-pick)
- Add build preset customization and command editing in dashboard
- Implement persistent sidebar preferences and dark/light theme toggle
- Add real-time log filtering and search across build/process output
- Implement workspace templates and project scaffolding
- Add multi-workspace support in both CLI and dashboard
- Expand web package component testing (atoms, molecules, organisms)
