# Codebase Scout Report: Native Advisor, Workflow/Persistence, and Release Subsystems

**Date:** 2026-10-05  
**Scout Target Scope:** `server/src/advisor/`, `server/src/workflow/`, `server/src/persistence/`, `server/src/agent_store/`, `server/src/linux_release/`, `server/src/linux_release_windows.rs`, `server/src/bin/`, `server/src/browser_debug/`, `server/src/api/workflow/`, `deploy/`, `.github/workflows/`, `Dockerfile`  
**Docs Inventory Source:** `plans/reports/context-261005-1653-docs-inventory.json`  

---

## 1. Executive Summary & Scope Overview

This report documents the architectural facts, runtime flows, API contracts, deployment specifications, and retirement boundaries across the DamHopper Native Advisor, Workflow Engine, Persistence Layer, Linux Release & Daemon Manager, and Cross-Platform Packaging pipelines.

### Primary Architectural Transitions Identified:
1. **Complete Retirement of Plugin Platform:** The legacy Node.js plugin runner daemon (`dam-hopper-plugin-runner`), Unix domain socket (`/run/dam-hopper/plugin-runner.sock`), plugin registry (`/var/lib/dam-hopper-plugin-runner`), and `@dam-hopper/plugin-sdk` iframe architecture have been retired and removed. Advisor now runs as a native Rust subsystem (`server/src/advisor/`) exposed via authenticated Axum REST routes and rendered natively in React (`AdvisorPanel.tsx`). An audited migration script (`deploy/remove-plugin-platform.sh`) exists for purging runner remains on Linux hosts.
2. **Native Advisor Contract:** History discovery reads directly from `$HOME/.evcrate/advisor-history` without custom path registration or path-hash admission. Symlinks on the final history root component are strictly rejected. Account routing policies (`$HOME/.evcrate/advisor-routing.json`) are updated with CAS concurrency controls, SHA-256 revision verification, and atomic file replacement (`O_NOFOLLOW`, mode `0600`). Model catalogs are introspected directly from CLIs (`omp`, `pi`, `codex`, `claude`) using bounded subprocess execution with fallback catalogs.
3. **Workflow Continuity & Unified SQLite Persistence:** `WorkflowService` (`server/src/workflow/`) manages workspaces, work items (plans/phases/tasks), sessions, resource links, notes, and activity events. Backed by `rusqlite` SQLite storage running migrations 001–010 (`010_workflow_tracking.sql`). Integrates non-blocking PTY session observation via bounded channels.
4. **Fedora 44 / Linux Release Architecture:** Releases follow schema v2 `release-manifest.json` and manager state schema v3 (`state.json`). Binaries are packaged deterministically into tar.gz with SPDX 2.3 SBOM. The release manager CLI `dam-hopper` supervises 4 core systemd units (`dam-hopper-api`, `dam-hopper-web`, `dam-hopper-recovery`, `dam-hopper-idle-suspend-helper`), orchestrates atomic directory swaps for legacy Format 2 migrations, and provisions API runtime permissions via `dam-hopper provision-api-runtime`.
5. **Windows Packaging:** Portable Windows facade (`server/src/linux_release_windows.rs`) and deterministic ZIP packager (`build-windows-release-archive.mjs`) bundling 4 root files (`dam-hopper-server.exe`, `dam-hopper.example.toml`, `LICENSE`, `README.md`) deployed via non-admin PowerShell installer (`dam-hopper-install.ps1`).

---

## 2. Directory & Symbol Map

### 2.1 Native Advisor Subsystem (`server/src/advisor/`)
- `mod.rs`: Re-exports domain symbols, `AdvisorError`, and `AdvisorService`.
- `status.rs`:
  - `inspect_history_root(enabled: bool, home_override: Option<&Path>) -> AdvisorStatusDto`: Inspects `$HOME/.evcrate/advisor-history`. Rejects symlink roots (`symlink_metadata`).
- `policy.rs`:
  - `MAX_POLICY_BYTES: u64 = 16 * 1024` (16 KiB limit).
  - `ENABLED_BACKENDS: &[&str] = &["claude", "codex", "pi", "omp"]`.
  - `PolicyRouteTargetDto`, `PolicyAdvisorDto`, `PolicyUpdateParamsDto`, `PolicyDocumentV2Dto`, `PolicyReadCurrentResultDto`.
  - `check_credentials(val: &Value) -> bool`: Recursively rejects API keys/secrets/tokens.
  - `is_valid_revision(rev: &str) -> bool`: Enforces 64-char lowercase hex SHA-256.
  - `is_valid_effort_for_backend(backend: &str, effort: &str) -> bool`: Checks allowed reasoning efforts per harness.
  - `validate_route_target(route: &PolicyRouteTargetDto) -> Result<...>`: Validates lengths, chars, and backend requirements.
  - `validate_policy_value(val: &Value) -> Result<PolicyDocumentV2Dto, (String, String)>`: Validates version == 2, `primary != backup`, wait settings.
  - `read_current_policy(home_override: Option<&Path>) -> PolicyReadCurrentResultDto`: Reads `$HOME/.evcrate/advisor-routing.json`.
  - `update_current_policy(home_override: Option<&Path>, params: PolicyUpdateParamsDto) -> Result<...>`: Atomic CAS update via `crate::fs::secure_path::replace_regular_file_if_bytes_match`.
