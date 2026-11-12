# Phase 03 — Server adaptive capture tiers

## Context links
[Overview](plan.md) · [Measurement](phase-01-measurement-and-feedback.md) · [Performance prerequisites](phase-02-hot-path-and-client-performance.md) · [Initial ladder/hysteresis](../reports/researcher-261112-1205-network-adaptive-screencast-quality.md) · [CDP semantics/version limits](../reports/researcher-261112-1205-cdp-screencast-performance-best-practices.md) · [Existing stream recovery](../261109-2251-host-browser-review-remediation/phase-02-stream-input-contracts.md) · [UI/wire integration](phase-04-viewer-quality-controls.md).

## Overview
Date: 2026-11-12 · Priority: P2 · Implementation status: pending (0/2) · Review status: coordinator review pending · Effort: 20h.
Depends on all Phase 02 tasks. External hard gates: `unify-geometry-counters` (including SI-04 ABBA and applied geometry), `recover-screencast-runs` (native credits/demand/run publication), `bound-browser-payloads`, `enforce-paired-input-lifecycle`; client run/audio cutover also waits for `fence-client-input-decoding`. These fixes remain exclusively upstream.

## Key Insights
- Capture policy is copied scalar FPS/quality in producer handles; modifying the original does not update clones. Use one shared validated versioned snapshot, not another registry or scattered atomics.
- `Page.startScreencast` supports image bounds/quality, not seamless reconfigure; serialize stop → apply latest capture settings → fresh-run start. Do not reissue active start or ignore errors.
- JPEG pixel dimensions and CSS geometry are already separate; aspect-fit u/v input is safe only if authoritative CSS metadata remains invariant under downscale. `deviceWidth/deviceHeight` DIP behavior must be checked on deployed Chromium before input trust.
- Viewer pacing saves wire bandwidth, not already-produced native encoding. Quality/size reduce upstream work; optional native divisor requires actual measurement.
- PCM base64 is about 512kbps before envelope/TLS at continuous 24kHz mono, so lowest-tier audio suppression is essential, not merely playback muting.

## Requirements
- One shared encoder per target, slowest **eligible** viewer sets capture fidelity (minimum tier); per-viewer delivery cadence independent. Eligible = currently visible live subscription, demand unexpired (existing 15s), not stalled. Pair/control lease does not confer tier priority.
- Proposed stalled definition: outstanding bytes without credit progress for `clamp(4 × serviceBaseline, 5s, 15s)`; unknown baseline uses 5s. Stop new sends to stalled viewer, exclude vote, retain current existing timeout/close safety. Resume voting only after valid current-subscription progress, with conservative warmup; hidden/expired/stalled cannot permanently pin minimum.
- Initial Auto Medium/warming when capacity unknown, bounded upward probe during busy motion; optional network API hint not required. Static or application-limited samples freeze capacity inference. High fixed RTT limits feasible pacing through two credits but alone never reduces quality/resolution.
- Degrade in strict order: reduce viewer FPS to next candidate ceiling, then JPEG quality, then resolution if pressure persists. Recover resolution first, then JPEG quality, then viewer FPS, one step per healthy dwell. Manual settings cap requested fidelity, never disable congestion safety/admin caps. Low includes Constrained; High cannot override another eligible viewer's lower vote.
- FPS is at most configured `frame_rate_fps` (default 24, max30), JPEG at most configured `jpeg_quality` (default75), image bounds at most configured dimensions and absolute protocol caps. Proposals below clamp to these ceilings; never upscale source.
- One `StartScreencastParams` builder, explicit JPEG, aspect-preserving maxWidth/maxHeight, quality and default `everyNthFrame=1`; shared snapshot drives governor and bounded fallback. No CSS viewport/DPR/viewportEpoch mutation for capture-only switch.
- Capture switch rotates video `producerRun`, fences/clears incompatible candidates, preserves prior pixels **display-only/input-untrusted** until current-run native frame. Abort/recover on stop/start failure using upstream transition owner; never publish unapplied settings as effective.
- Audio authority must survive capture-only restart. Separate stable audio source/run identity from video `producerRun`; source/document/owner/privacy changes still invalidate it. Suppress new audio enqueue/write for muted or **viewer effective Constrained** tier, plus existing hidden/stalled/expired gates; cancel queued stale audio and show reason later. Resumption starts with fresh chunks, no replay.
- No per-viewer re-encode, extra producer, delay of native CDP ACK to a slow viewer, viewport API adaptation, change to page stealth setup or default audio format.

