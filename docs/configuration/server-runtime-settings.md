# Server Runtime and Settings

Server-managed runtime settings for session persistence and diagnostic collection moved from the [server configuration index](./server-configuration.md).
## Runtime and service settings

Optional: configure SQLite path and retention for terminal restart recovery. Session persistence is always enabled when the database can be opened.

```toml
[server]
session_db_path = "~/.config/dam-hopper/sessions.db"  # Database file location
session_buffer_ttl_hours = 24  # TTL for dead session buffers in hours (default: 24)
session_changes_enabled = false  # Master switch for lightweight session changes tracking (default: false)
```

**Fields:**

| Field                    | Type   | Default                          | Notes                                                                                  |
| ------------------------ | ------ | -------------------------------- | -------------------------------------------------------------------------------------- |
| session_db_path          | string | ~/.config/dam-hopper/sessions.db | SQLite database path (supports ~ expansion); must be on local filesystem               |
| session_buffer_ttl_hours | u64    | 24                               | Hours before dead session buffers are auto-deleted; prevents unbounded database growth |
| session_changes_enabled  | bool   | false                            | Master switch for tool-event session changes tracking and managed extension lifecycle |

**Security Note:** On Unix systems, database files are created with 0o600 permissions (user-only access). Ensure the directory containing `session_db_path` is not world-readable.

**Example:**

```toml
[server]
session_db_path = "~/.local/share/dam-hopper/sessions.db"
session_buffer_ttl_hours = 48
```

When the database opens successfully:

- Session metadata (id, project, command, cwd, restart_policy, etc.) is saved to SQLite
- Up to 1 MB of terminal scrollback is retained per session
- Any browser connected to the same server can resume live sessions
- On DamHopper server restart, sessions that were alive are relaunched and restored scrollback is replayed
- Exact shell/process memory continuity is not guaranteed across server or host restart
- Dead sessions are kept for 60 seconds to allow reconnection; buffers are cleaned up per TTL

### Session Changes Configuration

Lightweight Session Changes tracking is opt-in and disabled by default. The master switch is configured under `[server]` in `dam-hopper.toml`.

```toml
[server]
session_changes_enabled = false
```

**Fields:**

| Field | Type | Default | Wire format (JSON) | TOML key | Notes |
| ----- | ---- | ------- | ------------------ | -------- | ----- |
| `session_changes_enabled` | bool | `false` | `sessionChangesEnabled` | `session_changes_enabled` | Master switch controlling tool-event tracking, service gating, and managed extension installation |

**Intended Behavior and Extension Lifecycle Design Contract:**

- **Current Implementation Boundary:** Phase 01 (server configuration and managed extension lifecycle), Phase 02 (lightweight per-file capture engine and lazy comparison), Phase 03 (standalone tool-event producer asset `omp-session-changes.ts`), and Phase 04 (target-server Settings UI toggle, trigger gating, and modal isolation) are implemented.
- **Default Off:** The setting defaults to `false`. When disabled, the server allocates no baseline buffers or temporary directory payloads, and returns HTTP 503 `StatusCode::SERVICE_UNAVAILABLE` with wire error code `trackingDisabled` (`"Session changes tracking is disabled on this server"`) on public or private session changes routes.
- **Enabling (`session_changes_enabled = true`):**
  - Automatically installs or upgrades the dedicated managed OMP extension asset into `<agent_dir>/extensions/dam-hopper-session-changes.ts` using atomic writes (via temporary file `.dam-hopper-sc-*.tmp` and `sync_all`) and SHA-256 header verification.
  - Activates the in-memory service lifecycle gate (`state.session_changes.enable()`).
  - Active OMP terminal sessions must be restarted for OMP to load the newly installed extension.
- **Disabling (`session_changes_enabled = false`):**
  - Flips the service lifecycle gate to disabled and increments its generation counter (`state.session_changes.disable_and_purge()`).
  - Advances the generation to invalidate in-flight capture or comparison tasks.
  - Clears stored session records, baseline buffers, and temporary directory payloads from the service instance.
  - Uninstalls and removes the managed file `extensions/dam-hopper-session-changes.ts` if uncorrupted and matching recorded SHA-256 ownership.
- **Conflict Safety:**
  - If `extensions/dam-hopper-session-changes.ts` is user-modified, unmanaged, or a symlink, installation and uninstallation refuse to overwrite or delete it, preserving the user's file.
  - On removal conflict, the server remains runtime OFF and logs/surfaces the conflict status.
- **Config Lifecycle Reconciliation:**
  - Setting changes are reconciled across server startup (`startup_reconcile_session_changes`), config PUT updates (`PUT /api/config`), settings cache-clear and TOML import/recovery (`POST /api/settings/import-toml`), and workspace initialization or switching (`POST /api/workspace/init`, `POST /api/workspace/switch`).
