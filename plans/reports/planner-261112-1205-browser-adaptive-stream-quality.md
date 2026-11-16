# Browser adaptive stream quality — planner decisions

## Scope and evidence
2026-11-12 · branch `feat/ai-os-redesign` · [Canonical plan](../261112-1205-browser-adaptive-stream-quality-and-performance/plan.md).
Authoring only: six phases, 19 durable tasks; approved Phase06 input-defect extension included. No product/docs/other-plan edits, builds/tests/live probes, activation or task hydration. Coordinator retains independent plan review and final validation; pending, not implementation approval.
Read all six supplied reports, both overlapping remediation phases and overview, streaming frontmatter precedent, repository README/AGENTS/code standards, installed planning/development/task-authoring rules. Confirmed targeted current credit-control, Tools, media-DTO and selection-poll anchors. Supplied coordinator source corrections override conflicting report interpretations.
Installed planning skill loaded explicitly from `~/.omp/agent/skills/planning/SKILL.md` (project-local skill installation absent); no additional research/reviewer/interview spawned. Preferred architecture.md absent; subsystem architecture baseline exists. Scoped authoring cannot publish intended maintained architecture; coordinator owns pre-implementation architecture disposition and Phase05 final reconciliation.

## Binding decisions and derived contracts
- One shared encoder; minimum fidelity of visible/non-stalled/non-expired viewers, independent viewer FPS. Manual High cannot defeat slowest eligible viewer or admin cap; no control-lease priority.
- FPS → JPEG quality →0.75x→0.5x degradation; resolution → quality → FPS recovery. Four named tiers with staged parameter snapshots; 1s/2 pressure windows/5s dwell/10 healthy seconds and Mbps thresholds are calibration targets, not measured facts.
- CSS viewport/DPR/viewportEpoch invariant for capture-only switch. Use shared versioned capture snapshot, one parameter builder and existing serialized stop/start owner with fresh video producerRun. No network adaptation through viewport API.
- Viewer mute **or own service tier Constrained** suppresses server audio; show reason. Another faster viewer may retain audio even with shared low-fidelity pixels. Audio source identity decoupled as audioRun; matched full Rust/TS audio-only producerRun→audioRun cutover, video/credits unchanged, no aliases.
- Auto/High/Medium/Low in BrowserTools; default Auto, memory only, exact profile/generation/window/tab key, view-only operation. Show shared tier vs viewer FPS/service tier and pending status; no persistence schema edits.
- ACK service is not pure RTT; busy ACKed bytes are achieved video service, not raw-link capacity. Idle/application-limited freezes inference; native capture time distinct from local receipt and client draw submission. Client samples cannot raise ceilings.
- Start ladder High1x/Q80/20, Medium1x/Q65/10, Low0.75x/Q60/6, Constrained0.5x/Q55/2, clamped to admin limits (defaultQ75/24fps). Real frame bytes/audio demand/headroom override nominal thresholds; no promised percentage JPEG savings.
- Production delivery already honors configured FPS (default24); 100ms is constructor-only. MAX_GLOBAL_VIEWERS=2 remains a real config mismatch. Base64 Arc sharing/memory reservation already belongs to existing bound-browser-payloads; not re-planned.
- Native maxFramesInFlight/sendLastFrame unverified with pinned chromiumoxide_cdp=0.9.1/deployed engine; no baseline dependency. Metadata deviceWidth/Height believed DIP, but real CSS/metadata/JPEG/DOM-click downscale oracle required before trusted input.
- Approved Phase06 default chosen by coordinator: whole-paste admission, UTF-8-safe insertText chunks through existing paced/lease-fenced path, visible reject/interruption; proposed tunable16KiB raw total. Preserve4096 raw bytes/record,16KiB serialized control cap (escape-aware splitting),128 records/256KiB server queue and100/s limit; existing16KiB serialized handoff capacity may reject below total cap before any prefix.
- Phase06 wheel convention: tunable16 CSS px/line; page uses trusted remote CSS viewport per axis; tunable±4096px event/coalesced-axis clamp. Rust reads delta_x/delta_y; remove redundant TS camelCase fields only. Accepted-pointer capture respects lease/privacy/modal provenance; native cancel release/inline dispatch repair stays remediation-owned.
- Control scheduling task is P3 ordering-only: mandatory initial snapshot, cancel/deadline first, alternating ready update/input preference. No measured starvation, new dispatcher or performance gain claim.

