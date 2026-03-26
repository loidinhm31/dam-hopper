# Research: Config Schema, Presets & Env Handling

## Config Schema (`packages/core/src/config/schema.ts`)

**ProjectConfig** key fields:
- `services`: Optional array of `ServiceConfig` (name, buildCommand, runCommand)
- `commands`: `z.record(z.string())` — flexible key→command map
- `envFile`: Optional path to env file
- `tags`, `terminals`: Optional arrays

Transform pattern: snake_case TOML → camelCase runtime.

Two schema variants: TOML-based (with transforms) and API (camelCase, no transforms).

## Build Presets (`packages/core/src/config/presets.ts`)

- `PRESETS`: Hardcoded defaults per project type (maven, gradle, npm, pnpm, cargo, custom)
- `getProjectServices(project)`: Returns user services or synthetic "default" from preset
- `getEffectiveCommand(project, command)`: Resolves build/run from first service or preset; dev always from preset

## Env File Handling (`packages/core/src/build/env-loader.ts`)

- `loadEnvFile(path)`: Parses `.env` format (comments, export prefix, quoted values)
- `resolveEnv(project, workspaceRoot)`: Merges `process.env` + env file values (env file overrides)
- Path resolution: `resolve(project.path || workspaceRoot, project.envFile)`

## Command Service (`packages/core/src/build/command-service.ts`)

- `resolve(project, commandName)`: Returns `project.commands[commandName]`
- `getCommandContext(project, commandName, workspaceRoot)`: Returns `{ command, cwd, env }` using `resolveEnv()`

## Key Insight

The `commands` field already supports arbitrary key→command mapping. Predefined commands can extend this pattern with richer metadata (description, env_file override, category).
