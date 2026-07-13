# Researcher 01 - Config Registry

Date: 2026-07-12
Scope: config source, global registry path, parser, config writing
Status: complete

## Findings

- `server/src/main.rs` currently resolves startup config from `--workspace` / `DAM_HOPPER_WORKSPACE`, global config defaults, then current directory.
- `server/src/config/finder.rs` defines `CONFIG_FILENAME = "dam-hopper.toml"` and walks upward from a start directory.
- `server/src/config/global.rs` owns XDG config path logic for `~/.config/dam-hopper/config.toml`; add `global_registry_path()` beside it for `dam-hopper.toml`.
- `server/src/config/parser.rs` rejects absolute `projects.path` via `validate_relative_path()`.
- `resolve_project()` currently joins every project path against `config_dir`, so absolute paths need explicit handling.
- `project_to_toml()` always pathdiffs project paths relative to config dir; global registry would produce brittle `../../..` paths.
- `server/src/api/config.rs` also relativizes project paths before writing JSON updates to TOML.

## Constraints

- Keep `config.toml` for app preferences; do not make it a competing project registry.
- No automatic migration now; docs should explain manual copy/edit.
- `env_file` must remain project-relative and traversal-free.
- Existing local discovery should remain available as explicit or fallback behavior.

## Plan Implications

- Add Phase 01 for config-source resolution before parser changes.
- Add Phase 02 for parser acceptance of absolute project paths.
- Add Phase 05 for write roundtrip, because config update behavior is separate from parse behavior.

## Unresolved Questions

- Whether upward local discovery remains automatic fallback after global registry is missing.
- Whether `[workspace].root` should be deprecated or redefined.
- Whether `workspace_dir` should remain in `AppState` long term or be replaced by clearer config/project concepts.
