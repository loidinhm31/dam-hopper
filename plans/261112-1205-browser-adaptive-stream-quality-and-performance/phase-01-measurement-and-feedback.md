# Phase 01 — Measurement and feedback

## Context links
[Overview](plan.md) · [Network signals and estimator](../reports/researcher-261112-1205-network-adaptive-screencast-quality.md) · [Transport hooks](../reports/code-reviewer-261112-1205-browser-server-media-transport.md) · [Frame timestamp F7](../reports/code-reviewer-261112-1205-browser-server-frame-pipeline.md) · [UI signals](../reports/code-reviewer-261112-1205-browser-ui-client.md) · [Remediation stream tasks](../261109-2251-host-browser-review-remediation/phase-02-stream-input-contracts.md).

## Overview
Date: 2026-11-12 · Priority: P2 · Implementation status: completed (2/2, 2026-11-12) · Review status: Cycle 3 reviewed (8/10, 0 critical; HTTP diagnostics export & upstream prerequisite markers open) · Effort: 10h.
External gates: `unify-geometry-counters`, `enforce-paired-input-lifecycle`, `recover-screencast-runs`, `bound-browser-payloads`; client integration also waits for `fence-client-input-decoding`. Rebase on their actual contracts, not stale report line numbers. No capture, pacing, visibility, audio or selector behavior change in this phase.

## Key Insights
- `ViewerCreditController.outstanding` already stores `(TrackedBhjfFrame, Instant)`; removal currently throws timing away. ACK/discard is application service completion, **not network RTT**.
- Two outstanding frames impose a bandwidth-delay-product ceiling. Low observed bytes on static/FPS/credit-limited content do not prove a slow link.
- Current production delivery is `1 / configured frame_rate_fps` (default 24); 100ms is constructor default only. Preserve both semantics.
- Server-native capture timestamp and local monotonic receive/send/ACK instants have different purposes. Client/server wall clocks cannot produce trustworthy one-way latency.

## Requirements
- Per-viewer bounded estimator: ACKed BHJF bytes over **one busy observation interval**, minimum service baseline, service EWMA, oldest outstanding age, queued/send duration, pending replacements, broadcast lag, decoded/replaced counts. Count received-discarded bytes separately from useful-drawn bytes; no `sum(bytes/frameRTT)`.
- Instrument each actual write, including audio/control byte accounting. Retain admitted/send-complete times without treating flush completion as remote receipt.
- Detect idle/application-limited windows from candidate availability, intentional pacing, credit occupancy and pending state; retain unknown capacity rather than zero. ACK starvation with outstanding bytes is pressure, not a healthy empty sample.
- Native metadata capture timestamp finite/positive/plausible when present; preserve it as optional native time, record server receipt separately. Never rename receipt as capture or subtract host clocks for control decisions.
- Add small aggregate feedback to heartbeat and bounded decode duration to frameAck; retain exact subscription/run/viewport/frame identity, dispositions and 1KiB media control cap.
- Diagnostics: bounded latest per-viewer snapshot, aggregate counters and sample provenance/limited flags; no per-frame React state or unbounded history, no URLs/pixels/tokens.

## Architecture
`ViewerCreditController` owns a small `ViewerDeliveryEstimator`; existing media reader/writer records admitted bytes, successful writes, exact credit completion and pressure counters. Fixed accumulators/time buckets, monotonic clock injection for tests, no new async task per frame. Start with 1s windows and 3–5s EWMA smoothing, **calibration targets**, not controller actions.
Client controller measures `performance.now()` decode/draw durations and aggregates replacement counts in fields. Proposed heartbeat `telemetry: {sampleMs, decodedFrames, replacedFrames, decodeMsEwma}` and ACK `decodeMs` are optional bounded numbers; define exact integer/finite bounds in matching Rust/TS validators. Reject malformed fields using existing protocol policy; valid-but-outlandish samples cannot override server observations. Heartbeat remains every 5s; do not add frame-rate text chatter.
Reset transient run samples on `producerRun` changes/reconnect; retain a subscription-local stable service baseline only if identity is unchanged and mark the new run warming. Old-run completions cannot enter a new-run estimate. Cap diagnostic registry to admitted viewers and remove on pair teardown.

## Related code files
Exact ownership is the union of the two task allowlists below; no deletions. Modify existing media/protocol/diagnostics/CDP/screencast and UI transport types/controller/tests only. Create `server/src/browser_host/viewer_delivery_estimator.rs` (<200 production lines; focused tests may use a sibling snake_case module if explicitly added to ownership before execution). Register it in existing `mod.rs`; no generic telemetry service. Existing diagnostics endpoint is reused; no new unauthenticated route.

## Implementation Steps
### measure-viewer-delivery
1. Add estimator value types and bounded accumulators; expose snapshots from exact per-viewer credit lifecycle. Record replacement and lag counts instead of discarding them; count intentional pacing separately.
2. Consume outstanding `(frame, admitted_at)` before removal; derive wire-byte totals and monotonic service duration only for matched, first credit returns. Duplicate/foreign ACKs remain no-ops for measurements and credit.
3. Preserve native timestamp through ingress/candidate/header while keeping local receive instant. Capture missing/invalid timestamp as unavailable, not fabricated; diagnostics labels distinguish native capture, server receipt, local send and client draw submission.
4. Expose sampled snapshots via existing diagnostics, bounded by admission and scoped to owner/subscription. Production cadence/limits must remain identical with instrumentation enabled.
### publish-viewer-feedback
5. Add exact bounded optional feedback fields to Rust/TS controls; send decode duration with successful ACK and heartbeat aggregate replacements/decode only. No telemetry-only socket/message stream.
6. Keep one validation at untrusted receive boundary and original-socket dispositions; reset aggregates on owner/run changes and exclude hidden/obsolete/privacy discards from congestion replacements.
7. Author deterministic timing/idle/duplicate-credit/overflow tests plus wire malformed/oversize and client decode sample tests; coordinator executes later.

