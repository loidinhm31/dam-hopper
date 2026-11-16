---
title: "Host Browser video and live tab audio streaming"
description: "Wire higher-FPS CDP video, selective media stealth, and privacy-fenced gapless tab audio into BrowserApp."
status: completed
priority: P2
effort: 20h
branch: feat/ai-os-redesign
tags: [feature, backend, frontend, api]
created: 2026-11-11
---

# Host Browser Video and Audio Streaming

## Outcome and scope
Enhance existing Rust CDP → BHJF → root-owned BrowserApp streaming. Default capture becomes 24 FPS/JPEG 75; configured capture and viewer cadence actually take effect. Stream page media/WebAudio as 24 kHz mono PCM16 JSON on the existing media WebSocket; play gaplessly with a viewer-local Mute/Unmute toggle.

<!-- evcrate-progress:start -->
Tasks: 2/2 completed; remaining: 0.
<!-- evcrate-progress:end -->

## Settled decisions
- User-confirmed `in_page_pcm_bridge`: non-enumerable `Symbol.for('dh.a')` on `EventTarget.prototype` in `ANTI_DETECTION_SCRIPT`; drain only during active streaming. No OS loopback, extension, sidecar, microphone capture, WebRTC transport or audio service.
- Preserve binary BHJF v1, native immediate ACK, two outstanding/one pending video credits, ticket/origin/live-auth checks, owner/epoch fencing and root keep-alive ownership.
- `ScreencastProducer::new` and `ViewerCreditController::new` retain 100 ms defaults. Production explicitly uses `with_capture_policy(fps, jpeg_quality)` and `with_min_interval(subscription_epoch, min_interval)`; media pending flush becomes 15 ms.
- Port only requested codec/MSE, device-label privacy and permission-default techniques from aicoworker; exact allowlisted autoplay flag. Reporting a codec never installs a missing decoder or bypasses DRM/CORS.
- Every audio suppression synchronously zeros gain, stops/flushes queued playback and invalidates asynchronous work: Cognito, LockScreen, reset fence, `!isEffectiveVisible`, user mute, retired owner/session/socket and disposal. Restore plays fresh audio only.

## Phases and ownership
| Phase | Status | Effort | Task ID / dependency |
| --- | --- | --- | --- |
| [01 Backend video/audio streaming](./phase-01-backend-video-audio-streaming.md) | Completed (2026-11-11) | 12h | `backend-browser-video-audio-streaming`; none |
| [02 UI PCM player/audio controls](./phase-02-ui-pcm-player-and-audio-controls.md) | Completed (2026-11-11) | 8h | `ui-browser-pcm-player-and-controls`; phase 01 |

Durable phase contracts are exact writable ownership. Backend owns wire/capture; UI consumes that contract. Coordinator is sole integration/finalization owner; no concurrent tests against half-finished changes. New player stays <200 lines, dependency-free. No task-state hydration or product implementation during authoring.

## Completion and verification status
- **Implementation & automated gates:** Both phases completed on `2026-11-11`. Implemented wire envelope (`BrowserAudioChunk`) includes canonical decimal-string `docEpoch` alongside `audioSeq` for strict navigation-authority fencing (`audioDocAuthority` / `CdpNavigationListener` native `loaderId` and `Page.navigatedWithinDocument` correlation).
- **Cycle 13 QA (`PASS`, [qa-report.md](./reports/qa-report.md)):** 40 Rust integration tests passed (4 ignored helpers across `browser_host_process` [28], `browser_host_media` [9, incl. live Chromium PCM & cross-doc/fragment/history correlation], `browser_host_screencast` [3]) + 2 Rust unit tests (`capture_policy_and_audio_chunk_admission_enforce_bounds_and_run_fencing`, `browser_host_config_defaults_and_validation`) + 89 UI Vitest tests across 4 files (`pcm-player.test.ts` 5, `stream-controller.test.ts` 31, `BrowserStreamKeepAliveHost.test.tsx` 39, `BrowserApp.test.tsx` 14) + clean `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`) + `packages/ui/src/browser-host/pcm-player.ts` verified at 199 physical lines (`< 200` LOC).
- **Cycle 13 Code Review (`9/10 APPROVED WITH NOTES`, [code-review-report.md](./reports/code-review-report.md)):** 0 critical, 0 high, 0 medium findings; `C12-H2` and `C12-H6` resolved. One low reporting note (`C13-L1` FPS/JPEG defaults in `implementation-report.md:7,20` reconciled; minor DTO wording note remains on `implementation-report.md:16`).
- **Manual runtime qualification note:** Interactive real output-browser qualification (audible/gapless WebAudio output, immediate silence across every privacy/visibility/reset gate, gesture unlock, two-viewer independence, and live FPS/latency measurement) remains an interactive user runtime check rather than an automated QA check.

