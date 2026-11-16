# Phase 02 — Hot-path and client performance

## Context links
[Overview](plan.md) · [Measurement](phase-01-measurement-and-feedback.md) · [Dedupe authority](../reports/planner-261112-1205-browser-adaptive-stream-quality.md) · [Frame review](../reports/code-reviewer-261112-1205-browser-server-frame-pipeline.md) · [Transport review](../reports/code-reviewer-261112-1205-browser-server-media-transport.md) · [UI review](../reports/code-reviewer-261112-1205-browser-ui-client.md) · [Existing stream](../261109-2251-host-browser-review-remediation/phase-02-stream-input-contracts.md) / [OS tasks](../261109-2251-host-browser-review-remediation/phase-03-os-viewer-lifecycle.md).

## Overview
Date: 2026-11-12 · Priority: P2 performance; P1 secure-origin gate · Implementation status: completed (7/7, 2026-11-12) · Review status: Cycle 3 reviewed (7/10, 0 critical; approved with noted issues, browser-mode tests env-blocked) · Effort: 20h.
Depends on Phase 01. External gates: all eight remediation tasks listed in overview; apply per-task constraints below. One integration owner; sequential shared-file edits. Changes here are only residual work, not another remediation implementation.

## Key Insights
- Base64 candidate Arc sharing is **already required by `bound-browser-payloads`**: inspect its result, do not create a duplicate task. ACK/drain/fallback recovery, geometry lock inversion, paired admission and stale decoder/input fencing likewise stay upstream.
- Repeated SOF/header parsing is not a required security boundary between trusted immutable in-process frames. Keep all ingress validation; carry validated metadata beside reserved shared bytes.
- Default governor catch-up can create stale bursts; `MissedTickBehavior::Skip` matches audio. Socket writes currently also delay ACK observation.
- UI input microtasks do not bound real pointer event rate; >100 text messages/s disconnects. OS visibility does not imply actual document visibility; blur alone is not hidden.
- Configured `max_viewers`, image bounds and payload ceiling differ from hardcoded runtime values. Payload accounting itself stays upstream; this phase only reconciles residual viewer/image-cap plumbing.

## Requirements
- Producer validates JPEG SOF once before publication, retains typed immutable metadata/key with `TrackedBhjfFrame`; pack trusted internal frames without re-scan. Public untrusted unpack/pack validation stays strict. Viewer receipt/pending flush never deserialize the same trusted header again; client pending object retains first-validated header and JPEG subarray.
- Truthful rendering is distinct from upstream stale-owner/decode cleanup: absent decoder or failed draw must report unsupported/error/discard, never fake ImageBitmap dimensions, successful ACK/telemetry or trusted hit rectangle. Keep createImageBitmap/2D, no speculative decoder fallback.
- One bounded writer per media subscription, independent reader continues ACK/heartbeat/auth/pause processing under blocked sink; no task-per-frame. Preserve two outstanding + one latest pending across **all** ownership locations, ≤one audio chunk queued, fixed control/status slot. Byte reservations cover in-flight writer lifetime. Audio may drop stale chunks, never unlimited backlog; TCP already-written JPEG bytes remain non-preemptible.
- Governor ticks skip catch-up; cancellable single fallback remains remediation-owned. Do not add deferred native ACK pacing or screenshot polling.
- Identical **sanitized** viewport update is no-op for epoch/native commands; keep any existing lease renewal behavior explicit. Changed requests: one active serialized transaction + latest pending, proposed 100ms dispatch spacing with a final flush; superseded HTTP callers receive authoritative applied/superseded result, never fabricated success. Limits proposed, calibrate later.
- Enforce effective configured viewer count at existing pair admission; share config with capture maxWidth/maxHeight independently of CSS limits. Never add a second semaphore or memory-budget registry. Payload-memory config enforcement is `bound-browser-payloads` prerequisite, not a second change here.
- Effective demand includes `document.visibilityState === 'visible'` plus existing OS/privacy/owner gates; hidden immediately pauses input/audio/media and polls. Foreground uses existing fresh-pair reconciliation to exact target, not page recreation. Do not infer window occlusion from blur.
- Selection poll: at most one in-flight request, next delay after settlement, AbortController cleanup and visibility gate, owner checks after await. Parked/never-live canvas backing ≤1×1; keep controller/DOM identity, restore dimensions on reveal and invalidate hit geometry until successful draw.
- Timer-bound movement/wheel flush: initial 25ms maximum frequency (≤40 replaceable records/s), ordered discrete barriers and rolling total-send budget ≤80/s reserving headroom beneath 100/s. Allocate sequence only at actual live-socket send; existing saturation/release behavior remains upstream. Bound discrete queue; on excessive nonreplaceable input use existing fail-closed revoke/close path, never silently lose key/button transitions. rAF alone insufficient.
- Reject credentialed Browser REST/media/control transport on remote HTTP/WS before fetch/ticket/socket creation using existing secure-or-loopback helper; allow explicit loopback development only. No silent downgrade or transport-policy fork.

