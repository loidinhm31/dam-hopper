# Server Configuration

This reference covers server-owned settings, runtime configuration, deployment, and troubleshooting. For project registry, terminal environment, UI preferences, and Agent Settings, see the [Configuration Guide](../configuration-guide.md).

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

## Global Configuration (~/.config/dam-hopper/config.toml)

Store global defaults and known workspace metadata. This file is separate from the project registry.

```toml
[defaults]
workspace = "/home/user/projects/main-workspace"

[[workspaces]]
name = "prod"
path = "/home/user/prod-workspace"

[[workspaces]]
name = "sandbox"
path = "/tmp/test-workspace"
```

### Fields

**defaults.workspace** — Legacy fallback workspace directory, used only after explicit config, explicit workspace, and the global registry path are checked.

**workspaces** — Known workspace shortcuts (referenced by server later, not currently used by CLI).

## Environment Variables

| Var                                        | Type    | Purpose                                                                   |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------- |
| `DAM_HOPPER_CONFIG`                        | path    | Load an exact `dam-hopper.toml` registry file                             |
| `DAM_HOPPER_WORKSPACE`                     | path    | Legacy workspace path/discovery fallback                                  |
| `DAM_HOPPER_PORT`                          | number  | API listen port (direct/Docker default 4800; systemd sets 4801)           |
| `DAM_HOPPER_HOST`                          | string  | API bind address (default `0.0.0.0`)                                      |
| `DAM_HOPPER_CORS_ORIGINS`                  | string  | Comma-separated exact HTTP(S) origins for credentialed API/WS CORS        |
| `DAM_HOPPER_WEB_DIR`                       | path    | Explicit API combined-mode static root; Docker sets `/opt/dam-hopper/web` |
| `DAM_HOPPER_NO_AUTH`                       | boolean | Development-only API auth bypass                                          |
| `DAM_HOPPER_WEB_ROOT`                      | path    | Dedicated `dam-hopper-web` static root                                    |
| `DAM_HOPPER_WEB_HOST`                      | string  | Dedicated web bind address (default `0.0.0.0`)                            |
| `DAM_HOPPER_WEB_PORT`                      | number  | Dedicated web listen port (default `4802`)                                |
| `DAM_HOPPER_WEB_RUNTIME_CONFIG`            | path    | Optional public runtime-config JSON file                                  |
| `DAM_HOPPER_WEB_RELEASE_VERSION`           | string  | Optional web health release-version override                              |
| `VITE_DAM_HOPPER_LOG_LEVEL`                | string  | Web bootstrap log level, embedded at build time                           |
| `VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS` | string  | Exact extension parent origins, embedded at build time                    |
| `RUST_LOG`                                 | string  | Rust logging filter                                                       |
| `MONGODB_URI` / `MONGODB_DATABASE` / `DAM_HOPPER_MFA_KEY_FILE` | string/path | Optional API auth database; dedicated MFA key required for production authenticated startup. See [Phase 01 auth guide](../phase-01-auth-state-cryptography-and-policy.md). |
| `DAM_HOPPER_PLUGIN_ADMINS_FILE`              | path    | Optional root-seeded plugin administrator JSON override                       |

Plugin management administrators are not configured in `dam-hopper.toml`; the
runner reads this host-owned file before opening its management RPC surface.

`VITE_*` values require a web rebuild. `VITE_DAM_HOPPER_SERVER_URL` is not
allowed for production builds; production API origin is runtime config.
Changing extension parent origins also requires redistributing its generated ZIP.
CORS values are runtime API configuration and must exactly match the browser
origin.

## JWT Signing Secret and Session Tokens

`~/.config/dam-hopper/server-token` stores a 32-character hexadecimal UUIDv4
used only as the server's JWT signing secret. On Unix it is created with mode
`0600`; it is not a client bearer token.

`--new-token` rotates this signing secret and invalidates existing signed
sessions:

```bash
cd server && cargo run -- --config /path/to/dam-hopper.toml --new-token
```

Normal login returns an MFA challenge, not a bearer token. Use the `token`
returned by `/api/auth/mfa/confirm` or `/api/auth/mfa/verify`, or the
`damhopper-auth` cookie where accepted. Never send the signing-secret file as
`Authorization: Bearer`; see [Authentication API](../authentication-api.md).

## MFA Encryption Key and Operator Recovery Runbook

