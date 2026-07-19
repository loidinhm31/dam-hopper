# Phase 04: Aggregate API and Controls

## Context links

- [Parent plan](./plan.md)
- [Repository scout](./scout/scout-01-repository-touchpoints.md)
- [Architecture gate](./reports/architecture-gate-report.md)
- [API patterns](../../docs/code-standards.md#api-client-pattern)

## Overview

- Date: 2026-07-18
- Description: Expose protected, bounded aggregate queries and explicit privacy/retention controls; never expose event rows.
- Priority: P1
- Implementation status: Pending
- Review status: Pending
- Effort: 32h

## Key Insights

- Current protected Axum router is the correct browser boundary.
- Existing `WsTransport.invoke` maps logical channels to REST; reuse it.
- One summary payload prevents dashboard waterfalls, but split time series if size benchmark requires.
- Delete/pause/settings must be explicit and auditable without sensitive payloads.

## Requirements

- Protected endpoints for summary, time series if needed, health, settings, pause/exclusions, and delete-all.
- UTC `from/to`; allow `24h | 7d | 30d | custom`; cap custom range and bucket count.
- Filter by server project identity, shell, capture quality, agent, model.
- Return aggregates/coverage only; no HMAC, command event, conversation ID, raw model event, cwd, or paths.
- Distinguish null/unavailable from zero.
- Persist validated setting changes atomically using existing config write semantics.
- Delete-all requires explicit confirmation and CSRF-safe existing auth behavior.

## Architecture

Suggested routes:

- `GET /api/usage/summary`
- `GET /api/usage/timeseries` only if response-size gate selects split design
- `GET /api/usage/health`
- `GET /api/usage/settings`
- `PATCH /api/usage/settings`
- `DELETE /api/usage` with `{ confirmation: "delete-usage-data" }`

Query service builds parameterized SQL from validated enums/IDs. Recent windows read detail; dates beyond detail cutoff use daily rollups with a non-overlapping UTC boundary.

## Related code files

- Create `/mnt/data/ws/sharing/dam-hopper/server/src/api/usage.rs` — handlers, query/settings validation, response DTOs.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/mod.rs` — module export.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/router.rs` — protected route registration.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/tests.rs` — auth/validation/privacy/integration tests.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/config.rs` — reuse safe atomic config update path if needed.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/config/parser.rs` — roundtrip only if server telemetry fields need writer support.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/client.ts` — mirrored aggregate/settings DTOs.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/ws-transport.ts` — `usage:*` REST channel mapping.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/queries.ts` — query/mutation hooks and invalidation.

## Implementation Steps

1. Define Rust query parser with bounded timestamps, enum filters, project IDs, `bucket=hour|day`, and maximum points.
2. Define response DTO sections: range, terminal metrics, outcome/duration, category/project series, Codex token nullable section, coverage, health freshness.
3. Implement summary query with stable zero/null semantics and UTC bucket fill.
4. Benchmark payload/query. Split time series only if one response exceeds target size/latency.
5. Register under existing auth middleware. Add no usage route to WS or loopback collector router.
6. Implement settings read/update; validate retention bounds, loopback collector config, and excluded project names before atomic write/runtime apply.
7. Implement pause as no-new-event gate; do not rewrite old history.
8. Implement delete-all confirmation, worker coordination, DB purge/checkpoint, HMAC reset, and query invalidation signal/status.
9. Mirror camelCase DTOs in UI client and map `usage:*` channels.
10. Add tests for auth, invalid dates, range caps, SQL injection strings, unknown project, UTC/DST, rollup/detail cutoff, null usage, delete confirmation, and forbidden response fields.

## Todo list

- [ ] Aggregate endpoints protected and bounded.
- [ ] Detail/rollup boundary has no gap/double count.
- [ ] Settings roundtrip and runtime apply pass.
- [ ] Delete confirmation/reset pass.
- [ ] Client DTOs and query keys typed.
- [ ] API response content scan passes.

## Success Criteria

- Unauthenticated requests fail consistently with existing routes.
- 24h/7d/30d/project filters return fixture-exact totals/coverage.
- Missing Codex usage serializes null/unavailable, never false zero.
- No endpoint can enumerate command or agent event rows.
- Delete-all is idempotent and leaves collector/PTY in defined enabled/disabled state.
- Response under agreed size and query under 200 ms at 100k events.

## Risk Assessment

- Dashboard waterfall: prefer combined summary, measure before split.
- Range abuse: hard caps and parameterized SQL.
- Runtime/config divergence: one settings service owns validate/write/apply.
- Destructive purge race: serialize through worker and expose progress/conflict.

## Security Considerations

- Existing bearer auth applies to all LAN-facing usage routes.
- Loopback collector token and HMAC key never returned by browser API.
- Error messages contain no DB/config paths or rejected field values.
- Delete is explicit, authenticated, and non-GET.

## Next steps

- Phase 05 adds collector and normalized token data.
- Phase 06 consumes typed aggregate hooks.

## Unresolved questions

- Maximum custom range proposed 5 years for daily aggregates and 90 days for detail-only metrics; validate with product preference.
