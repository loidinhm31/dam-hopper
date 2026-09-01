# DamHopper Documentation

Complete guide to the DamHopper workspace manager and IDE integration system.

## Getting Started

**New to DamHopper?** Start here:

1. **[Project Overview & PDR](./project-overview-pdr.md)** — Vision, requirements, architecture decisions
2. **[Configuration Guide](./configuration-guide.md)** — Set up the global `dam-hopper.toml` project registry
3. **[System Architecture](./system-architecture.md)** — How the system works, including workflow persistence

## Feature Guides

- **[Multi-Server Profiles User Guide](./user-guide-multi-server-profiles.md)** — Manage profile-scoped server connections and storage
- **[Frontend Components](./frontend-components.md)** — Shared React component architecture and host lifecycle
- **[Native Browser Debug Support](./native-browser-debug-support.md)** — Windows v1 gate, Linux qualification, fallback and security boundaries
- **[Worktree Operations](./worktree-operation.md)** — Target selection and safe worktree lifecycle

## Reference Documentation

- **[API Reference](./api-reference.md)** — REST endpoints, WebSocket protocol, response formats
- **[Workflow API](./workflow-api.md)** — Phase 03 workflow REST, lifecycle correlation, CAS/replay, and retention
- **[Code Standards](./code-standards.md)** — Rust & TypeScript conventions, patterns, testing
- **[Codebase Summary](./codebase-summary.md)** — Module breakdown, key services, data flow
- **[WebSocket Protocol Guide](./ws-protocol-guide.md)** — Message format and lifecycle events
- **[Project Roadmap](./project-roadmap.md)** — Current status and explicitly historical/deferred work
- **[Changelog](./CHANGELOG.md)** — Dated feature, persistence, and release notes

## Deployment

- **[Configuration Guide](./configuration-guide.md)** — TOML, environment variables, CORS, and extension origins
- **[Linux systemd](./linux-systemd.md)** — Current backend-only production service on port 4801
- **[Linux nohup](./linux-nohup.md)** — Legacy/recovery server on loopback port 4800
- Docker serves the built SPA and backend on port 4800; it is separate from systemd and nohup ownership.

Historical implementation plans are not indexed here; verify that a plan path
exists before linking it from a new document.


## Key Sections

### Understanding the System

| Document               | Purpose                                                        |
| ---------------------- | -------------------------------------------------------------- |
| Project Overview & PDR | Product requirements, non-functional targets, roadmap          |
| System Architecture    | Module breakdown, data flow, concurrency model, error handling |
| Codebase Summary       | Quick reference to architecture, services, patterns            |

### Building & Configuring

| Document            | Purpose                                                           |
| ------------------- | ----------------------------------------------------------------- |
| Configuration Guide | dam-hopper.toml syntax, env vars, feature flags, token generation |
| API Reference       | All REST/WebSocket endpoints, authentication, examples            |
| Code Standards      | Coding patterns, testing, structure, security checklist           |

### Frontend Development

| Document                 | Purpose                                                               |
| ------------------------ | --------------------------------------------------------------------- |
| Frontend Components      | React component architecture, lifecycle management, event handling    |
| WebSocket Protocol Guide | Real-time message formats, Phase 5+ events (exit, restart, reconnect) |

## Core Concepts

### Features

**IDE File Explorer (Phase 01)** — Feature-gated file listing, reading, and metadata.

- Endpoints: GET /api/fs/list, /api/fs/read, /api/fs/stat
- Sandbox: Path validation prevents escape attempts
- Frontend: shared file decoration registry powers icon, badge, display-language, and Monaco-language lookup

**Project Registry Management** — TOML-based registry, project discovery, hot-reload.

- Config: `~/.config/dam-hopper/dam-hopper.toml` by default, or any file passed via `--config`
- Support types: npm, pnpm, cargo, maven, gradle, custom
- See: [Configuration Guide](./configuration-guide.md)

**Terminal Sessions** — Isolated PTY per project, output streaming.