### Key File Provisioning (`DAM_HOPPER_MFA_KEY_FILE`)

In authenticated production mode, `DAM_HOPPER_MFA_KEY_FILE` is mandatory:
- Contains exactly 32 raw bytes (or 64 hexadecimal characters / 44 Base64 characters).
- File permissions must be strictly restricted to the owner (`chmod 600` on Unix). The server rejects symlinks, non-regular files, and files with group or world permissions.
- Dedicated to encrypting confirmed and pending TOTP secrets at rest via AES-256-GCM.
- Must be backed up separately from MongoDB and deployed to all server instances.

### Operator Recovery Runbook (Lost TOTP Authenticator)

This privileged reset is not self-service. Verify identity out of band; use
immutable MongoDB `_id` plus current `authVersion`, never username alone.
In authenticated `mongosh`, replace placeholders; for legacy rows lacking
`authVersion`, filter by `_id` plus `authVersion: { $exists: false }` instead.

```javascript
const userId = ObjectId("<verified-24-hex-id>");
const expectedVersion = NumberLong("<observed-authVersion>");
db.users.updateOne(
  { _id: userId, authVersion: expectedVersion },
  {
    $inc: { authVersion: NumberLong(1) },
    $unset: { mfa: "", mfaAttemptWindowStartedAt: "", mfaAttemptCount: "", mfaBlockedUntil: "" }
  }
);
```

**Verification & Invariants:**
1. Require `matchedCount === 1` and `modifiedCount === 1`; otherwise stop and re-read. Never retry blindly.
2. The version bump invalidates sessions/challenges; `authSessions`/`authChallenges` TTL indexes clean later, so no direct deletion is needed for authorization.
3. WebSockets/live streams poll state every 5s with a 2s DB cap (≤7s; smoke timeout 8s); restart/disconnect instances for immediate containment.
4. Next password login requires fresh TOTP enrollment. Do not change `passwordHash`, `isEnabled`, `role`, signing keys/settings, or install an unencrypted factor/bypass.

## Historical: Retired Plugin Management Administrator Allowlist

The plugin-runner allowlist and its configuration precedence below describe the removed plugin platform; they are not current Dam-Hopper server configuration.
Historically, the allowlist was separate from project TOML/MongoDB roles; the runner checked JWT subjects per management RPC.

The runner chooses the first available source:

1. `dam-hopper-plugin-runner --admin-config <path>`
2. `DAM_HOPPER_PLUGIN_ADMINS_FILE`
3. `/etc/dam-hopper/plugin-admins.json`
4. no file → empty list (deny all)

The file accepts either shape:

```json
{"adminSubjects":["alice","ops@example.test"]}
```

or:

```json
["alice","ops@example.test"]
```

Subjects are trimmed, deduplicated, sorted, and hashed into the persisted
`adminConfigDigest`. On Unix, group/world-writable files (`mode & 0o022`) are
rejected. An invalid or unreadable environment/default file logs a warning and
denies all administrators; an explicit `--admin-config` error prevents runner
startup. Keep the file host-owned and outside plugin staging. Configuration
details and management endpoint behavior are in the [D05 plugin architecture](../architecture/plugin-platform-d05.md).

The management API requires `Authorization: Bearer ...` even when the general
API also accepts an HttpOnly cookie. Cookie-only requests return
`BearerRequired`; `--no-auth` returns `NoAuthForbidden`. Login and development
mode never grant plugin administrator access.

## Running the Server

### Development Mode

```bash
cd server
cargo run -- --config /path/to/dam-hopper.toml --port 4800 \
  --host 127.0.0.1
# Or omit --config to use ~/.config/dam-hopper/dam-hopper.toml
```

### With Logging

```bash
RUST_LOG=dam_hopper=debug cargo run -- --config /path/to/dam-hopper.toml \
  --host 127.0.0.1
```

### Release Build

```bash
cargo build --release
./target/release/dam-hopper-server --config /path/to/dam-hopper.toml --port 4800 \
  --host 127.0.0.1
```

### Dedicated release web host (`dam-hopper-web`)

Build and run the second Cargo binary with a selected immutable web root:

```bash
cargo build --release --manifest-path server/Cargo.toml
./server/target/release/dam-hopper-web \
  --root /path/to/immutable/web-dist \
  --host 0.0.0.0 \
  --port 4802 \
  --runtime-config /etc/dam-hopper/runtime-config.json
```

