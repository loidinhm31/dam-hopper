# Browser UI client code review

## Scope and assessment
- Read-only review; no code changes, builds, tests, linters, or runtime profiling. No plan supplied/updated. Critical: none verified.
- Inspected `packages/ui/src/browser-host/{stream-controller.ts,frame-protocol.ts,canvas-view.tsx,input-controller.ts,selection-controller.ts,pcm-player.ts,text-input-proxy.tsx}`, `packages/ui/src/api/browser-host-{client,types}.ts`, `packages/ui/src/os/{BrowserStreamKeepAliveHost.tsx,apps/BrowserApp.tsx,browser/browser-{tools,address-bar}.tsx,browser/browser-tab-types.ts}`; supporting owner/auth contracts, targeted tests, server rate/sequence enforcement, README/PDR/code standards.
- Findings below are source-verified; runtime frequency/cost unmeasured. Highest priorities: unsafe remote HTTP transport, input-rate disconnects, missing stream recovery.

## Performance

### High — P1: Input “coalescing” does not bound real event rate
- Evidence: `packages/ui/src/browser-host/input-controller.ts:422-469` flushes via `queueMicrotask`; browser pointer/wheel events in separate tasks therefore normally each send a record. `server/src/browser_host/media.rs:1626-1635,1707-1724` disconnects after 100 text messages in a one-second window, revokes control, unregisters attachment.
- Impact: high-rate mouse/trackpad movement can terminate the stream, not merely consume bandwidth; keyboard/barrier messages share this budget. Fix: latest-move/accumulated-wheel flush on a bounded timer, with discrete barriers and total-rate headroom; rAF alone is insufficient on >100Hz displays. Allocate sequence on actual send.

### Medium — P2: Every decoded frame is fully parsed/validated twice
- Evidence: `packages/ui/src/browser-host/stream-controller.ts:476-479,543-545,562-566`; `frame-protocol.ts:344-364` constructs TextDecoder, decodes/parses JSON, checks geometry/counters, scans JPEG SOF on both calls.
- Impact: redundant main-thread work/allocations before JPEG decode; dropped pending frames still pay the initial validation. Fix: retain the validated header + zero-copy JPEG subarray in PendingFrame and decode that; preserve first-pass safety checks. Parser uses subarray, not an extra JPEG byte copy; Blob creates a snapshot per decoded frame.

### Medium — P3: Browser-tab backgrounding/occlusion does not retire demand
- Evidence: `packages/ui/src/os/apps/BrowserApp.tsx:189-199` gates on OS desktop/minimize/privacy, not document visibility; `BrowserStreamKeepAliveHost.tsx:548-607,890-900` repeats those checks. Its window-blur handler only releases input (`517-524`); `stream-controller.ts:300-310` continues visible heartbeats.
- Impact: switching the actual browser tab/desktop keeps network/decode/audio demand alive while timers run; server expiry is not an immediate pause. Fully covered OS windows likewise have no occlusion gate. Fix: add document visibility to synchronous demand/input/audio guards and reconnect on foreground; only add window-occlusion tracking if required, not blur-as-visibility.

### Medium — P4: Selection polling admits overlapping, unabortable requests
- Evidence: `packages/ui/src/browser-host/selection-controller.ts:482-560`: 200ms setInterval invokes async poll without in-flight guard or AbortSignal; cleanup only stops future callbacks. `BrowserApp.tsx:282-289` supplies no visibility gate.
- Impact: slow links accumulate concurrent REST work and out-of-order responses; inspection/preview polling also continues while minimized/masked. Fix: schedule the next poll after settlement, abort on cleanup, and gate polling on effective visibility while retaining selection state.

### Medium — P5: Parked/non-live tabs retain large canvas dimensions
- Evidence: `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:2122-2159` mounts a stream item for every tab, parking host is 1024×768; items render CanvasView even without a live session (`2054-2071`). `canvas-view.tsx:50-76` sizes backing canvas at DPR up to 3; `stream-controller.ts:787-824` closes cached bitmap but never shrinks canvas on hide.
- Impact: canvas dimensions/resources scale with retained tabs, including new/deferred tabs. A 3072×2304 RGBA backing image is nominally 27MiB; actual browser allocation is unmeasured. Fix: keep DOM/controller identity, but use tiny backing dimensions while parked and resize on reveal; avoid initializing full render resources for never-streamed tabs.

## Functional correctness

