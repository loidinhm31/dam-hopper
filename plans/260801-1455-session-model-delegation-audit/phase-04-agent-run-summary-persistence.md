# Phase 04 — Agent Run Summary Persistence

## Context links

- [Parent plan](./plan.md)
- [Phase 02 correlation](./phase-02-opt-in-terminal-correlation-and-model-types.md)
- [Phase 03 adapter](./phase-03-metadata-adapter-and-source-join.md)
- [Session summary research](./research/researcher-02-session-summary-design.md)
- `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/{store,worker,retention,queries}.rs`
- `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/migrations/001_initial.sql`

## Overview

- Date: 2026-08-01
- Description: Reuse `agent_runs` for permanent compact root/child summaries and integrate retention/deletion safely.
- Priority: P1
- Implementation status: **Completed (2026-08-01, Asia/Ho_Chi_Minh)**
- Review status: **Validation evidence recorded; flat OTel-only scope accepted after Phase 01 FAIL**

## Key Insights

- `agent_runs` exists but is unused; it is the simplest durable node seam.
- Raw `agent_usage_events` remain detail-retained; summary upserts must be monotonic and replay-safe.
- Nullable values mean unknown, not zero. Cached input remains separate.
- Add a separate summary table only after a measured 100k-node query failure.

## Requirements

- Migration adds root/parent HMAC IDs, terminal correlation, role/model/status, timestamps, nullable token totals, source/coverage quality, and update time.
- Preserve existing migrations, WAL, one writer, read-only readers, busy timeout, and bounded admission.
- Upsert repeated app-server snapshots and OTel deltas idempotently; reject stale/conflicting updates.
- Preserve exact root/child edges; no time/model inference.
- Finalize compact totals before raw detail purge; permanent summaries survive age retention.
- Range/all delete includes summaries, raw events, health rows, and existing HMAC rotation semantics.

## Architecture

Use HMAC provider thread/conversation IDs as `agent_runs.run_id`; root has nullable parent and child has root/parent IDs. Store a HMAC terminal association rather than raw marker/provider ID. Token components are accumulated according to explicit delta/cumulative semantics. Query roots and children in bounded batches; do not add a second database or transcript table.

## Related code files

- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/migrations/002_agent_run_summaries.sql` — ordered schema update/indexes.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/types.rs` — node/session DTOs and quality enums.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/store.rs` — migrations, upserts, purge/delete, idempotency.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/worker.rs` — commands/barriers/finalization.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/retention.rs` — summary finalization before raw purge.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/queries.rs` — root/node bounded reads and aggregates.
- Add Rust migration/store/retention/privacy/performance tests alongside modules.

## Implementation Steps

1. Specify migration columns, nullability, indexes, and upgrade/repeat behavior.
2. Add normalized node upsert commands and stable identity semantics.
3. Join OTel event counters to nodes; preserve partial/unavailable components.
4. Finalize root/child totals before detail purge without double counting.
5. Extend range/all deletion under the existing coordinator/barrier.
6. Benchmark root list/tree detail with 100k nodes and raw events; add summary table only if evidence requires.

## Todo list — completed 2026-08-01

- [x] Migration upgrade/repeat tests (`failed_v2_migration_rolls_back_all_prior_schema_changes`)
- [x] Root/child upsert and replay tests (`flat_agent_summary_is_replay_safe_and_keeps_multiple_terminals`)
- [x] Delta/cumulative conflict tests (`cumulative_summary_rejects_stale_and_conflicting_updates`)
- [x] Retention finalization tests (`retention_finalizes_pending_summary_before_raw_purge`)
- [x] Range/all delete and key rotation tests (`range_delete_removes_overlapping_summary_and_all_clears_associations`)
- [x] 100k-node query benchmark (`agent_summary_list_stays_under_200ms_for_100k_nodes`; indexed query plan asserted)

## Success Criteria

- Restart/replay produces one node and correct totals.
- Permanent summaries remain after raw detail purge and are deleted by explicit range/all actions.
- Existing aggregate endpoint values remain unchanged.
- Indexed list/tree p95 stays below 200 ms on representative 100k-node data.

## Risk Assessment

- Summary drift from late events: monotonic upserts and coverage partial state.
- Permanent growth: one compact row per node, cursor APIs, operational health metrics.
- Migration incompatibility: ordered schema version and temporary database upgrade fixtures.

## Security Considerations

- HMAC IDs only; no raw provider/terminal markers.
- SQLite permissions/WAL hardening unchanged.
- Worker/store errors never block PTY.
- SQL parameters for every user filter/cursor.

## Completion notes

Phase 01 failed its privacy boundary, so Phase 04 persists only flat OTel model/token rows with `lineage_unavailable`; it does not run the app-server adapter or create/infer parent edges. `agent_runs` remains the single summary seam and terminal associations are separate, bounded HMAC rows, preventing duplicate node totals.

Migration SQL is runtime-managed by the telemetry store migration runner; do not apply `002_agent_run_summaries.sql` manually. A failed key rotation may leave a temporary `.next` keyring file until retry.

## Next steps

Phase 05 exposes bounded protected reads over these summaries. If Phase 01 failed, persist flat OTel model/token nodes with lineage unavailable only.

## Unresolved questions

- None for Phase 04; multiple associations and overlap deletion semantics are covered by the completed tests.
