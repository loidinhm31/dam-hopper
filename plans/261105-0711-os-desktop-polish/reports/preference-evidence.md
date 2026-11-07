# Workbench Preferences Source, shortcuts, appearance, and dock evidence

Status: complete, source inspection only. Planning authorization: native-user `plan/parallel`, protocol v3; no implementation. Root `/home/loidinh/WS/dam-hopper`; Linux x64, React 19/Rust/pnpm; date `261105`; branch `main`.

## 1. Preferences Source round-trip pipeline
- **Store state & hydration**: `packages/ui/src/stores/settings.ts:81-115,334-372,373-481`.
  - Hydration resolves `profileId ?? owner?.profileId ?? preferencesProfileId`. If unset, loads offline snapshot from `useWorkbenchSelectionsStore.getState().preferencesSnapshot` (`:384-390`).
  - If connected, fetches `boundClient.get()` (`GET /api/global-config`), parses `withUiConfigDefaults(config.ui)`, updates state, and saves snapshot via `updatePreferencesSnapshot()` (`:426-471`).
  - `switchPreferenceSource(profileId)` (`:483-491`): clears debounce timer, resets pending patch, increments `latestLocalEditId`, resets active transaction, updates `setPreferencesProfileId(profileId)`, and triggers `hydrate()`.
- **Debounced save & rollback**: `packages/ui/src/stores/settings.ts:614-702`.
  - Coalesces rapid edits (500ms debounce), generates `latestLocalEditId`, captures `activeTransaction = { profileId, generation, editId }`.
  - Posts patch to `boundApi.updateUi(payload)` (`POST /api/global-config/ui`). On error or generation mismatch, rolls back store and snapshot to `lastSavedSettings` (`:676-699`).
- **Preferences source authority**: `packages/ui/src/stores/workbench-selections.ts:54-123`.
  - Persisted under `"dam-hopper:preferences-source:v1"`. Stores `preferencesProfileId`, `preferencesStatus` (`"unset" | "active" | "source-removed"`), `preferencesSnapshot`. Isolated from `settingsProfileId` (`:113-122`).
- **Backend API UI handler**: `server/src/api/config.rs:598-609,611-673,675-813`.
  - `POST /api/global-config/ui`: calls `update_global_ui_at_path`.
  - `merge_global_ui_config` (`:611-673`): deserializes existing `UiConfig`, migrates legacy notification fields, merges incoming JSON, deserializes into `crate::config::schema::UiConfig`, and validates font sizes, mobile keyboard sizes, notification volume, pinned mount, and window placement.
  - `write_global_config_at` (`server/src/config/global.rs:85-134`): serializes `UiConfig` to JSON, maps keys to snake_case via `normalize_ui_json_for_toml`, converts to TOML, and writes atomically.

## 2. Established scalar shortcuts & incomplete persistence paths
- **12 Established scalar shortcuts (observed source)**:
  1. `searchTextShortcut` / `search_text_shortcut`: default `"Mod+Shift+KeyF"` (`settings.ts:86`, `schema.rs:1020`)
  2. `searchFilenameShortcut` / `search_filename_shortcut`: default `"DoubleShift"` (`settings.ts:87`, `schema.rs:1025`)
  3. `terminalWorkspaceShortcut` / `terminal_workspace_shortcut`: default `"Mod+Shift+Backquote"` (`settings.ts:88`, `schema.rs:1030`)
  4. `terminalFilePanelShortcut` / `terminal_file_panel_shortcut`: default `"Mod+Shift+KeyE"` (`settings.ts:89`, `schema.rs:1035`)
  5. `projectPanelShortcut` / `project_panel_shortcut`: default `"Mod+Shift+KeyZ"` (`settings.ts:90`, `schema.rs:1040`)
  6. `revealActiveFileShortcut` / `reveal_active_file_shortcut`: default `"Alt+F1"` (`settings.ts:91`, `schema.rs:1045`)
  7. `gitPanelShortcut` / `git_panel_shortcut`: default `"Mod+Shift+KeyG"` (`settings.ts:92`, `schema.rs:1049`)
  8. `portsPanelShortcut` / `ports_panel_shortcut`: default `"Mod+Shift+KeyP"` (`settings.ts:93`, `schema.rs:1052`)
  9. `fleetTerminalShortcut` / `fleet_terminal_shortcut`: default `"Mod+Shift+KeyM"` (`settings.ts:94`, `schema.rs:1057`) — *Obsolete, to be retired*
  10. `terminalFontSizeIncreaseShortcut` / `terminal_font_size_increase_shortcut`: default `"Ctrl+Alt+Shift+Equal"` (`settings.ts:95`, `schema.rs:1062`)
  11. `terminalFontSizeDecreaseShortcut` / `terminal_font_size_decrease_shortcut`: default `"Ctrl+Alt+Minus"` (`settings.ts:96`, `schema.rs:1067`)
  12. `cognitoModeShortcut` / `cognito_mode_shortcut`: default `"Mod+Alt+KeyB"` (`settings.ts:110`, `schema.rs:1144`)
