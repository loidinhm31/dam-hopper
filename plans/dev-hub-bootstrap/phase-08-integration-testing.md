# Phase 08 — Integration & Testing

## Context

- **Parent plan**: [plan.md](./plan.md)
- **Previous phases**: All phases 01-07
- **Depends on**: All phases complete (or at minimum phases 01-06 for API-level testing)

## Overview

- **Date**: 2026-03-21
- **Priority**: Medium
- **Status**: `pending`

Comprehensive testing across all packages: unit tests for core logic, integration tests for CLI commands and API endpoints, and end-to-end tests that verify the full stack (CLI spawns server, web dashboard connects and performs operations). Also covers test infrastructure: fixtures, mocks, and CI configuration.

## Key Insights

- Vitest is the test runner for all packages — fast, ESM-native, compatible with the existing toolchain.
- Core services are the most critical to unit test since cli/server/web are thin wrappers.
- Git integration tests need real git repos. Create them in temp directories during test setup — do not rely on the host filesystem.
- API endpoint tests use Hono's `app.request()` helper which executes routes without starting an HTTP server — fast and deterministic.
- E2E tests are the most fragile and slowest. Keep them minimal: verify the critical path works (server starts, dashboard loads, one operation executes).

## Requirements

- Unit tests for all core modules: config parser, presets, discovery, git services, build service, run service, env loader, log buffer.
- CLI command tests: verify commands parse correctly, produce expected output for fixture workspaces.
- API endpoint tests: verify all routes return correct status codes and response shapes.
- SSE endpoint test: verify connection, heartbeat, and event delivery.
- E2E test: CLI starts server, web dashboard loads, performs a git fetch, sees progress.
- Test fixtures: mock workspace with multiple project types and git repos.
- CI-ready: all tests pass in a clean environment without manual setup.

## Architecture

### Test Structure

```
packages/
  core/
    src/
      config/__tests__/
        schema.test.ts              # Zod schema validation
        parser.test.ts              # TOML read/write round-trip
        discovery.test.ts           # Project type detection
        presets.test.ts             # Effective command resolution
        finder.test.ts              # Config file walk-up search
      git/__tests__/
        errors.test.ts              # Error classification
        status.test.ts              # Git status parsing
        operations.test.ts          # Fetch/pull/push (integration)
        worktree.test.ts            # Worktree operations (integration)
        branch.test.ts              # Branch operations (integration)
        bulk.test.ts                # Bulk operations with concurrency
      build/__tests__/
        env-loader.test.ts          # .env file parsing
        log-buffer.test.ts          # Circular buffer behavior
        build-service.test.ts       # Build execution (integration)
        run-service.test.ts         # Process lifecycle (integration)
  cli/
    src/__tests__/
      init.test.ts                  # Init command with mocked prompts
      status.test.ts                # Status command output
      commands.test.ts              # Command parsing and help text
  server/
    src/__tests__/
      workspace.test.ts             # Workspace/project routes
      git.test.ts                   # Git operation routes
      build.test.ts                 # Build route
      processes.test.ts             # Process management routes
      events.test.ts                # SSE endpoint
      error-handler.test.ts         # Error-to-status mapping
  web/
    src/__tests__/
      queries.test.ts               # TanStack Query hooks
      sse.test.ts                   # SSE hook
  __tests__/                        # Root-level E2E tests
    e2e.test.ts                     # Full stack E2E
  __fixtures__/                     # Shared test fixtures
    workspace/                      # Mock workspace directory
      dev-hub.toml
      maven-project/
      pnpm-project/
      cargo-project/
```

### Test Utilities

```typescript
// packages/core/src/__test-utils__/git-helpers.ts
async function createTempGitRepo(options?: { commits?: number; branches?: string[] }): Promise<{ path: string; cleanup: () => void }>;
async function createBareRemote(): Promise<{ path: string; cleanup: () => void }>;
async function createCloneWithRemote(): Promise<{ localPath: string; remotePath: string; cleanup: () => void }>;

// packages/core/src/__test-utils__/workspace-helpers.ts
async function createTempWorkspace(projects: Array<{ name: string; type: ProjectType }>): Promise<{ rootPath: string; configPath: string; cleanup: () => void }>;
```