- `models.rs`:
  - Limits: `MAX_DISCOVERY_STDOUT_BYTES = 5 MiB`, `MAX_LINE_BYTES = 1 MiB`, `MAX_NORMALIZED_MODELS = 500`, `MAX_ID_LABEL_BYTES = 256`, `MAX_RESPONSE_BYTES = 256 KiB`, `DISCOVERY_TIMEOUT_SECS = 5`.
  - `AdvisorBackend`: Enum (`Omp`, `Codex`, `Claude`, `Pi`).
  - `HarnessModelService`: 2-permit concurrency semaphore, executes:
    - OMP: `omp models ls --json --no-extensions`
    - Pi: `pi --offline --list-models --no-extensions`
    - Codex: `codex app-server --listen stdio://` (JSON-RPC `initialize`, `model/list`)
    - Claude: `claude --input-format stream-json --output-format stream-json ...` (`advisor-models-init`)
  - `fallback_catalog(backend: &str)`: Provides hardcoded defaults when discovery is unavailable.
- `history.rs`:
  - `AdvisorService`: Struct managing `home_dir`, `cache: Mutex<SnapshotCache>`, `policy_lock: Arc<Mutex<()>>`, and `model_service`.
  - Methods: `status()`, `discover_models()`, `read_current_policy()`, `update_policy()`, `refresh()`, `summary()`, `page()`, `detail()`, `list_evaluations()`, `read_evaluation()`, `compare_evaluations()`, `clear_snapshots()`.
- `history_scan.rs`:
  - `MAX_EXECUTION_HISTORY_BYTES: u64 = 4 MiB`, `MAX_OUTCOME_HISTORY_BYTES: u64 = 2 MiB`.
  - `scan_history_records()`: Walks `$HOME/.evcrate/advisor-history/<project_id>/<task_run_id>/<consultation_id>/` reading execution and outcome JSONs.
- `snapshots.rs`:
  - `SnapshotCache`: Manages user-isolated in-memory query snapshots with HMAC-signed continuation cursors.
- `evaluations.rs` & `evaluation_comparison.rs`:
  - `MAX_EVALUATION_BYTES: u64 = 8 MiB`, `MAX_COMPARE_PAGE_BYTES: usize = 1 MiB`.
  - Reads descriptors and runs evaluation comparisons from `$HOME/.evcrate/advisor-evaluations`, `$HOME/.evcrate/evaluations`, and `<project>/tests/fixtures/advisor-evaluations`.
- `types.rs`: All shared Advisor DTOs and normalized internal structures.
- `error.rs`: `AdvisorError` enum (`Disabled`, `NotFound`, `PolicyValidation`, `PolicyRevisionConflict`, `PolicyWriteFailed`, etc.).

### 2.2 Workflow & Persistence Subsystems
#### `server/src/workflow/`
- `mod.rs`: Re-exports domain symbols.
  - Quotas: `MAX_TITLE_CHARS = 200`, `MAX_NOTE_BYTES = 8192`, `MAX_EXTERNAL_ID_CHARS = 200`, `MAX_EVENT_PAYLOAD_BYTES = 4096`, `MAX_HARNESS_LABEL_CHARS = 64`, `MAX_RUN_ID_CHARS = 128`, `MAX_OVERVIEW_PROJECTS = 100`, `MAX_OVERVIEW_ITEMS = 500`, `MAX_OVERVIEW_SESSIONS = 100`, `MAX_HIERARCHY_DEPTH = 3`, `DEFAULT_HISTORY_LIMIT = 50`, `MAX_HISTORY_LIMIT = 100`.
- `service.rs`:
  - `WorkflowService`: Encapsulates `store: WorkflowStore`, `config: Arc<RwLock<DamHopperConfig>>`, `resolver: WorkspaceTargetResolver`, `workspace_guard`, `pty_manager: PtySessionManager`, `diagnostics: DiagnosticStore`.
  - Methods: `scope()`, `workspace()`, `resolve_target()`, `store_call()`, `record_operation()`.
- `store/`:
  - `WorkflowStore`: Wraps `conn: Arc<Mutex<rusqlite::Connection>>`.
  - `item.rs`: Plan, Phase, Task CRUD with depth <= 3 validation and sort ordering.
  - `session.rs`: Workflow session lifecycle (`active`, `ended`, `abandoned`), resource links (terminal, agent).
  - `note.rs`: Soft-delete notes (`deleted_at`), 7-day retention grace period.
  - `event.rs`: Keyset cursor paginated activity log.
  - `overview.rs`: Compact dashboard aggregation query.
- `observation.rs` & `reconcile.rs`:
  - Bounded PTY observation listener (`try_send` into `sync_channel(256)`). Reconciles terminal session health (`attached`, `detached`, `stale`, `exited`, `crashed`) without terminal payload ingestion.

#### `server/src/persistence/`
- `mod.rs`:
  - `SessionStore`: Manages terminal session metadata, buffer persistence, and port allocations.
  - Runs automatic idempotent SQLite migrations (001–010). Sets Unix mode `0600` on creation.
