---
title: "Stabilize Radix context menus in Explorer and Git branch Select"
description: "Restore reliable Radix context-menu triggers for virtual tree rows and local branch options."
status: pending
priority: P1
effort: 4.5h
branch: main
tags: [bugfix, refactor, frontend, accessibility]
created: 2026-07-18
updated: 2026-07-18 11:08:06 +0700
---

# Stabilize Radix context menus

## Overview

Repair the two consumers that regress under virtual-row and Select-dismissal lifecycles while keeping the shared Radix Context Menu foundation as the only menu system.

## Phases

| # | Phase | Status | Effort | Link |
| --- | --- | --- | ---: | --- |
| 1 | Stabilize Explorer tree trigger ownership | Done (2026-07-18 10:25:14 +0700) | 1.5h | [phase-01](./phase-01-stabilize-explorer-tree-trigger.md) |
| 2 | Harden Git branch Select handoff | Done (2026-07-18 11:08:06 +0700) | 1h | [phase-02](./phase-02-harden-git-branch-select-handoff.md) |
| 3 | Add consumer integration and browser regression coverage | Done (2026-07-18 13:43:29 +0700) | 2h | [phase-03](./phase-03-add-consumer-integration-browser-coverage.md) |

## Design invariant

All consumers use the shared `ContextMenu` Root/Trigger/Portal/Content wrappers. Explorer uses a direct `asChild` trigger on a stable row. Git branch keeps a lifted controlled Root because Radix Select owns and dismisses its option DOM.

## Dependencies

- Existing `@radix-ui/react-context-menu`, `@radix-ui/react-select`, `react-arborist`, Vitest, and browser test setup.
- [Agreed brainstorm](../reports/brainstorm-260718-0819-context-menu-radix-trigger-refactor.md)
- [Lifecycle research](./research/researcher-01-radix-lifecycle-and-test-surface.md)
- Existing architecture invariant: [docs/system-architecture.md](../../docs/system-architecture.md)

## Global acceptance

- Pointer and keyboard menus work for Explorer and local Git branches without native browser-menu leakage, clipping, or offset.
- Explorer actions affect the correct node; branch right-click never selects/checks out a branch.
- Branch menu opens once through Select dismissal; current branch remains undeletable.
- JSDOM consumer integration plus Chromium geometry/focus tests pass.
- Touch long-press stays manual best-effort only; headless Linux cannot verify the gesture.

## Out of scope

All other consumers, custom placement code, generic overlay/store abstractions, Select replacement, server/API work, and tree drag-policy changes.
