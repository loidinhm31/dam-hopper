# Phase 05 — CLI

## Context

- **Parent plan**: [plan.md](./plan.md)
- **Previous phases**: [phase-02-core-config.md](./phase-02-core-config.md), [phase-03-core-git.md](./phase-03-core-git.md), [phase-04-core-build-run.md](./phase-04-core-build-run.md)
- **Next phase**: [phase-06-server-api.md](./phase-06-server-api.md) (parallel)
- **Depends on**: Phases 2, 3, 4 (all core services)

## Overview

- **Date**: 2026-03-21
- **Priority**: High
- **Status**: `done`

Build the `@dev-hub/cli` package — the primary user interface. Uses Commander.js for command parsing, @clack/prompts for interactive setup, and Ink (React terminal renderer) for rich status displays and progress bars. The CLI is a thin layer that delegates all logic to `@dev-hub/core`.

## Key Insights

- Commander.js handles command routing and help text generation. Ink handles rendering.
- Ink is React for the terminal — components re-render on state changes, which is perfect for live progress displays.
- `@clack/prompts` provides beautiful interactive prompts (select, multiselect, text input) for the `init` command. It is simpler than Inquirer and looks great.
- The `ui` command spawns the server and opens the browser — bridging CLI and web workflows.
- Commands should work without a config file where possible (e.g., `dev-hub init` creates one).

## Requirements

- `dev-hub init` — interactive workspace setup, writes `dev-hub.toml`.
- `dev-hub status` — show all projects' git status in a table.
- `dev-hub git fetch` — bulk fetch with progress bars.
- `dev-hub git pull` — bulk pull with progress bars.
- `dev-hub git push [project]` — push a specific project.
- `dev-hub git worktree add/list/remove` — worktree management.
- `dev-hub git branch list/update` — branch operations.
- `dev-hub build [project]` — run build with live output.
- `dev-hub run [project]` — run project with live output.
- `dev-hub ui` — start server, open browser to dashboard.
- All commands load config via `findConfigFile()` auto-discovery.
- Colored, well-formatted output. Errors show actionable messages.

## Architecture

### Command Tree

```
dev-hub
  ├── init                          # Interactive workspace setup
  ├── status                        # Git status overview (all projects)
  ├── git
  │   ├── fetch [--all | project]   # Fetch from remote
  │   ├── pull [--all | project]    # Pull from remote
  │   ├── push <project>            # Push to remote
  │   ├── worktree
  │   │   ├── add <project> <branch> [--create]
  │   │   ├── list [project]        # List worktrees
  │   │   └── remove <project> <path>
  │   └── branch
  │       ├── list [project]        # List branches
  │       └── update [--all | project] [branch]  # Update branches from remote
  ├── build [project] [--all]       # Run build command
  ├── run <project>                 # Start project
  ├── stop <project>                # Stop running project
  ├── logs <project> [--lines N]    # View process logs
  └── ui [--port 4800]              # Start web dashboard
```

### Module Structure

```
packages/cli/src/
  index.ts                          # Commander.js program definition
  commands/
    init.ts                         # Interactive init with @clack/prompts
    status.ts                       # Ink-based status table
    git/
      fetch.ts                      # Bulk fetch command
      pull.ts                       # Bulk pull command
      push.ts                       # Single push command
      worktree.ts                   # Worktree subcommands
      branch.ts                     # Branch subcommands
    build.ts                        # Build command
    run.ts                          # Run/stop/logs commands
    ui.ts                           # Spawn server + open browser
  components/
    StatusTable.tsx                  # Ink component: project status table
    ProgressList.tsx                 # Ink component: multi-project progress bars
    BuildOutput.tsx                  # Ink component: live build output
    LogViewer.tsx                    # Ink component: process log viewer
  utils/
    workspace.ts                    # Load workspace config, handle errors
    format.ts                       # Color/formatting helpers
```

## Related Code Files

