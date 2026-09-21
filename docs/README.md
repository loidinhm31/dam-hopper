# DamHopper Documentation

Complete guide to the DamHopper workspace manager and IDE integration system.

## Getting Started

**New to DamHopper?** Start here:

1. **[Project Overview & PDR](./project-overview-pdr.md)** — Vision, requirements, architecture decisions
2. **[Configuration Guide](./configuration-guide.md)** — Set up the global `dam-hopper.toml` project registry
3. **[System Architecture](./system-architecture.md)** — How the system works, including workflow persistence

## Feature Guides

- **[Multi-Server Profiles User Guide](./user-guide-multi-server-profiles.md)** — Manage profile-scoped server connections and storage
- **[Phase 03 Files, Editor, Search, and Git](./phase-03-files-editor-search-git.md)** — Profile-qualified IDE resources, federated search/replace, previews, and target-aware Git
- **[Phase 04 Terminal Continuity, Workflow, and Owner Navigation](./phase-04-terminal-continuity-workflow-navigation.md)** — Owner-qualified terminal identity, persistence, workflow reveal, notifications, and diagnostics
- **[Phase 05 Agents, Ports, and Browser](./phase-05-agents-ports-and-browser.md)** — Owner-bound Agent Store, multi-profile ports/tunnels, Browser target trust, and incarnation-safe terminal handoff
- **[Phase 06 Preferences, Settings, Usage, and Host Resources](./phase-06-preferences-settings-usage-and-host.md)** — Separate preference source and Settings target, owner-qualified usage, host-resource alerts, and revision-fenced suspend actions
- **[Multi-profile Host Resources verification](../plans/260920-0137-multi-profile-host-resources/phase-04-verification-and-testing.md)** — Completed focused unit/component and Chromium gate: 102/102 tests covering navigation, focus, polling tiers, unread isolation, responsive accessibility, and security negatives
- **[Phase 07 Media Isolation and Encryption](./phase-07-media-isolation-and-encryption.md)** — UUIDv4-namespaced media sessions, ticket-bound native streams, narrow remote cleanup, and owner-qualified encrypted writes
- **[Phase 08 Native Scope Concurrency and Platform Integration](./phase-08-native-scope-concurrency.md)** — Concurrent Windows native SSH scopes, lifecycle fences, per-scope teardown, and explicit Browser target ownership
- **[Phase 09 Integration and Qualification](../plans/260916-2137-unified-profile/phase-09-integration-and-qualification.md)** — Dual-server harness, reconciled test ledger, web/native release gates, and rollback boundaries
- **[Trusted Plugin Platform D00](./plugin-platform-d00.md)** — Candidate contracts, framing, opaque UI bridge, cancellation, Rust mirror, and G0 artifacts
- **[Trusted Plugin Platform D01](./architecture/plugin-platform-d01.md)** — Runner-owned package registry, streaming trust staging, archive invariants, and CAS API
- **[Frontend Components](./frontend-components.md)** — Shared React component architecture and host lifecycle
- **[Workflow Context Surface](./workflow-context-surface.md)** — Responsive Plan/item details, notes, and inline editing
- **[Native Browser Debug Support](./native-browser-debug-support.md)** — Windows v1 gate, Linux qualification, fallback and security boundaries
- **[Worktree Operations](./worktree-operation.md)** — Target selection and safe worktree lifecycle
- **[Terminal Idle Suspend Security](./terminal-idle-suspend-security.md)** — Automatic timing bounds, helper IPC, RTC ownership, audit, and fail-closed rules
- **[PTY Activity Observation](./pty-activity-observation.md)** — Phase 02 private root identity, raw output, input admission, snapshot, and watcher contract
- **[Configured-Agent Process Discovery](./agent-activity-process-discovery.md)** — Phase 03 bounded procfs discovery, attribution, and `ProcessSource` contract
- **[Owned TCP Byte Observation](./tcp-activity-observation.md)** — Phase 04 bounded `NETLINK_SOCK_DIAG`, `tcp_info`, and per-socket baseline contract
- **[Agent Activity Automatic Admission](./agent-activity-automatic-admission.md)** — Phase 05 transactional sampler, generation-fenced final claim, status warning, and coordinator lifecycle
- **[Protected Idle-Suspend Status and Browser UI](./idle-suspend-status-ui.md)** — Phase 06 decoder, aggregate activity presentation, warning/privacy boundary, and manual-force preservation

## Reference Documentation