## Todo list
```evcrate-tasks
[
  {
    "id": "measure-viewer-delivery",
    "title": "Measure exact per-viewer delivery and preserve native capture time",
    "blocked_by": [],
    "allowed_files": ["server/src/browser_host/viewer_delivery_estimator.rs", "server/src/browser_host/mod.rs", "server/src/browser_host/media.rs", "server/src/browser_host/diagnostics.rs", "server/src/browser_host/cdp.rs", "server/src/browser_host/screencast.rs", "server/src/browser_host/protocol.rs", "server/tests/browser_host_media.rs", "server/tests/browser_host_screencast.rs"],
    "constraints": ["External prerequisite: remediation unify-geometry-counters, enforce-paired-input-lifecycle, recover-screencast-runs and bound-browser-payloads verified by coordinator before scheduling.", "No delivery/capture/audio behavior change; bounded estimator fields only; preserve exact credit authority and all reservations; no cross-host wall-clock latency inference."],
    "acceptance": ["Busy-window ACKed bytes, service baseline/EWMA, oldest age, replacements, lag and write durations are visible; idle/application-limited is explicit; duplicate or foreign credits cannot change estimates.", "Native capture time, when valid, survives to BHJF with separate receipt diagnostics; missing native timestamp is unavailable; default 24fps production and constructor behavior are unchanged."],
    "verification": ["Future: cd server && cargo test --test browser_host_media --test browser_host_screencast", "Future: cd server && cargo test viewer_delivery_estimator; deterministic overlapping-credit, sparse page, saturated credit, delayed ACK, wrong-run and timestamp fixtures; compare configured cadence before/after instrumentation."]
  },
  {
    "id": "publish-viewer-feedback",
    "title": "Carry bounded decode and replacement feedback on existing media controls",
    "blocked_by": ["measure-viewer-delivery"],
    "allowed_files": ["server/src/browser_host/protocol.rs", "server/src/browser_host/media.rs", "server/tests/browser_host_media.rs", "packages/ui/src/api/browser-host-types.ts", "packages/ui/src/browser-host/stream-controller.ts", "packages/ui/src/browser-host/stream-controller.test.ts"],
    "constraints": ["External prerequisite: remediation fence-client-input-decoding verified; do not reimplement decoder/owner fencing.", "Heartbeat/frameAck only, <=1024 UTF-8 bytes; finite bounded client samples are untrusted corroboration, not bandwidth authority; retain original-socket credits."],
    "acceptance": ["Rust/TS DTOs and validators agree at all sample bounds; worst-case controls stay within 1KiB; malformed telemetry follows existing fail-closed handling.", "Monotonic decode/draw timing and replaced-frame aggregates reset at identity changes, do not trigger React updates per frame and do not alter stream behavior."],
    "verification": ["Future: cd server && cargo test --test browser_host_media", "Future: pnpm --filter @dam-hopper/ui test src/browser-host/stream-controller.test.ts; pnpm --filter @dam-hopper/ui build; check worst-case serialized controls, NaN/infinity/negative/overflow and stale-socket samples."]
  }
]
```
- [x] <!-- evcrate-task:measure-viewer-delivery --> Measure delivery and native capture time
- [x] <!-- evcrate-task:publish-viewer-feedback --> Publish bounded decoder feedback

## Success Criteria
- Deterministic estimator fixtures produce exact total-byte/window rates (no overlap double-count); duplicate/foreign credits change neither rate nor occupancy.
- Static 30s page remains application-limited/unknown, never labeled slow; busy ACK starvation records oldest-age pressure. State and diagnostic entry counts remain O(admitted viewers), fixed space per viewer.
- Worst-case JSON ≤1024 bytes; no extra periodic message beyond current heartbeat, no new per-frame timer/task/React render. Valid timestamp survives; invalid/missing timestamps cannot fabricate latency.
- Planned commands above use repository `AGENTS.md` runners. No check has been executed during planning.

## Risk Assessment
ACK service includes decoder/main-thread and reader scheduling; record provenance and pressure signals separately. Phase 02 reader separation improves sample accuracy; do not tune from Phase 01 numbers alone. Rollback: remove optional measurement/feedback cutover as a matched backend/UI revision after draining pairs; keep remediation intact and restore configured static policy, not unsafe old credit logic.

## Security Considerations
Client telemetry/preference is untrusted: exact subscription/run fences, numeric bounds, existing 100 text-msg/s limit, 1KiB cap; measurements cannot raise admin FPS/quality/pixel/memory/viewer ceilings. No new unauthenticated surface, speed probe, sensitive content logging or persisted telemetry. Diagnostics require existing auth/owner rules; forged samples cannot create registry entries.

## Next steps
Phase 02 removes measurement distortion/repeated trusted work; Phase 03 consumes these observations only after its external run/geometry gates settle. Coordinator owns independent review, validation and all future test execution.