### High — F1: Stream socket failure never drives recovery or truthful UI
- Evidence: `packages/ui/src/browser-host/stream-controller.ts:257-294`: media close changes internal status only; control close just clears audio authority. `BrowserStreamKeepAliveHost.tsx:1067-1259` installs neither onStatusChange nor reconnect handling; attachment effect (`1519-1770`) depends on visibility/owner/session/retryNonce, not socket status. Retry button exists only for ticket-capacity errors (`2072-2087`).
- Impact: transient media/control failure leaves a frozen canvas with live/view-only/controlling chrome; no automatic retry until another lifecycle transition. Heartbeat interval survives unexpected media close until later detach. Fix: retire the pair/held authority on either close, surface disconnected status, and bounded-backoff fresh-ticket reattachment to the same verified session; cancel retries on hide/privacy/owner change. Never recreate the remote page.

### High — F2: Backpressure drops an already-numbered input record
- Evidence: `packages/ui/src/browser-host/input-controller.ts:452-469,474-489` increments inputSeq before microtask flush; bufferedAmount >256KiB discards the record without restoring sequence. `server/src/browser_host/input.rs:451-467` requires contiguous sequence and revokes lease on a gap.
- Impact: after congestion clears, the next record invalidates otherwise-current control; local state is not reset by this rejection (`server/src/browser_host/media.rs:1646-1647` only logs). Fix: allocate sequence only when handing a record to the live socket; on ambiguous send failure retire/reacquire authority rather than reuse a possibly-consumed sequence. Do not leave a lost record behind a continuing lease.

### Medium — F3: Paste silently loses everything beyond 4096 UTF-8 bytes
- Evidence: `packages/ui/src/browser-host/text-input-proxy.tsx:164-175` forwards clipboard text then clears textarea; `input-controller.ts:401-419` silently truncates one insertion to 4096 bytes.
- Impact: ordinary multi-line/code pastes arrive incomplete with no feedback. Fix: explicitly reject oversize paste with a visible limit message, or send bounded UTF-8 chunks through the existing paced/owner-fenced queue; never silently truncate.

### Medium — F4: Mouse drag has no pointer capture
- Evidence: `packages/ui/src/browser-host/canvas-view.tsx:92-105` binds up/move/cancel only on canvas; `BrowserStreamKeepAliveHost.tsx:1844-1878,2012-2041` never captures the pointer. `input-controller.ts:264-276` retains the pressed button until an up/cancel/release.
- Impact: mouse-up outside canvas can be missed while text proxy remains focused, leaving the remote page dragging until a later blur/cleanup. Fix: capture accepted pointer-down, release on up/cancel, and handle lostpointercapture with cancellation; preserve click-control handoff fencing.

### Medium — F5: Unsupported decoder/draw failure is acknowledged as success
- Evidence: `packages/ui/src/browser-host/stream-controller.ts:568-578` fabricates an ImageBitmap-shaped object when createImageBitmap is absent; `709-724` swallows drawImage errors and publishes an input rectangle; `601-628` then emits frameAck/presentation metrics even when context/dimensions prevented drawing (`676-680`).
- Impact: unsupported/failed rendering can display black/stale pixels while granting input trust and reporting presentation. Fix: fail explicitly or use a real supported decoder fallback; return draw success, publish geometry/ACK only after successful drawing, otherwise emit a disposition and visible error. Keep mocks in tests.

### Medium — F6: Wheel units are not normalized
- Evidence: `packages/ui/src/browser-host/input-controller.ts:332-355` forwards deltaX/Y unchanged and never reads deltaMode despite the normalization comment.
- Impact: line/page-mode wheel input is treated as pixel deltas, producing browser/device-dependent scrolling. Fix: convert DOM_DELTA_LINE/PAGE to bounded CSS pixel deltas before coalescing; keep one canonical wire representation.

## Security

### High — S1: Ordinary Browser REST/WS bypass secure-origin credential policy
- Evidence: `packages/ui/src/api/browser-host-client.ts:101-121` always adds a stored bearer to fetch, and `715-737` maps HTTP to cleartext WS with ticket subprotocols. In contrast its origin-reset helper checks isSecureOrLoopbackOrigin (`471-485`). `server-config.ts:123-130,285-294` allows HTTP and returns endpoint-bound tokens without TLS enforcement; `connections.ts:498-503` accepts HTTP schemes.
- Impact: if a remote HTTP profile is used from an environment permitting it, bearer, capability tickets, streamed page content and input cross the network unencrypted. This is conditional configuration exposure, not a claim that defaults use HTTP. Fix: reject authenticated Browser REST/WS outside HTTPS/WSS or explicit loopback development using the existing secure-origin helper; do not silently downgrade.

