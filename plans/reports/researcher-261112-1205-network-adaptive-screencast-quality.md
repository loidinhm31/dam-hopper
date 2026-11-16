# Network-adaptive CDP JPEG screencast quality

Research: 2026-11-12, Asia/Saigon. Scope: design only; five external primary/reference sources plus repository evidence. All numeric controller settings below are **proposals, not measured results**.

## Executive finding
- Adapt to **observed media delivery**, not a browser-reported connection speed. Reuse existing per-viewer credit ACKs, bounded pending frames, and delivery governor; add byte/latency/decode measurements before changing capture policy. [R1][R2][2][3]
- One shared JPEG producer cannot provide independent resolution/quality to different viewers; per-viewer skipping changes FPS only. Explicit shared-quality policy is required before promising “Auto” for every viewer. [R1][R3][1]
- Audio is a material bandwidth floor: 24 kHz × mono × 16 bits = **384 kbps PCM**, approximately **512 kbps base64**, before JSON/TLS overhead when continuously populated. Reserve actual audio bytes; sub-512-kbps connections cannot sustain that audio alone. [R5][R6]

## Evidence and reliability
| Signal | What to measure | Reliability / limitation |
|---|---|---|
| ACKed delivery rate | Server associates encoded byte length + monotonic enqueue time with exact outstanding frame key; sum bytes of validated ACK/discard completions over active windows. | Strong application-delivery observation, **not available-link capacity**. Current ACK follows decode/draw; discarded frames consumed bandwidth too. Separate received bytes from useful drawn bytes. Existing timestamps are discarded on credit return. [R1][R2] |
| Frame-ACK latency | Server ACK receipt minus enqueue time; track minimum and EWMA/p95. | End-to-end service latency: includes TCP queueing, transfer, decode, main-thread work, reverse path, and server scheduling. Not pure network RTT. Writer currently awaits sends inside receive/select loop, potentially delaying ACK observation. [R1][R2][R6] |
| Small echo RTT | Proposed small nonce echo on media socket; server monotonic timing. | Baseline/control-path proxy, still affected by scheduling/queueing. Compare **inflation over baseline**, not absolute RTT alone; never subtract client/server wall clocks. Existing capture/present Unix timestamps do not establish clock synchronization. [R2][R6][3] |
| Server send pressure | Time awaiting sink send; outstanding bytes/age; pending replacement count; expose actual socket/library queue if supported. | Send completion means transport accepted/flushed data, **not viewer received it**. Queue/sink delay is corroborating pressure, not a bandwidth meter. Current writer has a 5-second deadline, not adaptive control. [R1][R6][3] |
| Client `bufferedAmount` | Bytes queued by that client's `send()`. | Measures **upstream**, not downloaded JPEG backlog; unsuitable as server→viewer bandwidth estimate. Browser WebSocket lacks receive-side backpressure. Server queue requires server instrumentation, not reading browser `bufferedAmount`. [3] |
| Drop ratio | Distinguish server latest-pending replacements, broadcast lag, client `replaced`, decode failures, hidden/obsolete frames. | Congestion/overload symptom only. Server rate-limiting intentionally drops frames; client replacements can mean slow decoding, not network loss. TCP retransmissions are not application frame drops. Exclude intentional/epoch/privacy drops from congestion decisions. [R1][R2][R6][3] |
| `navigator.connection` | Feature-detect `downlink`, `effectiveType`, `saveData`; observe `change`. | Startup hint only: downlink estimated Mbps, rounded to 25 kbps; effectiveType derived from recent RTT/downlink, not actual radio generation. `saveData` is user preference, not speed. MDN marks limited availability: Chrome/Edge supported, Firefox/Safari not widely supported; require ACK-based fallback. [2] |
| Decode/draw cost | Proposed client monotonic durations around `createImageBitmap` and canvas draw, aggregated with frame size/count. | Strong local-overload signal, not network speed; includes scheduler effects. Slow decode + stable delivery ⇒ reduce FPS/pixels, rather than falsely diagnosing low bandwidth. Draw-call completion is not proof of physical screen presentation. [R2] |

