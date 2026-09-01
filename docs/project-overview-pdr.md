# DamHopper Project Overview & PDR

## Project Vision

DamHopper is a **multi-project IDE assistant** that loads a project registry and manages projects across one or more filesystem roots, providing integrated terminal management, file exploration, and AI-powered agent distribution.

Target users: Developers managing monorepos or multi-project workspaces who want a lightweight, AI-friendly interface for common development tasks.

## Core Product Requirements

### PR-001: Workspace Management

**Functional Requirements:**

- Support TOML-based project registry configuration (`dam-hopper.toml`)
- Prefer the canonical global registry at `~/.config/dam-hopper/dam-hopper.toml`, with explicit override support
- Auto-discover projects by type (Maven, Gradle, npm, pnpm, Cargo, custom)
- Resolve relative project paths against the loaded registry file and allow absolute project paths
- Hot-reload registry config without restart
- Store global defaults at ~/.config/dam-hopper/config.toml

**Acceptance Criteria:**

- ✓ Load and parse explicit or global `dam-hopper.toml` registry files
- ✓ Resolve relative project paths against the registry file and preserve absolute project paths
- ✓ Support `workspace:switch` via API for directory or direct registry-file targets
- ✓ Fallback to global config defaults and legacy discovery when higher-priority sources are missing

**Technical Constraints:**

- Serde for TOML deserialization with snake_case field mapping
- Startup resolution priority: `--config` / `DAM_HOPPER_CONFIG` > `--workspace` / `DAM_HOPPER_WORKSPACE` > global registry path > `defaults.workspace` > legacy current-directory discovery

### PR-002: Terminal Session Management

**Functional Requirements:**

- Create isolated PTY sessions per project
- Run pre-configured build/run commands
- Stream terminal output to connected WebSocket clients
- Support terminal input (stdin) via API
- Auto-restart crashed processes with configurable policy
- Ensure idempotent session creation
- Support a terminal workspace mode with a full-height workspace shell and a persistent Fleet Terminal rail

**Acceptance Criteria:**

- ✓ Spawn new PTY session with UUID
- ✓ Broadcast output to multiple subscribers
- ✓ Retain buffer for live sessions only
- ✓ Graceful shutdown (SIGTERM → SIGKILL)
- ✓ Auto-restart on crash per policy (never/on-failure/always)
- ✓ Exponential backoff (1s→30s max)
- ✓ Session ID reused across restarts (frontend tab stays connected)
- ✓ Idempotent create: removes dead tombstones, cancels pending restarts, safe to retry (Phase 07 ✓)
- ✓ Workspace terminal mode reuses the existing terminal manager state, without a duplicate PTY lifecycle
- ✓ Fleet Terminal rail persists width/collapse state and refits terminal panes on layout changes

**Technical Constraints:**

- portable-pty for cross-platform compatibility
- Tokio broadcast channels for fan-out + separate PTY/FS channels
- WebSocket for output streaming + lifecycle events
- Supervisor pattern: reader thread (blocking) + supervisor task (async restart)
- Killed set prevents double-spawn during concurrent creates
- Cleanup task prunes dead tombstones (60s TTL) and orphaned killed entries (every 30s)

**Phase-Based Implementation:**

- Phase 02: Config extension — RestartPolicy enum per terminal
- Phase 03: Session metadata — restart_count, last_exit_at fields
- Phase 03: Terminal workspace layout — full-height terminal workspace, persistent Fleet rail, refit on mode/layout changes
- Phase 04: Restart engine — supervisor + exponential backoff
- Phase 05: Enhanced WS events — terminal:exit (willRestart field) + process:restarted
- Phase 07: Idempotency — killed set lifecycle, TOCTOU guard, memory leak fix
- Phase 02 (shell capture seam): validated Bash/Zsh/Fish lifecycle completion status and privacy-safe command telemetry events
- Phase 03: opt-in durable telemetry worker, private SQLite storage, retention/rollups, privacy controls, and aggregate query foundation behind the non-blocking sink boundary

### PR-003: Git Operations

**Functional Requirements:**

- Clone repositories with optional recursion
- Fetch, push, pull with progress reporting
- Query repository status (branch, ahead/behind)
- Support SSH key loading for authentication
- Let push select the active VCS root in the UI so submodules and nested repos can push independently
- Retry SSH-auth failures through the shared passphrase flow without duplicating result-shape handling

**Acceptance Criteria:**