- **[API Reference](./api-reference.md)** — REST endpoints, WebSocket protocol, response formats
- **[Workflow API](./workflow-api.md)** — Phase 02–03 workflow REST, lifecycle correlation, CAS/replay, and retention
- **[Workflow Client State](./workflow-client-state.md)** — Phase 04 shared UI DTOs, transport mapping, and React Query isolation
- **[Code Standards](./code-standards.md)** — Rust & TypeScript conventions, patterns, testing
- **[Codebase Summary](./codebase-summary.md)** — Module breakdown, key services, data flow
- **[WebSocket Protocol Guide](./ws-protocol-guide.md)** — Message format and lifecycle events
- **[Project Roadmap](./project-roadmap.md)** — Current status and explicitly historical/deferred work
- **[Windows Server Build and Verification Plan](../plans/260920-1312-windows-server-build-and-verify/plan.md)** — MSVC path/config normalization, cross-platform test harness, platform gates, and startup qualification
- **[Changelog](./CHANGELOG.md)** — Dated feature, persistence, and release notes
- **[Terminal Idle Suspend Security](./terminal-idle-suspend-security.md)** — Security invariants and helper execution policy

## Deployment

- **[Configuration Guide](./configuration-guide.md)** — TOML, environment variables, CORS, and extension origins
- **[Linux systemd](./linux-systemd.md)** — Current backend-only production service on port 4801
- **[Linux Release Manager](./linux-release-manager.md)** — Manager commands, Phase 06 diagnostics, helper service lifecycle, activation, rollback, and recovery
- **[Linux API Runtime Provisioning](./linux-release-runtime-provisioning.md)** — Canonical API config/audit state, copy-once legacy migration, and descriptor-relative refusal boundaries
- **[Linux nohup](./linux-nohup.md)** — Legacy/recovery server on loopback port 4800
- Docker serves the built SPA and backend on port 4800; it is separate from systemd and nohup ownership.

Historical implementation plans are not generally indexed here; the active
Phase 09 release-gate plan is linked above. Verify any new plan path exists
before linking it from another document.

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

**IDE Files, Editor, Search, and Git (Phase 03)** — Profile-qualified file
explorer and editor resources, target-aware previews and Git, and federated
search/replace.

- Target: `{ profileId, project, worktreePath? }`; root/worktree disappearance
  fails closed instead of falling back silently.
- Editor tabs and Monaco models are qualified per profile/target; dirty tabs
  remain isolated and are not overwritten by watcher or Git reloads.
- Search scopes are Project target and All connected profiles, with a
  500-result aggregate cap and truncation warning.
- Replace Next/All captures the match target and skips dirty files.
- Fetch/pull/push retain independent target results; SSH retry does not replay
  successful targets.
- Live tree subscriptions stay on the target's originating transport through
  event binding, child loading, cleanup, and unsubscribe; remounts obtain a
  fresh watch instead of reusing a retired subscription ID.
- Desktop, compact, and terminal Explorer surfaces contain FileTree failures
  locally so the shell and active terminals remain mounted.
- See [Phase 03 Files, Editor, Search, and Git](./phase-03-files-editor-search-git.md).

**Terminal Continuity, Workflow, and Owner Navigation (Phase 04)** — Terminal
identity, xterm lifetime, versioned layout/pin/history persistence, workflow
reveal, notifications, and profile-filtered diagnostics are all owner-scoped.

- Terminal identity is `{ profileId, id }`; incarnation checks reject stale
  lifecycle events and cross-profile raw-ID collisions.
- Layout `v3`, pins `v2`, and command history `v3` never attribute an
  unqualified legacy record to a profile.
- See [Phase 04 Terminal Continuity, Workflow, and Owner Navigation](./phase-04-terminal-continuity-workflow-navigation.md).

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

**Terminal Idle Suspend** — Server-authoritative, opt-in Linux suspend with
bounded automatic timing, a fixed enrolled helper, and two automatic policies:
`empty-fleet` (zero live/creating/restart-pending PTYs) and `agent-activity`
(configured-agent PTY/process/TCP activity heuristic; service-only terminals may
remain open). Quiet is not proof of agent completion, and `tcp4-tcp6` is not
generic network coverage.

- Status: `GET /api/system/idle-suspend/v1/status`; timing: `PATCH .../timing`
- Automatic persisted wake values remain `60..=86400` seconds; quiet default is
  900 seconds (15 minutes).
- Phase 01 configuration stores `automaticPolicy` and `agentExecutables`
  under `server.idleSuspend`; the selector defaults to `empty-fleet`.
