---
parent: plan.md
phase: "01"
status: done
priority: P1
effort: 2h
---

# Phase 01: Layered Resolution Core (CLI)

## Context

- Parent: [plan.md](./plan.md)
- Phase 02 depends on this (env var name `DEV_HUB_WORKSPACE` established here)
- Related: `packages/cli/src/utils/workspace.ts`, `packages/cli/src/commands/init.ts`

## Overview

Implement the complete priority chain inside `loadWorkspace()` and centralise the
`GlobalOptions` type. Fix `init` to honour `--workspace`. Improve all error
messages to mention available override mechanisms.

**Status:** done | **Review:** approved | **Date:** 2026-03-22

## Key Insights

- `loadWorkspace(startDir?)` already resolves relative paths and file→dir (added in prev session).
  New env var step slots in **before** `findConfigFile()` call and **after** explicit `startDir`
  check — so flag (sets `startDir`) always wins over env var.
- `init` at line 20 of `init.ts` hardcodes `process.cwd()`. Must call
  `cmd.optsWithGlobals<GlobalOptions>()` and use the resolved workspace dir as
  the target for `findConfigFile()` and `writeConfig()`.
- Shared `GlobalOptions` interface eliminates repeated `{ workspace?: string }`
  generics across all command files.

## Requirements

1. Export `GlobalOptions` interface from new `packages/cli/src/utils/types.ts`
2. In `loadWorkspace()`: check `process.env.DEV_HUB_WORKSPACE` when `startDir` is `undefined`
3. Env var value goes through identical stat/relative-path normalisation as `startDir`
4. Both `ConfigNotFoundError` error messages append: `Use --workspace <path> or set DEV_HUB_WORKSPACE`
5. Fix `registerInit` in `init.ts`: `(_opts, cmd)` signature, read workspace global option,
   resolve target dir, pass to `findConfigFile()`, `discoverProjects()`, `writeConfig()` calls
6. Update `packages/cli/src/__tests__/workspace.test.ts` with new test cases

## Architecture

### New `packages/cli/src/utils/types.ts`

```typescript
export interface GlobalOptions {
  workspace?: string;
}
```

### `loadWorkspace()` resolution order

```
startDir param (truthy = --workspace flag was set)  →  wins
  ↓ undefined
process.env.DEV_HUB_WORKSPACE                       →  new, lines ~19–24
  ↓ undefined
process.cwd()                                        →  existing fallback
  ↓
[stat normalisation: resolve relative, file → dirname]
  ↓
findConfigFile(cwd)  →  loadWorkspaceConfig(cwd)
```

### Updated `init.ts` action pattern

```typescript
.action(async (_opts: Record<string, unknown>, cmd: Command) => {
  const { workspace } = cmd.optsWithGlobals<GlobalOptions>();
  const targetDir = workspace ? resolve(workspace) : process.cwd();
  // replace all process.cwd() refs with targetDir
})
```

## Related Code Files

- `packages/cli/src/utils/workspace.ts` — lines 16–55 (main changes)
- `packages/cli/src/commands/init.ts` — ~lines 17, 20, 22, 46, 72, 95 (all cwd refs)
- `packages/cli/src/__tests__/workspace.test.ts` — add new describe block

## Implementation Steps

1. Create `packages/cli/src/utils/types.ts` with `GlobalOptions` interface
2. In `workspace.ts` `loadWorkspace()`:
   - After `let cwd = startDir ?? process.cwd()`, insert env var check:
     `if (!startDir && process.env.DEV_HUB_WORKSPACE) cwd = process.env.DEV_HUB_WORKSPACE;`
   - Ensure stat normalisation block applies to the env var path (it already applies to `cwd`)
   - Update both error strings: append hint about `--workspace` and `DEV_HUB_WORKSPACE`
3. In `init.ts`:
   - Import `GlobalOptions` from `../utils/types.js`
   - Change action to `(_opts, cmd)` pattern
   - Replace `process.cwd()` with workspace-aware `targetDir`
   - Thread `targetDir` through all cwd references
4. Update `workspace.test.ts`:
   - `describe("env var")`: set/restore `DEV_HUB_WORKSPACE`, verify correct dir used
   - Test: env var file path resolved to its directory
   - Test: explicit `startDir` overrides env var
   - Test: error message includes `--workspace` hint

## Todo

- [x] Create `packages/cli/src/utils/types.ts`
- [x] Update `loadWorkspace()` — env var step
- [x] Update `loadWorkspace()` — error messages
- [x] Fix `registerInit` to respect `--workspace`
- [x] Add workspace resolution tests

## Success Criteria

- `DEV_HUB_WORKSPACE=/path/to/ws dev-hub status` loads correct workspace from `/tmp`
- `dev-hub --workspace /path/to/ws init` initialises in that directory
- Error on missing config includes `--workspace` and `DEV_HUB_WORKSPACE` hint
- All new tests pass; existing tests unchanged

## Risk Assessment

- **Low** — env var insertion is additive; no existing code paths broken
- **Medium** — `init` refactor changes action callback shape; verify `optsWithGlobals`
  works on subcommand (confirmed pattern exists in `pull.ts`)

## Security Considerations

- Env var value is a filesystem path — apply identical sanitisation (stat, resolve) as `--workspace`
- No new network surface

## Next Steps

→ Phase 02: Server Workspace Parity
