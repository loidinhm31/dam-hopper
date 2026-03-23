---
parent: plan.md
phase: 01
status: done
priority: P1
effort: 1.5h
---

# Phase 01: Schema & Presets — Services + Custom Commands

## Context

- Parent: [plan.md](./plan.md)
- Dependencies: None (foundation phase)
- Docs: [codebase-summary.md](../../docs/codebase-summary.md)

## Overview

Extend `ProjectConfigSchema` to support services (sub-processes) and custom commands. Update presets to resolve commands from services.

## Key Insights

- User chose to **remove** old `build_command`/`run_command` fields entirely
- Projects with NO services should still fall back to presets
- Services run in parallel within a project (like frontend + backend dev servers)
- Custom commands are arbitrary key-value pairs (test, lint, migrate, etc.)

## Requirements

1. Add `ServiceConfigSchema` with name, build_command, run_command fields
2. Add `services` array to `ProjectConfigSchema`
3. Add `commands` record to `ProjectConfigSchema` for custom named commands
4. Remove old `build_command` and `run_command` from `ProjectConfigSchema`
5. Update `getEffectiveCommand()` to handle service-based projects
6. Add `getProjectServices()` helper that returns resolved services (from explicit or preset fallback)
7. Update `writeConfig()` serialization to handle new fields

## Architecture

### New TOML Format

```toml
[[projects]]
name = "my-app"
path = "./my-app"
type = "pnpm"

[[projects.services]]
name = "frontend"
run_command = "pnpm dev:frontend"
build_command = "pnpm build:frontend"

[[projects.services]]
name = "backend"
run_command = "pnpm dev:backend"
build_command = "pnpm build:backend"

[projects.commands]
test = "pnpm test"
lint = "pnpm lint"
migrate = "pnpm db:migrate"
```

### New Types

```typescript
interface ServiceConfig {
  name: string;
  buildCommand?: string;
  runCommand?: string;
}

interface ProjectConfig {
  name: string;
  path: string;
  type: ProjectType;
  services?: ServiceConfig[]; // NEW
  commands?: Record<string, string>; // NEW
  envFile?: string;
  tags?: string[];
}
```

### Resolution Logic

- Project with services → use services array
- Project without services → create implicit single service from preset (name = "default")

## Related Code Files

- `packages/core/src/config/schema.ts` — Zod schemas (main changes)
- `packages/core/src/config/presets.ts` — getEffectiveCommand, getPreset
- `packages/core/src/config/parser.ts` — writeConfig serialization
- `packages/core/src/config/index.ts` — barrel exports

## Implementation Steps

1. **Add ServiceConfigSchema** to schema.ts
   - Zod object: name (string, min 1), build_command (optional string), run_command (optional string)
   - Transform snake_case → camelCase

2. **Update ProjectConfigSchema**
   - Remove `build_command` and `run_command` fields
   - Add `services: z.array(ServiceConfigSchema).optional()`
   - Add `commands: z.record(z.string()).optional()`

3. **Update presets.ts**
   - Add `getProjectServices(project): ServiceConfig[]`
     - If project.services exists and non-empty → return them
     - Else → return single service `{ name: "default", buildCommand: preset.buildCommand, runCommand: preset.runCommand }`
   - Update `getEffectiveCommand()` to work with services or deprecate in favor of `getProjectServices()`

4. **Update parser.ts writeConfig()**
   - Serialize services array back to snake_case TOML
   - Serialize commands record

5. **Update tests**
   - `schema.test.ts`: add tests for services and commands validation
   - `presets.test.ts`: add tests for getProjectServices resolution
   - `parser.test.ts`: add round-trip tests for new fields

## Todo

- [ ] Add ServiceConfigSchema to schema.ts
- [ ] Update ProjectConfigSchema (remove old fields, add services + commands)
- [ ] Export new types from config/index.ts
- [ ] Add getProjectServices() to presets.ts
- [ ] Update writeConfig() in parser.ts
- [ ] Update schema.test.ts
- [ ] Update presets.test.ts
- [ ] Update parser.test.ts

## Success Criteria

- `ProjectConfig` type includes `services` and `commands`
- Old `buildCommand`/`runCommand` removed from ProjectConfig
- `getProjectServices()` returns preset-based default service for projects without services
- TOML round-trip works (read → write → read produces same result)
- All existing tests updated and passing

## Risk Assessment

- **Breaking change**: Removing build_command/run_command breaks all consumers (CLI, server, build service, run service)
- **Mitigation**: This phase is foundational — all subsequent phases update consumers

## Security Considerations

- Config parsing already validates via Zod — new fields follow same pattern
- No user input from network in this phase
