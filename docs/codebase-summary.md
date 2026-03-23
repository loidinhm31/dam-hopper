# Dev-Hub Codebase Summary

**Phase 01-04: Core Foundation** — Complete (config, git, build/run)
**Phase 05-08: CLI/Server/Web** — Archived (replaced by Electron)
**Phase 09: Desktop Transition** — Complete

- **Phase 01-03: Electron Shell & IPC Foundation** — Complete
- **Phase 04: Cleanup & Packaging** — Complete (CLI/Server removed, Electron packaging added)

## Project Overview

Dev-Hub is a desktop application for managing multi-project development workspaces. Built with Electron + React (web UI bundled within), it provides workspace and project management with git operations and build/run control.

## Monorepo Structure (3-Package)

```
dev-hub/
├── packages/
│   ├── core/              # @dev-hub/core — business logic (git, config, build, run)
│   ├── electron/          # @dev-hub/electron — Electron main process + IPC API layer
│   └── web/               # @dev-hub/web — React 19 dashboard (bundled in app)
├── electron-builder.yml   # Packaging config (Linux deb/AppImage, Windows nsis/portable)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.js
└── .prettierrc
```

## Tech Stack

| Component       | Technology          | Version    | Notes                            |
| --------------- | ------------------- | ---------- | -------------------------------- |
| **Desktop**     | Electron            | 35.x       | Cross-platform app shell         |
| **IPC**         | Electron IPC        | Built-in   | Main/renderer communication      |
| **Terminal**    | node-pty            | 1.1.x      | PTY process for shell commands   |
| **Runtime**     | Node.js             | 20+ LTS    | Electron embedded runtime        |
| **Language**    | TypeScript          | 5.7.x      | Strict mode across all packages  |
| **Package Mgr** | pnpm                | 9.x        | Workspaces support               |
| **Web**         | React + Vite        | 19.x / 6.x | Full dashboard (bundled in app)  |
| **Web Routing** | React Router        | 7.x        | Client-side navigation           |
| **Web Icons**   | Lucide React        | 0.577.x    | Icon library                     |
| **Styling**     | Tailwind CSS        | 4.x        | v4 with Vite plugin              |
| **State**       | TanStack Query      | 5.67.x     | Client state + IPC               |
| **Packaging**   | electron-builder    | 25.x       | Build installers & distributable |
| **Build**       | tsup                | 8.x        | Fast bundler for packages        |
| **Linting**     | ESLint + TypeScript | 9.x / 8.x  | Flat config                      |
| **Format**      | Prettier            | 3.x        | Opinionated formatting           |

## Architecture

```
Desktop App Flow:
  browser (renderer) → React UI → IPC request → Electron main → @dev-hub/core → git/node-pty
                                                    ↓
                                           IPC response + real-time events
```

App lifecycle: `electron/main.ts` creates BrowserWindow, preload script exposes `window.api` with type-safe IPC handlers. Web (React) communicates via `api.invoke('handler', data)` and listens to events.

## Package Dependencies

- **@dev-hub/core**: eventemitter3, p-limit, simple-git, smol-toml, zod (execa removed)
- **@dev-hub/electron**: electron, node-pty, @dev-hub/core, electron-builder (build-time)
- **@dev-hub/web**: React 19, React DOM, TanStack Query, Vite, Tailwind, TypeScript

## Build & Development

```bash
# Root scripts (pnpm workspaces)
pnpm install              # Install all packages
pnpm build                # Build core, web; prepare Electron
pnpm dev                  # Run dev watch mode (core + web in parallel)

# Packaging
pnpm package              # Build installers (linux + windows)
pnpm package:linux        # Build Linux deb + AppImage
pnpm package:win          # Build Windows NSIS + portable

# Code quality
pnpm lint                 # Lint packages/ directory
pnpm format               # Format with Prettier
```

**core**: tsup bundles business logic. **web**: Vite builds React dashboard (output: `packages/web/dist`). **electron**: Copies web dist into app resources, bundles main process, integrates with electron-builder for packaging. No dev server for Electron; use `pnpm dev` to watch changes.

## Configuration Files

- **pnpm-workspace.yaml**: Defines monorepo structure (`packages/*`)
- **tsconfig.base.json**: Base TypeScript config (ES2022 target, strict mode, declaration maps)
- **eslint.config.js**: Flat config with @typescript-eslint rules
- **.prettierrc**: Semi-colons, double quotes, 2-space tabs, trailing commas
- **electron-builder.yml**: Packaging config (asarUnpack for node-pty, Linux deb/AppImage, Windows nsis/portable)
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

#### Global Configuration (global.ts)

- **GlobalConfig**: Interface for user preferences (`defaults.workspace` path)
- **globalConfigPath()**: Resolve XDG config path (`$XDG_CONFIG_HOME/dev-hub/config.toml` or `~/.config/dev-hub/config.toml`)
- **readGlobalConfig()**: Read and parse global config, returns null if missing (no error)
  - Gracefully handles read errors and parse failures with stderr warnings
- **writeGlobalConfig(config)**: Atomically write global config (temp file → rename)
  - Creates `~/.config/dev-hub/` directory if missing

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

### Phase 09: Desktop App (Electron) Migration

**Transition from CLI + Server + Web to unified Electron app** with embedded web UI and IPC communication:

#### Electron Main Process (main.ts)

- **createWindow()**: BrowserWindow initialization
  - Loads prebuilt web/dist/index.html
  - Injects preload script exposing `window.api` (IPC handlers)
  - Configures security: nodeIntegration disabled, contextIsolation enabled, enableRemoteModule disabled