## New work and ownership map
| Phase | New task IDs | Outcome |
| --- | --- | --- |
| 01 | measure-viewer-delivery; publish-viewer-feedback | Bounded estimator/native time, authenticated diagnostics, bounded heartbeat/ACK samples; no behavior change |
| 02 | reuse-validated-frames; make-client-rendering-truthful; decouple-media-writes | One trusted parse, honest decode/draw outcomes, bounded independent media writer and Skip ticks |
| 02 | bound-viewport-and-runtime-caps; bound-client-background-work; pace-client-input; secure-browser-transport | Residual no-op/coalescing/caps, document demand/polls/canvas, timer/rate headroom, secure credential transport |
| 03 | adapt-viewer-pacing-and-shared-tier; switch-capture-tier-and-audio | Eligible minimum fidelity, per-viewer pacing, safe versioned capture and independent audio lifetime |
| 04 | wire-viewer-quality-and-mute; expose-browser-quality-tools | Typed fenced controls/status, audioRun cutover, ephemeral Tools selector/indicators |
| 05 | qualify-adaptive-streaming; document-adaptive-streaming | 32-cell real WS/engine/text/input/audio evidence and maintained contracts/release notes |
| 06 | preserve-bounded-paste; capture-accepted-pointer; normalize-wheel-units; arbitrate-control-input-fairly | Complete bounded paste/visible rejection, outside-canvas release, canonical CSS wheel units, fair ready-branch ordering |
Exact writable lists are phase JSON contracts, new Rust snake_case/TS kebab-case modules aim<200 lines. Tasks serialize overlapping owners; Phase06 follows pace-client-input and its own chain, does not block Phases03–05. External remediation IDs stay in prose/constraints, not cross-plan blocked_by. Coordinator verifies receipts and arbitrates shared input/host/media/test paths before execution.

## Dedupe table — every labeled finding in the three code reviews
Prefixes: **FP**=[frame pipeline](code-reviewer-261112-1205-browser-server-frame-pipeline.md); **MT**=[media transport](code-reviewer-261112-1205-browser-server-media-transport.md); **UI**=[UI client](code-reviewer-261112-1205-browser-ui-client.md). **Existing** tasks belong only to [remediation](../261109-2251-host-browser-review-remediation/plan.md), not new work. Split dispositions cover distinct subfindings, never duplicate one repair.

