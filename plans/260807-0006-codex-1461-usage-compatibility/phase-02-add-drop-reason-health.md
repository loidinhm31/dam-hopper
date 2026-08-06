# Phase 02: Add bounded drop-reason health

## Context links

- Parent: [plan.md](./plan.md)
- Health counters: `server/src/telemetry/codex_otlp/health.rs`
- Admission flow: `server/src/telemetry/codex_otlp/receiver.rs`
- Normalization boundary: `server/src/telemetry/codex_otlp/normalizer.rs`
- Usage API: `docs/api-reference.md#get-apiusagehealth`

## Overview

**Date:** 2026-08-07 · **Priority:** P1 · **Status:** pending · **Effort:** 2h

Retain aggregate `dropped` compatibility while adding bounded, reason-specific in-memory counters.
This is option C and the minimum observability needed to tell schema incompatibility from paused or
backpressured operation.

## Key insights

- `normalize(...) -> Option` erases whether identity or timestamp validation failed.
- Receiver increments one `dropped` counter for normalization, paused admission, queue full, and
  unavailable worker outcomes.
- An additive collector-health response is necessary for the requested live distinction; no DB
  schema, high-cardinality label, source value, or UI work is needed.

## Requirements

- Preserve existing `dropped` increment semantics and existing HTTP 202/503 behavior.
- Add exact counters for: missing source identity, invalid timestamp, paused admission, queue full,
  and worker unavailable/disconnected.
- Counter names must describe bounded categories only; never include version, model, IDs, paths,
  errors, payload fragments, or secrets.
- Expose counters through existing nested collector health JSON as additive camelCase fields.
- Do not persist counters in SQLite or change telemetry schema.

## Architecture

Return a private typed `NormalizationDropReason` from normalization. Receiver maps each normalize
or enqueue outcome to one reason-specific atomic counter and the legacy aggregate. Health snapshot
serializes totals through the existing authenticated Usage health/summary responses.

## Related code files

- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/normalizer.rs` — return typed drop reason; retain all validation.
- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/health.rs` — atomic counters and serialized snapshot fields.
- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/receiver.rs` — reason mapping without status/backpressure changes.
- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/tests.rs` — reason and aggregate integration assertions.
- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/api/tests.rs` — authenticated health/privacy contract assertions.
- **Modify:** `/mnt/data/ws/sharing/dam-hopper/docs/api-reference.md` — additive counter semantics.
- **Modify:** `/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md` — bounded diagnostic flow/invariant.

## Implementation steps

1. Introduce private enum variants `MissingSourceIdentity` and `InvalidTimestamp`; convert every
   existing `None` return to an explicit reason without changing acceptance rules.
2. Update normalizer unit tests to assert exact reasons, including absent/zero/incorrect-length
   trace/span and invalid/bounded timestamp cases.
3. Add atomics and camelCase snapshot fields: `droppedMissingIdentity`,
   `droppedInvalidTimestamp`, `droppedPaused`, `droppedQueueFull`, and
   `droppedWorkerUnavailable`. Keep `dropped` as the compatible aggregate.
4. In receiver, increment exactly one specific reason plus aggregate per dropped record. Preserve
   partial-request `lastAcceptedAtUtcMs` behavior and 503 retry signaling.
5. Expand receiver tests for each path and assert `dropped == sum(reasons)` for isolated requests.
6. Add Usage API test proving auth remains required, new values are numeric, and serialized health
   contains no raw version, identity, bearer, prompt, response, or tool content.
7. Document additive fields and that counters reset on process restart.

## Todo list

- [ ] Typed normalization reasons replace opaque `None`.
- [ ] Five bounded counters plus legacy aggregate implemented.
- [ ] Receiver status and queue semantics unchanged.
- [ ] Unit/integration/API privacy tests added.
- [ ] API and architecture docs updated minimally.

## Success criteria

- A missing-identity fixture increments only `droppedMissingIdentity` plus `dropped`.
- Paused, queue-full, unavailable-worker, and invalid-timestamp tests are independently observable.
- Accepted events still increment `queued` and set `lastAcceptedAtUtcMs`; no DB/API usage fields leak.

## Risk assessment

- Double-counting makes diagnostics misleading. Centralize the “specific + aggregate” increment.
- Changing Option to Result can alter control flow. Preserve validation order and add branch tests.
- Additive API fields can surprise exact-shape consumers. Existing API returns JSON objects; add a
  server contract test and document the extension. Do not alter or remove old fields.

## Security considerations

Health remains behind existing Usage authentication. Atomic counters are fixed-cardinality and
contain no attacker-controlled labels or payload data. Loopback receiver auth remains unchanged.

## Next steps

Use counter deltas in Phase 4 smoke. Do not interpret `unverifiedVersion` or `coreSchemaDrift` as a
drop reason; those remain compatibility-quality signals.

## Unresolved questions

None after counter names are confirmed against the Phase 1 structural result.
