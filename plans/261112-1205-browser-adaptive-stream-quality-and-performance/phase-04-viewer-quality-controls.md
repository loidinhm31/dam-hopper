# Phase 04 — Viewer quality controls

## Context links
[Overview](plan.md) · [Server controller](phase-03-server-adaptive-capture-tiers.md) · [UI hooks/state](../reports/code-reviewer-261112-1205-browser-ui-client.md) · [Tools surface map](../reports/scout-261112-1205-browser-host-streaming-map.md) · [Audio baseline](../261111-0220-browser-video-audio-streaming/plan.md) · [Remediation OS prerequisites](../261109-2251-host-browser-review-remediation/phase-03-os-viewer-lifecycle.md).

## Overview
Date: 2026-11-13 · Priority: P2 · Implementation status: completed 2/2 · Review status: 3 cycles 5/10 -> 6/10 -> 6/10, 0 critical, approved by user with fixes applied · Effort: 10h.
Depends on Phase 03; external gates `repair-browser-portals`, `reconcile-browser-ownership`, `fence-client-input-decoding`, `wire-browser-interaction`. These remain prerequisites, not another lifecycle rewrite. Wire task precedes tools task; same integration owner serializes backend/UI shared files.

## Key Insights
- BrowserTools already contains controls/diagnostics; no Settings/global preference is needed. Viewer fidelity preference is not page input, so no control lease.
- Quality is shared; a faster viewer's High request can still receive Low pixels because another visible viewer votes lower. Show requested preference, effective shared fidelity and local pacing separately.
- Mute currently only flushes local player. Saving bandwidth requires a typed client→server state update on existing media WS, plus immediate local silence before network acknowledgement.
- Existing audio envelope uses video `producerRun`; capture-only restart must no longer reset unrelated audio. Clean matched cutover to `audioRun`, retaining `docEpoch` and subdocument fences; no legacy alias.

## Requirements
- Auto / High / Medium / Low selector in `packages/ui/src/os/browser/browser-tools.tsx`, default Auto. Session-only in-memory state keyed by `(profileId, generation, windowId, tabId)`; survive keep-alive placement/reconnect of same tuple, delete on tab/window close or owner generation retirement. No localStorage/sessionStorage/IndexedDB/window persistence/recovery/export/recipe fields.
- Manual preference is a requested ceiling; High cannot bypass network safety, lowest eligible shared vote or admin caps; Low covers Low/Constrained. Return to Auto resumes measurements, no synthetic download.
- Selector available to admitted view-only users with no control lease; disabled/unavailable on masked/owner mismatch/not-live rather than retargeting. Accessibility: visible label, keyboard operation, explicit pending/unavailable state; no per-frame React updates.
- Show effective shared tier, scale/quality and viewer FPS, warming/switching status; label shared limitation when request differs. Audio suppression indicator distinguishes Muted vs Bandwidth constrained (viewer service tier Constrained), not falsely imply missing remote sound. Faster viewer may retain audio if its own service tier is above Constrained even when shared pixels are Constrained.
- On local mute/hidden/privacy/retire: flush/silence synchronously; send mute state only on current live subscription. Unmute or tier recovery requests fresh audio, never buffered replay. New subscription initializes server audio-suppressed until explicit current mute state arrives; send current preference/mute on media open before enabling audio delivery.
- Rust/TS union validation identical, existing 1KiB **client media-control** cap and 100 text messages/s preserved. Preference/mute changes coalesced to latest state, proposed ≤4 updates/s each, no per-frame toggling; controls cannot allocate new viewer state or run transitions directly.
- Server effective state event scoped to exact subscription and current capture version; emit on change/attach, coalesce pending status in existing bounded writer slot, not every frame. Client rejects stale run/version/owner events; masked/retired views cannot publish late indicators.

