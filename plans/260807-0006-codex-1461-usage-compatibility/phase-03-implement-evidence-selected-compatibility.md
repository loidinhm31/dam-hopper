# Phase 03: Implement evidence-selected compatibility

## Context links

- Parent: [plan.md](./plan.md)
- Evidence gate: [phase 01](./phase-01-capture-and-sanitize-otlp-evidence.md)
- Diagnostics: [phase 02](./phase-02-add-drop-reason-health.md)
- Decoder: `server/src/telemetry/codex_otlp/decoder.rs`
- Dedupe normalizer: `server/src/telemetry/codex_otlp/normalizer.rs`

## Overview

**Date:** 2026-08-07 · **Priority:** P1 · **Status:** blocked · **Effort:** 2h

Make the smallest evidence-supported change. Keep 0.145.0 as the sole verified semantic baseline.
Phase 1 proves that Codex 0.146.1 has no safe per-event identity, so compatibility admission is
blocked; only diagnostics may proceed until a future provider identity is proven.

## Key insights

- Event/version filters and the four core token attributes are already forward-compatible.
- Optional field drift is harmless because decoder allowlists known fields.
- Durable dedupe requires a stable per-event source identity; timestamp or conversation is unsafe.
- The safest likely result is A: real fixture plus regressions, with no new identity fallback.

## Requirements

- Exact 0.146.1 fixture decodes four token components and source version, with unverified quality,
  but remains intentionally non-admissible without source identity.
- Receiver continues to fail closed; no replay/persistence acceptance criterion is possible until a
  safe identity is available.
- Existing 0.145.0 fixture remains verified and all missing/partial-token behavior remains nullable.
- Unknown content attributes stay ignored and absent from decoded/persisted/API/log output.
- Never change `BASELINE_CODEX_VERSION` to 0.146.1 in this task.

## Architecture

| Evidence | Implementation | Forbidden |
|---|---|---|
| Valid nonzero 16-byte trace + 8-byte span | **A:** fixture/tests only; use existing `t...s...` identity | New fallback |
| Trace/span absent; stable unique bounded provider event ID proven | **B:** domain-tagged in-memory ID fallback | Raw ID persistence/logging |
| No safe per-event identity — current 0.146.1 evidence | **Blocked:** retain fail-closed drop and expose reason | Receipt time, timestamp, conversation ID, random UUID |

For B, trace/span remains preferred. Provider identity must have a distinct domain prefix, strict
type/length checks, and exist only as HMAC input. Prove same-event replay stability and distinct
event uniqueness from controlled captures/source semantics before coding it.

## Related code files

- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/decoder.rs` — add 0.146.1 fixture tests; B-only bounded provider-ID allowlist/fallback.
- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/normalizer.rs` — fixture quality/dedupe tests; B only if identity representation needs explicit domain handling.
- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/tests.rs` — end-to-end fixture admission, persistence, replay, health, privacy.
- **Use:** `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/fixtures/codex-cli-0.146.1-response-completed.bin`.
- **No changes:** API DTOs, SQLite schema/store, worker queue, config manager, UI, auth, PTY.

## Implementation steps

1. Add decoder regression asserting event kind/name, exact `0.146.1`, all four token values,
   timestamp status, observed identity shape, and `unverified_version == true`.
2. Add normalizer regression asserting `SourceQuality::Unverified`, exact/nullable token quality,
   bounded occurred time, HMAC session fingerprint, and stable HMAC event ID on replay.
3. Add authenticated receiver integration test posting exact sanitized bytes. Assert 202, `queued=1`,
   `dropped=0`, `unverifiedVersion=1`, non-null last accepted time, and one unverified DB row.
4. Post the same fixture again; wait for worker flush; assert one event/session and one duplicate.
5. Inject prompt/response/tool canaries into a decoded copy and prove they never reach SQLite,
   health JSON, or Usage API responses.
6. Run old 0.145.0 fixture regressions to prove verified behavior remains unchanged.
7. If Phase 1 selected B, first add failing missing-trace/span test, then implement only the proven
   attribute as domain-separated source identity. Add malformed/oversize/content-like rejection,
   trace/span precedence, replay, and distinct-event collision tests.
8. If neither A nor B can admit safely, stop implementation. Report exact missing-identity counter;
   do not weaken normalization to satisfy acceptance artificially.

## Todo list

- [x] Evidence decision recorded as blocked: real 0.146.1 capture has no safe per-event identity.
- [ ] 0.146.1 decode/normalize/receiver regressions added.
- [ ] Replay dedupe and distinct-event behavior proven.
- [ ] 0.145.0 verified baseline unchanged.
- [ ] Content/privacy canaries absent from all durable/public surfaces.

## Success criteria

This phase is blocked. The sanitized 0.146.1 fixture decodes and the decoder regression passes, but
it must not cross normalization, queue, worker, or SQLite without a safe per-event identity. No
unsafe identity or raw content may cross normalization.

## Risk assessment

- Promoting version baseline would overstate token-semantic proof. Keep unverified.
- A provider field may be response-scoped but not event-unique. B requires explicit collision proof.
- Tests that inject trace/span into a fixture with missing raw identity can hide incompatibility;
  exact-byte receiver test must use fixture as checked in.

## Security considerations

Maintain bounded protobuf work, strict identifier length/type, domain-separated HMAC, nullable token
semantics, and no raw content logging. No secret/config/auth code changes are authorized.

## Next steps

Do not proceed to Phase 4 compatibility acceptance until a future controlled capture proves a safe
per-event identity and the required privacy/dedupe tests pass. Phase 02 remains pending.

## Unresolved questions

- No unresolved Phase 01 decision remains: current 0.146.1 evidence blocks both fallback and
  compatibility admission. B field name and bound remain unspecified unless future evidence proves
  one; do not invent them in implementation.
