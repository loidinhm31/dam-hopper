# Phase 03 — Active-Pane Shortcut and Reparenting Integration

## Context links

- Parent: [plan.md](./plan.md)
- Dependency: [phase-02](./phase-02-find-bar-and-terminal-panel-lifecycle.md)
- Active handler: `packages/ui/src/components/organisms/PaneContainer.tsx`
- Shared handler: `packages/ui/src/lib/terminal-keyboard-shortcuts.ts`
- Reparenting: `packages/ui/src/lib/terminal-host-attachment.ts`
- Tests: `packages/ui/src/lib/terminal-keyboard-shortcuts.test.ts`, `terminal-host-attachment.test.ts`

## Overview

- Date: 2026-07-15
- Priority: P2
- Status: Completed 2026-07-15
- Review status: Approved (8/10)
- Description: Make Ctrl/Cmd+F win at the active terminal key boundary, suppress browser Find, and preserve active-only behavior during pane/tab reparenting.
- Estimate: 2h

## Key Insights

- `PaneContainer` installs a later custom handler and therefore is the authoritative path for split-pane terminals.
- `TerminalPanel` still needs a base handler callback for contexts where no pane handler is installed.
- Returning `false` prevents xterm input but does not reliably suppress the browser's native Find; call `preventDefault()` for Ctrl/Cmd+F.
- `attachTerminalsToHost` knows which session is active and is the least surprising place to close a bar for terminals becoming inactive.

## Requirements

- Recognize only `Ctrl+F` or `Meta+F` without Alt/Shift; keep existing `Ctrl/Cmd+Shift+F` app search untouched.
- Call `event.preventDefault()` and return `false` before xterm can forward the shortcut.
- Invoke the controller for the active session only.
- Do not add a document-global `keydown` listener that could open hidden/inactive sessions.
- Ensure input/button keys in the bar do not reach `term.onData`.
- Close/clear search state when a terminal becomes inactive or is moved out of the active host; reactivation starts clean.
- Reparenting must not reconstruct the addon/controller or lose the retained buffer.
- Preserve existing copy, workspace, new-terminal, pane navigation, and tab shortcuts.

## Architecture

```text
keydown in active xterm
  → PaneContainer custom handler
  → handleSharedTerminalKeyEvent(... onFind)
  → preventDefault + return false
  → active session controller.open()
  → portal input focus

inactive-session attachment
  → controller.close()
  → clear decorations/query
  → keep TerminalPanel mounted and hidden
```

Use the same `onFind` callback in both `TerminalPanel` and `PaneContainer`. Resolve the controller by the handler's active session, not by a mutable global “last active” value. Keep the existing pane focus behavior intact.

## Related code files

Modify:

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-keyboard-shortcuts.ts` — callback, exact shortcut matching, default suppression.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalPanel.tsx` — base handler `onFind` callback if needed.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/PaneContainer.tsx` — active controller callback and handler wiring.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-host-attachment.ts` — close inactive controller only if controller lifecycle cannot be handled in `PaneContainer`.

Tests:

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-keyboard-shortcuts.test.ts` — Ctrl/Cmd+F, modifiers, `preventDefault`, precedence.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-host-attachment.test.ts` — inactive cleanup if attachment owns it.

Delete: none.

## Implementation Steps

1. Add `onFind` to shared terminal key options.
2. Match `KeyF`/`f` with exactly Ctrl or Meta and no Alt/Shift; handle keydown only.
3. Prevent default and return `false` when matched; leave unrelated shortcuts unchanged.
4. Wire `PaneContainer` to the active registry entry's controller.
5. Wire the base `TerminalPanel` handler to the same controller for fallback contexts.
6. Decide one owner for inactive close (prefer active attachment transition); implement idempotent close.
7. Add tests for two sessions/panes proving inactive sessions cannot open or retain an active bar.
8. Manually verify pane split, tab switch, docking, and workspace mode changes do not remount terminals.

## Todo list

- [x] Add exact Ctrl/Cmd+F match.
- [x] Suppress browser default and xterm input.
- [x] Route only active session.
- [x] Preserve `Mod+Shift+F` file search.
- [x] Close on deactivation.
- [x] Test shortcut and session isolation.
- [x] Test reparenting/focus behavior.

## Completion Notes

Completed: 2026-07-15

- Focused shortcut and attachment tests: 17/17 passed.
- Full UI suite: 443/443 tests passed.
- UI and web builds, scoped lint, and `git diff --check` passed.
- Phase 03 review approved after cleanup and detached-reparenting fixes.

## Success Criteria

- Ctrl/Cmd+F opens the visible active bar and browser Find does not appear.
- `onData` receives none of the shortcut, query, navigation, or close events.
- Inactive and hidden terminals do not respond.
- Existing shortcut tests remain green.
- Switching tabs/panes/docking preserves terminal instances and resets inactive search state.

## Risk Assessment

- Risk: PaneContainer overwrites TerminalPanel's handler. Mitigation: wire both and test split layouts.
- Risk: Ctrl+Shift+F regression. Mitigation: exact modifier test and existing app-search manual check.
- Risk: close on reparent fires during transient layout updates. Mitigation: close is idempotent, applies only when a terminal is inactive or attached to a different host, and never disposes the controller during reparent.

## Security Considerations

- Preventing browser Find avoids accidental search of the broader page when the user intends terminal-local search.
- No search query or terminal text enters PTY input, logs, URL state, localStorage, or network payloads.

## Next steps

Build deterministic unit coverage and the smallest real-browser fixture in Phase 04.
