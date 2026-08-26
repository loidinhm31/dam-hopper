# Phase 01 — Implementation

## Context Links

- Parent: [plan.md](./plan.md)
- Docs: [system architecture](../../docs/system-architecture.md), [frontend components](../../docs/frontend-components.md)
- Components: [shell](../../packages/ui/src/components/templates/TerminalWorkspaceShell.tsx), [workspace](../../packages/ui/src/components/pages/WorkspacePage.tsx), [file panel](../../packages/ui/src/components/organisms/TerminalFloatingFilePanel.tsx), [tool panel](../../packages/ui/src/components/organisms/TerminalFloatingToolPanel.tsx)
- Dependency: Phase 02 validates this phase; no external/package dependency.

## Overview

- Date: 2026-08-07
- Priority: P2
- Description: add shared, shell-local front-panel state and activation wiring.
- Implementation status: completed 2026-08-07 19:58 +07:00
- Review status: focused validation complete; repository-wide check blocked by missing native release-signing setup

## Key Insights

- Shell is the narrow common owner: it already composes terminal content, Files overlay, and active tool overlay.
- Keep `null` as initial owner so both panels render at baseline; activation alone selects front.
- Use shared constants/resolver to avoid duplicated layer arithmetic.
- Pointer/focus capture on the inner panel sees descendants without making inert bounds interactive.

## Requirements

- Files and active Git/Ports/Fleet accept optional `zIndex` and `onActivate` presentation props.
- Pointer/touch anywhere inside and focus entering/within invoke activation.
- Programmatic editor focus activates through the same focus-capture path; reveal-only does not invent focus.
- Closing clears stale ownership; switching tool content preserves valid `tool` ownership.
- Keep all layers below BrowserDebug `30`; no persistence or global store.

## Architecture

```text
TerminalWorkspaceShell
  frontPanelId: null | files | tool
  ├─ render file overlay controls -> FilePanel root z(20|25)
  └─ pass tool controls          -> ToolPanel root z(20|25)

inner panel pointerdown/focus -> onActivate -> setFrontPanelId
panel closes/unmounts          -> clear matching owner
```

Data remains local React state. No server, query cache, Zustand, localStorage, geometry, or PTY flow changes.

## Related Code Files

- Modify `packages/ui/src/lib/terminal-workspace-panel.ts` — layer constants/type and pure resolver if useful for unit coverage.
- Modify `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx` — own front ID, render/wire both overlays, clear closed owner.
- Modify `packages/ui/src/components/pages/WorkspacePage.tsx` — adapt Files overlay composition to the shell-provided stacking controls/open signal.
- Modify `packages/ui/src/components/organisms/TerminalFloatingFilePanel.tsx` — root z-index plus inner pointer/focus capture.
- Modify `packages/ui/src/components/organisms/TerminalFloatingToolPanel.tsx` — same presentation contract.
- Modify `packages/ui/src/components/templates/TerminalWorkspaceShell.test.tsx` — resolver/state contract.
- Modify `packages/ui/src/components/pages/WorkspacePage.test.tsx` — composition contract and desktop/compact guard.
- Modify `packages/ui/src/components/organisms/TerminalFloatingFilePanel.test.tsx` — callback/layer regressions.
- Modify `packages/ui/src/components/organisms/TerminalFloatingToolPanel.test.tsx` — callback/layer regressions.
- Create/delete application files: none beyond the Phase 02 browser test.

## Implementation Steps

1. Add `BASE=20`, `FRONT=25`, panel ID type, and `resolve...ZIndex(front, panel)` in the existing terminal-workspace helper; return baseline when `front` is `null` or is the peer.
2. In `TerminalWorkspaceShell`, initialize `frontPanelId` to `null`. Expose file stacking controls through a typed render callback (plus explicit open state) and pass tool controls directly.
3. On file/tool activation set the matching ID. When Files closes or the active tool becomes `null`, clear only matching ownership. Keep `tool` ownership while Git/Ports/Fleet swaps.
4. Add optional `zIndex` (default baseline) and `onActivate` props to both organisms. Apply z-index to the absolute, pointer-inert bounds root.
5. Attach `onPointerDownCapture` and `onFocusCapture` to each pointer-active inner panel. Do not call `preventDefault`, `stopPropagation`, or change close/drag/resize handlers.
6. Adapt `WorkspacePage` desktop Terminal composition only. Preserve IDE and compact surface component trees.
7. Extend unit tests for initial/baseline resolution, active/peer resolution, descendant pointer/focus callbacks, close reset, tool switch retention, and unchanged ARIA/Escape behavior.

## Todo List

- [x] Add shared layer resolver/constants.
- [x] Wire shell-local front state and lifecycle cleanup.
- [x] Add organism presentation props/listeners.
- [x] Adapt Files composition in `WorkspacePage`.
- [x] Add/update focused unit tests.
- [x] Review diff for out-of-scope changes.

## Success Criteria

- Both open roots start at computed `20`; activation sets selected root to `25` and peer to `20`.
- Content descendants, not only headers, trigger pointer and keyboard-focus activation.
- Close/reopen returns a valid baseline; active tool swaps do not lose tool-front state.
- Escape, close buttons, drag/resize, tabs, editor focus signal, and inert bounds still work.

## Risk Assessment

- Duplicate click focus events: harmless idempotent state update; avoid counters/timestamps.
- Stale front ID after external close: explicit open-state cleanup in shell.
- Render-prop churn: type narrowly; memoize only if existing composition needs it.
- Tailwind class generation ambiguity: prefer numeric inline root z-index from fixed constants.

## Security Considerations

- No auth, data, storage, API, HTML injection, or trust-boundary change.
- Do not widen pointer-active overlay area; transparent bounds remain `pointer-events-none`.
- Fixed allowlisted numeric layers prevent user-controlled style injection.

## Preflight Contract

- In scope: composition state/callbacks, activation props/listeners, z-index, narrow unit tests.
- Out: drag/resize redesign, persistence, geometry, terminal focus semantics, server/API, IDE/mobile.
- Preserve public behavior: Escape, close propagation, tabs/ARIA, overlay hit bounds, global layer hierarchy.

## Side-Effect Review Checklist

- [ ] Close-button pointerdown may activate first, then close normally.
- [ ] Drag and resize still receive their existing mouse events.
- [ ] Focus capture does not move focus or alter tab order.
- [ ] File editor programmatic focus activates; reveal-only stays non-focusing.
- [ ] Tool ID switch retains geometry and top ownership.
- [ ] IDE and compact/mobile branches receive no stacking props/state.
- [ ] No new storage keys, store fields, network calls, logs, or dependencies.

## Next Steps

Proceed to [Phase 02](./phase-02-validation.md); do not declare completion before browser hit-testing passes.

## Unresolved Questions

Completed 2026-08-07 19:58 +07:00. Focused unit validation: 4 files, 41/41 tests passed.