- **ipcMain handlers**: Async IPC endpoints for core operations
  - workspace operations (load, switch, getProjects)
  - git operations (fetch, pull, push, status, branches, worktrees)
  - build/run operations (build, start, stop, getLogs)
  - custom commands (execute)
- **Event broadcasting**: IpcEvent emitted to all renderer processes
  - git:progress, build:progress, process:event, workspace:changed

#### Preload Script (preload.ts)

- **window.api**: Exposed IPC interface (type-safe via preload-generated types)
  - `api.invoke(channel, data)`: Send IPC request to main, await response
  - `api.on(channel, callback)`: Listen for broadcast events
  - Only whitelisted handlers exposed (security boundary)

#### IPC Event System

- **IpcEvent** type (formerly SSEEvent): Discriminated union of all event types
  - git:progress, build:progress, process:event, workspace:changed, heartbeat
- **useIpc hook** (React): Subscribe to IPC events with cleanup
  - Replaces useSSE from web package
- **subscribeIpc**: Subscribe to specific event channel with callback

#### Electron Packaging (electron-builder.yml)

- **Linux**: deb (Debian package) + AppImage (portable)
  - asarUnpack: `["**/*node-pty/**"]` (PTY module requires native binary access)
  - Icon: icon.png (256x256)
- **Windows**: NSIS installer + portable .exe
  - asarUnpack for node-pty native modules
  - Start menu shortcuts, desktop shortcut
- **macOS**: dmg (disk image) + auto-update configuration (optional)
- **Code signing**: Placeholders for signing identity (CI/CD configurable)
- **Auto-update**: disabled by default (enterprise deployments can enable)

### Web UI (React Dashboard)

**@dev-hub/web** bundled within Electron app (no separate server):

#### Web Components

- **OverviewCard.tsx**: Workspace/project summary cards (git status, last operation)
- **BuildLog.tsx**: DELETED in Phase 04 cleanup (redundant with LogViewer)
- **ConfigEditor.tsx**: Edit dev-hub.toml with schema validation
- **ProgressList.tsx**: Display real-time build/git operation progress
- **GitPage.tsx**: Project git operations (fetch, pull, push, branches, worktrees)

#### Web Hooks (Refactored for IPC)

- **useIpc.ts**: RENAMED from useSSE
  - `useIpc(channel, callback)`: Subscribe to IPC events
  - Auto-cleanup on unmount, error handling
  - Replaces SSE subscription pattern
  - Type: `IpcEvent` (formerly SSEEvent), `IpcStatus` (formerly SSEStatus)
- **useIpcEvent.ts**: RENAMED from useSSEEvent
  - Composable hook for specific event types
  - Returns latest event data + loading state

#### Web API Layer (queries.ts)

- Refactored for IPC instead of HTTP/SSE
- TanStack Query integration with IPC as data source
- Fixed comment: "IPC" instead of "SSE"

### Core Module Cleanup

**Dependencies Removed**:

- **execa** removed from @dev-hub/core (no longer exec-based process spawning)
- **node-pty** added to @dev-hub/electron (PTY-based shell integration for terminal commands)
- CLI and Server packages completely removed

## Key Files Reference (Current Structure)

### @dev-hub/core

| File                       | Purpose                                |
| -------------------------- | -------------------------------------- |
| src/index.ts               | VERSION + config + git + build exports |
| src/config/schema.ts       | Zod schemas for config validation      |
| src/config/presets.ts      | Build presets by project type          |
| src/config/parser.ts       | TOML read/write + validation           |
| src/config/finder.ts       | Walk-up config discovery               |
| src/config/discovery.ts    | Project type detection                 |
| src/git/types.ts           | Git operation types + events           |
| src/git/operations.ts      | gitFetch, gitPull, gitPush             |
| src/git/status.ts          | getStatus queries                      |
| src/git/worktree.ts        | Worktree CRUD                          |
| src/git/branch.ts          | Branch listing + updates               |
| src/git/bulk.ts            | BulkGitService                         |
| src/build/build-service.ts | BuildService (async process exec)      |
| src/build/run-service.ts   | RunService (process lifecycle)         |

### @dev-hub/electron

| File                 | Purpose                           |
| -------------------- | --------------------------------- |
| main.ts              | Electron main process + IPC setup |
| preload.ts           | Security-scoped IPC interface     |
| electron-builder.yml | Cross-platform packaging config   |

### @dev-hub/web

| File                            | Purpose                           |
| ------------------------------- | --------------------------------- |
| src/main.tsx                    | React entry + QueryClient setup   |
| src/App.tsx                     | React Router + route definitions  |
| src/hooks/useIpc.ts             | IPC event subscription hook       |
| src/hooks/useIpcEvent.ts        | Per-event-type IPC hook           |
| src/api/queries.ts              | TanStack Query for IPC data       |
| src/components/organisms/\*.tsx | Page components (Build, Git, etc) |
| src/pages/\*.tsx                | Route pages (Dashboard, Settings) |

## Testing Status (Phase 04 Migration)

CLI and Server tests DELETED during Electron migration. Core tests (config, git, build) remain valid.

- **@dev-hub/core**: 100+ tests (config, git, build/run services)
- **@dev-hub/electron**: Tests TBD (IPC handler coverage)
- **@dev-hub/web**: Tests TBD (React component + hook coverage)

## Next Steps (Phase 05+)

- Add project discovery UI for finding and adding new projects
- Implement advanced git workflows (rebase, squash, cherry-pick)
- Add build preset customization and command editing in dashboard
- Implement persistent sidebar preferences and dark/light theme toggle
- Add real-time log filtering and search across build/process output
- Implement workspace templates and project scaffolding
- Add multi-workspace support in both CLI and dashboard
- Expand web package component testing (atoms, molecules, organisms)