## Related Code Files

- All `__tests__/` directories across packages — new
- `__fixtures__/` at root — new
- `vitest.config.ts` per package — new or update
- Root `vitest.workspace.ts` — new (Vitest workspace mode)

## Implementation Steps

1. **Set up Vitest configuration**
   - Add `vitest@^2` to root devDependencies.
   - Create `vitest.workspace.ts` at root:
     ```typescript
     export default ["packages/*/vitest.config.ts"];
     ```
   - Create `vitest.config.ts` in each package:
     ```typescript
     import { defineConfig } from "vitest/config";
     export default defineConfig({
       test: {
         globals: true,
         environment: "node", // "jsdom" for web package
         include: ["src/**/*.test.ts"],
         testTimeout: 30000, // git operations can be slow
       },
     });
     ```
   - For web package, use `environment: "jsdom"` and add `@testing-library/react`.
   - Add root scripts: `"test": "vitest"`, `"test:run": "vitest run"`, `"test:coverage": "vitest run --coverage"`.

2. **Create test utilities**
   - `createTempGitRepo()`: create temp dir, `git init`, create initial commit, optionally add N commits and create branches. Return path and cleanup function.
   - `createBareRemote()`: create temp dir, `git init --bare`. Return path and cleanup.
   - `createCloneWithRemote()`: create bare remote, clone it, add initial commit + push. Return both paths and cleanup.
   - `createTempWorkspace()`: create temp dir with `dev-hub.toml` and subdirectories with marker files (pom.xml, Cargo.toml, etc.).
   - All utilities use `fs.mkdtemp(path.join(os.tmpdir(), "dev-hub-test-"))` for isolation.
   - All utilities return cleanup functions that remove temp directories.

3. **Write core config tests**
   - `schema.test.ts`:
     - Test valid config parses without errors.
     - Test missing `workspace.name` produces a Zod error with path.
     - Test unknown project type is rejected.
     - Test duplicate project names are rejected (refine check).
     - Test optional fields default correctly.
   - `parser.test.ts`:
     - Write a TOML string to temp file, read it with `readConfig()`, verify output.
     - Test round-trip: `readConfig()` -> `writeConfig()` -> `readConfig()` produces same result.
     - Test invalid TOML (syntax error) produces a meaningful error message.
     - Test relative paths are resolved to absolute.
   - `discovery.test.ts`:
     - Create temp dir with subdirectories containing marker files.
     - Verify `detectProjectType()` returns correct type for each.
     - Verify `discoverProjects()` finds all projects.
     - Verify hidden directories and node_modules are skipped.
   - `presets.test.ts`:
     - Test `getEffectiveCommand()` returns preset default when no override.
     - Test override takes precedence over preset.
     - Test custom type returns empty string (user must provide commands).
   - `finder.test.ts`:
     - Create nested directory structure: `root/a/b/c/` with `dev-hub.toml` in `root/`.
     - Call `findConfigFile()` from `root/a/b/c/`, verify it finds `root/dev-hub.toml`.
     - Test returns null when no config exists.

4. **Write core git tests**
   - `errors.test.ts`:
     - Test each error category: pass an Error with matching message, verify classification.
     - Test unknown error message classifies as `unknown`.
   - `status.test.ts`:
     - Create temp git repo with staged, modified, and untracked files.
     - Call `getStatus()`, verify counts match.
     - Verify branch name, clean/dirty, last commit info.
   - `operations.test.ts` (integration):
     - Create clone-with-remote. Push a new commit to remote from a second clone.
     - Call `gitFetch()` from first clone, verify success.
     - Call `gitPull()`, verify success and new commit is present.
     - Test `gitPull()` on dirty repo fails gracefully.
   - `worktree.test.ts` (integration):
     - Create git repo with a commit.
     - `addWorktree()` with a new branch, verify directory created.
     - `listWorktrees()` returns 2 entries (main + new).
     - `removeWorktree()` removes the linked worktree.
   - `branch.test.ts` (integration):
     - Create clone-with-remote, create remote branches.
     - `listBranches()` returns local and remote branches.
     - `updateBranch()` updates a local branch from remote.
   - `bulk.test.ts`:
     - Create 3 clones-with-remote.
     - `fetchAll()` with concurrency 2, verify all succeed.
     - Verify progress events fire for each project.

