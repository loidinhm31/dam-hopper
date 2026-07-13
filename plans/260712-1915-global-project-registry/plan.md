---
title: "Global Project Registry + Absolute Project Paths"
description: "Move project registry to ~/.config/dam-hopper/dam-hopper.toml, allow absolute project paths, replace single-root sandbox with per-project-root validation"
status: in-progress
priority: P1
effort: 18h
branch: main
tags: [config, security, filesystem, core-refactor]
created: 2026-07-12
---

# Global Project Registry + Absolute Project Paths

## Summary

Replace DamHopper's repo-local `dam-hopper.toml` discovery model with a global registry at `~/.config/dam-hopper/dam-hopper.toml`. Allow absolute project paths in TOML. Replace single-root `WorkspaceSandbox` with per-project-root validation so file APIs work for projects scattered across the filesystem — without opening arbitrary disk access.

Plan progress: 1/6 phases complete (17%).

## Current Choke Points

- `main.rs` and `config/finder.rs`: startup is workspace-directory discovery first.
- `config/parser.rs`: absolute `projects.path` is rejected and writes always pathdiff to config dir.
- `fs/sandbox.rs` and `fs/mod.rs`: one workspace root bounds all file APIs.
- `api/fs.rs` and `api/ws.rs`: requests are project-scoped but still validated against that one root.

## Target State

- Canonical registry: `~/.config/dam-hopper/dam-hopper.toml` (XDG)
- New CLI flag `--config <path>` + env `DAM_HOPPER_CONFIG` override registry location
- Projects may have absolute paths; relative paths resolve against config file parent
- File APIs validate per-project root (no single workspace root requirement)
- `env_file` remains project-relative, traversal-blocked (no change)
- No automatic migration; `config.toml` keeps app prefs role

## Phases

| # | Phase | Status | Effort | Link |
| --- | --- | --- | --- | --- |
| 1 | Global Registry Path + Config Loading Priority | Completed (Reviewed: 7.5/10) | 3h | [phase-01](./phase-01-global-registry-path.md) |
| 2 | Parser: Absolute Project Paths | Blocked | 2h | [phase-02](./phase-02-parser-absolute-paths.md) |
| 3 | Per-Project-Root Sandbox | Pending | 4h | [phase-03](./phase-03-per-project-sandbox.md) |
| 4 | API + State Adjustments | Pending | 4h | [phase-04](./phase-04-api-state-adjustments.md) |
| 5 | Config Write Roundtrip | Pending | 2h | [phase-05](./phase-05-config-write-roundtrip.md) |
| 6 | Integration Tests + Windows Paths + Docs | Pending | 3h | [phase-06](./phase-06-tests-windows-docs.md) |

## Dependencies

- Brainstorm report: [global project registry brainstorm](../reports/brainstorm-260712-1856-global-project-registry.md).
- Research notes: [config registry research](./research/researcher-01-config-registry.md), [sandbox API research](./research/researcher-02-sandbox-api.md).
- Codebase docs: [codebase summary](../../docs/codebase-summary.md), [system architecture](../../docs/system-architecture.md), [project overview PDR](../../docs/project-overview-pdr.md).

## Architecture Decision

**Approach B** from brainstorm (Global Config Registry, Project-Root Sandbox). Approach A (parser-only) creates inconsistent behavior. Approach C (unrestricted paths) is a security risk with remote/mobile access.

## Security Invariant

> Runtime file access is limited to directories explicitly listed as `projects[].path` in the loaded config. No API endpoint may resolve or access a path outside these configured roots, regardless of what the client sends.

## Validation Strategy

- Rust focused checks per phase: `cd server && cargo test <module_or_test_name> -j 1`.
- Final backend gate: `cd server && cargo test -j 1`.
- Manual smoke: global registry with two absolute projects, file explorer/search/write, terminal cwd, and path escape rejection.

## Unresolved Questions

1. **Fallback discovery**: Should the server still walk upward for a local `dam-hopper.toml` when no `--config` is given and no global registry exists? Brainstorm suggests "optional fallback, not primary model." Decision needed before Phase 01 implementation.

2. **`workspace_dir` semantics post-refactor**: Today `workspace_dir` = config parent = sandbox root = "the workspace." With projects on different drives, what does `workspace_dir` mean? Candidates: (a) config file parent, (b) first project root, (c) remove the concept. Affects `GET /api/workspace` response and agent store path resolution.

3. **`workspace.root` field**: The TOML schema has `[workspace] root = "."`. Is this still meaningful when projects are absolute? Should it become optional/deprecated?

4. **Agent store path**: `AgentStoreService` is initialized from workspace dir. If registry is in `~/.config/dam-hopper/`, the agent store would be `~/.config/dam-hopper/.dam-hopper/agent-store/` — is that the right location, or should it stay project-adjacent?

5. **File watcher roots**: `FsWatcherManager` currently attaches one watcher per workspace root. With multi-root, each project root gets its own watcher. Should there be a max count or explicit opt-in per project?

6. **`workspace:switch` API**: Currently reloads from a directory path. With global registry, switching means loading a different config file rather than finding one by directory walk. Rethink or deprecate?

## Current Status (2026-07-12)

**Phase 01 Review Complete** - Score: 7.5/10

**Blockers for Phase 02:**
1. **[P1]** Symlink validation for explicit config paths must be added to prevent security bypass when Phase 02 enables absolute project paths
2. **[P1]** XDG_CONFIG_HOME validation needed to prevent malicious env injection
3. **[P2]** Config parent resolution logic needs clarification

**Review report:** [phase-01-review-260712-2200.md](./reports/phase-01-review-260712-2200.md)

**Next actions:**
1. Fix High Priority Findings 1-2 from review (est. 2h)
2. Create decision document for unresolved questions 2-6
3. Proceed to Phase 02 implementation