`--root` (or `DAM_HOPPER_WEB_ROOT`) is required. The host rejects missing,
non-directory, or symlink roots. `--runtime-config` is optional; without it the
reserved endpoint returns `404`. Runtime config is public but startup-validated,
contains `schemaVersion`, `releaseVersion`, `profileId`, and optional `apiUrl` (omitted
when unset), and is capped at 4 KiB. When present, `apiUrl` must be an exact HTTP(S)
origin without credentials, path, query, or fragment.

The host serves only GET/HEAD. Health and runtime config are reserved
`/__dam-hopper/*` routes with JSON and `Cache-Control: no-store`; static files
stream with MIME detection. Hashed Vite assets are immutable for one year,
`index.html` is `no-cache`, and other assets use a bounded one-hour cache.
Extensionless HTML navigation may fall back to `index.html`; asset-like,
reserved, traversal, encoded-separator, symlink, and directory requests return
`404`. SIGTERM and CTRL-C perform graceful shutdown.

### API-only and Docker combined mode

`dam-hopper-server` is API-only by default: omit `--web-dir` for no static
filesystem access. Docker intentionally opts in to the legacy combined topology:

```bash
dam-hopper-server --port 4800 --web-dir /opt/dam-hopper/web
```

The repository `Dockerfile` supplies this explicit flag in its `CMD`. Do not
infer that systemd or direct API startup serves browser assets; systemd uses
backend port `4801`, while the dedicated web host uses `4802`.

### Linux systemd release manager

Use the published bootstrap or packaged `dam-hopper` manager; checkout-built
production/reset scripts are not supported:

```bash
bash dam-hopper-install.sh --version v0.2.0 --role server
sudo dam-hopper start
```

For an already downloaded bundle, `fetch` runs as the non-root caller and
`install`/`role set` run as root:

```bash
dam-hopper fetch --latest --output "$HOME/.cache/dam-hopper/latest"
sudo dam-hopper install --bundle "$HOME/.cache/dam-hopper/latest" --role server
sudo dam-hopper start
```

`install` and `role set` stop at `PENDING`; `start` is the sole activation
entrypoint. If the canonical root is a verified legacy format-2 installation,
the manager performs the one-time side-staged migration and retires the old
runner. Exact invariants, exchange, rollback, and recovery are documented in
[Linux systemd](../linux-systemd.md).

Current systemd-owned paths are:

- `/opt/dam-hopper/` — canonical release root and current/previous views
- `/etc/systemd/system/dam-hopper-api.service`
- `/etc/systemd/system/dam-hopper-web.service`
- `/etc/systemd/system/dam-hopper-recovery.service`
- `/var/lib/dam-hopper-manager/state.json` — durable manager state

## Browser origin and transport

The API server is API-only by default. A separate `dam-hopper-web` deployment
normally listens on `4802` and fetches its API origin from runtime config, so
the API must allow the exact web origin through credentialed CORS. Wildcard and
credentialed allow-all CORS are forbidden:

```bash
# API allows a dedicated web host
DAM_HOPPER_CORS_ORIGINS=https://web.example.com \
  dam-hopper-server --host 0.0.0.0 --port 4801

# Docker's explicit combined mode is same-origin on 4800
dam-hopper-server --host 0.0.0.0 --port 4800 \
  --web-dir /opt/dam-hopper/web
```

The equivalent API CLI option is `--cors-origins
"https://first.example,https://second.example"`. Each value must be an exact
`http://` or `https://` origin with no path, query, fragment, credentials, or
wildcard. Values are trimmed; duplicate or ambiguous origins are rejected at
startup. Restart the API after changing the setting.

Each allowlisted origin may call authenticated APIs with credentials. CORS does
not make media public: media ticket issuance still requires the authenticated
actor, and each stream URL is a short-lived actor/session-bound capability with
expiry, logout/session revocation, and file revalidation. Windows native desktop
uses this same browser transport for separate-origin profiles; Android, iOS, and
unsupported native hosts continue to require same-origin profiles.

Authenticated HTTP binds, including the default `0.0.0.0`, are supported. HTTP
media and bearer credentials remain exposed to interception, replay, and modification;
use HTTPS, a VPN/Tailscale network, or another trusted encrypted network when that
risk is unacceptable.

