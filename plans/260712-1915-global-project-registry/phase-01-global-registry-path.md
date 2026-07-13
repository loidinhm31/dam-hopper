# Phase 01 - Global Registry Path + Config Loading Priority

## Context links

- Parent plan: [plan](./plan.md)
- Brainstorm: [global project registry brainstorm](../reports/brainstorm-260712-1856-global-project-registry.md)
- Depends on: none
- Feeds: [phase-02](./phase-02-parser-absolute-paths.md), [phase-04](./phase-04-api-state-adjustments.md)

## Overview

Date: 2026-07-12
Description: Add the canonical registry path, explicit config input, and a single config-resolution function.
Priority: P1
Implementation status: Completed
Review status: Reviewed (Score: 7.5/10, see [review report](./reports/phase-01-review-260712-2200.md))
Effort: 3h

## Key Insights

- Startup currently mixes `--workspace`, global defaults, current directory, and `load_workspace_config()` in [server/src/main.rs](../../server/src/main.rs).
- [server/src/config/global.rs](../../server/src/config/global.rs) already owns XDG config-dir logic for `config.toml`; the registry path should reuse that pattern but target `dam-hopper.toml`.
- [server/src/config/finder.rs](../../server/src/config/finder.rs) can remain as legacy local discovery; it should no longer be the primary startup model.

## Requirements

- Add `global_registry_path() -> PathBuf` for the canonical `~/.config/dam-hopper/dam-hopper.toml` path.
- Add `--config <path>` and `DAM_HOPPER_CONFIG` support.
- Preserve `--workspace` and `DAM_HOPPER_WORKSPACE` as legacy workspace-directory loading.
- Keep empty-config startup behavior when no registry or local config is found.
- Do not migrate user files automatically.

## Architecture

Create a config resolver module that returns one loaded `DamHopperConfig` plus its `config_path`. Main startup should no longer hand-roll priority decisions inline. Proposed priority:

1. `--config` / `DAM_HOPPER_CONFIG`: `read_config(path)` directly, hard error on invalid file.
2. `--workspace` / `DAM_HOPPER_WORKSPACE`: `load_workspace_config(dir)` legacy directory discovery.
3. `global_registry_path()`: load if file exists.
4. `global_config.defaults.workspace`: legacy directory discovery.
5. Current directory: legacy discovery.
6. Empty config fallback.

## Related code files

- [server/src/main.rs](../../server/src/main.rs)
- [server/src/config/global.rs](../../server/src/config/global.rs)
- [server/src/config/finder.rs](../../server/src/config/finder.rs)
- [server/src/config/mod.rs](../../server/src/config/mod.rs)
- [server/src/config/parser.rs](../../server/src/config/parser.rs)
- [server/src/config/tests.rs](../../server/src/config/tests.rs)

## Implementation Steps

1. Add `global_registry_path()` next to `global_config_path()`.
2. Add `server/src/config/resolve.rs` with a small `ConfigResolutionInput` or function arguments for explicit config, workspace, global defaults, and cwd.
3. Move startup config selection from `main.rs` into the resolver.
4. Add `config: Option<PathBuf>` to the Clap `Cli` struct with `env = "DAM_HOPPER_CONFIG"`.
5. Export the resolver and registry path from `config/mod.rs`.
6. Update `main.rs` logging to report loaded `config_path`, workspace name, and project count.

## Todo list

- [x] Add `global_registry_path()`.
- [x] Add `--config` / `DAM_HOPPER_CONFIG` CLI wiring.
- [x] Add config resolver module and tests.
- [x] Replace inline startup resolution in `main.rs`.
- [x] Keep legacy local discovery reachable but no longer primary when global registry exists.

## Success Criteria

- `cargo run -- --config <path-to-dam-hopper.toml>` loads that exact file.
- `DAM_HOPPER_CONFIG=<path>` works without `--workspace`.
- When no explicit config is provided and global registry exists, the server loads it.
- Existing `--workspace <dir>` behavior still works.
- Missing config still starts with an empty config, matching current fallback behavior.

## Risk Assessment

- Low implementation risk: mostly additive wiring.
- Medium product risk: users may be confused if `--workspace` still exists. Docs in Phase 06 must explain priority clearly.
- Test risk: environment-variable tests must isolate env changes to avoid cross-test pollution.

## Security Considerations

- Explicit `--config` should not loosen filesystem access. It only chooses a registry file; sandbox changes happen in Phase 03.
- Log config paths but never log auth tokens or secret env values.

## Next steps

- Implement Phase 02 after this lands so the global registry can actually contain absolute `projects.path` values.

## Completion notes

- Added `global_registry_path()` under the existing XDG config-dir helper.
- Added startup resolver priority handling and `--config` / `DAM_HOPPER_CONFIG` support in the Rust server.
- Added focused resolver tests for explicit config, global registry priority, legacy fallbacks, and explicit-config parse errors.
- Validated with `cargo test resolve_ -j 1` in `server/`.

## Review findings (2026-07-12)

**Score:** 7.5/10 - Conditional approval  
**Report:** [phase-01-review-260712-2200.md](./reports/phase-01-review-260712-2200.md)

**Critical issues:** None  
**High priority (must fix before Phase 02):**
1. No symlink validation for explicit config paths — security boundary concern for Phase 02 absolute paths
2. Global registry path trusts `XDG_CONFIG_HOME` without validation — env injection risk
3. Obscure config parent resolution logic needs clarification

**Recommendation:** Fix findings 1-2 before proceeding to Phase 02 (est. 2h remediation).

**Next phase:** Phase 02 can proceed after security fixes.