## Architecture
Keep current BHJF and `Bytes`/RAII fan-out. Add validated internal metadata to tracked publication; UI pending frames hold immutable decoded-header/payload views. Writer reports send-complete/duration to existing credit owner through bounded lifecycle messages; reader owns control validation. A frame is counted/reserved once across pending/outstanding/writing states, not copied into an extra writer FIFO. Cancellation closes the original paired transport and drops writer reservations only after physical completion/cancellation.
Reuse target owner's geometry serialization established by remediation; coalesce **requested** geometry, not network tier changes. Pair permit reads same effective config as capability DTO. Visibility is a narrow shared UI predicate/event subscription, not another owner store. Selection API already supports optional AbortSignal conventions; thread signal through its existing request wrapper.

## Related code files
Exact create/modify ownership is in task allowlists; no deletions. New modules: `server/src/browser_host/media_writer.rs`, `packages/ui/src/browser-host/visibility-demand.ts`; each focused, aim <200 lines; test files kebab-case TS / snake_case Rust. Existing estimator module handles instrumentation, existing owner handles transitions. Do not grow another policy framework in `media.rs`/`screencast.rs`.

## Implementation Steps
### reuse-validated-frames
1. Reuse upstream shared Arc candidate/reservation result. Add trusted constructor/private validated-frame representation and carry header/key through packing and viewer credit admission; no alternate unchecked public codec.
2. Store validated unpack result in client PendingFrame, retain one-active/one-pending decode and all bitmap/disposition fences. Count parser calls in focused tests; malformed untrusted packets must still fail.
### make-client-rendering-truthful
Return explicit unsupported/error when createImageBitmap is unavailable; propagate draw success and acknowledge only successful drawing. Clear hit geometry on failure and send exact originating-socket discard; use existing status callback, not a new recovery owner.
### decouple-media-writes
3. Extract one bounded writer with precise ownership/cancel/write-timeout semantics; keep exact credits in reader-side controller, send completion events update estimator. Respect original 5s write and 30s credit timeouts/auth deadlines; pause/status processing must progress during blocked writes.
4. Set video governor `Skip`; do not redo upstream ACK/fallback worker design. Exercise blocked sink and missed-tick burst behavior.
### bound-viewport-and-runtime-caps
5. Compare sanitized viewport before publishing; coalesce pending distinct requests in existing serialized owner, rate-limit safely and surface failures. No raw request geometry or counter fixes here—those are upstream.
6. Replace residual hardcoded viewer cap with effective config in existing pair permit owner; apply configured encoded-image caps independent of CSS viewport. Verify payload-memory config already honored upstream; escalate if not rather than duplicate its task.
### bound-client-background-work
7. Share document-visibility predicate with synchronous input/audio/demand guards; retain OS/privacy gates and foreground reconnect. Visibility loss must abort polling before cleanup awaits.
8. Replace overlapping selection interval with single-flight settlement scheduling and AbortSignal; shrink parked canvases, lazy-init never-streamed tabs and restore once on reveal.
### pace-client-input
9. Use bounded timer for replaceable records plus ordered barrier flush; allocate seq only at send after authority/queue checks. Preserve wheel accumulation; [Phase 06](phase-06-input-interaction-defects.md) owns wheel-unit normalization after this task.
10. Keep combined rolling budget and bounded queue; prioritize native cleanup/discrete transitions without allowing >100/s. Test pointer+wheel+keyboard bursts, high-refresh screens, delayed timer wake and original-socket release.
### secure-browser-transport
11. Guard common Browser REST request and WS URL/ticket creation with existing secure-origin helper. Cover every ordinary Browser caller via common boundary; preserve owner/auth fences and explicit loopback behavior.

