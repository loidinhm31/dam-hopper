# Technical Report: Backend Specialized Services Deep-Dive

**Scope**: In-depth analysis of 6 backend specialized domains: `advisor`, `agent_status`, `agent_store`, `workflow`, `idle_suspend`, `linux_release`.  
**Date**: 2026-10-05  

---

## 1. Native Evcrate Advisor (`server/src/advisor/`)

### Architecture & Service Contract
- Replaced legacy Linux plugin runner with native Axum endpoints under `/api/advisor/*`.
- Main endpoints:
  - `GET /api/advisor/status`: Subsystem toggle & history root status (accessible even when disabled).
  - `PATCH /api/advisor/settings`: Toggle enable/disable; clears snapshots on disable (64 KiB cap).
  - `POST /api/advisor/history/{refresh,summary,page,detail}`: History inspection, snapshot creation, HMAC cursor pagination (64 KiB cap).
  - `POST /api/advisor/policy/current`: Read active routing policy document (64 KiB cap).
  - `PATCH /api/advisor/policy`: Atomic routing policy update (16 KiB body limit).
  - `POST /api/advisor/models`: Introspect installed models/efforts across backends (16 KiB body limit).
  - `POST /api/advisor/evaluations/{list,read,compare}`: Offline benchmark evaluation review.

### Security Constraints & Invariants
- **Strictly Admin-Only**: Guarded by `auth::require_admin` and `auth::require_auth`.
- **`--no-auth` Forbidden**: `require_admin` middleware strictly rejects all requests if server runs with `--no-auth`, returning `403 Forbidden` (`code: "NoAuthForbidden"`). Admin capabilities cannot run without authenticated actor.
- **Credential Scrubbing**: `check_credentials()` scans configuration objects for sensitive tokens (`api_key`, `secret`, `token`, etc.) and denies operations containing plaintext secrets.
- **Symlink Jail & History Root**: Candidate directory `$HOME/.evcrate/advisor-history` must be a genuine directory inspected with `symlink_metadata()`. Symlinks, missing paths, and files are rejected (`"History root must be a real directory; symlink rejected"`).

### Policy Compare-And-Swap (CAS) & Persistence
- Storage path: `$HOME/.evcrate/advisor-routing.json` (max 16 KiB, mode `0600`).
- Update protocol: Client provides `expected_revision` (SHA-256 hex digest of current file bytes).
- Execution: Mutex `policy_lock` serializes updates. Reads current bytes bounded, verifies SHA-256 against `expected_revision`, mutates JSON, validates route semantics, writes via `crate::fs::secure_path::replace_regular_file_if_bytes_match` enforcing O_NOFOLLOW and byte-match atomic swap. Returns `PolicyRevisionConflict` on mismatch.

### Subprocess Concurrency & Model Catalog
- Harness backends: `omp`, `pi`, `codex`, `claude`. Unknown backends rejected immediately.
- Concurrency semaphore: Bounded `Arc<Semaphore>` allowing max 2 concurrent subprocess invocations.
- Boundaries: 5-second discovery timeout, 5 MiB stdout buffer limit, 1 MiB line buffer limit. Falls back to deterministic static fallback catalog (`HARNESS_DISCOVERY_TIMEOUT`, `HARNESS_NOT_FOUND`, `HARNESS_OUTPUT_LIMIT`).

---

## 2. Agent Status Ingress & Lifecycle (`server/src/agent_status/`)

### Architecture & Service Contract
- Ingress channels:
  1. **WebSocket (`ws://127.0.0.1:<port>/v1/agent-status`)**: Long-lived connection used by OMP TypeScript extension (`omp-agent-status.ts`).
  2. **Unix Domain Socket (`dam-hopper-agent-hooks.sock`, mode 0600)**: Used by native hooks (`Codex`, `Claude`) via `native-agent-status.sh` launcher script.
  3. **HTTP POST (`/v1/agent-hooks`)**: Fallback loopback route for native hooks.
- Query contract: `GET /api/agent-status/v1/snapshot` (returns `AgentStatusSnapshotV1` with monotonic `server_epoch` and `revision`).