## Architecture
### Matched media-WS contract
Client controls, alongside existing bounded feedback/credits:
- `qualityPreference`: `{kind, subscriptionEpoch, preference: 'auto'|'high'|'medium'|'low'}`.
- `muteState`: `{kind, subscriptionEpoch, muted: boolean}`.
Server text event `streamQuality`: `{kind, subscriptionEpoch, producerRun, captureVersion, sharedTier, viewerTier, fps, jpegQuality, scale, imageWidth, imageHeight, audioSuppressed, audioReason, preference, status}`. `captureVersion` canonical positive decimal u64 string; tiers `high|medium|low|constrained`; `audioReason: null|'muted'|'bandwidth'|'hidden'|'stalled'`; `preference: 'auto'|'high'|'medium'|'low'`; status `warming|switching|effective|unavailable`. Dimensions/quality/FPS finite and config/protocol bounded. Numerical values under status `warming` or `unavailable` are non-applied placeholder ceilings; `effective` and `switching` reflect one proven native snapshot. Switching event identifies current applied run/settings with status switching; proposed target is not advertised as applied. Attach response starts warming until current authoritative snapshot known.
Use exhaustive tagged parser for audioChunk vs streamQuality before specialized payload validation; a tier event cannot become audio or a frame credit. Quality/mute messages bind to socket subscription, not client-selected session/viewer ID, and do not require lease credentials. No REST quality endpoint or global session DTO field for viewer-specific state.
Audio clean cutover: replace audio-only wire `producerRun` field with `audioRun` everywhere (Rust envelope/validation, TS DTO/parser, stream controller/tests); video BHJF/credit `producerRun` remains unchanged. `audioRun` rotates only when audio source truly restarts, not for JPEG tier switch. Player fencing uses owner/session/incarnation/profile/subscription/audioRun/docEpoch/subdocument identity; old queued chunks after mute/source change cannot revive playback. Preserve current privacy/reset/navigation behavior; do not treat mere source equality as permission after subscription retirement.
Small in-memory `browser-stream-quality.ts` holds tuple-keyed preference/status and subscriptions; no new persistence store. BrowserApp passes props to BrowserTools and publishes preference/mute to existing keep-alive slot/controller bridge. Stream controller owns transport messages and sampled state callbacks; React sees coalesced changes only.

## Related code files
Exact task allowlists below. Create `packages/ui/src/os/browser/browser-stream-quality.ts` and `.test.ts`, `browser-tools.test.tsx`; each production file aims <200 lines, use existing shared selector primitives. Existing browser-tab-types/window-store/persistence are intentionally **not writable**: quality is not persisted tab model. No additional address-bar control; existing audio toggle remains the action surface and Tools shows suppression reason.

## Implementation Steps
### wire-viewer-quality-and-mute
1. Extend Rust MediaClientControl and TS media-control unions, strict bounded validation and exact-subscription dispatch into Phase 03 setters. Reuse existing rate limiter and writer status slot; reject cross-subscription controls.
2. Send server streamQuality on attach/applied-state/pacing/audio-gate changes; preserve version/run fencing, no shared session DTO pollution. Match decoder branches and error policy both sides; test max serialized client messages ≤1024 bytes.
3. Perform complete audioRun cutover, removing video-run-triggered audio reset for capture-only restart. Source/document/subscription loss still synchronously retires audio; keep muted default until valid initial mute state, propagate changed state before queued audio write.
4. Unit/integration test two subscriptions with different preferences/mutes; manual choices without lease; rapid toggles; malformed/oversized enums/bounds; old subscription/version; independent video restart/audio source continuity.
### expose-browser-quality-tools
5. Implement tuple-keyed ephemeral state with deletion on close/generation retirement; default Auto and current viewer-local mute. Reconnect re-sends same-tuple preference/mute; new generation never inherits it.
6. Add labeled selector and effective shared tier/local FPS/audio reason in BrowserTools; pass through existing BrowserApp/keep-alive bridges, not new sockets or page-control APIs. Explain shared fidelity and safety clamping; mask diagnostics under privacy.
7. Author runtime/UI regressions for view-only selector, two tabs/windows/profile generations, placement, reconnect, no persistence/export changes and no per-frame renders; do not duplicate upstream socket-recovery/lease/focus tests.

