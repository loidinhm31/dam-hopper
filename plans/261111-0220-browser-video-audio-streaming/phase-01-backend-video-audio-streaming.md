# Phase 01 — Backend Video and Audio Streaming

## Overview and context
- Priority P2; status completed (2026-11-11); effort 12h; owner backend implementer (`main-agent`).
- Task: `backend-browser-video-audio-streaming`. Supplies phase 02's exact audio DTO, lifecycle and limits; backend implementation completes before UI integration.
- [Overview](./plan.md), [planner evidence](./reports/planner-report.md), [baseline architecture](../../docs/architecture/host-browser-cdp-streaming.md).
- Donor references: `/home/loidinh/WS/aicoworker/electron/browser/anti-detection-preload.cjs` (permission defaults lines 419–469, device stripping 481–504, codecs 510–531); donor player is playback inspiration, not a source of tab capture.

## Key insights and requirements
- `screencast.rs` currently sets a 100 ms governor and hardcodes quality 65 for both `Page.startScreencast` and screenshot fallback. `media.rs` separately throttles both direct delivery and pending flush to 100 ms. Raising config alone changes neither hot path.
- `run_producer_tasks` already owns run cancellation, native event drain, candidate publication and demand expiry. Audio polling must not await a CDP RPC inside that video event branch: a slow page must not delay ACKs/governor processing.
- `build_producer` already installs pre-navigation stealth; do not duplicate installation or change setup command order. Existing OOPIF setup injects the same script; avoid enabling Runtime events.
- Preserve all process containment, sandbox/TLS/site-isolation, browser origin policy, authentication, tickets, epoch checks and socket control input limits.

## Architecture and shared contracts

### Video policy
Add a consuming builder `ScreencastProducer::with_capture_policy(self, fps: u32, jpeg_quality: u8) -> Self`; configure before `Arc` publication. Store interval and quality, copy both through `clone_handle`, and use quality for native capture and fallback. `new` retains its old 100 ms/65 behavior. Production passes validated `BrowserBudgetsConfig` values, default 24/75. Use `Duration::from_secs_f64(1.0 / fps as f64)` rather than integer milliseconds; do not introduce a zero interval. Reuse existing validation ranges (FPS 1–30, JPEG 10–100); defensive builder bounds must not weaken config rejection.

`ViewerCreditController::with_min_interval(subscription_epoch: String, min_interval: Duration) -> Self` sets stored interval and initializes `last_delivery` relative to it. `new` delegates with 100 ms. Both `on_incoming_frame` and `check_flush_pending` use the stored interval; credits/keys stay unchanged. Pass configured frame interval from authenticated media handler into `run_media_session`, even when no producer exists. Change its 50 ms `flush_ticker` to 15 ms; do not turn it into a second 24 FPS cap. An actual 24 FPS visual result depends on page, engine, network and decoding; measure, do not guarantee every device sustains 24.

### Page capture bridge
- Add bridge initialization inside existing `ANTI_DETECTION_SCRIPT`. Define `EventTarget.prototype[Symbol.for('dh.a')]` non-enumerably; all mutable capture state lives in closures. Do not add named globals, DOM artifacts or `Runtime.addBinding`. The Symbol hides enumerable state, not a security boundary or proof of undetectability.
- Keep existing whole-preload idempotence and give audio its own idempotent install guard. Repeated document-start/current-document evaluation must not duplicate graph connections, listeners, observers or samples.
- Bridge methods: `start(runToken)` clears prior PCM/state and enables capture; `drain(runToken)` returns at most two fresh PCM chunks; `stop(runToken)` clears/disables only that run. A late prior-run stop must not disable its successor. Navigation creates fresh document state; every poll can install/start the new document bridge without changing stealth setup.
- Capture ordinary `<audio>`/`<video>` output plus WebAudio output, including elements added later and sources started before first viewer demand. Use a 24 kHz mono mixing `AudioContext`, media-element `captureStream()` audio tracks and `createMediaStreamSource`; do not seize elements with `createMediaElementSource`, which can silence CORS-protected playback or collide with a site's existing node. Track streams/elements once with weak identity and disconnect removed/ended sources.
- Tap WebAudio at destination connections using original native methods and per-context `MediaStreamAudioDestinationNode`; feed those streams to the capture mixer. Preserve native `connect` return values, overloads, exceptions, destination audio and matching `disconnect` semantics. Do not capture bridge-created nodes or double-capture a media element already routed through a tapped WebAudio graph. Detect contexts created while capture is idle; stop releases capture-only nodes without stopping site-owned sources/contexts.
- A small inline processor inside the existing preload is sufficient; no external worklet/dependency/files. Capture only while enabled, request 24 kHz, and verify the actual rate; retain fractional resampling state if the engine supplies another rate. Mix channels to mono, clip finite samples, encode signed PCM16 little-endian. No per-sample base64/string concatenation; convert whole bounded chunks.
- Child documents receiving the preload must contribute, not merely accumulate undrained queues. Use a bounded in-page parent relay into the top-document mixer for embedded media, with source-window/document/run scoping, ordered sample timestamps, removal/navigation cleanup and per-source bounds. Same-origin frames can connect directly; cross-origin frames may relay only PCM they are allowed to capture. Mix simultaneous sources by timestamp, never concatenate concurrent frame streams (which slows/reorders audio). Never request camera/mic or relax site isolation/CORS. Exercise real embedded-frame coverage; unsupported/protected streams remain explicit limitations, never fabricated PCM or a passing claim.
- Bound each chunk to 2,400 samples (100 ms / 4,800 decoded bytes / 6,400 base64 characters). Page ready queue max five chunks (500 ms), discard oldest on overflow. Cap concurrent retained source/relay state (16 sources), evict ended sources, reject excess rather than allocate unboundedly. Teardown removes capture-owned relay state and disconnected-frame buffers. Do not poll/retain PCM indefinitely with no viewers; a short renewal lease from active drains disables/clears capture if explicit stop cannot reach the page.