## Todo list
```evcrate-tasks
[
  {
    "id": "reuse-validated-frames", "title": "Reuse validated immutable frame metadata through server and UI queues", "blocked_by": ["publish-viewer-feedback"],
    "allowed_files": ["server/src/browser_host/protocol.rs", "server/src/browser_host/diagnostics.rs", "server/src/browser_host/screencast.rs", "server/src/browser_host/media.rs", "server/tests/browser_host_media.rs", "server/tests/browser_host_bounds.rs", "packages/ui/src/browser-host/stream-controller.ts", "packages/ui/src/browser-host/stream-controller.test.ts", "packages/ui/src/browser-host/frame-protocol.test.ts"],
    "constraints": ["External gates: bound-browser-payloads and fence-client-input-decoding; base64 Arc sharing is upstream, not reimplemented.", "Retain untrusted-boundary SOF/header validation, immutable bytes and RAII charges; no per-viewer JPEG copy or unchecked public codec."],
    "acceptance": ["Producer SOF validates once before packing; viewer admission/pending use retained typed keys with zero JSON reparses; client validates once then decodes stored JPEG subarray.", "Malformed/oversized/JPEG-header mismatch still fails, old-socket/epoch decode fences and complete reservation lifetimes unchanged."],
    "verification": ["Future: cd server && cargo test --test browser_host_media --test browser_host_bounds --test browser_host_screencast", "Future: pnpm --filter @dam-hopper/ui test src/browser-host; instrument parse counts in deterministic fixtures and compare immutable payload identity, no runtime speedup claim without Phase 05 profiling."]
  },
  {
    "id": "make-client-rendering-truthful", "title": "Prevent fake decode and failed draw from reporting successful presentation", "blocked_by": ["reuse-validated-frames"],
    "allowed_files": ["packages/ui/src/browser-host/stream-controller.ts", "packages/ui/src/browser-host/stream-controller.test.ts", "packages/ui/browser-tests/host-browser-decoder.browser.tsx"],
    "constraints": ["External gate: fence-client-input-decoding owns stale-owner/epoch fencing and bitmap cleanup; this residual change fixes fabricated decoder/draw success only.", "No worker/ImageDecoder/alternate fallback; absent createImageBitmap is explicit unsupported status, exact socket discard and no input trust."],
    "acceptance": ["Unavailable decoder, null context, zero dimensions or drawImage failure never yields frameAck/success timing or a trusted hit rectangle; visible error/discard follows existing owner-safe status path.", "Valid createImageBitmap and successful 2D draw preserve one-active/one-pending ownership, exact credit dispositions and aspect-fit geometry."],
    "verification": ["Future: pnpm --filter @dam-hopper/ui test src/browser-host/stream-controller.test.ts; pnpm --filter @dam-hopper/ui test:browser browser-tests/host-browser-decoder.browser.tsx; unavailable decoder, throwing drawImage, zero-size/null-context and genuine decoded JPEG fixtures."]
  },
  {
    "id": "decouple-media-writes", "title": "Keep media feedback responsive with a bounded independent writer", "blocked_by": ["make-client-rendering-truthful"],
    "allowed_files": ["server/src/browser_host/media_writer.rs", "server/src/browser_host/mod.rs", "server/src/browser_host/media.rs", "server/src/browser_host/screencast.rs", "server/src/browser_host/viewer_delivery_estimator.rs", "server/tests/browser_host_media.rs", "server/tests/browser_host_screencast.rs", "server/tests/browser_host_bounds.rs"],
    "constraints": ["External gates: enforce-paired-input-lifecycle, recover-screencast-runs and bound-browser-payloads; no replacement of ACK/fallback recovery.", "One lifecycle writer, fixed slots, global two outstanding/one pending ownership preserved; retain original auth and write deadlines; video ticker Skip."],
    "acceptance": ["Blocked JPEG send does not block media control read/validation, heartbeat/pause/auth cancellation; total retained frame ownership never gains an extra FIFO.", "Stale audio drops within a bounded single queued chunk; writer-held reservation remains charged until release; missed ticks never emit a catch-up burst."],
    "verification": ["Future: cd server && cargo test --test browser_host_media --test browser_host_bounds --test browser_host_screencast; inject blocked sink and delayed governor ticks, assert control processing before sink release, timeout/auth cancellation and exact reservation return."]
  },
  {
    "id": "bound-viewport-and-runtime-caps", "title": "Coalesce viewport requests and honor effective viewer and image caps", "blocked_by": ["decouple-media-writes"],
    "allowed_files": ["server/src/api/browser_host.rs", "server/src/browser_host/session.rs", "server/src/browser_host/manager.rs", "server/src/browser_host/attachments.rs", "server/src/browser_host/media.rs", "server/src/browser_host/screencast.rs", "server/src/browser_host/config.rs", "server/tests/browser_host_media.rs", "server/tests/browser_host_input.rs", "server/tests/browser_host_screencast.rs", "server/tests/browser_host_admission.rs"],
    "constraints": ["External gates: unify-geometry-counters supplies authoritative sanitized geometry and serial transition owner; enforce-paired-input-lifecycle supplies shared pair permit; bound-browser-payloads supplies configured payload memory ceiling.", "Residual no-op/coalescing and config plumbing only; do not redo epoch/ABBA/capacity architecture; no network adaptation through viewport API."],
    "acceptance": ["Identical sanitized viewport causes zero epoch changes/native commands; resize flood has one active and one latest pending transaction with explicit supersession and final applied size.", "max_viewers=1 rejects second pair, larger allowed values work up to effective cap; encoded images respect configured max_width/max_height and absolute bounds without shrinking CSS viewport."],
    "verification": ["Future: cd server && cargo test --test browser_host_media --test browser_host_input --test browser_host_screencast --test browser_host_admission; identical/clamped/flood resize, failed final apply and configured viewer/image cap boundary fixtures; prove configured memory ceiling via upstream bound-browser-payloads receipt."]
  },
  {
    "id": "bound-client-background-work", "title": "Gate document demand, serialize selection polls and shrink parked canvases", "blocked_by": ["bound-viewport-and-runtime-caps"],
    "allowed_files": ["packages/ui/src/browser-host/visibility-demand.ts", "packages/ui/src/browser-host/visibility-demand.test.ts", "packages/ui/src/browser-host/selection-controller.ts", "packages/ui/src/browser-host/selection-controller.test.tsx", "packages/ui/src/browser-host/canvas-view.tsx", "packages/ui/src/browser-host/stream-controller.ts", "packages/ui/src/browser-host/stream-controller.test.ts", "packages/ui/src/api/browser-host-client.ts", "packages/ui/src/api/browser-host-client.test.ts", "packages/ui/src/os/BrowserStreamKeepAliveHost.tsx", "packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx", "packages/ui/src/os/apps/BrowserApp.tsx", "packages/ui/browser-tests/host-browser-lifecycle.browser.tsx", "packages/ui/browser-tests/host-browser-selection.browser.tsx"],
    "constraints": ["External gates: repair-browser-portals, reconcile-browser-ownership and fence-client-input-decoding; extend their existing owner reconciliation only.", "Hidden document is demand loss, blur is not; one poll in flight with abort; preserve DOM/controller/session identity and last-frame privacy rules."],
    "acceptance": ["Hidden document immediately prevents new input/media/audio/poll work, foreground reattaches exact target with fresh pair; no duplicate page creation.", "Slow selection endpoint never has two polls in flight and cleanup aborts; parked/deferred backing <=1x1, reveal restores aspect-fit pixels/input only after valid draw."],
    "verification": ["Future: pnpm --filter @dam-hopper/ui test src/browser-host src/os/BrowserStreamKeepAliveHost.test.tsx src/api/browser-host-client.test.ts", "Future: pnpm --filter @dam-hopper/ui test:browser browser-tests/host-browser-lifecycle.browser.tsx browser-tests/host-browser-selection.browser.tsx; visibilitychange, privacy/minimize overlap, aborted response and many parked tabs at DPR=3."]
  },
  {
    "id": "pace-client-input", "title": "Bound replaceable input cadence with discrete-event headroom", "blocked_by": ["bound-client-background-work"],
    "allowed_files": ["packages/ui/src/browser-host/input-controller.ts", "packages/ui/src/browser-host/input-controller.test.ts", "packages/ui/browser-tests/host-browser-input.browser.tsx"],
    "constraints": ["External gates: enforce-paired-input-lifecycle, fence-client-input-decoding and wire-browser-interaction; contiguous send-time sequence and reliable cleanup remain upstream.", "Add bounded timer/rolling budget only; no dropping key/button transitions. Phase 06 owns wheel-unit/paste/pointer-capture repairs after this task, not scope expansion here."],
    "acceptance": ["Replaceable traffic <=40 records/s and combined normal traffic <=80/s with cleanup headroom; 240Hz pointer plus wheel/key bursts never cross server 100/s ceiling.", "Discrete barriers preserve order, pending moves never create sequence gaps, excessive discrete input closes/revokes safely rather than accumulating or silently dropping; hidden/owner replacement cancels timer."],
    "verification": ["Future: pnpm --filter @dam-hopper/ui test src/browser-host/input-controller.test.ts; pnpm --filter @dam-hopper/ui test:browser browser-tests/host-browser-input.browser.tsx; delayed clock, high-refresh mixed-event and held-chord saturation traces with real server lease/sequence assertions."]
  },
  {
    "id": "secure-browser-transport", "title": "Apply existing secure-or-loopback policy to ordinary Browser transport", "blocked_by": ["pace-client-input"],
    "allowed_files": ["packages/ui/src/api/browser-host-client.ts", "packages/ui/src/api/browser-host-client.test.ts"],
    "constraints": ["Reuse existing secure-origin helper; no new auth mode, endpoint, token store or ambient owner fallback.", "Block before bearer fetch/ticket/socket creation; permitted development exception is explicit loopback only."],
    "acceptance": ["Remote HTTP/WS Browser calls fail visibly before credentials/content/input leave the client; HTTPS/WSS and permitted loopback continue; reset and ordinary Browser policies agree."],
    "verification": ["Future: pnpm --filter @dam-hopper/ui test src/api/browser-host-client.test.ts; pnpm --filter @dam-hopper/ui build; assert fetch/WebSocket not constructed for insecure remote origins and owner-fenced secure paths remain usable."]
  }
]
```
- [x] <!-- evcrate-task:reuse-validated-frames --> Reuse trusted frame metadata
- [x] <!-- evcrate-task:make-client-rendering-truthful --> Report real rendering failure without successful ACK/input trust
- [x] <!-- evcrate-task:decouple-media-writes --> Bound independent media writes and skip missed ticks
- [x] <!-- evcrate-task:bound-viewport-and-runtime-caps --> Coalesce viewport updates and honor configured caps
- [x] <!-- evcrate-task:bound-client-background-work --> Bound hidden demand, polls and parked backing
- [x] <!-- evcrate-task:pace-client-input --> Pace replaceable input below server budget
- [x] <!-- evcrate-task:secure-browser-transport --> Enforce secure Browser credential transport