- ✓ Clone from any git URL
- ✓ Detect SSH key requirement and prompt
- ✓ Broadcast git progress to WebSocket
- ✓ Handle merge conflicts gracefully
- ✓ Project info panel can choose a VCS root before push
- ✓ Push invalidates branch, history, status, diff, conflict, file-tree, and project data
- ✓ Retry hook normalizes single-result and array Git responses before auth checks
- ✓ Fetch/pull/push share one backend credential order and push reports missing-upstream configuration clearly
- ✓ Push entrypoints now expose an explicit force-push action for intentional published-history updates

**Technical Constraints:**

- git2 library for operations, CLI fallback for advanced ops
- Loaded SSH keys live in-memory per server session; optional saved passphrases are delegated to the host OS credential store
- Constant-time comparison for auth tokens
- History mutations must distinguish safe recovery from rewrite actions
- Pushed/shared history must prefer revert over destructive history actions; force-push is a separate explicit push action
- Published-history rewrite must stay opt-in and explicit when it is allowed

**Phase-Based Implementation:**

- Phase 01: Backend Git operations and repo-state guards
- Phase 02: Web Git workspace semantics and refresh flow
- Phase 03: IntelliJ-compatible actions, including undo last commit and selected-change revert/drop split

### PR-004: IDE File Explorer (Phase 01)

**Functional Requirements:**

- List directory contents with metadata (size, mtime, symlink status)
- Read file content (text with range support, binary detection)
- Get file metadata (kind, size, mime type, binary flag)
- Enforce sandbox: no traversal outside project bounds

**Acceptance Criteria:**

- ✓ GET /api/fs/list returns DirEntry array
- ✓ GET /api/fs/read supports offset+len for large files (max 10MB per read)
- ✓ GET /api/fs/stat includes mime type detection
- ✓ Symlink validation prevents escape attempts
- ✓ Binary files return { binary: true, mime: "..." }
- ✓ Shared file decoration registry returns consistent icon, badge, display language, and Monaco language across file surfaces

**Technical Constraints:**

- Max read and upload limits are enforced by the server's bounded route policies; consult the API reference rather than treating historical 10 MB wording as universal.
- MIME type detection via mime_guess crate
- Async I/O via tokio::fs
- Frontend file decoration data centralized in `packages/ui/src/lib/file-decoration.ts`

**Phase 02+:** File watcher, create/delete/move ops (see Roadmap below)

### PR-005: Agent Store Distribution

**Functional Requirements:**

- Distribute .claude/ items (skills, commands, hooks, MCP servers) across projects
- Support symlink-based distribution (ship/unship)
- Absorb project items into central store
- Health check for broken symlinks
- Import items from remote repositories

**Acceptance Criteria:**

- ✓ ship() creates symlinks
- ✓ unship() removes symlinks
- ✓ absorb() copies file into store
- ✓ Distribution matrix tracks coverage
- ✓ Health check reports broken links

**Technical Constraints:**

- Store path: .dam-hopper/agent-store/
- Symlinks relative to project root
- Shallow clone for remote import (temp cleanup)
- URL regex validation before clone

### PR-006: REST API & Authentication

**Functional Requirements:**

- Support Bearer REST authentication plus HttpOnly SameSite=Strict cookie sessions and public health/auth exceptions.
- Enforce exact HTTP(S) CORS origins; wildcard, path, query, duplicate, and userinfo entries are rejected.
- Structured error responses and content negotiation for binary vs. text responses.
- Diagnostics export from Settings > Maintenance with canonical frontend snapshot payload and capped terminal tails.

**Acceptance Criteria:**
- ✓ Native image/video streams require an opaque ticket bound to an authenticated actor/session
- ✓ Ticket clients require `session-cookie-v1` and a credentialed successful `HEAD` before native source/download exposure
- ✓ Profile change/logout revokes the bounded media session before credential removal, including stale dialog profiles
- ✓ Unknown, expired, revoked, or wrong-kind media tickets fail as non-disclosing `404` without bearer/blob fallback

**Non-Functional Requirements:**