### Producer drain and fanout
- Add one cancellable, single-flight audio drain worker owned/awaited by `run_producer_tasks` lifetime; 50 ms ticks with missed ticks skipped, never concurrent evaluations or detached leaking work. Use existing `send_command("Runtime.evaluate", ..., Some(page_session_id))`, `returnByValue: true`, bounded responses and existing CDP timeout/cancellation. Audio startup/drain happens here, not in stealth setup.
- After every await, recheck current producer run, active demand and cancellation before publishing. Stop/zero demand/navigation/run restart flushes old page/server state. New viewers receive no historical audio cache. An absent bridge/new document yields no chunk and retries only on the next normal poll; no busy-loop or new retry service. Audio failures do not tear down healthy video or log PCM.
- Parse the nested CDP `result.result.value`; reject exception details, malformed/oversized arrays, wrong PCM format and invalid base64/odd byte counts. At most two chunks per response. Assign a checked positive `u64` audio sequence per run, serialized as canonical decimal string; never wrap. Page data cannot choose principal/session/run/epoch authority.
- Bounded broadcast of immutable shared chunks, capacity five; lag skips old audio rather than stalling capture/video. Each viewer adds its own `subscriptionEpoch` when serializing, after validating producer identity/current run. Do not reuse a JSON string carrying another viewer's subscription or replay any audio on attach.
- Quantify fixed page/server/viewer audio allocations alongside existing memory assumptions. Reuse existing browser budget accounting in `config.rs` for any additional retained backend buffers; keep ceilings/config rejection meaningful, without increasing global resource caps.

### Media text envelope
Server → viewer, alongside unmodified binary BHJF:

```json
{"kind":"audioChunk","browserSessionId":"<server UUID>","browserIncarnation":"<server UUID>","profileEpoch":"1","producerRun":"<run UUID>","subscriptionEpoch":"<viewer UUID>","audioSeq":"1","sampleRate":24000,"channels":1,"encoding":"pcm16le","data":"<standard base64 PCM>"}
```

Define a separate typed audio envelope in `protocol.rs`; camelCase serializer; maximum serialized audio message 8 KiB. Validate size before expensive decode/copy. The 1 KiB `MAX_MEDIA_CONTROL_BYTES` remains the inbound client-control cap, not the outbound audio cap. Do not add audio to `/api/browser/control`, modify BHJF framing/version or grant audio access without an admitted media subscription.

In `run_media_session`, subscribe to audio as well as frames and service both through the existing single socket sink. No audio ACK/credit accounting: audio loss drops stale sound, video retains exact two-outstanding/one-pending credit semantics. On broadcast `Lagged`, continue at fresh available data; on `Closed`, disable that receive branch rather than spin. Skip audio for non-visible/retired demand. Use the same bounded write deadline and cancellation race as video, with a text-capable helper or shared message writer; no second sink owner or unbounded writer queue. Auth/reset cancellation and absolute expiry apply to text writes as to binary writes.

## Related code files
All paths below are absolute; task allowlist below is canonical project-relative ownership.

