# Agent Status, Usage, and Session Persistence APIs

These route contracts moved from the [API reference index](../api-reference.md).
## Agent Status API (OMP-first Phases 01–05; native Phases 01–06)

The OMP-first semantic status track is complete through Linux x86_64 Phase 05
qualification with OMP 18.4.1 across C01–C19. The separate Codex/Claude native
rollout completed Phases 01–06 and passed Linux x86_64 live qualification on
Codex CLI 0.158.0 and Claude Code 2.1.250 (N01–N32); other provider versions
and server platforms remain unqualified. See the
[agent-status architecture](../architecture/agent-status.md), the
[OMP qualification report](../../plans/reports/qualification-260928-1815-agent-status-omp.md),
and the [native qualification report](../../plans/reports/qualification-260930-1045-agent-status-linux-qualification.md).
The snapshot route uses normal `/api/*` Bearer auth middleware.

### GET /api/agent-status/v1/snapshot

Returns the current active agent status snapshot across all live managed terminals.

**Response:**

```json
{
  "version": 1,
  "serverEpoch": 4305114706658182,
  "revision": 1,
  "availability": "ready",
  "terminals": [
    {
      "id": "term-1",
      "incarnation": 1833568411063296,
      "agentKind": "omp",
      "agentSessionId": "sess-1",
      "reporterEpoch": 1,
      "state": "working",
      "turnId": "turn-100",
      "attentionRevision": 0
    }
  ]
}
```

- `version`: Protocol version (`1`).
- `serverEpoch`: Random epoch generated per server process start.
- `revision`: Monotonically increasing state sequence.
- `availability`: `"ready" | "unavailable" | "platform-unqualified"`.
- `terminals`: Array of active agent status rows.

## Codex Usage Analytics

Protected, aggregate-only analytics for the local Codex telemetry store. All routes require
the same Bearer token as other `/api/*` routes; raw prompts, responses, commands, tool content,
event rows, bearer tokens, and storage identifiers are never returned. The UI calls these through
`WsTransport` methods
`usage:summary`, `usage:sessions`, `usage:session`, `usage:health`, `usage:settings`,
`usage:setupStatus`, `usage:updateSettings`, `usage:configure`, and `usage:deleteAll`, which map to the
REST routes below.

### GET /api/usage/summary

Returns Codex token totals and bounded UTC time buckets. Query parameters use camelCase:
`from`/`to` (UTC milliseconds) or `window` (`24h`, `7d`, `30d`), `bucket` (`hour` or `day`), and
optional `model`. Explicit ranges must be positive and contain at most 1,000 buckets; hour ranges
are capped at 90 days and day ranges at five years. Removed terminal, project, shell,
capture-quality, category, and agent filters are rejected, including unknown query keys.

The optional `model` filter accepts 1–64 safe ASCII characters, starts and ends with an
alphanumeric character, and may contain `.`, `_`, `-`, `/`, or `:`.

The response contains `range`, nullable `codex` totals, nullable `timeSeries` buckets, and
`health`. Unavailable or paused telemetry is represented by state and nullable projections rather
than fabricated zero-valued usage.

### GET /api/usage/health

Returns telemetry availability, paused state, writer errors, rejected events, the sampling
timestamp, and bounded Codex collector counters. Collector status is reported separately from
usage totals so an unavailable receiver cannot be mistaken for no activity.
The collector counters include the legacy aggregate `dropped` total plus additive
`droppedMissingIdentity`, `droppedInvalidTimestamp`, `droppedPaused`, `droppedQueueFull`, and
`droppedWorkerUnavailable` totals. These are fixed-cardinality in-memory counters, contain no
source values or payload fragments, and reset when the server process restarts.
`droppedMissingIdentity` is retained for compatibility with older collector behavior and remains
zero when the bounded fallback is active.
Codex CLI 0.146.1 token-bearing `response.completed` records without trace/span identity use a
bounded domain-separated HMAC fallback over normalized decoded fields and remain `unverified`.
When a valid trace/span identity is present, it takes precedence over the fallback.
The fallback is stable for replay but may dedupe identical same-millisecond decoded events. Invalid
timestamps still fail closed. The fixed health counters above are the only additive diagnostic
fields; no raw identity, content, or new Codex event/SQLite field is exposed.

### GET/PATCH /api/usage/settings

Reads or updates `enabled`, `paused`, `detailRetentionDays`, `aggregateRetentionDays`, `collector`,
`codexExporter`, and `retryCollector`. Exporter status is one of `notConfigured`, `managed`, or
`conflict`; bearer material is never returned. Managed files are changed only when their exact
ownership shape matches, and writes are atomic with owner-only (`0600`) secrets.

Runtime transitions and configuration writes are transactional: a failed restart, retention
operation, or registry write restores the prior live state and rejects the update. Collector
changes restart only the loopback listener; managing Codex configuration does not restart Codex.
Removed terminal-correlation and project-exclusion settings are not accepted or serialized.

### GET/PATCH /api/usage/setup

