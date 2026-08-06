---
title: "Mobile floating workspace panel menu"
description: "Replace compact workspace bottom tabs with a safe-area-aware floating panel selector while preserving desktop layouts."
status: completed
priority: P2
effort: 6h
branch: main
tags: [feature, frontend, accessibility, responsive]
created: 2026-08-06
---

# Mobile Floating Workspace Panel Menu

## Overview

On compact workspaces (`max-width: 1280px`), keep one active surface and replace the full-width bottom grid with a floating **Panels** selector. Remove the redundant companion subtitle/header in the normal path; preserve optional toolbar actions in a slim row. Desktop `IdeShell` and `TerminalWorkspaceShell` remain unchanged.

## Preflight Contract

- **Output:** compact shell floating selector, reduced header footprint, focused tests, existing component-contract doc update.
- **Acceptance:** all mode-specific surfaces reachable; selection updates active surface and closes menu; active item exposed; Escape/outside dismiss; no bottom grid; empty state safe; desktop shells unchanged; 320/375/666 px layouts fit without clipping or blocked critical controls.
- **Scope:** `MobileWorkspaceShell`, compact navigation tests, existing compact component docs. Preserve `WorkspacePage` surface ownership and one-surface-at-a-time model.
- **Non-goals:** desktop panel redesign; terminal Git/Ports/Fleet overlay redesign; persistence, API, PTY, auth, or breakpoint changes; new menu dependency; new architecture/design/roadmap docs.
- **Public/risk areas:** controlled shell props, focus return, safe-area offsets, z-index/portal behavior, Browser keep-alive, terminal/accessory-bar overlap, reduced motion.
- **Testing:** SSR/unit contracts, project-native Chromium interaction/layout checks, existing workspace regression, UI typecheck, targeted lint.
- **Open question:** “panel” assumed to mean every compact IDE/terminal workspace surface. If implementation evidence points only to terminal Git/Ports/Fleet panels, stop and confirm scope before coding.

## Key Insights

- `WorkspacePage` already owns mode-specific surface arrays and active-surface fallback; no state-model change needed.
- Existing Radix `Select` wrapper supplies accessible open/dismiss/focus/selection behavior without a dependency.
- Supplied untrusted artifact metadata identifies the current 52 px companion row; do not infer absent artifact contents.
- `docs/system-architecture.md` needs no change: no persistent state, dataflow, API, or lifecycle boundary changes.

## Phases

| # | Phase | Status | Effort | Progress | Link |
|---|---|---|---:|---:|---|
| 1 | Compact selector and header | Complete | 3h | 100% | [phase-01](./phase-01-compact-selector-and-header.md) |
| 2 | Interaction and responsive tests | Complete | 2h | 100% | [phase-02](./phase-02-interaction-and-responsive-tests.md) |
| 3 | Validation, side effects, handoff | Complete | 1h | 100% | [phase-03](./phase-03-validation-side-effects-and-handoff.md) |

## Dependencies

- Existing `@radix-ui/react-select`, shared `Select` wrapper, Tailwind safe-area variables, Vitest browser/Playwright provider.
- Preserve unrelated dirty worktree changes; implementation should touch only files named by phases.

## Success Criteria

- Compact navigation consumes only a small floating trigger footprint; normal companion header removed, toolbar variant materially shorter than 52 px.
- Desktop rendering and surface lifecycle behavior unchanged; no new package, API, storage key, or architecture contract.
- Required tests and quality gates pass with browser evidence at all requested widths.

## Completion Evidence

- Targeted unit validation: `pnpm --filter @dam-hopper/ui exec vitest run src/components/templates/MobileWorkspaceShell.test.tsx src/components/pages/WorkspacePage.test.tsx src/hooks/compact-workspace-media-query.test.ts` — 3 files, 21 tests passed.
- Targeted browser validation: `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/mobile-workspace-shell.browser.tsx browser-tests/workspace-page-notification-navigation.browser.tsx` — 2 files, 7 tests passed.
- Short-height fix recorded: terminal trigger bottom offset uses `max(safe-area-bottom, min(25rem, 100dvh - top-nav-height - 3.5rem))` to avoid accessory/control overlap on short viewports.
- Not claimed: full-repository checks, visual snapshots, or accessibility snapshots.

## Unresolved Questions

- Confirmed assumption pending implementation: “panel” means all compact workspace surfaces, not only terminal Git/Ports/Fleet panels.
