# Phase 02: Configurable Mode Shortcut

## Context Links

- Overview: [./plan.md](./plan.md)
- Phase 01: [./phase-01-workspace-mode-shell.md](./phase-01-workspace-mode-shell.md)
- Shortcut library: `/mnt/data/ws/sharing/dam-hopper/packages/web/src/lib/shortcuts.ts`

## Overview

Priority: P1  
Status: Pending  
Goal: add a configurable shortcut for switching IDE/Terminal workspace modes, defaulting to `Mod+Shift+Backquote`.

## Key Insights

- Search shortcuts are already persisted through global UI config.
- `App.tsx` currently hardcodes `Ctrl+Backquote` for opening a new free terminal.
- `TerminalPanel` and `PaneContainer` suppress `Ctrl+Backquote` so xterm does not consume it.
- The new shortcut must not conflict with new terminal behavior.

## Requirements

- Add `terminalWorkspaceShortcut` to backend and frontend UI config.
- Default: `Mod+Shift+Backquote`.
- Add setting row under Keyboard Shortcuts.
- Use existing shortcut parser/formatter/validator.
- Register shortcut in `WorkspacePage` or a focused hook.
- Make `Ctrl+Backquote` exact: only `ctrlKey && !shiftKey && !altKey && !metaKey && code === "Backquote"`.
- Suppress the terminal workspace shortcut in xterm custom handlers so global capture can handle it.

## Architecture

Config path:

- Rust `UiConfig` stores `terminal_workspace_shortcut` with camelCase JSON support.
- TS `UiConfig` exposes `terminalWorkspaceShortcut`.
- `withUiConfigDefaults()` normalizes it through `formatShortcut`.
- `useSettingsStore` hydrates and saves it.
- `SettingsKeyboardShortcutsSection` reuses `ShortcutCapture`.

Shortcut handling:

- Prefer `useDocumentKeyboardShortcut(terminalWorkspaceShortcut, toggleWorkspaceMode)` if it works when xterm is focused.
- If xterm prevents document bubble handling, use existing capture helper `addKeyboardShortcutListener(window, getShortcut, handler)` in `WorkspacePage`.
- Keep terminal input preservation explicit in `TerminalPanel` and `PaneContainer`.

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/config/schema.rs`: add config field/default.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/config/tests.rs`: add default/roundtrip/alias assertions.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/api/client.ts`: add TS field.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/lib/ui-config.ts`: add default and normalization.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/stores/settings.ts`: hydrate/save field.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/SettingsKeyboardShortcutsSection.tsx`: add setting row.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/App.tsx`: exact-match `Ctrl+Backquote`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/TerminalPanel.tsx`: suppress new shortcut from terminal input.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/PaneContainer.tsx`: suppress new shortcut from terminal input.

## Implementation Steps

1. Add `DEFAULT_TERMINAL_WORKSPACE_SHORTCUT = "Mod+Shift+Backquote"` in `shortcuts.ts`.
2. Add Rust default function and `UiConfig` field:
   - `terminal_workspace_shortcut: String`
   - serde alias `terminal_workspace_shortcut`.
3. Update Rust default and config tests.
4. Update TS `UiConfig` and `DEFAULT_UI_CONFIG`.
5. Update `withUiConfigDefaults()` to format the shortcut.
6. Update settings store types, defaults, hydrate, set, and saveDebounced.
7. Add "Terminal workspace" row in keyboard shortcuts settings.
8. Register shortcut to toggle mode.
9. Update exact handling for `Ctrl+Backquote`.
10. Add tests:
   - `ui-config.test.ts` default and normalization.
   - `shortcuts.test.ts` parses/displays `Mod+Shift+Backquote`.

## Todo List

- [ ] Add config schema field.
- [ ] Add frontend default/hydration/save plumbing.
- [ ] Add settings UI row.
- [ ] Register shortcut.
- [ ] Fix shortcut conflict with new-terminal shortcut.
- [ ] Add tests.

## Success Criteria

- User can change shortcut in settings.
- Shortcut switches mode while editor or terminal has focus.
- `Ctrl+Backquote` still opens new free terminal.
- `Ctrl+Shift+Backquote` no longer opens a new free terminal.

## Risk Assessment

- Existing shortcut capture may not fire from xterm. Mitigation: use capture-phase listener if needed.
- Config compatibility risk. Mitigation: default field and serde aliases preserve old configs.

## Security Considerations

- UI config is not privileged.
- Validate shortcut strings client-side; backend stores as config only.

## Next Steps

Phase 03 builds the full terminal workspace layout using the mode state and shortcut.
