# Phase 02 — Bound WebGL to visible terminal panes

## Context links

- Parent: [plan](./plan.md)
- Research: [renderer](./research/researcher-01-terminal-renderer.md)

## Parallelization info

Independent. May run with Phases 01 and 03. Phase 04 waits for it.

## Overview

- Priority: P1
- Status: Pending
- Review: Pending
- Goal: stop hidden keep-alive terminals from consuming WebGL contexts.

## Key insights

Terminal panels are intentionally kept mounted and reparented. Browser context loss is therefore a policy problem, not an unmount-cleanup leak. A probe canvas compounds the context count.

## Requirements

- WebGL only for sessions active in visible split panes.
- Retained/inactive sessions use DOM rendering.
- Renderer changes safely dispose/add addons across pane or tab changes.
- Addon construction is the capability check; do not create a separate probe canvas.
- Context-loss fallback remains safe and diagnostic.

## Architecture

`MultiTerminalDisplay` derives visible active session IDs from the layout panes, passes them to `TerminalKeepAliveHost`, and each panel receives an enable flag. `TerminalPanel` owns a renderer-handle lifecycle separate from terminal creation; the handle disposes on disable/unmount. `terminal-renderer` remains the sole addon factory/fallback boundary.

## Related code files

- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MultiTerminalDisplay.tsx`
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx`
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalPanel.tsx`
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-renderer.ts`
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-renderer.test.ts`
- Create: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalKeepAliveHost.test.tsx`

## File ownership

Exclusive to this phase: all six related files above.

## Implementation steps

1. Derive active session IDs for all visible panes, not only the global selected terminal.
2. Pass membership as a `webglEnabled` prop through host to panel.
3. Refactor panel renderer attachment into an enable/disable lifecycle without recreating the xterm terminal.
4. Remove the `getContext("webgl2")` probe; retain try/catch addon fallback.
5. Test disabled, enabled, context loss, disable disposal, re-enable, and multiple kept-alive sessions with only visible IDs enabled.

## Todo list

- [ ] Wire visible-pane renderer policy.
- [ ] Make renderer handle transitions safe.
- [ ] Remove probe context.
- [ ] Add deterministic renderer/host tests.

## Success criteria

- One WebGL addon per visible active pane at most.
- Hidden retained terminals use DOM; changing visibility releases prior contexts.
- Existing terminal attach/reparent and context-loss tests pass.

## Conflict prevention

Do not change branch or context-menu files owned by Phases 01/03.

## Risk assessment

Medium. Incorrect lifecycle wiring can leave a visible terminal in DOM mode or double-dispose an addon. Test each transition explicitly.

## Security considerations

Renderer selection stays client-only; PTY protocol and terminal output are unchanged.

## Next steps

Phase 04 browser smoke must exercise enough tabs/panes to expose previous exhaustion.