### Security Constraints & Invariants
- **Loopback Validation**: WebSocket rejects requests whose `Host` header does not match local loopback port (`127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`).
- **UDS Peer Authentication (`SO_PEERCRED`)**: Linux UDS handler extracts peer credentials. Verifies `peer_cred.uid == libc::geteuid()`. Mismatched UID returns 403.
- **Process Ancestry Verification**: On Linux, `verify_reporter_ancestry` traverses `/proc` upward from UDS peer PID to registered terminal PTY shell root:
  - Matches `starttime_ticks` from `/proc/[pid]/stat` to prevent PID reuse attacks.
  - Verifies unbroken parent-child hierarchy terminating at PTY child root.
  - Rejects nested native agent CLIs (prevents child CLI hijacking parent terminal status).
  - Executes completely lock-free outside runtime mutexes.
- **Admission Rate Limiting**: Per-terminal token-bucket limiter (replenishment rate 20/sec, burst cap 40). Pre-auth connection semaphore capped at 32 concurrent requests.

### Lifecycle States & In-Memory Persistence
- **Agent Execution States**: `Unknown`, `Idle`, `Working`, `Blocked` (reasons: `Approval`, `Question`, `Error`).
- **Turn Outcomes**: `Ended`, `Interrupted`, `Error`, `Unknown`.
- **Terminal Scoped Tokens**: `CredentialState` (`Pending` -> `Active` -> `Revoked`). Auto-revoked if PTY child fails to spawn.
- **Lease Sweeper**: Active connections require heartbeats (default 5s interval, 15s lease expiry). Background task (`start_lease_task`) runs periodically to sweep dead leases.
- **Causal Dedup Queues**: Reducers retain ring buffers (`seen_event_ids`: 512, `retired_turn_ids`: 128, `retired_session_ids`: 32, `retired_native_roots`: 32) to discard late, duplicate, or replayed events.
- **Persistence Boundary**: Ephemeral in-memory registry (`AgentStatusRegistry`); status does not survive server restarts, but clients resync via monotonic `server_epoch` and `revision`.

---

## 3. Symlink-Based Agent Store (`server/src/agent_store/`)

### Architecture & Service Contract
- Central distribution hub managing reusable agent configurations across workspaces and agent harnesses (`claude`, `gemini`, `codex`, `omp`).
- REST endpoints:
  - `/api/agent-store`: CRUD for central items by category.
  - `/api/agent-store/matrix`: Global cross-project installation matrix.
  - `/api/agent-store/ship`: Ship item to target project.
  - `/api/agent-store/unship`: Remove shipped item from project.
  - `/api/agent-store/absorb`: Extract local project asset into central store and replace with symlink.
  - `/api/agent-store/health`: Scan broken symlinks and orphaned installations.
  - `/api/agent-memory/*`: Project-level memory templates and `CLAUDE.md` / `GEMINI.md` management.

### Categories & Agent Topologies
- Item categories: `skills`, `commands`, `hooks`, `mcp-servers`, `subagents`, `memory-templates`.
- Project layouts:
  - Claude: `.claude/skills`, `.claude/commands`, `.claude/hooks`, `.claude/.mcp.json`, `CLAUDE.md`.
  - Gemini: `.gemini/skills`, `.gemini/commands`, `.gemini/hooks`, `.gemini/.mcp.json`, `GEMINI.md`.

### Symlink Distribution & Security Invariants
- **Relative Symlink Preference**: `distributor::ship` uses `pathdiff::diff_paths(&source_path, parent)` to generate portable relative symlinks within project directories, preserving symlink validity across differing mount points or worktrees. Falls back to absolute symlinks only when paths cross filesystem roots.
- **Fail-Closed Target Protection**: If target already exists and is not an exact symlink pointing to the store item, shipping aborts without overwriting unmanaged files.
- **Safe Path Naming**: All operations enforce `assert_safe_name` to prevent directory traversal (`..`, slashes, control chars).
- **Persistence Boundary**: Plain filesystem hierarchy rooted at `store_path` (default `~/.dam-hopper/agent-store/`). Items contain YAML frontmatter parsed on demand.

---

## 4. Workflow Notes, Tasks & Tracking (`server/src/workflow/`)

### Architecture & Service Contract
- Task hierarchy and developer observation tracker linking active PTY terminals, Git worktrees/branches, and agent runs to structured work plans.
- REST endpoints:
  - `/api/workflow/overview`: Dashboard summary of open items, active sessions, and projects.
  - `/api/workflow/items`: Create, update, delete hierarchical work items.
  - `/api/workflow/sessions`: Start/end/abandon sessions; link/unlink external resources.
  - `/api/workflow/notes`: Append rich markdown notes to items or sessions (soft-delete with 7-day retention).
  - `/api/workflow/events`: Keyset-paginated audit trail of lifecycle events.

