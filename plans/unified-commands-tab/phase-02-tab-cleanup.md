---
parent: plan.md
phase: "02"
status: done
completed: 2026-03-23
priority: P1
effort: 1h
depends_on: ["01"]
---

# Phase 02: ProjectDetailPage Tab Cleanup

## Context

- Parent: [plan.md](./plan.md)
- Depends on: [Phase 01](./phase-01-unified-command-panel.md)

## Overview

Remove "Build" and "Run" tabs from ProjectDetailPage, replace "Commands" tab content
with `UnifiedCommandPanel`, and clean up unused imports.

**Status:** pending | **Priority:** P1

## Key Insights

- `Tab` type union (line 30): remove `"build"` and `"run"` → `"overview" | "git" | "worktrees" | "commands"`
- `tabs` array (lines 76-83): remove build/run entries
- Build tab content (lines 382-418): moved to UnifiedCommandPanel
- Run tab content (lines 420-470): moved to UnifiedCommandPanel
- Commands tab content (lines 471-473): replace `<CommandRunner>` with `<UnifiedCommandPanel>`
- Multiple imports become unused after removal

## Requirements

### 1. Update Tab Type and Array

```typescript
type Tab = "overview" | "git" | "worktrees" | "commands";
```

Remove `{ key: "build", label: "Build" }` and `{ key: "run", label: "Run" }` from tabs array.

### 2. Remove Build/Run Tab Content

Delete the `{tab === "build" && (...)}` block (lines 382-418).
Delete the `{tab === "run" && (...)}` block (lines 420-470).

### 3. Replace Commands Tab Content

```tsx
{
  tab === "commands" && <UnifiedCommandPanel project={project} />;
}
```

### 4. Clean Up Imports

Remove unused:

- `BuildLog` from `@/components/organisms/BuildLog.js`
- `CommandRunner` from `@/components/organisms/CommandRunner.js`
- `CommandPreview` from `@/components/atoms/CommandPreview.js`
- `getEffectiveCommand` from `@/lib/presets.js`
- `useBuild`, `useStartProcess`, `useStopProcess`, `useRestartProcess`, `useProcessLogs` from `@/api/queries.js`

Add:

- `UnifiedCommandPanel` from `@/components/organisms/UnifiedCommandPanel.js`

### 5. Update Badge Count

Current: `cmdCount = Object.keys(project.commands ?? {}).length`
New: include build + run as built-in commands → `cmdCount + 2`

### 6. Delete CommandRunner.tsx

`packages/web/src/components/organisms/CommandRunner.tsx` — logic fully absorbed by Phase 01.

## Related Code Files

| File                                                            | Action                              |
| --------------------------------------------------------------- | ----------------------------------- |
| `packages/web/src/pages/ProjectDetailPage.tsx`                  | Modify: remove tabs, swap component |
| `packages/web/src/components/organisms/CommandRunner.tsx`       | Delete                              |
| `packages/web/src/components/organisms/UnifiedCommandPanel.tsx` | Import (created in Phase 01)        |

## Implementation Steps

1. Replace imports: remove old, add `UnifiedCommandPanel`
2. Update `Tab` type: remove `"build"` | `"run"`
3. Update `tabs` array: remove build/run entries, update commands badge
4. Remove `useProcessLogs` call (line 44) — no longer needed at page level
5. Remove hook variables: `build`, `startProcess`, `stopProcess`, `restartProcess`
6. Delete build tab content block
7. Delete run tab content block
8. Replace commands tab content with `<UnifiedCommandPanel project={project} />`
9. Delete `CommandRunner.tsx`

## Todo

- [ ] Update imports
- [ ] Update Tab type and tabs array
- [ ] Remove build/run tab content
- [ ] Replace commands content with UnifiedCommandPanel
- [ ] Remove unused hook calls
- [ ] Delete CommandRunner.tsx
- [ ] Verify no TypeScript errors

## Success Criteria

- Only 4 tabs visible: Overview, Git, Worktrees, Commands
- Commands tab renders UnifiedCommandPanel with all functionality
- No unused imports or dead code
- `pnpm build` passes in `packages/web`
- CommandRunner.tsx deleted

## Risk Assessment

- **Low**: Mostly deletion + import swapping
- Ensure no other file imports `CommandRunner` (unlikely, only used in ProjectDetailPage)

## Security Considerations

- No new security surface — just reorganizing existing UI
