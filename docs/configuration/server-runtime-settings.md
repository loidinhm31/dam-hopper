# Server Runtime and Settings

Server-managed runtime settings for session persistence, telemetry, and diagnostic collection moved from the [server configuration index](./server-configuration.md).
## Runtime and service settings

Optional: configure SQLite path and retention for terminal restart recovery. Session persistence is always enabled when the database can be opened.

```toml
[server]
session_db_path = "~/.config/dam-hopper/sessions.db"  # Database file location
session_buffer_ttl_hours = 24  # TTL for dead session buffers in hours (default: 24)
```

**Fields:**

| Field                    | Type   | Default                          | Notes                                                                                  |
| ------------------------ | ------ | -------------------------------- | -------------------------------------------------------------------------------------- |
| session_db_path          | string | ~/.config/dam-hopper/sessions.db | SQLite database path (supports ~ expansion); must be on local filesystem               |
| session_buffer_ttl_hours | u64    | 24                               | Hours before dead session buffers are auto-deleted; prevents unbounded database growth |

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

### Deferred host-action scaffolding (inactive)

This Phase 07 release has no supported host-action configuration or client
contract. Inert, fail-closed route scaffolding remains in the server for a
future approved design, but authentication, re-authentication, helper
enrollment, lifecycle/audit, IPC, and host mutation are deferred together. Do
not configure or call those deferred routes for monitoring; no current setting
enables them.

### Telemetry Configuration

Telemetry is opt-in and disabled by default. The settings live under `[server.telemetry]` in
the registry file. Omitting the section leaves collection and the Codex OTLP collector off;
enabling the collector does not change the loopback-only network boundary.

```toml
[server.telemetry]
enabled = false
db_path = "~/.config/dam-hopper/telemetry.db"
detail_retention_days = 90
# aggregate_retention_days = 365

[server.telemetry.collector]
enabled = false
host = "127.0.0.1"
port = 4811
```

| Field                      | Type           | Default                             | Notes                                                    |
| -------------------------- | -------------- | ----------------------------------- | -------------------------------------------------------- |
| `enabled`                  | bool           | `false`                             | Master switch for telemetry collection and persistence   |
| `db_path`                  | string         | `~/.config/dam-hopper/telemetry.db` | SQLite telemetry database path                           |
| `detail_retention_days`    | u16            | `90`                                | Detailed-event retention, from 1 to 3650 days            |
| `aggregate_retention_days` | u32 or omitted | omitted                             | Optional aggregate retention; when set, must be positive |
| `collector.enabled`        | bool           | `false`                             | Enables the authenticated Codex OTLP/HTTP receiver       |
| `collector.host`           | IP address     | `127.0.0.1`                         | Must be a loopback address                               |
| `collector.port`           | u16            | `4811`                              | Must be non-zero                                         |

