---
title: "Stabilize terminal rendering and controlled menu state"
description: "Eliminate terminal WebGL context exhaustion and React/Radix controlled-state warnings without changing HTTP deployment behavior."
status: completed
priority: P1
effort: 5h
branch: main
tags: [bugfix, frontend, performance, accessibility]
created: 2026-07-18
---

# Terminal renderer and menu-state fixes

## Scope

Fix Git branch Select controlledness, bound xterm WebGL to visible panes, and open lifted Radix menus only through their trigger event. HTTP mixed content is explicitly out of scope.

## Design

- A Git Select always receives a string; empty string means no selected branch.
- Retained terminals use the DOM renderer unless their session is active in a visible pane. WebGL activation has no canvas capability probe; addon initialization is the capability test.
- Lifted menus begin closed. Their existing synthetic `contextmenu` event causes Radix to open and anchor them.

## Dependency graph

```text
Phase 01 Select ───────┐
Phase 02 WebGL ────────┼──> Phase 04 validation and review
Phase 03 Context menus ┘
```

## Execution strategy

Phases 01–03 are independent and can run in parallel. Phase 04 runs after all three. No architecture-doc update: these are localized bug fixes and add no new state contract.

## File ownership

| Phase | Exclusive files |
| --- | --- |
| 01 | `GitBranchControl.tsx`, `GitBranchControl.test.tsx` |
| 02 | `TerminalPanel.tsx`, `TerminalKeepAliveHost.tsx`, `MultiTerminalDisplay.tsx`, `terminal-renderer.ts`, `terminal-renderer.test.ts`, `TerminalKeepAliveHost.test.tsx` |
| 03 | `GitBranchContextMenu.tsx`, `GitBranchContextMenu.test.tsx`, `TerminalDiagnosticsContextMenu.tsx`, `TerminalDiagnosticsContextMenu.test.tsx` |
| 04 | No edits; focused tests, UI package test/type/build, browser smoke, review |

## Phases

| # | Phase | Status | Parallel group | Link |
| --- | --- | --- | --- | --- |
| 01 | Keep branch Select controlled | Done | A | [phase 01](./phase-01-keep-branch-select-controlled.md) |
| 02 | Bound WebGL to visible terminal panes | Done | A | [phase 02](./phase-02-bound-webgl-to-visible-panes.md) |
| 03 | Anchor lifted context menus through triggers | Done | A | [phase 03](./phase-03-anchor-lifted-context-menus.md) |
| 04 | Validate and review | Done | B | [phase 04](./phase-04-validate-and-review.md) |

## Research

- [Terminal renderer research](./research/researcher-01-terminal-renderer.md)
- [Select and menu research](./research/researcher-02-select-and-context-menu.md)
- [Fallback scout](./scout/fallback-scout.md)

## Unresolved questions

- Browser smoke requires a desktop Chromium run with more sessions than its WebGL context limit; unit tests establish the renderer budget deterministically.