- `migrations/`:
  - `001_initial.sql` to `009_session_name.sql`: Core session state, ports, worktree paths, incarnations.
  - `010_workflow_tracking.sql`: Tables `workflow_workspaces`, `workflow_items`, `workflow_sessions`, `workflow_resource_links`, `workflow_notes`, `workflow_events`.
- `restore.rs`: Session state restoration on server startup.
- `worker.rs`: `PersistWorker` background write queue.

#### `server/src/api/workflow/`
- `mod.rs`: `overview()`, `events()` handlers.
- `item.rs`: `create_item()`, `update_item()`, `delete_item()` (optimistic CAS on `updatedAt`).
- `session.rs`: `create_session()`, `end_session()`, `abandon_session()`, `add_link()`, `remove_link()`.
- `note.rs`: `create_note()`, `delete_note()`.
- `purge.rs`: `purge_history()`.
- `cursor.rs`: Base64 keyset cursor serialization `(recorded_at, id)`.
- `dto.rs` & `mapping.rs`: REST DTO definitions.

### 2.3 Agent Store Subsystem (`server/src/agent_store/`)
- `schema.rs`:
  - `AgentType`: `Claude`, `Gemini`.
  - `AgentItemCategory`: `Skill`, `Command`, `Hook`, `McpServer`, `Subagent`, `MemoryTemplate`.
  - `DistributionMethod`: `Symlink`, `Copy`.
- `store.rs`: `AgentStoreService`: CRUD for workspace agent items.
- `scanner.rs`: Scans workspace project roots for configured agent structures and broken symlinks.
- `distributor.rs`: Deploys items into target project configurations (`.claude/`, `.gemini/`).
- `importer.rs`: Validates and imports agent items from URLs/repositories.
- `memory.rs`: Handlebars-based prompt/memory templating.

### 2.4 Browser Debug Subsystem (`server/src/browser_debug/`)
- `mod.rs`:
  - Limits: `MAX_SELECTION_JSON_BYTES = 64 KiB`, `MAX_PNG_BYTES = 4 MiB`, `ARTIFACT_TTL_MS = 600,000` (10 min).
  - `BrowserSelectionV1`, `BrowserSelectionBoundsV1`, `BrowserDebugArtifactResponse`.
  - `terminal_reference()`: Constructs sanitized reference string for terminal insertion, stripping CSI and OSC terminal control sequences to prevent ANSI injection.
- `store.rs`: `BrowserDebugArtifactManager`: In-memory temporary cache with TTL eviction.

### 2.5 Release Binaries (`server/src/bin/` & `server/src/main.rs`)
- `server/src/main.rs`: `dam-hopper-server`: Core API, WebSocket, PTY manager, and web server. Default port 4801 (standalone 4800).
- `dam-hopper.rs`: Linux release manager CLI (`dam-hopper fetch/install/role/start/stop/status/rollback/recover/validate/version/diagnose/provision-api-runtime`). Packaged as `dam-hopper-manager` in release archives.
- `dam-hopper-web.rs`: Dedicated static SPA file host. Default port 4802.
- `dam-hopper-idle-suspend-helper.rs`: Privileged helper daemon communicating over `/run/dam-hopper/idle-suspend.sock` for RTC wakealarm programming and logind host suspend.

### 2.6 Linux Release & Daemon Manager (`server/src/linux_release/` & `server/src/linux_release_windows.rs`)
- `server/src/linux_release_windows.rs`:
  - Windows compilation facade exporting `ReleaseError`, `validate_web_origin`, `validate_web_origins`, `validate_commit_sha`, `validate_release_tag`, `validate_sha256_hex`, `validate_version`, `TargetRole`, `HostPublicConfig`.
- `server/src/linux_release/`:
  - `constants.rs`:
    - `RELEASE_MANIFEST_SCHEMA_VERSION = 2`
    - `MANAGER_STATE_SCHEMA_VERSION = 3`
    - `PROFILE_ID = "linux-x86_64-systemd"`
    - Units: `dam-hopper-api.service`, `dam-hopper-web.service`, `dam-hopper-recovery.service`, `dam-hopper-idle-suspend-helper.service`, `dam-hopper-idle-suspend-helper.socket`.
    - Retired constants kept for migration verification: `RUNNER_SERVICE_UNIT`, `RUNNER_TMPFILES_CONF`, `DEFAULT_RUNNER_SOCKET_PATH`, `DEFAULT_RUNNER_STATE_DIR`, `PLUGIN_SHARED_GROUP`.
  - `layout.rs`: Canonical filesystem layout:
    - Root: `/opt/dam-hopper`
    - Data/Config: `/var/lib/dam-hopper` (`dam-hopper.toml`, mode `0700` / `0600`)
    - Manager State: `/var/lib/dam-hopper-manager/state.json` (mode `0700` / `0600`)
    - Public Host Config: `/etc/dam-hopper/host-config.json` (mode `0644`)
    - Runtime: `/run/dam-hopper`
    - Units: `/etc/systemd/system`
  - `api_runtime.rs`: `provision_installed_api_runtime()`: Enforces ownership (`dam-hopper:dam-hopper`), directory modes (`0700`), file modes (`0600`), and migrates legacy `/etc/dam-hopper/dam-hopper.toml` if `/var/lib/dam-hopper/dam-hopper.toml` is absent.
  - `legacy_format2.rs`, `migration.rs`: Identifies legacy installations (marked by `.systemd-fresh-install/manifest`), verifies binary/unit hashes, creates sibling staging directory on the same filesystem device, and executes atomic exchange rollback/commit.
  - `state.rs`, `state_record.rs`: Manager state transitions (`Staged` -> `Quiesced` -> `Switched` -> `Probing` -> `Committed`).