### Media compatibility and Phase 09 qualification

The current media contract is v2 only: issue/revoke/logout require a UUIDv4
`mediaClientId`, responses advertise `session-cookie-v2`, and the stream path
never accepts a bearer token. The deterministic server/media tests and the
browser suite cover namespaced cookies, ticket binding, exact-origin fallback,
credentialed `HEAD`, Range/HEAD behavior, lifecycle cleanup, file-version
revocation, and old/v1 rejection.

Phase 09 reconciled **3,504 passed / 9 skipped or ignored** across the release
ledger, including 1,416 Rust server tests, 209 UI browser tests, 24 live
two-server assertions, and four embedded browser assertions. The live harness
(`scripts/qualify-phase09-workbench.mjs`) creates isolated roots and repositories
for Server A (`127.0.0.1:14801`) and Server B (`127.0.0.1:14802`) and serves the
browser fixture on `127.0.0.1:15173`. It checks equal project/file names,
cross-server ticket rejection, selected-client revocation, and owner-specific
remote effects. The harness uses `--no-auth` only for deterministic fixture
checks; normal-auth suites remain required for actor isolation.

`packages/ui/vitest.browser.config.ts` binds the fixture/API server to port
`15173` with `strictPort: true` and accepts exactly one of `BROWSER_CHANNEL` or
`BROWSER_EXECUTABLE_PATH`. Reserve all fixture ports before launch and never
terminate an unrelated listener. Disable idle suspend and external telemetry in
fixtures; retain only sanitized evidence and delete temporary credentials/roots.

Deploy and roll back matching frontend/backend versions. A version-skewed
client must fail closed rather than revive capability-only URLs or a v1 cookie.
G2-Web is qualified; G2-Native remains blocked until real Windows S13 runtime,
SSH, WebView2/DPAPI, and Browser relay evidence is recorded. Old browser
layouts/history discarded by the fresh reset cannot be restored by rollback.

## Host resources SSE delivery and reverse proxy operations (Phase 06)
The authenticated `GET /api/system/resources/v1/events` stream serves an eligible connected, visible profile. While a paired stream is LIVE it updates snapshot and metrics together; the existing REST endpoints remain the gated fallback. Phase 06 closes documentation and runbooks, not target release qualification.
### Reverse proxy requirements
Buffering, caching, compression, and body transformation must be disabled for the SSE route at every proxy/CDN hop. Preserve `X-Accel-Buffering: no`; on Nginx use `proxy_buffering off`, `proxy_cache off`, `gzip off`, and `proxy_set_header Accept-Encoding ""` (the last disables upstream compression only; also disable downstream gzip/Brotli).
Set the upstream idle-read timeout to at least 45 s; status/keepalive bytes arrive at least every 15 s. HTTP/1.1 browsers commonly cap connections per origin and multiple SSE tabs can delay REST/WS traffic; HTTP/2 multiplexing mitigates this, but stage-test the actual deployed chain with HTTP/2 enabled and concurrent REST/WS requests.
**Nginx example** (4801 is the documented systemd API port; direct/Docker defaults to 4800. Match the actual `DAM_HOPPER_PORT`):
```nginx
location /api/system/resources/v1/events {
    proxy_pass http://127.0.0.1:4801;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Accept-Encoding "";
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 60s;
}
```