5. **Write core build tests**
   - `env-loader.test.ts`:
     - Write temp `.env` file with various formats: basic, quoted, comments, empty lines, `export` prefix.
     - Verify all key-value pairs are correctly parsed.
   - `log-buffer.test.ts`:
     - Push entries, verify `getAll()` returns them in order.
     - Push more than max, verify oldest are evicted.
     - `getLast(5)` returns last 5 entries.
     - `clear()` empties the buffer.
   - `build-service.test.ts` (integration):
     - Create temp project with a package.json containing `"build": "echo built"`.
     - Call `build()`, verify success result with exit code 0.
     - Verify stdout contains "built".
     - Test failing build (exit code 1): create script that exits with 1, verify failure result.
   - `run-service.test.ts` (integration):
     - Start a long-running process (`node -e "setInterval(()=>console.log('tick'),100)"`).
     - Verify `getProcess()` shows "running" status.
     - Verify `getLogs()` returns log entries after a short delay.
     - Call `stop()`, verify process terminates.
     - Verify `getAllProcesses()` is empty after stop.
     - Test `restart()` increments restart count.

6. **Write CLI tests**
   - `commands.test.ts`:
     - Import the Commander program.
     - Verify `--help` includes all expected subcommands.
     - Verify `--version` outputs the version.
     - Verify unknown commands produce an error.
   - `init.test.ts`:
     - Mock `@clack/prompts` functions to return predetermined values.
     - Run init command, verify `dev-hub.toml` is written with expected content.
   - `status.test.ts`:
     - Create temp workspace with git repos.
     - Capture Ink output (use `ink-testing-library`).
     - Verify table contains expected project names and statuses.

7. **Write server API tests**
   - Use Hono's test approach: `const res = await app.request("/api/projects")`.
   - `workspace.test.ts`:
     - Create server context with fixture workspace.
     - `GET /api/projects` returns 200 with project array.
     - `GET /api/projects/nonexistent` returns 404.
   - `git.test.ts`:
     - `POST /api/git/fetch` with empty body returns 200 with results array.
     - `POST /api/git/fetch` with `{ projects: ["unknown"] }` handles gracefully.
   - `build.test.ts`:
     - `POST /api/build/test-project` triggers build and returns result.
     - `POST /api/build/unknown` returns 404.
   - `processes.test.ts`:
     - `POST /api/run/test-project` starts process, returns 200 with PID.
     - `GET /api/processes` includes the running process.
     - `DELETE /api/run/test-project` stops it, returns 204.
     - `GET /api/processes` is empty after stop.
   - `events.test.ts`:
     - Connect to SSE endpoint, verify heartbeat event received within 35 seconds.
   - `error-handler.test.ts`:
     - Throw `GitError` with each category, verify correct HTTP status code returned.

8. **Write E2E test**
   - `__tests__/e2e.test.ts`:
     - Create a temp workspace with a pnpm project (simple package.json with build script).
     - Initialize git repos in each project.
     - Start the server programmatically (import `startServer` from `@dev-hub/server`).
     - Verify `GET /` returns HTML (dashboard).
     - Verify `GET /api/projects` returns the workspace projects.
     - Trigger `POST /api/build/test-project`, verify it completes successfully.
     - Stop the server, verify clean shutdown (no running processes).
   - Timeout: 60 seconds for the full E2E test.

