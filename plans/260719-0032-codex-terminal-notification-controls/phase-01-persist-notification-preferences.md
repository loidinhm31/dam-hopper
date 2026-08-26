# Phase 01 — Persist delivery and pattern preferences

## Context Links

- [Scout report](../reports/scout-260719-0032-codex-terminal-notification-controls.md)
- [Existing sound plan](../../260716-0204-terminal-notification-sound/plan.md)
- [UI config client](../../packages/ui/src/api/client.ts)
- [UI defaults](../../packages/ui/src/lib/ui-config.ts)
- [Settings store](../../packages/ui/src/stores/settings.ts)
- [Rust schema](../../server/src/config/schema.rs), [TOML mapping](../../server/src/config/global.rs), [config API](../../server/src/api/config.rs)

## Overview

- **Date:** 2026-07-19
- **Priority:** P2
- **Status:** Completed 2026-07-19 01:07 +0700
- **Goal:** Define one compatible preference contract and carry it losslessly through client state, API JSON, Rust config, and TOML.

## Key Insights

- Existing config is global and server-backed. API JSON is camelCase; the custom Rust serializer writes snake_case TOML.
- `terminalCodexNotificationsEnabled` alone triggers `~/.codex/config.toml` synchronization. New child-channel fields must never trigger that write.
- Missing fields must default to `true` for toast and browser delivery, `true` sound enabled, `100` volume, and `"default"` pattern, preserving an existing enabled setup.

## Requirements

- Add `terminalCodexNotificationToastEnabled`, `terminalCodexBrowserNotificationsEnabled`, and `terminalCodexNotificationSoundPattern` to the UI contract.
- Restrict pattern values to `"default" | "soft" | "two-tone" | "urgent"`; reject invalid API values rather than silently persisting them.
- Persist TOML as `terminal_codex_notification_toast_enabled`, `terminal_codex_browser_notifications_enabled`, and `terminal_codex_notification_sound_pattern`.
- Keep the legacy `terminalAgentNotificationsEnabled` read alias and every existing default/volume behavior.

## Architecture

`Settings patch → api.globalConfig.updateUi → Rust merge/deserialize/validate → atomic global TOML write → GET/hydrate → withUiConfigDefaults → Zustand state`.

Only an incoming `terminalCodexNotificationsEnabled` field (or a changed master value) may call `sync_codex_tui_config`; child delivery/pattern updates are config-only.

## Related Code Files

- Modify: `packages/ui/src/api/client.ts`, `packages/ui/src/lib/ui-config.ts`, `packages/ui/src/stores/settings.ts`.
- Modify: `server/src/config/schema.rs`, `server/src/config/global.rs`, `server/src/api/config.rs`.
- Modify tests: `packages/ui/src/lib/ui-config.test.ts`, `server/src/config/tests.rs`, `server/src/api/tests.rs`.
- Create/delete: none.

## Implementation Steps

1. Define the shared TypeScript literal union near `UiConfig`; use it for the optional API field, defaults, and store state/patches.
2. Extend `DEFAULT_UI_CONFIG`, `withUiConfigDefaults`, store initialization, hydration, and the debounced persistence projection. Preserve false values with `??`, never `||`.
3. Add Rust defaults and `UiConfig` serde aliases for the snake/camel names; use a serde enum (or validated constrained type) for the four patterns so JSON and TOML reject unknown values.
4. Add snake_case conversion entries in `normalize_ui_json_for_toml` and update Rust `Default` construction.
5. Run pattern validation alongside existing UI validation in `merge_global_ui_config`; do not expand the Codex-TUI synchronization predicate.
6. Add round-trip, omitted-field/default, API partial-merge, invalid-pattern rejection, and master-sync-isolation tests.

## Todo List

- [ ] Finalize names/defaults across TS and Rust.
- [ ] Implement config serialization/deserialization and merge validation.
- [ ] Preserve existing TOML aliases and master synchronization behavior.
- [ ] Add config compatibility and invalid-input coverage.

## Success Criteria

- An older config hydrates with toast/browser enabled and the Default pattern.
- A partial child setting update preserves all unrelated UI settings and does not rewrite `~/.codex/config.toml`.
- GET returns camelCase; written TOML contains only the specified snake_case keys.
- Invalid sound pattern fails API validation without modifying config.

## Risk Assessment

- **Camel/snake drift:** cover exact written keys and JSON merge tests.
- **Unintended TUI writes:** test child-only updates against a temporary Codex home.
- **Future enum additions:** fail closed at server validation and use a TS exhaustive pattern map in Phase 02.

## Security Considerations

- Config fields are simple booleans/constrained identifiers; do not accept asset paths, URLs, or arbitrary oscillator expressions.
- Maintain existing atomic `0600` global-config writes and error responses.

## Next Steps

Implement the sound engine against the exact shared pattern union in Phase 02.