- `packages/cli/src/**/*.ts` — all new
- `packages/cli/src/components/**/*.tsx` — all new (Ink components)
- `packages/cli/package.json` — update dependencies
- `packages/cli/tsup.config.ts` — update if needed for JSX

## Implementation Steps

1. **Update `packages/cli/package.json` dependencies**
   - Add: `commander@^12`, `@clack/prompts@^0.9`, `ink@^5`, `ink-spinner@^5`, `ink-table@^4`, `react@^18` (Ink 5 uses React 18), `chalk@^5`, `open@^10`
   - Note: Ink uses React 18 (not 19). This is separate from the web package's React 19.
   - Add devDependencies: `@types/react@^18`

2. **Update `packages/cli/tsup.config.ts`**
   - Add JSX support: `esbuildOptions(options) { options.jsx = "automatic" }` or use `tsconfig.json` with `"jsx": "react-jsx"`.

3. **Implement `utils/workspace.ts`**
   - `loadWorkspace(): Promise<{ config: DevHubConfig; configPath: string }>` — wraps `loadWorkspaceConfig()` from core, catches `ConfigNotFoundError` and prints user-friendly message with suggestion to run `dev-hub init`.

4. **Implement `commands/init.ts`**
   - `initCommand(program: Command): void` — registers the `init` subcommand.
   - Flow:
     1. `@clack/prompts.intro("dev-hub workspace setup")`
     2. `text({ message: "Workspace name" })` — default to directory basename.
     3. Scan current directory with `discoverProjects()`.
     4. If projects found: `multiselect({ message: "Select projects to include", options: [...discovered] })`.
     5. For each selected project, confirm type detection, allow override.
     6. `confirm({ message: "Write dev-hub.toml?" })`.
     7. Write config with `writeConfig()`.
     8. `@clack/prompts.outro("Workspace configured!")`.

5. **Implement `components/StatusTable.tsx`**
   - Ink component that renders a table with columns: Project, Branch, Status (clean/dirty), Ahead, Behind, Modified, Untracked.
   - Use `ink-table` or build custom with `<Box>` and `<Text>`.
   - Color coding: green for clean, yellow for dirty, red for conflicts.
   - Show a spinner while loading status.

6. **Implement `commands/status.ts`**
   - Load workspace config.
   - Call `BulkGitService.statusAll(projects)`.
   - Render `<StatusTable statuses={results} />` using `ink.render()`.

7. **Implement `components/ProgressList.tsx`**
   - Ink component showing a list of projects with progress indicators.
   - Each row: `[spinner/checkmark/cross] project-name — message (percent%)`
   - Subscribe to `GitProgressEmitter` events to update state.
   - Show summary line at bottom: "Completed 5/8 projects".

8. **Implement `commands/git/fetch.ts`**
   - Load workspace, resolve target projects (all or filtered by argument).
   - Create `BulkGitService`, subscribe to emitter.
   - Render `<ProgressList>` with Ink.
   - On completion, show summary: N succeeded, M failed, with details for failures.

9. **Implement `commands/git/pull.ts`**
   - Same pattern as fetch but calls `pullAll()`.
   - Show warnings for projects that are dirty (have uncommitted changes).

10. **Implement `commands/git/push.ts`**
    - Requires a project name argument.
    - Call `gitPush()` for that project, show result.

11. **Implement `commands/git/worktree.ts`**
    - Register `git worktree add <project> <branch>` with options `--create` and `--base <branch>`.
    - Register `git worktree list [project]` — if project given, show worktrees for that project. If not, show all projects' worktrees.
    - Register `git worktree remove <project> <path>`.
    - Use `ink-table` for list display.

12. **Implement `commands/git/branch.ts`**
    - `git branch list [project]` — show branches with tracking info.
    - `git branch update [--all | project] [branch]` — update branches from remote.
    - Use ProgressList for bulk update.