### 2.7 Deployment Scripts, Release Tooling & CI
- `deploy/remove-plugin-platform.sh`: Audited, safe removal tool for retired plugin runner systemd units, tmpfiles, socket, state directory, and dedicated user/group (`dam-hopper-plugin-runner` / `dam-hopper-plugins`).
- `deploy/reset-linux-production.sh`: Rollback tool for idle-suspend helper.
- `deploy/run-linux-nohup.sh`: Non-systemd user-level daemon wrapper using nohup under `$HOME/.config/dam-hopper`.
- `deploy/release/build-release-archive.sh`: Assembles `dam-hopper-vX.Y.Z-linux-x86_64-systemd.tar.gz`. Normalizes timestamps (`SOURCE_DATE_EPOCH`), owners (0:0), and permissions.
- `deploy/release/generate-release-manifest.mjs`: Emits schema v2 `release-manifest.json` and SPDX 2.3 SBOM.
- `deploy/release/build-windows-release-archive.mjs`: Creates deterministic `dam-hopper-vX.Y.Z-windows-x86_64.zip` with 4 required root members.
- `deploy/release/check-release-assets.mjs`: Strict release asset verification gate (`--profile linux`, `windows`, `all`).
- `deploy/release/dam-hopper-install.sh`: Linux non-root bootstrap installer.
- `deploy/release/dam-hopper-install.ps1`: Windows non-admin PowerShell bootstrap installer.
- `.github/workflows/release-linux.yml`: CI pipeline for building Linux and Windows releases, running double-packaging reproducibility checks, generating GitHub provenance attestations, and publishing releases.
- `Dockerfile`: Multi-stage build producing minimal Debian Bookworm runtime image.

---

## 3. Runtime & Data Flow

### 3.1 Native Advisor Data Flow & Invariants
```
[Admin User (React UI)]
       │
       ▼ (REST API: /api/advisor/* [Bearer/Cookie Auth + require_admin])
[Axum Router: server/src/api/advisor.rs]
       │
       ▼ (Check state.config.server.advisor.enabled)
[AdvisorService: server/src/advisor/history.rs]
 ┌─────┴─────────────────────────┬────────────────────────────┐
 │ (History & Evaluations)       │ (Routing Policy CAS)       │ (Harness Introspection)
 ▼                               ▼                            ▼
$HOME/.evcrate/advisor-history/  $HOME/.evcrate/              tokio::process::Command
  - Direct directory walk          advisor-routing.json         - omp / pi / codex / claude
  - Symlinks REJECTED              - O_NOFOLLOW, mode 0600      - 2-permit Semaphore
  - Memory snapshot cache          - expectedRevision check     - 5s Timeout, 5 MiB stdout
  - Keyset pagination (HMAC)       - Atomic rename swap         - Fallback catalog on error
```
- **Invariants:**
  1. Status and setting endpoints (`GET /api/advisor/status`, `PATCH /api/advisor/settings`) are accessible to admins even when Advisor is disabled.
  2. All data endpoints return HTTP 403 `ADVISOR_DISABLED` if `server.advisor.enabled = false`.
  3. Symlinks on `$HOME/.evcrate/advisor-history` immediately mark history unavailable (`History root must be a real directory; symlink rejected`).
  4. Routing updates must match on-disk SHA-256 (`expectedRevision`), version must equal 2, credentials in policy JSON trigger immediate 400 rejection, and primary/backup targets cannot be identical.

### 3.2 Workflow Tracking & Observation Data Flow
```
[PTY Session Activity]                     [Web Client / REST API]
       │                                              │
       ▼ (Non-blocking try_send)                      ▼
sync_channel(256)                          /api/workflow/* (Auth Required)
       │                                              │
       ▼                                              ▼
[Observation Reconciler Worker] ──────────► [WorkflowService / Store]
       │ (State transitions only:                     │
       │  attached, detached, exited, crashed)        ▼
                                            [SQLite: SQLite DB]
                                            (workflow_items, workflow_sessions,
                                             workflow_notes, workflow_events)
```
- **Invariants:**
  1. PTY observation never captures or persists terminal I/O, keystrokes, environment variables, or prompts.
  2. Workflow hierarchy is capped at 3 levels (`Plan` -> `Phase` -> `Task`).
  3. Deletes and updates require optimistic timestamp CAS (`updatedAt`).
  4. Events are keyset paginated via Base64-encoded `(recorded_at, id)` cursors.

