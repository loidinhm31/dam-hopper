# Phase 01: Rust Project Scaffold + Config Parsing

## Context
- Parent: [plan.md](./plan.md)
- Research: [researcher-02-rust-ecosystem.md](./research/researcher-02-rust-ecosystem.md)

## Overview
- **Priority**: P1 — foundation for all subsequent phases
- **Status**: DONE ✓ (2026-04-05)
- **Effort**: 8h

Initialize Rust project, establish module structure, implement TOML config parsing that's compatible with existing `dev-hub.toml` format.

## Key Insights

- Existing config uses snake_case on disk, camelCase in TS types — serde handles this natively
- Zod schema validation in core maps to serde + custom validators in Rust
- Global config at `~/.config/dev-hub/config.toml` (XDG_CONFIG_HOME) must be supported
- Known workspaces list management is part of global config

## Requirements

- Rust workspace with binary crate
- Parse `dev-hub.toml` workspace config identically to current core
- Parse global config (known workspaces, defaults)
- Project type enum: maven, gradle, npm, pnpm, cargo, custom
- Build/run command preset system
- Env file loading (.env merge with process env)
- Config hot-reload or at minimum re-read on demand

## Architecture

```
server/
├── Cargo.toml
├── src/
│   ├── main.rs              # Entry point, CLI args
│   ├── config/
│   │   ├── mod.rs
│   │   ├── schema.rs        # Workspace + project structs
│   │   ├── global.rs        # Global config, known workspaces
│   │   ├── parser.rs        # TOML read/write
│   │   ├── presets.rs        # Default build/run commands per project type
│   │   └── discovery.rs     # Walk up dirs to find config file
│   ├── error.rs             # Error types (thiserror)
│   └── lib.rs
```

## Related Code Files (current Node)

| File | Action | Notes |
|------|--------|-------|
| `packages/core/src/config/schema.ts` | Port to Rust | Zod → serde + validation |
| `packages/core/src/config/parser.ts` | Port to Rust | TOML read/write |
| `packages/core/src/config/global.ts` | Port to Rust | XDG config, known workspaces |
| `packages/core/src/config/presets.ts` | Port to Rust | Build/run command defaults |
| `packages/core/src/config/discovery.ts` | Port to Rust | Walk-up config finder |
| `packages/core/src/config/finder.ts` | Port to Rust | Config file location logic |

## Implementation Steps

1. `cargo init server-rs` at project root (or `packages/server-rs`)
2. Add dependencies: `toml`, `serde`, `serde_json`, `thiserror`, `dirs`, `dotenvy`, `clap`
3. Define `WorkspaceConfig`, `ProjectConfig`, `GlobalConfig` structs with serde derives
4. Implement `ProjectType` enum with preset command lookup
5. Port `findConfigFile()` — walk up from workspace dir, stop at home
6. Port TOML parser with snake_case field mapping
7. Port global config read/write (XDG_CONFIG_HOME path resolution)
8. Port known workspaces CRUD (add, remove, list)
9. Port env file loading (dotenvy for .env parsing, merge with std::env)
10. Port `getEffectiveCommand()` — user command > preset fallback
11. Unit tests for config parsing, discovery, presets

## Todo

- [x] Cargo project initialized with workspace structure
- [x] Config structs defined with serde derives
- [x] TOML parser reads existing dev-hub.toml correctly
- [x] Global config read/write works
- [x] Known workspaces CRUD
- [x] Env file loading + merge
- [x] Build/run preset system
- [x] Config discovery (walk-up)
- [x] Unit tests passing (22/22)

## Success Criteria

- `cargo test` passes
- Can parse the real dev-hub.toml from this repo
- Global config round-trips without data loss
- Preset commands match current Node implementation

## Risk Assessment

- **Schema drift**: Rust structs must exactly match current TOML format. Validate against real config files.
- **XDG paths**: `dirs` crate handles platform differences but verify on macOS vs Linux.

## Security Considerations

- Config files may contain env_file paths — validate they're within workspace boundary
- Don't leak env vars in error messages

## Next Steps

→ Phase 02: PTY session management builds on config (needs resolved commands + env)