## Hooks for adaptive resolution/quality
- **Existing signals:** validated frame bytes/header at `stream-controller.ts:471-479`; pending replacement/disposition at `530-543`; decode boundaries `561-578`; draw/ACK `601-628`. Add monotonic performance.now timestamps for receipt/decode/draw, byte totals, inter-arrival variation, pending replacements and failures. Keep counters in controller fields, not React state per frame.
- **Existing metric limitation:** FramePresentMetrics (`stream-controller.ts:72-78,622-628`) is optional and not wired by host (`BrowserStreamKeepAliveHost.tsx:1067-1259`). Its Date.now minus server capture timestamp mixes clock skew, transport, decode and draw; ACK follows drawImage submission, not compositor presentation. No rAF paint coalescing or worker/ImageDecoder path exists. Profile before choosing worker/WebCodecs; these are options, not verified bottlenecks.
- **Feedback path:** extend the existing bounded heartbeat (`browser-host-types.ts:265-269`, `stream-controller.ts:300-310`) with aggregated delivery/decode/drop samples, or frameAck (`types:245-252`) with small timing fields. Requires matching server DTO/validation changes and ≤1024-byte control cap; current messages contain no quality policy/telemetry. Reuse subscription/producer/viewport identity; do not overload reason. Retain exact ACK/discard accounting.
- **Network estimate:** received JPEG bytes / elapsed time measures delivered throughput, not available bandwidth on static/content-limited capture. Combine sustained backlog/drop/decode and ACK timing; navigator.connection effectiveType/downlink/rtt/saveData is an optional feature-detected hint, not authority or universal API. Missing now; no network adaptation exists in this client.
- **Scaling already works:** `stream-controller.ts:682-725` aspect-fits JPEG pixels independently of geometry.cssWidth/Height; `input-controller.ts:221-253` maps client→backing→image fractions. Lower pixel resolution with unchanged aspect ratio/CSS geometry preserves pointer mapping; source test covers 640×480 JPEG vs 1280×960 CSS with mixed DPR (`stream-controller.test.ts:387-460`; inspected, not run). Never shrink CSS viewport just to reduce transport pixels or double-apply DPR.
- **Resize policy:** `canvas-view.tsx:50-76` only resizes local backing canvas when dimensions change, not per frame. No production caller of setBrowserViewport exists (API declaration `browser-host-client.ts:284-299`); current ResizeObserver does not restart remote capture. Preserve this separation. DPR-only changes have no dedicated listener.
- **Selector/state fit:** BrowserTools control row (`os/browser/browser-tools.tsx:59-107`) is a minimal Auto/High/Medium/Low surface; address bar already exposes Tools (`browser-address-bar.tsx:112-118`). Browser window/tab runtime lives in Zustand window-store via canonical BrowserWindowState (`BrowserApp.tsx:96-108`, `browser-tab-types.ts:55-95`); no stream-quality field/store exists. Keep ephemeral viewer preference keyed by profile/window/tab, aggregate stats per subscription, fence writes by current generation. Persist only if requested, explicitly extend allowlisted persistence; never persist measurements/tickets.
- **Shared-target contract:** CSS viewport mutations require a control lease (`browser-host-types.ts:136-142`); viewer quality preference should not require page control. Decide aggregation across multiple viewers before exposing selector as per-viewer effective quality when capture is shared.

## Positive observations / coverage notes
- Bounded one-active/one-pending decode; replaced frames send exact frameDiscarded; successful draw sends exact frameAck on originating socket. Cached bitmap closes on replacement/hide/privacy/dispose; no unconditional bitmap leak verified (`stream-controller.ts:530-665,745-889`).
- No per-frame React state update in the current host path; onGeometryChange is a no-op and onPresentFrame is unset (`BrowserStreamKeepAliveHost.tsx:1067-1069`). 2D rendering includes letterbox fill/upscale; bitmaprenderer is not a drop-in replacement for aspect-fit/cached redraw.
- Audio uses 20ms schedule lead, 500ms bounded queue and explicit source/context cleanup (`pcm-player.ts:7-11,50-104,170-183`); sequence gaps flush audio (`stream-controller.ts:438-445`). No adaptive jitter estimation/A-V synchronization exists; audible impact is unmeasured, not an asserted defect. Intermediate PCM Float32 copy could be avoided by filling AudioBuffer channel directly if profiling warrants.
- Owner/generation/subscription checks and synchronous privacy/minimize/inactive-desktop detachment are substantial safeguards. The missing document-visibility gate is distinct from the implemented OS visibility lifecycle.

## Unresolved questions
- Required output-browser versions/decoder fallback support? Need real-browser qualification for pointer capture, high-rate input, throttled networks, foreground recovery and DPR-only transitions.
- Shared producer quality arbitration: lowest-bandwidth viewer, controller preference, or separate renditions? Does changing only JPEG dimensions/quality rotate producerRun without changing CSS viewportEpoch?
- Target metrics/ceilings for decode latency, drops, bandwidth, interactive latency and audio jitter? No profiling/test execution or coverage percentage claimed by this review.