## Shared wire contract
`/api/browser/media` keeps binary BHJF plus text `kind: "audioChunk"`; separate audio DTO, not `ServerControlEvent`. Required camelCase fields: `browserSessionId`, `browserIncarnation`, canonical decimal-string `profileEpoch`, `producerRun`, `subscriptionEpoch`, canonical decimal-string `audioSeq`, `sampleRate: 24000`, `channels: 1`, `encoding: "pcm16le"`, `data` (standard base64). Audio sequence increases per producer run; server supplies authority fields, never the page. Details/bounds in phase 01; phase 02 validates before decoding.

## Acceptance
- Default 24 FPS/75 and explicit alternative budgets propagate through producer governor, screencast/screenshot quality and both viewer admission paths; default constructors' 100 ms behavior remains intact.
- Live ordinary media-element and WebAudio output reaches BrowserApp; sustained chunks schedule contiguously without replay after mute/hidden/privacy/reconnect. Embedded-frame coverage is exercised, not inferred from top-page success.
- Toolbar button `data-testid="browser-audio-toggle-btn"`, accessible Mute/Unmute labels and pressed state; viewer-local mute needs no remote control lease.
- No `Runtime.enable`; no extra commands in stealth setup. Preserve exact `Browser.getVersion` → `Emulation.setFocusEmulationEnabled` → `Emulation.setUserAgentOverride` → `Page.addScriptToEvaluateOnNewDocument` → `Runtime.evaluate` → `Target.setAutoAttach` sequence.
- Bounded page/server/player queues; audio lag drops stale data, never blocks native ACK or bypasses cancellation/deadlines. Malformed/stale audio cannot affect video credits.
- Focused automated regressions, compile/typecheck and a live media/privacy journey recorded by coordinator after implementation; no FPS, audio or compatibility pass claimed from source inspection.

## Evidence, dependencies and gates
- [Planner report](./reports/planner-report.md); baseline [browser architecture](../../docs/architecture/host-browser-cdp-streaming.md), [code standards](../../docs/code-standards.md).
- Related [Cloudflare/login plan](../261111-0024-browser-cloudflare-google-login/plan.md) shares stealth/process/OS files: informational implemented-source baseline, not approval inferred from its status. [Review-remediation plan](../261109-2251-host-browser-review-remediation/plan.md) has unfinished overlapping stream/OS/qualification work: coordinator must serialize conflicting writers; no inherited whole-plan dependency or modifications here.
- Scoped authoring forbids maintained-doc edits. Coordinator owns architecture Gate 1 disposition before implementation, then updates existing architecture/code standards, actual configuration reference and existing changelog/roadmap during finalization. These writes are not granted by either phase allowlist; resolve docs-owner scope separately.
- Delegated authoring only: coordinator owns independent security/lifecycle challenge, related-plan scheduling and final validation. Current handoff is pending those gates, not implementation approval. No tests/builds/live probes run by planner.
- Rollback: stop/drain media subscriptions, then revert only this feature's code changes as a coordinated backend/UI cutover. Preserve profiles, credentials, lock files and reset tombstones; no reset or data deletion as rollback.

## Unresolved questions
None requiring a new product or code choice. Automated implementation, QA, and Code Review (9/10 APPROVED WITH NOTES) are complete; manual interactive output-browser audible/FPS/latency qualification remains an interactive user runtime check (see [project-manager-report.md](./reports/project-manager-report.md)).