- Token generation on first start
- Store token securely (0600 file permissions)
- Log auth failures without leaking tokens
- Diagnostics exports include recent terminal output tails by default and must be reviewed before sharing
- Media uses an HTTP-compatible host-only `HttpOnly; SameSite=Lax; Path=/api/fs` cookie; auth remains `HttpOnly; SameSite=Strict`, and ticket/session auth is preserved
- Separate browser clients use exact `DAM_HOPPER_CORS_ORIGINS` entries; wildcard CORS is forbidden
- Cleartext HTTP permits interception or modification of Bearer/auth cookies, ticket URLs, actions, and media bytes
- Historical qualification record (Chromium 151, 116 browser tests including 11 media tests; 1,018 UI and 691 Rust tests) is retained for provenance only, not a current release guarantee.
- Media session/ticket state is process-local; multi-instance deployments require sticky routing to the issuing process

### PR-007: Multi-Server Profile Management (Phase 2)

**Functional Requirements:**

- Manage multiple server connection profiles in browser (no backend involvement)
- Switch between servers without page reload
- Store profile metadata: name, URL, auth type, username
- Automatically migrate legacy single-server config to profile system
- Display active profile in UI sidebar

**Acceptance Criteria:**

- ✓ Create/read/update/delete profiles via localStorage
- ✓ `ServerProfile` model: { id (UUID v4), name, url, authType ("basic"|"none"), username?, createdAt (timestamp) }
- ✓ Server profiles list via `ServerProfilesDialog.tsx` component
- ✓ Profile editor via `ServerSettingsDialog.tsx` component
- ✓ Active profile indicator in `Sidebar.tsx`
- ✓ `migrateToProfiles()` called in `App.tsx` startup — converts legacy `damhopper_server_url` + `damhopper_auth_username` to "Default Server" profile
- ✓ Profile switching without browser reload
- ✓ Delete active profile selects the first remaining profile; active ID is cleared only when no profiles remain

**Storage:**

- Profiles JSON: localStorage key `damhopper_server_profiles`
- Active profile ID: localStorage key `damhopper_active_profile_id`

**Non-Functional Requirements:**

- Password never stored (only display username)
- UUID v4 for profile IDs (browser crypto.randomUUID())
- Storage quota: typical localStorage limit (5-10MB)
- Profile switching instant (no network latency)

### PR-008: Shared Runtime Logging Utilities

**Functional Requirements:**

- Provide a dependency-free logger package shared across browser packages
- Support bootstrap-level configuration plus environment-based log-level fallback
- Redact sensitive metadata recursively before log sink delivery by default
- Replace direct `console` usage in high-value transport, auth, terminal, dashboard, error boundary, and filesystem flows

**Acceptance Criteria:**

- ✓ `configureLogger()`, `getLoggerConfig()`, `resolveLogLevel()`, and `logger.debug/info/warn/error()` exist in `packages/shared`
- ✓ Web bootstrap chooses a log level from Vite env, with dev default `debug` and prod default `warn`
- ✓ Sensitive metadata is redacted before sink delivery unless local diagnostics explicitly disable it
- ✓ Shared logger is used by the high-value UI surfaces noted above


### PR-010: Browser Debug and Native Child WebView

**Status:** Windows v1 runtime-supported behind `VITE_DAM_HOPPER_NATIVE_BROWSER_DEBUG`; Linux child/relay implementation exists but runtime and permission behavior are unverified; macOS is deferred; Android uses iframe fallback.

**Requirements and acceptance boundary:**

- Keep the native child WebView least-privileged, profile-scoped, and generation/nonce/request validated.
- Expose raw rendered bounds and mirrored app zoom (50–120%) to the child; do not persist page content or transient bridge state.
- Advertise only picker/navigation in native relay v1; console forwarding remains disabled.
- Reject unauthorized popup/download/permission flows and retain the web iframe's cross-origin external-redirect visibility limitation.
- Windows release evidence must pass the documented WebView2 gate; Linux build/package evidence is not runtime proof.

See [Native Browser Debug Support](./native-browser-debug-support.md) for the platform matrix and rollback path.
### PR-009: Host Resource Monitoring (Current Delivery)

**Status:** Phase 07 completed on 2026-08-10 with release-owner approval after local packaging, soak, and browser validation. Phase 02 host-resource restoration alerts completed on 2026-08-11: additive thermal/disk current alerts, mixed history, validated compatible push events, and per-target recovery are now delivered. The still-unobserved Windows CI result, canary-host profiling, staged monitor/in-app-alert canary, and rollback rehearsal are owner-authorized deferred follow-up work, not passed gates. Re-authentication, mutation lifecycle/audit, privileged IPC, enrollment, and fixed host operations are deferred together and are not part of the current release.

