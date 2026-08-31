---
title: "Preserve Explorer Tree Expansion & Editor View Scroll Position"
description: "Persist expanded Explorer directory tree across unmounts/reloads and ensure editor line position/viewState is preserved"
status: in_progress
priority: P2
effort: 4h
branch: develop
tags: [explorer, file-tree, editor, monaco, zustand, persistence]
created: 2026-08-31
---

# Preserve Explorer Tree Expansion & Editor View Scroll Position

## Overview
Preserve the expanded directory tree in the Explorer panel across sidebar tool switches, sidebar collapse/open, workspace mode toggles, and page reloads. In addition, ensure that the active file in the editor view preserves its line position and scroll state across tab switches, unmounts, and page reloads.

## Phases

| # | Phase | Status | Effort | Link |
|---|-------|--------|--------|------|
| 1 | Explorer Tree Expansion Store | Complete (2026-08-31) | 2h | [phase-01](./phase-01-explorer-tree-expansion-store.md) |
| 2 | Editor ViewState Persistence | Pending | 1h | [phase-02](./phase-02-editor-viewstate-persistence.md) |
| 3 | Integration & Verification | Pending | 1h | [phase-03](./phase-03-integration-and-verification.md) |

## Dependencies
- `react-arborist` (`Tree`, `initialOpenState`, `onToggle`)
- `@dam-hopper/ui` Zustand stores (`zustand/middleware` `persist`)
- Monaco editor (`ICodeEditorViewState`)
