# Phase 04 Completion Report: Agent Store + Commands

**Date**: 2026-04-06 | **Plan**: [260405-1644-rust-server-refactor](../260405-1644-rust-server-refactor/plan.md)

## Summary

Ported agent store (scan, ship/unship/absorb, memory templates, import) and command registry from Node.js to Rust. Full feature parity with the TypeScript implementation plus hardened security and error handling from a code review cycle.

## Files Created

| File | Purpose |
|------|---------|
| `server/src/agent_store/schema.rs` | Core types: `AgentType`, `AgentItemCategory`, `DistributionMethod`, `AgentPathConfig`, `CLAUDE_PATHS`, `GEMINI_PATHS`, `AgentStoreItem`, `ShipResult`, `HealthCheckResult`, `ProjectAgentScanResult`, `DistributionStatus` |
| `server/src/agent_store/scanner.rs` | `scan_project`, `scan_all_projects`, `check_symlink` — async FS walk for `.claude/`/`.gemini/` |
| `server/src/agent_store/store.rs` | `AgentStoreService`: init, list, add, remove, get, get_content + `parse_frontmatter` (YAML via serde_yaml_ng) |
| `server/src/agent_store/distributor.rs` | `ship`, `unship`, `absorb`, `bulk_ship`, `get_distribution_matrix`, `health_check`, `ship_mcp_server`, `unship_mcp_server` |
| `server/src/agent_store/memory.rs` | Handlebars template rendering (custom `eq` helper), `list_memory_templates`, `get/update_memory_file`, `apply_template` |
| `server/src/agent_store/importer.rs` | `scan_repo` (shallow git clone + scan), `scan_local_dir`, `import_from_repo`, `cleanup_import` |
| `server/src/agent_store/mod.rs` | Module root + re-exports |
| `server/src/agent_store/tests.rs` | 15 integration tests |
| `server/src/commands/presets.rs` | `CommandDatabase`/`CommandDefinition` types + embedded JSON for maven/gradle/npm/pnpm/cargo via `include_str!` |
| `server/src/commands/registry.rs` | `CommandRegistry` with BM25 index (K1=1.2, B=0.75), `search`, `search_by_type`, `get_commands` |
| `server/src/commands/mod.rs` | Module root + re-exports |
| `server/src/commands/tests.rs` | 8 unit tests |

## Files Modified

| File | Change |
|------|--------|
| `server/Cargo.toml` | Added `handlebars = "6"`, `regex = "1"`, `serde_yaml_ng = "0.9"` |
| `server/src/error.rs` | Added `pub type Result<T>`, `impl From<serde_json::Error>` |
| `server/src/lib.rs` | Added `pub mod agent_store`, `pub mod commands` |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| `handlebars` crate v6 with custom `eq` helper | `handlebars_helper!` macro can't use path types — import `Value` directly |
| `serde_yaml_ng` for frontmatter | Maintained fork of `serde_yaml`; only used for simple k/v frontmatter parsing |
| `include_str!` for command JSON | Embeds JSON at compile time from `packages/core/src/commands/definitions/`; no runtime file I/O |
| `#[cfg(unix)]` / `#[cfg(windows)]` symlink | Conditional compilation: `std::os::unix::fs::symlink` vs `symlink_file`/`symlink_dir` |
| BM25 K1=1.2, B=0.75 | Direct port from TS; standard BM25 defaults |
| `tokio::time::timeout(60s)` for git clone | Prevents hung subprocess blocking async executor indefinitely |
| Component-level `..` check before `canonicalize` | Belt-and-suspenders against path traversal: literal `..` rejected before filesystem resolution |
| MCP fragment schema validation | Ensures fragment is non-empty map of objects; rejects malformed fragments before merge |

## Code Review Fixes Applied

- `absorb()`: cleans up partial store copy on copy failure
- `health_check()`: TOCTOU documented as acceptable for monitoring-only use
- `remove()`: validates item exists in correct category before deletion
- `importer`: added component-level `..` guard + `canonicalize` traversal check
- `add()`: returns `AppError::InvalidInput` instead of `"unknown"` fallback
- `pathdiff` None: handled with `warn!` + absolute fallback
- `check_existing_target`: dual-path canonical comparison with lexical fallback
- `unship` force-remove: documented non-atomic behavior; added logging
- `list_category`: explicit `.md` > directory priority for non-Skill categories
- `ship_mcp_server`: validates fragment structure before merge
- Logging: `debug!`/`warn!` on all ship/unship/absorb decision paths
- `content_differs`: docstring clarifying shallow-diff semantics

## Tests: 90/90 Passing

- 22 config tests (existing)
- 19 PTY tests (existing)
- 26 git tests (existing)
- 15 agent_store tests (new): store init/add/remove, scanner with/without agents, ship/unship via symlink, health check broken symlink, memory template render + eq helper, memory template list, import no-overwrite, scan local dir
- 8 command registry tests (new): loads all 5 DBs, get by type, search results, filter by type, empty query, ordering, limit, unknown type

## Next Step

→ Phase 05: REST API + WebSocket (assembles all services into HTTP layer)

## Unresolved Questions

None.
