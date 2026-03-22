---
parent: plan.md
phase: "02"
status: done
priority: P1
effort: 1.5h
depends_on: phase-01
---

# Phase 02: Server Workspace Parity

## Context

- Parent: [plan.md](./plan.md)
- Depends on: Phase 01 (`DEV_HUB_WORKSPACE` env var name established)
- Related: `packages/server/src/services/context.ts`, `packages/server/src/index.ts`,
  `packages/cli/src/commands/ui.ts`

## Overview

Make the server load the workspace through the same priority chain as the CLI.
Primary mechanism: `dev-hub ui` sets `process.env.DEV_HUB_WORKSPACE` before the
dynamic `import("@dev-hub/server")` so the server inherits it. The server also
reads `DEV_HUB_WORKSPACE` directly (for `pnpm dev:server` workflows).

**Status:** done | **Review:** approved | **Date:** 2026-03-22

## Key Insights

- `createServerContext(configPath?)` (context.ts) accepts only a **file** path.
  When given a **directory**, `findConfigFile()` must walk up. Fix = same stat/dirname
  normalisation already in `loadWorkspace()`.
- `server/src/index.ts` currently reads `DEV_HUB_CONFIG` (file path, legacy).
  Must also check `DEV_HUB_WORKSPACE` (directory or file) with higher priority.
- `dev-hub ui` calls `startServer(port)` via in-process dynamic import. Setting
  `process.env.DEV_HUB_WORKSPACE` before the import is sufficient — no new IPC
  or function signatures needed.
- `DEV_HUB_CONFIG` kept for backward compatibility as file-path alias.

## Requirements

1. `createServerContext()` accepts directory path — apply stat + walk-up normalisation
2. `createServerContext()` checks `DEV_HUB_WORKSPACE` env var when no arg given
3. `dev-hub ui` sets `process.env.DEV_HUB_WORKSPACE` from `--workspace` global option
4. `server/src/index.ts` direct-run block: `DEV_HUB_WORKSPACE` takes priority over `DEV_HUB_CONFIG`
5. Add server context tests

## Architecture

### Updated `createServerContext(workspacePath?: string)`

```typescript
export async function createServerContext(
  workspacePath?: string,
): Promise<ServerContext> {
  // Priority: explicit arg → DEV_HUB_WORKSPACE → DEV_HUB_CONFIG (compat) → CWD
  let input = workspacePath
    ?? process.env.DEV_HUB_WORKSPACE
    ?? process.env.DEV_HUB_CONFIG
    ?? process.cwd();

  // Normalise: resolve relative, file → directory
  if (!isAbsolute(input)) input = resolve(process.cwd(), input);
  try {
    const s = await stat(input);
    if (s.isFile()) input = dirname(input);
  } catch { /* non-existent: let findConfigFile handle */ }

  const resolvedPath = await findConfigFile(input);
  if (!resolvedPath) throw new ConfigNotFoundError(input);
  // ... rest unchanged
}
```

### Updated `ui.ts` action

```typescript
.action(async (opts: { port: string }, cmd: Command) => {
  const { workspace } = cmd.optsWithGlobals<GlobalOptions>();
  if (workspace) {
    process.env.DEV_HUB_WORKSPACE = resolve(workspace);
  }
  // ... existing logic unchanged
})
```

### Updated `server/src/index.ts` direct-run check

```typescript
// Prefer DEV_HUB_WORKSPACE (directory); DEV_HUB_CONFIG kept for compat (file path)
const WORKSPACE = process.env.DEV_HUB_WORKSPACE ?? process.env.DEV_HUB_CONFIG;
await startServer({ port: PORT, configPath: WORKSPACE });
```

## Related Code Files

- `packages/server/src/services/context.ts` — `createServerContext()` (lines ~43–104)
- `packages/server/src/index.ts` — `StartServerOptions`, direct-run block (lines ~4–36)
- `packages/cli/src/commands/ui.ts` — action callback (lines 9–44)
- `packages/cli/src/utils/types.ts` — `GlobalOptions` (from Phase 01)
- `packages/server/src/__tests__/helpers.ts` — `createTestContext()` pattern to follow

## Implementation Steps

1. Add `stat`, `dirname`, `resolve`, `isAbsolute` imports to `context.ts`
   (from `node:fs/promises` and `node:path`)
2. Refactor `createServerContext()` with normalisation block above
3. In `ui.ts`:
   - Import `GlobalOptions` from `../utils/types.js`
   - Change action to `(opts, cmd)` pattern
   - Set `process.env.DEV_HUB_WORKSPACE` when workspace option is present
4. In `server/src/index.ts` direct-run block: prefer `DEV_HUB_WORKSPACE`
5. Add `packages/server/src/__tests__/context-resolution.test.ts`:
   - Test: directory path resolves to config within it
   - Test: `DEV_HUB_WORKSPACE` used when no arg given
   - Test: `DEV_HUB_WORKSPACE` overrides `DEV_HUB_CONFIG`
   - Test: throws `ConfigNotFoundError` when workspace has no config

## Todo

- [x] Refactor `createServerContext()` — directory path + env var
- [x] Update `ui.ts` — forward workspace via env var
- [x] Update `server/src/index.ts` — env var priority order
- [x] Add `context-resolution.test.ts`

## Success Criteria

- `DEV_HUB_WORKSPACE=/path dev-hub ui` — dashboard points at correct workspace
- `DEV_HUB_WORKSPACE=/path pnpm dev:server` — server loads correct workspace
- `dev-hub --workspace /path ui` — propagates workspace to server without extra flags
- `DEV_HUB_CONFIG` file-path usage still works (backward compat)
- New server tests pass

## Risk Assessment

- **Low** — `createServerContext()` change is backward compatible; file paths still work
- **Low** — env var mutation via `process.env` is safe for in-process calls
- **Note** — if server ever becomes a separate child process, env var must be in `spawn` opts

## Security Considerations

- `DEV_HUB_WORKSPACE` is a local filesystem path — same trust level as `--workspace`
- Setting `process.env.DEV_HUB_WORKSPACE` before dynamic import is safe; server reads
  it at `createServerContext()` call time, not at module load time

## Next Steps

→ Phase 03: Global XDG Config (deferred)