- **Independent Lifecycle:**
  - The Session Changes extension lifecycle is completely independent from the Agent Status extension (`extensions/dam-hopper-agent-status.ts`) and native hooks (Codex, Claude). Toggling Session Changes has no effect on Agent Status or notification policies.
- **Operator UI Toggle (`SettingsPage.tsx`):**
  - Binds to `targetOwner` from the selected Settings Target Server (`settingsProfileId`).
  - Updates `config.server.sessionChangesEnabled` via `useConfig(targetOwner)` and `useUpdateConfig(targetOwner)`, preserving all other server configuration fields (`[key: string]: unknown`).
  - Fences mutations with captured `{ actionProfileId, actionGeneration }` against concurrent target switching (switching targets during in-flight mutation clears the captured target's query cache, but does not purge the switched-to target until that server is toggled or refreshed).
  - On success, invalidates config queries and cancels/removes all `session-changes` queries for that target owner.
  - Surfaces an honest restart notice on enable (`Restart active OMP sessions to load the Session Changes extension`) and actionable errors on failure without optimistic local state.
  - Terminal triggers across desktop `TabBar`, `ActiveTerminalRuntimeDisplay`, and mobile `MobileTerminalAccessoryBar` query `useSessionChangesEnabled(terminalOwner)` and hide/disable when tracking is disabled, loading, or unavailable.
### Deferred host-action scaffolding (inactive)

The current release has no supported host-action configuration or client
contract. Inert, fail-closed route scaffolding remains in the server for a
future approved design, but authentication, re-authentication, helper
enrollment, lifecycle/audit, IPC, and host mutation are deferred together. Do
not configure or call those deferred routes for monitoring; no current setting
enables them.

### Diagnostics Storage

Diagnostics export does not currently add user-configurable knobs to `dam-hopper.toml`.

The export API is local-only, uses camelCase on the wire, and accepts `frontend` plus the legacy `frontendSnapshot` alias.

The canonical idle-suspend event producer is internal. Its path
is fixed at
`/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl`;
there is no configuration key or public path override. The runtime wires the
optional writer into `AppState` and coordinator startup; initialization can
degrade semantic evidence without disabling suspend/status behavior.

Production collection is a separate read-only CLI path:
`dam-hopper diagnose --json`. The required `--json` flag is the
complete grammar; path, window, source, unit, URL, command, and verbosity
overrides are not accepted.

Bundle-v1 bounds are fixed in the implementation:

- 60-minute historical window
- 10,000 accepted records per source and 10,000 record-array items
- 16 KiB per JSONL line and 16 MiB maximum file scan
- 2 MiB maximum host-command stdout and 256 KiB maximum local-API body
- 8 MiB maximum serialized bundle
- 512-byte redacted/serialized strings, 256 source errors, 32 warning examples,
  and nested DTO depth 8
- 5-second command/API deadlines

These are not `dam-hopper.toml` keys and have no public tuning knobs. The
default idle-suspend policy (`empty-fleet`) and timeout configuration remain
unchanged.

The collector uses fixed role-aware host adapters and emits one bounded
camelCase `bundleSchemaVersion: 1` JSON file. Applicable server/both sources
are collected for those roles; web-role sources are `notApplicable`; an
unknown role remains partial. Current host probes are marked latest and
`nonHistorical`, so they do not establish historical completeness.

Root output is `/var/lib/dam-hopper-manager/diagnostics`. Non-root output is
`$XDG_STATE_HOME/dam-hopper/diagnostics`, or
`$HOME/.local/state/dam-hopper/diagnostics` when unset; there is no `/tmp`
fallback. The output directory is owner-only `0700`, the final bundle is
owner-only `0600`, and non-root execution never escalates. A root-only helper
audit is reported as `permissionDenied` for non-root collection and can make a
valid bundle partial. The command prints only the absolute final bundle path
after an atomic same-directory write.

The command returns `0` for complete applicable historical evidence, `2` for a
valid partial bundle, and `1` for serialization or secure-output failure.

See [Linux Release Manager — Production diagnostics](../linux-release-manager.md#production-diagnostics)
for fixed source paths, adapter behavior, and the atomic write sequence.

- Backend diagnostics are stored locally at `~/.config/dam-hopper/diagnostics/backend-log.jsonl`
- The backend log keeps a 60-minute retention window and uses restricted `0o600` file permissions on Unix
- Frontend diagnostics stay in browser `localStorage` under `damhopper_diagnostics_frontend_v1`
- Exported browser JSON bundles are created only when the user triggers Settings > Maintenance > Export Diagnostics
- Terminal tails are included by default and may still contain sensitive local/dev output even after best-effort redaction