### Admission, capacity, and qualification gates
Each server process admits at most 32 live response bodies globally and 4 per authenticated subject. Rejections return HTTP `429` with `code: "HOST_RESOURCE_STREAM_LIMIT"` and `Retry-After: 30`; auth admission timeout/store failure returns `503 AUTH_UNAVAILABLE` after 2 s.
Independent auth supervision checks each body every 5 s (2 persisted reads/check): about 12.8 persisted reads/s at N=32 is a model, not observed load. No SSE setting is added; existing server-owned monitor cadences remain unchanged, REST fallback is 15 s snapshot/5 s visible-detail metrics, and history remains 30 s/coalesced.
The process inventory deadline is 150 ms; the 500 ms snapshot deadline is a wait, not a CPU or blocked-syscall bound. The default-cadence whole-monitor ≤2% one-core target requires the separate Phase 00 monitor profiler; ten collector-only scans do not qualify it.
Before any target rollout, identify reference/weak Linux hosts and the deployed proxy, then close the applicable Phase 05 matrix gates: same-run optimized harness evidence vs separately attributed authenticated release-PID CPU/RSS, 30-minute soak, live Chromium/browser, and deployed-proxy verification. Active auth revocation (C16/C17) and active backpressured HTTP/WS shutdown (C19) remain unproven by the 11/11 focused suite. Missing metric producer/population is null+reason and blocked, never zero/green. C42 is a pending native-only gate; unsupported native targets stay on owner-bound REST and do not block a qualified Linux-web-only release. See the [C01–C43 matrix](../../plans/260929-1522-host-resources-sse/validation-matrix.md).
### Rollout and rollback
Roll forward only after applicable target gates pass: deploy the backend first so old clients continue REST snapshot/metrics and WS; then deploy the web bundle. A new client on an older backend treats `/events` 404/405 as REST-only. Verify the deployed proxy's buffering, compression, idle timeout, and HTTP version during staging.
Roll back artifacts, not a runtime flag: restore the prior REST/WS UI first, and refresh/close tabs running the new client so their active SSE bodies can close; then, only if needed, replace the backend with its prior artifact. New clients left loaded after backend rollback fall back to REST on 404/405.
Keep `/api/system/resources/v1/snapshot`, `/api/system/metrics`, host-alert/history and unread behavior, the non-resource WS bridge, monitor cadence/configuration, and separately authorized Force Machine to Sleep/idle-suspend behavior intact. On an auth/security violation stop the affected rollout and revert the client and/or backend artifact; never log bearer tokens or raw resource payloads.
### Shutdown bounds
On OS signal the server revokes SSE admission/emission immediately, bounds feature cleanup to ≤2 s, and forces accepted HTTP/WS I/O cancellation at signal+10 s. This bounds HTTP drain, not total process exit if a collector syscall blocks; later PTY cleanup remains ordered.

## SSH Key Management

SSH credentials are loaded on-demand via `/api/ssh/keys/load`. Use an
MFA-issued session JWT, not `server-token` (the server signing secret); see
[Authentication API](../authentication-api.md).

```bash
session_jwt="<session JWT returned by MFA confirmation or verification>"
curl -X POST \
  -H "Authorization: Bearer $session_jwt" \
  -H "Content-Type: application/json" \
  -d '{"privateKeyPath": "/home/user/.ssh/id_rsa"}' \
  http://localhost:4800/api/ssh/keys/load
```

Keys are stored in-memory per session (not persisted to disk).

## Manual Smoke Checklist

1. Create `~/.config/dam-hopper/dam-hopper.toml` with at least two projects whose `projects[].path` values point at separate roots. On Windows, use different drives if available.
   Expected: `GET /api/workspace/status` reports the registry `configPath` and the expected `projectCount`.

2. Start the same-origin server with `cargo run --manifest-path server/Cargo.toml -- --config ~/.config/dam-hopper/dam-hopper.toml --port 4800 --host 127.0.0.1`.
   Expected: startup succeeds without requiring a repo-local `dam-hopper.toml`.

3. Browse and read files in each project, then create or edit a file inside each root.
   Expected: list/read/write operations work inside the selected project and do not bleed across roots.

4. Create a terminal session for each project without passing `cwd`.
   Expected: each terminal starts in the selected project root.

5. Attempt a traversal or sibling-project read such as `/api/fs/read?project=alpha&path=../beta/owned.txt`.
   Expected: the server returns `403 FORBIDDEN`. Also verify rejection for a raw absolute path outside the configured root and for any symlink that resolves outside the selected project.

