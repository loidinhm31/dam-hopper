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

### PR-011: Linux Release Identity, Manager, and Manifest v1

**Status:** Phases 01–02 complete and reviewed (2026-09-03). Phase 01 defines
the release metadata contract; Phase 02 adds the Rust manager's unprivileged
acquisition and root-only role staging. Dedicated web packaging, systemd unit
installation, activation, health checks, rollback, recovery, publisher
bootstrap, and legacy-runner retirement remain later phases.

**Functional Requirements:**

- Publish one immutable `dam-hopper-vX.Y.Z-fedora44-x86_64-systemd.tar.gz`
  archive for Fedora 44 x86_64 systemd.
- Treat protected `vX.Y.Z` as release authority and require stable SemVer plus
  one matching version for `cli`, `api`, `webHost`, and `webAssets`.
- Validate archive size/SHA-256, commit SHA, profile ABI requirements, exact
  role-scoped inventory, API/web service contracts, and the `n-1` rollback
  declaration before extraction.
- Provide the manager grammar: `fetch`, `install`, `role set`, `start`,
  `status`, `rollback`, `recover`, and `version`; `activate` and install-time
  `--api-url` are not part of the contract.
- Resolve `fetch --latest` once to a stable tag, download only the exact
  manifest/archive assets, require archive SHA-256 equality, and optionally
  verify GitHub attestations.
- Require an explicit role on fresh install; inherit a recorded role on
  upgrade; permit role changes only through `role set`. Keep web URL setup in
  the existing client-side server-profile flow.
- Stage only a pending candidate. Do not switch the active release, alter
  active/rollback metadata, install or start units, open listeners, or remove
  current runtime state.

**Acceptance Criteria:**

- [x] Rust `ReleaseManifest` types use camelCase names and deny unknown fields.
- [x] Manifest payloads are bounded at 1 MiB; inventories at 20,000 entries;
  normalized paths at 255 bytes.
- [x] Stable tag/version, component equality, Fedora/systemd profile, archive,
  service, rollback, required-path, role, mode, digest, and file-type rules
  are validated.
- [x] `dam-hopper` Clap grammar and EUID matrix are implemented: non-root
  `fetch`, root mutation commands, and read-only `status`/`version`.
- [x] Platform checks cover Fedora 44, x86_64, glibc >= 2.43, systemd >= 259,
  and an active system manager; exact web origins reject unsafe or duplicate
  values.
- [x] GitHub acquisition uses bounded HTTPS requests and mandatory archive
  SHA-256 verification; attestation remains optional.
- [x] Root staging uses a nonblocking deployment lock, no-follow bundle opens,
  exact manifest inventory inspection, regular-file/directory extraction, role
  projection, and fsync-backed pending metadata.
- [x] Focused release suites pass 45/45 tests across seven suites; scoped
  manager compile/check and review gates pass with no blocking findings.

**Technical Constraints:**

- Keep release constants, version logic, manifest types, inventory validation,
  CLI, acquisition, archive, layout, lock, and staging in focused
  `server/src/linux_release/` modules.
- Target prerequisites are the Fedora profile, public GitHub HTTPS access, and
  systemd; `gh` is optional only for attestation verification.
- Use canonical UTF-8/LF JSON with deterministic field order and no
  credentials, mutable URLs, timestamps, `latest` pointers, or machine-local
  runtime configuration in published assets.
- Treat Rust validation as authoritative for cross-field rules; keep the
  publisher JSON Schema structurally equivalent.
- The API service runs as `root` for this MVP by owner direction; the web
  service remains separately unprivileged. Record this as a critical accepted
  risk rather than a least-privilege recommendation.

See [Linux Release Manifest v1](./linux-release-manifest.md) and [Linux Release
Manager](./linux-release-manager.md).

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

**Decision:** Use Arc<Mutex<T>> for PtySessionManager, FsSubsystem, AgentStoreService.

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