## Success Criteria
All seven task outcomes observable; exactly one untrusted parse per incoming frame, no trusted fan-out reparse, no queue expansion, prompt control read under blocked media writes. Unsupported/failed rendering never emits success or grants input trust. Hidden document produces zero new input/decode/audio/polls after synchronous fence (already-written network bytes may still arrive); one selection request maximum; parked backing ≤1×1. Default production remains 24fps/configured quality until adaptation phase, not a forced 10fps. Commands above plus final `pnpm --filter @dam-hopper/ui build`; coordinator runs only after edits land, no planning execution.

## Risk Assessment
Writer separation can accidentally add a fourth retained frame or release memory before sink completion; enforce physical-owner ledger and cancellation tests. Resize coalescing must not acknowledge unapplied geometry; preserve upstream transaction authority. Timer bursts may violate fixed-window server limits despite average rate: use rolling budget and delayed-wake tests. Rollback: drain pairs and revert this phase's matched changes, preserve secure-origin guard/remediation; disabling Browser is safer than restoring known unsafe credential transport.

## Security Considerations
Telemetry/preference remains untrusted, bounded, subscription-fenced and rate-limited; cannot raise admin ceilings. Trusted frame constructors are private to validated producer path, not bypasses for WS input. Visibility is not authorization. Secure-origin checks precede credentials; no unauthenticated surface. Resize/cap tests must use isolated sessions and cannot weaken authentication or memory admission.

