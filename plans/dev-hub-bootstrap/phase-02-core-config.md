# Phase 02 — Core: Config & Discovery

## Context

- **Parent plan**: [plan.md](./plan.md)
- **Previous phase**: [phase-01-project-setup.md](./phase-01-project-setup.md)
- **Next phases**: [phase-03-core-git.md](./phase-03-core-git.md), [phase-04-core-build-run.md](./phase-04-core-build-run.md)
- **Depends on**: Phase 01 (monorepo structure, @dev-hub/core package exists)

## Overview

- **Date**: 2026-03-21
- **Priority**: Critical
- **Status**: `pending`

Implement the configuration layer in `@dev-hub/core`: TOML schema definition, parsing/validation/serialization, workspace discovery (auto-detect project types by scanning for marker files), and TypeScript type definitions for all config structures.

## Key Insights

- `smol-toml` is a small, correct TOML parser with no native dependencies — ideal for a CLI tool.
- Zod schemas serve double duty: runtime validation + TypeScript type inference (no type drift).
- Workspace discovery must handle nested structures (e.g., a monorepo inside a workspace).
- Build presets provide sensible defaults but every command is overridable per-project.
- The config file location is discovered by walking up from `cwd()` until `dev-hub.toml` is found (like `.git` discovery).

## Requirements

- Parse `dev-hub.toml` into a strongly-typed `WorkspaceConfig` object.
- Validate config with clear error messages (e.g., "project 'api' has unknown type 'maven2'").
- Write config back to TOML (for `dev-hub init` and settings editing).
- Auto-discover projects in a directory: detect type by marker files (`pom.xml` -> maven, `build.gradle` -> gradle, `package.json` with pnpm -> pnpm, `Cargo.toml` -> cargo).
- Provide default build/run commands per project type (presets).
- Support env file references per project (resolved relative to project path).

## Architecture

### Config Schema (TOML)

```toml
[workspace]
name = "my-workspace"
root = "."                        # optional, defaults to config file directory

[[projects]]
name = "api-server"               # unique identifier
path = "./services/api"           # relative to workspace root
type = "maven"                    # maven | gradle | npm | pnpm | cargo | custom
build_command = ""                # override preset default
run_command = ""                  # override preset default
env_file = ".env"                 # optional, relative to project path
tags = ["backend", "java"]        # optional, for filtering

[[projects]]
name = "web-frontend"
path = "./apps/web"
type = "pnpm"
tags = ["frontend"]
```

### Module Structure

```
packages/core/src/
  index.ts                        # re-exports
  config/
    index.ts                      # re-exports config module
    schema.ts                     # Zod schemas + inferred types
    parser.ts                     # read/write/validate TOML config
    discovery.ts                  # auto-detect project types
    presets.ts                    # default commands per project type
    finder.ts                     # walk-up directory search for dev-hub.toml
  types.ts                        # shared TypeScript interfaces (non-Zod)
```

### Type Definitions

```typescript
// Inferred from Zod schemas
type ProjectType = "maven" | "gradle" | "npm" | "pnpm" | "cargo" | "custom";

interface ProjectConfig {
  name: string;
  path: string;                   // resolved to absolute at runtime
  type: ProjectType;
  buildCommand?: string;
  runCommand?: string;
  envFile?: string;
  tags?: string[];
}

interface WorkspaceConfig {
  workspace: { name: string; root: string };
  projects: ProjectConfig[];
}

interface BuildPreset {
  type: ProjectType;
  buildCommand: string;
  runCommand: string;
  devCommand?: string;
  markerFiles: string[];          // files that identify this type
}
```

## Related Code Files

- `packages/core/src/config/schema.ts` — new
- `packages/core/src/config/parser.ts` — new
- `packages/core/src/config/discovery.ts` — new
- `packages/core/src/config/presets.ts` — new
- `packages/core/src/config/finder.ts` — new
- `packages/core/src/config/index.ts` — new
- `packages/core/src/index.ts` — update to re-export config module

## Implementation Steps

1. **Define Zod schemas in `schema.ts`**
   - `ProjectTypeSchema = z.enum(["maven", "gradle", "npm", "pnpm", "cargo", "custom"])`
   - `ProjectConfigSchema = z.object({ name: z.string().min(1), path: z.string(), type: ProjectTypeSchema, build_command: z.string().optional(), run_command: z.string().optional(), env_file: z.string().optional(), tags: z.array(z.string()).optional() })`
   - `WorkspaceSchema = z.object({ name: z.string().min(1), root: z.string().default(".") })`
   - `DevHubConfigSchema = z.object({ workspace: WorkspaceSchema, projects: z.array(ProjectConfigSchema).default([]) })`
   - Export inferred types: `export type ProjectConfig = z.infer<typeof ProjectConfigSchema>`
   - Add `.refine()` to ensure project names are unique.

