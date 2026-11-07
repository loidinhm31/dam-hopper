# Backend Configuration Cutover Implementation Plan: Single server `config.toml`

## Scope and File Ownership
- **Exclusively Owned**: `server/**` source and tests only.
- **External Dependencies**: Parent owns machine data migration, docs, and root cleanup. Frontend (`EditorAndSettingsRepair`) owns UI settings and file tree consumers. Native consumers (`NativeConfigConsumers`) owns native integration models.

## Candidate Architecture and Direction

### 1. Single Authoritative Document
- **Canonical Document Path**: Default `config::global_config_path()` (`~/.config/dam-hopper/config.toml`), or custom path via `--config` / `DAM_HOPPER_CONFIG`.
- **Sole Configuration**: No per-workspace `dam-hopper.toml` discovery or creation (`finder.rs` directory-walking removed).
- **Document Sections**: `[workspace]` { name, root }, `[[projects]]`, `[server]`, `[features]`, `[agent_store]`, `[ui]`, `[semantic]`, `[[workspaces]]`.
- **Sole Workspace Authority**: `[workspace].root` in this document is the authoritative workspace root. No `defaults.workspace` selector, no fallback to config parent or CWD as workspace authority.
- **Fail Closed**: Corrupted or malformed TOML fails closed; never ignored, defaulted away, or partially overwritten.

### 2. Relative Project Paths Stable Base
- Relative project paths in `[[projects]]` are resolved against `[workspace].root` as the explicit stable base.
- In-memory representations hold absolute canonical paths; TOML serialization relativizes paths against `[workspace].root` if contained, otherwise retains absolute paths.
- On workspace root switch, existing projects preserve their resolved target locations; relative paths outside the new root are safely made absolute to prevent accidental retargeting.

### 3. Read-Validate-Modify-Write Serialization & Raw Section Preservation
- All configuration write operations (`PUT /api/config`, `POST /api/config/projects`, `DELETE /api/config/projects/:name`, `PATCH /api/config/projects/:name`, `POST /api/global-config/ui`, `POST /api/global-config/workspace`, `POST /api/workspace/switch`, `POST /api/workspace/init`, `POST /api/workspace/known`, `DELETE /api/workspace/known`) acquire the shared `AppState::workspace_context_guard` write lock.
- Read current raw TOML value from `state.config_path()`, validate and modify target section on the TOML table, serialize candidate TOML, validate parsed candidate, atomic write to disk, then reconcile and publish runtime state.
- Unrelated sections (`[ui]`, `[semantic]`, `[features]`, `[agent_store]`, etc.) are completely preserved.

### 4. UI Window Placement Persistence
- Add `default_window_placement` (`DefaultWindowPlacement`: `Float` default, `Tile`) to `UiConfig` in `schema.rs`.
- Persisted in TOML as snake_case `default_window_placement = "float" | "tile"`.
- Validated on incoming JSON (camelCase alias `defaultWindowPlacement`), rejecting any other values.

### 5. Stale-Root Fencing & Workspace Authority
- `FsSubsystem` tracks `workspace_epoch` (u64) initialized with a boot incarnation baseline (e.g. `(boot_time_ms << 16) | 1`) to prevent token collision across restarts, and `workspace_generation` (u64).
- On workspace root update/switch:
  - Synchronously pre-validate and pre-construct the candidate `WorkspaceSandbox` before disk write or PTY disposal. If validation fails, abort without touching disk or runtime.
  - Exclusively acquire `workspace_context_guard` write lock.
  - Bump `workspace_epoch` and `workspace_generation`.
  - Install new `WorkspaceSandbox` and reinit `ProjectSandbox`.
  - Re-anchor `agent_store` path if relative to workspace root.
  - Invalidate workspace target resolver caches.
  - Revoke all active media stream tickets.
  - Dispose PTY sessions.
  - Broadcast `workspace:changed`.
- Stale-root fencing for mutations (`fs:write_begin`, `fs:put_save`, `fs:op`, `fs:upload_begin`, `fs:put_begin`):
  - When target is `Workspace`: require `workspace_epoch` (or `workspaceEpoch`) in the message or `WorkspaceTargetPayload`. If missing, FAIL CLOSED (`STALE_WORKSPACE_AUTHORITY`).
  - If both message-level and target-level epochs are provided, they must agree; conflicting values fail closed.
  - Epoch must match current `state.workspace_epoch()`. Mismatched epochs fail closed immediately.
  - In-flight commits and writes acquire a shared read lock on `workspace_context_guard`, guaranteeing atomic check through filesystem side-effect against concurrent switches.

### 6. API Projection Alignment
- `GET /api/config`: returns `DamHopperConfig` with `workspace: { name, root }`.
- `GET /api/global-config`: returns projected `GlobalConfig` with `workspace: { name, root }`, `ui`, `server`, `workspaces` (no `defaults.workspace`).
- `POST /api/global-config/workspace`: updates `[workspace].root` (and optionally name) in the single `config.toml`.
- `POST /api/workspace/switch`: updates `[workspace].root` in the single `config.toml`, fencing stale operations.
- `POST /api/workspace/init`: updates `[workspace].root` in the single `config.toml` (discovering initial projects into `[[projects]]`), never creating a local file.
- `GET /api/workspace` and `GET /api/workspace/status`: return `root`, `configPath`, and `workspaceEpoch`.

## Validation Strategy
- Unit and integration tests in `server/tests` and `server/src`:
  - Startup independent of CWD: verify `--config` selection and default global config path.
  - Preservation of all sections across mark/unmark, UI updates, workspace switch, and config replace.
  - Concurrency & serialization: multiple write attempts serialized without data loss.
  - Invalid config / root validation fails closed without corrupting existing file or runtime.
  - Stale workspace epoch fencing: verify mutations with missing, conflicting, or stale epoch fail closed on workspace targets.
  - Atomic commit-vs-switch race fencing.
  - Restart token invalidation: prior incarnation tokens rejected after restart.
- Note: No test or build runs mid-flight per instructions.