### 3.3 Linux Release Lifecycle, State Machine & API Runtime Provisioning
```
1. Fetch (Non-root):
   dam-hopper fetch --tag vX.Y.Z ──► Download .tar.gz + manifest + attestation to unprivileged dir.

2. Install / Stage (Root):
   dam-hopper install --bundle <dir> --role server|web|both
       │
       ▼
   Extract candidate into /var/lib/dam-hopper-manager/staged/<tx_id>/
   Record PendingCandidateRecord in /var/lib/dam-hopper-manager/state.json

3. Activation (Root):
   dam-hopper start
       │
       ├─► Preflight: Check ports 4801/4802, resolve service user identities
       ├─► Quiesce: Stop active services
       ├─► Switch: Swap symlink /opt/dam-hopper/current ──► staged directory
       ├─► Unit Installation: Copy units to /etc/systemd/system/ && systemctl daemon-reload
       ├─► Probe: Start services, poll /api/health and /__dam-hopper/health
       └─► Commit: Update state.json active=candidate, cleanup previous transaction
```
- **Privileged Pre-start Hook (`ExecStartPre`):**
  - `dam-hopper-api.service` executes `+<path>/dam-hopper-manager provision-api-runtime`.
  - Validates and creates `/var/lib/dam-hopper` directories with mode `0700` owned by `dam-hopper`.
  - Ensures `/var/lib/dam-hopper/dam-hopper.toml` exists with mode `0600`.
  - Never mutates existing valid configuration.

### 3.4 Windows Release Packaging & Bootstrapping
- `build-windows-release-archive.mjs` generates a deterministic ZIP containing:
  - `dam-hopper-server.exe`
  - `dam-hopper.example.toml`
  - `LICENSE`
  - `README.md`
- `dam-hopper-install.ps1` runs in user context without elevation:
  - Downloads and verifies SHA-256 digest against release manifest or metadata.
  - Extracts files into `%LOCALAPPDATA%\Programs\dam-hopper`.
  - Optionally appends bin directory to User `PATH`.
  - Does NOT register system services or launch the server automatically.

### 3.5 Docker Runtime Flow
- Stage 1 (`server-builder`): Rust 1.97.1 Bookworm, compiles `dam-hopper-server`, `dam-hopper`, `dam-hopper-web`, `dam-hopper-idle-suspend-helper` with `--features vendored` (statically linking libgit2 and OpenSSL).
- Stage 2 (`web-builder`): Node 20-slim, pnpm 10 frozen install, builds `@dam-hopper/web` SPA into `apps/web/dist`.
- Stage 3 (`runtime`): Debian Bookworm slim, copies server binary to `/usr/local/bin/dam-hopper-server` and web dist to `/opt/dam-hopper/web`. Exposes port 4800.

---

## 4. Authoritative Commands, Config & Contracts

### 4.1 CLI Commands & Binaries

| Binary / Command | Arguments / Flags | Authority & Context |
|---|---|---|
| `dam-hopper fetch` | `--tag <vX.Y.Z> --output <dir> [--verify-attestation]` | Unprivileged (non-root) release acquisition. |
| `dam-hopper install` | `--bundle <dir> [--role server\|web\|both] [--service-user <user>] [--reinstall]` | Root-only staging into manager transaction directory. |
| `dam-hopper role set` | `--bundle <dir> --role <role> [--service-user <user>]` | Root-only role projection switch. |
| `dam-hopper start` | `[--timeout <secs>] [--skip-health]` | Root-only systemd activation, symlink cutover, and health probing. |
| `dam-hopper stop` | `[--clean]` | Root-only graceful shutdown of managed units. |
| `dam-hopper status` | `[--json]` | Read-only state inspection (EUID 0 or non-root). |
| `dam-hopper rollback` | none | Root-only reversion to `state.previous` release. |
| `dam-hopper recover` | `[--boot]` | Root-only crash recovery / boot-time reconciliation. |
| `dam-hopper validate` | `--manifest <file> [--archive <file>]` | Validates release manifest schema v2 and archive inventory. |
| `dam-hopper diagnose` | none | Bounded host diagnostic inspection. |
| `dam-hopper provision-api-runtime` | none | Root-only internal command run by `ExecStartPre` of `dam-hopper-api.service`. |
| `dam-hopper-web` | `--root <dir> [--host <ip>] [--port <port>]` | Dedicated static web server (default `0.0.0.0:4802`). |
| `dam-hopper-idle-suspend-helper` | `--socket <path> --audit-file <path> [--enrolled-uid <uid>]` | Privileged logind suspend helper daemon. |
| `dam-hopper-server` | `--config <path> [--host <ip>] [--port <port>] [--web-dir <dir>]` | Main application server daemon. |

### 4.2 Configuration Files & Schema

1. **Server Configuration (`/var/lib/dam-hopper/dam-hopper.toml`):**
   ```toml
   [server]
   host = "0.0.0.0"
   port = 4801

   [server.advisor]
   enabled = false  # Default false; toggled via PATCH /api/advisor/settings
   ```
2. **Public Host Config (`/etc/dam-hopper/host-config.json`):**
   ```json
   {
     "role": "both",
     "allowedWebOrigins": ["http://localhost:4802"],
     "serviceUser": "dam-hopper"
   }
   ```