6. On Windows, change one project path to a mixed-separator absolute path and, if supported in your environment, a `\\?\` verbatim path.
   Expected: the registry still loads, the project remains accessible, and TOML writes preserve absolute paths instead of forcing them relative.

7. On Windows or in any environment with a reachable network share, add a temporary UNC-style project entry such as `path = "\\\\server\\share\\project"`.
   Expected: the registry either works for that project in your environment or fails in a clear, local way that you can document before rollout. Do not assume UNC behavior from Linux CI alone.

### Windows direct-server installation and configuration

The PowerShell bootstrap (`dam-hopper-install.ps1`) installs the Windows `x86_64-pc-windows-msvc` direct-server package without administrative elevation or service registration.

#### Directory layout
```text
%LOCALAPPDATA%\Programs\dam-hopper\
├── bin\
│   └── dam-hopper-server.exe     # Server executable
├── dam-hopper.example.toml       # Sample configuration template
├── dam-hopper.toml               # Active user configuration (preserved on upgrade)
├── LICENSE                       # License file
└── README.md                     # Release documentation
```

#### Installation and launch
```powershell
# Download and install latest release to %LOCALAPPDATA%\Programs\dam-hopper with User PATH update:
$installDir = Join-Path $env:LOCALAPPDATA "Programs\dam-hopper"
powershell -NoProfile -ExecutionPolicy Bypass -File .\dam-hopper-install.ps1 `
  -Latest -InstallDir $installDir -AddToPath

# On first install, copy sample configuration if dam-hopper.toml does not exist:
if (-not (Test-Path "$installDir\dam-hopper.toml")) {
  Copy-Item "$installDir\dam-hopper.example.toml" "$installDir\dam-hopper.toml"
}

# Launch the server (open a fresh shell if using PATH, or invoke directly):
& "$installDir\bin\dam-hopper-server.exe" --config "$installDir\dam-hopper.toml"
```

#### Upgrades, configuration preservation, and attestation
- **Configuration preservation:** Re-running the installer with `-Latest` or `-Version` safely stages and replaces `bin\dam-hopper-server.exe` while preserving your existing `dam-hopper.toml`.
- **User PATH:** `-AddToPath` appends `%LOCALAPPDATA%\Programs\dam-hopper\bin` to the current user's User PATH environment variable. Open a **fresh terminal** for PATH changes to take effect in your shell session.
- **Attestation verification:** Pass `-VerifyAttestation` during installation to verify the published Windows ZIP and installer assets with `gh`. For manual verification, attest the release subjects before extraction (the extracted `dam-hopper-server.exe` is not itself a published attestation subject):
  ```powershell
  $assetDir = Join-Path $env:TEMP "dam-hopper-release"
  gh attestation verify "$assetDir\dam-hopper-vX.Y.Z-windows-x86_64.zip" --repo "loidinhm31/dam-hopper"
  gh attestation verify "$assetDir\dam-hopper-install.ps1" --repo "loidinhm31/dam-hopper"
  ```
- **Dry-run mode:** Pass `-DryRun` to verify release metadata and archive integrity without modifying filesystem or environment state.
- **Environment and `.env` loading:** The server automatically loads `.env` files from: (1) the directory containing the active `dam-hopper.toml` configuration file (e.g. `%LOCALAPPDATA%\Programs\dam-hopper\.env`), (2) the canonical user configuration directory (`%USERPROFILE%\.config\dam-hopper\.env`), and (3) the current working directory. Variables set in the system/shell environment take precedence; this allows placing `MONGODB_URI` and `MONGODB_DATABASE` right next to `dam-hopper.toml`.
- **Platform boundaries:** Windows direct-server operation does not provide Linux systemd service management, manager migration, or terminal idle-suspend helper semantics. The server runs as a direct foreground process managed by the user or an external supervisor.
### Windows Server Loopback Smoke Checklist

To verify `dam-hopper-server` on Windows 11 without exposing network endpoints or touching production configuration:

1. **Create an isolated temporary configuration**:
   ```powershell
   # PowerShell
   $tempConfig = [System.IO.Path]::GetTempFileName() + ".toml"
   @'
   [workspace]
   name = "windows-smoke"

   [[projects]]
   name = "smoke-proj"
   path = "."
   type = "cargo"
   '@ | Set-Content -Path $tempConfig -Encoding utf8
   ```

   ```cmd
   :: cmd.exe
   set TEMP_CONFIG=%TEMP%\dam-hopper-smoke.toml
   (
     echo [workspace]
     echo name = "windows-smoke"
     echo.
     echo [[projects]]
     echo name = "smoke-proj"
     echo path = "."
     echo type = "cargo"
   ) > "%TEMP_CONFIG%"
   ```

2. **Start the server bound strictly to loopback (`127.0.0.1`) with `--no-auth`**:
   ```powershell
   # PowerShell; pre-build to avoid a first-run compile delay.
   cargo build --manifest-path server/Cargo.toml --bins
   $outLog = [System.IO.Path]::GetTempFileName()
   $errLog = [System.IO.Path]::GetTempFileName()
   $job = Start-Process -FilePath "cargo" -ArgumentList "run", "--manifest-path", "server/Cargo.toml", "--", "--config", $tempConfig, "--host", "127.0.0.1", "--port", "4801", "--no-auth" -WorkingDirectory (Get-Location).Path -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
   ```