### Domain Model & Constraints
- **Strict Hierarchy Depth**: Max 3 levels: `Plan` -> `Phase` -> `Task`. Parent kind validation enforces `Plan` -> `Phase` and `Phase` -> `Task`.
- **Item States**: `Backlog`, `Next`, `InProgress`, `Blocked`, `Done`, `Canceled`.
- **Session States**: `Running`, `Ended`, `Abandoned`.
- **Resource Link Types**: `Terminal`, `GitWorktree`, `GitBranch`, `AgentRun`.
- **Input Bounds**: Title max 200 chars; Note body max 8192 bytes (8 KiB); Event payload max 4096 bytes (4 KiB); Keyset pagination limit 50..100.

### Persistence & Concurrency Boundaries
- **SQLite Database**: Stored in primary SQLite database (`dam-hopper.db`) via migration `010_workflow_tracking.sql` with foreign keys and WAL mode.
- **Optimistic Concurrency (CAS)**: Work items support `update_item_cas` checking `expected_updated_at` before mutation, preventing dirty writes between concurrent UI panels.
- **Asynchronous Observation Worker**: `BoundedObservationRecorder` pipes terminal lifecycle events (`TerminalCreated`, `TerminalRestarted`, `TerminalFinalExit`, `TerminalRemoved`) across a bounded `sync_channel(256)`. Background worker reconciles session states without blocking PTY hot paths. Drops are tracked and logged via `DiagnosticStore`.
- **Startup Reconciliation**: `reconcile_terminal_links` runs at startup, reconciling persisted terminal links against live restored PTY sessions and marking orphans as `Detached`.

---

## 5. Idle Suspend & RTC Wakealarm (`server/src/idle_suspend/`)

### Architecture & Service Contract
- Power management subsystem for remote workstations: monitors terminal fleet quiescence, network/process activity, schedules RTC wake alarms, and coordinates machine sleep.
- REST endpoints:
  - `GET /api/system/idle-suspend/v1/status`: Comprehensive status snapshot.
  - `PATCH /api/system/idle-suspend/v1/timing`: Update `quiet_period_seconds` and `wake_after_seconds` (16 KiB limit).
  - `POST /api/system/idle-suspend/v1/force-suspend`: Trigger immediate manual machine sleep (16 KiB limit).
  - **Mutation Lockout**: `PUT /api/config` strictly denies inline mutation of `idle_suspend` settings; timing updates must use the dedicated endpoint.

### Quiescence Detection & Activity Sampler
- Monitored signals:
  1. **PTY Fleet Quiescence**: Monitored via `PtySessionManager`. Fleet must be completely empty or all sessions inactive.
  2. **Agent Activity Sampler (`activity/`)**: Netlink and TCP socket diagnostics (`tcp_info`) detect in-flight socket traffic. Process sampler scans `/proc` for configured agent executables.
  3. **Systemd Inhibitors**: `preflight.rs` parses `systemd-inhibit --list` to detect external sleep inhibitors.

### Privileged Helper Socket IPC & Peer Authentication
- Communication with root helper daemon `dam-hopper-idle-suspend-helper` over Unix domain socket.
- Protocol: Framed binary protocol (`MAX_HELPER_FRAME_BYTES = 64 KiB`, protocol version 1).
- **Peer Authentication (`peer_auth.rs`)**: Root helper extracts `SO_PEERCRED` on each connection:
  - Enforces `EnrolledPeerPolicy`: Peer UID must match unprivileged server UID.
  - Peer PID must match enrolled `MainPID` (or PID recorded in `/run/dam-hopper/server.pid`).
  - Rejects untrusted callers before processing command frames.

### Coordinator State Machine
- Monotonic progression:
  `Disabled` -> `Watching` -> `Armed` (countdown running) -> `FinalCheck` (re-verifying generation) -> `HandedOff` (helper executing sleep with RTC alarm) -> `Resumed` (machine woken).
- Alternate terminal/divergent states: `Suppressed` (inhibitor/active fleet), `Failed`.

### Persistence Boundaries
- **Timing Store**: `IdleSuspendTimingStore` writes overrides atomically to canonical registry TOML using `toml_edit` and `atomic_write`.
- **Event Audit**: Appends structured events to `DEFAULT_IDLE_SUSPEND_EVENTS_PATH` (JSONL).
- **Audit Trails**: Separate memory and disk audit records for manual force-suspend operations and timing patches.