## Todo list
```evcrate-tasks
[
  {
    "id": "wire-viewer-quality-and-mute", "title": "Implement subscription-fenced quality, mute and effective-state media messages", "blocked_by": ["switch-capture-tier-and-audio"],
    "allowed_files": ["server/src/browser_host/protocol.rs", "server/src/browser_host/media.rs", "server/src/browser_host/media_writer.rs", "server/src/browser_host/screencast.rs", "server/tests/browser_host_media.rs", "server/tests/browser_host_screencast.rs", "packages/ui/src/api/browser-host-types.ts", "packages/ui/src/browser-host/stream-controller.ts", "packages/ui/src/browser-host/stream-controller.test.ts", "packages/ui/src/browser-host/pcm-player.ts", "packages/ui/src/browser-host/pcm-player.test.ts"],
    "constraints": ["External gate: fence-client-input-decoding; preserve exact owner/socket and audio document fences.", "Typed media controls/event only, no new endpoint/lease requirement/persistence; <=1KiB client controls; audioRun replaces audio producerRun without compatibility alias, video identity unchanged."],
    "acceptance": ["Quality/mute controls and effective events validate identically Rust/TS, cannot target another subscription or exceed admin ceilings; view-only user changes preference.", "Muted or viewer-Constrained receives no new audio after gate acknowledgement; UI silence immediate; fresh unmute resumes no backlog; capture-only video run change preserves audioRun, genuine source/document/owner change still fences audio.", "Old run/version status cannot overwrite current state; applied settings announced only after matching native frame, status traffic bounded/coalesced."],
    "verification": ["Future: cd server && cargo test --test browser_host_media --test browser_host_screencast", "Future: pnpm --filter @dam-hopper/ui test src/browser-host; pnpm --filter @dam-hopper/ui build; max-size, malformed, stale subscription/version, mute/tier races and video-only restart with unchanged audio authority fixtures."]
  },
  {
    "id": "expose-browser-quality-tools", "title": "Expose ephemeral Auto presets and truthful shared-tier/audio diagnostics", "blocked_by": ["wire-viewer-quality-and-mute"],
    "allowed_files": ["packages/ui/src/os/browser/browser-stream-quality.ts", "packages/ui/src/os/browser/browser-stream-quality.test.ts", "packages/ui/src/os/browser/browser-tools.tsx", "packages/ui/src/os/browser/browser-tools.test.tsx", "packages/ui/src/os/apps/BrowserApp.tsx", "packages/ui/src/os/apps/BrowserApp.test.tsx", "packages/ui/src/os/BrowserStreamKeepAliveHost.tsx", "packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx", "packages/ui/browser-tests/host-browser-lifecycle.browser.tsx"],
    "constraints": ["External gates: repair-browser-portals, reconcile-browser-ownership, fence-client-input-decoding and wire-browser-interaction; consume existing slot/lifecycle owner, no competing reconciliation.", "Preference strictly in memory keyed profile/generation/window/tab; no window-store/persistence/recovery/export/recipe edits; default Auto, no control lease; no per-frame React updates."],
    "acceptance": ["BrowserTools offers accessible Auto/High/Medium/Low and shows shared effective fidelity/local FPS/pending status plus Muted or Bandwidth constrained reason; view-only user can operate it.", "Same tuple survives placement/reconnect, different tab/window/profile/generation isolated, close/retire releases state; reload defaults Auto and no quality/measurement appears in persistence or exports.", "Privacy/owner loss suppresses indicators and audio synchronously; faster viewer sees shared fidelity limit without misleading claim of independent resolution."],
    "verification": ["Future: pnpm --filter @dam-hopper/ui test src/os/browser/browser-stream-quality.test.ts src/os/browser/browser-tools.test.tsx src/os/apps/BrowserApp.test.tsx src/os/BrowserStreamKeepAliveHost.test.tsx", "Future: pnpm --filter @dam-hopper/ui test:browser browser-tests/host-browser-lifecycle.browser.tsx; pnpm --filter @dam-hopper/ui build; view-only, keyboard selector, reconnect/generation replacement, two unequal viewers and no-persistence assertions."]
  }
]
```
- [x] <!-- evcrate-task:wire-viewer-quality-and-mute --> Wire typed quality/mute/status and stable audio identity (done 2026-11-13)
- [x] <!-- evcrate-task:expose-browser-quality-tools --> Expose session-only presets and effective diagnostics (done 2026-11-13)