| Action | File | Changes |
| --- | --- | --- |
| Modify | `/home/loidinh/WS/dam-hopper/server/src/browser_host/config.rs` | Defaults 24/75; account bounded retained audio if required by current estimate |
| Modify | `/home/loidinh/WS/dam-hopper/server/src/browser_host/protocol.rs` | Effective defaults; audio DTO/limits and focused colocated tests |
| Modify | `/home/loidinh/WS/dam-hopper/server/src/browser_host/process.rs` | Exact autoplay flag in launch and allowlist; retain rejection policy |
| Modify | `/home/loidinh/WS/dam-hopper/server/src/browser_host/stealth.rs` | Selective capability/permission/device ports and in-page PCM bridge |
| Modify | `/home/loidinh/WS/dam-hopper/server/src/browser_host/screencast.rs` | Policy builder, clone propagation, cancellable audio worker/fanout, colocated tests |
| Modify | `/home/loidinh/WS/dam-hopper/server/src/browser_host/media.rs` | Production policy wiring, per-viewer interval, 15 ms flush, audio text fanout |
| Modify | `/home/loidinh/WS/dam-hopper/server/src/browser_host/cdp.rs` | Project `loader_id` on `CdpLifecycleEvent::FrameNavigated` and notify registered navigation listeners synchronously at native command dispatch/response |
| Modify | `/home/loidinh/WS/dam-hopper/server/src/api/browser_host.rs` | Bind `request_audio_doc_epoch` synchronously at API `navigate`/`history`/`reload` dispatch before sending CDP navigation commands |
| Modify | `/home/loidinh/WS/dam-hopper/server/src/config/tests.rs` | Default FPS/quality assertions and affected bounded-memory expectations |
| Modify | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_process.rs` | Positive exact autoplay flag and negative near-match/security cases |
| Modify | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_media.rs` | Policy, mixed-media text/binary, bounds, isolation and cancellation regressions |

No files created/deleted. Existing screencast integration tests are regression consumers, not writable ownership. Escalate to coordinator if another file is essential; do not silently expand scope.

## Implementation steps — backend-browser-video-audio-streaming
1. Confirm exact current setup/mock sequence and config ranges; preserve legacy constructors. Define audio DTO/constants and tests, then wire production video policy end-to-end, including fallback quality and clone handles.
2. Add exact `--autoplay-policy=no-user-gesture-required` to built-in launch arguments and `is_allowlisted_arg`; reject alternative values, prefix lookalikes and other security-altering flags.
3. Replace/extend the existing permissions wrapper, not a second stacked one: donor `PERMISSION_DEFAULTS`, notification-specific state and native delegation for unknown permissions. Strip device `label`, `deviceId`, `groupId` while preserving `kind`/count/serialization. Spoofed query results do not grant actual device/OS permission.
4. Normalize requested `canPlayType` and `MediaSource.isTypeSupported` support for H.264/MP4 (`avc1`, `video/mp4`), WebM/VP8/VP9, AAC (`mp4a`, `audio/mp4`), MP3 (`audio/mpeg`) and Opus; guard missing APIs, preserve receivers and native fallback for unrelated types. MSE/WebM extensions are required enhancements, not claims that the donor implements them already.
5. Implement bridge capture/mixing/idempotence/teardown and embedded-frame relay inside existing preload. Add bounded run-aware drain worker and immutable audio broadcast without inserting setup commands.
6. Wire audio text writes into media session with per-socket authority, lag handling, fair bounded processing, original inbound limits, existing cancellation/deadlines and teardown. Preserve live view-only audio without a controller lease.
7. Add focused permanent regressions in allowed files; provide implementation handoff with exact changed scope, wire field names/constants and any live-engine limitations to UI/coordinator. Do not claim browser audio proof from serializer or string-presence tests.