**Current Functional Requirements:**

- Keep `HostResourceMonitor` read-only, bounded, startup-owned, and independent from every mutation subsystem.
- Preserve the `GET /api/system/metrics` response shape from the monitor cache; expose immutable deep snapshots and bounded incident history through versioned protected read APIs.
- Preserve the legacy memory `alert` and publish additive `currentAlerts` for concurrent thermal/disk incidents; return bounded mixed history with per-target recovery records.
- Publish sanitized, strictly validated compatible `host:alertChanged` events; REST remains authoritative after reconnect, lag, missed events, malformed data, and older servers that omit an additive field.
- Render in-app status, alert history, evidence, uncertainty, and static operator guidance without credentials or host-mutation controls.
- Feature-detect Linux procfs, PSI, and cgroup v2 data. Return explicit unsupported/stale/partial states on constrained Linux, containers, and non-Linux hosts.

**Current Acceptance Criteria:**

- [x] `HostResourceSnapshotV1` uses bounded actual-byte reads, explicit degradation states, cgroup v2/PSI data, bounded process inventory, and non-overlapping cache attribution.
- [x] One background monitor owns sampling, cached legacy/deep projections, alert state, and shutdown lifecycle independently of UI visibility.
- [x] `GET /api/system/metrics` remains compatible; `/api/system/resources/v1/snapshot` and `/alerts` return cached read-only state.
- [x] Sustained alert classification, bounded mixed incident history, additive concurrent resource alerts, and compatible `host:alertChanged` delivery are implemented and tested.
- [x] The client validates resource event shape/evidence before cache updates, retains active incidents when an older server omits `currentAlerts`, and removes only the recovered target from an explicit authoritative array.
- [x] The top-nav diagnosis UI consumes cached snapshot/alert state and exposes no remediation control.
- [x] Phase 07 completed packaging, compatibility, graceful-degradation, platform/browser, soak-budget, and documentation validation; rollout follow-ups are explicitly deferred.

Phase 07 evidence confirms the monitoring-only/read-only boundary, explicit
cgroup-v1 and non-Linux unsupported states, and pinned `linux/amd64` packaging.
The no-tunnel shutdown result must not be generalized to active tunnel teardown.
The release owner approved completion with the still-unobserved Windows CI
result, canary-host profiling, staged monitor/in-app-alert canary, and rollback
rehearsal deferred as post-release work; none of those checks is passed release
evidence.

**Accepted Monitoring Follow-ups:**

- Accepted UI polish: a resource-only critical badge can render info-colored after acknowledgement; the active count and incident state remain correct.
- Backlog polish: refine warning-badge severity semantics after release evidence and threshold tuning.

**Deferred Remediation Backlog and Sign-off:**

