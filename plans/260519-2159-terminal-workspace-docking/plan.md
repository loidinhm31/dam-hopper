---
title: "Terminal Workspace Docking"
description: "Add a full-page terminal workspace mode with Fleet Terminal controls, configurable shortcut, and advanced terminal docking UX."
status: completed
priority: P1
effort: 30h
issue:
branch: main
tags: [feature, frontend, terminal, ux]
created: 2026-05-19
---

# Terminal Workspace Docking

## Overview

Add a `Terminal Workspace` mode to `WorkspacePage` so users can use terminal as the main workspace while keeping Fleet Terminal controls available. Keep the current IDE workspace intact. Add configurable shortcut for IDE/Terminal mode switching. Improve split terminal drag/drop into advanced docking behavior.

Primary outcomes:

- Terminal can fill the workspace body below top nav.
- Fleet Terminal remains visible as right control rail in terminal mode.
- Users can switch IDE/Terminal modes by button and configurable shortcut.
- Existing terminal sessions survive mode switching with no duplicate PTY creation.
- Drag/drop supports clear docking previews, edge splits, tab moves, and tab reorder.

Plan progress: 4/5 phases complete (80%).

## Phases

| # | Phase | Status | Effort | Link |
| --- | --- | --- | --- | --- |
| 1 | Workspace Mode Shell | Completed | 6h | [phase-01](./phase-01-workspace-mode-shell.md) |
| 2 | Configurable Mode Shortcut | Completed 2026-05-19 23:43 | 5h | [phase-02](./phase-02-configurable-mode-shortcut.md) |
| 3 | Terminal Workspace Layout | Completed 2026-05-20 00:33 | 7h | [phase-03](./phase-03-terminal-workspace-layout.md) |
| 4 | Advanced Terminal Docking | Completed 2026-05-20 01:25 | 9h | [phase-04](./phase-04-advanced-terminal-docking.md) |
| 5 | Verification and Docs | Pending | 3h | [phase-05](./phase-05-verification-and-docs.md) |

## Dependencies

- Existing IDE shell: `packages/web/src/components/templates/IdeShell.tsx`.
- Existing workspace composition: `packages/web/src/components/pages/WorkspacePage.tsx`.
- Existing terminal manager: `packages/web/src/hooks/useTerminalManager.ts`.
- Existing terminal split system: `useTerminalLayout`, `SplitLayout`, `PaneContainer`, `TabBar`.
- Existing shortcut and UI config plumbing: `shortcuts.ts`, `settings.ts`, Rust `UiConfig`.

## Design Decisions

- Use `workspaceMode: "ide" | "terminal"` persisted in localStorage, not backend config. It is layout state, not cross-device preference.
- Use global UI config only for `terminalWorkspaceShortcut`.
- Default shortcut: `Mod+Shift+Backquote`. Keep `Ctrl+Backquote` for new terminal and make it exact so it does not conflict.
- Keep Fleet Terminal visible in terminal mode.
- Keep existing binary split tree and `@dnd-kit/core`; do not replace pane framework.
- Improve docking in focused local modules instead of rewriting terminal lifecycle.

## Success Criteria

- IDE mode retains current Explorer, editor, bottom terminal, Git, Ports, and Fleet behavior.
- Terminal mode shows terminal split workspace full-height with Fleet Terminal rail.
- Mode button and shortcut both switch modes.
- Terminal sessions do not remount into duplicate PTYs during mode changes.
- Advanced docking previews are understandable before drop.
- Tab move, tab reorder, edge split, empty-pane drop, and pane cleanup work.
- `pnpm --filter @dam-hopper/web test` and `pnpm build` pass.

## Unresolved Questions

- Should terminal workspace mode be restorable from URL query later for shareable deep links?
- Should advanced docking include saved named layouts later, or stay per-browser persisted layout only?
