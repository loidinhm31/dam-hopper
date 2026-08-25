---
title: "Terminal Floating Panel Z-Order"
description: "Make the interacted desktop Terminal floating panel own the top panel layer."
status: completed
priority: P2
effort: 5h
branch: main
tags: [feature, frontend, testing]
created: 2026-08-07
---

# Terminal Floating Panel Z-Order

## Context Links

- [System architecture](../../docs/system-architecture.md)
- [Frontend components](../../docs/frontend-components.md)
- [Terminal shell](../../packages/ui/src/components/templates/TerminalWorkspaceShell.tsx)
- [Workspace composition](../../packages/ui/src/components/pages/WorkspacePage.tsx)

## Overview / Status

Desktop Terminal mode has two independently floating windows, but both use `z-20`; DOM order makes the tool panel win. Add shell-local, interaction-aware stacking. Status: completed 2026-08-07 19:58 +07:00; no architecture-doc update needed because this changes only ephemeral presentation state and preserves documented shell/overlay boundaries.

## Key Insights

- Recommended: `TerminalWorkspaceShell` owns `frontPanelId`; explicit callbacks keep state local and reset on shell lifecycle.
- Baseline `20`, front `25`; BrowserDebug `30` and suggestion/dialog layers `50` stay above.
- Listen on each pointer-active inner panel with `onPointerDownCapture` and `onFocusCapture`; keep full-screen bounds pointer-inert.
- Reject DOM reordering/portals (state disruption) and a global store (ephemeral-state coupling).

## Requirements / Scope

- Cover Files plus active Git/Ports/Fleet panel in desktop Terminal mode.
- Any pointer/touch interaction or keyboard focus inside a panel activates it.
- Preserve drag, resize, Escape, close, tabs/ARIA, geometry, and active-tool switching.
- No IDE/mobile, terminal-focus, persistence, API/server, or design-system changes.

## Architecture / Data Flow

`panel pointerdown/focus -> onActivate(id) -> shell frontPanelId -> resolver returns 25 for id, 20 for peer -> overlay-root z-index`. Close clears that panel's ownership; tool-content switches retain `tool` ownership; shell unmount resets all state.

## Phases

| # | Phase | Status | Effort | Detail |
|---|---|---|---|---|
| 1 | Implementation | Completed 2026-08-07 19:58 +07:00 | 3h | [phase-01](./phase-01-implementation.md) |
| 2 | Validation | Completed 2026-08-07 19:58 +07:00 | 2h | [phase-02](./phase-02-validation.md) |

## Preflight Contract

- Output: shared focus/interaction-aware stacking with focused panel on top and regression proof.
- Acceptance: baseline render; pointer/content/focus activation; tool switch and reopen safety; desktop-only; global layers remain higher.
- Public contract: local React props/state only; no storage, transport, auth, or data changes.

## Success Criteria

- Focus/interaction deterministically changes real browser hit order.
- Existing panel behavior and non-Terminal layouts remain unchanged.
- Focused unit/browser tests and package/repository checks pass.

## Risks / Side Effects

- Event capture must observe without preventing propagation or default behavior.
- Apply z-index to overlay roots, not content descendants, to avoid nested stacking surprises.
- Clear stale ownership on close; do not reset it when Git/Ports/Fleet content switches.

## Next Steps

1. Implementation and focused validation complete.
2. Resolve the environment release-signing blocker before treating the repository-wide `pnpm check` gate as green.

## Unresolved Questions

Known blocker: `pnpm check` fails during native bundling because native release-signing setup is not configured; focused feature gates pass.
