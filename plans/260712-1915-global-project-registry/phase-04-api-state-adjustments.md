# Phase 04 - API + State Adjustments

## Context links

- Parent plan: [plan](./plan.md)
- Depends on: [phase-03](./phase-03-per-project-sandbox.md)
- Related: [phase-05](./phase-05-config-write-roundtrip.md)
- Feeds: [phase-06](./phase-06-tests-windows-docs.md)

## Overview

Date: 2026-07-12
Description: Update workspace/status/config reload semantics so APIs describe a registry, not a shared filesystem root.
Priority: P1
Implementation status: In progress
Review status: In review
Effort: 4h

## Key Insights

- [server/src/state.rs](../../server/src/state.rs) still stores `workspace_dir`; after global registry it should not be treated as a sandbox root.
- [server/src/api/workspace.rs](../../server/src/api/workspace.rs) reports config parent as `path`, which hides the true registry file path.
- [server/src/api/config.rs](../../server/src/api/config.rs) reloads config from `workspace_dir`, which is wrong if the selected config is a specific file outside that directory-discovery model.
- [server/src/api/terminal.rs](../../server/src/api/terminal.rs) accepts `project` and `cwd`; verify defaults rather than redesigning the PTY contract.

## Requirements

- Report `configPath` in workspace status/info responses.
- Keep old response fields where practical for compatibility, but mark them semantically legacy.
- Reload config from `state.config.read().await.config_path`, not from `workspace_dir` discovery, when updating the current registry.
- Rebuild the project sandbox after config updates, init, and switch.
- Let workspace switch accept a config file path in addition to a directory path.

## Architecture

State model after this phase:

- `config.config_path`: authoritative registry file path.
- `config.projects[].path`: authoritative project roots.
- `workspace_dir`: legacy/display/default base only; not security boundary.
- `FsSubsystem`: derives allowed roots from config projects.

Add helper functions to avoid repeated project-root extraction:

```rust
fn project_roots_from_config(cfg: &DamHopperConfig) -> Vec<(String, PathBuf)>;
```

Optionally add `AppState::config_dir()` for code that genuinely needs the registry parent.

## Related code files

- [server/src/state.rs](../../server/src/state.rs)
- [server/src/api/workspace.rs](../../server/src/api/workspace.rs)
- [server/src/api/config.rs](../../server/src/api/config.rs)
- [server/src/api/terminal.rs](../../server/src/api/terminal.rs)
- [server/src/api/system.rs](../../server/src/api/system.rs)
- [server/src/api/diagnostics.rs](../../server/src/api/diagnostics.rs)
- [packages/ui/src/api/client.ts](../../packages/ui/src/api/client.ts)
- [packages/ui/src/api/ws-transport.ts](../../packages/ui/src/api/ws-transport.ts)

## Implementation Steps

1. Add `configPath` fields to workspace status/info response structs.
2. Update `GET /api/workspace/status` to report the registry file path explicitly.
3. Update `GET /api/workspace` without breaking existing `root` consumers.
4. Change config reload helper to read current `config_path` directly.
5. After config reload, call `state.fs.reinit_sandbox(project_roots_from_config(&new_cfg))`.
6. Update workspace init/switch to rebuild sandbox from project roots instead of config parent.
7. Allow switch body `path` to be either a directory or a config file path.
8. Audit `workspace_dir` users: diagnostics, settings, ssh credential keying, agent memory, agent store. Decide whether each should use config dir, project root, or remain legacy.
9. Update frontend API types for new `configPath` fields.

## Todo list

- [x] Add config path to workspace API responses.
- [x] Fix config reload source.
- [x] Reinit sandbox after all config-changing operations.
- [x] Support switch-by-config-file path.
- [x] Audit `workspace_dir` call sites and document decisions.
- [x] Update frontend API types and any status display.

## Workspace_dir audit decisions

- `api/workspace.rs`: keep `root` response field mapped from `workspace_dir` for compatibility; add explicit `configPath` as authoritative registry location.
- `api/settings.rs`: cache-clear now reloads by `config_path` and reinitializes sandbox from project roots.
- `api/system.rs` and `api/diagnostics.rs`: use `AppState::config_dir()` for host metrics sampling; this is display/host-context only.
- `api/ssh.rs`: saved credential key scope switched from `workspace_dir` to `config_path` to avoid collisions across registry switches.
- `api/agent_memory.rs`: retain `workspace.root` templating from `workspace_dir` for now (legacy display semantics); no sandbox dependency.
- `agent_store` (`state.rs` comment): still initialized at startup and not rebased on workspace switch; documented follow-up remains Phase 06/post-plan.

## Success Criteria

- Server started with `--config <global-registry>` reports that exact `configPath`.
- Config update writes and reloads the current registry file.
- Workspace switch works with both a local directory and a direct TOML file path.
- File APIs still use project roots after any config reload.
- Terminal creation with a selected project opens in the selected project's cwd or a verified explicit cwd.

## Risk Assessment

- Medium compatibility risk: frontend or tests may treat `workspace.root` as browsable.
- Medium integration risk: `workspace_dir` is used by SSH credentials, diagnostics, settings, and agent memory; each needs a deliberate choice.
- Low PTY risk if current project/cwd behavior is confirmed.

## Security Considerations

- Do not use `workspace_dir` as a fallback sandbox root after Phase 03.
- Config switch must rebuild sandbox before serving new file requests.
- Direct config-file switch must not allow file APIs to access the config file's parent unless it is also a configured project root.

## Next steps

- Phase 05 completes write roundtrip behavior so API updates do not rewrite clean absolute paths into fragile relative chains.