## Estimation without WebRTC — proposed minimal design
1. Extend existing credit accounting, not a second transport: retain byte size, enqueue/send-completion times, completion disposition; reject duplicate/foreign keys as today. Add bounded decode/receive counters to existing media feedback. [R1][R2]
2. Sample ~1 second, smooth over 3–5 seconds; use ACKed-byte delivery during **busy** periods. Idle/static pages and FPS/credit-limited intervals are application-limited: freeze capacity inference, never interpret their low rate as slow internet. [R1][R2][1]
3. With two credits, achievable rate is also bounded approximately by `2 × frameBytes / ACK-service-seconds`; a high-latency but fast link can appear bandwidth-limited. Keep that limit visible; do not claim to measure raw capacity. [R1]
4. Maintain conservative media budget `Bvideo = max(0, 0.75 × estimatedDeliveredKbps − measuredAudioKbps)`; include BHJF/JSON and observed transport overhead margin. Treat estimator as conservative service budget, then probe cautiously upward during motion to discover headroom. [R1][R5][R6]
5. Do not calculate throughput by summing `frameBytes / eachFrameRTT`: overlapping frames double-count the same link. Use acknowledged bytes over one observation interval, retaining idle/application-limited flags. [R1]
6. ACK starvation with outstanding bytes is pressure, not “no samples = healthy.” Downshift pacing on rising oldest-frame age; retain existing timeout/closure safety and never withhold Chromium CDP ACKs to throttle a slow viewer. [R1][R7]

## Precedents and control law
- **KasmVNC:** Low/Medium/High/Extreme/Custom presets combine quality, frame rate, and resolution. Dynamic quality responds to motion per block; video-mode entry/exit thresholds use dwell times (documented defaults 5s/3s). This is content adaptation, **not evidence of a network-AIMD algorithm**. [4]
- Kasm's video mode downscales while preserving JPEG/WebP quality; authors report this tradeoff worked best for motion. Do not transfer that finding blindly to text: its normal mode and block-based updates differ from full-frame CDP JPEG. [4][1]
- **noVNC:** exposes JPEG `qualityLevel` 0–9 and separate `compressionLevel` 0–9; greater compression costs server CPU. These are RFB controls, not CDP parameters; noVNC API does not establish automatic bandwidth adaptation. [5]
- **Recommended controller [PROPOSAL]:** discrete tier ladder + asymmetric hysteresis; continuous AIMD is an alternative, not an extra controller to stack on top. On pressure, halve viewer FPS or descend one tier; on sustained health, probe one upward step. This borrows Kasm's preset/dwell simplicity, not its undocumented network behavior. [4][R1]
- Evaluate every second; downshift after 2 consecutive pressured windows; upshift only after 10 healthy seconds and estimated next-tier demand fits with ≥25% headroom. Minimum 5s capture-tier dwell; severe growing backlog bypasses dwell **for pacing only**. [PROPOSAL; 4][R1]
- Pressure starting values: oldest-frame age or ACK service exceeds baseline by `max(100ms, 0.5×baseline)`, with pending/credit saturation; or p95 decode exceeds next frame interval. Absolute high RTT alone must not reduce resolution. [PROPOSAL; R1][R2]

