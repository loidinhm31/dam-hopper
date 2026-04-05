# Phase 01 Completion Report: Rust Scaffold + Config Parsing

**Date**: 2026-04-05 | **Plan**: [260405-1644-rust-server-refactor](../260405-1644-rust-server-refactor/plan.md)

## Summary

Phase 01 complete. Rust binary crate at `server/` with full config parsing layer porting the Node.js `@dev-hub/core` config subsystem.

## Files Created

| File | Purpose |
|------|---------|
| `server/Cargo.toml` | axum, serde, toml, clap+env, thiserror, dirs, dotenvy, pathdiff |
| `server/.gitignore` | Excludes `/target/` |
| `server/src/main.rs` | CLI entry: `--workspace`, `--port`, `--new-token` |
| `server/src/lib.rs` | Crate root |
| `server/src/error.rs` | `AppError` enum with `status_code()` |
| `server/src/utils/fs.rs` | `atomic_write` — temp→rename, 0o600 on Unix |
| `server/src/config/schema.rs` | All config structs + `CommandKind` enum |
| `server/src/config/presets.rs` | Build/run presets, `get_effective_command(CommandKind)` |
| `server/src/config/parser.rs` | TOML r/w, path resolution, traversal validation |
| `server/src/config/finder.rs` | Walk-up config discovery to home dir |
| `server/src/config/global.rs` | XDG config, known workspaces CRUD, `_at()` variants |
| `server/src/config/discovery.rs` | Marker-file project detection, `discover_projects` |
| `server/src/config/tests.rs` | 22 unit tests |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| `CommandKind` enum (not `&str`) | Type-safe; eliminates silent empty-string returns for unknown commands |
| Single `ServiceConfig` struct | `ServiceConfigRaw` was identical — DRY violation removed |
| `_at(path)` function variants | Deterministic test isolation without env var races |
| `atomic_write` with `0o600` (Unix) | Global config will store auth tokens in later phases |
| Path traversal validation in `validate_config` | Reject `..` and absolute paths in `project.path` / `env_file` |
| Global config parse errors → `Ok(None)` | Matches Node.js parity — corrupted config warns and ignores |
| `config_path: PathBuf` (not `String`) | Type-safe internal field; skipped in serialization |
| `agents` not written in `write_config` | Agent assignment managed by agent-store subsystem, not UI config editor |

## Tests: 22/22 Passing

Categories covered: presets, TOML parse, validation (duplicate names, absolute paths, traversal), config roundtrip, finder walk-up, global config CRUD, discovery (marker priority, skip dot/node_modules dirs), effective command resolution.

## Code Review Findings Fixed

- **Critical**: file permissions (0o644→0o600), path traversal, absolute path acceptance
- **Warnings**: DRY on ServiceConfigRaw, silent agents drop (documented), parse error parity, duplicated atomic_write, unused tokio-stream dep
- **Suggestions**: CommandKind enum, PathBuf for config_path, DETECTION_ORDER comment, test assertion fix

## Next Step

→ Phase 02: PTY session management — consumes `ProjectConfig` (resolved commands + env)