- **Incomplete persistence paths (broken round-trips)**:
  - `osPaletteShortcut` (`settings.ts:112,210,312,367,583`): stored in client Zustand, but **missing** from `client.ts:UiConfig`, `DEFAULT_UI_CONFIG`, `withUiConfigDefaults`, server `schema.rs:UiConfig`, and `global.rs:normalize_ui_json_for_toml`. Saving drops it; reloading restores hardcoded default `"Ctrl+Alt+KeyK"`.
  - `osCycleFocusShortcut` (`settings.ts:113,212,313,368,585`): same defect—client only, dropped by server, resets on reload to `"Ctrl+Alt+Escape"`.
  - `input-arbiter.ts:117-118,136-137`: hardcodes fallback shadowing (`matchesKeyboardShortcut || isOsPaletteShortcut`). Remapping does not disable the original chord.
  - Dock appearance and `cursorTheme` (`system` | `theme`): absent from client types, store, and server schema.
  - Extra-app shortcuts: 17 total apps in `app-registry.ts:3-157`. Zero shortcut consumers currently wired in `packages/ui/src/os/`. Brainstorm-proposed mapping links 6 apps to established scalars (`search`, `terminals`, `files`, `git`, `ports-tunnels`, `project-info`), leaving 11 apps unassigned without an extra-app map.

## 3. Fleet compatibility inventory
- **TypeScript web & server consumers to retire**:
  - TS defs: `packages/ui/src/api/client.ts:2068`, `packages/ui/src/lib/shortcuts.ts:10`, `packages/ui/src/lib/ui-config.ts:171,276-278`, `packages/ui/src/stores/settings.ts:94,202-203,294,347,441,519-520`.
  - UI inputs: `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.tsx:166,322-333`, `TerminalPanel.tsx:1132`.
  - Server defs: `server/src/config/schema.rs:739-741,1056-1060,1184`, `server/src/config/global.rs:191`.
  - Web & Server tests: `packages/ui/src/lib/ui-config.test.ts:22,82,127`, `packages/ui/src/stores/settings.test.ts:51`, `packages/ui/src/lib/terminal-keyboard-shortcuts.test.ts:98`, `server/src/config/tests.rs:1228,1277,1404,1454,1475`, `packages/ui/browser-tests/project-worktree-target.browser.tsx:53`, `packages/ui/browser-tests/terminal-panel-replay-notifications.browser.tsx:110`.
- **Retained out-of-scope compatibility consumers**:
  - Android client: `PreferencesPrivacyView.kt:85,100`, `RemoteConfigModels.kt:47,86`, `SettingsModels.kt:399,454,602,666,739`, `SettingsModelsTest.kt:57`.
  - Documentation: `docs/configuration-guide.md:605,623`, `frontend-components/terminal-and-ide.md:69-71`.
  - Server schema must preserve serde tolerance/backward-compatibility so incoming Android patches with `fleetTerminalShortcut` are not rejected.

## 4. Null vs missing representation & recommended data shape
- **Observed null/missing mechanics**:
  - **API rejection on null**: `server/src/config/schema.rs` defines shortcuts as Rust `String`. An incoming `{ "searchTextShortcut": null }` fails JSON deserialization in `merge_global_ui_config` (`:655`) with 400 Bad Request before reaching TOML writer.
  - **TOML omission**: `server/src/config/global.rs:240` (`json_to_toml`) drops `Value::Null => None`. If serde allowed `Option<String>`, missing TOML keys would re-populate defaults via `#[serde(default = "...")]`.
  - **Client fallback**: `ui-config.ts:249-286` uses `??`, treating `null` as missing and restoring default chord.
- **Recommended representation contract**:
  - **Omitted in PATCH**: unchanged. Note: `merge_json_objects` (`server/src/api/config.rs:815`) is shallow; `app_shortcuts` requires deep entry merging like `terminalAgentNotifications` (`:622-653`).
  - **Missing in persisted TOML**: unconfigured, hydrate command default.
  - **Explicitly unbound**: durably encoded as empty string `""` on disk in TOML; exposed as `null` over JSON API and client store.
  - **Reset to default**: PATCH sending default chord string restores default binding.
