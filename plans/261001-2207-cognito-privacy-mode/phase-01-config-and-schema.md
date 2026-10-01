# Phase 01 — Config and schema

## Context links

- [Overview / execution contract](./plan.md); [Phase 02](./phase-02-cognito-state-and-overlay.md); [Phase 04](./phase-04-settings-ui-integration.md).
- [Rust schema](../../server/src/config/schema.rs), [global TOML writer](../../server/src/config/global.rs), [UI patch API](../../server/src/api/config.rs).
- [TS UiConfig](../../packages/ui/src/api/client.ts), [UI defaults](../../packages/ui/src/lib/ui-config.ts), [settings store](../../packages/ui/src/stores/settings.ts), [shortcut library](../../packages/ui/src/lib/shortcuts.ts).
- [Preference architecture](../../docs/system-architecture.md#phase-06-preferences-settings-usage-and-host-resources-2026-09-17), [code standards](../../docs/code-standards.md#naming-conventions).

## Overview

- Date: 2026-10-01. Priority: P2. Status: DONE (2026-10-01; 100%). Effort: 4h.
- Extend the existing preference contract end-to-end; preserve old-config defaults and owner-bound writes.

## Key Insights

- `UiConfig` serializes JSON camelCase and accepts snake_case aliases. `normalize_ui_json_for_toml` explicitly remaps each persisted key; schema-only changes would write the wrong TOML spelling.
- `merge_global_ui_config(existing, incoming)` merges partial patches before deserializing. Keep that path; no new endpoint or separate privacy config file.
- Settings have several explicit gates: `PersistedSettingsState`, defaults, `applySnapshotToStore`, `set`, `pickPersistedSettings`, `pickPersistedSettingsPatch`. All must agree.
- Settings preference source differs from selected Settings target and active project. Writes already capture client/profile/generation/edit revision and serialize saves; reuse this machinery.
- The shared parser supports wheel and DoubleShift. Cognito uses one physical-key chord, not wheel/gesture activation; constrain only this setting, not existing shortcuts.

## Requirements

- Rust fields: `cognito_mode_shortcut: String`, `cognito_mode_style: CognitoModeStyle`.
- JSON fields: `cognitoModeShortcut`, `cognitoModeStyle`. TOML `[ui]`: `cognito_mode_shortcut`, `cognito_mode_style`.
- Default shortcut `Mod+Alt+KeyB`; style enum strings exactly `heavy-blur` and `black-screen`, default `heavy-blur`.
- Existing configs missing either key load defaults; supported custom chord/style survive API → disk → readback → hydration.
- Only these preferences persist. `active`, frozen activation chord, focus and consumed-input bookkeeping never enter settings snapshots, TOML, browser storage or API bodies.
- Preserve partial-write unrelated UI values and rollback/source isolation. No broad shortcut collision manager or validation rewrite.

## Architecture

| Layer | Proposed contract |
|---|---|
| Rust | `#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]`, `#[serde(rename_all = "kebab-case")] pub enum CognitoModeStyle { #[default] HeavyBlur, BlackScreen }` |
| Rust defaults | `fn default_cognito_mode_shortcut() -> String` returns `Mod+Alt+KeyB`; `UiConfig::default()` supplies both fields |
| Rust fields | shortcut `#[serde(default = "default_cognito_mode_shortcut", alias = "cognito_mode_shortcut")]`; style `#[serde(default, alias = "cognito_mode_style")]` |
| TS wire | `export type CognitoModeStyle = "heavy-blur" | "black-screen"`; `UiConfig` adds optional `cognitoModeShortcut?: string`, `cognitoModeStyle?: CognitoModeStyle` for older-server responses |
| TS resolved state | `PersistedSettingsState` adds required `cognitoModeShortcut: string`, `cognitoModeStyle: CognitoModeStyle` |
| Shortcut library | `DEFAULT_COGNITO_MODE_SHORTCUT`; `validateCognitoModeShortcut(shortcut: string): string | null`; `normalizeCognitoModeShortcut(value: unknown): string` |
| UI normalization | `normalizeCognitoModeStyle(value: unknown): CognitoModeStyle`; extend `DEFAULT_UI_CONFIG` and `withUiConfigDefaults(ui?: Partial<UiConfig> | null): UiConfig` |

Read flow: owner-bound config → existing defaults/normalization → settings state and safe snapshot. Write flow: `saveDebounced` → allowlisted patch → captured source client `globalConfig.updateUi` → existing merge/deserialization → TOML mapping/writer.

Cognito-specific normalization treats absent/non-string/unparseable/non-keyboard/modifier-only chords as the default; invalid style from an older/malformed client snapshot becomes Heavy Blur. UI capture rejects invalid entries visibly. Rust's enum rejects unsupported style patches before writing. Do not replicate the TS key parser in Rust or silently replace unsupported styles in server writes.

## Related code files

**Modify**
- `server/src/config/schema.rs` — enum, fields, default helper and `UiConfig::default`.
- `server/src/config/global.rs` — `normalize_ui_json_for_toml` mappings for both keys.
- `server/src/config/tests.rs` — existing legacy/JSON/TOML round-trip coverage and explicit struct literals.
- `server/src/api/config.rs` — existing path is expected to remain unchanged; add no redundant merge logic.
- `server/src/api/tests.rs` — config merge/persistence consumer regressions in existing test organization.
- `packages/ui/src/api/client.ts` — exported type and optional wire fields.
- `packages/ui/src/lib/shortcuts.ts`, `shortcuts.test.ts` — new default and Cognito-only validation/normalization.
- `packages/ui/src/lib/ui-config.ts`, `ui-config.test.ts` — defaults and malformed/legacy input behavior.
- `packages/ui/src/stores/settings.ts`, `settings.test.ts` — every hydration/persistence gate and source-race behavior.
- Any exhaustive `UiConfig { ... }` Rust literal or typed fixture found by references; keep unrelated values intact.

**Create/delete**: none required. Do not add another API, configuration store or compatibility shim.

## Preflight contract

1. Re-read current schema/defaults, TOML mapping, merge tests and full settings transaction flow before editing; repository may advance after planning.
2. Search all `UiConfig` literals, `PersistedSettingsState` usages, preferences snapshot allowlists and shortcut fixtures; enumerate affected consumers.
3. Freeze the names/types/defaults above for Phases 02–04; only Phase 01 owns `shortcuts.ts` until contract delivery.
4. Preserve existing server authentication, preference-source selection, debounce, rollback and generation fences. No dependency/version changes.

## Implementation Steps

1. Add `CognitoModeStyle` adjacent to other UI enums; add serde-defaulted fields and `default_cognito_mode_shortcut()`; update manual `Default` and explicit schema literals.
2. Add `"cognitoModeShortcut" => "cognito_mode_shortcut"` and `"cognitoModeStyle" => "cognito_mode_style"` in `normalize_ui_json_for_toml`. Confirm reads accept both conventional snake_case TOML and canonical JSON names.
3. Extend TS `UiConfig` and export `CognitoModeStyle`; keep optional wire fields for missing older responses, required resolved store fields.
4. Add the constant and Cognito-specific helper signatures above. Reuse `parseShortcut`, `validateShortcut`, `formatShortcut`; require `kind === "keyboard"` with a usable non-modifier code. Reject `DoubleShift`, wheel and modifier-only codes. Preserve exact modifier/platform matching and composition/repeat policies; do not reject arbitrary OS-reserved chords with a new platform registry.
5. Extend `DEFAULT_UI_CONFIG` and override both fields explicitly in `withUiConfigDefaults` after spreading input; do not let `undefined`, null-like runtime input or invalid values override safe defaults.
6. Add both fields to store defaults, `applySnapshotToStore`, `set`, `pickPersistedSettings` and accepted patch selection. Apply the same normalization to snapshots and edits; retain existing captured save/rollback flow.
7. Extend existing behavioral tests: legacy config yields usable mask defaults; custom values survive JSON/TOML readback; changing one field preserves style/shortcut and unrelated preferences; invalid server enum does not alter file; malformed local snapshots resolve safely; switching preference source during save cannot apply late Cognito rollback to a new source.
8. Do not add tests asserting just copied constants or forwarding mocks. Group read/write round trips and isolation into consumer-visible scenarios. Update all affected fixtures for isolation; coordinator executes checks after integration.

## Todo list

- [x] Freeze wire/TOML/default contract and locate exhaustive consumers.
- [x] Implement schema plus TOML mapping and legacy defaults.
- [x] Implement TS normalization and complete settings persistence path.
- [x] Add round-trip, malformed-input and owner-race regressions.
- [x] Hand off exact state fields/helpers to Phases 02–04.

## Completion evidence

- Rust config/API coverage verified the legacy defaults, camelCase/snake_case names, persisted round trip and invalid-style rejection.
- UI coverage verified keyboard-only shortcut normalization, malformed-value defaults, preference hydration and debounced persistence.
- Scoped results: Rust filtered runs passed 4/4 (`cognito`), 18/18 (`ui_config`) and 146/146 (`config`); focused UI tests passed 47/47; the full UI package passed 2,110/2,110. Rust filters overlap; focused UI files are included in the full UI run.
- Full command details: [Phase 01 tester report](../reports/tester-261001-2316-phase-01-config-schema-tests.md).

## Success Criteria

- An old `[ui]` without new keys resolves to default chord and Heavy Blur.
- Custom shortcut plus Black Screen persist to snake_case TOML and return canonical camelCase JSON unchanged.
- One-key UI patch preserves the other privacy preference and unrelated settings.
- Invalid enum input fails before persistence; snapshot normalization cannot leave an undismissable chord.
- Changing connection/preference source cannot reroute a scheduled write or overwrite the new source on stale completion.
- No runtime mask state appears in persisted snapshots or network requests.

## Side-effect review checklist

- [x] TOML serialization, imports/exports and every `UiConfig` literal still work.
- [x] Existing search/panel/font shortcuts retain accepted syntax and normalization.
- [x] Offline snapshot retention, 500 ms debounce, save chain and rollback remain intact.
- [x] Settings target / active project do not replace the bound preference source.
- [x] Unknown style is rejected server-side without partial file mutation.
- [x] Activation causes zero config writes; no new endpoints, dependencies or schema migrations.

## Risk Assessment

- Missing mapping or store picker: preference looks saved but vanishes on reload. Mitigate full disk/hydration round trip.
- Optional wire fields leaking into runtime: shortcut stops matching. Mitigate explicit normalization at defaults and snapshots.
- Scope drift: late source response replaces local chord. Existing fences stay mandatory; active chord freeze is Phase 02 defense.
- Older server cannot persist new fields: coordinated client/server deployment required for promised persistence; do not claim save success qualification against an old server.

## Security Considerations

- Preferences are non-secret metadata; do not log keypresses, terminal text or mask activity payloads.
- Existing authenticated global-config API remains sole persistence authority; no widened CORS/permissions.
- Runtime mask is not authentication/encryption and must not enter server session models.

## Next steps

Phase 01 implementation is complete. Phases 02 and 04 may build on the frozen preference contract; Phase 05 owns combined qualification.
