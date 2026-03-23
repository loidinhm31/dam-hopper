---
parent: plan.md
phase: "03"
status: done
priority: P1
effort: 1.5h
depends_on: ["01"]
---

# Phase 03: Build & Run Command Visibility

## Context

- Parent: [plan.md](./plan.md)
- Depends on: [Phase 01](./phase-01-api-client-hooks.md) (api hooks)
- Research: [exec-flow](./research/researcher-01-exec-flow.md)

## Parallelization Info

- **Group**: B (runs after Phase 01)
- **Can run with**: Phase 02 (no file overlap)
- **Blocked by**: Phase 01

## Overview

Show effective build/run commands in the Build and Run tabs so users know exactly
what will execute. Display the resolved command (from service config or preset
fallback) and indicate its source.

**Status:** done | **Review:** approved | **Date:** 2026-03-22

## Key Insights

- Build tab currently shows only a "Build" button — no command preview
- Run tab shows Start/Stop/Restart — no command preview
- `ProjectWithStatus` includes `services` and `type` — enough to resolve effective command client-side
- Core's `getEffectiveCommand()` logic: first service's buildCommand/runCommand → preset fallback
- Presets are static and known — can replicate logic client-side or add API endpoint
- Simplest approach: replicate preset lookup in web client (presets are just a static map)

## Requirements

### 1. Command Preview in Build Tab

Show the effective build command before the "Build" button:

```
Build command: pnpm build (from preset: pnpm)
[Build project-name]
```

If user has custom service buildCommand, show:

```
Build command: npm run build:prod (custom)
[Build project-name]
```

### 2. Command Preview in Run Tab

Show the effective run command:

```
Run command: pnpm start (from preset: pnpm)
[Start] [Stop] [Restart]
```

### 3. Preset Map in Web Client

Add a simple preset lookup utility so the web client can resolve effective commands
without an extra API call:

```typescript
// packages/web/src/lib/presets.ts
const PRESETS: Record<ProjectType, { build: string; run: string }> = {
  maven: { build: "mvn clean install -DskipTests", run: "mvn spring-boot:run" },
  // ... etc
};

function getEffectiveCommand(
  project: ProjectConfig,
  type: "build" | "run",
): {
  command: string;
  source: "service" | "preset";
};
```

### 4. Editable Command Override (Optional Enhancement)

In the Build tab, show the command in an editable field so users can override it
for a one-off execution (without persisting). This is stretch — core scope is
display-only.

## Architecture

```
Build Tab:
  ├── CommandPreview (command string + source badge)
  ├── Build button (existing)
  └── BuildLog (existing)

Run Tab:
  ├── CommandPreview (command string + source badge)
  ├── Start/Stop/Restart buttons (existing)
  └── Process Logs (existing)
```

## File Ownership

| File                                   | Action                                              |
| -------------------------------------- | --------------------------------------------------- |
| `packages/web/src/lib/presets.ts`      | New: preset map + getEffectiveCommand utility       |
| `packages/web/src/pages/BuildPage.tsx` | Add command preview to Build tab (if separate page) |

**Note:** Build/Run tabs are currently inline in `ProjectDetailPage.tsx`. Since Phase 02
owns that file, this phase needs coordination. **Resolution:** Phase 03 creates the
`presets.ts` utility and a `CommandPreview` component. Phase 02 imports and places them
in the Build/Run tab sections when adding the Commands tab.

**Updated approach — to avoid file conflict:**

- Phase 03 creates the shared utility and component
- Phase 02 integrates CommandPreview into Build/Run tab sections of ProjectDetailPage

| File                                                   | Action                                       |
| ------------------------------------------------------ | -------------------------------------------- |
| `packages/web/src/lib/presets.ts`                      | New: preset map + effective command resolver |
| `packages/web/src/components/atoms/CommandPreview.tsx` | New: display component for command + source  |

## Implementation Steps

1. Create `packages/web/src/lib/presets.ts`:
   - Copy preset map from core (static data, no import needed)
   - `getEffectiveCommand(project, "build" | "run")` → `{ command, source }`
   - Source logic: if service[0].buildCommand → "service", else → "preset"

2. Create `packages/web/src/components/atoms/CommandPreview.tsx`:
   - Props: `{ command: string; source: "service" | "preset"; label: string }`
   - Renders: monospace command + colored source badge
   - Example: `Build: pnpm build [preset]`

3. Phase 02 will import and use these in ProjectDetailPage's Build/Run tab sections

## Todo

- [ ] Create `presets.ts` utility with preset map
- [ ] Implement `getEffectiveCommand()` function
- [ ] Create `CommandPreview` component
- [ ] Document integration point for Phase 02

## Success Criteria

- `getEffectiveCommand(project, "build")` returns correct command + source
- `CommandPreview` renders command string with source indicator
- Works for all project types (maven, gradle, npm, pnpm, cargo, custom)

## Conflict Prevention

- Creates new files only (`presets.ts`, `CommandPreview.tsx`)
- Does NOT modify ProjectDetailPage.tsx (Phase 02 handles integration)
- Phase 02 imports from these files — one-directional dependency

## Risk Assessment

- **Low**: Static data + pure function + presentational component
- Preset values must stay in sync with core — but they change rarely

## Security Considerations

- Display-only — no command execution in this phase
- Preset data is hardcoded, not user-supplied
