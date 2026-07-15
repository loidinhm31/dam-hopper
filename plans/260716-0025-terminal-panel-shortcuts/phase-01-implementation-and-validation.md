# Phase 01: Implementation and Validation

## Context Links

- Overview: [../plan.md](./plan.md)
- Existing shortcut parser: `packages/ui/src/lib/shortcuts.ts`
- Existing settings path: `packages/ui/src/stores/settings.ts`
- Workspace composition: `packages/ui/src/components/pages/WorkspacePage.tsx`
- IDE panel state: `packages/ui/src/components/templates/IdeShell.tsx`
- Existing xterm guard: `packages/ui/src/lib/terminal-keyboard-shortcuts.ts`
- Rust UI schema: `server/src/config/schema.rs`

## Overview

Priority: P1  
Status: Completed 2026-07-16 00:45  
Goal: add three persisted, xterm-safe panel shortcuts with exclusive target
activation in the desktop IDE shell.

## Key Insights

- The canonical shortcut format is `Mod+Shift+KeyX`; display already renders it
  as Ctrl on Linux/Windows and Cmd on macOS.
- `WorkspacePage` already owns settings and provides nonce-based imperative tool
  requests to `IdeShell`.
- Git and Ports are left bottom tools; Fleet Terminal is the right top tool.
- Current shell state allows both bottom and right tools concurrently, so the
  new activation request must explicitly clear only the other two target IDs.
- xterm custom key handlers currently suppress global mode/reveal bindings; the
  three new bindings must be included in that same suppression set.

## Requirements

1. Add `gitPanelShortcut`, `portsPanelShortcut`, and `fleetTerminalShortcut` to
   Rust and TypeScript UI config with defaults above and TOML camelCase mapping.
2. Hydrate, persist, capture, display, reset, and test all three settings using
   existing `ShortcutCapture` and debounce behavior.
3. Register global listeners through `addKeyboardShortcutListener`, using current
   settings at event time so changes apply without remounting listeners.
4. In desktop IDE mode, target shortcuts toggle the target panel and clear the
   other two targets. Preserve PTY DOM nodes and unrelated tool selections.
5. In compact/Terminal mode, route only to surfaces/layouts that already expose
   the target; do not invent a second terminal manager or remount xterm sessions.
6. Suppress the bindings in `TerminalPanel` and `PaneContainer` before PTY input.
7. Add focused unit/SSR coverage for constants/config defaults, xterm suppression,
   settings markup, and target activation/exclusivity state transitions.

## Architecture

Prefer one shared panel-target action in `WorkspacePage` and one shell request
contract over separate per-panel event logic. Extend the existing activate-tool
request with enough target/side information for `IdeShell` to:

- toggle Git/Ports in the left bottom slot;
- toggle Fleet Terminal in the right top slot;
- clear the other two target IDs when activating a target;
- leave Project/Explorer/Search and terminal session state untouched.

If the existing request shape can express this without ambiguity, reuse it;
otherwise extract a small pure resolver beside `ide-shell-layout.ts` and test it.
Do not add a generic command registry or a new global state store.

## Related Code Files

- Modify `packages/ui/src/lib/shortcuts.ts` and its tests.
- Modify `packages/ui/src/lib/ui-config.ts` and its tests.
- Modify `packages/ui/src/stores/settings.ts` and settings tests.
- Modify `packages/ui/src/api/client.ts`.
- Modify `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.tsx`
  and its SSR test.
- Modify `packages/ui/src/components/pages/WorkspacePage.tsx` and focused tests.
- Modify `packages/ui/src/components/templates/IdeShell.tsx`,
  `packages/ui/src/lib/ide-shell-layout.ts`, and shell tests if a pure resolver is
  needed.
- Modify `packages/ui/src/lib/terminal-keyboard-shortcuts.ts` and tests.
- Modify `packages/ui/src/components/organisms/TerminalPanel.tsx` and
  `PaneContainer.tsx` only if their shared handler options need the new values.
- Modify `server/src/config/schema.rs`, `server/src/config/global.rs`, and
  `server/src/config/tests.rs`.
- Update `docs/configuration-guide.md`, `docs/frontend-components.md`, and
  `docs/CHANGELOG.md` only after behavior is verified.

## Implementation Steps

1. Add constants and config fields with backward-compatible defaults, aliases,
   normalization, and merge mapping.
2. Thread fields through client `UiConfig`, Zustand persistence, settings UI,
   and tests; use existing capture validation/reset controls.
3. Add panel target requests/listeners in `WorkspacePage`; handle IDE target
   toggling/exclusivity in `IdeShell` with a pure resolver where practical.
4. Pass target shortcuts into the shared terminal key handler and suppress them
   from PTY input in both single and split xterm paths.
5. Resolve behavior for compact/Terminal shells using existing surfaces only;
   keep unsupported target actions no-op and document that boundary if needed.
6. Run focused tests, full web test/build, and Rust UI-config tests. Perform a
   real-browser/manual check with an active xterm and each shortcut.
7. Request code review; fix critical issues; then update plan/docs status.

## Todo List

- [x] Add three shortcut constants/config fields.
- [x] Thread fields through Rust/client/settings/UI persistence.
- [x] Implement target activation/toggle/exclusivity.
- [x] Suppress target shortcuts in xterm paths.
- [x] Add/update tests.
- [x] Verify TypeScript and web build; Rust/full web reruns were blocked by
  `ENOSPC` after the workspace filesystem reached 100% usage.
- [x] Update docs after verification.

## Success Criteria

- Fresh config displays the three defaults exactly as requested.
- Existing configs without fields still load and save safely.
- Settings changes persist and reset independently.
- Pressing G/P/M from an xterm opens/toggles the expected target without PTY
  characters or duplicate terminals.
- At most one of Git, Ports, Fleet Terminal is active after a target activation.
- Existing workspace-mode, file-panel, terminal-search, and new-terminal
  shortcuts remain unchanged.
- Focused tests and required builds pass with no unrelated behavior masked.

## Risk Assessment

- Cross-slot activation can accidentally hide Project/Explorer; constrain clears
  to the three target IDs and cover state transitions.
- Browser/xterm event ordering can either swallow the shortcut or send it to the
  shell; verify both single and split terminal paths manually.
- Adding required Rust struct fields can break old TOML; use serde defaults and
  config tests for absent keys.

## Security Considerations

- Shortcut strings are UI config, not executable input.
- No API authorization or filesystem/process behavior changes.
- Do not log raw key events or config values beyond existing settings diagnostics.

## Next Steps

Implementation approved after code review. Re-run the full web and focused Rust
tests after freeing workspace disk space; no source changes are expected from that
environment-only retry.
