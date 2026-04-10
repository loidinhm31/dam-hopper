---
title: "Combine IDE + Terminals into Unified Workspace"
description: "Merge IdePage and TerminalsPage into single WorkspacePage with tabbed sidebar, multi-terminal bottom panel, and feature-flag-gated editor"
status: done
priority: P2
effort: 6h
branch: main
tags: [frontend, refactor, layout]
created: 2026-04-10
---

# Combine IDE + Terminals into Unified Workspace

## Overview

Merge two separate pages (IdePage: file tree + editor + single terminal, TerminalsPage: terminal tree + multi-terminal management) into a single `WorkspacePage` that provides a unified development environment.

## Architecture Decision

**Layout:** Keep IdeShell's 3-panel structure (left sidebar | editor | terminal bottom). Left panel gets a tab switcher (Files / Terminals). Bottom panel replaces simple TerminalDock with full multi-terminal (tabs + session management). When `ide_explorer` flag is off, Files tab and editor are hidden — page degrades to terminal-only mode.

**State:** Extract TerminalsPage's 727 LOC state into `useTerminalManager` hook. Editor state already lives in Zustand (`useEditorStore`) — no changes needed.

**Routing:** Single `/workspace` route replaces both `/ide` and `/terminals`. Old routes redirect for backward compat. `Ctrl+backtick` shortcut updated.

## Phases

| # | Phase | Status | Effort | Link |
|---|-------|--------|--------|------|
| 1 | Extract terminal state into hook | Done | 1.5h | [phase-01](./phase-01-extract-terminal-hook.md) |
| 2 | Create WorkspacePage with tabbed sidebar | Done | 2h | [phase-02-workspace-page.md](./phase-02-workspace-page.md) |
| 3 | Integrate multi-terminal into bottom panel | Done | 1.5h | [phase-03-multi-terminal-panel.md](./phase-03-multi-terminal-panel.md) |
| 4 | Update routing, nav, shortcuts & cleanup | Done | 1h | [phase-04-routing-cleanup.md](./phase-04-routing-cleanup.md) |

## Dependencies

- No backend changes required — all frontend refactor
- Feature flag `ide_explorer` behavior preserved
- Existing organism components (MultiTerminalDisplay, TerminalTabBar, TerminalTreeView, FileTree, EditorTabs) remain unchanged

## Research

- [UI Layout Research](./research/researcher-01-ui-layout.md)
- [Terminal State Research](./research/researcher-02-terminal-state.md)
