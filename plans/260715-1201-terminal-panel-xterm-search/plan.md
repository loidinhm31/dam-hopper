---
title: "Terminal panel xterm search"
description: "Add terminal-local Ctrl/Cmd+F search for the active xterm buffer with focused navigation and browser verification."
status: in_progress
priority: P2
effort: 12h
branch: main
tags: [feature, frontend, terminal, xterm, testing]
created: 2026-07-15
---

# Terminal Panel xterm Search

## Overview

Implement browser-side Find for the active visible terminal only. Use the official xterm search addon, a session-local imperative controller, a portal-mounted accessible find bar, and a small real-browser test harness. No server/API or global-search work.

## Design gates

- Read `docs/system-architecture.md`, `docs/codebase-summary.md`, `docs/code-standards.md`, and `docs/project-overview-pdr.md`.
- The architecture boundary stays client-only: PTY output already enters xterm; search reads that retained xterm buffer and does not add transport state.
- Existing terminal keep-alive/reparenting invariants remain: initialize/dispose with `TerminalPanel`; never remount for pane/tab changes; portal UI to `terminal.element`.
- Architecture documentation should be refreshed after implementation in the existing TerminalPanel/frontend sections; this planning turn does not alter source or docs.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---:|---|
| 1 | Dependency and search controller | Completed | 2h | [phase-01](./phase-01-dependency-and-search-controller.md) |
| 2 | Find bar and TerminalPanel lifecycle | Completed | 3h | [phase-02](./phase-02-find-bar-and-terminal-panel-lifecycle.md) |
| 3 | Active-pane shortcut and reparenting integration | Completed 2026-07-15 | 2h | [phase-03](./phase-03-active-pane-shortcut-and-reparenting.md) |
| 4 | Unit tests and focused Playwright harness | Pending | 3.5h | [phase-04](./phase-04-unit-and-browser-tests.md) |
| 5 | Manual matrix, docs, and release gate | Pending | 1.5h | [phase-05](./phase-05-validation-and-documentation.md) |

**Current status:** In progress — Phase 03 completed 2026-07-15.
**Next phase:** Phase 04 — Unit tests and focused Playwright harness.

## Dependencies

- Node 20+, pnpm 9+, existing `@xterm/xterm` 6.0.0.
- Compatible `@xterm/addon-search` package and lockfile update.
- Chromium/WebKit/Firefox browser availability for the focused browser test, or at minimum Chromium plus documented renderer fallback manual checks.
- Existing Rust server/dev auth bypass for optional full-app manual verification.

## Success definition

Ctrl/Cmd+F opens the bar on the active terminal, search navigation updates xterm highlights and status, no search keystrokes reach PTY input, Escape/close restores terminal focus, inactive sessions do not respond, reparenting remains intact, and unit/browser/manual checks pass.

## Planning Validation Summary

**Validated:** 2026-07-15
**Questions asked:** 3

### Confirmed decisions

- Expose the controller through the existing terminal registry entry; keep lifecycle ownership in `TerminalPanel`.
- Use an isolated browser fixture with real xterm/SearchAddon plus production controller/bar; do not require Rust/WebSocket timing.
- Close and clear search when a session becomes inactive; do not preserve hidden-session query state.

### Action items

- [ ] During Phase 01, verify the registry-entry extension does not couple search state to fit/layout concerns; use a separate registry only if that boundary fails.
- [ ] During Phase 04, keep the fixture independent of auth, server state, and real terminal output.

## Unresolved questions

None blocking. Dependency peer compatibility and browser availability are validation gates, not product decisions.