## Architecture
`ViewerCreditController` estimator → small `AdaptiveStreamController` (viewer demand/preferences/pacing decisions) → target-level minimum fidelity vote → `CaptureTierSnapshot {version, tier, scale, jpegQuality, captureCadence}` in shared `Arc` + watch notification. Existing producer clone handles reference it. Per-viewer mutable pacing stays in credit controller; target governor uses maximum currently demanded viewer FPS capped by config, so a slow viewer does not lower faster delivery cadence. Shared fidelity still follows minimum vote.
Use two focused Rust modules: tier values/validation/builder math in `capture_tier.rs`, bounded decision state in `adaptive_stream_controller.rs`, each aim <200 production lines. Existing lifecycle owner from remediation is sole stop/start actor; no tier-owned task competing with resize/demand/recovery. Coalesce tier intents by latest version while a transition runs, recheck demand/current geometry and apply newest version before publication; emit effective state only after successful first matching frame.

### Initial four-tier ladder — calibration targets, not measured network classes
| Internal tier | Proposed residual video budget | Scale | JPEG ceiling | Viewer FPS ceiling |
| --- | --- | --- | --- | --- |
| High | ≥4000kbps | 1.0 | 80 (normally clamped75) | 20 |
| Medium | 1500–3999kbps | 1.0 | 65 | 10 |
| Low | 500–1499kbps | 0.75 | 60 | 6 |
| Constrained | <500kbps | 0.5 | 55 | 2; lower if needed |
Tier denotes desired/effective image envelope; changes within a tier transition are staged one knob at a time (FPS → quality → scale), not a new fifth named tier. Reverse on recovery. Every intermediate snapshot is validated/versioned; UI reports actual parameters and transition/warming status, not a falsely applied tier.
Budget model: include full BHJF wire bytes and actual audio text bytes; allow ≥25% headroom. ACKed video goodput is achieved video service, **not raw capacity**; do not count unacknowledged sent audio as ACKed goodput or subtract audio twice. Evaluate `8 × rollingFrameBytes × proposedFPS / 1000 + measuredAudioKbps` against conservative busy-workload estimate; if estimate uncertain, hold/probe cautiously, never claim guaranteed tier fit from Mbps thresholds alone. Muting/Constrained suppression removes future audio reserve after queued writes retire.
Controller starting targets: evaluate 1s; downshift after 2 pressured windows; recovery after 10 healthy busy seconds and next demand fits ≥25% headroom; minimum 5s capture-change dwell. Pressure requires rising service above baseline by `max(100ms, 0.5 × baseline)` plus backlog/saturation, or decoder cost above frame interval. Severe growing oldest-age bypasses dwell for **pacing only**. Decoder pressure is local overload, not reported internet speed. Pacing remains bounded even when image tier cannot go lower; existing write/credit expiry still closes hopeless peers.
Optional `everyNthFrame` coarse divisor only after Phase 05 encode/waste measurements justify it; divisor is not FPS, must not double-throttle. `maxFramesInFlight`/`sendLastFrame` are unverified with pinned `chromiumoxide_cdp=0.9.1` and deployed Chromium; baseline must not depend on them.