---

## 6. Linux Release Manager & Rollback Engine (`server/src/linux_release/`)

### Architecture & Service Contract
- Host deployment daemon for Fedora 44 systemd target (`dam-hopper-manager`).
- Coordinates atomic service cutovers across 4 systemd units:
  - `dam-hopper-api.service`
  - `dam-hopper-web.service`
  - `dam-hopper-idle-suspend-helper.service`
  - `dam-hopper-recovery.service`
  - (and legacy `dam-hopper.service` during migrations)

### State Envelope & Persistence
- Authoritative state file: `/var/lib/dam-hopper-manager/state.json` (mode `0600`, max 512 KiB).
- Monotonic generation increments on every durable transaction boundary.
- File lock: Exclusive `DeploymentLock` (`flock` on `/var/lib/dam-hopper-manager/deploy.lock`).
- Managed state records:
  - `active`: Currently running release (tag, digests, units sha256).
  - `previous`: Last known good release available for instant rollback.
  - `pending`: Staged candidate release awaiting activation.
  - `transaction`: In-flight transition details for crash recovery.
  - `latest_failure`: Last observed failure cause and timestamp.

### Transaction Lifecycle & Phased State Machine
```
Staged -> Quiesced -> Switched -> Probing -> Committed
   |          |          |          |
   +----------+----------+----------+-----> RollingBack -> RolledBack | Failed
```
1. **Staged**: Release archive unpacked to `/var/lib/dam-hopper/releases/<tag>/<role>`, manifest validated, SHA-256 digests verified, candidate systemd units rendered.
2. **Quiesced**: Existing services stopped or prepared for switch. Unit files backed up to `/var/lib/dam-hopper-manager/transactions/<tx_id>/units-backup`.
3. **Switched**: Atomic symlinks flipped (`current` symlink updated), new systemd unit files installed to `/etc/systemd/system/`, `systemctl daemon-reload` executed.
4. **Probing**: Services started (`dam-hopper-api.service`, `dam-hopper-web.service`). Health stability engine probes `GET /api/health` requiring consecutive successes within `DEFAULT_STARTUP_DEADLINE` (30s) at `DEFAULT_PROBE_INTERVAL` (500ms).
5. **Committed**: Health checks passed. Units enabled for reboot autostart. `pending` promoted to `active`; old `active` demoted to `previous`. Transaction cleared.

### Automatic Rollback Invariants
- If health probing fails, times out, or services crash during `Switched`/`Probing`:
  1. Transaction marks phase `RollingBack`.
  2. Stops failed units immediately.
  3. Restores original systemd unit files from `units_backup_dir`.
  4. Restores symlinks to `previous` release.
  5. Reloads systemd daemon and restarts previous units.
  6. Probes previous release health to ensure host stability.
  7. Records failure diagnosis in `state.latest_failure` and marks transaction `RolledBack`.

---

## 7. Architectural Cross-Cutting Comparison

| Dimension | Advisor | Agent Status | Agent Store | Workflow | Idle Suspend | Linux Release |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Primary Ingress** | REST (Axum) | WebSocket + UDS + HTTP | REST (Axum) | REST (Axum) | REST (Axum) | CLI + Systemd Daemon |
| **Auth / Security** | Admin-only, `--no-auth` blocked | Peer UID (`SO_PEERCRED`), /proc ancestry | Path validation, unmanaged guard | Bearer session / actor | Peer UID/PID (`SO_PEERCRED`), config lockout | Root/systemd privileges, flock |
| **Worker Concurrency**| 2-permit Semaphore | Lease sweep task, background UDS | Request synchronous | Non-blocking `sync_channel(256)` worker | Quiescence watcher loop | Sequential activation pipeline |
| **Persistence** | File CAS (`advisor-routing.json`) | In-memory registry (ephemeral) | Filesystem (`store_path`) | SQLite (`010_workflow_tracking.sql`) | TOML registry + JSONL events | Durable JSON (`state.json`) + flock |
| **Failure Recovery** | Return error; no state corruption | Monotonic epoch/rev; client resyncs | Fail-closed; no overwrite | CAS rollback; drop diagnostics | State suppression; resume notification | Phased journal + automatic rollback |

---

## Unresolved Questions
1. *None.* All 6 service contracts, background workers, security constraints, and persistence boundaries are fully implemented, verified in codebase, and documented.
