---
title: "Standardize context-menu placement in floating panels"
description: "Replace fragile inline fixed menus with one measured body-portal surface and verify pointer-relative placement across all custom menus."
status: done
priority: P2
effort: 13h
branch: main
tags: [frontend, bugfix, refactor, accessibility]
created: 2026-07-17
---

# Standardize context-menu placement in floating panels

## Overview

Fix the deterministic `backdrop-filter` containing-block bug that adds floating-panel offsets to viewport `clientX/clientY` coordinates. Consolidate seven custom menus behind one body-portaled, fixed, measured, collision-aware surface with baseline keyboard/ARIA behavior.

## Phases

| #   | Phase                                           | Status  | Effort | Link                                                        |
| --- | ----------------------------------------------- | ------- | -----: | ----------------------------------------------------------- |
| 1   | Radix context-menu foundation                   | Done    |   3.5h | [phase-01](./phase-01-shared-context-menu-surface.md)       |
| 2   | Migrate all menu consumers                      | Done    |   3.5h | [phase-02](./phase-02-migrate-context-menu-consumers.md)    |
| 3   | Unit and component verification                 | Done    |   2.5h | [phase-03](./phase-03-unit-component-tests.md)              |
| 4   | Chromium geometry regression and release checks | Pending |   3.5h | [phase-04](./phase-04-browser-regression-and-validation.md) |

## Dependencies

- React/ReactDOM 19, Vitest, and Playwright already exist in `packages/ui`.
- Validation selected Radix Context Menu; add it as a direct dependency after the trigger-compatibility spike. The revised phases make Radix primary and retain the dependency-free surface only as fallback.
- Architecture invariant recorded in `docs/system-architecture.md`.
- Source inventory and rationale: [brainstorm report](../reports/brainstorm-260717-1133-context-menu-placement.md), [positioning research](./research/researcher-01-positioning-options.md), [React/test research](./research/researcher-02-react-geometry-tests.md).

## Global acceptance

- All seven menus open within 4–8 CSS px of the pointer when space permits.
- Menus flip/shift and remain at least 8px inside the visual viewport at edges and small viewports.
- No menu is offset or clipped by floating-panel drag, resize, `backdrop-filter`, `overflow-hidden`, or scroll.
- Keyboard invocation, focus, Escape, outside click, and action behavior remain correct.
- Unit, component, and Chromium browser tests pass.

## Out of scope

Visual redesign, server/API changes, generic dropdown replacement, submenus/typeahead, and a new deterministic mobile long-press gesture.

## Validation Summary

**Validated:** 2026-07-17
**Questions asked:** 4

### Confirmed decisions

- Coverage: migrate all seven custom context menus.
- Interaction: include baseline keyboard/ARIA/focus behavior with placement.
- Dependency direction: adopt Radix Context Menu if the compatibility spike succeeds; Floating UI alone is not the selected path.

### Action items before implementation

- [x] Revise Phase 01–03 from the custom surface to a direct `@radix-ui/react-context-menu` integration; retain the custom surface as the explicit fallback.
- [x] Add a short feasibility spike for react-arborist tree triggers, editor tabs, Changed Files checkbox rows, Radix Select branch actions, and lifted terminal diagnostics.
- [x] Update package/lockfile touchpoints and re-estimate effort in the phase files; implementation still waits for the compatibility spike.
- [ ] Preserve the existing scroll-close decision and browser geometry acceptance matrix.

### Evidence

- [Radix Context Menu API](https://www.radix-ui.com/primitives/docs/components/context-menu) documents Portal, collision handling, focus management, keyboard navigation, layering, and long-press support.
- [Floating UI computePosition](https://floating-ui.com/docs/computeposition) documents the fixed strategy plus `flip`/`shift`, but would still leave menu semantics and focus behavior in repository code.
