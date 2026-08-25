---
title: "Global Native Context Menu Suppression"
description: "Prevent the browser context menu throughout DamHopper while preserving configured Radix menus."
status: completed
priority: P2
effort: 2h
branch: main
tags: [feature, frontend, accessibility]
created: 2026-07-18
---

# Global Native Context Menu Suppression

## Overview

Suppress the native browser context menu document-wide. A right-click with no
DamHopper menu must do nothing; a configured Radix menu must still receive the
event and open normally.

## Preflight Contract

- **Output:** a mount-scoped React hook, installed by `DamHopperApp`, tests, and
  one architecture invariant update.
- **Acceptance:** every cancelable document `contextmenu` event is
  `defaultPrevented`; no propagation is stopped; listener cleanup restores native
  behavior; Radix triggers still open; Chromium covers both paths.
- **In scope:** shared UI runtime only, capture listener, tests, minimal docs.
- **Out of scope/non-goals:** custom fallback UI, changes to menu consumers or
  Radix wrapper, iframe support, browser/OS policy bypass, server changes.
- **Risk/public contracts:** browser interaction only. No API, auth, data,
  config, persistence, or protocol change.
- **Affected systems:** UI hooks, embedded root, JSDOM/Chromium context-menu
  coverage, [system architecture](../../docs/system-architecture.md).
- **Testing:** UI unit suite, UI build, Chromium browser suite; manually confirm
  one unconfigured region and one configured action menu if desktop validation is available.
- **Open questions:** none.

## Design Decision

Use one `document` capture-phase listener. It calls `event.preventDefault()` for
targets outside a marker added by an enabled shared `ContextMenu.Trigger`, then
removes itself on hook cleanup. Marked triggers are left to Radix, which both
suppresses the default and opens the app menu. Disabled triggers stay unmarked
so the global listener suppresses them. This avoids Radix's intentional
already-prevented cancellation behavior while capture still suppresses bare
targets even when they stop bubbling. A body-level `onContextMenu`,
`stopPropagation`, a per-consumer guard, and a global CSS rule are rejected:
each either misses descendants, breaks Radix, duplicates behavior, or does not
suppress the browser menu reliably.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---:|---|
| 1 | Global listener, tests, and invariant | Completed | 2h | [phase-01](./phase-01-global-native-context-menu-suppression.md) |

## Completion Evidence

- Added document-capture suppression at the app root. The final design marks
  only enabled `ContextMenu.Trigger` elements and skips those event paths, so
  Radix can open configured menus; disabled and unconfigured targets are
  suppressed with no app menu.
- Validation passed: `pnpm --filter @dam-hopper/ui test` (109 files, 579
  tests), `pnpm --filter @dam-hopper/ui build`, and
  `pnpm --filter @dam-hopper/ui test:browser` (8 files, 28 tests).
- Code review: 10/10, no Critical findings or warnings; user approved.

## Dependencies

- Existing React effect convention: [use-browser-shortcut-guard.ts](../../packages/ui/src/hooks/use-browser-shortcut-guard.ts).
- Existing Radix wrapper and browser harness: [ContextMenu.tsx](../../packages/ui/src/components/ui/ContextMenu.tsx), [consumer-context-menu.browser.tsx](../../packages/ui/browser-tests/consumer-context-menu.browser.tsx).

## Unresolved Questions

None.