## Knob order and honest savings
| Knob | Recommended use | Bytes/frame and bandwidth consequence |
|---|---|---|
| Per-viewer FPS / delivery interval | First, while preserving legible text and avoiding producer restart. For reading, lower temporal detail usually preferable to smaller glyphs. | Same JPEG bytes/frame; 20→10 FPS halves JPEG bandwidth **if otherwise sending 20 changing frames/s**. Does not save Chromium capture/encode work when applied only after capture. [INFERENCE; R1][R3][1] |
| JPEG quality, e.g. 80→65 | Next, modest reduction at native stream size; inspect text edges/color artifacts. | CDP accepts 0–100, but quality is not a percentage of bytes. **No transferable “typical % saving” established by these sources**; measure JPEG lengths per representative page. Do not promise 20% fewer bytes from 20 quality points. [1][4][5] |
| Resolution cap | Next for persistent pressure; earlier for video/motion or decoder pixel overload. Keep CSS viewport unchanged. | Pixel-area proxy: scale 0.75 ⇒ 44% fewer pixels; 0.5 ⇒ 75% fewer. **Not guaranteed JPEG-byte savings**: content/quantization/resampling change compression. Lost glyph detail cannot be restored by client upscaling. [INFERENCE; 1][4] |
| `everyNthFrame` | Optional producer-side capture reduction after pacing proves useful. | Every second source frame can roughly halve emitted frames under stable source activity; it is **not a target FPS**. Server governor sets the output cadence; applying both without accounting can over-throttle. [1][R3] |

## Concrete initial ladder [PROPOSAL, calibration required]
Choose by **video budget remaining after audio**, then enforce measured `8 × frameBytes × fps / 1000 ≤ Bvideo`; thresholds alone never guarantee fit. Scale relative to existing capped stream bounds, not viewport CSS dimensions. [R3][R5][R6]

| Auto tier | Busy-period Bvideo | Scale | JPEG quality | FPS ceiling |
|---|---:|---:|---:|---:|
| High | ≥4,000 kbps | 1.00 | 80 | 20 |
| Medium | 1,500–3,999 kbps | 1.00 | 65 | 10 |
| Low | 500–1,499 kbps | 0.75 | 60 | 6 |
| Constrained | <500 kbps | 0.50 | 55 | 2; reduce further to fit |

- These numbers are tunable starting points, not benchmarked network classes. Respect configured admin FPS/quality ceilings; increase quality back before FPS for text-reading recovery. Kasm supports multi-knob presets, but its 0–9 quality values do not map directly to CDP 0–100. [PROPOSAL; 1][4][R3]
- Example **arithmetic, not measured typical size**: a 100-KB JPEG at 10 FPS needs ~8,000 kbps; at a 1,500-kbps budget it only supports ~1.9 FPS. Thus even “Medium” must downshift if real frame sizes exceed its allocation. [INFERENCE; R1][1]
- RTT modifier: keep scale/quality if budget fits; cap FPS to what two outstanding frames and measured ACK-service time can sustain. Rising RTT over baseline triggers pressure logic; fixed 300ms RTT is not proof of slow bandwidth. [PROPOSAL; R1]
- UX: **Auto / High / Medium / Low**, default Auto; Low includes Constrained when necessary. Show actual tier/FPS and “shared image quality” if shared. `saveData` starts Low; missing network API starts Medium and probes. Manual choice pins preferred quality/scale ceiling, not permission to accumulate stale frames. Preset-dropdown precedent: KasmVNC. [PROPOSAL; 2][4][R1]

## Shared producer, TCP, and geometry pitfalls
- **Shared policy [PROPOSAL]:** minimum requested capture tier among visible, non-stalled viewers; independent per-viewer FPS. This serves the slowest eligible viewer but deliberately lowers faster viewers' image fidelity. Hidden/disconnected/stalled viewers must not retain the minimum; existing demand/expiry and credit timeout provide lifecycle hooks. [R1][R3][R6]
- Alternative: designated controller owns shared scale/quality; observers skip frames. Better fast-viewer experience, but slow observers retain large-single-frame latency. Do not represent this as independent adaptive resolution. Only per-tier encoded derivatives or separate producers solve that; defer extra encoding until mixed-viewer demand is established. [INFERENCE; R1][R3]
- **TCP head-of-line [INFERENCE]:** stale JPEG bytes already written cannot be removed by replacing pending frames; later audio on the same stream waits behind those bytes/retransmission. Bound outstanding **bytes/age**, not just frame count; cap JPEG size for latency and skip before enqueue. Client `bufferedAmount` cannot see this receive backlog. [3][R1][R6]
- PCM shares that socket: continuous audio can exceed the entire low-link budget even after all video FPS reductions. Auto quality must surface audio budget infeasibility; muting playback alone does not save transmission. An explicit audio-off/unsubscribe option is a separate product decision. [INFERENCE; R5][R6]
- **Reconfiguration:** CDP exposes start/stop, not a documented seamless “set quality” command. Repo reissues `startScreencast` on resize and ignores its result; that is not proof of atomic hot-switch safety. Serialize tier changes, check errors, fence old candidates, preserve last good display, and measure switch gap on bundled Chromium; do not restart every sampling window. No defensible universal restart-cost milliseconds found. [1][R4]
- Full producer stop/start resets producer run/audio sequence; UI resets audio on producer-run changes. Capture-quality switching should not accidentally reset unrelated audio authority or route through viewport resize that changes page layout. [R2][R3][R4]
- **Coordinates:** keep actual JPEG width/height separate from CSS viewport geometry. Existing UI maps drawn letterboxed rectangle to fractions; server maps `x=u×cssWidth`, `y=v×cssHeight+offsetTop`, not JPEG pixels. Preserve input trust and viewport-epoch checks; account for page scale/offset through existing geometry contract, never multiply DPR twice. [R2][R8][R9]