## Related code files
Exact writable files in tasks below. Create `capture_tier.rs`, `adaptive_stream_controller.rs`; register in existing `mod.rs`. Modify existing media producer/governor/audio authority and focused tests; no new API/service/transport. Phase 04 owns public media preference/event and full audio DTO cutover; internal setters here are real entrypoints used by current Auto/default behavior, not placeholders. No deletions outside obsolete copied scalar policy paths after every caller/clone has migrated.

## Implementation Steps
### adapt-viewer-pacing-and-shared-tier
1. Implement table validation/config clamping, staged degradation/recovery and deterministic decision clock. Replace static per-viewer interval with runtime pacing updates driven by estimator pressure; preserve constructor defaults and admin maximum.
2. Aggregate minimum requested sustainable fidelity across eligible viewers, max requested pacing for producer cadence. Manual preference setter and mute setter are subscription-owned internal commands; wire arrives Phase 04. No control lease checks on these settings.
3. Test two unequal viewers, hidden/expired/stalled exclusion/reentry, idle/warming, static high RTT, slow decoder, sparse captures, rapid preferences and admin ceilings. Snapshot versions monotonic/checked, no wrap or old policy overwrite.
### switch-capture-tier-and-audio
4. Replace every copied scalar capture policy/clone handle with shared snapshot; centralize both existing StartScreencastParams sites and fallback quality/bounds. Rebuild/reset governor on policy notification using Skip, preserving prompt native ACK independent of viewers.
5. Integrate tier intent into upstream serialized stop/start/resize/recovery owner. Rotate fresh video run, preserve CSS geometry/epoch, fence old work before awaits and publication; do not introduce another lifecycle lock. Keep last display unavailable for input until fresh qualified frame.
6. Decouple audio source identity/lifetime from video-only restart; retain navigation `docEpoch`/subdocument and owner fences. Per-viewer mute/Constrained gate drops queued audio before send and records suppression reason; already-written bytes cannot be recalled.
7. Add runtime downscale qualification hook/test: DOM `innerWidth/innerHeight/devicePixelRatio`, metadata CSS dimensions, JPEG SOF and normalized click marker across1x/0.75x/0.5x. Until deployed-engine check passes, downscaled frames remain input-untrusted; do not weaken geometry validation to make them pass.

