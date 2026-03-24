---
phase: "01"
title: "Remove Default Build/Run Commands from Terminals Page"
status: done
effort: 1.5h
---

# Phase 01: Remove Default Build/Run Commands

> Parent: [plan.md](./plan.md)

## Overview

- **Date**: 2026-03-24
- **Priority**: P2
- **Implementation status**: Done (2026-03-24)
- **Review status**: Approved (10/10)

Currently `useTerminalTree.ts` falls back to `BUILD_PRESET`/`RUN_PRESET` maps when projects don't have explicit commands configured. This shows default commands (e.g., `pnpm build`, `pnpm start`) for every project, even when the user hasn't set them in `dev-hub.toml`. The fix: remove the fallback so only user-configured commands appear.

## Key Insights

- `useTerminalTree.ts` lines 59-60 use `p.services?.[0]?.buildCommand ?? BUILD_PRESET[p.type]` — the `??` fallback is the problem
- Same pattern on lines 73-74 for run commands with `RUN_PRESET`
- `ProjectInfoPanel.tsx` `CommandsSection` already only shows `project.services?.[0]?.buildCommand` without fallback — already correct
- Core `presets.ts` must remain intact — Electron main process uses presets for execution
- The `if (buildCmd)` / `if (runCmd)` guards already handle `undefined` — no additional logic needed

## Requirements

1. Terminal tree must only show build/run commands explicitly defined in `dev-hub.toml` services
2. Custom commands (from `project.commands`) must continue to appear
3. Shell sessions must continue to appear
4. Core preset system remains untouched

## Related Code Files

| File | Role |
|------|------|
| `packages/web/src/hooks/useTerminalTree.ts` | **Primary change** — remove BUILD_PRESET/RUN_PRESET fallback |
| `packages/web/src/components/organisms/TerminalTreeView.tsx` | Renders tree — no changes needed |
| `packages/web/src/components/organisms/ProjectInfoPanel.tsx` | CommandsSection — already correct |
| `packages/core/src/config/presets.ts` | Core presets — no changes |

## Implementation Steps

### Step 1: Modify `useTerminalTree.ts`

1. Remove `BUILD_PRESET` constant (lines 26-32)
2. Remove `RUN_PRESET` constant (lines 35-41)
3. Change line 59-60: `p.services?.[0]?.buildCommand ?? BUILD_PRESET[p.type]` → `p.services?.[0]?.buildCommand`
4. Change line 73-74: `p.services?.[0]?.runCommand ?? RUN_PRESET[p.type]` → `p.services?.[0]?.runCommand`
5. Remove unused `ProjectType` import if only used by preset maps

### Step 2: Remove "preset" source from CommandPreview

- Remove the `"preset"` source option and its gray badge rendering from `CommandPreview` component
- Since no component will pass `source="preset"` anymore, this is dead code cleanup

### Step 3: Verify ProjectInfoPanel (no changes expected)

- Confirm `CommandsSection` doesn't use preset fallback

## Todo

- [ ] Remove BUILD_PRESET and RUN_PRESET from useTerminalTree.ts
- [ ] Remove preset fallback in build/run command resolution
- [ ] Remove unused imports (ProjectType if applicable)
- [ ] Verify ProjectInfoPanel CommandsSection is unaffected
- [ ] Test: project without services shows no build/run in tree
- [ ] Test: project with explicit services shows commands correctly
- [ ] Test: custom commands and shell sessions unaffected

## Success Criteria

- Projects without explicit `services` in `dev-hub.toml` show zero build/run commands in tree
- Projects with explicit `services[0].buildCommand` still show build command
- Custom commands and shell sessions unaffected
- Core preset system untouched

## Risk Assessment

- **Low risk**: 2 lines of logic change + constant removal in one file
- **Regression**: Users who relied on seeing preset commands in tree will no longer see them (desired behavior)
