# Phase 02 — Backward-compatible API, SSE, and client contract

## Context links
`server/src/system/{alerts.rs,types_v1.rs,monitor.rs}`, `server/src/api/{system.rs,router.rs,tests.rs}`, `server/src/pty/event_sink.rs`, `packages/ui/src/{api/client.ts,hooks/use-sse.ts,hooks/use-host-resource-alert-presentation.ts}`.

## Overview
- **Date:** 2026-08-11
- **Priority:** P1
- **Status:** completed 2026-08-11 04:07:13 +07:00

## Key Insights
Legacy GET already owns metric arrays; moving them into V1 is wrong. `snapshot.alert` is singular, whereas targets can coexist. Event data is untrusted and current validator accepts only known memory evidence.

## Requirements
Preserve authenticated GET paths, limits, response cap, envelope `host:alertChanged`, existing memory JSON, and old valid events. Add bounded target evidence/current alerts without new route or event; invalid nested evidence must not update cache.

## Architecture
Keep `alert` as deterministic highest-severity compatibility projection; add an optional additive current collection when needed for concurrent targets. Add optional temperature `{source,label,celsius}` and disk `{name,mountPoint,usagePercent,usedBytes,totalBytes}` evidence plus bounded kind/key. Event remains existing envelope and each transition is separately sent.

## Related code files
**Modify:** `server/src/system/{alerts.rs,types_v1.rs,monitor.rs}`, `server/src/api/{system.rs,router.rs,tests.rs}`, `server/src/pty/event_sink.rs`, `packages/ui/src/api/client.ts`, `packages/ui/src/hooks/{use-sse.ts,use-host-resource-alert-presentation.ts}`.  
**Tests:** `packages/ui/src/hooks/use-sse.test.ts`, presentation/transport co-located tests.  
**Create/Delete:** none.

## Implementation Steps
1. Make Rust serializable fields optional/additive; retain memory names and summary behavior.
2. Assert existing router middleware continues to protect metrics/snapshot/alerts and preserves history <=50.
3. Extend TypeScript DTOs additively; do not nest legacy metrics in V1.
4. Extend strict SSE validator: finite temp; disk percent 0–100; nonempty bounded source/mount/key/text; reject partial/unknown nested data.
5. Test old/new events, cache updates, invalid rejection, reconnect, presentation dedupe/recovery.

## Todo list
- [x] Add DTO/evidence/current-alert extension.
- [x] Preserve REST auth/limit/legacy-array API assertions.
- [x] Retain event envelope and transition-only delivery.
- [x] Add strict client validation and presentation tests.

## Success Criteria
Authenticated clients receive all valid target incidents through current REST/SSE flow; old payloads remain valid; malformed payloads cannot poison query cache.

## Risk Assessment
Concurrent alert projection can conceal lower-severity targets if collection is not exposed. Preserve singular field only for compatibility and make additive current set explicit/tested.

## Security Considerations
No auth/session/CORS change. Bound all display text/evidence; never broadcast raw samples, command/env data, errors, or unbounded mount input.

## Next steps
Phase 03 consumes legacy metrics for disclosure and additive evidence for presentation.
