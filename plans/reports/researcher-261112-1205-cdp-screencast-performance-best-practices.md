# CDP screencast performance: DamHopper

Research: 2026-11-12, Asia/Saigon. Scope: Chromium → CDP → Rust/WebSocket → browser canvas; research only, no builds/tests. Recommendations marked **[INFERENCE]** are engineering judgments, not measured speedups.

## Executive summary
- Keep JPEG/BHJF; adapt capture size/quality before replacing transport. Upstream CDP can bound image dimensions without changing page layout; current producer policy is static. **[INFERENCE]** Best fit: small, hysteretic quality ladder, bounded queues, controller feedback. [S1] [R1]
- Fix/reconcile capture restart semantics first: resize currently calls `startScreencast` while streaming and ignores its result; current Chromium rejects an already-active screencast. This is a compatibility risk, not proof of failure on the deployed browser. [S2] [R2]
- Already good: decode base64 only after governor admission, immutable shared frame fan-out, one active client decode + one replaceable pending frame, explicit bitmap release. Do not propose these as missing features. [R3] [R4] [R5]

## Evidence: five primary source sets
1. **[S1] CDP reference/schema**, tip-of-tree: [Page reference](https://chromedevtools.github.io/devtools-protocol/tot/Page/), [canonical browser protocol schema](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json). Includes Emulation; experimental APIs, not a deployed-version guarantee.
2. **[S2] Chromium implementation**, current main: [page_handler.cc](https://github.com/chromium/chromium/blob/main/content/browser/devtools/protocol/page_handler.cc), [devtools_video_consumer.cc](https://github.com/chromium/chromium/blob/main/content/browser/devtools/devtools_video_consumer.cc), [frame_sink_video_capturer_impl.cc](https://github.com/chromium/chromium/blob/main/components/viz/service/frame_sinks/video_capture/frame_sink_video_capturer_impl.cc). Function names below locate behavior; implementation may change.
3. **[S3] WHATWG HTML Standard**: [canvas/OffscreenCanvas](https://html.spec.whatwg.org/multipage/canvas.html), [ImageBitmap/animation frames](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html), [`img.decode()`](https://html.spec.whatwg.org/multipage/embedded-content.html#dom-img-decode).
4. **[S4] WebCodecs**, editor draft 2026-11-09: [interfaces, processing model, hardware and latency controls](https://w3c.github.io/webcodecs/).
5. **[S5] Chrome Extensions**: [`chrome.tabCapture` reference](https://developer.chrome.com/docs/extensions/reference/api/tabCapture).

Source search: CDP parameters/ACKs; Chromium admission/capture; HTML decode/presentation; WebCodecs resource ownership; extension capture. Official documentation + implementation cross-check; no benchmark claims. `docs-seeker` lookup unavailable in Context7; direct primary-source fallback used.

## 1. Capture semantics and limits
| Concern | Evidence and consequence |
|---|---|
| Formats | Documented `startScreencast.format`: **jpeg/png**. Specify JPEG explicitly; current implementation defaults to PNG. `quality` is 0–100; JPEG encoder consumes it, PNG encoder ignores it. [S1] [S2] (`GetEncoder`, `StartScreencast`) |
| Bounds | `maxWidth/maxHeight` bound output image dimensions, not the page CSS viewport. Chromium aspect-fits the compositor pixel surface, never upscales (`scale` starts at 1). **[INFERENCE]** Reduce these for poor networks; preserve geometry/input coordinates. [S1] [S2] (`DetermineSnapshotSize`) |
| Cadence | `everyNthFrame` is a positive capture-frame divisor, **not FPS**. Chromium tests it before bitmap conversion/encoding; content/compositor activity, capture throttling and ACK credit determine actual cadence. [S1] [S2] (`OnFrameFromVideoConsumer`) |
| Static page | No fixed-cadence/heartbeat guarantee in CDP. Capture is compositor-damage/refresh driven; Viz can retry refresh and reuse unchanged captured content. Thus neither “always 60 FPS” nor “exactly one frame per DOM mutation” is a valid contract; duplicates are possible. [S1] [S2] (`OnFrameDamaged`, `RefreshInternal`, `CanResurrectFrame`) |
| ACK window | Each received event must return one `screencastFrameAck` credit; current Chromium increments credit before asynchronous encode, decrements on ACK. Despite protocol wording “frame number”, implementation emits its capture-session ID repeatedly; do not treat it as a unique frame sequence or dedupe ACKs by ID. [S1] [S2] (`StartScreencast`, `SendScreencastFrame`, `ScreencastFrameEncoded`, `ScreencastFrameAck`) |
| Runtime changes | No documented in-place update command. Current main rejects another `startScreencast` while active. **[INFERENCE]** Serialize stop → fenced restart for quality/size/divisor changes; do not assume repeated start mutates settings. [S1] [S2] (`StartScreencast`, `StopScreencast`) |
| New upstream knobs | Schema now has `maxFramesInFlight` (default 3) and `sendLastFrame`: retain latest raw frame while credit blocked, send when ACK arrives; trades conversion/memory work for lower latency. **Version-gate**, do not assume installed Chromium or pinned `chromiumoxide_cdp=0.9.1` supports them. [S1] [S2] [R6] |
| CPU/encoder | Current path allocates/copies an N32 bitmap from the captured frame, then dispatches JPEG/PNG encode to Chromium's thread pool. This is still CPU/memory work, not a promised hardware-video encoder. No portable FPS/bitrate/CPU guarantee; the consumer's current 10 ms minimum capture period is not an achievable-FPS promise. [S2] (`GetSkBitmapFromFrame`, `SendScreencastFrame`, `kDefaultMinCapturePeriod`) |
| HiDPI | Source bounds use compositor physical pixels; metadata `deviceWidth/Height` are DIP. `Emulation.setDeviceMetricsOverride` changes page-observed screen/viewport and DPR; capture bounds do not. **[INFERENCE]** Keep CSS viewport/DPR stable during network adaptation, vary image bounds; DPR changes can alter responsive rendering and raster workload. [S1] [S2] (`BuildScreencastFrameMetadata`, `DetermineSnapshotSize`) |

## 2. Server-side cost reduction
- **Avoid work upstream.** Today `everyNthFrame(1)` + immediate native ACK permits Chromium encode/JSON/base64 work for frames later overwritten by the Rust governor. **[INFERENCE]** Use coarse native divisor to reduce bitmap/encode work; retain latest-only governor for precise delivery pacing because a divisor is content-rate dependent. Native capture/readback before the divisor may still occur. [S2] [R1] [R3]
- **Do not “remove base64”.** CDP JSON explicitly carries base64 image data. Current producer decodes only the governor winner, once; keep that. It nevertheless clones the candidate base64 `String`, scans JPEG dimensions, then pack scans dimensions again and copies JPEG into BHJF. **[INFERENCE]** Retain immutable/shared candidate ownership; validate once into a trusted internal frame representation, pack/fan-out without repeated parsing. Keep validation at untrusted boundaries and memory reservations. [S1] [R3] [R4]
- Writer also unpacks published BHJF in admission/pending paths; UI unpacks once on arrival and again before decode. **[INFERENCE]** Carry validated header/key + payload view with immutable bytes rather than reparse identical trusted data; no need for speculative custom zero-copy protocol. [R7] [R5]
- **Dedupe narrowly. [INFERENCE]** Hash/equality of admitted compressed bytes can skip duplicate network/decode work, not Chromium encoding already done. Include producer/viewport epoch, dimensions, geometry and input trust; never suppress an authoritative geometry update or first frame for a new viewer. Confirm equality after hash if exactness required; compare against copy/hash CPU before enabling. [S1] [S2] [R3] [R4]
- **ACK pacing is backpressure, not a timer API. [INFERENCE]** A bounded producer-owned deferred-ACK scheduler can reduce future encode work once native credit fills; never sleep in the CDP receive/input actor or tie native credit to an arbitrary slow observer. Release every consumed/discarded event's credit exactly once; fence delayed credit across restarts. Beware final input-driven frames lost while native credit is exhausted; evaluate `sendLastFrame` only where supported. [S1] [S2] [R3]
- **Align limits.** Viewer writer defaults to 100 ms minimum interval (10 FPS), with 2 outstanding/1 pending frames, while capture policy accepts up to 30 FPS. **[INFERENCE]** Reconcile producer/native/delivery caps before promising adaptive 24–30 FPS; keep observer delivery bounded independently. [R1] [R7]

## 3. Client decode and paint
| Option | Recommendation/trade-off |
|---|---|
| `createImageBitmap(blob)` | Keep default: asynchronous Blob processing, callable in Window/Worker; current client already uses it and bounds decode concurrency. Promise does not promise free CPU or hardware acceleration. [S3] (ImageBitmap)[R5] |
| `ImageDecoder` | Optional measured experiment: typed-array input/transfer can avoid Blob construction, outputs `VideoFrame`, supports dedicated workers. Secure-context API; feature-detect and await `isTypeSupported('image/jpeg')`; neither codec availability nor faster JPEG decode guaranteed. Close output frames and decoder; independent JPEGs need independent decoder input lifecycle. [S4] (§10, resource model) |
| `<img>` | Real compatibility fallback: Blob URL → `img.decode()` → 2D draw; release URL after use. `decode()` is asynchronous; avoid a data-URL/base64 round trip. **[INFERENCE]** Less suitable than ImageBitmap for worker ownership, not inherently slower on every browser. Current no-ImageBitmap branch fabricates dimensions rather than decoding—do not rely on it as production fallback. [S3] (`img.decode()`)[R5] |
| Worker + `OffscreenCanvas` | **[INFERENCE]** Defer until decode/paint/UI-thread contention is measured. Transfer canvas before creating its context; transfer encoded buffers rather than clone them. Offscreen 2D retains aspect-fit rendering, but introduces worker lifecycle/resize/epoch/ownership handling; createImageBitmap already has asynchronous processing. [S3] (OffscreenCanvas, ImageBitmap)[R5] |
| `bitmaprenderer` | Ownership transfer can avoid the explicit 2D image-copy/composition step, **not a universal zero-copy guarantee**. Transfer detaches the bitmap; incompatible with current reusable cached bitmap and 2D letterboxing on that canvas. **[INFERENCE]** Keep 2D; consider only with image-sized backing canvas + CSS layout or separately composited surfaces. [S3] (`transferFromImageBitmap`)[R5] |
| `requestAnimationFrame` | **[INFERENCE]** Coalesce multiple decoded completions into one latest paint per display opportunity; bounded decoded slot and close superseded bitmaps. Adds up to a refresh wait versus immediate draw; at current 10 FPS may provide little benefit. Return frame ACK/discard according to actual chosen outcome, not merely arrival. [S3] (animation frames)[R5] [R7] |
| Resource ownership | `ImageBitmap.close()` releases graphical resources; current replacement/obsolete/dispose paths already close bitmaps while retaining one for layout redraw. **[INFERENCE]** Preserve these rules through worker/rAF/error paths; WebCodecs adds explicit `VideoFrame`/decoder cleanup. [S3] [S4] [R5] |
| Canvas hints | `getContext('2d', {alpha:false, desynchronized:true})` is a small experiment for this opaque display; `desynchronized` is optional and can tear, not a guaranteed latency improvement. Avoid `willReadFrequently:true` without readback workload. Context type cannot be switched after initialization. [S3] (CanvasSettings/getContext)[R5] |

## 4. Alternatives: benefit versus architectural cost
| Alternative | Fit for WebSocket/Rust/no guaranteed GPU |
|---|---|
| WebP CDP screencast | **Not documented/supported by screencast schema** (JPEG/PNG only); `captureScreenshot` documents WebP, and current Chromium's shared encoder implementation also happens to accept it for screencast. Do not mistake this implementation detail for portable protocol support. BHJF/JPEG validators would need changes. **[INFERENCE]** YAGNI now; do not transcode JPEG→WebP in Rust without measured benefit. [S1] [S2] (`GetEncoder`, `StartScreencast`)[R4] |
| H.264/VP8 + WebCodecs | **[INFERENCE]** Temporal coding can reduce motion-heavy bandwidth; encode in a trusted extension/capture context then Rust relays chunks over WS. `VideoEncoder` consumes frames, not arbitrary page DOM: obtaining tab pixels is a separate prerequisite. Requires negotiated codecs/config, keyframes/recovery, bounded encode/decode queues and timestamps; interdependent frames cannot be dropped like independent JPEGs. No required codec or GPU; use `isConfigSupported`, `latencyMode:'realtime'`, hardware preference as hint only. YAGNI until motion/video use proves JPEG insufficient. [S4] [S5] |
| WebRTC + `tabCapture` | `tabCapture` yields tab audio/video MediaStream, requires extension permission/user invocation and capture-context rules. **[INFERENCE]** Browser-managed media transport/congestion handling attractive for sustained video, but changes the WS-only transport contract and adds capture/signaling/connectivity/relay operations. Headless deployment compatibility needs qualification. YAGNI for present dev-tool scope. [S5] [S4] (shared codecs/WebRTC) |
| Delta/tile protocol | **[INFERENCE]** Attractive for sparse UI updates, but current CDP exposes full compressed images, not usable dirty tiles. Rust pixel differencing adds decode/copy/re-encode; client needs ordered state, base-frame IDs, full refresh on loss/resize/rejoin. Too much state for unproven savings; YAGNI. Prefer exact-frame dedupe first. [S1] [S2] [R4] |

## 5. Input latency and useful measurement
- **[INFERENCE]** Keep input/control independent of media, prioritize dispatch over frame conversion/packing, bound queues, coalesce only replaceable move/wheel traffic—not key/button transitions. Existing input sender has a control socket, microtask coalescing and buffered-byte guard; avoid moving decode onto that path. [R8] [S2]
- **[INFERENCE]** After input, prioritize the newest causally subsequent candidate rather than waiting an extra governor interval; spend a bounded burst token, do not force endless screenshots or unlock unbounded credit. Capture stop/start is too expensive/semantically disruptive to perform on every input. [R3] [S2]
- Current `captureTimeUnixMs` is server receipt time, not CDP frame capture time; `presentTimeUnixMs` is sampled after drawing, **not confirmed scan-out**. Preserve optional CDP metadata timestamp (seconds→ms), record receipt/send/decode/draw separately; new monotonic timestamp is version-dependent. [R3] [R5] [S1] [S2] (`ScreencastFrameTimestamp`)
- **[INFERENCE]** Echo frame sequence + client receive/decode/draw durations in ACK; server monotonic send→ACK estimates transport+client service, not pure bandwidth. Estimate achieved goodput only over sufficient non-idle transfers; static/low-FPS streams do not reveal available capacity. [S1] [R5] [R7]
- **[INFERENCE]** For input-to-draw, carry input sequence through server dispatch and identify a subsequent capture; client monotonic elapsed time avoids cross-machine wall-clock subtraction. “First frame after input” is only a proxy for visual response; use an instrumented visual marker for real causal measurement. Track p50/p95 latency, bytes/frame, FPS, decode time and superseded/discard ratios before changing codecs. [S1] [S2] [R8]

## Ranked low-risk/high-value optimizations
1. **P0: restart correctness/version qualification** before adaptation; serialize capture transitions, reset native session/run identity, preserve authoritative geometry and reject stale frames; surface command errors. [S2] [R2] [R3]
2. **P1: adaptive capture bounds + JPEG quality**, fixed CSS viewport/DPR, few tiers + hysteresis; drive by delivered bytes/ACK service/decode time, not a static “internet speed”. **[INFERENCE]** Coordinate shared-producer policy with controlling viewer; do not degrade every viewer because one passive observer is slow. [S1] [R1] [R7]
3. **P1: reduce native wasted work**, reconcile 10 FPS writer default with capture policy, use coarse divisor + latest-only governor; bounded ACK pacing only after lifecycle semantics are safe. [S2] [R1] [R3] [R7]
4. **P1: remove repeated trusted parsing/base64 clone**, retain validated immutable frame metadata and shared bytes; preserve hard memory/security bounds. [R3] [R4] [R5] [R7]
5. **P2: correct timing/feedback**, then compressed-frame dedupe and opaque/desynchronized canvas experiment. **[INFERENCE]** Benchmark existing createImageBitmap/2D before workers, ImageDecoder or bitmaprenderer. [S1] [S3] [S4] [R3] [R5]
6. **Defer** WebP loopholes, video codecs, WebRTC and tiling until measured requirements justify new protocol/capture state. [S1] [S2] [S4] [S5]

## Repository references
- **[R1]** [static policy](../../server/src/browser_host/screencast.rs#L636-L640), [native start/bounds/divisor](../../server/src/browser_host/screencast.rs#L1017-L1028).
- **[R2]** [resize/metrics + repeated start](../../server/src/browser_host/screencast.rs#L693-L740).
- **[R3]** [governor loop](../../server/src/browser_host/screencast.rs#L1149-L1184), [ACK + candidate clone/receipt timestamp](../../server/src/browser_host/screencast.rs#L1685-L1739), [admission/decode/pack/cache](../../server/src/browser_host/screencast.rs#L1786-L1895).
- **[R4]** [JPEG validation + contiguous BHJF packing](../../server/src/browser_host/protocol.rs#L264-L369).
- **[R5]** [context creation](../../packages/ui/src/browser-host/stream-controller.ts#L149), [arrival unpack/bounded queue](../../packages/ui/src/browser-host/stream-controller.ts#L471-L546), [decode/bitmap ownership/ACK/timing](../../packages/ui/src/browser-host/stream-controller.ts#L549-L666), [2D aspect fit](../../packages/ui/src/browser-host/stream-controller.ts#L669-L727), [dispose release](../../packages/ui/src/browser-host/stream-controller.ts#L879-L883).
- **[R6]** [pinned CDP types](../../server/Cargo.toml#L176-L179).
- **[R7]** [writer limits](../../server/src/browser_host/media.rs#L49-L53), [trusted-frame unpack/delivery credit](../../server/src/browser_host/media.rs#L788-L834).
- **[R8]** [input coalescing/control sender/queue guard](../../packages/ui/src/browser-host/input-controller.ts#L452-L486), [direct input send](../../packages/ui/src/browser-host/input-controller.ts#L506-L540).

[S1]: https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json
[S2]: https://github.com/chromium/chromium/blob/main/content/browser/devtools/protocol/page_handler.cc
[S3]: https://html.spec.whatwg.org/multipage/
[S4]: https://w3c.github.io/webcodecs/
[S5]: https://developer.chrome.com/docs/extensions/reference/api/tabCapture
[R1]: ../../server/src/browser_host/screencast.rs#L636-L640
[R2]: ../../server/src/browser_host/screencast.rs#L693-L740
[R3]: ../../server/src/browser_host/screencast.rs#L1645-L1895
[R4]: ../../server/src/browser_host/protocol.rs#L264-L369
[R5]: ../../packages/ui/src/browser-host/stream-controller.ts#L471-L727
[R6]: ../../server/Cargo.toml#L176-L179
[R7]: ../../server/src/browser_host/media.rs#L49-L53
[R8]: ../../packages/ui/src/browser-host/input-controller.ts#L452-L540

## Unresolved questions
- Which deployed Chromium versions/headful/headless modes must work? Repeated-start behavior, new ACK knobs, WebP implementation detail and timestamp fields need version qualification; upstream main is not runtime proof. [S1] [S2] [R6]
- Which bottleneck dominates representative idle/text/scroll/video sessions: Chromium bitmap/encode, Rust copies, writer pacing, link throughput or client decode/paint? No measurements performed. [S2] [R3] [R5] [R7]
- Shared producer: controlling viewer versus passive-observer policy? Minimum legible text resolution, acceptable p95 input latency, and whether >10 FPS is required? These determine ladder floors and whether video alternatives merit complexity. [R1] [R7]