3. **Probe `/api/health` and verify HTTP 200 JSON**:
   ```powershell
   $res = $null
   $deadline = (Get-Date).AddSeconds(30)
   while ((Get-Date) -lt $deadline -and $null -eq $res) {
     try {
       $candidate = Invoke-RestMethod -Uri "http://127.0.0.1:4801/api/health"
       if ($candidate.status -eq "ok" -and $candidate.schemaVersion -eq 1) { $res = $candidate }
     } catch {}
     if ($null -eq $res) { Start-Sleep -Milliseconds 500 }
   }
   if ($null -eq $res) { throw "Server did not become healthy within 30 seconds" }
   $res | ConvertTo-Json
   # Expected: status = "ok", schemaVersion = 1, role = "api"
   ```

4. **Clean up the recorded server process and temporary files**:
   ```powershell
   if (!$job.HasExited) { & taskkill.exe /PID $job.Id /T /F | Out-Null }
   Wait-Process -Id $job.Id -Timeout 5 -ErrorAction SilentlyContinue
   Remove-Item -Path $tempConfig, $outLog, $errLog -Force
   ```

## Troubleshooting Configuration

### Registry or project path not found

Error: `Workspace directory does not exist` or missing project path errors

Check:

1. Registry path exists: `ls ~/.config/dam-hopper/dam-hopper.toml`
2. Each `projects[].path` exists
3. Relative project paths are resolved from the registry file directory
4. User has read permissions

### Project not discovered

Error: `Project not found: {name}`

Verify in dam-hopper.toml:

1. Project name is correct
2. Project path exists relative to the registry file directory or is an absolute path
3. Project type matches actual structure

```bash
ls -la /configured/project/path
```

### Session token issues

When a session expires or stops validating, sign in with password and complete
MFA again. The `server-token` file is a signing secret, not a bearer token;
see [Authentication API](../authentication-api.md).

## Example: Multi-Project Workspace

```toml
[workspace]
name = "web-app-monorepo"

[[projects]]
name = "backend"
path = "./services/backend"
type = "cargo"
env_file = ".env.backend"
tags = ["api", "critical"]

[[projects]]
name = "frontend"
path = "./packages/frontend"
type = "pnpm"
tags = ["ui"]

[[projects]]
name = "mobile"
path = "./apps/mobile"
type = "custom"
build_command = "flutter build apk"
run_command = "flutter run"
tags = ["ios", "android"]

[[projects]]
name = "docs"
path = "./docs"
type = "custom"
build_command = "yarn build"
run_command = "yarn start"

[agent_store]
path = ".dam-hopper/agent-store"
```

Start server:

```bash
dam-hopper-server --config ~/.config/dam-hopper/dam-hopper.toml --port 4800
```

All four projects now accessible via `/api/projects` and `/api/fs/list?project=frontend&path=src`, etc.

## OMP Agent Status Integration

`dam-hopper-server` embeds a standalone OMP extension. Install it on the server
host as the OS user running OMP inside DamHopper PTYs. `--agent-dir` is required
and must name an existing absolute agent directory: `$HOME/.omp/agent` for the
default profile; pass the exact directory for a named or custom profile.

```bash
dam-hopper-server integration omp install --agent-dir "$HOME/.omp/agent"
dam-hopper-server integration omp status --agent-dir "$HOME/.omp/agent"
dam-hopper-server integration omp uninstall --agent-dir "$HOME/.omp/agent"
```

Add `--json` to any command for JSON output. These local commands do not start
the API server or require its workspace registry, database, or server token.

- `install` atomically installs or updates only
  `extensions/dam-hopper-agent-status.ts`; current content is a no-op. Modified
  or unmanaged contents are refused.
- `status` reports `absent`, `current`, `outdated`, or `modified`.
- `uninstall` removes only verified managed content. The CLI rejects symlink or
  nonregular extension files; unrelated extensions remain untouched.
- OMP must load extensions. Restart existing OMP sessions after install/update.
  The adapter reports only from managed interactive root sessions; see the
  [agent-status architecture](../architecture/agent-status.md) for protocol,
  state/outcome mapping, privacy, reconnect, and compatibility details.
