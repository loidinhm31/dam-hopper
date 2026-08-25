# Phase 03: Implement evidence-selected compatibility

## Context links

- Parent: [plan.md](./plan.md)
- Evidence gate: [phase 01](./phase-01-capture-and-sanitize-otlp-evidence.md)
- Diagnostics: [phase 02](./phase-02-add-drop-reason-health.md)
- Decoder: `server/src/telemetry/codex_otlp/decoder.rs`
- Dedupe normalizer: `server/src/telemetry/codex_otlp/normalizer.rs`

## Overview

**Date:** 2026-08-07 · **Priority:** P1 · **Status:** completed · **Effort:** 2h

Make the smallest explicitly approved compatibility change. Keep 0.145.0 as the sole verified
semantic baseline. Phase 1 proves that Codex 0.146.1 has no trace/span identity, so use a bounded
HMAC of decoded fields only when the real identity is absent. This restores admission while keeping
the version unverified and making the dedupe tradeoff explicit.

## Key insights

- Event/version filters and the four core token attributes are already forward-compatible.
- Optional field drift is harmless because decoder allowlists known fields.
- Durable dedupe is strongest with a stable per-event source identity; timestamp or conversation
  alone is unsafe.
- The selected compatibility fallback is stable for replay of the same decoded event, but can
  intentionally collide for identical same-millisecond decoded events.
- Focused validation passed: 37 Codex OTLP tests, the authenticated Usage health regression, and
  `cargo check`; the release binary was built and live 4800/4811 smoke showed accepted unverified
  events with nonzero response/token totals.

## Requirements

- Exact 0.146.1 fixture decodes four token components and source version, with unverified quality,
  and is admissible through the fallback when trace/span are absent.
- Receiver continues to fail closed for invalid timestamps and other existing bounded failures;
  missing trace/span alone is no longer a drop for this compatibility path.
- Existing 0.145.0 fixture remains verified and all missing/partial-token behavior remains nullable.
- Unknown content attributes stay ignored and absent from decoded/persisted/API/log output.
- Never change `BASELINE_CODEX_VERSION` to 0.146.1 in this task.

## Architecture

| Evidence | Implementation | Forbidden |
|---|---|---|
| Valid nonzero 16-byte trace + 8-byte span | Existing `t...s...` identity takes precedence | Replacing provider identity |
| Trace/span absent — current 0.146.1 | **Selected B2:** HMAC of bounded decoded fields with `codex-usage:fallback-v1` domain | Raw content, receipt time, conversation ID alone, random UUID |
| Invalid timestamp | Existing `InvalidTimestamp` drop | Admitting an unbounded/invalid event |

For B2, trace/span remains preferred. The fallback input is limited to normalized source version,
source timestamp (or a fixed missing marker), conversation/model values, bounded token components,
duration, and counter semantic. It exists only as HMAC input and is never persisted as raw data.
Same-event replay stability is required; distinct-event uniqueness is best-effort and the known
collision limitation is accepted by the operator.

## Related code files

- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/decoder.rs` — retain 0.146.1 fixture tests and identity-shape coverage.
- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/normalizer.rs` — add B2 fallback construction and replay/change regression tests.
- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/tests.rs` — end-to-end fixture admission, persistence, replay, health, privacy.
- **Use:** `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/fixtures/codex-cli-0.146.1-response-completed.bin`.
- **No changes:** API DTOs, SQLite schema/store, worker queue, config manager, UI, auth, PTY.

## Implementation steps

1. Add decoder regression asserting event kind/name, exact `0.146.1`, all four token values,
   timestamp status, observed identity shape, and `unverified_version == true`.
2. Add normalizer regression asserting `SourceQuality::Unverified`, exact/nullable token quality,
   bounded occurred time, HMAC session fingerprint, and stable HMAC event ID on replay.
3. Add authenticated receiver integration test posting exact sanitized bytes. Assert 202, `queued=1`,
   `dropped=0`, `droppedMissingIdentity=0`, `unverifiedVersion=1`, non-null last accepted time,
   and one unverified DB row.
4. Post the same fixture again; wait for worker flush; assert one event/session and one duplicate.
5. Inject prompt/response/tool canaries into a decoded copy and prove they never reach SQLite,
   health JSON, or Usage API responses.
6. Run old 0.145.0 fixture regressions to prove verified behavior remains unchanged.
7. Prove missing trace/span uses fallback, real trace/span still wins, invalid timestamps still drop,
   and fallback input changes alter the dedupe ID without exposing content.

## Todo list

- [x] Evidence decision recorded: real 0.146.1 capture has no trace/span identity; B2 explicitly selected.
- [x] 0.146.1 decode/normalize/receiver regressions added.
- [x] Replay dedupe and fallback change behavior proven.
- [x] 0.145.0 verified baseline unchanged.
- [x] Content/privacy canaries absent from all durable/public surfaces.

## Success criteria

The sanitized 0.146.1 fixture must cross normalization, queue, worker, and SQLite through the
bounded fallback while remaining `unverified`. No raw content or source IDs may cross into durable
storage or public health output. Same decoded payloads must replay-dedupe; the accepted collision
limitation must be documented.

## Risk assessment

- Promoting version baseline would overstate token-semantic proof. Keep unverified.
- The fallback is intentionally weaker than a provider event ID; identical same-millisecond decoded
  events can dedupe. A future provider identity should supersede it when proven.
- Tests that inject trace/span into a fixture with missing raw identity can hide incompatibility;
  exact-byte receiver test must use fixture as checked in.

## Security considerations

Maintain bounded protobuf work, strict identifier length/type, domain-separated HMAC, nullable token
semantics, and no raw content logging. No secret/config/auth code changes are authorized.

## Next steps

Proceed to Phase 4 for the remaining broad-suite and deployment-helper verification. Do not change
the verified-version baseline or reset `telemetry.db`.

## Unresolved questions

- The operator accepted the bounded fallback tradeoff. Focused and live compatibility evidence is
  complete; broad-suite and stable helper-restart evidence remain in Phase 4.