3. **Manager State (`/var/lib/dam-hopper-manager/state.json` - Schema v3):**
   ```json
   {
     "schemaVersion": 3,
     "active": { "tag": "v0.10.2", "role": "both", "releasePath": "/opt/dam-hopper/releases/v0.10.2", ... },
     "previous": { ... },
     "pending": null,
     "transaction": null,
     "latestFailure": null
   }
   ```
4. **Advisor Routing Policy (`$HOME/.evcrate/advisor-routing.json` - Version 2):**
   ```json
   {
     "version": 2,
     "advisor": {
       "primary": { "backend": "codex", "model": "gpt-6.1-sol", "effort": "high" },
       "backup": { "backend": "claude", "model": "sonnet", "effort": "medium" }
     },
     "wait": { "mode": "until_terminal", "warn_after_ms": 10000, "warn_every_ms": 30000 },
     "history": { "retention_days": 30, "max_bytes": 104857600 }
   }
   ```

### 4.3 REST API Contracts (Advisor & Workflow)

| Method & Path | Auth / Role | Body Limit | Success Status & Payload Summary | Error Codes |
|---|---|---|---|---|
| `GET /api/advisor/status` | Admin | N/A | `200`: `{ enabled, available, path, sourceError }` | `403 NoAuthForbidden` |
| `PATCH /api/advisor/settings` | Admin | 64 KiB | `200`: `{ enabled }` | `403 NoAuthForbidden` |
| `POST /api/advisor/policy/current` | Admin + Enabled | 64 KiB | `200`: `{ status, revision, policy, ... }` | `403 ADVISOR_DISABLED`, `400 POLICY_FILE_UNSAFE` |
| `PATCH /api/advisor/policy` | Admin + Enabled | 16 KiB | `200`: `{ status, revision, policy }` | `409 POLICY_REVISION_CONFLICT`, `400 ROUTE_ENTRY_INVALID`, `400 ROUTE_CREDENTIAL_FIELD`, `413 Payload Too Large` |
| `POST /api/advisor/models` | Admin + Enabled | 16 KiB | `200`: `{ backend, models, efforts, source }` | `400` (unsupported backend), `200` with `source: fallback` on discovery timeout/failure |
| `POST /api/advisor/history/refresh` | Admin + Enabled | 64 KiB | `200`: `{ state, snapshotId, scan, inventory }` | `403 ADVISOR_DISABLED` |
| `POST /api/advisor/history/page` | Admin + Enabled | 64 KiB | `200`: `{ state, snapshotId, entries, nextCursor }` | `400` (invalid cursor/query) |
| `POST /api/advisor/evaluations/compare` | Admin + Enabled | 64 KiB | `200`: `{ status, groups, returnedBytes }` | `400` (>32 items or invalid refs) |
| `GET /api/workflow/overview` | Authenticated | N/A | `200`: `{ workspace, items, sessions, counts }` | `503 StoreUnavailable` |
| `GET /api/workflow/events` | Authenticated | N/A | `200`: `{ events, nextCursor }` | Keyset pagination `(recorded_at, id)` |
| `POST /api/workflow/items` | Authenticated | 64 KiB | `201`: `WorkflowItemDto` | `400 LimitExceeded` (depth > 3) |
| `PATCH /api/workflow/items/{id}` | Authenticated | 64 KiB | `200`: `WorkflowItemDto` | `409 Conflict` (updatedAt mismatch) |

---

## 5. Product Capabilities & Limits

### 5.1 Hard Boundaries & Quotas
- **Advisor Subsystem:**
  - Policy file and payload: `MAX_POLICY_BYTES = 16 KiB`.
  - Model discovery subprocess stdout: `MAX_DISCOVERY_STDOUT_BYTES = 5 MiB`.
  - Model discovery stdout line: `MAX_LINE_BYTES = 1 MiB`.
  - Model catalog capacity: `MAX_NORMALIZED_MODELS = 500`.
  - Model ID and label length: `MAX_ID_LABEL_BYTES = 256` bytes.
  - Model response serialized size: `MAX_RESPONSE_BYTES = 256 KiB`.
  - Discovery timeout: `5` seconds; concurrency semaphore: `2` permits.
  - History record limits: Execution JSON <= `4 MiB`, Outcome JSON <= `2 MiB`.
  - Evaluation files: <= `8 MiB`; evaluation compare response: <= `1 MiB`.
- **Workflow Subsystem:**
  - Title: <= `200` characters.
  - Note body: <= `8192` bytes (8 KiB).
  - External resource ID: <= `200` characters.
  - Event payload: <= `4096` bytes (4 KiB).
  - Agent harness label: <= `64` characters; Run ID: <= `128` characters.
  - Overview limits: `100` projects, `500` items, `100` sessions.
  -keyst pagination: default `50`, max `100` events.
  - Retention defaults: activity events `90` days, deleted notes grace `7` days, stale session attention `24` hours.
  - Work item hierarchy depth: strictly <= `3` (`Plan` -> `Phase` -> `Task`).
- **Browser Debug Subsystem:**
  - Selection JSON: <= `64 KiB`.
  - Screenshot PNG: <= `4 MiB`.
  - Artifact TTL: `10` minutes (`600,000` ms).