- Production diagnostics Phases 01–07 are complete: `dam-hopper diagnose --json`
  invokes fixed role-aware systemd/journal/local-API/host-probe adapters,
  writes a bounded `bundleSchemaVersion: 1` JSON bundle, and returns exit
  `0` for complete, `2` for valid partial, or `1` for fatal
  serialization/output failure. Root output uses
  `/var/lib/dam-hopper-manager/diagnostics`; non-root output uses
  `$XDG_STATE_HOME/dam-hopper/diagnostics` or `$HOME/.local/state/dam-hopper/diagnostics`.
  Non-root collection never escalates; root-only helper evidence is
  `permissionDenied`, so server/both runs may be partial. See the
  [Linux Release Manager](./linux-release-manager.md#production-diagnostics-phase-06)
  guide and [diagnostics plan](../plans/260912-0027-production-idle-suspend-diagnostics/plan.md).
- Phase 07 cross-layer verification, architecture reconciliation, documentation,
  and staged read-only rollout are complete (2026-09-14). See the
  [Phase 07 test report](../plans/reports/tester-260914-0106-phase07-cycle2-verification.md)
  and [code review](../plans/reports/code-review-260914-0109-phase-07-production-idle-suspend-diagnostics-cycle2.md).
- Configured-agent activity Phase 02 provides private PTY evidence and input
  admission; its Phase 03 provides bounded process discovery and retained
  attribution. Phase 04 provides owned TCP byte observation and per-socket
  baseline comparison. Phase 05 adds the dedicated transactional sampler,
  manager-locked final admission, bounded status warnings, and the
  `agent-activity` state path.
- Phase 06 adds strict client decoding with narrow old-server normalization,
  aggregate status/measurement-warning presentation, a sole arm countdown, and
  Chromium/manual-force regressions. It does not add matcher controls, policy
  mutation, a new endpoint, or automatic authority in the browser.
- Phase 07 completes integrated qualification across deterministic activity,
  PTY, API, Chromium, security-boundary, and Linux live-observer surfaces.
  Evidence: **323 backend/PTY/API/integration tests**, **14/14** boundary
  checks, **16/16** Chromium tests, and the ignored Linux PTY/TCP smoke passed
  in **0.72s**; code review approved **9.4/10**. See the
  [Phase 07 verification report](../plans/reports/qa-260911-1107-phase07-integrated-qualification.md).
- Phase 08 documentation, operations runbooks, controlled rollout, and rollback
  are complete. QA evidence: **14/14** boundary checks, **20/20** idle-suspend
  integration scenarios including the ignored live smoke (**0.74s**), **16/16**
  Chromium tests, and **1606/1606** UI tests. The real automatic suspend canary
  remains an Operations gate; see the [Phase 08 QA report](../plans/reports/qa-260911-1207-phase08-idle-suspend-rollout.md).
- See [PTY Activity Observation](./pty-activity-observation.md),
  [Configured-Agent Process Discovery](./agent-activity-process-discovery.md),
  [Owned TCP Byte Observation](./tcp-activity-observation.md), [Agent Activity
  Automatic Admission](./agent-activity-automatic-admission.md), and
  [Protected Status and Browser UI](./idle-suspend-status-ui.md).
- Phase 01 helper execution accepts `wakeAfterSeconds: 0` for clear-only,
  indefinite sleep; it clears and verifies RTC state without target arithmetic.
- Unexpected pre-existing RTC alarms, inhibitors, capability failures, and RTC
  or audit failures suppress suspend. See [API Reference](./api-reference.md#terminal-idle-suspend),
  [Configuration Guide](./configuration-guide.md#terminal-idle-suspend-opt-in-linux-suspend),
  and [Systemd runbook](./linux-systemd.md#11-terminal-idle-suspend-helper-enrollment-rollback-runbook).

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
- Transport: `api.workflow` delegates named operations through the owner-bound
  API/transport; `WsTransport` maps 13 workflow channels to protected REST
  paths and URL-encodes cursors and resource IDs
- Query state: owner/generation-qualified key builders keep equal workflow keys
  for different profile runtimes distinct; hosts use ordinary `QueryClient`
  defaults rather than a global active-profile hash
- Mutation policy: one caller-owned request UUID, no optimistic snapshot
  writes, owner-qualified workflow-root invalidation only after success, typed
  errors on failure
- Ownership: React Query stores server state; workflow presentation state
  remains component-local and is not written to localStorage or URL search
  params
- See [Workflow API](./workflow-api.md) and [Workflow Client State](./workflow-client-state.md),
  [System Architecture](./system-architecture.md#workflow-client-types-transport-and-query-state-phase-04),
  [Project Overview & PDR](./project-overview-pdr.md#pr-014-workflow-client-types-transport-and-query-state-phase-04),
  [Codebase Summary](./codebase-summary.md#workflow-tracking),
  and [Code Standards](./code-standards.md#workflow-client-contracts-phase-04).

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

See [Frontend Components](./frontend-components.md#terminal-workspace-shell) for the UI flow.

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
│ ├── persistence/ # SQLite session store and migrations
│ └── workflow/ # Domain, REST, observation, reconciliation
apps/
├── web/ # Thin Vite browser host
packages/
├── ui/ # Shared React UI package
docs/
├── README.md # This file
├── project-overview-pdr.md # Product requirements & roadmap
├── system-architecture.md # Module breakdown & data flow
├── api-reference.md # REST/WebSocket endpoints
├── workflow-api.md # Phase 03 workflow REST/lifecycle contract
├── configuration-guide.md # dam-hopper.toml & setup
├── code-standards.md # Patterns, testing, security
├── codebase-summary.md # Quick module reference
└── CHANGELOG.md # Dated implementation and release notes

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
```
