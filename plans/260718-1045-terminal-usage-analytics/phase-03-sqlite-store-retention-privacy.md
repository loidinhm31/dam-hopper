# Phase 03: SQLite Store, Retention, Privacy

## Context links

- [Parent plan](./plan.md)
- [Shell/SQLite research](./research/researcher-01-shell-sqlite-report.md)
- [Architecture gate](./reports/architecture-gate-report.md)
- [SQLite WAL](https://www.sqlite.org/wal.html)
- [Persistence patterns](../../docs/code-standards.md#persistence-patterns-phase-04-06)

## Overview

- Date: 2026-07-18
- Description: Add separate durable telemetry storage, bounded writer, rollup/purge, privacy controls, and query foundation.
- Priority: P1
- Implementation status: Complete (2026-07-26)
- Review status: Complete (2026-07-26)
- Effort: 40h

## Key Insights

- Reuse `rusqlite` patterns, not `sessions.db` semantics or connection.
- SQLite permits one writer; dashboard reads need WAL and separate read connection.
- User selected 90-day detail plus longer daily aggregates, so rollup-before-purge is required.
- PTY must remain healthy when DB locked, full, corrupt, or unavailable.

## Requirements

- Create `telemetry.db` mode `0600`; no silent recreate on corruption.
- One dedicated blocking writer fed by bounded non-blocking channel.
- WAL, `synchronous=NORMAL`, foreign keys, busy timeout, short transactions.
- Idempotent migrations and unique event keys.
- Roll daily counts/outcomes/token components before detail purge.
- Configurable retention, global pause, excluded projects, purge/delete-all.
- Aggregate query under 200 ms at 100k detail rows.
- Persist numeric drop/reject/purge/checkpoint health only.

## Architecture

Tables:

- `terminal_runs`: run/session/project/shell/integration/start/end/outcome/coverage.
- `command_events`: event/run/sequence/time/duration/status/category/executable/arg_count/HMAC/quality.
- `agent_runs`: provider conversation/run/model/time/status/correlation quality.
- `agent_usage_events`: dedupe ID/time/model/token components/duration/status/source version.
- `daily_usage_rollups`: UTC day + low-cardinality dimensions + counts/outcomes/durations summary/token sums.
- `telemetry_health`: named numeric counters and timestamps.

Daily rollups contain no HMAC/raw event identity. Historical p50/p95 beyond detail retention is unavailable unless histogram buckets are explicitly added later.

## Related code files

- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/store.rs` — connection setup, migrations, writes, aggregate reads.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/worker.rs` — bounded queue/batch/shutdown.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/retention.rs` — UTC rollup/purge.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/queries.rs` — parameterized aggregate queries.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/migrations/001_initial.sql` — telemetry-only schema.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/state.rs` — cheap-clone query/control handle.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/main.rs` — store/worker/purge startup and ordered shutdown.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/pty/manager.rs` — inject channel-backed sink.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/config/schema.rs` — resolved DB/key paths and retention bounds.

## Implementation Steps

1. Resolve telemetry DB/key paths without mutating session DB defaults. Create parent safely and set Unix mode.
2. Open writer connection; apply pragmas per connection. Open separate bounded-lifetime read connection or small read pool only if benchmarks require.
3. Add explicit migration list and schema version. Test empty, upgrade, repeat, partial failure.
4. Implement `TelemetryCmd` variants for run/command/agent/health/purge/shutdown containing normalized fields only.
5. Use `sync_channel`/bounded equivalent and `try_send` on PTY path. Batch by count/time; commit before acknowledging OTLP later.
6. On queue full, atomically count drops without logging event content. Flush health counter opportunistically.
7. Implement idempotent insert keys `(run_id, sequence)` and agent dedupe ID.
8. Upsert daily aggregate buckets transactionally before deleting expired detail in bounded chunks. Never double-count repeated purge.
9. Implement pause/excluded-project check before normalization queue; paused time remains a coverage gap.
10. Implement delete-all transaction, checkpoint, and explicit HMAC key reset flow; return progress/status without file paths.
11. Add store/query/retention/backpressure tests with temporary real SQLite files.

## Todo list

- [x] Separate DB and migrations pass.
- [x] WAL/busy/foreign-key pragmas verified per connection.
- [x] Bounded writer and graceful shutdown pass.
- [x] Rollup/purge idempotent at UTC cutoff.
- [x] Pause/exclusion/delete controls pass.
- [ ] 100k fixture benchmark deferred to Phase 04 aggregate API work.
- [x] DB content secret scan passes.

## Success Criteria

- Locked/full/read-only DB never blocks or terminates PTY flow.
- Replay/restart produces no duplicate command/token rows.
- Detail older than configured days removed only after daily rollup committed.
- DB contains no forbidden content under adversarial fixtures.
- 100k aggregate target under 200 ms on representative hardware; otherwise indexes/query plan adjusted before rollup expansion.

## Risk Assessment

- Writer starvation/long readers: short queries/transactions, WAL, busy timeout.
- WAL growth: passive checkpoints and health metric; truncate only low activity.
- Purge stalls: indexed bounded chunks.
- Corruption: fail telemetry closed, preserve file for recovery, keep PTY running.
- Rollup double count: deterministic bucket key and transactional upsert/delete boundary.

## Security Considerations

- DB/key `0600`; keys never inside DB or API.
- Parameterized queries only.
- No raw diagnostic fallback or dead-letter payload.
- Delete-all is authenticated/destructive with explicit UI confirmation in later phases.

## Next steps

- Phase 04 exposes aggregate/control API.
- Phase 05 reuses worker for Codex normalized events.

## Unresolved questions

- Aggregate retention default proposed unlimited; validation may set a finite value.