- **Release Subsystem:**
  - Release manifest: <= `1 MiB`.
  - Maximum archive uncompressed bytes: `512 MiB`.
  - Maximum archive entry bytes: `128 MiB`.
  - Maximum inventory entries: `20,000`.

### 5.2 Security Boundaries & Authorization Rules
- **Admin Privilege Enforced:** All `/api/advisor/*` endpoints strictly require authenticated users with the `admin` role. `--no-auth` mode explicitly denies Advisor access with HTTP 403 (`NoAuthForbidden`).
- **No Path Traversal or Symlink Following:**
  - Advisor history root rejects symlinks on its final component.
  - Policy read/write uses `O_NOFOLLOW` on both parent directory and file.
  - Release manager verifies canonical paths and rejects archive traversal components.
- **Credential Scrubbing:** Advisor policy updates reject any payload containing substrings like `token`, `secret`, `api_key`, `password`, `authorization`, or `credential`.
- **Terminal ANSI Escape Sanitization:** Browser debug handoff parses and strips CSI/OSC escape sequences before constructing terminal reference strings.

---

## 6. Retired vs Active Functionality

### 6.1 Plugin Platform Retirement
| Retired Component / Feature | Former Location / Interface | Current Active Replacement | Current Status |
|---|---|---|---|
| Plugin Runner Daemon | `dam-hopper-plugin-runner.service` | Native Rust `AdvisorService` (`server/src/advisor/`) | **RETIRED & REMOVED** |
| Plugin IPC Socket | `/run/dam-hopper/plugin-runner.sock` | Internal Axum in-process dispatch | **RETIRED & REMOVED** |
| Plugin State / Registry | `/var/lib/dam-hopper-plugin-runner` | `$HOME/.evcrate/` history and policies | **RETIRED & REMOVED** |
| Plugin Shared Group | `dam-hopper-plugins` supplementary group | None needed (API service runs isolated) | **RETIRED** (Inert remainder allowed) |
| Plugin SDK & Bridge | `@dam-hopper/plugin-sdk`, iframe UI | Native React components (`AdvisorPanel.tsx`) | **RETIRED & REMOVED** |
| Plugin Admin Endpoints | `/api/plugins/*`, `/api/plugins/admin*` | `/api/advisor/*` endpoints | **RETIRED & REMOVED** |
| Plugin Owner CLI Flag | `dam-hopper-install.sh --plugin-owner-user` | Ignored with deprecation notice | **DEPRECATED** |

### 6.2 Format 2 Legacy Deployment vs Systemd Profile Release
| Feature / Characteristic | Legacy Format 2 | Current Release Contract (Manifest v2) |
|---|---|---|
| Deployment Directory | Single `/opt/dam-hopper` tree | Versioned `/opt/dam-hopper/releases/vX.Y.Z` + `/opt/dam-hopper/current` symlink |
| Service Units | Single `dam-hopper.service` | Multi-unit: `dam-hopper-api`, `dam-hopper-web`, `dam-hopper-recovery`, `dam-hopper-idle-suspend-helper` |
| Manifest Location | `.systemd-fresh-install/manifest` | Authoritative `release-manifest.json` (schema v2) |
| Manager State | Unmanaged / text file | Structured `/var/lib/dam-hopper-manager/state.json` (schema v3) |
| Migration Mechanism | N/A | Automated one-time atomic exchange in `server/src/linux_release/migration.rs` |

### 6.3 Deprecated CLI Options and Inactive Remnants
- `deploy/release/dam-hopper-install.sh`: Option `--plugin-owner-user` prints: `Notice: Plugin platform is retired; ignoring deprecated option '$1'.`
- `server/src/linux_release/constants.rs`: Constants `RUNNER_SERVICE_UNIT`, `RUNNER_TMPFILES_CONF`, `DEFAULT_RUNNER_SOCKET_PATH`, `DEFAULT_RUNNER_STATE_DIR`, and `PLUGIN_SHARED_GROUP` remain solely to validate that candidate release units do not reintroduce plugin references and to support cleanup.

---

## 7. Doc Updates Needed (with Source Evidence)

### 7.1 Obsolete Plugin Platform Docs & Required Warnings / Removals
1. **`docs/plugin-platform-linux.md`:**
   - *Current State:* Marked retired at the top, but contains 350 lines of historical runner configuration.
   - *Doc Action Needed:* Maintain historical disclaimer; ensure all operational guides point to `docs/linux-release-manager.md`.
2. **`docs/plugin-platform-d00.md`, `docs/architecture/plugin-platform-d01.md`, `d02.md`, `d03.md`, `d05.md`:**
   - *Current State:* Design specifications for the retired plugin platform.
   - *Doc Action Needed:* Verify that all these files carry explicit `RETIRED / HISTORICAL` header banners referencing the native cutover.
3. **`docs/api-reference.md`:**
   - *Doc Action Needed:* Confirm that all former `/api/plugins/*` endpoints are removed and replaced with references to `docs/api/advisor-and-workflow.md`.