9. **Create test fixtures**
   - `__fixtures__/workspace/dev-hub.toml`: config with 3 projects (maven, pnpm, cargo).
   - `__fixtures__/workspace/maven-project/pom.xml`: minimal POM file.
   - `__fixtures__/workspace/pnpm-project/package.json`: minimal package.json with pnpm-lock.yaml.
   - `__fixtures__/workspace/pnpm-project/pnpm-lock.yaml`: minimal lockfile.
   - `__fixtures__/workspace/cargo-project/Cargo.toml`: minimal Cargo.toml.

10. **Add CI scripts to root package.json**
    - `"test": "vitest"` (watch mode for dev)
    - `"test:run": "vitest run"` (single run for CI)
    - `"test:coverage": "vitest run --coverage"` (with @vitest/coverage-v8)
    - `"check": "pnpm build && pnpm lint && pnpm test:run"` (full CI check)

## Todo List

- [ ] Set up Vitest workspace configuration
- [ ] Create vitest.config.ts for each package
- [ ] Implement test utilities (createTempGitRepo, createTempWorkspace, etc.)
- [ ] Write config schema validation tests
- [ ] Write config parser round-trip tests
- [ ] Write project discovery tests
- [ ] Write preset resolution tests
- [ ] Write config finder tests
- [ ] Write git error classification tests
- [ ] Write git status integration tests
- [ ] Write git fetch/pull integration tests
- [ ] Write worktree operation integration tests
- [ ] Write branch operation integration tests
- [ ] Write bulk git operation tests with concurrency verification
- [ ] Write env loader tests
- [ ] Write log buffer tests
- [ ] Write build service integration tests
- [ ] Write run service lifecycle integration tests
- [ ] Write CLI command parsing tests
- [ ] Write CLI init command tests with mocked prompts
- [ ] Write CLI status command tests with ink-testing-library
- [ ] Write server workspace route tests
- [ ] Write server git route tests
- [ ] Write server build route tests
- [ ] Write server process management route tests
- [ ] Write server SSE endpoint tests
- [ ] Write server error handler tests
- [ ] Write full-stack E2E test
- [ ] Create test fixtures (workspace with marker files)
- [ ] Add CI-ready test scripts to root package.json
- [ ] Verify all tests pass with `pnpm test:run`

## Success Criteria

1. `pnpm test:run` passes all tests across all packages from a clean state.
2. Core config tests cover: valid parsing, invalid schema rejection, round-trip fidelity, discovery accuracy, finder walk-up.
3. Core git tests verify: status accuracy, fetch/pull with real remotes, worktree lifecycle, branch update, bulk concurrency.
4. Core build tests verify: successful build, failing build, process start/stop/restart, log buffering.
5. Server tests verify: all routes return correct status codes and response shapes, SSE delivers events, errors map to HTTP statuses.
6. E2E test verifies: server starts, dashboard HTML served, API returns data, build executes, clean shutdown.
7. No test relies on external network access (all git operations use local temp repos).
8. Test execution completes in under 60 seconds.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Git integration tests are slow due to repo creation | Medium | Medium | Use `git init` + `git commit --allow-empty` for fast setup; share repos across tests in a describe block with beforeAll |
| Temp directories not cleaned up on test failure | Medium | Low | Use `afterAll` + `afterEach` with try/catch; also use OS temp dir which is cleaned periodically |
| Run service tests leave orphan processes | Medium | High | Always call `stopAll()` in afterEach; set short timeouts on test processes |
| SSE test is timing-sensitive | Medium | Medium | Use generous timeouts (35s for heartbeat test); mock time if needed |
| CI environment lacks git | Low | High | Document git as a CI requirement; most CI environments have git pre-installed |

## Next Steps

With testing complete, the project reaches Milestone M3 (Stable). Future enhancements:
- Add `--watch` mode for builds (file system watching with chokidar).
- Add project dependency graph for ordered builds.
- Add plugin system for custom project types.
- Add workspace templates (`dev-hub init --template java-microservices`).
- Add git stash management commands.
- Publish to npm: `npm publish -w packages/cli`.