- **Recommended schema (proposed)**:
  ```ts
  // packages/ui/src/api/client.ts & stores/settings.ts
  dockPadding?: number;              // 0..16 px, default 8 (proposed)
  dockItemSpacing?: number;          // 0..12 px, default 6 (proposed)
  dockOuterSpacing?: number;         // 0..24 px, default 12 (proposed)
  dockRadius?: number;               // 0..28 px, default 18 (proposed)
  cursorTheme?: "system" | "theme";  // default "system" (proposed)
  osPaletteShortcut?: string | null; // default "Ctrl+Alt+KeyK"
  osCycleFocusShortcut?: string | null; // default "Ctrl+Alt+Escape"
  appShortcuts?: Record<string, string | null>; // extra apps map
  ```
  ```rust
  // server/src/config/schema.rs (UiConfig)
  #[serde(default = "default_dock_padding", alias = "dock_padding")]
  pub dock_padding: u16,
  #[serde(default = "default_dock_item_spacing", alias = "dock_item_spacing")]
  pub dock_item_spacing: u16,
  #[serde(default = "default_dock_outer_spacing", alias = "dock_outer_spacing")]
  pub dock_outer_spacing: u16,
  #[serde(default = "default_dock_radius", alias = "dock_radius")]
  pub dock_radius: u16,
  #[serde(default, alias = "cursor_theme")]
  pub cursor_theme: CursorTheme,
  #[serde(default = "default_os_palette_shortcut", alias = "os_palette_shortcut")]
  pub os_palette_shortcut: String,
  #[serde(default = "default_os_cycle_focus_shortcut", alias = "os_cycle_focus_shortcut")]
  pub os_cycle_focus_shortcut: String,
  #[serde(default, alias = "app_shortcuts")]
  pub app_shortcuts: std::collections::HashMap<String, String>,
  ```

## 5. Browser-local dock boundary & storage error handling
- **Storage boundary**: `packages/ui/src/os/persistence.ts:677-717`.
  - Stored in browser `localStorage` key `"dam-hopper:os:v1:dock"`.
  - `exportOsEnvelope` (`:730-755`) exports dock pins. `importOsEnvelope` (`:757-810`) validates and projects dock pins, but currently has no active callers in `packages/ui/src/os`.
- **Defects & required fixes**:
  - `loadDockPins()` (`:698`): `return valid.length > 0 ? valid : [...DEFAULT_DOCK_PINS];` treats empty saved dock `[]` as invalid, resetting to default. Empty array must be preserved as valid saved state.
  - `saveDockPins()` (`:706-717`): returns `false` on `localStorage.setItem` failure (quota exceeded/private mode), but `Dock.tsx:40-42` calls it inside `useEffect` without checking return value. Write failure must surface error state.
  - Disconnected `OS_SHORTCUTS_STORAGE_KEY` (`dam-hopper:os:v1:shortcuts` at `:678,735`): must remain inactive; shortcuts belong solely to Workbench Preferences Source.

## 6. Focused test commands from package manifests
- **Client vitest (`packages/ui/package.json:8`)**:
  - `pnpm --filter @dam-hopper/ui test src/stores/settings.test.ts`
  - `pnpm --filter @dam-hopper/ui test src/lib/ui-config.test.ts`
  - `pnpm --filter @dam-hopper/ui test src/os/persistence.test.ts`
  - `pnpm --filter @dam-hopper/ui test src/os/input-arbiter.test.ts`
  - `pnpm --filter @dam-hopper/ui test src/stores/workbench-selections.test.ts`
  - `pnpm --filter @dam-hopper/ui test src/components/pages/SettingsPage.test.tsx`
  - `pnpm --filter @dam-hopper/ui test src/components/organisms/SettingsAppearanceSection.test.tsx`
- **Server cargo tests (`package.json:27` & `server/Cargo.toml`)**:
  - `cargo test --manifest-path server/Cargo.toml --test settings_import_export`
  - `cargo test --manifest-path server/Cargo.toml config::tests`
  - `cargo test --manifest-path server/Cargo.toml api::config`

## 7. Status & unresolved questions
- **Status**: complete evidence map. Source and test citations verified. Zero product code edited; no checks executed.
- **Unresolved questions**:
  1. Deep-merge for `app_shortcuts`: `merge_global_ui_config` must implement per-key dictionary merging so updating one app shortcut does not clobber existing app bindings.
  2. Fleet retirement coordination: whether to retain `fleet_terminal_shortcut: Option<String>` in server `UiConfig` as an ignored/deprecated serde field to prevent breakage from concurrent Android client updates.
