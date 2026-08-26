# Phase 03 — Browser, unit, and compatibility validation

## Context links

- [Validation scout](../reports/scout-260824-0112-tests-docs.md)
- `packages/ui/src/components/pages/WorkspacePage.test.tsx`
- `packages/ui/src/components/templates/TerminalWorkspaceShell.test.tsx`
- `packages/ui/browser-tests/terminal-floating-panels.browser.tsx`
- `packages/ui/browser-tests/project-worktree-target.browser.tsx`
- `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.test.tsx`
- `packages/ui/src/lib/ui-config.test.ts`
- `server/src/config/tests.rs`

## Overview

- Priority: P1
- Status: pending
- Goal: prove visible Terminal panel behavior, target selection, keyboard activation, and backward-compatible config hydration.

## Key insights

- The browser suite already has real Chromium coverage for floating overlays and real Project worktree propagation.
- SSR page tests are the fastest way to assert shell props/content and target identity without mounting the full shell.
- Existing full browser validation has a known unrelated image-preview flake; report it separately if reproduced.

## Requirements

- Unit: Project activation toggles on/off; switching Project replaces other Terminal tools; IDE Project maps to `project-info`.
- Unit: default `Mod+Shift+KeyZ`, display formatting, UI config hydration, settings persistence, and Rust serde default.
- Browser: Project floating panel opens from toolbar/request, contains Project content, closes by Escape/X, activates above Files on overlap, and remains draggable/resizable through the existing generic behavior.
- Browser: Terminal Project content can open Worktrees, select a registered feature worktree, and preserve the target propagation already covered by the existing worktree scenario.
- Browser/SSR: compact mode still exposes the existing Project surface and does not render the desktop floating overlay.

## Architecture

Use the narrowest release gate for each risk:

1. Pure resolver/config tests for state and compatibility.
2. Existing Chromium floating-panel harness for real click/focus/Escape/z-index behavior.
3. Existing Project target browser fixture for real selector and target propagation.
4. UI build/lint and Rust config tests for cross-language contract integrity.

Prefer role/test-id locators and web-first assertions. Avoid arbitrary sleeps;
reuse existing fixture resets and localStorage cleanup.

## Related code files

Modify tests:

- `packages/ui/src/lib/ide-shell-layout.test.ts`
- `packages/ui/src/lib/ui-config.test.ts`
- `packages/ui/src/stores/settings.test.ts`
- `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.test.tsx`
- `packages/ui/src/components/templates/TerminalWorkspaceShell.test.tsx`
- `packages/ui/src/components/pages/WorkspacePage.test.tsx`
- `packages/ui/browser-tests/terminal-floating-panels.browser.tsx`
- `packages/ui/browser-tests/project-worktree-target.browser.tsx` as needed
- `server/src/config/tests.rs`

Create/delete: none.

## Implementation steps

1. Extend pure activation tests with Project target open/close and IDE mapping.
2. Extend UI config/settings tests and every fixture object required by the new field.
3. Add `projectContent` to the floating-panel browser harness and assert Project title/content, Escape, close, and stacking.
4. Add or extend the real Project target browser scenario in Terminal mode; assert Worktrees disclosure and feature radio selection.
5. Run focused unit tests, UI build, lint, Rust config tests, and the browser suite.
6. If the full browser suite fails on the known image-preview fixture, isolate/re-run it and report it as pre-existing or unrelated rather than masking it.

## Todo list

- [ ] Cover pure Terminal/IDE Project activation.
- [ ] Cover default, formatting, hydration, persistence, and serde compatibility.
- [ ] Cover real Chromium panel/keyboard/focus/selection behavior.
- [ ] Record exact commands, artifacts, failures, and remaining browser risk.

## Success criteria

- Focused unit and browser tests pass with no new warnings.
- `pnpm --filter @dam-hopper/ui build` and `pnpm lint` pass.
- Rust config tests pass; no API/database migration is required.
- Browser report names whether Ctrl+Shift+Z was delivered by the selected host.

## Risk assessment

- Browser-reserved shortcut behavior can make a passing DOM test insufficient; include a real `page.keyboard.press` check where Chromium delivers the event and state the limitation if it does not.
- Floating layout dimensions may be below Project content minimums; assert scrollability rather than forcing a new layout system.

## Security considerations

No new security boundary. Confirm worktree selection still travels through the
existing target store/API path and unavailable rows remain disabled/recoverable.

## Next steps

After validation, hand the plan to `/code` for implementation and quality gates;
do not claim release readiness from unit tests alone.
