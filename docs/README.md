# DamHopper Documentation

Complete guide to the DamHopper workspace manager and IDE integration system.

## Getting Started

**New to DamHopper?** Start here:

1. **[Project Overview & PDR](./project-overview-pdr.md)** — Vision, requirements, architecture decisions
2. **[Configuration Guide](./configuration-guide.md)** — Set up dam-hopper.toml and workspace
3. **[System Architecture](./system-architecture.md)** — How the system works

## Reference Documentation

- **[API Reference](./api-reference.md)** — REST endpoints, WebSocket protocol, response formats
- **[Code Standards](./code-standards.md)** — Rust & TypeScript conventions, patterns, testing
- **[Codebase Summary](./codebase-summary.md)** — Module breakdown, key services, data flow

## Key Sections

### Understanding the System

| Document | Purpose |
|----------|---------|
| Project Overview & PDR | Product requirements, non-functional targets, roadmap |
| System Architecture | Module breakdown, data flow, concurrency model, error handling |
| Codebase Summary | Quick reference to architecture, services, patterns |

### Building & Configuring

| Document | Purpose |
|----------|---------|
| Configuration Guide | dam-hopper.toml syntax, env vars, feature flags, token generation |
| API Reference | All REST/WebSocket endpoints, authentication, examples |
| Code Standards | Coding patterns, testing, structure, security checklist |

## Core Concepts

### Features

**IDE File Explorer (Phase 01)** — Feature-gated file listing, reading, and metadata.

- Endpoints: GET /api/fs/list, /api/fs/read, /api/fs/stat
- Sandbox: Path validation prevents escape attempts


**Workspace Management** — TOML-based config, project discovery, hot-reload.
- Config: dam-hopper.toml at workspace root
- Support types: npm, pnpm, cargo, maven, gradle, custom
- See: [Configuration Guide](./configuration-guide.md)

**Terminal Sessions** — Isolated PTY per project, output streaming.
- API: /api/pty/spawn, /api/pty/{id}/send
- WebSocket: Real-time output + events
- See: [API Reference](./api-reference.md#terminals)

**Git Operations** — Clone, push, pull, status with progress.
- API: /api/git/{project}/clone, /push, /status
- SSH support: Load keys via /api/ssh/keys/load
- See: [API Reference](./api-reference.md#git-operations)

**Agent Store** — Distribute .claude/ items (skills, commands, hooks) via symlinks.
- API: /api/agent-store/distribution, /import, /ship
- Health checks for broken symlinks
- See: [System Architecture](./system-architecture.md#module-breakdown)

## Common Tasks

### Start the Server

```bash
cd server
cargo run -- --workspace /path/to/workspace --port 4800
```

See token at `~/.config/dam-hopper/server-token`.

### Configure a Workspace

1. Create `dam-hopper.toml` in workspace root:

```toml
[workspace]
name = "my-workspace"

[[projects]]
name = "backend"
path = "./api"
type = "cargo"
```

2. Start server with workspace path
3. Access at http://localhost:4800 (or 5173 for dev frontend)

### Use File Explorer API

```bash
TOKEN=$(cat ~/.config/dam-hopper/server-token)

# List directory
curl -H "Authorization: Bearer $TOKEN" \
  'http://localhost:4800/api/fs/list?project=backend&path=src'

# Read file
curl -H "Authorization: Bearer $TOKEN" \
  'http://localhost:4800/api/fs/read?project=backend&path=src/main.rs'

# Get metadata
curl -H "Authorization: Bearer $TOKEN" \
  'http://localhost:4800/api/fs/stat?project=backend&path=src'
```



### Run Tests

```bash
# Rust integration tests
cd server && cargo test

# Web build (no automated tests)
cd packages/web && pnpm build
```

## Architecture at a Glance

```
Browser (React SPA)
    ↓ fetch(/api/*) + WebSocket(/ws)
Rust Server (Axum)
    ├─ AppState (config, PTY manager, FS subsystem, auth)
    ├─ Router (routes REST/WebSocket)
    └─ Services (PtySessionManager, FsSubsystem, AgentStoreService)
```

Key patterns:
- Arc<Mutex<T>> for cheap-clone shared state
- Never hold locks across `.await`
- Feature gating at route registration time
- Error types per module (thiserror)

See [System Architecture](./system-architecture.md) for detailed breakdown.

## File Structure

```
docs/
├── README.md                     # This file
├── project-overview-pdr.md       # Product requirements & roadmap
├── system-architecture.md        # Module breakdown & data flow
├── api-reference.md              # REST/WebSocket endpoints
├── configuration-guide.md        # dam-hopper.toml & setup
├── code-standards.md             # Patterns, testing, security
└── codebase-summary.md           # Quick module reference
```

Each file is self-contained but linked for cross-reference.

## Maintenance

Docs are updated when:
- New API endpoints are added (update api-reference.md)
- Architecture changes (update system-architecture.md + code-standards.md)
- Config schema changes (update configuration-guide.md)
- New phases complete (update project-overview-pdr.md roadmap)

Always verify docs against actual code implementation before publishing.

## Quick Links

- **GitHub:** https://github.com/loidinhm31/dam-hopper
- **Config File:** dam-hopper.toml
- **Token Location:** ~/.config/dam-hopper/server-token
- **Agent Store:** .dam-hopper/agent-store/
- **Global Config:** ~/.config/dam-hopper/config.toml

## Questions or Issues?

- Check relevant doc (use Ctrl+F for keywords)
- Review code comments (// or /// in Rust/TypeScript)
- Run tests: `cd server && cargo test`
- Check logs: `RUST_LOG=dam_hopper=debug cargo run ...`
