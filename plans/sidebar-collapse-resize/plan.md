---
title: "Collapsible Sidebar + Resizable TreeView"
description: "Add sidebar collapse/expand and draggable resize for terminal tree panel"
status: in-progress
priority: P2
effort: 3h
branch: master
tags: [ui, layout, sidebar, resize]
created: 2026-03-24
---

# Collapsible Sidebar + Resizable TreeView

## Summary

Two UI enhancements: (1) collapsible main sidebar across all pages, (2) draggable resize handle for the terminal tree panel on TerminalsPage.

## Architecture Note

- **AppLayout pages** (Dashboard, Git, Settings): `AppLayout` renders `<Sidebar />` + `<main>`. Sidebar fixed at `w-60`.
- **TerminalsPage**: Renders `<Sidebar />` directly in `flex h-screen` alongside tree panel (`w-56`) + flex-1 content.
- Both patterns need collapsible sidebar. Resize handle only on TerminalsPage tree panel.

## Phases

| # | Phase | Status | Effort | File |
|---|-------|--------|--------|------|
| 01 | [Collapsible Sidebar](./phase-01-collapsible-sidebar.md) | done (2026-03-24) | 1.5h | Sidebar.tsx, AppLayout.tsx, TerminalsPage.tsx |
| 02 | [Resizable Terminal TreeView](./phase-02-resizable-treeview.md) | done (2026-03-24) | 1h | TerminalsPage.tsx, useResizeHandle.ts (new) |
| 03 | [Persistence & Polish](./phase-03-persistence-polish.md) | done (2026-03-24) | 0.5h | AppLayout.tsx, TerminalsPage.tsx |

## Key Decisions

- **No external library** -- resize via native mouse events, sidebar via CSS transition
- **localStorage persistence** -- `devhub:sidebar-collapsed`, `devhub:tree-width`
- **Collapsed width**: 48px icon rail
- **Tree resize range**: 160px min, 400px max, 224px default
- Sidebar state shared via localStorage across AppLayout + TerminalsPage

## Files Overview

| File | Changes |
|------|---------|
| `packages/web/src/components/organisms/Sidebar.tsx` | Collapse toggle, icon-only mode, transition |
| `packages/web/src/components/templates/AppLayout.tsx` | Manage collapsed state, persist |
| `packages/web/src/pages/TerminalsPage.tsx` | Sidebar collapse + tree resize handle |
| `packages/web/src/hooks/useResizeHandle.ts` | New hook: drag logic with min/max/persist |
| `packages/web/src/index.css` | Optional resize handle styles |
