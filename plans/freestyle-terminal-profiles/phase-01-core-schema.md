---
parent: ./plan.md
phase: 1
status: done
completed: 2026-03-25
---

# Phase 01: Core Schema & Config

## Overview
Extend @dev-hub/core config to support `[[projects.terminals]]` — saved terminal profiles per project with name, command, and cwd.

## Context
- Config schema: `packages/core/src/config/schema.ts`
- Config parser: `packages/core/src/config/parser.ts`
- Core exports: `packages/core/src/index.ts`

## Key Insights
- `commands` field (`Record<string, string>`) is too flat for profiles with cwd metadata
- New `terminals` array on ProjectConfig is cleaner than extending `commands`
- cwd stored relative to **project root** (not workspace root) on disk, resolved to absolute at runtime
- Must coexist with existing `commands` field (no removal)

## Requirements
- Add `TerminalProfile` type with name, command, cwd
- Add `terminals` optional array to ProjectConfigSchema
- Handle TOML serialization (cwd relative to project path)
- Backward compatible: missing `[[projects.terminals]]` = empty array
- Unique terminal profile names per project

## Architecture

### New Type
```typescript
export interface TerminalProfile {
  name: string;       // Display name (unique within project)
  command: string;    // Shell command to run
  cwd: string;        // Working directory (relative to project root on disk, absolute at runtime)
}
```

### Zod Schema
```typescript
export const TerminalProfileSchema = z.object({
  name: z.string().min(1, "Terminal profile name must not be empty"),
  command: z.string().min(1, "Command must not be empty"),
  cwd: z.string().min(1, "Working directory must not be empty"),
});
```

### ProjectConfigSchema Extension
```typescript
// Add to existing ProjectConfigSchema object:
terminals: z.array(TerminalProfileSchema).optional(),

// In transform:
terminals: p.terminals ?? [],
```

### TOML Format
```toml
[[projects]]
name = "api-server"
path = "./api-server"
type = "npm"

[[projects.terminals]]
name = "Claude Agent"
command = "claude"
cwd = "./src"

[[projects.terminals]]
name = "Dev Server"
command = "pnpm dev"
cwd = "."
```

### Parser Changes
- `readConfig()`: Resolve terminal `cwd` from relative → absolute using `path.resolve(projectAbsPath, terminal.cwd)`
- `writeConfig()`: Convert terminal `cwd` from absolute → relative using `path.relative(projectAbsPath, terminal.cwd)`
- Default `terminals` to `[]` if missing

## Implementation Steps

1. Add `TerminalProfileSchema` to `schema.ts`
2. Add `terminals` field to `ProjectConfigSchema` with `.optional()`
3. Add `.refine()` for unique terminal names per project
4. Update `readConfig()` — resolve terminal cwd paths (relative → absolute, anchored on project path)
5. Update `writeConfig()` — serialize terminal cwd paths (absolute → relative to project path)
6. Update `ApiProjectSchema` to include `terminals` field
7. Export `TerminalProfile` type from `packages/core/src/index.ts`
8. Add tests for terminal profile validation and round-trip serialization

## Related Code Files
- `packages/core/src/config/schema.ts:28-57` — ProjectConfigSchema
- `packages/core/src/config/parser.ts:31-67` — readConfig (project path resolution)
- `packages/core/src/config/parser.ts:69-121` — writeConfig (project path relativization)
- `packages/core/src/config/schema.ts:73-93` — ApiProjectSchema

## Success Criteria
- [x] `TerminalProfile` type exported from @dev-hub/core
- [x] Zod validation: non-empty name, command, cwd
- [x] Unique terminal names per project via refine
- [x] readConfig resolves terminal cwd to absolute (based on project path)
- [x] writeConfig converts terminal cwd to relative (based on project path)
- [x] Missing `[[projects.terminals]]` defaults to empty array
- [x] Round-trip test: write → read preserves terminal profiles
- [x] Existing configs without terminals still parse correctly

## Risk Assessment
- **Low**: Additive schema change, no breaking changes
- smol-toml handles `[[projects.terminals]]` array-of-tables natively