- Re-authentication/action lifecycle and privileged helper/IPC/enrollment remain one inactive backlog. They are not dependencies of monitoring Phase 07.
- Preserve the deferred threat model in [system architecture](./system-architecture.md#deferred-remediation-design-fixed-v1-contract); do not treat it as shipped capability.
- Before any future privileged implementation: reopen architecture/security review; define kernel/distro/systemd and pidfd policy; approve audit retention and any global cache operation; accept residual enrolled-server compromise risk.

### PR-011: Workflow Tracking Domain & Relational Persistence (Phase 01)

**Status:** Domain and SQLite repository foundation implemented on 2026-09-02.
The phase is additive and does not yet expose workflow REST or WebSocket
routes.

**Functional Requirements:**

- Identify a tracked workspace by a caller-resolved canonical config locator
  that is unique within the persistence database.
- Persist work items as `Plan`, `Phase`, or `Task` with project and optional
  worktree scope, ordering, summary, status, and lifecycle timestamps.
- Record manual work sessions with optional item association and target scope.
- Correlate sessions with external `terminal` or `agent` resources, including
  incarnation/run metadata and observed state.
- Attach durable notes to an item, session, or both; support soft deletion and
  bounded physical purge.
- Append activity events with source, scope, optional JSON payload, expiry, and
  retry-safe event IDs.
- Build a bounded workspace overview with project summaries, hierarchy nodes,
  active sessions, recent events, and factual descendant-task progress.

**Plan-first hierarchy:**

- A Plan is a root and cannot have a parent.
- A Phase must have a Plan parent.
- A Task may be standalone or child of a Plan or Phase.
- A Task cannot parent another Task.
- Creation validates parent workspace/project scope, rejects cycles, and caps
  depth at three levels.

**Acceptance Criteria:**

- [x] Migration `010_workflow_tracking.sql` adds six workflow tables,
  relationships, checks, unique constraints, and query indexes without
  changing existing terminal-session tables.
- [x] `SessionStore::open()` enables foreign keys and applies migration 010
  idempotently when the workflow schema is absent; `WorkflowStore` shares its
  connection and does not open a second database.
- [x] Domain enums have stable lowercase snake_case storage values and
  camelCase model serialization; invalid request values are reported through
  `WorkflowModelError`.
- [x] Item, session, resource, note, and event mutations are transaction
  helpers. Optional audit events commit atomically with their domain mutation.
- [x] Event IDs are idempotent, event history is keyset paginated, notes are
  soft-deleted before bounded purge, and observation updates do not mutate
  session lifecycle fields.
- [x] Overview limits are clamped and expose truncation rather than returning
  unbounded projects, items, sessions, or event history.
- [x] `server/src/workflow/tests.rs` covers model transitions, migration data
  preservation, hierarchy/scope rules, idempotency, overlapping sessions,
  observation isolation, note retention, overview progress, pagination, and
  purge.

**Technical Constraints:**

- Reuse the configured `sessions.db` SQLite connection through
  `Arc<Mutex<Connection>>`; preserve the existing Unix `0o600` permission
  boundary.
- Keep enum values constrained in SQL and parsed through domain conversions;
  do not expose canonical workspace locators in serialized responses.
- Enforce 200-character titles, 8 KiB note bodies, 200-character external IDs,
  64-character harness labels, 128-character run IDs, and 4 KiB event
  payloads before persistence.
- Use millisecond Unix timestamps and explicit state-transition validation.
- Keep events as metadata references rather than foreign keys so audit history
  can outlive item/session cleanup.

**Security and scope boundary:**

The locator is server-only. Workspace-scoped entity reads include a workspace
filter, while resource-link reads are anchored to their session identity.
Cross-project parent/item associations are rejected. This phase does not infer
session completion from external resource observations, does not launch or
control terminals/agents, and does not add an HTTP authorization surface.

### PR-012: Workflow Service and REST API (Phase 02)

**Status:** Complete / DONE on 2026-09-02. The protected service and REST
boundary builds on PR-011's additive workflow persistence foundation. Review
approved the implementation at 9.5/10; the recorded validation report covers
14 workflow domain tests, 8 API integration tests, and the full server target.
See the [Phase 02 test report](../plans/reports/tester-260902-0306-workflow-service-rest-api.md)
and [code review](../plans/reports/code-reviewer-260902-0312-phase-02-workflow-service-rest-api.md).

**Functional Requirements:**

- Expose the current authenticated workspace through
  `GET /api/workflow/overview` with bounded project summaries, Plan/Phase/Task
  trees, standalone Tasks, notes, running sessions, recent events, factual
  descendant-Task counts, and an explicit `truncated` flag.
- Expose append-only activity history through
  `GET /api/workflow/events` with opaque `(recordedAt, id)` keyset cursors,
  bounded limits, and no raw payload or canonical locator disclosure.
- Support Plan-first item mutations through `POST /api/workflow/items` and
  `PATCH`/`DELETE /api/workflow/items/{id}`. PATCH and DELETE require
  optimistic `updatedAt` checks.
- Support manual session start/end/abandon through
  `POST /api/workflow/sessions`,
  `POST /api/workflow/sessions/{id}/end`, and
  `POST /api/workflow/sessions/{id}/abandon`. Manual RFC3339 work timestamps
  are preserved and `endedAt >= startedAt` is enforced.
- Support terminal/agent correlations through
  `POST`/`DELETE /api/workflow/sessions/{id}/links`, including terminal
  incarnation or bounded agent harness/run metadata.
- Support durable notes through `POST /api/workflow/notes` and CAS-protected
  soft deletion at `DELETE /api/workflow/notes/{id}`.
- Support explicit permanent history cleanup through
  `DELETE /api/workflow/history?before=...`, returning deleted event/note
  counts. Automatic startup/daily retention remains bounded and non-fatal.

**Cross-cutting contract:**

- All workflow routes inherit existing authentication; workflow storage
  failure maps to a workflow-only `503` and does not gate terminal/IDE APIs.
- JSON uses `camelCase`, request DTOs deny unknown fields, and mutations
  require client-generated UUID `requestId`. Successful retries return the
  current resource with `replayed: true`; DELETE returns a typed tombstone.
- Current config/workspace, project, and registered worktree target are
  server-authoritative. Explicit worktree paths must be absolute and
  currently registered; cross-workspace/project/item associations are
  rejected.
- The workflow route group has a focused 32 KiB body limit. Titles, notes,
  external IDs, harness labels, run IDs, and event payloads retain the domain
  limits from PR-011.

**Architecture:**

- `WorkflowService` is the service boundary. It snapshots config scope,
  resolves targets, and dispatches synchronous `WorkflowStore` work through
  `tokio::task::spawn_blocking`.
- `AppState` holds an optional shared `Arc<WorkflowService>` created from the
  existing `SessionStore::connection()`; no second workflow database exists.
- Item/session/link/note mutations append typed events atomically in the same
  SQLite transaction. Event history uses `(recorded_at DESC, id DESC)` keyset
  pagination; notes soft-delete before physical purge.
- The complete endpoint contract is in
  [Workflow API](./workflow-api.md); the service/data-flow record is in
  [System Architecture](./system-architecture.md#workflow-phase-02-service-and-rest-api).

**Acceptance Criteria:**

- [x] Protected overview and history routes are mounted under the existing
  Axum auth middleware.
- [x] Item create/update/delete, session lifecycle, resource links, note
  create/delete, and history purge routes return the documented shapes.
- [x] Replay IDs are idempotent, stale item/note/link writes return conflict,
  and invalid transitions/targets do not write partial state.
- [x] Overview and event history are bounded; cursor and payload validation
  reject malformed or oversized input.
- [x] `server/tests/workflow_api.rs` covers auth, hierarchy, overview,
  replay/CAS, session lifecycle, links, notes, validation, pagination, and
  purge.

**Changed backend files:**

- `server/src/workflow/service.rs`
- `server/src/api/workflow/*`
- `server/tests/workflow_api.rs`
- Supporting router/state/startup/error/config wiring in
  `server/src/api/router.rs`, `server/src/state.rs`, `server/src/main.rs`,
  `server/src/api/error.rs`, `server/src/error.rs`, and
  `server/src/config/schema.rs`.

**Security and boundaries:**

The API never serializes the canonical registry locator, raw commands, CWD,
environment, terminal output, or arbitrary adapter payloads. It validates
targets through the authoritative resolver, scopes every lookup to the
current workspace, and maps internal failures to sanitized workflow codes.
Phase 02 does not expose resource-observation ingestion or infer session
completion from terminal/agent state; those integrations remain follow-up
work.

## Non-Functional Requirements

### Performance

**Target Metrics:**

- Workspace load: <200ms
- PTY spawn: <500ms
- File list (1000 items): <100ms
- File read (10MB): <2s

**Implementation:**

- Arc<Mutex> for zero-copy clones
- Tokio async I/O
- Broadcast channels for fan-out (not polling)

### Reliability

**Uptime:** 24/7 server stability for long-running sessions
**Session Recovery:** Retain PTY state if WebSocket disconnects briefly
**Sandbox:** Prevent information leakage across projects

### Security

**Authentication:** Bearer token + constant-time comparison
**Sandbox:** Path validation prevents directory traversal
**Error Messages:** Never leak filesystem paths or credentials
**Symlink Handling:** Validate symlink targets stay in bounds

### Developer Experience

- Single config file for entire workspace
- Consistent REST API design
- Detailed error messages with suggestions
- Structured logging (tracing crate)

## Architecture Decisions

### Decision: Arc<Mutex<T>> for shared state

**Context:** Multiple PTY sessions, git operations, filesystem operations run concurrently.

**Decision:** Use Arc<Mutex<T>> for PtySessionManager, FsSubsystem,
AgentStoreService, and WorkflowStore.

**Rationale:** Cheap clones, clear ownership, Mutex never held across `.await`.

**Alternative Rejected:** Channels (too much boilerplate) or Actor model (overkill).

### Decision: IDE Explorer Enabled by Default

**Context:** File exploration is a core requirement of DamHopper's IDE-like functionality.

**Decision:** IDE endpoints are permanently enabled.

**Rationale:** The feature gate added unnecessary complexity for the primary use case of the project.

**Alternative Rejected:** Feature-gated endpoints (was used in early development but removed to simplify architecture).

### Decision: Symlink-based Agent Store Distribution

**Context:** Need to share .claude/ items across projects without duplication.

**Decision:** Central store at .dam-hopper/agent-store/, symlinks to projects.

**Rationale:** No file duplication, easy to add/remove items, clear visibility of distribution.

**Alternative Rejected:** Copy (duplicates), environment variables (harder to manage).

### Decision: Additive workflow persistence on the session database

**Context:** Workflow continuity needs durable relational records without
breaking terminal session recovery or creating a second database lifecycle.

**Decision:** Apply migration 010 after the existing migrations and add
workspace/item/session/resource-link/note/event tables with foreign keys,
checks, indexes, and bounded repository methods. Share the existing
`Arc<Mutex<Connection>>` through `WorkflowStore`.

**Rationale:** Existing `SessionStore::open()` owns database permissions,
foreign-key setup, and migration ordering. Reusing that connection keeps
startup, backup, and access-control boundaries singular while `CREATE TABLE IF
NOT EXISTS` preserves existing session data.

**Boundary:** Domain/store code is available for later API and UI phases.
Migration 010 does not itself add workflow routes, automatic terminal/agent
attachment, or inferred session completion.

## Roadmap

### Phase 01: IDE File Explorer (Complete)

- ✓ Filesystem sandbox
- ✓ List/read/stat REST endpoints
- ✓ Binary detection

### Phase 02: File Watcher (Complete)

- ✓ inotify integration (Linux), notify crate cross-platform
- ✓ WebSocket subscription + fs:event push
- ✓ Live tree sync on file changes

### Phase 03: IDE Shell (Complete)

- ✓ react-resizable-panels layout (tree | editor | terminal)
- ✓ react-arborist file tree with live sync
- ✓ TanStack Query + useFsSubscription hook
- ✓ /ide lazy route with feature gate

### Phase 04: Monaco Editor + Save (Complete)

- ✓ Monaco integration with tab management
- ✓ Ctrl+S save via 3-phase WS write protocol (begin → chunks → commit)
- ✓ File tiering (normal <1MB, degraded 1-5MB, large ≥5MB, binary)
- ✓ Mtime-guarded atomic writes (conflict detection)
- ✓ ConflictDialog (overwrite or reload on concurrent edits)
- ✓ LargeFileViewer (range reads), BinaryPreview (hex dump)
- ✓ **Binary Streaming Optimization for Large Files (2026-04-14)**

### Phase 05: Write Operations (In Progress)

- [ ] Create file/directory
- [ ] Delete file/directory
- [ ] Move/rename operations
- [ ] Undo/history tracking

### Phase 06+: Advanced Features (Future)

- [ ] Advanced Terminal (split panes, session persistence, search)
- [ ] Git integration UI (blame, diff)
- [ ] AI assistant integration

## Success Metrics

| Metric                           | Target                      | Tracking                 |
| -------------------------------- | --------------------------- | ------------------------ |
| Workspace load time              | <200ms                      | Benchmark tests          |
| File explorer response           | <100ms (1k items)           | API latency logging      |
| Zero workspace corruption        | 100%                        | Integration tests        |
| Agent item distribution coverage | 100% of enabled projects    | Health check             |
| Feature gate compliance          | 0 disabled endpoints active | Route registration tests |

## Dependencies & Constraints

### External Crates

Core: axum, tokio, serde, serde_json
Operations: git2, portable-pty, notify
Security: subtle (constant-time), walkdir
Workspace: toml

### System Requirements

- Rust 1.70+ (tokio async syntax)
- Node.js 18+ (web build)
- Git 2.0+ (for operations)
- POSIX shell (for command execution)

### Known Limitations

- No native Windows PTY support (portable-pty limitation)
- Max read size: 100MB (hard cap in fs::ops); 128KB per WS chunk
- Max write size: 100MB
- Symbolic link validation may follow platform limits
- Binary files read-only in Phase 04 (no write support)

## Timeline

| Phase | Scope                          | Status                  |
| ----- | ------------------------------ | ----------------------- |
| 01    | IDE File Explorer              | ✓ Complete              |
| 02    | File Watcher + WS subscription | ✓ Complete              |
| 03    | IDE Shell (layout + tree)      | ✓ Complete              |
| 04    | Monaco Editor + Save           | ✓ Complete (2026-04-14) |
| 05    | Create/delete/move/rename      | In Progress             |
| 06+   | Advanced features (git UI, AI) | Future                  |