- API: /api/pty/spawn, /api/pty/{id}/send
- WebSocket: Real-time output + events
- **Phase 04:** Auto-restart with exponential backoff, policy-driven (never/on-failure/always)
- **Phase 05:** Enhanced exit events with restart metadata, separate FS/PTY channels
- **Phase 06:** Lifecycle UI with status dots, restart badges, exit/restart/reconnect banners
- See: [API Reference](./api-reference.md#terminals)

**Git Operations** — Clone, push, pull, status, branch actions, history edits.

- API: /api/git/{project}/clone, /push, /status, /branches, /branches/checkout, /cherry-pick, /reset
- SSH support: Load keys via /api/ssh/keys/load
- See: [API Reference](./api-reference.md#git-operations)

**Agent Store** — Distribute .claude/ items (skills, commands, hooks) via symlinks.

- API: /api/agent-store/distribution, /import, /ship
- Health checks for broken symlinks
- See: [System Architecture](./system-architecture.md#module-breakdown)

**Workflow Tracking Service and REST API (Phase 03)** — Protected REST
boundary over the Phase 01–02 SQLite workflow domain and Phase 03's
server-internal terminal lifecycle observer.

- Overview: bounded workspace/project summaries, Plan/Phase/Task trees,
  running sessions, notes, factual Task progress, and recent events
- Mutations: item CRUD with Plan-first validation, CAS, and request replay;
  manual session lifecycle; target-validated terminal/agent links; note CAS
  and soft deletion
- Lifecycle: bounded `sync_channel(256)` observation worker maps
  incarnation-ordered terminal facts to `attached`, `stale`, `exited`,
  `crashed`, and `detached` link states
- Privacy/authority: no command line, arguments, CWD, env, prompt, output, or
  arbitrary adapter payload; observations never change manual session status
  or `startedAt`/`endedAt`
- Agent adapter: bounded manual `harnessLabel`/`runId` only; no automatic
  harness producer or generic observation endpoint
- Startup: restore PTYs first, then reconcile links against live identities;
  direct Plan sessions need no synthetic Phase/Task children
- History: opaque keyset event pagination and explicit/bounded retention purge
- See [Workflow API](./workflow-api.md), [System Architecture](./system-architecture.md#workflow-phases-01-03-service-rest-and-lifecycle-correlation),
  [Project Overview & PDR](./project-overview-pdr.md#pr-013-terminal-lifecycle-correlation-and-agent-adapter),
  and [Codebase Summary](./codebase-summary.md#workflow-tracking-service-rest-api-and-lifecycle-correlation-phases-01-03).
- See [Code Standards](./code-standards.md#workflow-domain-service-rest-api-and-lifecycle-correlation-phases-01-03) for implementation conventions.


## Common Tasks

1. Find the component in `packages/ui/src/components/` (the browser host is `apps/web`)

```bash
cd server
cargo run -- --config /path/to/dam-hopper.toml --port 4800
```

See token at `~/.config/dam-hopper/server-token`.

### Understand a Component

1. Find component in `packages/web/src/components/`
2. Check [Frontend Components](./frontend-components.md) for architecture overview
3. Review event subscriptions via [WebSocket Protocol Guide](./ws-protocol-guide.md)
4. Trace shared UI types in `packages/ui/src/api/client.ts`

### Debug Session Lifecycle

The terminal UI lifecycle follows process states:

- **alive** — Process running (green dot)
- **restarting** — Exited, will restart after backoff (yellow dot)
- **crashed** — Exited non-zero, no restart (red dot)
- **exited** — Exited zero, no restart (gray dot)

Workflow resource links expose a separate observed state machine:
`attached → stale` while restart is pending, then `attached` for a new
incarnation or `exited`/`crashed` after final exit; explicit removal and
missing startup identities detach links that were still `attached` or `stale`.
See [Workflow API](./workflow-api.md#resource-links).

See [Frontend Components](./frontend-components.md#data-flow-terminal-lifecycle) for the UI flow.

## Recent Changes

**Phase 03 Terminal Lifecycle Correlation and Agent Adapter (Complete ✓ 2026-09-02):**

- ✓ Added the closed terminal-only `WorkflowObservation` contract and
  clone-cheap PTY recorder with bounded `sync_channel(256)` worker
- ✓ Kept workflow SQLite off PTY input/output/restart hot paths; full queues and
  storage failures degrade observations without blocking terminal operation
- ✓ Added incarnation ordering and deterministic replay suppression for
  `attached`, `stale`, `exited`, `crashed`, and `detached` link states
- ✓ Preserved manual session status and timestamps; final exit/removal only
  suggest an end time
- ✓ Added post-restore link reconciliation, manual bounded harness/run links,
  direct Plan-session support, and lifecycle/fault-isolation tests

**Phase 02 Workflow Service and REST API (Complete ✓ 2026-09-02):**

- ✓ Added `WorkflowService` current-workspace/target boundary and shared-store
  `spawn_blocking` orchestration
- ✓ Mounted protected `/api/workflow/*` endpoints for overview, event history,
  item CRUD, session lifecycle/links, notes, and history purge
- ✓ Added request-id replay, item/note/link CAS, strict DTO validation, typed
  workflow errors, bounded overview/keyset history, and automatic retention
- ✓ Added `server/tests/workflow_api.rs` integration coverage

**Phase 01 Workflow Tracking Foundation (Complete ✓):**

- ✓ Added additive migration 010 for six workflow tables sharing `sessions.db`
- ✓ Added Plan/Phase/Task models, status/source/resource/event enums, and
  bounded validation
- ✓ Added transactional `WorkflowStore` methods for hierarchy, sessions,
  links, notes, events, overview aggregation, and retention

**Phase 06 (Complete ✓):**

- ✓ Added session lifecycle status helpers (`session-status.ts`)
- ✓ Implemented status dots in TerminalTreeView (color-coded by state)
- ✓ Added restart badge in DashboardPage (shows count when > 0)
- ✓ Implemented exit/restart/reconnect banners in TerminalPanel (ANSI-colored)
- ✓ Wired WebSocket event handlers for lifecycle events
- ✓ Added query invalidation on process restart

**Phase 04 (Complete ✓):**

- ✓ Added Settings > Maintenance > Export Diagnostics
- ✓ Export bundles include canonical frontend snapshot data and capped terminal tails
- ✓ Downloads use `dam-hopper-diagnostics-{timestamp}.json`
- ✓ Docs and API reference updated with review-before-sharing privacy note

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

1. Create `~/.config/dam-hopper/dam-hopper.toml` (or another registry file you will pass with `--config`):

```toml
[workspace]
name = "my-workspace"

[[projects]]
name = "backend"
path = "./api"
type = "cargo"
```

2. Start the server with `--config /path/to/dam-hopper.toml` or rely on the default global registry path
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

# Web build (thin browser host)
pnpm --filter @dam-hopper/web build
```

## Architecture at a Glance

```
Browser (React SPA)
    ↓ fetch(/api/*) + WebSocket(/ws)
Rust Server (Axum)
    ├─ AppState (config, PTY manager, FS subsystem, auth)
    ├─ Router (routes REST/WebSocket)
    ├─ Services (WorkflowService, PtySessionManager, FsSubsystem, AgentStoreService)
    ├─ Workflow observer (non-blocking `sync_channel(256)` → SQLite worker)
    └─ Persistence (SessionStore + WorkflowStore over SQLite)
```

Key patterns:

- Arc<Mutex<T>> for cheap-clone shared state
- Never hold locks across `.await`
- Feature gating at route registration time
- Workflow mutations use SQLite transactions; optional audit events commit with
  their entity mutation.
- PTY observations use bounded `try_send`; observer/storage failures never block
  terminal I/O or restart handling.
- Workflow observations exclude command, CWD, env, prompt, and output data.
- Error types per module (thiserror)

See [System Architecture](./system-architecture.md) for detailed breakdown.

## File Structure

server/
├── src/
│   ├── persistence/              # SQLite session store and migrations
│   └── workflow/                 # Domain, REST, observation, reconciliation
apps/
├── web/                          # Thin Vite browser host
packages/
├── ui/                           # Shared React UI package
docs/
├── README.md                     # This file
├── project-overview-pdr.md       # Product requirements & roadmap
├── system-architecture.md        # Module breakdown & data flow
├── api-reference.md              # REST/WebSocket endpoints
├── workflow-api.md               # Phase 03 workflow REST/lifecycle contract
├── configuration-guide.md        # dam-hopper.toml & setup
├── code-standards.md             # Patterns, testing, security
├── codebase-summary.md           # Quick module reference
└── CHANGELOG.md                  # Dated implementation and release notes
```

Each file is self-contained but linked for cross-reference.

Phase 01 of the Tauri shared-UI split is complete: the browser entrypoint now lives in `apps/web`, and the reusable UI surface lives in `packages/ui`.

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
