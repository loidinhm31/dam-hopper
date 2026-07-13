# Brainstorm: Global Project Registry + Absolute Project Paths

Date: 2026-07-12 18:56

## Problem Statement

Current DamHopper config model treats a directory containing `dam-hopper.toml` as the workspace boundary. That blocks the desired model:

- One predefined settings location owns DamHopper config.
- Projects can live anywhere on disk.
- Project paths in TOML can be absolute.
- `dam-hopper.toml` should live in a predefined global app-managed location, similar in spirit to the managed cloudflared binary location.
- User will manually move existing local `dam-hopper.toml` into global config. No automatic migration required now.

Current blockers observed:

- `server/src/config/finder.rs` searches upward for local `dam-hopper.toml`.
- `server/src/config/parser.rs` rejects absolute project paths via `validate_relative_path`.
- `server/src/fs/sandbox.rs` allows file operations only inside one workspace root.

## Non-Negotiable Hard Truth

Allowing arbitrary filesystem paths per API request is too risky. DamHopper is a server exposed over HTTP/WebSocket and supports mobile/remote access. If file APIs accept any absolute path from clients, auth bugs, token leaks, or UI bugs become full-disk read/write bugs.

Recommended compromise: TOML may contain absolute project paths anywhere on disk, but runtime file access is limited to configured project roots. This satisfies "project anywhere" without turning DamHopper into an unrestricted file server.

## Evaluated Approaches

## Approach A: Minimal Parser Relaxation

Change parser to allow absolute `projects.path`; keep local `dam-hopper.toml`; leave single workspace sandbox.

Pros:

- Smallest code change.
- Fast to implement.
- Keeps old mental model.

Cons:

- Broken for file APIs outside config directory because sandbox still rejects paths.
- Confusing UX: terminals may work but file explorer/editor may fail.
- Does not solve predefined global settings location.

Verdict: reject. Looks easy, creates inconsistent behavior.

## Approach B: Global Config Registry, Project-Root Sandbox

Move primary project registry to predefined settings path, allow absolute project paths, and replace single workspace sandbox with allowed configured project roots.

Pros:

- Matches desired product model.
- Clean mental model: DamHopper owns a registry, not a repo-local workspace file.
- Supports projects anywhere.
- Keeps file APIs bounded to known project roots.
- Mirrors the existing pattern of DamHopper-managed global assets such as the cloudflared binary location.
- Backward compatibility can remain read-only/fallback if wanted later.

Cons:

- Medium refactor: config loading, workspace switching/status, fs sandbox, config writing, tests, docs.
- Existing UI labels around "workspace" need rename or semantic cleanup.
- Multi-project file watching needs care so each project root can be watched safely.

Verdict: recommended.

## Approach C: Full Unrestricted Absolute Path Mode

Global config plus file APIs accept any absolute path supplied by client.

Pros:

- Maximum flexibility.
- Simple to reason about for local-only power users.

Cons:

- High security risk.
- Unsafe with remote/mobile access.
- Makes later permission model harder.
- Hard to audit: any endpoint bug can become arbitrary disk access.

Verdict: not recommended. Only acceptable behind explicit `--unsafe-any-path` dev flag, disabled by default, with loud warnings.

## Final Recommended Solution

Use Approach B.

Define one canonical DamHopper registry file:

```toml
# ~/.config/dam-hopper/dam-hopper.toml

[workspace]
name = "default"

[[projects]]
name = "dam-hopper"
path = "C:/Users/f2s2/Downloads/dam-hopper"
type = "pnpm"

[[projects]]
name = "external-api"
path = "D:/work/client/api"
type = "cargo"
```

Keep `~/.config/dam-hopper/config.toml` for small global app preferences if desired, or fold everything into the new registry. Prefer avoiding two user-facing TOML files long-term.

Important naming choice:

- If there is only one global project registry, call it `dam-hopper.toml` under the settings folder.
- Keep `config.toml` for app preferences only, or deprecate it after migration.
- Do not keep both as equal peers forever. That creates support debt.

## Proposed Refactor Scope

1. Config source

- Add `global_registry_path()` returning XDG config path: `~/.config/dam-hopper/dam-hopper.toml`.
- Startup priority:
  - `--config <path>` if added.
  - `DAM_HOPPER_CONFIG` if added.
  - Global registry path.
  - Existing local discovery only as optional fallback, not primary model.
- Update status APIs to report `configPath`, not infer workspace path from config parent.

2. Project path resolution

- Allow absolute `projects.path`.
- Relative project paths resolve relative to config file directory for backward compatibility.
- Store resolved project path as canonical absolute path.
- On write, preserve absolute paths when project is outside config directory; do not force awkward `../../..` paths from global config.

3. Filesystem sandbox

- Replace one `WorkspaceSandbox { root }` with a project-root sandbox.
- Validation rule: project name selects root; request path must stay inside that project root.
- Workspace-wide search means search across configured project roots, not config folder.
- Watchers subscribe per project root or per selected project, not global config folder.

4. Global registry placement

- Put the primary `dam-hopper.toml` under the predefined DamHopper settings folder.
- Treat this as the canonical registry location, like other app-managed global assets.
- Do not add cloudflared binary configuration as part of this refactor.
- Keep cloudflared resolution behavior unchanged unless a separate tunnel settings feature is planned.

5. Backward compatibility

- No automatic migration now, per user decision.
- Existing local `dam-hopper.toml` may remain supported by explicit `--workspace` or fallback discovery.
- Documentation tells user how to manually move config to global registry.

## Risks

- Security regression if sandbox is relaxed globally instead of per configured project root.
- UI confusion if "workspace" continues to mean both project registry and filesystem root.
- Config write roundtrip can accidentally convert clean absolute paths into unreadable relative paths.
- Windows path handling needs tests: drive letters, backslashes, UNC/verbatim prefix behavior.
- Agent store distribution may assume projects share a workspace ancestor; verify before refactor.

## Success Metrics

- Server starts with no repo-local `dam-hopper.toml` when global registry exists.
- TOML accepts absolute Windows and Unix-style project paths.
- File list/read/write/search work for configured projects outside global config directory.
- File APIs reject paths escaping a configured project root.
- Existing local workspace mode still works when explicitly selected.
- Tests cover Windows absolute paths and path traversal attempts.

## Validation Criteria

- Parser tests:
  - accepts absolute project path.
  - rejects duplicate project names.
  - keeps env_file project-relative and rejects traversal.
  - writes absolute project paths cleanly from global config.
- FS tests:
  - project root outside config dir allowed.
  - `../` escape rejected.
  - sibling absolute path rejected unless configured as another project.
- Manual smoke:
  - global registry points to two projects on different drives.
  - terminal opens in each project.
  - file explorer opens files in each project.

## Next Steps

Recommended implementation plan complexity: medium/hard. This touches core config, filesystem security, API semantics, and docs. Do not do this as a one-file parser change.

Suggested phase split:

1. Config registry + absolute project parsing.
2. Project-root sandbox + API adjustments.
3. UI/docs terminology cleanup + tests.
