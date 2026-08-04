# Phase 02: Codex-only runtime and SQLite schema

## Context links

- Parent: [plan.md](./plan.md)
- Architecture: [Codex OTel usage](../../docs/system-architecture.md#codex-otel-usage-analytics)
- Research: [backend report](./research/researcher-01-backend-data-report.md)

## Overview

**Date:** 2026-08-02 · **Priority:** P1 · **Status:** Complete · **Completed:** 2026-08-04 09:45 Asia/Ho_Chi_Minh · **Review:** Pending

Make the loopback OTLP receiver write only normalized Codex events through a dedicated bounded
queue/worker. Replace combined terminal/agent tables with a fresh Codex sessions/events/rollups/
health schema; this development phase intentionally does not preserve old telemetry data.

## Key Insights

The existing worker shares an admission gate and queue with PTY commands. Existing migrations
002–006 add terminal joins and dimensions. Preserve nullable token and dedupe semantics, but remove
all terminal associations and fields from the durable model.

## Requirements

- OTLP is the sole durable input; receiver returns backpressure/auth errors honestly.
- Store only HMAC dedupe/session IDs, bounded model/version/status, duration, token components,
  counter semantic, and quality.
- Keep WAL/0600/short transactions, 100-event/250ms batching, retention rollup-before-purge.
- Missing token data is unavailable; future safe source versions are unverified, not rejected.
- Existing or malformed telemetry databases are discarded and recreated from the fresh v1 schema in
  development only; no telemetry migration or import is performed.
- Reset is bounded to the configured telemetry database, transactional, and protected by a distinct
  session-database path check; `sessions.db` is never a reset target.

## Architecture

`codex_otlp::receiver -> decoder -> normalizer -> CodexUsageEvent channel -> worker ->
codex_usage_events/codex_sessions/codex_daily_rollups/telemetry_health`. HMAC key remains local and
owner-only. No PTY or terminal table is reachable from this graph.

## Related code files

- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/{mod.rs,runtime.rs,worker.rs,
  store.rs,retention.rs,queries.rs,types.rs,privacy.rs}`, `codex_otlp/{receiver.rs,normalizer.rs,
  decoder.rs,health.rs}`.
- **Create:** `server/src/telemetry/schema.sql` and Codex-only store/query tests.
- **Delete/retire:** terminal branches in `sink.rs`, `command_classifier.rs`; legacy terminal
  migration SQL is removed because old databases are reset instead of imported.

## Implementation Steps

1. Define Codex-only event/session/rollup types and a queue API independent of PTY control.
2. Rework worker/store writes, dedupe, aggregation, retention, delete barriers, and health counters.
3. Add a fresh-schema initializer that drops user tables/views/triggers when the database is not the
   current Codex v1 shape, then creates the target tables/indexes without importing old data.
4. Keep the default path `~/.config/dam-hopper/telemetry.db`; document custom path handling.
5. Test real OTLP fixtures, malformed/oversized/auth failures, retries, partial tokens, future
   versions, queue saturation, WAL concurrency, migration and delete behavior.

## Todo list

- [x] Codex-only schema opens on fresh DB.
- [x] A legacy/malformed DB resets to a terminal-free fresh schema.
- [x] No raw prompt/content/command/cwd/tool fields reach DB/logs.
- [x] Delete and retention preserve ordering and key-rotation semantics.

## Success Criteria

**Met:** Only Codex tables exist in a fresh DB; old data is intentionally reset during development;
Rust telemetry tests pass with bounded, non-blocking OTLP ingestion.

## Validation

- `cargo test telemetry --lib` — passed: 67 passed, 0 failed, 0 ignored.
- Covered fresh/legacy/malformed schema reset, Codex-only tables, dedupe and unavailable tokens,
  retention-before-purge, delete/key rotation, queue saturation, OTLP auth/backpressure, bounded
  normalization, privacy scanning, and runtime lifecycle behavior.

## Risk Assessment

Schema reset can delete the configured telemetry database. Keep it separate from `sessions.db`, use
one transaction, and cover reset/reopen behavior with tests; this reset policy is development-only.

## Security Considerations

Keep loopback binding, bearer auth, body limits, key permissions, prompt suppression, and constant
time secret checks. Do not expose raw OTLP or bearer material in errors.

## Next steps

Phase 3 maps the Codex-only store to compatible API/config contracts; this remains pending.