## Success Criteria
View-only viewer chooses all four options without lease; defaults Auto after reload/new generation, retains same-tuple in-memory choice across placement/reconnect. Two unequal viewers display same shared image tier but independent FPS/service-tier/audio state. At most one coalesced pending status, ≤4 preference/mute updates/s each; controls ≤1KiB. Mute suppresses server transmission, lowest service tier suppresses audio, and tier-only video switch does not flush unchanged audio source. All tests/commands are future verification, none run by planner.

## Risk Assessment
New server text union may be misread as audio; exhaustive parser/type/bounds tests required. Ephemeral quality in persisted tab model would violate user choice; keep separate memory ownership with teardown assertions. Audio identity decoupling can accidentally revive retired data: preserve subscription/document fences and flush queues on suppression. Rollback: drain pairs and deploy matched backend/UI protocol revision, preserve secure-origin and remediation safety; no dual audio authority aliases or stale event fallbacks.

## Security Considerations
Client telemetry/preference/mute untrusted: validate enum/finite bounds, exact live subscription, existing cap/rate limit and per-setting coalescing; never raise admin resource ceilings or mutate page/control lease. No new unauthenticated surface, stored metrics/tickets or ambient target fallback. Server effective events are untrusted client-side until validated and owner/version fenced; masked views reveal no stale page/session diagnostics.

## Approved with noted issues
Phase 04 approved 2026-11-13 after 3 review cycles (score progression: Cycle 1: 5/10 -> Cycle 2: 6/10 -> Cycle 3: 6/10, 0 critical across all cycles; approved by user after cycle-3 fixes C3-W1/W2/W3/W5 were applied and re-verified) with noted open items recorded as non-blocking follow-ups for Phase 05 / coordinator:
- **Task review scores**:
  - Review scoring progressed 5/10 -> 6/10 -> 6/10 (0 critical every cycle). All 4 cycle-3 warning fixes (C3-W1 atomic fresh-audio authority/source-scoped watermark, C3-W2 monotonic applied_event_version & per-run captureVersion map, C3-W3 controlled `<select value={qualityPreference}>`, C3-W5 failed-open & disconnect reset lifecycle) were verified clean by tests prior to final approval.
  - `wire-viewer-quality-and-mute`: 6/10 (*Cycle 3 aggregate score; approved with cycle-3 fixes applied and verified*)
  - `expose-browser-quality-tools`: 6/10 (*Cycle 3 aggregate score; approved with cycle-3 fixes applied and verified*)
- **Wire contract amendments & runtime semantics**:
  1. **Server `streamQuality` 15-key union**: Schema includes server-acknowledged client `preference` (`'auto' | 'high' | 'medium' | 'low'`) alongside `kind`, `subscriptionEpoch`, `producerRun`, `captureVersion`, `sharedTier`, `viewerTier`, `fps`, `jpegQuality`, `scale`, `imageWidth`, `imageHeight`, `audioSuppressed`, `audioReason`, and `status`.
  2. **Placeholder semantics**: Numerical tier/quality/scale/fps values emitted with status `warming` or `unavailable` are non-applied placeholder ceilings (unapplied config maxima), not applied engine parameters. Only events with `status: 'effective'` or `status: 'switching'` reflect a proven native capture snapshot.
  3. **Capture version monotonicity**: `applied_event_version` is strictly monotonic per run on server, and client tracks per-run `appliedCaptureVersionsByRun` (bounded map <= 16); placeholder events do not touch version fences, preventing version rollbacks across runs or governor-only FPS convergence updates.
  4. **Audio clean cutover**: Audio envelope field `producerRun` -> `audioRun` clean cutover (video `producerRun` unchanged). New subscriptions start audio-suppressed until first explicit `muteState`. Immediate UI silence on mute; unmute and preference updates coalesced <= 4/s. Source-scoped watermark rejects pre-reopen backlog.