13. **Implement `components/BuildOutput.tsx`**
    - Ink component showing live build output.
    - Header: project name, command being run.
    - Scrolling output area (last 30 lines visible).
    - Footer: elapsed time, status indicator.

14. **Implement `commands/build.ts`**
    - `dev-hub build [project] [--all]`
    - If project specified: build single project, show live output.
    - If `--all`: build all projects, show ProgressList.
    - On completion: show summary with durations.

15. **Implement `commands/run.ts`**
    - `dev-hub run <project>` — start process, show live output. Ctrl+C stops it.
    - `dev-hub stop <project>` — stop a running process.
    - `dev-hub logs <project> [--lines 50]` — show recent log lines.
    - The `run` command stays in foreground, streaming output until Ctrl+C.
    - Register SIGINT handler to gracefully stop the process.

16. **Implement `commands/ui.ts`**
    - `dev-hub ui [--port 4800]`
    - Import and start the server from `@dev-hub/server`.
    - Use `open` package to open `http://localhost:{port}` in default browser.
    - Keep server running in foreground. Ctrl+C stops it.

17. **Wire up all commands in `index.ts`**
    - Create `commander.Command("dev-hub")` with version from package.json.
    - Register all subcommands from `commands/`.
    - Call `program.parse()`.

18. **Test CLI commands**
    - Test `init` command with mocked prompts.
    - Test `status` command with a fixture workspace.
    - Test that `--help` outputs correct help text for all commands.

## Todo List

- [x] Update cli package.json with all dependencies
- [x] Configure tsup for JSX support
- [x] Implement workspace loading utility with error handling
- [x] Implement `init` command with @clack/prompts flow
- [x] Implement `StatusTable` Ink component
- [x] Implement `status` command
- [x] Implement `ProgressList` Ink component
- [x] Implement `git fetch` command with progress display
- [x] Implement `git pull` command with dirty-repo warnings
- [x] Implement `git push` command
- [x] Implement `git worktree add/list/remove` commands
- [x] Implement `git branch list/update` commands
- [x] Implement `BuildOutput` Ink component
- [x] Implement `build` command (single + all)
- [x] Implement `run`, `stop`, `logs` commands
- [x] Implement `ui` command (spawn server + open browser)
- [x] Wire up all commands in index.ts
- [x] Test all commands produce correct help text
- [x] Test init flow with mocked prompts
- [x] Verify `dev-hub --version` works after build

## Success Criteria

1. `dev-hub init` walks through interactive setup and produces a valid `dev-hub.toml`.
2. `dev-hub status` shows a colored table of all projects' git status.
3. `dev-hub git fetch` shows parallel progress bars and a completion summary.
4. `dev-hub git worktree add myproject feature-x --create` creates a worktree.
5. `dev-hub build api-server` streams Maven/npm output live in the terminal.
6. `dev-hub run web-app` starts the process and streams logs; Ctrl+C stops it cleanly.
7. `dev-hub ui` starts the server and opens the browser.
8. `dev-hub --help` shows clean, well-organized help text for all commands.

## Risk Assessment

| Risk                                                   | Likelihood | Impact | Mitigation                                                                                                      |
| ------------------------------------------------------ | ---------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| Ink React version conflicts with web package React 19  | Medium     | Medium | Ink is isolated in cli package; pnpm workspace hoisting can be configured to not hoist react                    |
| @clack/prompts doesn't support all needed prompt types | Low        | Low    | Fall back to basic readline for missing types                                                                   |
| Terminal width/height varies, Ink layout breaks        | Medium     | Low    | Test with common terminal sizes (80x24, 120x40). Use Ink's `<Box flexDirection="column">` for responsive layout |
| Large number of projects makes status table unreadable | Low        | Medium | Add `--filter` and `--tag` options for filtering projects                                                       |

## Next Steps

The CLI is the primary user interface. In parallel, build:

- [Phase 06 — Server API](./phase-06-server-api.md) — the server that `dev-hub ui` spawns
