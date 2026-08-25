# Phase 02 — Persisted configurable Project panel shortcut

## Context links

- [Shortcut scout](../reports/scout-260824-0112-shortcut-system.md)
- `packages/ui/src/lib/shortcuts.ts`
- `packages/ui/src/lib/ui-config.ts`
- `packages/ui/src/api/client.ts`
- `packages/ui/src/stores/settings.ts`
- `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.tsx`
- `server/src/config/schema.rs`

## Overview

- Priority: P1
- Status: done (2026-08-24 02:53 Asia/Bangkok)
- Goal: add the user-configurable Project panel shortcut with a Windows/Linux display default of Ctrl+Shift+Z.

## Key insights

- Existing shortcut settings use canonical `Mod` strings, server-side camelCase JSON, and Rust snake_case aliases/defaults.
- `addKeyboardShortcutListener(window, ...)` is already used for Git, Ports, and Fleet and captures panel shortcuts before terminal input.
- IDE panel activation already supports nonce-based imperative requests; Project needs a right-top mapping to `project-info`.

## Requirements

- New setting name: `projectPanelShortcut`.
- Default canonical value: `Mod+Shift+KeyZ`; display through `displayShortcut` as `Ctrl+Shift+Z` on Windows/Linux.
- Persist through `/api/global-config/ui` using existing optimistic/debounced settings behavior.
- Existing configs without the field hydrate to the default; existing custom values remain normalized.
- Terminal desktop shortcut toggles the floating Project panel; IDE desktop shortcut toggles the existing Project right tool.
- Compact/mobile shortcut path remains a no-op for the desktop panel.
- Settings page exposes capture, display, reset, and persistence using existing `ShortcutCapture`.

## Architecture

The new field follows the existing `UiConfig` path end-to-end:

`shortcuts.ts` default → `ui-config.ts` defaults/format → `api/client.ts`
wire type → `settings.ts` hydration/persistence → Settings row →
`WorkspacePage` listener. Rust `UiConfig` supplies a serde default and serializes
the camelCase field. `WorkspacePage` routes `project` to Terminal request or
IDE `project-info`; no new global shortcut registry is introduced.

## Related code files

Modify:

- `packages/ui/src/lib/shortcuts.ts`
- `packages/ui/src/lib/ui-config.ts`
- `packages/ui/src/api/client.ts`
- `packages/ui/src/stores/settings.ts`
- `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.tsx`
- `packages/ui/src/components/pages/WorkspacePage.tsx`
- `packages/ui/src/lib/ide-shell-layout.ts`
- `packages/ui/src/lib/reveal-active-file.ts`
- `server/src/config/schema.rs`
- `server/src/config/tests.rs`
- shortcut/settings/page test fixtures discovered by `rg`

Create/delete: none.

## Implementation steps

1. Add `DEFAULT_PROJECT_PANEL_SHORTCUT` and include it in canonical UI defaults.
2. Add `projectPanelShortcut` to client `UiConfig`, settings state/picker,
   initial defaults, hydrate, partial update, and persistence paths.
3. Add Rust `default_project_panel_shortcut`, serde field/alias, and
   `UiConfig::default` initialization; keep old TOML/JSON valid.
4. Add a Keyboard Shortcuts row labeled Project panel with reset behavior.
5. Read the setting in `WorkspacePage` and register a window shortcut listener
   that calls the existing panel activation callback.
6. Map IDE `project` requests to right tool id `project-info`; extend the pure
   resolver to close an already-active Project tool and preserve unrelated
   bottom-panel state.
7. Update settings/config/unit fixtures and assert canonical/default values.

## Todo list

- [x] Add canonical shortcut/default/config field in both languages.
- [x] Add settings UI and store persistence coverage.
- [x] Wire shortcut to Terminal and IDE desktop activation.
- [x] Verify Ctrl+Shift+Z works in the supported native host.

## Success criteria

- Fresh settings show and reset to Project panel / Ctrl+Shift+Z.
- Existing saved settings remain readable and custom shortcut values continue working.
- Pressing the configured shortcut toggles the correct Project surface in both desktop modes.

## Risk assessment

- `Ctrl+Shift+Z` can still be intercepted by browser or host shortcuts. Validate native/web delivery, but keep the configured value available for users to change.
- Missing one settings mock can cause type/build failures; use repository-wide search for all `UiConfig` and settings-store fixtures.
- Adding a required frontend type field without a Rust default would break older servers; serde defaulting is mandatory.

## Security considerations

Shortcut strings are user configuration only. Reuse existing validation, formatting,
and authenticated UI-config persistence; do not log key events or add secrets.

## Next steps

Run the config/settings/unit suite, then exercise the shortcut and panel flow in
the Chromium browser harness from Phase 03.