## Durable task contract
```evcrate-tasks
[
  {
    "id": "backend-browser-video-audio-streaming",
    "title": "Implement configured high-FPS video and bounded in-page PCM media streaming",
    "blocked_by": [],
    "allowed_files": ["server/src/browser_host/config.rs", "server/src/browser_host/protocol.rs", "server/src/browser_host/process.rs", "server/src/browser_host/cdp.rs", "server/src/browser_host/stealth.rs", "server/src/browser_host/screencast.rs", "server/src/browser_host/media.rs", "server/src/api/browser_host.rs", "server/src/config/tests.rs", "server/tests/browser_host_process.rs", "server/tests/browser_host_media.rs"],
    "constraints": [
      "Preserve ScreencastProducer::new and ViewerCreditController::new 100 ms defaults; configure production through the new builders.",
      "No Runtime.enable or added CDP commands in apply_stealth_and_focus/apply_stealth_to_session; preserve exact existing setup order.",
      "Keep BHJF, native ACK, viewer credits, auth/origin/ticket/profile fencing, sandbox and input control limits unchanged.",
      "Audio capture/drain is bounded, current-run/cancellation fenced, demand-driven and never blocks the video drain on a page RPC.",
      "Only exact listed files are writable; escalate required changes outside ownership. Coordinator owns integrated verification and maintained documentation."
    ],
    "acceptance": [
      "Default 24 FPS/JPEG 75 and nondefault validated budgets reach screencast, fallback screenshot, producer governor and both viewer delivery paths; pending flush is 15 ms.",
      "Requested media capability/device/permission patches and exact autoplay flag are installed without security-flag broadening or setup-sequence regression.",
      "Ordinary page media and WebAudio produce bounded 24 kHz mono PCM16LE audioChunk text envelopes with server-owned identity and viewer-specific subscription fencing alongside unchanged binary video.",
      "No audio history survives zero demand, run restart, navigation or reset; lagged/invalid audio is dropped without consuming video credits or defeating auth cancellation.",
      "Automated policy/wire/lifecycle regressions exist in allowed files; real capture, embedded frames and playback are qualified by coordinator, not inferred from script text."
    ],
    "verification": [
      "Coordinator runs cargo check --manifest-path server/Cargo.toml and focused config/producer/protocol unit tests after implementation; record commands/exits and preserve 100 ms constructor assertions.",
      "Coordinator runs cargo test --manifest-path server/Cargo.toml --test browser_host_process --test browser_host_media --test browser_host_screencast; existing screencast integration coverage remains unmodified unless separately authorized.",
      "Exercise real Chromium ordinary media, WebAudio, embedded frames, dynamic sources, navigation, demand stop/restart, mixed text/binary delivery and live-auth/reset cancellation; record observed PCM format, bounded queues and actual failures without credentials or raw audio logs."
    ]
  }
]
```

- [x] <!-- evcrate-task:backend-browser-video-audio-streaming --> Implement configured high-FPS video and bounded in-page PCM media streaming

> Completion note (2026-11-11): Cycle 13 QA PASS (`reports/qa-report.md`: 40 integration tests across `browser_host_process` [28, 4 ignored helpers], `browser_host_media` [9], `browser_host_screencast` [3] + 2 focused Rust unit tests `capture_policy_and_audio_chunk_admission_enforce_bounds_and_run_fencing` and `browser_host_config_defaults_and_validation`). Cycle 13 Code Review (`reports/code-review-report.md`): 9/10 APPROVED WITH NOTES (0 critical/high/medium; `C12-H2` and `C12-H6` resolved; implemented `BrowserAudioChunk` envelope includes canonical decimal-string `docEpoch` for navigation fencing). Manual interactive output-browser audible/FPS/latency qualification remains an interactive user runtime check.

## Success criteria and verification design
- Use existing `MockBrowser` boundaries for command parameters, strict setup ordering, drain response parsing, stale run/late stop, cancellation and queue overflow. Delayed audio RPC must leave frame ACK/publication live. Execute JavaScript against actual Chromium for graph output, not Rust substring assertions.
- Test both viewer admission paths at 100 ms legacy and configured 24 FPS/other allowed FPS. Assert quality in native capture and screenshot params, and unchanged credit caps/exact keys under load.
- Mix JSON audio and binary frames on one admitted socket; assert other subscriptions cannot receive forged authority, audio never increments video outstanding counters, and blocked text writes abort on revoke/reset.
- Validate cap edges, invalid base64/odd bytes, unsupported encoding/rate, sequence overflow, closed/lagged broadcast and no-viewer demand; verify no retry spin or unbounded pending tasks.
- Coordinator records real media codec/autoplay results on configured Chromium, including missing-codec/DRM/CORS limitations; source claims are not engine qualification.

## Risks, security and rollback
- CaptureStream and WebAudio taps have engine/CORS/protected-content limitations; never relax security or fabricate output to pass. A failing ordinary-media/WebAudio acceptance blocks completion and is escalated with exact engine/fixture evidence.
- Instrumentation can duplicate audio or retain graphs; weak source identity, original native methods, explicit disconnect semantics and real overlap/removal tests are mandatory. No microphone, speakers loopback, permanent audio recording or PCM logging.
- Page-controlled data is untrusted even when accessed through a hidden bridge; parse/size-bound before forwarding and always attach server authority. Symbol/relay techniques are not a sandbox or undetectability guarantee.
- Higher quality/FPS increases bandwidth/CPU; honor existing resource/memory ceilings. Audio is best-effort bounded-latency, not lossless archival or guaranteed A/V synchronization.
- Rollback stops media then reverts only coordinated feature changes; never remove browser profile/lock/tombstone data or weaken other in-flight remediation.

## Next steps
Backend implementation, focused Rust unit/integration gates (40 integration + 2 unit tests), and Cycle 13 Code Review (9/10 APPROVED WITH NOTES) are complete; see [PM report](./reports/project-manager-report.md).

## Unresolved questions
None requiring a product or code choice. Interactive output-browser audible/FPS/latency qualification remains a manual user runtime check.
