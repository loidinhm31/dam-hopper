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

- ✓ Native image/video streams require an opaque ticket bound to an authenticated actor, profile, and UUIDv4 `mediaClientId`
- ✓ Ticket clients require `session-cookie-v2`, a namespaced media cookie, and a credentialed successful `HEAD` before native source/download exposure
- ✓ The stored ticket binding selects the cookie namespace; duplicate selected cookies fail closed, while ticket-only fallback is limited to the exact allowed origin
- ✓ Profile change/logout revokes only the matching `(actor.subject, mediaClientId)` media session and tickets, including stale dialog profiles
- ✓ Unknown, expired, revoked, stale-generation, or wrong-kind media tickets fail as non-disclosing `404` without bearer/blob fallback

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

### PR-007: Unified Multi-Server Workbench (Phases 02–07 complete — 2026-09-17)

**Functional Requirements:**

- Store multiple browser/native server profiles locally; each profile owns an
  independent connection runtime and reconnect intent.
- Keep one always-mounted shell and one ordinary QueryClient per host. A profile
  that is offline, login-required, unsupported, or empty must not block other
  profiles.
- Support profile-scoped Connect, Disconnect, Login, Logout, Edit, Remove, and
  Auto-connect controls without page reloads or focus-triggered reconnects.
- Navigate through qualified `Profile → Project` references. Equal project
  names on different profiles remain distinct; selection is navigation only.
- Keep server registry/workspace selection as backend configuration under the
  selected profile's Settings section, not as a new workbench hierarchy.
- Reset legacy browser resource state once, without remote mutations or
  restoration, while preserving profiles, endpoint-bound auth, native state,
  and server-owned data.
- Keep media-ticket cleanup scoped to the original profile/generation, endpoint, credentials, ticket, and client namespace; failed cleanup relies on bounded server TTLs.
- Qualify encryption state, OPAQUE sessions, passphrase prompts, and encrypted writes by profile, connection generation, and project; never downgrade a stale operation to another owner or plaintext.

**Acceptance Criteria:**

- ✓ `ServerProfile.autoConnect` defaults to true for new/migrated records and
  preserves explicit false.
- ✓ `ProfileAuthV2` binds a token to normalized `serverUrl` and `authType`;
  mismatches return no token, and legacy raw tokens migrate only to a matching
  profile.
- ✓ `DamHopperApp` mounts routes before profile health settles and bootstraps
  each supported auto-connect profile independently.
- ✓ `ServerProfilesDialog` exposes per-profile actions and removes only local
  connection/profile state; remote PTYs and server data are never deleted.
- ✓ `workspace.selectedProject` is `ProjectRef | null`; grouped selector values
  use JSON tuple keys and preserve unavailable selections explicitly.
- ✓ `preferencesProfileId`, `settingsProfileId`, and
  `browserTargetProfileId` are independent and start unset after reset.
- ✓ `performFreshStateReset()` is idempotent, never calls `localStorage.clear()`,
  preserves valid new-schema records, and rejects unqualified deep links.
- ✓ Web/native entrypoints use one ordinary QueryClient and one render. Native
  non-Windows profiles require exact same-origin support; unsupported profiles
  remain editable and make no fallback request.

**Phase 07 acceptance criteria:**

- ✓ `mediaClientId` is required and validated as UUIDv4 on image/video issue, ticket revoke, and media-session logout.
- ✓ Native image/video preview and download use direct credentialed ticket URLs; no UI blob or plaintext fallback is introduced.
- ✓ `RemoteCleanupHandle` is at-most-once, concurrent-call deduplicated, five-second bounded, and limited to its resource revoke callback.
- ✓ Encryption prompts are queued and owner-labelled; exact owner/project duplicates join, and passphrases/session keys are not persisted.
- ✓ OPAQUE authentication, WebCrypto, and the final encrypted filesystem write use one captured transport with freshness fences before and after asynchronous work.

**Storage and security:**

| Record               | Location                                | Contract                                             |
| -------------------- | --------------------------------------- | ---------------------------------------------------- |
| Profile list         | `damhopper_server_profiles`             | JSON `ServerProfile[]`, including `autoConnect`      |
| Legacy active ID     | `damhopper_active_profile_id`           | Migration input only; not a runtime owner            |
| Auth v2              | `damhopper_profile_auth_v2_<profileId>` | `{version: 2, serverUrl, authType, token}`           |
| Workspace selection  | `dam-hopper:workspace-state`            | Qualified project or `null`                          |
| Workbench selections | `dam-hopper:preferences-source:v1`      | Independent profile IDs and safe preference snapshot |

Passwords are never persisted. Tokens are JavaScript-readable local browser
state and must be used only with HTTPS/trusted networks. Cleartext HTTP can
expose tokens, cookies, tickets, actions, and media bytes. Storage-unavailable
is distinct from an empty profile list and must not trigger destructive
fallbacks.

**Verification record:** The Phase 02 plan records 108 focused Vitest tests,
1,766 full UI tests, and TypeScript/build checks across `packages/ui`,
`apps/web`, and `apps/native`; those are phase evidence, not a release claim.

### PR-007A: Profile-qualified files, editor, search, and Git (Phase 03)

**Status:** Implemented frontend contract on 2026-09-17. This slice extends
the unified profile/project selection into the IDE resource boundary without
creating a second server workspace hierarchy.

**Functional requirements:**

- Bind filesystem list/read/stat, CRUD, write, watcher, upload, download, and
  preview requests to `{ profileId, project, worktreePath? }`.
- Keep root and registered worktree targets distinct and preserve an explicit
  unavailable state; never fall back silently after target disappearance.
- Qualify editor tabs, Monaco models, tree expansion, language scans, caches,
  search matches, replacements, and Git invalidation by profile and target.
- Preserve dirty editor content across watcher/Git reloads and isolate dirty
  state between profiles and worktree targets.
- Provide Project target and All connected profiles search scopes, with
  deterministic grouping and an aggregate 500-match/truncation warning.
- Resolve Replace Next/All writes from each match's originating target; skip
  dirty files and reload only clean tabs.
- Return independent Git results per target and retry only SSH-auth failures
  after passphrase load, without replaying successful targets.

**Acceptance criteria:**

- [x] Owner-bound clients project profile-qualified targets to server wire
      `{ project, worktreePath? }` only after owner validation.
- [x] File events, upload completion, Git mutation invalidation, and editor
      reloads affect only the matching profile/target scope.
- [x] Monaco and editor tab identity separates equal paths on different
      profiles; large files use read-only 64 KiB range reads.
- [x] Federated search preserves originating profile/project metadata, exposes
      per-profile status, and warns when the server or 500-result client cap
      truncates results.
- [x] Replace operations re-read and mtime-check before writing and never
      overwrite a dirty tab.
- [x] SSH retry validates the owner generation, retains initial successes, and
      retries only failed authentication targets.

**Source and verification boundary:** The implementation map and focused
contract coverage are maintained in
[Phase 03: Files, Editor, Search, and Git](./phase-03-files-editor-search-git.md).

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
- Render in-app status, alert history, evidence, uncertainty, and static
  operator guidance without credentials or generic host-resource remediation
  controls; the separate idle-suspend status/manual action retains its own
  authenticated actor, origin, fleet, and revision guards.
- Feature-detect Linux procfs, PSI, and cgroup v2 data. Return explicit unsupported/stale/partial states on constrained Linux, containers, and non-Linux hosts.

**Current Acceptance Criteria:**

