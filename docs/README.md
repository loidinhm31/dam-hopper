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
- **[Workflow API](./workflow-api.md)** — Phase 02–03 workflow REST, lifecycle correlation, CAS/replay, and retention
- **[Workflow Client State](./workflow-client-state.md)** — Phase 04 shared UI DTOs, transport mapping, and React Query isolation
- **[Code Standards](./code-standards.md)** — Rust & TypeScript conventions, patterns, testing
- **[Codebase Summary](./codebase-summary.md)** — Module breakdown, key services, data flow
- **[Linux Release Publisher and Bootstrap](./linux-release-publisher-bootstrap.md)** — Central GitHub publisher DAG, four assets, reproducible archive, SBOM, gates, and bootstrap usage
- **[Linux Release Manager](./linux-release-manager.md)** — Phase 02 CLI,
  host checks, acquisition, safe staging, Phase 05–06 publisher/bootstrap,
  durable activation/recovery, and Phase 07 format-2 migration/runner retirement
- **[WebSocket Protocol Guide](./ws-protocol-guide.md)** — Message format and lifecycle events
- **[Project Roadmap](./project-roadmap.md)** — Current status and explicitly historical/deferred work
- **[Changelog](./CHANGELOG.md)** — Dated feature, persistence, and release notes

## Deployment

- **[Configuration Guide](./configuration-guide.md)** — TOML, environment variables, CORS, and extension origins
- **[Linux systemd](./linux-systemd.md)** — API/web units, Phase 07 format-2
  migration and runner retirement, boot recovery ordering, durable activation,
  health gates, and rollback
- **[Linux nohup](./linux-nohup.md)** — unsupported legacy/recovery server on
  loopback port 4800; not a systemd production owner
- **[Linux Release Manifest v1](./linux-release-manifest.md)** — immutable
  Fedora 44 archive metadata, inventory, role projections, and format-2 boundary
- **[Linux Release Publisher and Bootstrap](./linux-release-publisher-bootstrap.md)** — Build, attest, gate, publish, and bootstrap the stable Fedora release
- **[Linux Release Manager](./linux-release-manager.md)** — Rust manager commands, role selection, pending candidates, publisher/bootstrap handoff, durable activation, rollback, boot recovery, and format-2 migration

The dedicated `dam-hopper-web` host serves release SPA assets on port 4802.
It is separate from the API process and exposes only static GET/HEAD plus the
reserved health/runtime-config routes. The API is API-only by default; Docker
explicitly opts into combined serving with `--web-dir /opt/dam-hopper/web` on
port 4800.

### Durable activation, rollback, and recovery (Phase 05)

`install` and `role set` stage a candidate but stop at `PENDING`. Run
`sudo dam-hopper start` to activate it, or to start and verify the committed
role when no candidate is pending. The durable forward state machine is:

`ABSENT | ACTIVE → STAGED → PENDING → QUIESCED → SWITCHED → PROBING → COMMITTED`

Activation is lock-scoped and health-gated. Selected units must become ready
within 20 seconds, then pass 20 consecutive probes at 500 ms (a 10-second
stability window) with exact process identity, executable, listener, and
role/version JSON health checks. `dam-hopper-recovery.service` runs
`dam-hopper recover --boot` before the API and web units at boot. Failed
activation restores the previous concrete units/configuration; first-install
failure leaves application units stopped/disabled with no active release.
`sudo dam-hopper rollback` promotes the recorded previous release through the
same transaction rules. Recovery blocks unsafe or unrecoverable state.

### Format-2 migration and runner retirement (Phase 07)

The manager verifies the legacy format-2 root read-only, stages a sibling
`/opt/.dam-hopper-migration.<tx_id>`, and uses same-device
`renameat2(RENAME_EXCHANGE)` cutover with rollback restoration. Format 1 and
unknown layouts fail closed. The old checkout runner scripts, fixed unit,
fixture, and package aliases are retired; the exact invariant and evidence
boundary are in [Linux systemd](./linux-systemd.md).

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

**Workflow Tracking Service, REST API, and Client State (Phases 01–04)** — The
server-side workflow domain/API is documented separately from the shared UI
adapter. The Phase 04 client layer adds strict DTOs, domain helpers, typed
transport channels, profile-safe React Query state, and mutation wrappers.

- Server contract: bounded workspace/project summaries, Plan/Phase/Task trees,
  running sessions, notes, factual Task progress, recent events, CAS/replay,
  and terminal/agent link lifecycle
- Shared UI contract: closed workflow unions/interfaces, Plan-first helper
  predicates, explicit manual timestamp handling, and deterministic ordering
- Transport: `api.workflow` delegates named operations through the active
  transport; `WsTransport` maps 13 workflow channels to protected REST paths
  and URL-encodes cursors and resource IDs
- Query state: profile-scoped key hashing plus transport-generation overview
  keys prevent stale server data from crossing profile/transport boundaries
- Mutation policy: one caller-owned request UUID, no optimistic snapshot
  writes, root `['workflow']` invalidation only after success, typed errors on
  failure
- Ownership: React Query stores server state; workflow presentation state
  remains component-local and is not written to localStorage or URL search
  params