## Todo list
```evcrate-tasks
[
  {
    "id": "adapt-viewer-pacing-and-shared-tier", "title": "Choose bounded per-viewer pacing and slowest-visible shared fidelity", "blocked_by": ["secure-browser-transport"],
    "allowed_files": ["server/src/browser_host/capture_tier.rs", "server/src/browser_host/adaptive_stream_controller.rs", "server/src/browser_host/mod.rs", "server/src/browser_host/media.rs", "server/src/browser_host/viewer_delivery_estimator.rs", "server/src/browser_host/config.rs", "server/tests/browser_host_media.rs"],
    "constraints": ["External gates: enforce-paired-input-lifecycle and bound-browser-payloads; no new viewer registry/permit or per-viewer encode.", "Slowest visible non-stalled non-expired vote owns shared fidelity; FPS first, quality next, scale last; reverse recovery; all numerical controller values calibration targets."],
    "acceptance": ["Two unequal eligible viewers share minimum quality/scale but independent pacing; hidden/stalled/expired viewers cease voting; stale subscription feedback never mutates current policy.", "Idle cannot cause a speed downgrade, fixed RTT alone cannot reduce fidelity, decoder overload is distinguished; headroom/dwell prevent flapping and no setting exceeds effective admin ceilings."],
    "verification": ["Future: cd server && cargo test adaptive_stream_controller; cd server && cargo test capture_tier; cd server && cargo test --test browser_host_media; deterministic 1s pressure/recovery traces, mixed-viewer visibility/stall reentry and limits at config boundaries."]
  },
  {
    "id": "switch-capture-tier-and-audio", "title": "Apply versioned capture tiers with safe fresh runs and independent audio authority", "blocked_by": ["adapt-viewer-pacing-and-shared-tier"],
    "allowed_files": ["server/src/browser_host/capture_tier.rs", "server/src/browser_host/adaptive_stream_controller.rs", "server/src/browser_host/screencast.rs", "server/src/browser_host/media.rs", "server/src/browser_host/media_writer.rs", "server/src/browser_host/protocol.rs", "server/src/browser_host/diagnostics.rs", "server/tests/browser_host_screencast.rs", "server/tests/browser_host_media.rs", "server/tests/browser_host_input.rs", "server/tests/browser_host_bounds.rs"],
    "constraints": ["External hard gates: unify-geometry-counters including SI-04, recover-screencast-runs, bound-browser-payloads and fence-client-input-decoding; extend existing transition owner, do not re-plan their defects.", "One shared snapshot and parameter builder; stop/apply/fresh-run start; never viewport API or CSS/DPR changes. Preserve audio source authority across video-only changes; Phase 04 completes matched audio wire/client cutover before deployment."],
    "acceptance": ["Every producer clone reads current snapshot; tier-only switch changes video producerRun not viewportEpoch/CSS/DPR, fences old candidates and only announces effective settings after matching frame; failed start cannot advertise success.", "Muted or viewer-Constrained receives zero newly sent audio chunks after gate acknowledgement; capture-only restart keeps audio source/document authority and fresh resumption never replays queued audio.", "Downscaled JPEG dimensions remain distinct from invariant CSS geometry; deployed runtime metadata/DOM/click oracle required before input trust under scale changes."],
    "verification": ["Future: cd server && cargo test --test browser_host_screencast --test browser_host_media --test browser_host_input --test browser_host_bounds", "Future live Chromium: change tiers amid resize/pause/actor failure; assert stop-before-start, unchanged CSS/DPR/epoch, old-run rejection, bounded gap, per-viewer audio gates and continuous source identity. Phase 05 records actual binary/version and metadata behavior; no assumed pinned-version support."]
  }
]
```
- [ ] <!-- evcrate-task:adapt-viewer-pacing-and-shared-tier --> Adapt pacing and minimum eligible fidelity
- [ ] <!-- evcrate-task:switch-capture-tier-and-audio --> Switch fresh capture runs without unrelated audio reset

## Success Criteria
Controller trace respects two pressured windows/5s capture dwell/10 healthy-second recovery targets, with no oscillation on threshold jitter. High viewer retains independent FPS while image fidelity follows slow viewer; hidden/stalled removal eventually recovers only through healthy probes. Every snapshot config-valid, all handles see latest version, no native active-start reissue. CSS/DPR/viewportEpoch stable under capture-only changes; input remains untrusted until metadata oracle passes. Audio suppression proof is server-side zero chunks after acknowledged gate, not merely zero player gain. Commands above are planned, never executed by author.

## Risk Assessment
Slowest-visible is intentionally shared degradation, not isolation of quality; explain in UI. Bad client samples can force a bounded downshift but never expand resource limits. Stop/start gaps and unscaled fallback can break trust: keep last display-only pixels, make fallback obey scale bounds or remain explicitly input-untrusted bounded display-only fallback. Rollback: matched backend/UI static configured policy after drain; retain new authority/secure transport/remediation safety. Never roll back by changing CSS viewport or resurrecting copied scalar inconsistencies.

## Security Considerations
Telemetry/preference untrusted, bounded/validated, subscription-fenced, rate-limited and capped by admin ceilings; no control-lease requirement means no authorization bypass for navigation/input. Only admitted existing viewer can vote; no new unauthenticated surface. Tier switch never grants trusted input from unqualified metadata; native ACK release remains actor/run-owned. Preserve exact auth/owner/doc/audio source fences while separating video identity, reject old queued audio after gate/version changes.

## Next steps
Phase 04 exposes exact typed media controls/status and stable audio authority cutover end-to-end. Phase 05 measures ladder, gap and text quality; no production release of downscale before runtime coordinate qualification and matched client completion.