## Ranked recommendation — KISS / YAGNI
1. **Delivery/decode measurements + per-viewer adaptive pacing first.** Reuse ACK keys, outstanding timestamps and latest-pending policy; no WebRTC migration, synthetic speed-test downloads, or new controller framework. [R1][R2][3]
2. **Add shared capture ladder + Auto/manual selector**, explicitly adopting slowest-visible-viewer policy; moderate JPEG reduction before text downscale, hysteresis and serialized capture changes. This is required for genuine resolution adaptation, not just FPS adaptation. [1][4][R3][R4]
3. **Gate mixed-viewer variants on demonstrated need.** A cached lower-resolution JPEG derivative costs decode/re-encode and may worsen text; separate producers cost capture resources. Never claim independent quality using frame skipping alone. [INFERENCE; R1][R3][1]
4. **Calibration acceptance for subsequent implementation:** throttle changing text/video pages at 0.5/1/3/10 Mbps with low/high RTT, audio on/off, two unequal viewers, slow decoder, and rapid resize; record queue age, useful FPS, bytes and tier-switch gaps. No builds/tests/benchmarks executed in this research stage. [PROPOSAL; R1][R2][R4][R5]

## Sources
[1]: https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Page.pdl#L1195-L1216
[2]: https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation
[3]: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
[4]: https://github.com/kasmtech/KasmVNC/wiki/Video-Rendering-Options
[5]: https://github.com/novnc/noVNC/blob/master/docs/API.md
[R1]: ../../server/src/browser_host/media.rs#L740-L894
[R2]: ../../packages/ui/src/browser-host/stream-controller.ts#L469-L666
[R3]: ../../server/src/browser_host/screencast.rs#L968-L1047
[R4]: ../../server/src/browser_host/screencast.rs#L693-L743
[R5]: ../../server/src/browser_host/protocol.rs#L32-L35
[R6]: ../../server/src/browser_host/media.rs#L1099-L1380
[R7]: ../../server/src/browser_host/screencast.rs#L1703-L1722
[R8]: ../../packages/ui/src/browser-host/input-controller.ts#L217-L253
[R9]: ../../server/src/browser_host/input.rs#L169-L195

## Unresolved questions
- Is lowering all visible viewers to the slowest viewer acceptable, or must independent per-viewer resolution be guaranteed? This determines whether one encoder remains sufficient. [R1][R3]
- What are representative JPEG bytes/frame and acceptable text legibility at each proposed quality/scale? Sources provide no transferable savings benchmark. [1][4]
- Does bundled Chromium safely replace an active screencast's parameters without stop/start, and what switch gap/old-frame behavior occurs? Protocol is experimental; tip-of-tree additions are not evidence of bundled-version support. [1][R4]
- Should low-bandwidth Auto explicitly offer audio transmission off, given ~512-kbps base64 PCM floor? [R5][R6]