TOML uses snake_case keys; the corresponding API representation uses camelCase (for example,
`dbPath`, `detailRetentionDays`, and `aggregateRetentionDays`). The telemetry database is
separate from session persistence. When enabled, startup creates/opens it and starts a bounded
worker; initialization failures disable analytics only. SQLite and WAL/SHM files are restricted
to owner access on Unix. Telemetry stores bounded, privacy-filtered metadata rather than command
text, prompts, responses, or tool output; see the [telemetry architecture notes](../system-architecture.md#codex-otel-usage-analytics).

Daily aggregates are retained indefinitely when `aggregate_retention_days` is omitted. Set it to
a positive value to purge older UTC rollups. The Usage page can delete all data or a selected
UTC-day-aligned `[from,to)` range; deletion requires explicit confirmation. Full deletion also
rotates the shared telemetry HMAC key, while range deletion does not.

Codex session summaries are flat and retention-bounded, not permanent. Raw `response.completed`
events are applied before the configured detail-retention purge removes expired summaries and
events. `delta` counters accumulate, while `cumulative` counters accept only newer non-regressing
values.
Codex CLI 0.146.1 may emit token fields without trace/span identity. Those records use a
domain-separated HMAC fallback over bounded decoded fields, remain `unverified`, and are stable for
replay; valid trace/span identity always takes precedence. Identical same-millisecond decoded events
can dedupe as the documented compatibility
tradeoff; invalid timestamps still fail closed. No receipt-time, conversation-ID-alone, random-ID,
raw-content, or config-secret fallback is used. This does not change telemetry configuration,
event fields, or the SQLite schema. The existing Usage health response additionally exposes
fixed-cardinality in-memory drop counters; they reset on process restart and contain no source or
payload values. Its legacy `droppedMissingIdentity` counter remains available for API compatibility
and stays zero while this fallback is active.
Telemetry uses a fresh v1 Codex-only schema containing only Codex sessions, usage events, daily
rollups, and health state. There is no legacy-data migration or import. During development, startup
checks the SQLite version and complete schema object set; a legacy, malformed, or otherwise
incompatible telemetry database is reset transactionally by removing its user tables/views/triggers/
indexes and recreating the v1 schema. A valid current database is reopened without data loss. The
reset is bounded to the configured telemetry file, and telemetry/session database paths must resolve
to different files. Stop DamHopper and remove the telemetry database plus its `-wal`/`-shm` sidecars
for an explicit clean reset; never remove the separate `sessions.db`.

The Usage settings API can explicitly manage the local Codex exporter with `codexExporter: true`.
It writes only the exact DamHopper-owned shape in `~/.codex/config.toml` (loopback `/v1/logs`,
binary OTLP, one bearer header, and `log_user_prompt = false`). The generated secret is stored
in `~/.config/dam-hopper/codex-otlp-token` as a regular owner-only (`0600`) file; config writes
are atomic. Foreign, malformed, or changed exporter configuration is reported as
`codexExporter: "conflict"` and never overwritten. API responses expose status only
(`notConfigured`, `managed`, or `conflict`), never the bearer value.

Managing the config does not restart Codex: restart the existing Codex process separately for
it to reconnect. Collector changes restart only the loopback listener, not the DamHopper server.
Failed runtime or registry writes roll back both runtime state and the managed Codex file.

`PATCH /api/usage/settings` applies validated telemetry changes to the running server before
persisting the registry file. Enabling or disabling telemetry changes which newly accepted Codex
events are persisted; existing summaries remain readable. Collector host/port or enabled-state
changes stop and start the loopback listener while the server remains up. If a collector restart
or retention operation fails, the previous live collector/configuration is restored and the failed
update is not published.

Rollback/runbook: pause collection, optionally delete a UTC range or all usage data, then leave
the feature disabled. Existing telemetry is not removed by disabling the flag. Re-enable only
after confirming database permissions, collector loopback binding, and the Usage health counters.

The Usage page's Sessions tab is a read-only audit view over flat aggregate summaries. It keeps
cached input separate from the primary token total and accepts dynamic provider/model identifiers.
Session IDs are derived HMAC values; raw commands, prompts, responses, tool content, and storage
paths are not displayed or stored in the UI. Pausing keeps existing summaries available while
marking the view paused; deletion requires explicit confirmation. List/detail refresh runs every
15 seconds only in a visible document (hidden browser tabs stop polling), with identical behavior
in browser and native hosts.

### Diagnostics Storage

Diagnostics export does not currently add user-configurable knobs to `dam-hopper.toml`.

The export API is local-only, uses camelCase on the wire, and accepts `frontend` plus the legacy `frontendSnapshot` alias.

The Phases 02–03 canonical idle-suspend event producer is internal. Its path
is fixed at
`/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl`;
there is no configuration key or public path override. Phase 03 wires the
optional writer into `AppState` and coordinator startup; initialization can
degrade semantic evidence without disabling suspend/status behavior.

Production collection is a separate read-only CLI path:
`dam-hopper diagnose --json` (Phases 06–07). The required `--json` flag is the
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

See [Linux Release Manager — Production diagnostics](../linux-release-manager.md#production-diagnostics-phase-06)
for fixed source paths, adapter behavior, and the atomic write sequence.

- Backend diagnostics are stored locally at `~/.config/dam-hopper/diagnostics/backend-log.jsonl`
- The backend log keeps a 60-minute retention window and uses restricted `0o600` file permissions on Unix
- Frontend diagnostics stay in browser `localStorage` under `damhopper_diagnostics_frontend_v1`
- Exported browser JSON bundles are created only when the user triggers Settings > Maintenance > Export Diagnostics
- Terminal tails are included by default and may still contain sensitive local/dev output even after best-effort redaction

