# Phase 04: Agent Store + Commands

## Context
- Parent: [plan.md](./plan.md)
- Depends on: [Phase 01](./phase-01-rust-scaffold-config.md)

## Overview
- **Priority**: P2
- **Status**: Pending
- **Effort**: 10h

Port agent store (scan, ship/unship/absorb, memory templates, import) and command registry.

## Key Insights

- Agent store is FS-heavy: scanning `.claude/`, `.gemini/` directories, symlinking files, managing templates
- Ship = symlink/copy from store to project's `.claude/` dir
- Absorb = reverse: copy from project back to store
- Memory templates use Handlebars templating
- Import from repo: shallow git clone → scan → selective import
- Command registry: tokenized search index over predefined command definitions

## Requirements

### Agent Store
- Scan workspace projects for `.claude/`, `.gemini/` directories
- Scan store inventory (`.dev-hub/agent-store/`)
- Ship items to projects (symlink preferred, copy fallback)
- Unship items from projects (remove symlinks/copies)
- Absorb items from projects into store
- Bulk ship to multiple projects
- Distribution matrix (which projects have which items)
- Health check (detect broken symlinks)

### Memory Templates
- List available templates (`.dev-hub/agent-store/memory-templates/`)
- Read/update memory files per project per agent
- Apply template with Handlebars rendering

### Import
- Scan remote repo (shallow clone) for agent configs
- Scan local directory for agent configs
- Confirm import (copy selected items to store)

### Commands
- CommandRegistry with predefined commands per project type
- Tokenized search (fuzzy matching)

## Architecture

```
src/agent_store/
├── mod.rs
├── scanner.rs          # Scan projects and store inventory
├── distributor.rs      # Ship/unship/absorb/bulk
├── memory.rs           # Memory templates (handlebars)
├── importer.rs         # Git clone + scan for import
├── health.rs           # Broken symlink detection
└── schema.rs           # Item types, categories

src/commands/
├── mod.rs
├── registry.rs         # Command definitions + search
└── presets.rs          # Built-in commands per project type
```

## Related Code Files (current Node)

| File | Action | Notes |
|------|--------|-------|
| `packages/core/src/agent-store/scanner.ts` | Port | Directory scanning |
| `packages/core/src/agent-store/distributor.ts` | Port | Ship/unship/absorb |
| `packages/core/src/agent-store/memory.ts` | Port | Handlebars templates |
| `packages/core/src/agent-store/importer.ts` | Port | Git clone + scan |
| `packages/core/src/agent-store/store.ts` | Port | Store inventory |
| `packages/core/src/agent-store/schema.ts` | Port | Type definitions |
| `packages/core/src/commands/` | Port | Registry + search |

## Implementation Steps

1. Define agent store types: `StoreItem`, `Category`, `ShipOptions`, `DistributionMatrix`
2. Scanner: walk `.claude/` and `.gemini/` dirs, parse item metadata (frontmatter)
3. Distributor: symlink creation (`std::os::unix::fs::symlink`), copy fallback
4. Health check: `fs::read_link()` + `Path::exists()` to detect broken symlinks
5. Distribution matrix: cross-reference store inventory with project scans
6. Bulk ship: iterate projects with configurable concurrency
7. Memory module: `handlebars` crate for template rendering
8. Importer: `tokio::process::Command` for `git clone --depth 1`, then scan cloned dir
9. Command registry: in-memory HashMap with tokenized search (split on spaces, prefix match)
10. Tests for each module

## Todo

- [ ] Agent store type definitions
- [ ] Scanner (project + store)
- [ ] Distributor (ship/unship/absorb)
- [ ] Bulk ship
- [ ] Distribution matrix
- [ ] Health check
- [ ] Memory templates
- [ ] Import from repo
- [ ] Import from local dir
- [ ] Command registry + search
- [ ] Tests

## Success Criteria

- Ship creates working symlinks, unship removes them cleanly
- Health check detects all broken symlinks in test fixture
- Memory templates render correctly with Handlebars
- Import clones, scans, and imports selected items
- Command search returns relevant results

## Risk Assessment

- **Symlink on Windows**: `std::os::unix::fs::symlink` is Unix-only. Windows needs `std::os::windows::fs::symlink_file`. Use conditional compilation.
- **Handlebars compatibility**: Verify Rust `handlebars` crate supports `{{eq}}` helper or implement custom helper.
- **Git clone for import**: Subprocess, need timeout + cleanup of temp dirs on failure.

## Security Considerations

- Import URL validation: prevent command injection in git clone args
- Symlink traversal: ensure symlinks don't escape workspace boundary
- Template injection: Handlebars auto-escapes by default, but verify

## Next Steps

→ Phase 05: REST API + WebSocket (assembles all services into HTTP layer)
