# Phase 05 — Protected Session-Audit API

## Context links

- [Parent plan](./plan.md)
- [Summary persistence](./phase-04-agent-run-summary-persistence.md)
- [System architecture](/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md)
- `/mnt/data/ws/sharing/dam-hopper/server/src/api/usage.rs`
- `/mnt/data/ws/sharing/dam-hopper/server/src/api/router.rs`

## Overview

- Date: 2026-08-01
- Description: Add bounded authenticated session list/tree reads without weakening aggregate Usage contracts.
- Priority: P1
- Implementation status: Completed (2026-08-01)
- Review status: Approved (review cycle 3)

## Key Insights

- Existing Usage routes inherit protected router authentication and use bounded UTC queries.
- Browser must receive derived route IDs, never provider IDs, HMAC keys, markers, or raw event rows.
- Cursor pagination avoids deep OFFSET scans; tree detail needs a hard node cap.

## Requirements

- Keep `GET /api/usage/summary` unchanged.
- Add `GET /api/usage/sessions` with bounded from/to, model, terminal, limit, and opaque cursor filters.
- Add `GET /api/usage/sessions/{id}` with one tree, capped nodes/depth, and explicit 404/invalid-ID behavior.
- Return terminal label/derived ID, times, root model, child count, token components, main-token share, delegation state, and coverage.
- Return exact/partial/lineage-unavailable/token-data-unavailable states; no productivity/violation score.
- Apply range/all deletion and pause semantics to new reads consistently.

## Architecture

Handlers call query functions over root rows and one batched child query. Use stable `(ended_at DESC, id DESC)` cursor ordering, max page 100, max tree nodes 256, and existing range caps. Wire routes through the protected API router and map store errors through `ApiError`.

## Related code files

- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/router.rs` — protected routes.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/usage.rs` — query params/DTOs/list/detail handlers.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/queries.rs` — cursor/root/node query functions.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/ws-transport.ts` — endpoint mapping.
- Add Rust API integration/auth/bounds/privacy tests.

## Implementation Steps

1. Define camelCase wire DTOs and coverage/delegation enums.
2. Validate query ranges, cursors, limits, model identifiers, and derived IDs.
3. Implement root page plus one child batch; avoid N+1 queries.
4. Implement tree detail cap and missing-node handling.
5. Add transport mapping and query invalidation after delete/settings changes.
6. Scan serialized responses for forbidden content and raw identifiers.

## Todo list

- [x] List/detail DTOs
- [x] Cursor/range validation
- [x] Protected route registration
- [x] Batched root/child query
- [x] Auth/error/privacy tests
- [x] API performance benchmark

## Success Criteria

- Unauthorized requests fail through existing middleware.
- Valid pages are stable, bounded, and complete under cursor pagination.
- Detail response never exceeds node/depth caps or includes forbidden fields.
- Aggregate and session totals reconcile for every fixture.

## Risk Assessment

- API leaks pseudonymous identity: minimize fields and document derived IDs.
- Deep tree query cost: hard cap and indexed batched reads.
- Range deletion inconsistency: coordinate with existing barrier and test concurrent reads.

## Security Considerations

- Reuse bearer/cookie auth; no new unauthenticated or loopback browser route.
- Never expose HMAC key, raw marker, provider thread ID, SQL, or error body.
- Validate all cursors/IDs as opaque bounded values.

## Next steps

Phase 06 consumes these DTOs in shared Usage UI. Phase 07 adds browser and release gates.

## Unresolved questions

- Product wording for overlapping session range deletion.
- Whether terminal display should use project + short derived ID or a current client label.

## Completion evidence

- Protected list/detail routes are wired through the authenticated API router.
- Cursor/range/ID bounds, privacy allowlist, deletion overlap semantics, and paused-state behavior are covered by API tests.
- Tree node/depth caps and wide-frontier handling are covered by tests.
- 100k-root list benchmark remains below the 200 ms p95 requirement.
- Validation: `cargo test --manifest-path server/Cargo.toml --lib usage_session -- --nocapture` (5 passed, 2026-08-01).