### 7.2 Release Manager & Deployment Docs Alignment
1. **`docs/linux-release-manager.md`:**
   - *Evidence:* Document accurately reflects Manifest v2 and manager state schema v3, as well as `dam-hopper provision-api-runtime`.
   - *Doc Action Needed:* Verify that references to the number of managed units match `ALL_SERVICE_UNITS` (4 units: API, Web, Recovery, Helper).
2. **`docs/windows-release-packaging.md`:**
   - *Evidence:* Document correctly states the 4-member ZIP invariant and 2-asset Windows release contract (`dam-hopper-install.ps1`, `dam-hopper-vX.Y.Z-windows-x86_64.zip`).
   - *Doc Action Needed:* Keep synchronized with `build-windows-release-archive.mjs`.
3. **`deploy/server.env.example` vs `deploy/systemd/dam-hopper-api.service.in`:**
   - *Doc Action Needed:* Confirm environment variable documentation matches the canonical configuration location `/var/lib/dam-hopper/dam-hopper.toml`.

### 7.3 Preserved Migration Details
1. **`deploy/remove-plugin-platform.sh`:**
   - Maintain full operational documentation for administrators needing to purge legacy `dam-hopper-plugin-runner` system artifacts from hosts upgraded from older versions.
2. **Format 2 One-Time Migration:**
   - Maintain the migration troubleshooting section in `docs/linux-systemd.md` and `docs/linux-release-manager.md` explaining the sibling workspace atomic exchange.

---

## 8. Unresolved Questions

1. **`dam-hopper-idle-suspend-helper` Distribution on Windows:**
   - *Observation:* `dam-hopper-idle-suspend-helper` has a dummy `fn main() {}` under `#[cfg(windows)]` but is excluded from the Windows ZIP package. Is there any planned power management or idle suspend support for Windows hosts, or is idle suspend strictly scoped to Linux systemd?
2. **Evaluation Directory Standard Path:**
   - *Observation:* `server/src/advisor/evaluations.rs` checks `$HOME/.evcrate/advisor-evaluations`, `$HOME/.evcrate/evaluations`, and `<project>/tests/fixtures/advisor-evaluations`. Will evaluation generation eventually be standardized into a single canonical directory?
3. **Manager State Schema Compatibility:**
   - *Observation:* `MANAGER_STATE_SCHEMA_VERSION` is 3, while legacy schema versions 1 and 2 are migrated automatically. Is there any timeline to deprecate direct migration from schema v1?

---
*Report compiled by Codebase Scout for DamHopper documentation consolidation.*


---

## 9. Appendix: Disputed Workflow Event Retention Wiring Investigation

**Determination:** `server.workflow_event_retention_days` **DOES NOT** reach `WorkflowStore` constructors or runtime logic; the codebase **still uses a hardcoded 90-day default** in all event creation sites.

### Source Evidence & Exact Paths:
1. **Config Definition (Parsed but Unused):**
   - `server/src/config/schema.rs:656`: `pub workflow_event_retention_days: u32` (default `default_workflow_event_retention_days() = 90`, validated `1..=3650`).
   - `server/src/config/parser.rs:313-314`: Serializes `server.workflow_event_retention_days`.
   - *Finding:* Config field is parsed and validated, but never read outside `config/` (except a test fixture in `persistence/restore.rs:371`).

2. **WorkflowStore Constructor Has No Retention Parameter:**
   - `server/src/workflow/store/mod.rs:22-25`:
     ```rust
     pub struct WorkflowStore {
         conn: Arc<Mutex<Connection>>,
     }
     impl WorkflowStore {
         pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
             Self { conn }
         }
     ```
   - `server/src/main.rs:765`:
     ```rust
     dam_hopper_server::workflow::WorkflowStore::new(store.connection())
     ```
   - *Finding:* `WorkflowStore` only holds the SQLite database connection. It has no configuration fields and its constructor does not accept retention days.

3. **Hardcoded 90-Day Expiration on Event Creation:**
   - `server/src/api/workflow/item.rs:45`: Literal `expires_at: Some(now + 90 * 86_400_000)`
   - `server/src/api/workflow/note.rs:45`: Literal `expires_at: Some(now + 90 * 86_400_000)`
   - `server/src/api/workflow/session.rs:49`: Literal `expires_at: Some(now + 90 * 86_400_000)`
   - `server/src/workflow/observation.rs:490`:
     ```rust
     expires_at: Some(obs_time + (DEFAULT_EVENT_RETENTION_DAYS as u64) * 86_400_000)
     ```
     Referencing `server/src/workflow/mod.rs:53`:
     ```rust
     pub const DEFAULT_EVENT_RETENTION_DAYS: u32 = 90;
     ```

4. **Retention Purge Execution Ignores Config for Events:**
   - `server/src/workflow/service.rs:226-229`:
     ```rust
     let days = {
         let c = self.config.read().await;
         c.server.workflow_deleted_note_retention_days as u64
     };
     ```
     `WorkflowService::purge_expired()` reads `workflow_deleted_note_retention_days`, but does **not** read `workflow_event_retention_days`.
   - `server/src/workflow/store/event.rs:125-131`: `purge_expired_events` purges rows where `expires_at <= now_ms`. Because `expires_at` was computed using hardcoded 90 days at insertion time, event retention is fixed to 90 days regardless of `server.workflow_event_retention_days`.
