# DamHopper Documentation

Complete guide to the DamHopper workspace manager and IDE integration system.

## Getting Started

**New to DamHopper?** Start here:

1. **[Project Overview & PDR](./project-overview-pdr.md)** — Vision, requirements, architecture decisions
2. **[Configuration Guide](./configuration-guide.md)** — Set up dam-hopper.toml and workspace
3. **[System Architecture](./system-architecture.md)** — How the system works

## Feature Guides

- **[Multi-Server Profiles User Guide](./user-guide-multi-server-profiles.md)** — Manage and switch between multiple server connections
- **[Frontend Components](./frontend-components.md)** — React component architecture, lifecycle UI (Phase 06+)

## Reference Documentation

- **[API Reference](./api-reference.md)** — REST endpoints, WebSocket protocol, response formats
- **[Code Standards](./code-standards.md)** — Rust & TypeScript conventions, patterns, testing
- **[Codebase Summary](./codebase-summary.md)** — Module breakdown, key services, data flow
- **[WebSocket Protocol Guide](./ws-protocol-guide.md)** — Message format, events, Phase 5+ enhancements

## Implementation Plans

- **[Terminal Enhancement Phase 06](../plans/20260415-terminal-enhancement/phase-06-frontend-lifecycle-ui.md)** — Status dots, restart badges, lifecycle banners (COMPLETE ✓)
- **[Terminal Enhancement Test Plan](../plans/20260415-terminal-enhancement/phase-06-test-plan.md)** — Manual testing procedures

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

### Frontend Development

| Document | Purpose |
|----------|---------|
| Frontend Components | React component architecture, lifecycle management, event handling |
| WebSocket Protocol Guide | Real-time message formats, Phase 5+ events (exit, restart, reconnect) |

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
- **Phase 04:** Auto-restart with exponential backoff, policy-driven (never/on-failure/always)
- **Phase 05:** Enhanced exit events with restart metadata, separate FS/PTY channels
- **Phase 06:** Lifecycle UI with status dots, restart badges, exit/restart/reconnect banners
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

### Understand a Component

1. Find component in `packages/web/src/components/`
2. Check [Frontend Components](./frontend-components.md) for architecture overview
3. Review event subscriptions via [WebSocket Protocol Guide](./ws-protocol-guide.md)
4. Trace type definitions in `packages/web/src/api/client.ts`

### Debug Session Lifecycle

Terminal lifecycle follows six main states:
- **alive** — Process running (🟢 green dot)
- **restarting** — Exited, will restart after backoff (🟡 yellow dot)
- **crashed** — Exited non-zero, no restart (🔴 red dot)
- **exited** — Exited zero, no restart (⚪ gray dot)

See [Frontend Components](./frontend-components.md#data-flow-terminal-lifecycle) for detailed flow.

## Recent Changes

**Phase 06 (Complete ✓):**
- ✓ Added session lifecycle status helpers (`session-status.ts`)
- ✓ Implemented status dots in TerminalTreeView (color-coded by state)
- ✓ Added restart badge in DashboardPage (shows count when > 0)
- ✓ Implemented exit/restart/reconnect banners in TerminalPanel (ANSI-colored)
- ✓ Wired WebSocket event handlers for lifecycle events
- ✓ Added query invalidation on process restart

**Phase 05 (Complete ✓):**
- ✓ Backend: Enhanced `terminal:exit` with willRestart/restartInMs/restartCount
- ✓ Backend: New `process:restarted` event
- ✓ Backend: Separated PTY and FS channels to prevent FS overflow from killing connection
- ✓ Frontend: Transport listeners for new events

**Phase 04 (Complete ✓):**
- ✓ Auto-restart engine with exponential backoff
- ✓ Configurable restart policy per terminal (never/on-failure/always)
- ✓ Restart count tracking
- ✓ Supervisor pattern for safe async restarts

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
