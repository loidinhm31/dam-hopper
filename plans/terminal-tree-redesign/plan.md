---
title: "Terminal Tree Redesign"
description: "Remove redundant pages, build unified Terminals page with project tree, context-switching panel, multi-terminal tabs, and ad-hoc shell support"
status: done
completed: 2026-03-24
priority: P1
effort: 8h
branch: master
tags: [web, electron, terminal, pty, ux, refactor]
created: 2026-03-24
---

# Terminal Tree Redesign

## Summary

Consolidate the app into fewer, more powerful pages: (1) remove BuildPage, ProjectsPage, ProjectDetailPage, and ProcessesPage, (2) build a unified Terminals page with a project tree sidebar, context-switching right panel (project info OR terminal output), tabbed multi-terminal display, ad-hoc shell support with auto-save, and hybrid terminal mounting strategy.

## Problem

1. BuildPage duplicates functionality already in UnifiedCommandPanel
2. ProjectDetailPage tabs hide content — user must click between Git, Worktrees, Commands
3. ProcessesPage shows only raw session IDs with no metadata
4. No way to view multiple terminals simultaneously or navigate between them
5. Too many pages for what should be a unified workflow
6. PtySessionManager stores no metadata — only the IPty object and scrollback buffer

## Phases

| Phase | Title                        | Status  | Effort | File                                                    |
| ----- | ---------------------------- | ------- | ------ | ------------------------------------------------------- |
| 01    | Remove Redundant Pages       | done    | 30m    | [phase-01](./phase-01-remove-redundant-pages.md)        |
| 02    | IPC Session Metadata         | done    | 1h     | [phase-02](./phase-02-ipc-session-metadata.md)          |
| 03    | CollapsibleSection Component | done    | 30m    | [phase-03](./phase-03-collapsible-section-component.md) |
| 04    | Unified Terminals Page       | done    | 5h     | [phase-04](./phase-04-unified-terminals-page.md)        |
| 05    | Cleanup & Integration        | done    | 1h     | [phase-05](./phase-05-cleanup-integration.md)           |

## Dependency Graph

```
Phase 01 (remove pages) ──────────────────────────────┐
Phase 02 (IPC metadata) ──┬── Phase 04 (terminals) ───┤── Phase 05 (cleanup)
Phase 03 (collapsible)  ──┘                            │
```

Phases 01, 02, 03 can run in parallel. Phase 04 depends on 02, 03. Phase 05 depends on all.

## File Ownership Matrix

| File                                                              | Phase  |
| ----------------------------------------------------------------- | ------ |
| `packages/web/src/pages/BuildPage.tsx` (delete)                   | 01     |
| `packages/web/src/pages/ProjectsPage.tsx` (delete)                | 01     |
| `packages/web/src/pages/ProjectDetailPage.tsx` (delete)           | 01     |
| `packages/web/src/pages/ProcessesPage.tsx` (delete)               | 01     |
| `packages/web/src/App.tsx`                                        | 01, 04 |
| `packages/web/src/components/organisms/Sidebar.tsx`               | 01, 04 |
| `packages/electron/src/main/pty/session-manager.ts`               | 02     |
| `packages/electron/src/ipc-channels.ts`                           | 02     |
| `packages/electron/src/main/ipc/terminal.ts`                      | 02     |
| `packages/electron/src/preload/index.ts`                          | 02     |
| `packages/web/src/types/electron.d.ts`                            | 02     |
| `packages/web/src/api/queries.ts`                                 | 02, 04 |
| `packages/web/src/components/atoms/CollapsibleSection.tsx` (new)  | 03     |
| `packages/web/src/pages/TerminalsPage.tsx` (new)                  | 04     |
| `packages/web/src/components/organisms/TerminalTreeView.tsx` (new)     | 04 |
| `packages/web/src/components/organisms/ProjectInfoPanel.tsx` (new)     | 04 |
| `packages/web/src/components/organisms/TerminalTabBar.tsx` (new)       | 04 |
| `packages/web/src/components/organisms/MultiTerminalDisplay.tsx` (new) | 04 |
| `packages/web/src/hooks/useTerminalTree.ts` (new)                 | 04     |
| `packages/web/src/pages/DashboardPage.tsx`                        | 05     |

## Affected Packages

- `@dev-hub/web` — All phases
- `@dev-hub/electron` — Phase 02 only (session metadata + IPC)

## Validated Decisions (2026-03-24)

1. **Layout**: Dedicated `/terminals` page (not persistent bottom panel)
2. **Terminal switching**: Hybrid — keep up to 5 MRU terminals mounted, evict oldest
3. **Right panel**: Context-switching — project node shows info, terminal node shows output
4. **Ad-hoc shells**: '+ Shell' per project, auto-saved to dev-hub.toml custom commands
5. **Page consolidation**: Remove /projects, /projects/:name, /build, /processes — tree replaces all