## Approved with noted issues
Phase 02 approved 2026-11-12 after 3 review cycles (final score 7/10, 0 critical) with noted open items recorded as non-blocking follow-ups for Phase 03/05 owners. Tasks marked done-with-known-defects where reviewer scores reflect remaining technical debt:
- **Task review scores**:
  - `reuse-validated-frames`: 9/10
  - `make-client-rendering-truthful`: 9/10
  - `decouple-media-writes`: 5/10 (*done with known defects*)
  - `bound-viewport-and-runtime-caps`: 4/10 (*done with known defects*)
  - `bound-client-background-work`: 8/10
  - `pace-client-input`: 9/10
  - `secure-browser-transport`: 9/10
- **Open defects & static analysis follow-ups**:
  - `H1a`: `screencast.rs` transition fence not atomic with publication; input (`media.rs`) not fenced during resize.
  - `H1b`: First CDP timeout treated as unchanged native state.
  - `H3`: `media_writer.rs` reservation released before shared WebSocket physically retired.
  - `H2`: Shutdown/failure paths can drop pending lifecycle accounting.
  - `Test gaps`: Concurrent publication during resize; saturated frame + audio + control accounting across cancel/failure; accept-then-block with destructor ordering; real WS reader/writer blocked sink.
- **Upstream remediation & environment gates**:
  - Upstream remediation gates still unchecked (7 of 8; `unify-geometry-counters`, `enforce-paired-input-lifecycle`, `recover-screencast-runs`, `bound-browser-payloads`, `repair-browser-portals`, `reconcile-browser-ownership`, `fence-client-input-decoding`).
  - Escalated upstream prerequisite: `diagnostics.rs` hardcodes 128 MiB memory ceiling ignoring configured `memory_ceiling_bytes` (owned by upstream remediation `bound-browser-payloads`).
  - Environment gate: Browser-mode Playwright tests NOT run (env: Chromium missing `libnspr4`, no sudo). Verified via 63 server integration passes (3 repeat runs), 65 lib `browser_host` unit passes, 138 UI vitest passes, and clean `tsc` build (`cargo --features vendored; NODE_OPTIONS=--no-experimental-webstorage; npx pnpm@10`).

## Next steps
Phase 03 starts only after residual performance/cap fixes and prerequisite recovery contracts have evidence; Phase 03/05 owners must review the open follow-ups in 'Approved with noted issues' above. [Phase 06](phase-06-input-interaction-defects.md) follows `pace-client-input` for paste/capture/wheel and control update-vs-input fairness; it does not block Phases 03–05 or duplicate remediation dispatch/revocation. Integration owner serializes shared files.