Returns the compact setup status used by Settings > Usage insights: telemetry enabled/paused
state, collector enabled state, runtime/receiver health, and optional local Codex exporter
status. `PATCH` accepts setup fields including `enabled`, `codexExporter`, and `retryCollector`.
It returns status only; bearer material is never returned. The Settings flow uses this route for
live enable/disable, receiver retry, and explicit Codex exporter management.

### GET /api/usage/sessions

Lists flat, aggregate Codex session summaries. Query parameters are `from`, `to`, `model`, `limit`,
and opaque `cursor`. The default range is the most recent 30 days; explicit ranges are capped at
five years. `limit` defaults to 25 and is bounded to 1–100. Cursors are authenticated, opaque,
and scoped to the range and model filter that created them. Removed terminal and lineage filters
are rejected.

The response is `{ range: { from, to }, sessions, nextCursor, paused }`. Each session contains a
derived HMAC `id`, UTC start/end timestamps, an optional model, token components, and bounded model
summaries. No hierarchy, terminal reference, command, or raw event content is exposed.

### GET /api/usage/sessions/{id}

Returns one bounded flat session summary identified by the derived HMAC `id` from the list response.
The response contains `{ session, paused }`; a missing session returns not found. Detail responses
contain only the same Codex token/model projections as the list route.

The shared browser/native Usage page presents these routes as a Sessions tab with list/detail
navigation. It uses `view=sessions`, `session`, and opaque authenticated `cursor` parameters for
deep links. List and detail queries refetch every 15 seconds only while the document is visible;
hidden documents stop polling. Paused collection leaves stored summaries readable and marks
responses as paused; deletion remains an explicit destructive operation.

### Flat Codex session summaries (internal store contract)

Accepted Codex `response.completed` events maintain one flat summary per HMAC session while it is
inside the configured detail-retention window. Summaries are purged with expired detail data; they
are not permanent. Summaries contain safe provider/model/status, nullable token components, and
explicit `delta` or `cumulative` semantics. The session routes above project these summaries into
bounded list/detail responses and never expose the underlying rows.

### DELETE /api/usage

Destructive deletion requires the exact JSON confirmation string
`"delete-usage-data"`. Omitting `from` and `to` deletes all detail, rollups, and health
rows. To delete a range, provide both `from` and `to` as non-negative UTC milliseconds,
strictly increasing and aligned to UTC-day boundaries; ranges are limited to five years.
Capture is paused behind an ordered deletion barrier and the exact live admission state is restored
on success or failure. Full deletion rotates the shared telemetry HMAC key after the rows are
deleted; range deletion keeps it so retained fingerprints remain comparable. The UI must present
an explicit confirmation before calling this route.

## Session Persistence API (Phase 05)

Terminal session buffers and metadata are persisted to SQLite when the configured database can be opened. This supports live cross-device resume and DamHopper server-restart relaunch with recovered scrollback; it does not preserve exact shell/process memory across server or host restart.

### Configuration

```toml
[server]
session_db_path = "~/.config/dam-hopper/sessions.db"       # Database path (supports ~)
session_buffer_ttl_hours = 720                       # 30-day retention (default)
```

### How Persistence Works

1. **Automatic**: When session is created, it's recorded to SQLite along with environment
2. **Batched**: Buffer snapshots sent every 16KB during output (throttled)
3. **Final snapshots**: Session exit and graceful server shutdown persist the latest buffer, including output under 16KB
4. **Recoverable**: Up to 1 MB of retained scrollback is replayed on attach
5. **Relaunched**: Sessions alive before DamHopper server shutdown are relaunched on restart

### Affected Endpoints

**GET /api/terminal/list** — Returns:

```json
[
  {
    "id": "uuid",
    "project": "project-name",
    "command": "npm run dev",
    "cwd": "/path",
    "alive": true,
    "exit_code": null,
    "buffer_bytes": 1048576,
    "persisted": true, // Phase 05: new field
    "started_at": 1234567890
  }
]
```

### Storage Details

**Database Schema** (Phase 05):

- `sessions` table — session metadata (id, project, command, env, cols, rows, restart_max_retries, created_at)
- `session_buffers` table — binary buffer data (session_id, data BLOB, total_written, updated_at)

**Storage Efficiency**:

- Batching: Only latest buffer per session written (intermediates discarded)
- Throttling: Every 16KB, not every read (99% fewer allocations)
- Memory: 16MB/sec churn (vs. 256MB/sec unoptimized)

### Worker Thread Architecture

- **Dedicated thread**: `persist-worker` daemon (see logs)
- **Bounded queue**: 256 slots (64MB max capacity)
- **Non-blocking sends**: Failed sends safe to drop (batching semantics)
- **Graceful shutdown**: all pending buffers flushed before process exit

### Monitoring

Track persistence health via logs:

```bash
# Enabled on startup
info: Session persistence enabled (path: ~/.config/dam-hopper/sessions.db)
info: Persist worker thread spawned

# Queue full (rare, indicates slow worker)
warn: Persist queue full, dropping BufferUpdate

# On session exit
info: Flushing session buffer on exit

# On shutdown
info: Persist worker stopped
```

The historical Phase 05 persistence design is retained in this document; its source plan is no longer present in this checkout.


