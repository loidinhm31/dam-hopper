---
title: "Unified Commands Tab"
description: "Merge Build, Run, and Custom Commands tabs into single Commands tab with type categories and concurrent execution"
status: done
completed: 2026-03-23
priority: P1
effort: 3h
branch: master
tags: [web, commands, refactor, dx]
created: 2026-03-22
---

# Unified Commands Tab

## Summary

Replace the three separate tabs (Build, Run, Commands) in ProjectDetailPage with a single
"Commands" tab. Commands are categorized by type (build, run, custom) with filter tabs.
Users can run multiple commands simultaneously, each with its own collapsible output panel.

## Problem

1. Build/Run/Commands split across 3 tabs — context switching to manage commands
2. Can only view one command type's output at a time
3. No unified view of all executable actions for a project
4. Build and Run are implicitly "commands" but treated differently in the UI

## Phases

| Phase | Title                         | Status  | Effort | File                                            |
| ----- | ----------------------------- | ------- | ------ | ----------------------------------------------- |
| 01    | UnifiedCommandPanel Component | pending | 2h     | [phase-01](./phase-01-unified-command-panel.md) |
| 02    | ProjectDetailPage Tab Cleanup | pending | 1h     | [phase-02](./phase-02-tab-cleanup.md)           |

## Dependency Graph

```
Phase 01 (create UnifiedCommandPanel)
    ↓
Phase 02 (remove build/run tabs, wire UnifiedCommandPanel)
```

Sequential: Phase 02 depends on Phase 01.

## File Ownership Matrix

| File                                                                  | Phase |
| --------------------------------------------------------------------- | ----- |
| `packages/web/src/components/organisms/UnifiedCommandPanel.tsx` (new) | 01    |
| `packages/web/src/pages/ProjectDetailPage.tsx`                        | 02    |
| `packages/web/src/components/organisms/CommandRunner.tsx` (delete)    | 02    |

## Affected Packages

- `@dev-hub/web` — Frontend-only changes

## No Server Changes Needed

All APIs already exist: `POST /build/:project`, `POST /exec/:project`, `POST /run/:project`,
process management endpoints, SSE events.