- **Open follow-ups & known gaps (carry to Phase 05)**:
  1. **C3-W4: Revision dedupe & transaction boundaries**: `quality_revision` does not bump on geometry-only changes or failed-start run disappearance; retry counter in screencast ledger is not an atomic transaction across decoupled mutations.
  2. **C3-W6 residual: Unequal two-viewer real-stream acceptance**: Acceptance with two unequal viewers on the same target stream cannot be exercised in offline headless test environment; requires deployed-Chromium and shaped WebSocket link evidence in Phase 05.
  3. **Downscale input-trust oracle deferred**: Scaled (<1.0) frames stay input-untrusted until live-Chromium downscale oracle (DOM `innerWidth`/`innerHeight`/`devicePixelRatio`, CSS dimensions, JPEG SOF, normalized click marker at 1x/0.75x/0.5x) is qualified in Phase 05.
  4. **Estimator baseline aging & deferred CDP options**: Phase 01 estimator min-service baseline aging calibration deferred to Phase 05. Optional `everyNthFrame` coarse divisor and `maxFramesInFlight`/`sendLastFrame` CDP parameters deferred.
  5. **Upstream remediation gates unchecked**: External prerequisites (`unify-geometry-counters`, `enforce-paired-input-lifecycle`, `recover-screencast-runs`, `bound-browser-payloads`, `repair-browser-portals`, `reconcile-browser-ownership`, `fence-client-input-decoding`, `wire-browser-interaction`) remain unchecked upstream.
  6. **Test hooks in production code**: `#[doc(hidden)] hold_audio_drain` and `release_audio_drain` test barriers on `ScreencastProducer` to be audited and cleaned up or gated behind cfg(test) during Phase 05 cleanup.
- **Environment & test verification gates**:
  - `cargo test --features vendored --lib browser_host`: 104/104 passed.
  - 9 `browser_host_*` integration suites: 142+ tests passed (media, screencast, input, bounds, lifecycle, gateway, admission, selection, shutdown).
  - TypeScript check (`pnpm --filter @dam-hopper/ui exec tsc --noEmit`): clean (0 errors).
  - UI Phase 04 unit tests: 185/185 passed (`src/browser-host` 104/104, `src/os/browser` and related host tests 81/81).
  - Chromium browser tests: 10/10 passed (`host-browser-lifecycle.browser.tsx` 6/6, `browser-tools-quality-keyboard.browser.tsx` 4/4).
  - ESLint: 0 errors across touched files.
  - Non-green repo-level baseline: 48 unrelated UI test files fail on Node 26 `localStorage` mock (pre-existing workspace issue); `clippy --lib` has pre-existing errors outside touched scope.
- **Critical deployment warning**:
  - **CRITICAL DEPLOYMENT WARNING: Phase 03 and Phase 04 MUST be deployed together as a single matched backend/UI cutover.** Because of the audio envelope wire rename (`producerRun` -> `audioRun`), mismatched server and UI deployments will fail audio decoding or drop audio chunks. Do not deploy Phase 03 backend with Phase 02 UI, or Phase 04 UI with Phase 03 backend.

## Next steps
Proceed to [Phase 05](phase-05-calibration-qualification-and-docs.md) ("Calibration, qualification and docs": 32-cell link shaping matrix, live Chromium downscale and legibility qualification, documentation reconciliation, and roadmap updates).