- See [Workflow API](./workflow-api.md) and [Workflow Client State](./workflow-client-state.md),
  [System Architecture](./system-architecture.md#workflow-client-types-transport-and-query-state-phase-04),
  [Project Overview & PDR](./project-overview-pdr.md#pr-014-workflow-client-types-transport-and-query-state-phase-04),
  [Codebase Summary](./codebase-summary.md#workflow-client-types-transport-and-query-state-phase-04),
  and [Code Standards](./code-standards.md#workflow-client-contracts-phase-04).


**Dedicated Web Host (Phase 03)** — Release deployments can run `dam-hopper-web`
as a non-writing static host on `4802`.

- Health: `GET`/`HEAD /__dam-hopper/health` returns `schemaVersion`, `status`,
  release `version`, and `role: "web"` with `Cache-Control: no-store`.
- Runtime origin: `GET`/`HEAD /__dam-hopper/runtime-config.json` returns a
  bounded `{schemaVersion, releaseVersion, profileId [, apiUrl]}` document, also
  `no-store` (with `apiUrl` omitted when unset); a missing document is a normal 404 for development/Pages.
- Static policy: only GET/HEAD, safe regular files, MIME detection, SPA fallback
  for extensionless HTML navigation, one-year immutable hashed assets,
  `index.html` `no-cache`, and other assets one-hour cache.
- The web host never proxies or serves API paths. Standard API startup is API-only;
  Docker passes `--web-dir /opt/dam-hopper/web` explicitly for its combined mode.

## Common Tasks

1. Find the component in `packages/ui/src/components/` (the browser host is `apps/web`)

```bash
cd server
# API-only default
cargo run -- --config /path/to/dam-hopper.toml --port 4800
# Dedicated release web host
cargo run --bin dam-hopper-web -- --root /path/to/web-dist --port 4802
```

See token at `~/.config/dam-hopper/server-token`.

### Understand a Component

1. Find the component in `packages/ui/src/components/` (the browser host is `apps/web`)
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

See [Frontend Components](./frontend-components.md#session-status-helpers) for detailed flow.

## Recent Changes

**Linux Release Installer Phase 05 (Complete ✓):**

- ✓ Durable generation-numbered activation state and lock-scoped transition
  graph from `ABSENT`/`ACTIVE` through `STAGED`, `PENDING`, `QUIESCED`,
  `SWITCHED`, `PROBING`, and `COMMITTED`.
- ✓ Recovery unit ordering before API/web startup, exact 20-second readiness
  plus 10-second health stability probing, and automatic/manual rollback.

**Linux Release Installer Phase 03 (Complete ✓):**

- ✓ Added `dam-hopper-web`, a read-only static host on `0.0.0.0:4802`.
- ✓ Reserved no-store health and runtime-origin JSON routes.
- ✓ Added safe path resolution, HTML-only SPA fallback, streamed files, and
  hashed/unhashed/index cache policies.
- ✓ Made API startup API-only by default; Docker explicitly uses
  `--web-dir /opt/dam-hopper/web` for combined port-4800 serving.
- ✓ Web bootstrap validates runtime origin and reconciles one managed profile
  without overriding a saved user profile or retaining a stale token.

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
## Architecture at a Glance

```

Browser (React SPA, served separately in release mode)
├─ fetch(/api/\*) + WebSocket(/ws) → API server :4801
└─ GET /\_\_dam-hopper/runtime-config.json → web host :4802
Rust API Server (Axum; API-only by default)
├─ AppState (config, PTY manager, FS subsystem, auth)
├─ Router (REST/WebSocket; explicit --web-dir only for combined mode)
├─ Services (WorkflowService, PtySessionManager, FsSubsystem, AgentStoreService)
├─ Workflow observer (non-blocking `sync_channel(256)` → SQLite worker)
└─ Persistence (SessionStore + WorkflowStore over SQLite)
Dedicated Web Host (dam-hopper-web; static, non-writing)
├─ Reserved health/runtime routes
├─ Safe file + HTML fallback routing
└─ Cache policy by response kind

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
- Release web host is static-only; runtime API origin comes from validated config

See [System Architecture](./system-architecture.md) for detailed breakdown.

## File Structure

```

server/
├── src/
│   ├── bin/dam-hopper-web.rs     # Dedicated release static host
│   ├── web_host/                 # Safe routes, paths, cache, runtime config
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
├── configuration-guide.md        # dam-hopper.toml & deployment modes
├── code-standards.md             # Patterns, testing, security
├── codebase-summary.md           # Quick module reference
├── linux-release-manifest.md     # Linux release archive contract v1
└── linux-release-manager.md      # Release manager CLI and staging
└── CHANGELOG.md                  # Dated implementation and release notes
```

Each file is self-contained but linked for cross-reference.


Phase 01 of the Tauri shared-UI split is complete: the browser entrypoint now lives in
`apps/web`, and the reusable UI surface lives in `packages/ui`. Linux Release
Installer Phases 01–07 are complete and reviewed; Phase 07's one-time format-2
migration and checkout-runner retirement are documented in the deployment guides.

## Maintenance

Docs are updated when:

- New API endpoints are added (update api-reference.md)
- Architecture changes (update system-architecture.md + code-standards.md)
- Config schema changes (update configuration-guide.md)
- New phases complete (update project-overview-pdr.md roadmap)
- Release packaging contracts change (update `linux-release-manifest.md`,
  `linux-release-manager.md`, and `system-architecture.md`)

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
```