- [x] `HostResourceSnapshotV1` uses bounded actual-byte reads, explicit degradation states, cgroup v2/PSI data, bounded process inventory, and non-overlapping cache attribution.
- [x] One background monitor owns sampling, cached legacy/deep projections, alert state, and shutdown lifecycle independently of UI visibility.
- [x] `GET /api/system/metrics` remains compatible; `/api/system/resources/v1/snapshot` and `/alerts` return cached read-only state.
- [x] Sustained alert classification, bounded mixed incident history, additive concurrent resource alerts, and compatible `host:alertChanged` delivery are implemented and tested.
- [x] The client validates resource event shape/evidence before cache updates, retains active incidents when an older server omits `currentAlerts`, and removes only the recovered target from an explicit authoritative array.
- [x] The top-nav diagnosis UI consumes cached snapshot/alert state and
      exposes no generic resource-remediation control; any idle-suspend action is
      the separate authenticated contract.
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
  [System Architecture](./system-architecture.md#workflow-phases-01-03-service-rest-and-lifecycle-correlation).

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
At the Phase 02 boundary, resource-observation ingestion and inferred session
completion were intentionally absent. PR-013 adds only the server-internal
PTY observation worker and link-state reconciliation; manual session lifecycle
remains explicit and user-controlled.

### PR-013: Terminal Lifecycle Correlation and Agent Adapter (Phase 03)

**Status:** Complete / DONE on 2026-09-02. The implementation correlates
authoritative PTY lifecycle facts with existing workflow resource links while
preserving manual-session ownership. Review approved the implementation at
9.8/10; the dated review reports 28 workflow tests and 907 full-server tests
passing. See the [Phase 03 code review](../plans/reports/code-reviewer-260902-0420-phase-03-terminal-lifecycle-correlation.md).

**Functional Requirements:**

- Emit a closed, terminal-only `WorkflowObservation` contract for create,
  exit-pending-restart, successful restart, final exit, and removal.
- Deliver observations through a bounded `sync_channel(256)` using non-blocking
  PTY sends. SQLite work belongs to the observation worker, never PTY reader or
  supervisor hot paths.
- Persist only terminal ID, incarnation, configured project, validated
  worktree target, server time, exit code, restart count/delay, and action.
  Command lines, arguments, CWD, environment, prompts, and terminal output are
  excluded.
- Correlate observations by public terminal ID plus incarnation. Older
  observations cannot regress newer links; deterministic event IDs suppress
  replay duplicates.
- Map terminal link health to `Attached`, `Stale`, `Exited`, `Crashed`, or
  `Detached`. Final exit/removal may provide a suggested end time only.
- Keep manual workflow session `status`, `startedAt`, and `endedAt` immutable
  from observation, restart, crash, removal, and startup-reconcile paths.
- Reconcile persisted terminal links after `restore_sessions_with_state` using
  the restored live `(sessionId, incarnation)` set.
- Accept bounded manual agent `harnessLabel` and `runId` values through the
  protected link API. Do not inspect commands, auto-detect harnesses, or ship
  harness-specific lifecycle producers.
- Permit direct Plan session links without synthesizing Phase or Task records.

**Architecture:**

- `PtySessionManager` holds a clone-cheap `WorkflowObservationRecorder`;
  production wiring installs `BoundedObservationRecorder`, while tests/default
  construction use a no-op recorder.
- `observation.rs` owns the `sync_channel(256)` worker and transactional link
  updates. `reconcile.rs` owns post-restore attached/detached reconciliation.
- `WorkflowService` exposes asynchronous reconciliation through the existing
  shared `WorkflowStore`; no second SQLite database or generic observation
  endpoint is introduced.
- PTY lifecycle code emits observations after authoritative state boundaries:
  publication for create, restart decision/result, final exit, and removal.

**Acceptance Criteria:**

- [x] PTY input/output and restart handling remain non-blocking when the
      observation queue is full or workflow storage fails.
- [x] Lifecycle observations update only resource links/events and preserve
      every manual session status and timestamp.
- [x] Incarnation ordering and deterministic event IDs reject stale/replayed
      observations.
- [x] Startup restore marks live links attached and still-active missing links
      detached without changing final link outcomes or abandoning manual sessions.
- [x] Target mismatch rejects terminal links without partial writes.
- [x] Manual harness bounds, direct Plan linking, crash/exit/removal, queue
      overflow, and real PTY lifecycle behavior are covered by tests.

**Changed backend files:**

- `server/src/workflow/observation.rs`
- `server/src/workflow/reconcile.rs`
- `server/src/workflow/observation_tests.rs`
- `server/src/workflow/mod.rs`
- `server/src/workflow/service.rs`
- `server/src/workflow/store/session.rs`
- `server/src/workflow/store/mod.rs`
- `server/src/pty/manager.rs`
- `server/src/api/workflow/session.rs`
- `server/src/main.rs`

**Security and boundaries:** Workflow observations carry no free-form terminal
telemetry. Manual harness IDs are size-bounded and target-scoped; they do not
grant execution authority. PTY failures, queue pressure, and SQLite failures
degrade workflow observation only and do not interrupt terminal operation.

### PR-014: Workflow Client Types, Transport, and Query State (Phase 04)

**Status:** Complete / DONE on 2026-09-02. Review approved the shared UI
client foundation at 10/10. Targeted UI tests passed 51/51; the full UI suite
passed 1,452/1,452 and the Rust server suite passed 907/907 executed tests.
See [Workflow Client State](./workflow-client-state.md), the
[Phase 04 test report](../plans/reports/tester-260902-1139-phase-04-client-types-transport-query-state.md),
and [code review](../plans/reports/code-reviewer-260902-1144-phase-04-client-types-transport-query-state.md).

**Functional Requirements:**

- Mirror workflow response/request shapes with explicit camelCase DTOs and
  closed unions for kind, status, resource type/state, source, and event type.
- Preserve structured `ProjectTargetRef`, optional/null fields, manual
  timestamps, observed resource state, and suggested end time without
  client-authoritative correction.
- Keep Plan-first parent validation, factual tracked-Task progress, timestamp
  interval checks, elapsed labels, attention predicates, and item ordering in
  pure domain helpers.
- Expose typed `api.workflow` methods for overview/events, item CRUD, manual
  session lifecycle, resource links, notes, and history purge.
- Map all 13 workflow channels to protected REST methods with encoded dynamic
  path/query values and unchanged request bodies.
- Isolate React Query cache by profile owner and connection generation; use
  success-only owner-qualified invalidation and one caller-owned replay request ID.

**Architecture:**

- `workflow-dto-types.ts` owns DTO/request interfaces; `workflow-types.ts`
  re-exports them with `workflow-domain-helpers.ts`.
- `client.ts` delegates named operations through the active `Transport`;
  `ws-transport.ts` owns channel-to-REST mapping and `ApiRequestError` handling.
- `workflow-queries.ts` owns query keys, generation subscription, overview/
  event hooks, and mutation wrappers; `queries.ts` re-exports the focused
  module for the shared query API.
- Owner-aware query keys include the profile ID and connection generation;
  workflow data is memory-only and presentation state remains component-local.

**Acceptance Criteria:**

- [x] DTOs and request payloads retain server enum/optional-field semantics.
- [x] Plan-only, nested, standalone, and direct-Plan ownership states remain
      representable without fabricated progress percentages.
- [x] Profile/runtime replacement cannot publish into the prior owner's
      query-generation key.
- [x] Failed mutations preserve cached authority and typed errors; successful
      mutations invalidate the owner-qualified workflow root (or compatibility
      root for unqualified callers).
- [x] Workflow hooks do not read/write URL search params, localStorage,
      terminal registries, editor state, or a workflow Zustand store.

**Changed client files:** `packages/ui/src/api/workflow-dto-types.ts`,
`workflow-domain-helpers.ts`, `workflow-types.ts`, `workflow-queries.ts`,
`client.ts`, `queries.ts`, `ws-transport.ts`, and their Phase 04 tests.

**Security and boundaries:** The client never persists workflow data or logs
notes, paths, external IDs, or request bodies. Server validation remains
authoritative for workspace/target ownership, limits, errors, and replay.

### PR-019: Unified-Profile Terminal Continuity and Owner Navigation (Phase 04)

**Status:** Complete / DONE on 2026-09-17. The implementation review recorded
42/42 focused UI contract tests and a clean UI build. The detailed source map
and compatibility notes are in
[Phase 04 Terminal Continuity, Workflow, and Owner Navigation](./phase-04-terminal-continuity-workflow-navigation.md);
the plan record is
[Phase 04 terminals, workflow, and navigation](../plans/260916-2137-unified-profile/phase-04-terminals-workflow-and-navigation.md).

**Product goal:** A user may switch profiles, reconnect, change terminal
layout, or follow a workflow/notification link without attaching to another
profile's PTY or to a stale process incarnation.

**Functional Requirements:**

- Define terminal identity as `{ profileId, id }` and process freshness as
  `{ profileId, id, incarnation }`; use canonical tuple keys throughout the
  registry, mounted sessions, activity, layout, and navigation.
- Route terminal and workflow requests through the API client bound to the
  captured profile connection/generation. Reject stale generations before
  publishing results or applying mutations.
- Preserve terminal continuity with owner-qualified layout `v3`/payload v2,
  profile-partitioned pin `v2`/payload v2, and profile-aware command-history
  v3. Remove unqualified legacy terminal stores without attributing them.
- Carry profile and optional incarnation through workflow links and
  notification targets. Reveal only the requested owner and incarnation;
  classify missing, cross-profile, missing-session, and stale links as
  unavailable.
- Export diagnostics by requested profile and optional terminal IDs, with
  bounded time and terminal-tail limits; never include another profile's
  terminal output.

**Architecture and changed boundaries:**

- `ownership.ts`, `terminal-registry.ts`, `terminal-incarnation-state.ts`,
  `terminal-output-activity.ts`, `terminal-mounted-sessions.ts`, and
  `terminal-auto-attach.ts` own identity and lifecycle admission.
- `terminal-layout-tree.ts`, `use-terminal-layout.ts`,
  `terminal-pin-persistence.ts`, `command-history.ts`, and
  `fresh-state-reset.ts` own browser continuity and versioned persistence.
- `workflow-queries.ts`, `workflow-workspace-integration.ts`,
  `terminal-notification-navigation.ts`, and
  `terminal-notification-signal-parser.ts` own owner-directed reveal.
- `diagnostics-client.ts` and `diagnostics-export.ts` own bounded,
  profile-filtered evidence export; server PTYs and workflow persistence
  remain authoritative.

**Acceptance Criteria:**

- [x] Identical raw session IDs on two profiles remain distinct in registry,
      mounted-session, activity, layout, pin, and query state.
- [x] Older lifecycle incarnations cannot overwrite current terminal state or
      receive post-replacement output/focus/input.
- [x] Auto-attach and cleanup preserve terminals owned by another profile.
- [x] Owner/generation query and transport boundaries prevent stale results
      from publishing into the active profile.
- [x] Workflow and notification selection never silently redirects across
      profiles or incarnations.
- [x] Diagnostics exports are bounded and exclude terminal evidence outside
      the requested owner scope.

**Security and boundaries:** Browser persistence contains IDs and metadata,
not PTY bytes, credentials, or workflow notes. Compatibility raw-ID lookup is
fail-closed when ownership is ambiguous. The frontend does not migrate an
unqualified terminal or infer ownership from the current active profile.

### PR-020: Unified-Profile Agents, Ports, and Browser (Phase 05)

**Status:** Complete / DONE on 2026-09-17. The Phase 05 gate recorded 44/44
targeted tests, a successful UI TypeScript build, and `cargo check`. Live
Browser/native qualification remains a later release gate. See the
[Phase 05 implementation guide](./phase-05-agents-ports-and-browser.md), the
[QA report](../plans/reports/qa-260917-1517-phase-05-agents-ports-browser-validation.md),
and [Cycle 2 review](../plans/reports/code-review-260917-1522-phase-05-cycle2.md).

**Product goal:** Agent Store actions, port/tunnel operations, Browser targets,
and terminal artifact handoff remain isolated when several server profiles
expose identical names, ports, or terminal IDs.

**Functional requirements:**

- Require an explicit profile owner for Agent Store catalogs, project targets,
  memory files, imports, health, and distribution mutations. Keep catalogs and
  projects server-local; do not merge equal names or distribute across servers.
- Bind a memory draft to `{ profileId, projectName, agent }`. Do not replace a
  dirty draft with arriving data for another owner or target.
- Bind import `tmpDir`/local paths and `scanRevision` to the owner that started
  the scan; reject late results and close stale dialogs on owner change.
- Aggregate ports by `(profileId, port, terminalId, incarnation)` and tunnels
  by `(profileId, tunnelId)`. Equal numeric ports remain independent rows.
- Treat Browser target trust as `{ owner, url, origin, source, tunnelId?,
revision }`; allow only HTTP loopback or an exact ready owner-local tunnel
  origin. Explicit target changes invalidate capture and bridge state.
- Permit terminal handoff only to a same-profile mounted/live terminal. Capture
  owner/generation, Browser revision, and terminal incarnation and recheck them
  after artifact creation and PNG upload.
- Require `terminalIncarnation` on artifact create. Persist authoritative
  terminal identity and atomically admit handoff input only when the live PTY
  incarnation still matches.
- Derive feature availability from each profile's connection status with
  explicit unknown/loading/available/unavailable states; never use another
  profile or a version string as support evidence.

**Acceptance criteria:**

- [x] Agent Store profile selection and owner-qualified query/mutation keys
      prevent cross-server catalog, project, import, and draft writes.
- [x] Equal profile ports/terminal IDs and delayed port events remain distinct;
      tunnel create/stop/kill/install operations use the requested owner.
- [x] Browser target revision and owner checks invalidate stale capture before
      handoff; project focus alone does not replace Browser target.
- [x] Reused terminal IDs return `TERMINAL_INCARNATION_MISMATCH` without
      changing replacement PTY bytes or the manager input revision.
- [x] Offline/unsupported/login-required state in profile A does not disable
      profile B.

**Security and boundaries:** Browser page selection data is never written
directly to terminal input. Handoff formats only server-generated private
artifact paths after control-byte stripping and bounded length checks. Artifact
claim, PNG limits, authorization, bridge origin/source/nonce checks, PTY
handoff/closing/disposing guards, and failed-write rollback remain mandatory.

### PR-021: Unified-Profile Preferences, Settings, Usage, and Host (Phase 06)

**Status:** Complete / DONE on 2026-09-17. Phase 06 recorded 87/87 targeted
tests, 1,760/1,760 full Vitest tests, clean TypeScript and modified-file
ESLint checks, and a 9.5/10 code review. See the
[Phase 06 guide](./phase-06-preferences-settings-usage-and-host.md) and
[Phase 06 plan](../plans/260916-2137-unified-profile/phase-06-preferences-settings-usage-and-host.md).

**Product goal:** A user can use profile A for shared workbench preferences,
profile B for Settings and host policy, and project C for navigation without a
delayed read, write, usage action, alert, or host confirmation crossing owners.

**Functional requirements:**

- Keep `preferencesProfileId`, `settingsProfileId`, and
  `browserTargetProfileId` independent. Persist the last successful
  allowlisted preference snapshot; mark a removed preference source
  `source-removed`, while clearing removed Settings/Browser targets.
- Capture `{ profileId, generation }` and the bound API client before debounce,
  file reads, confirmation, or mutation. Source changes cancel undispatched
  preference patches; dispatched work remains bound to its original source.
- Route global/workspace config, maintenance, import/export, Usage insights,
  and idle-suspend timing to the selected Settings target. Keep server-local
  project/terminal/runtime ordering, pinned mounts, usage settings, and host
  snapshots out of shared preference state.
- Qualify Usage summary/session/health/setup/deletion queries and URL deep links
  with the selected profile. Do not sum or average data across profiles, even
  when duplicate profiles point at one host.
- Qualify host snapshot/history/metrics/idle-suspend queries and event patches
  by profile and generation. Present missing/stale/unsupported measurements
  explicitly and retain incident identity by `incidentId`.
- Bind Force Machine to Sleep confirmation to endpoint label, generation,
  fleet snapshot, status revision, and request ID. Require renewed confirmation
  after a conflict and never replay an ambiguous POST.

**Acceptance criteria:**

- [x] Preference debounce and rollback cannot follow a changed source or
      Settings target; unavailable sources retain safe presentation without
      remote writes.
- [x] Settings import captures target through confirmation and delayed
      `file.text()`, rejects stale target/generation, and preserves server-side
      validation/backup/rollback.
- [x] Usage queries, destructive ranges, host alerts, pinned mounts, and idle
      suspend status remain profile-local; duplicate endpoints are not merged.
- [x] Host event payloads are validated before cache writes; recovery removes
      only its incident, and per-profile unread presentation resets on removal.
- [x] Force-sleep UI preserves existing actor, origin, no-auth, fleet, helper,
      inhibitor, and revision guards and uses fake executors in tests only.

**Privacy and security:** Preference snapshots exclude credentials and remote
resource identifiers. Usage remains aggregate/local and does not render prompts,
responses, commands, or raw telemetry. Host warning projections keep bounded
safe identities and omit arguments, environment, terminal data, socket details,
tokens, and raw diagnostics. The frontend does not add host mutation endpoints
or bypass server authorization.

### Workflow selected-item surface extension (2026-09-07)

The responsive workflow context surface renders authoritative item notes and
supports inline title/summary editing in both Deck and Sheet layouts.

- Note deletion passes the complete `NoteDto` and its `updatedAt` through
  `useWorkflowSurfaceActions`; item updates use the same CAS contract.
- Notes remain append-only in the UI; blank summaries serialize as `null`, and
  successful mutations refresh the workflow overview without optimistic writes.

### PR-015: Server-Authoritative Terminal Idle Suspend (Phases 01–05)

**Status:** Complete / DONE on 2026-09-05. Cross-module integration, privileged helper enrollment, systemd sandboxing, REST/WebSocket contract, and UI browser tests verified. Full integration tests passed in `server/tests/idle_suspend.rs` and browser tests passed in `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx`.

**Functional Requirements:**

- Server-authoritative PTY fleet monitoring detects quiescent state (0 live, 0 creating, 0 restarting PTYs).
- Configurable quiet period initiates an armed timer; active or spawning PTYs immediately cancel the timer.
- Single-flight idle epoch: exactly one suspend execution per empty period; zero auto-retry loops while fleet remains empty.
- Atomically mutable timing pair (`quiet_period_seconds`, `wake_after_seconds`) via dedicated `PATCH /api/system/idle-suspend/v1/timing` endpoint.
- Out-of-band revision notifications broadcast via `host:idleSuspendChanged` WebSocket hints.
- Privileged execution seam via a root-owned helper service with a Unix-domain socket (`/run/dam-hopper/idle-suspend.sock`), `SO_PEERCRED` authentication, RTC sysfs wakealarm programming, and the fixed `systemctl suspend` path that delegates to systemd/logind.
- Read-only live monitoring surfaced in host-resource popover; timing tuning in Settings.
- Safe operator rollback runbook and non-privileged boundary verification (`scripts/verify-idle-suspend-boundary.sh`, `deploy/reset-linux-production.sh`).

**Release-manager lifecycle and verification (Production CLI Phases 03–04, 2026-09-10):**
When a selected role includes `server`, the release manager stages
`dam-hopper-idle-suspend-helper.service`, starts it before the API during both
ordinary and pending-candidate `dam-hopper start`, and treats helper start or
enable failure as a warning-only fallback. Stop, activation rollback, manual
rollback, and boot recovery include the helper in their managed-unit set.
Phase 04 verification passed `linux_release_staging` 9/9,
`linux_release_unit_policy` 10/10, and the boundary verifier 14/14; role
isolation and the four-service `dam-hopper status` projection are covered. See
[Linux Release Manager](./linux-release-manager.md#verification-and-end-to-end-coverage-production-cli-phase-04).

**Acceptance Criteria:**

- [x] Disabled by default at startup; requires explicit operator configuration.
- [x] Timing updates rejected under `--no-auth` (`403`) and during active helper handoff (`409`).
- [x] Zero sudo, shell pipelines, or arbitrary command execution in server binary.
- [x] Post-resume capability, fleet, and revision reconciliation without repeat suspend.
- [x] Automated test suite runs with 100% fake-time/executor mocks; no automated CI/local command triggers host sleep or RTC writes.

### PR-016: Authenticated Manual Force Sleep — Phases 01–05

**Status:** Complete / DONE on 2026-09-06 15:45:00 +07:00. Protocol/helper, coordinator/fleet, protected REST API, Host Resource Popover confirmation UI, integration testing, and documentation are complete. Automated evidence passed: 81/81 Rust idle-suspend tests, 3/3 UI Vitest tests, 10/10 Chromium browser tests, 12/12 non-privileged boundary checks, and `cargo check`. No automated check performs host power or RTC mutation. The indefinite real-host canary remains explicitly deferred pending Operations approval and verified physical/out-of-band wake and recovery.

**Phase 02–05 boundary:** The manual action is a dedicated authenticated `POST /api/system/idle-suspend/v1/force-suspend` route with exact cookie same-origin and enabled-actor gates, content-free active-fleet confirmation, generation-fenced audited handoff, fixed helper execution, explicit indefinite/timed wake semantics, no-retry reconciliation, accessible confirmation UI, and fail-closed rollback/runbook documentation.

**Functional Requirements:**

- Keep helper protocol version 1 and the fixed request shape; accept
  `wakeAfterSeconds` exactly as `0` or `60..=86400`.
- Keep persisted automatic idle timing and `PATCH /timing` at `60..=86400`;
  `0` is execution-only and means indefinite sleep.
- Convert `0` to clear-only RTC behavior. Clear `/sys/class/rtc/rtc0/wakealarm`,
  verify the clear, and skip target-epoch arithmetic and writes.
- For nonzero values, clear and verify, calculate `now + seconds` with checked
  arithmetic, write the target epoch, and verify the readback.
- Reject unexpected non-empty RTC alarms under the approved DamHopper-exclusive
  ownership policy. Preserve peer, protocol-version, dedupe, capability,
  inhibitor, audit-before-mutation, and fixed-suspend checks.
- Record the numeric zero explicitly in bounded helper intent/completion audit
  records without exposing credentials, terminal content, raw IPC, or paths to
  browser clients.

**Acceptance Criteria:**

- [x] Execution validator accepts only `0` or the approved nonzero interval.
- [x] Automatic config/timing validation continues to reject zero.
- [x] Clear-only and timed RTC paths verify all required writes/readbacks.
- [x] Busy-alarm, audit, capability, inhibitor, and RTC failures produce zero
      suspend calls in fake/temp-file tests.
- [x] Scoped protocol, backend, preflight, helper, audit, and integration
      regressions cover boundaries and compatibility without touching host power.

### PR-017: Configured-Agent Activity Idle-Suspend Policy, Evidence, and Status UI (Phases 01–08)

**Phase 08 status:** Complete 2026-09-11 (documentation, runbooks, rollout stages, and rollback procedures integrated). Real-host automatic suspend canary remains an Operations gate.

**Implementation status:** Phase 01 policy/configuration, Phase 02 PTY
evidence, Phase 03 bounded process discovery, Phase 04 owned TCP byte
observation, Phase 05 transactional sampling/automatic admission, Phase 06
protected status/browser UI, and Phase 07 integrated qualification are complete
(2026-09-11). Automatic execution remains disabled by default and target-host
qualification is required before selecting `agent-activity` for execution.

**Requirements:** Persist `automatic_policy` (`empty-fleet` by default or
`agent-activity`) and a validated `agent_executables` list under
`[server.idle_suspend]`. TOML uses snake_case; config-shaped JSON uses
`server.idleSuspend.automaticPolicy` and
`server.idleSuspend.agentExecutables`. Entries are literal, case-sensitive
basenames or absolute paths; 1–32 unique entries, 1–256 UTF-8 bytes per
entry, and the allowed ASCII component characters are enforced; generic
interpreter basenames are rejected. Startup-owned policy fields survive config
reloads, full-config updates, settings imports, and workspace switching; only
the timing pair remains runtime-mutable.

#### Phase 02 — PTY root identity, raw output, and input admission

Phase 02 establishes the private evidence boundary consumed by the later
agent-activity sampler. Each concrete PTY incarnation carries a
`TerminalIdentity`, a qualified `(pid, start_ticks)` `ProcessIdentity` when
available, and a zeroed saturating raw-read sequence. The manager records
accepted nonempty input with a manager-wide revision and monotonic
`last_input_at`, rejects input during an active handoff, and exposes bounded
content-free snapshots plus a private coalescing invalidation watcher.

**Changed implementation files:** `server/src/pty/activity.rs`,
`manager.rs`, `session.rs`, `mod.rs`, and `tests.rs`.

**Acceptance criteria:**

- [x] Root PID/start-ticks identity is captured after spawn; uncertain or
      unavailable probes preserve terminal usability and fail closed downstream.
- [x] Raw output increments once per successful nonempty reader chunk before
      parser/buffer/event work; the per-incarnation atomic saturates at `u64::MAX`
      and never wraps.
- [x] Empty input is a no-op; accepted nonempty input advances revision/time
      and invalidation, while handoff, closing/disposal, missing-session, and
      saturated-revision gates reject without recording activity.
- [x] Create, restore, respawn, stale-reader, hydration, resize, attach, and
      real-PTY boundaries retain independent evidence and do not copy terminal
      content.
- [x] Snapshots bound live roots at 256 and report explicit incomplete
      reasons; no procfs I/O occurs under the manager lock.

#### Phase 03 — Bounded process discovery and agent attribution

Phase 03 adds the private `ProcessDiscovery<S>` engine and synchronous
`ProcessSource` abstraction. Production discovery reads Linux procfs through
`LinuxProcSource`; tests can inject deterministic sources. A preparation pass
validates exact process identities, attributes live and retained descendants
to one managed PTY root, classifies configured native/interpreter processes,
collects same-network-namespace socket ownership, and commits only complete
samples.

**Changed implementation files:** `server/src/idle_suspend/activity/mod.rs`,
`server/src/idle_suspend/activity/process.rs`,
`server/src/idle_suspend/mod.rs`, and `server/src/pty/activity.rs`.

**Acceptance criteria:**

- [x] `ProcessSource` isolates PID/stat/executable/cmdline/cwd/namespace/FD
      reads; disappearance, permission, timeout, malformed socket, identity, and
      namespace failures are explicit unavailable outcomes.
- [x] Attribution uses `(pid, start_ticks)`, stat-before/stat-after checks,
      root/retained descendant closure, and unique-root qualification; PID-only
      or process-group matching is not used.
- [x] Native executable matching is exact. Node, Bun, Python, and supported
      shell forms use finite entrypoint grammars; eval/print/`-c`/stdin/unknown
      forms and substring matches do not qualify.
- [x] Hard bounds cap 256 roots, 8,192 scanned processes, 1,024 relevant
      processes, 4,096 FDs per process, 8,192 owned socket inodes, and 16 KiB
      command lines. Zero recognized agents skips FD/socket scanning.
- [x] Prepared samples expose only bounded counts, output handles, socket
      identities, and safe executable evidence; terminal bytes, arguments,
      environment, credentials, and raw socket diagnostics are not retained.
- [x] `commit_sample` advances discovery state only after a complete accepted
      sample, while invalidation preserves retained identities for reparenting.

#### Phase 04 — Owned TCP byte observation

Phase 04 adds a private `SocketDiagnosticsSource` seam and the production
`LinuxSocketDiagnostics` collector. It consumes only Phase 03's prepared
`OwnedSocketSet`; it does not open process descriptors, change namespaces,
send traffic, expose socket addresses, or authorize suspend.

**Changed implementation files:** `server/src/idle_suspend/activity/mod.rs`,
`server/src/idle_suspend/activity/tcp_info.rs`,
`server/src/idle_suspend/activity/netlink.rs`, and
`server/src/idle_suspend/activity/tcp.rs`.

**Requirements and acceptance criteria:**

- [x] `tcp_info` parsing requires at least 208 bytes, decodes
      `tcpi_bytes_received` at `128..136` and `tcpi_bytes_sent` at `200..208`
      with checked slices/native-endian decoding, accepts trailing extensions, and
      never casts raw bytes to a local C struct.
- [x] Netlink transport is unprivileged, nonblocking, and deadline-aware.
      Requests use `NETLINK_SOCK_DIAG`/`SOCK_DIAG_BY_FAMILY`; poll recalculates a
      monotonic deadline, peeking uses `MSG_PEEK | MSG_TRUNC`, and all dumps share
      a 16 MiB response budget.
- [x] Multipart parsing validates sequence, sender PID, lengths, alignment,
- [x] The observer verifies the thread network namespace before and after
      collection, classifies owned inodes still unresolved after all applicable
      dumps as retryable close races, and reports unsupported UDP ownership rather
      than treating it as TCP.
- [x] `SocketKey` uses namespace, family, and diagnostic cookie; inode is join
      metadata only. Transactional baseline comparison returns
      `BaselineEstablished`, `Unchanged`, or `Activity` for per-socket changes,
      key membership changes, counter resets, or inode replacement.
- [x] Collection errors leave committed baseline state unchanged. Raw netlink
      payloads, addresses, terminal bytes, command data, credentials, and
      unbounded response data never cross the private evidence seam.

See [Owned TCP Byte Observation](./tcp-activity-observation.md) for the
implementation contract and failure taxonomy.

See [Configured-Agent Process Discovery](./agent-activity-process-discovery.md)
for the implementation contract.

#### Phase 05 — Transactional sampler and automatic admission

Phase 05 completes the configured-agent automatic path without widening the
private evidence boundary. A dedicated joinable `idle-suspend-sampler` worker
owns `ProcessDiscovery` and `TcpObserver`. It prepares process and TCP samples
sequentially, verifies raw-output checkpoints and a second PTY snapshot, retries
one retryable close race within the acceptance deadline, then commits both
prepared baselines back-to-back. Only a complete unchanged final sample mints
an opaque claim ticket.

**Changed implementation files:** `server/src/idle_suspend/activity/sampler.rs`,
`server/src/idle_suspend/coordinator.rs`, `server/src/idle_suspend/status.rs`,
`server/src/pty/manager.rs`, `server/src/pty/fleet_state.rs`,
`server/src/state.rs`, and `server/src/main.rs`.

**Requirements and acceptance criteria:**

- [x] `PtySessionManager::try_claim_agent_activity_handoff` checks startup
      policy/enabled state, request/activity/epoch/timing revisions, quiet
      deadline, five-second observation age, input revision, fleet generation,
      exact live root incarnations, raw output fences, and lifecycle blockers under
      one manager lock before setting `handoff_active`.
- [x] The coordinator supports both automatic policies. `empty-fleet` retains
      the active-to-empty epoch path; `agent-activity` requires a complete
      baseline, qualifying context, lifecycle-clear fleet, and an unspent epoch
      before arming and sending an asynchronous final sample.
- [x] Genuine input, output, network, process, or managed-lifecycle deltas
      reset the quiet anchor. A successful claim spends the epoch revision;
      recovery sampling after resume/release reconciles state without advancing
      `current_epoch` or silently rearming the spent epoch.
- [x] Public v1 status always includes `automaticPolicy`; `activity` is nullable
      under `empty-fleet` and populated under `agent-activity` with measurement
      state, reason, bounded counts, timestamps, TCP coverage, and optional
      `measurementWarning`. Warning processes are PID/safe-identity records capped
      at 32, with no arguments, socket details, terminal bytes, or diagnostics.
- [x] `is_meaningful_change` ignores status revision/timestamp heartbeat churn,
      sampled-time churn, and elapsed warning-duration churn while preserving
      semantic activity, warning, fleet, timing, epoch, and coordinator changes.
- [x] Coordinator shutdown joins the sampler before PTY readers and manager
      teardown; unavailable or stale evidence fails closed and cannot authorize
      automatic suspend.

See [Agent Activity Automatic Admission](./agent-activity-automatic-admission.md)
for the transaction sequence, ticket fields, status shape, state transitions,
privacy contract, and verification map.

#### Phase 06 — Protected status and browser UI

Phase 06 consumes the frozen additive status DTO without changing the v1 route
or server authority. The browser client decodes the transport result as
`unknown`, validates base and activity/warning fields, and normalizes only a
valid old-server response with both additive properties absent.

**Changed implementation files:** `packages/ui/src/api/client.ts`,
`packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx`,
`packages/ui/src/api/idle-suspend-client.test.ts`,
`packages/ui/src/components/organisms/HostIdleSuspendStatus.test.tsx`,
`packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx`, and
`server/src/api/tests.rs`.

**Requirements and acceptance criteria:**

- [x] New status data validates closed policy/measurement/reason values,
      nullable unknown counts, epoch domains, warning PID ordering, identity
      bounds, warning nullability, and policy/activity consistency.
- [x] Old-server compatibility is limited to both additive fields being absent;
      partial/malformed data and rejected transport/auth requests remain errors.
- [x] The status card separates coordinator state from measurement, renders
      `Unknown` counts, TCP4/TCP6 coverage, persistent heuristic limitations, and
      bounded warning reason/duration/PID-safe identity examples.
- [x] `armDeadlineMs` is the only countdown. One local display clock serves the
      countdown and warning elapsed duration without polling, invalidation, or
      admission side effects.
- [x] Manual force confirmation remains based on actual fleet counts and all
      existing handoff, conflict, retry, and wake-choice gates.
- [x] Protected API tests pass 9/9, frontend unit tests pass 41/41, Chromium
      tests pass 13/13, and review approves 9.7/10.

See [Protected Idle-Suspend Status and Browser UI](./idle-suspend-status-ui.md)
for the exact browser contract and privacy boundary.

#### Phase 07 — Integrated qualification

Phase 07 qualifies the frozen implementation through public manager, API, and
rendered-browser boundaries. It does not add a policy editor, matcher mutation,
new endpoint, or privileged test path.

**Changed verification files:**

- `server/tests/idle_suspend.rs`
- `server/src/api/tests.rs`
- `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx`

**Acceptance criteria:**

- [x] Public-manager integration proves service-only PTY output does not block
      agent-policy admission, accepted input invalidates quiet time, manual force
      remains single-flight with final sampling, disabled observation has no
      automatic deadline, and sampler shutdown joins before PTY teardown.
- [x] Protected API tests prove authentication, `Cache-Control: no-store`,
      exact policy/activity nullability, initializing/disabled/available warning
      states, warning bounds, and omission of private command/socket/terminal data.
- [x] Chromium tests prove rendered policy/counts, heuristic notice, warning
      duration and safe identity/truncation, countdown, manual force, and
      old-server compatibility.
- [x] The explicitly ignored Linux `activity_live_linux_pty_tcp_smoke` uses a
      managed PTY, test-owned loopback TCP, direct procfs/netlink observation, and a
      panic executor; it never invokes host suspend or RTC mutation.
- [x] Qualification evidence records **323 backend/PTY/API/integration tests**,
      **14/14** boundary checks, **16/16** Chromium tests, a **0.72s** Linux
      smoke, and **9.4/10** code-review approval.

#### Phase 08 — Documentation, operations runbooks, and controlled rollout

Phase 08 integrates operator documentation, operations runbooks, controlled rollout stages, and rollback procedures across all system guides.

**Changed documentation and asset files:**

- `docs/system-architecture.md`
- `docs/api-reference.md`
- `docs/configuration-guide.md`
- `docs/terminal-idle-suspend-security.md`
- `docs/linux-systemd.md`
- `docs/linux-release-manager.md`
- `docs/code-standards.md`
- `docs/codebase-summary.md`
- `docs/project-overview-pdr.md`
- `docs/project-roadmap.md`
- `docs/README.md`
- `README.md`
- `scripts/run-uat.sh`
- `docs/CHANGELOG.md`

**Acceptance criteria:**

- [x] System architecture documents implemented dataflow, opaque ticket claim, epoch latches, and explicit heuristic limitations.
- [x] API reference defines complete v1 status DTO, all enum values (`measurementState`, `reasonCode`, `measurementWarning.reasonCode`), nullable unknown counts, display timestamps, and strict privacy boundaries.
- [x] Configuration guide documents three distinct registry paths, startup policy immutability, canonical TOML examples (default, observe-only, opt-in, interpreted agent), rollout stages, and two-level rollback.
- [x] Security guide details unprivileged procfs and `NETLINK_SOCK_DIAG` boundaries, fail-closed policy, warning channel exclusions, final comparison race window, service-only terminal consequence, and automatic canary prerequisites.
- [x] Systemd deployment guide provides target-host qualification commands (`activity_live_linux_pty_tcp_smoke`), complete operator reason interpretation table, observation-only soak runbook, bounded automatic canary runbook, stop criteria, and rollback runbooks.
- [x] Release manager, code standards, and codebase summary align with delivered implementation and operational boundaries.
- [x] Real automatic suspend/resume canary remains an Operations-owned gate with explicit host owner approval, exclusive RTC verification, and bounded wake.

Phase 08 QA evidence records **14/14** boundary checks, **20/20** exercised
idle-suspend scenarios (19 default tests plus the ignored live Linux smoke in
0.74s), **16/16** Chromium tests, and **1606/1606** UI tests; automated paths
used fake suspend outcomes. The real automatic suspend/resume canary remains an
Operations-owned target-host gate. See the [Phase 08 QA report](../plans/reports/qa-260911-1207-phase08-idle-suspend-rollout.md).

### PR-018: Production Idle-Suspend Diagnostics (Phases 01–07)

**Status:** COMPLETE / DONE (2026-09-14). Phases 01–06 delivered the
architecture/schema/security contract, event and audit evidence, pure bundle
correlation engine, and fixed host/API/command/output integration. Phase 07
cross-layer verification, architecture reconciliation, read-only Linux smoke,
documentation, and rollout qualification are complete.

**Product intent:** Preserve bounded, privacy-safe evidence for diagnosing an
idle-suspend incident without adding an observer daemon, terminal-content
logging, telemetry egress, root-cause classifier, automatic upload, policy
change, or alternate suspend authority. `dam-hopper diagnose --json` reads
fixed local sources and writes one atomic local bundle.

**Phase 07 delivery:** `server/tests/idle_suspend_phase07.rs` passes 2/2
deterministic automatic/manual cross-layer tests, including quiet admission and
cancellation, terminal rejection, canonical UUID propagation, and server-audit
correlation. `server/tests/idle_suspend_diagnostics.rs` passes 8/8 deterministic
fault, redaction, bounds, role/EUID, local-API, and atomic-output tests through
six focused modules. The explicitly ignored
`server/tests/idle_suspend_diagnostics_linux_smoke.rs` passes 1/1 with
production read adapters and temporary output; before/after snapshots show no
mutation of host/configuration/audit files, RTC wakealarm content, or API/helper
unit state.

The five-command focused gate recorded 223/223 aggregate executed tests with
zero failures. This is an invocation aggregate, not unique-test coverage, and
no coverage percentage is claimed. Cycle-2 code review approved the delivered
scope at 10.0/10. Complete/partial/fatal CLI semantics, staged rollout, and
rollback boundaries are documented; no real suspend/resume canary is claimed.

**Phase 02 delivery:** `server/src/idle_suspend/event.rs` defines the closed
`IdleSuspendEventEnvelopeV1` model, 14 event types, 26 reason codes, typed
payload validation, strict boot/process identity, UUID v4 action correlation,
and checked producer sequencing. `IdleSuspendEventWriter` appends bounded
mode-`0600` no-follow synchronized JSONL to the fixed diagnostics path and
fails closed on unsafe paths or sequence overflow. `idle_suspend/mod.rs`
re-exports the public event types and writer. The legacy untagged server audit
remains unchanged.

**Phase 03 delivery:** `AppState` constructs one optional writer beside the
diagnostics store and passes it through coordinator startup. The coordinator
emits process startup, automatic/manual attempt, arm, final-check, handoff,
dispatch, outcome, reconciliation, availability-transition, and terminal
rejection events at authoritative state-machine boundaries. One
`AttemptContext` allocates a canonical UUID v4 before `attemptStarted`; the
same UUID is used for semantic `correlationId`, helper protocol-v1
`requestId`, accepted manual responses, and existing manual audit records.
Epochs and revisions remain evidence only. Repeated sampler/status activity is
not logged; semantic write failure is diagnostic best effort and cannot alter
coordinator outcomes or handoff release.
**Phase 04 delivery:** `server/src/idle_suspend/audit.rs` evolves the existing
root audit in place to `HELPER_AUDIT_SCHEMA_VERSION = 2`, adding boot and
producer identity, checked sequence metadata, safely available UUID
correlation, and closed reason/outcome codes. `helper_server.rs` emits typed
`requestRejected`, `capabilityResult`, `preflightResult`,
`rtcProgrammingResult`, and `suspendInvoked` milestones around the existing
`acceptedIntent`/`executionCompleted` action records. The helper binary
initializes one producer identity before binding its socket. Protocol v1 and
the established action record shape remain compatible.
`idle_suspend/mod.rs` re-exports the helper audit record/types, closed code
enums, and schema constant for the server/helper integration surface.

The accepted-intent record is still the only helper pre-action durability gate:
its synchronized write failure prevents RTC/suspend mutation. Other milestone
writes are best effort and cannot rewrite a real backend result. The audit
remains mode `0600`, bounded at 10,000 records, and uses exclusive no-follow
temporary-file pruning with file/directory sync and failure cleanup.

Phase 04 test fixtures cover mixed v1/v2 deserialization, exact milestone
ordering, closed code mapping, sequence-gap/restart behavior, intent and RTC
fail-closed paths, and prune safety without host mutation.

**Phase 05 delivery:** `server/src/linux_release/diagnostics/` now provides the
pure bundle-v1 model, four bounded no-follow JSONL compatibility readers,
source completeness metadata, explicit privacy projection, exact UUID
correlation/gap/restart analysis, and deterministic whole-record reduction to
the 8-MiB serialized bundle cap. Readers preserve valid records around
malformed input, distinguish missing from readable-empty files, and never
compact, repair, truncate, rotate, lock, or write producer files. The
collector recomputes correlations and completeness after reduction. Focused
diagnostics tests pass 16/16; source immutability is verified with fixture
bytes, length, and permission comparisons.

**Phase 06 delivery:** `cli.rs` exposes exactly `dam-hopper diagnose --json`
with required `--json` and no output/window/source/unit/URL/command flags.
`privilege.rs` permits the command for any EUID while preserving existing
mutation boundaries. `collector.rs` composes role-aware fixed systemd,
journal, loopback API, and current-host adapters around the Phase 05 core.
`server`/`both` roles apply server sources; `web` marks them `notApplicable`;
an unknown role remains partial. Non-root collection never escalates and marks
root-only helper audit `permissionDenied`.

`output.rs` writes root bundles under
`/var/lib/dam-hopper-manager/diagnostics`; non-root bundles use absolute
`XDG_STATE_HOME` or `HOME/.local/state`, with no `/tmp` fallback. It requires
an owned non-symlink `0700` directory, creates a same-directory exclusive
no-follow `0600` temporary file, syncs and atomically renames it, then syncs
the directory. The binary prints only the absolute final path after output:
exit `0` means complete, `2` means valid partial, and `1` means fatal
serialization/output failure with no path.

**Acceptance criteria:**

- [x] Phase 01 freezes the event, helper, bundle, path, privacy, durability,
      role, completeness, compatibility, and rollback contracts.
- [x] Phase 02 provides deterministic producer identity/sequence/correlation
      primitives and a bounded synchronized writer without policy coupling.
- [x] Phase 03 integrates lifecycle emission without changing the frozen
      event contract and prevents action-ID collisions across API restarts.
- [x] Phase 04 evolves helper evidence in place with typed milestones,
      producer identity/sequence, protocol/action compatibility, intent
      fail-closed ordering, safe closed codes, and secure pruning.
- [x] Phase 05 implements the pure bounded readers, bundle projection,
      privacy redaction, exact UUID correlation/gap engine, and whole-record
      final-size reduction with source immutability verification.
- [x] Phase 06 implements role-aware host/API/command/probe adapters, the
      exact `diagnose --json` grammar, atomic `0700`/`0600` output, and
      complete/partial/fatal exit semantics.
- [x] Phase 07 performs cross-layer verification, architecture checks, zero-mutation Linux smoke, and controlled rollout.

**Operational boundary:** Event writes are diagnostic best effort after
coordinator integration; they never rewrite a suspend outcome. Existing
manual acceptance audit and helper accepted intent remain the pre-action
durability gates. The collector may claim historical completeness only after
all applicable required sources and gap/coverage gates pass.

The CLI output contract is intentionally separate from the browser
`POST /api/diagnostics/export` flow. No public tuning, alternate source, or
operator-selected output path is part of bundle v1.

### Explorer HTML File Preview (Phases 01–03)

**Status:** Complete 2026-09-12; interactive script and sandbox enhancements
completed 2026-09-13.

**Product intent:** Provide an in-editor HTML preview without a backend static
file server or a second authenticated origin. Keep unsaved editor content live,
retain the existing Monaco/editor lifecycle, and isolate workspace HTML in an
opaque-origin sandbox.

**Functional requirements:**

- Detect final `.html`, `.htm`, and `.xhtml` extensions case-insensitively via
  `isHtmlFile`; exclude dotfiles without a base name and non-preview tiers
  (`diff`, `large`, and `binary`) via `isHtmlPreviewCandidate`.
- Define `HtmlMode` as `"edit" | "split" | "preview"`; persist the mode in
  browser storage under `dam-hopper:html-view-mode:v1`, defaulting to `"edit"`
  when storage is absent, invalid, or unavailable.
- Render `HtmlPreview` from debounced `srcDoc` content (200 ms) in an iframe
  with `sandbox="allow-scripts allow-modals allow-forms allow-popups
allow-pointer-lock"`; omit `allow-same-origin` so content executes with a
  `null` opaque origin and cannot access parent cookies or storage.
- Inject only in-frame runtime shims for the opaque-origin `localStorage` /
  `sessionStorage` errors and suppressed `window.alert()` behavior; do not
  grant parent-page privileges. Provide an explicit reload control.
- Render `HtmlHost` with Edit (100% Monaco), Split (50% Monaco / 50% preview),
  and Preview (100% preview) modes. Lazy-load Monaco, persist mode changes,
  accept `initialMode`, and forward the existing editor callbacks and view
  state.
- Lazy-route HTML tabs in `EditorTabs` before the generic Monaco fallback. Add
  an Explorer `Preview`/`Eye` action only for live HTML files below 5 MiB;
  saving `"preview"` then opens the existing file tab.

**Acceptance criteria:**

- [x] HTML detection, MIME hints, mode persistence, safe storage fallback, and
      event-based live mode synchronization are implemented.
- [x] Preview updates are debounced and reloadable; all iframe sandbox tokens
      are explicit and `allow-same-origin` remains absent.
- [x] Edit/Split/Preview layouts preserve Monaco save, change, view-state, and
      Git indicator callbacks.
- [x] Explorer context-menu preview enforces the 5 MiB live-file boundary and
      does not add backend routes, static serving, or path-resolution behavior.
- [x] Vitest/component/Chromium coverage and TypeScript checks cover helpers,
      host routing, mode changes, sandbox interactions, and non-HTML filtering.

**Changed frontend files:** `packages/ui/src/lib/html-file.ts`,
`html-preview-transform.ts`, `html-view-mode-persistence.ts`,
`components/organisms/HtmlPreview.tsx`, `HtmlHost.tsx`, `EditorTabs.tsx`,
`TreeContextMenu.tsx`, `FileTree.tsx`, and their focused tests.

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

### PDR: System daemon state configuration (Phases 01–02)

**Status:** Complete through Phase 02, 2026-09-14  
**Scope:** Linux release-manager API runtime provisioning and systemd unit policy

Phase 02 binds the template, checked-in unit, rendered policy, and staged API
unit to one canonical `ExecStart` config operand:
`/var/lib/dam-hopper/dam-hopper.toml`. The policy requires exactly one
zero-operand privileged `provision-api-runtime` prestart and exactly one
canonical `ExecStart`; checked-in and staged units must remain synchronized.

#### Product requirement

The production API must have one descriptor-relative, fail-closed authority for
durable configuration and server timing/manual audit state. Runtime startup
must not depend on mutable release assets, recursive path operations, or
operator-owned legacy files being writable by the API.

#### Functional requirements

1. Use `/var/lib/dam-hopper/dam-hopper.toml` as the canonical API registry,
   owned by the final API UID:GID with mode `0600`.
2. Use `/var/lib/dam-hopper/idle-suspend-audit.jsonl` as the server timing and
   manual audit, with the same API ownership and mode `0600`.
3. When canonical config is absent, accept
   `/etc/dam-hopper/dam-hopper.toml` only as a validated, root-owned `0644`,
   read-only, copy-once migration source. Preserve its bytes, inode, and
   metadata; do not synchronize it later.
4. If both config locations are absent, publish the bounded default seed
   `[workspace]\nname = "default"\n`.
5. Create or validate fixed ancestors with exact type, owner, group, and mode:
   `/var` and `/var/lib` are `root:root` `0755`; API state/config directories
   are API-owned `0700`.

#### Non-functional and security requirements

- Walk from the trusted layout root using directory descriptors and no-follow
  operations. Reject symlinks, special files, unsafe metadata, invalid
  UTF-8/TOML, project-path traversal, and content over 64 KiB.
- Stage exact bytes in the fixed exclusive
  `.dam-hopper.toml.provisioning` sibling, synchronize file data, apply final
  metadata, and publish with Linux `renameat2(RENAME_NOREPLACE)`.
- Preserve a concurrent winner and never roll back a canonical file after a
  successful rename. Synchronization errors remain visible to the caller.
- On failure, remove only identity-matching objects created by the same call;
  retain replaced, nonempty, or unidentifiable objects and report cleanup
  failures without exposing content or user-controlled path text.
- Do not create, chmod, chown, truncate, rename, or delete legacy `/etc` files.
  The old `/etc/dam-hopper/idle-suspend-audit.jsonl` is untouched.

#### Acceptance criteria

- A valid canonical file takes precedence over any legacy file and is not
  rewritten.
- A valid legacy file is copied byte-for-byte once and remains unchanged.
- Missing canonical and legacy files produce the exact bounded seed.
- Metadata/content/refusal cases fail before API start; publication races
  preserve the winner and clean only the caller's unpublished temporary file.
- A successful config publication precedes audit creation; audit or directory
  synchronization failures are reported without rollback of published config.
- The ignored Linux diagnostics smoke remains read-only and verifies config,
  audit, RTC, and unit snapshots are unchanged.

Implementation is in `server/src/linux_release/layout.rs`,
`api_runtime.rs`, and `error.rs`; focused behavior is covered by the
`linux_release::api_runtime` tests and
`server/tests/idle_suspend_diagnostics_linux_smoke.rs`. The operational
runbook is [Linux API Runtime Provisioning](./linux-release-runtime-provisioning.md).

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