| Finding | Disposition / owning task | Boundary / reason |
| --- | --- | --- |
| FP:P1 native encode wasted before governor | New P03 switch-capture-tier-and-audio; P05 qualify-adaptive-streaming | Quality/scale upstream now; optional native divisor only if measured, ACK independence preserved |
| FP:P2 base64 candidate clone | Existing bound-browser-payloads | Existing requirement explicitly shares ingress instead of cloning strings; new plan consumes result |
| FP:P3 ACK/fallback waits and catch-up ticks | Existing recover-screencast-runs for ACK admission/drain/cancellable fallback; New P02 decouple-media-writes for Skip | No duplicate ACK scheduler/fallback worker; unused metrics RPCs removed upstream only if made obsolete by that cutover |
| FP:F1 geometry/state ABBA | Existing unify-geometry-counters (SI-04) | Hard prerequisite to tier changes, not new lifecycle fix |
| FP:F2 active start/error/run identity | Existing unify-geometry-counters + recover-screencast-runs | Existing resize correctness; P03 adds only new capture-policy intent/builder to repaired owner |
| FP:F3 queued zero-demand stop races demand | Existing recover-screencast-runs | Require current-demand reconciliation receipt before minimum-visible tier aggregation |
| FP:F4 stale publication relabeled epoch/run | Existing unify-geometry-counters + recover-screencast-runs | Immutable authority and final publication fence prerequisite |
| FP:F5 lost events strand native credits | Existing recover-screencast-runs | Exactly-once native admission/drop/abort obligations, never slow-viewer ACK pacing |
| FP:F6 actor death subscription stays open | Existing recover-screencast-runs | Actor health/cancellation/replacement owner remains upstream |
| FP:F7 admission time mislabeled capture | New P01 measure-viewer-delivery | Preserve validated native metadata time, separate monotonic receipt/service |
| FP:S1 retained/packing peak unreserved | Existing bound-browser-payloads | All physical-owner overlap/configured payload ceiling; no second memory framework |
| MT:P1 sink write blocks media reader/audio | New P02 decouple-media-writes | One bounded writer, responsive controls, no extra frame FIFO; TCP HOL cannot be recalled |
| MT:P2 resize churn + CDP lock | Existing unify-geometry-counters for lock/authority; New P02 bound-viewport-and-runtime-caps for sanitized no-op/coalescing | New task extends repaired transaction owner, never redoes geometry correctness |
| MT:P3 repeated viewer header parse | New P02 reuse-validated-frames | Retain trusted header/key beside shared reserved bytes |
| MT:F1 raw viewport/registry divergence | Existing unify-geometry-counters | Sanitized DTO, authoritative epoch, checked native application and ownership-first validation prerequisite |
| MT:F2 held inputs not released native | Existing enforce-paired-input-lifecycle | Release/cancel/gap/expiry/native failure lifecycle remains upstream |
| MT:F3 runtime/config viewer/image/memory mismatch | New P02 bound-viewport-and-runtime-caps for viewer/image; Existing bound-browser-payloads for payload-memory ceiling | Reuse existing pair permit and effective config; no parallel admission registry |
| MT:F4 expired heartbeat strands subscription | Existing recover-screencast-runs + enforce-paired-input-lifecycle | Demand-expiry/close or explicit re-admission receipt required; expired viewers never vote or receive audio |
| MT:F5 control dispatch failures + biased-loop starvation | Existing enforce-paired-input-lifecycle for ordered bounded dispatch/failure revocation; New P06 arbitrate-control-input-fairly for update-vs-input ordering only | Preserve cancel/deadline priority; demonstrate pending input processed under ready-update churn, no measured starvation/performance claim or duplicated inline-dispatch repair |
| MT:S1 nonexistent viewport allocates input manager pre-owner | Existing unify-geometry-counters | Ownership/existing-session check before geometry/input allocation must be demonstrated in prerequisite receipt; do not assume label proves closure |
| MT:S2 control-only pairs bypass capacity/expiry | Existing enforce-paired-input-lifecycle | Pair-owned permit, independent mate-expiry timer already required |
| UI:P1 microtask input >100/s | New P02 pace-client-input | Timer≤40 replaceable/s + rolling normal budget≤80/s, ordered barriers; upstream owns send-time seq/saturation correctness |
| UI:P2 double client unpack | New P02 reuse-validated-frames | Pending retains first validated header and JPEG subarray, no weakened ingress checks |
| UI:P3 document hidden retains demand | New P02 bound-client-background-work | Add document visibility only; OS/privacy owner lifecycle already upstream; blur not occlusion |
| UI:P4 overlapping unabortable polls | New P02 bound-client-background-work | Settlement scheduling/one in-flight/AbortSignal/effective visibility |
| UI:P5 parked full canvas backing | New P02 bound-client-background-work | <=1x1 backing when parked; preserve keep-alive identity, restore valid draw on reveal |
| UI:F1 socket failure frozen/truthless UI | Existing reconcile-browser-ownership + wire-browser-interaction | Consume repaired reconnect/status/lease bridge; do not add another retry engine |
| UI:F2 already-numbered dropped input | Existing fence-client-input-decoding | Contiguous send-time sequence, original-channel cleanup/fail-closed saturation prerequisite |
| UI:F3 paste truncates beyond4096 UTF-8 bytes | New P06 preserve-bounded-paste | Whole-batch capacity/size admission, bounded ordered UTF-8-safe chunks; no silent prefix, visible oversize rejection/interruption, no fabricated remote atomicity/ACK |
| UI:F4 drag lacks pointer capture | New P06 capture-accepted-pointer | Accepted gesture capture/up/cancel/lostpointercapture; upstream native cancel/release prerequisite, no lease/privacy/modal bypass |
| UI:F5 fake decoder/draw success | New P02 make-client-rendering-truthful | Existing stale-epoch/bitmap cleanup is not truthful draw acceptance; explicit unsupported/error/discard, never fake ACK/trust/telemetry |
| UI:F6 wheel deltaMode ignored | New P06 normalize-wheel-units | Line/page→bounded CSS pixels before coalescing, canonical existing snake_case wire fields; pacing alone never claimed normalization |
| UI:S1 remote HTTP/WS credential leak policy | New P02 secure-browser-transport | Existing secure-or-loopback helper at common REST/socket boundary before credentials/tickets |
All 33 labeled findings mapped. Positive observations/nonfinding transport facts remain invariants (bounded queues, shared Bytes/reservations, native/viewer credit separation, bitmap/audio cleanup, qualified owner). Hooks are requirements, not additional unexplained defects: copied policy/parameter builder→P03; per-viewer timing→P01; quality/mute/status→P04; geometry/engine/text/proxy behavior→P05.

## External gates and calibration
No existing remediation task is marked complete here. If its delivered receipt fails the mapped boundary (including ownership-before-allocation, expiry, demand race or actor/publication fence), coordinator blocks dependent task and returns it to existing owner, not silently expands this plan. All shared-file edits serialized; no whole-plan implicit import or modifications to read-only plans.
32-cell minimum =4 rates×2 RTT×2 audio×single/mixed unequal viewers; actual Chromium stop/start/native metadata under downscale, CSS/DPR and DOM input oracles, tier legibility and audio-source continuity required. Quantitative response/service targets are explicitly candidates until measurements; no gain/raw-speed/version compatibility claimed. Broader Windows/physical-device/human/soak remediation gates remain external and unwaived.

## YAGNI deferrals
WebRTC/tabCapture, H.264/WebCodecs encode, WebP, tile/delta, worker/OffscreenCanvas/ImageDecoder, per-viewer re-encode, synthetic speed downloads and navigator.connection authority deferred. Optional NetworkInformation start hint only. Also defer compressed-frame hash/dedupe, rAF/bitmaprenderer/desynchronized-canvas experiments, delayed native ACK pacing, five-input-mutex consolidation, PCM-copy tuning and full window-occlusion tracking until measured evidence warrants separate scope; existing createImageBitmap/2D/Blob and one-active/one-pending remain.

## Unresolved questions
- No unsettled product decision. Coordinator review/final validation and prerequisite completion evidence still pending.
- Actual supported deployed Chromium/output-browser versions, switch gap, metadata behavior and text/service floors require Phase05 receipts; no source-only substitute. Missing environment blocks that qualification, not reachable implementation work.
