# Phase 03: Polish — Keyboard Shortcut + UX

> Parent: [plan.md](./plan.md)
> Dependencies: [Phase 02](./phase-02-frontend.md)
> Priority: P3 | Status: done | Review: complete

## Overview

Add keyboard shortcut for quick terminal creation and polish the UX for free terminals.

## Requirements

1. Keyboard shortcut (Ctrl+` or Ctrl+Shift+T) to create new free terminal
2. Auto-focus new terminal panel on creation
3. Empty workspace state: show free terminal option prominently when no projects configured
4. Dashboard integration: quick-launch free terminal from dashboard

## Related Code Files

| File | Purpose |
|------|---------|
| `packages/web/src/pages/TerminalsPage.tsx` | Keyboard event handler |
| `packages/web/src/pages/DashboardPage.tsx` | Dashboard quick actions |
| `packages/web/src/App.tsx` | Global keyboard shortcuts |

## Implementation Steps

### 1. Add keyboard shortcut
- Register `Ctrl+`` (backtick) globally in App.tsx or TerminalsPage
- On trigger: navigate to `/terminals` + create new free terminal
- Prevent default browser behavior for the shortcut

### 2. Auto-focus on creation
- After `handleAddFreeTerminal()`, auto-select the new session
- Open tab and focus the terminal panel
- xterm.js `terminal.focus()` called on mount

### 3. Empty workspace state
- When no projects in workspace, show prominent "Open Terminal" button
- Direct users to free terminals as primary action

### 4. Dashboard quick-launch
- Add "New Terminal" action card on dashboard
- Navigates to `/terminals` with free terminal creation

## Todo

- [x] Add global keyboard shortcut
- [x] Auto-focus new free terminal
- [x] Empty workspace UX
- [x] Dashboard quick-launch card

## Success Criteria

- Ctrl+` creates and focuses new free terminal
- New terminals auto-focus on creation
- Works smoothly from dashboard and terminals page

## Risk Assessment

- **Low**: Polish phase, no architectural changes
- Keyboard shortcut may conflict with OS/browser shortcuts — test on Linux/Windows

## Review Notes

All Phase 03 requirements completed successfully:

- **GlobalShortcuts component** (App.tsx): Ctrl+` registered globally, creates new free terminal and navigates to /terminals
- **TerminalPanel auto-focus**: Uses requestAnimationFrame + term.focus() on mount, cancelAnimationFrame in cleanup to prevent race conditions
- **PTY forwarding safeguard**: Ctrl+` properly blocked from being forwarded to PTY (preventDefault in shortcut handler)
- **Empty workspace UX** (TerminalsPage.tsx): Shows keyboard hint when workspace has no projects, encourages free terminal creation
- **Dashboard quick-launch** (DashboardPage.tsx): "New Terminal" action card with keyboard hint (Ctrl+`), navigates to /terminals?action=new-terminal

Tested and verified on Linux. Implementation is clean, performant, and user-friendly.
