# Local scout: configurable Project panel shortcut

## Findings

- `packages/ui/src/lib/shortcuts.ts:1-11` centralizes defaults. Existing
  cross-platform shortcuts use `Mod`; `Mod+Shift+KeyB` displays as
  `Ctrl+Shift+B` on Windows/Linux and `Cmd+Shift+B` on macOS.
- `packages/ui/src/lib/ui-config.ts:14-22,40-55,118-159` supplies defaults and
  canonicalizes persisted shortcut strings.
- `packages/ui/src/api/client.ts:836-866` mirrors the Rust `UiConfig` wire
  shape. A new persisted shortcut must be added here.
- `packages/ui/src/stores/settings.ts:70-310` owns the hydrated settings state,
  optimistic persistence, rollback, and partial updates. The new field must be
  included in its state, picker, defaults, hydrate, and clamp/update paths.
- `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.tsx`
  already renders configurable rows for File, Git, Ports, and Fleet panels; add
  one Project panel row using the same `ShortcutCapture`.
- `packages/ui/src/components/pages/WorkspacePage.tsx:779-814,838-864`
  bridges panel shortcut events. Existing panel listeners use
  `addKeyboardShortcutListener` on `window`, preventing terminal input from
  seeing handled shortcuts.
- `packages/ui/src/lib/ide-shell-layout.ts:132-177` and
  `packages/ui/src/lib/reveal-active-file.ts:4-8` define the IDE request target
  union. The request path can map target `project` to the existing right-tool
  id `project-info`.
- `server/src/config/schema.rs:437-460,508-715` owns persisted UI shortcut
  defaults and camelCase/snake_case compatibility. Serde defaults preserve old
  config files; `server/src/config/tests.rs:1266-1488` covers defaults and
  round trips.

## Recommended contract

- Name the setting `projectPanelShortcut` because it opens the existing Project
  panel, whose primary new Terminal use case is selecting worktrees.
- Default: `Mod+Shift+KeyB` (displayed as `Ctrl+Shift+B` on the user’s stated
  platform).
- In Terminal desktop mode it toggles the floating Project panel through the
  existing request/activation helper.
- In IDE desktop mode it toggles the existing `project-info` right tool.
- In compact/mobile mode it remains a no-op for the desktop floating shortcut;
  the existing compact Project surface remains available.

## Compatibility

- Add the Rust field with a serde default and update `UiConfig::default`; no
  migration is needed for existing TOML/JSON config.
- Update all frontend test settings mocks that model the shortcut store.

## Unresolved questions

- None blocking. The default should remain expressed as `Mod+Shift+KeyB` in
  config and displayed as `Ctrl+Shift+B` through the existing formatter.