2. **Implement `presets.ts`**
   - Define a `Record<ProjectType, BuildPreset>` map:
     - `maven`: build=`mvn clean install -DskipTests`, run=`mvn spring-boot:run`, markers=`["pom.xml"]`
     - `gradle`: build=`./gradlew build`, run=`./gradlew bootRun`, markers=`["build.gradle", "build.gradle.kts"]`
     - `npm`: build=`npm run build`, run=`npm start`, dev=`npm run dev`, markers=`["package-lock.json"]`
     - `pnpm`: build=`pnpm build`, run=`pnpm start`, dev=`pnpm dev`, markers=`["pnpm-lock.yaml"]`
     - `cargo`: build=`cargo build`, run=`cargo run`, markers=`["Cargo.toml"]`
     - `custom`: build=`""`, run=`""`, markers=`[]`
   - Export `getPreset(type: ProjectType): BuildPreset`
   - Export `getEffectiveCommand(project: ProjectConfig, command: "build" | "run" | "dev"): string` — returns project override or preset default.

3. **Implement `parser.ts`**
   - `readConfig(filePath: string): Promise<DevHubConfig>` — read file, parse with `smol-toml`, validate with Zod schema, resolve relative paths to absolute (relative to config file directory).
   - `writeConfig(filePath: string, config: DevHubConfig): Promise<void>` — serialize to TOML string, write to file. Use `smol-toml`'s `stringify()`.
   - `validateConfig(raw: unknown): Result<DevHubConfig, ZodError>` — parse without file I/O (for testing and server use).
   - Handle TOML parse errors with user-friendly messages: line number, expected type.
   - Normalize paths: convert `build_command` / `run_command` from snake_case TOML keys to camelCase TypeScript properties using a transform in the Zod schema.

4. **Implement `finder.ts`**
   - `findConfigFile(startDir?: string): Promise<string | null>` — start from `startDir` (default `process.cwd()`), walk up parent directories looking for `dev-hub.toml`. Stop at filesystem root or home directory.
   - `loadWorkspaceConfig(startDir?: string): Promise<DevHubConfig>` — combines `findConfigFile` + `readConfig`. Throws `ConfigNotFoundError` if no config found.

5. **Implement `discovery.ts`**
   - `discoverProjects(rootDir: string): Promise<DiscoveredProject[]>` — scan `rootDir` for immediate subdirectories. For each, check marker files to detect type.
   - `detectProjectType(projectDir: string): Promise<ProjectType | null>` — check for marker files in priority order: `Cargo.toml` -> `pom.xml` -> `build.gradle`/`build.gradle.kts` -> `pnpm-lock.yaml` -> `package-lock.json` -> `package.json` (fallback to npm). Return null if no markers found.
   - `DiscoveredProject = { name: string (dirname), path: string, type: ProjectType, isGitRepo: boolean }`.
   - Check for `.git` directory to set `isGitRepo`.
   - Skip hidden directories (starting with `.`) and `node_modules`.

6. **Implement `config/index.ts`**
   - Re-export everything: schemas, types, parser functions, finder, discovery, presets.

7. **Update `packages/core/src/index.ts`**
   - `export * from "./config/index.js";`

8. **Write unit tests**
   - Test Zod schema validation: valid config, missing required fields, unknown project type, duplicate project names.
   - Test parser: read a fixture TOML file, verify parsed object matches expected shape.
   - Test presets: `getEffectiveCommand` returns override when set, preset default when not.
   - Test discovery: create temp directory with marker files, verify detection.
   - Test finder: create nested directories with a config file, verify walk-up finds it.

## Todo List

- [ ] Create `packages/core/src/config/` directory structure
- [ ] Define Zod schemas with all project types and validation rules
- [ ] Implement build presets for all 5 project types + custom
- [ ] Implement TOML parser (read, write, validate) with smol-toml
- [ ] Implement config file finder (walk-up directory search)
- [ ] Implement project discovery (scan directory, detect types by markers)
- [ ] Wire up re-exports in index files
- [ ] Write unit tests for schema validation
- [ ] Write unit tests for parser (read/write round-trip)
- [ ] Write unit tests for discovery with temp directories
- [ ] Write unit tests for finder with nested directory fixtures
- [ ] Verify `pnpm build` passes with new code

## Success Criteria

1. `readConfig("dev-hub.toml")` returns a validated, typed `DevHubConfig` object with absolute paths.
2. `writeConfig()` produces valid TOML that round-trips through `readConfig()` without loss.
3. `discoverProjects("./")` correctly identifies project types for a directory containing mixed projects.
4. `findConfigFile()` locates `dev-hub.toml` from a nested subdirectory.
5. Invalid TOML or schema violations produce clear, actionable error messages.
6. All unit tests pass.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| smol-toml stringify doesn't preserve comments | High | Low | Accept: comments lost on write. Document this behavior. |
| Project type detection ambiguity (dir has both pom.xml and package.json) | Medium | Low | Use priority ordering; first match wins. Document detection order. |
| Deep workspace nesting causes slow discovery | Low | Low | Only scan immediate children by default; add `depth` option later if needed. |

## Next Steps

With config parsing and discovery complete, proceed in parallel to:
- [Phase 03 — Core: Git Operations](./phase-03-core-git.md) — git service uses `ProjectConfig` to locate repos
- [Phase 04 — Core: Build & Run](./phase-04-core-build-run.md) — build service uses presets and effective commands
