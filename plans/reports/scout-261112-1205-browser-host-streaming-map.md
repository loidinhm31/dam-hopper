# Browser Host Streaming Architecture & Network Adaptation Map

## Prior Plans & Architectural References
- Plans: `261108-0237-host-browser-cdp-streaming`, `261109-2251-host-browser-review-remediation`, `261111-0024-browser-cloudflare-google-login`, `261111-0220-browser-video-audio-streaming`, `261111-0943-browser-native-tabs-session-ux`.
- Docs: `docs/architecture/host-browser-cdp-streaming.md`, `docs/architecture/agent-store-ports-and-browser.md`, `docs/api/browser-host.md`, `docs/configuration/server-runtime-settings.md`.

## 1. Frame Pipeline (CDP -> UI Canvas)
- **CDP Ingress**: `Page.screencastFrame` received in `cdp.rs:1039,1380-1428`. Validates numeric metadata (`cdp.rs:28,1406-1416`), extracts base64 data, broadcasts `Arc<ScreencastFrameData>` via `tokio::sync::broadcast::channel(2)` (`cdp.rs:485,1426`). Drop policy: lagged receivers dropped (`screencast.rs:1168`).
- **Producer Ingestion & ACK**: `screencast.rs:1645-1757` (`handle_incoming_frame`). Enforces `MAX_BASE64_BYTES` (2,796,203 B, `screencast.rs:1674`). Enqueues CDP frame ACK immediately (`cdp_client.ack_screencast_frame`, `screencast.rs:1704-1707`). Clones base64 string (`screencast.rs:1735`) into `EncodedCandidate`. Drop policy: atomically supersedes unconsumed candidate (`screencast.rs:1744-1752`, `events_dropped_overwritten`).
- **Governor & Publication**: `screencast.rs:1787-1901` (`publish_governed_candidate`, ticked every `governor_interval`, `screencast.rs:1110,1176`). Pre-reserves memory ceiling in `MemoryAdmissionController` (`screencast.rs:1804`). Decodes base64 once to `Vec<u8>` (`screencast.rs:1813`). Verifies JPEG SOF marker (`parse_jpeg_dimensions`, `screencast.rs:1833`). Packs BHJF binary frame (`pack_bhjf_frame`, `protocol.rs:310-370`) with JSON `TargetFrameHeader` (`protocol.rs:202-214`). Broadcasts `TrackedBhjfFrame` via `broadcast::channel(2)` (`screencast.rs:579,1894`) and caches in `cached_frame` (`screencast.rs:1886`).
- **Per-Viewer Transport**: `media.rs:1118-1203`. `ViewerCreditController` (`media.rs:740-840`) manages `outstanding` (cap `MAX_OUTSTANDING_PER_VIEWER = 2`, `media.rs:49`) and `pending_frame` (cap `MAX_PENDING_PER_VIEWER = 1`, `media.rs:50`) with rate limiter `min_delivery_interval = 1/fps` (`media.rs:1077`). Transmits raw binary over media WS (`media.rs:1198`).
- **UI Client Decode & Paint**: `stream-controller.ts:471-667`. Unpacks BHJF header (`stream-controller.ts:478`). 1-active-decode + 1-pending queue: discards superseded pending frame with `frameDiscarded` (`reason: "replaced"`, `stream-controller.ts:534-541`). Decodes via `createImageBitmap(new Blob([jpegPayload]))` (`stream-controller.ts:564-569`). Paints on canvas with letterboxing/pillarboxing (`drawBitmapToCanvas`, `stream-controller.ts:672-726`). Sends `frameAck` after paint (`stream-controller.ts:614-620`).

## 2. Quality, FPS, and Resolution Knobs
- **Capture Policy Knobs**: `with_capture_policy(fps, jpeg_quality)` (`screencast.rs:637-642`) called only in `media.rs:510` and unit tests (`screencast.rs:2575`). Configured via TOML `[server.browser.budgets]` (`config.rs:66-91; parser.rs:626-630`): `frame_rate_fps` (1..=30, default 24), `jpeg_quality` (10..=100, default 75). No session create params or REST knobs exist to adjust fps/quality dynamically.
- **Resolution Ceilings**: `MAX_IMAGE_WIDTH = 1920`, `MAX_IMAGE_HEIGHT = 1080`, `MAX_PIXELS = 2_073_600` (`protocol.rs:22-24`). Clamped in `session.rs:36-39`.
- **Frame Stride**: `every_nth_frame(1)` hardcoded in `screencast.rs:735,1027`.
- **Viewport & Geometry Path**: PUT `/api/browser/sessions/{id}/viewport` (`api/browser_host.rs:846-882`) invokes `update_geometry` (`screencast.rs:695-744`). Increments `viewport_epoch`, invokes CDP `Emulation.setDeviceMetricsOverride` (`screencast.rs:713-726`), and if streaming + dimensions changed, re-issues `Page.startScreencast` with updated `max_width`/`max_height` clamped to 1920x1080 (`screencast.rs:728-741`).
- **Device Scale Factor**: Clamped to `[1.0, 3.0]` (`session.rs:40-41,129`). Passed to CDP `deviceScaleFactor` (`screencast.rs:716,783`). UI canvas scales physical pixels via `Math.min(Math.max(window.devicePixelRatio || 1, 1), 3)` (`canvas-view.tsx:52`). Note: `extract_geometry_from_metadata` hardcodes `dpr: 1.0` (`screencast.rs:1777`).

## 3. Feedback Signals & Telemetry
- **Server Feedback Signals**:
  - `ViewerCreditController.outstanding`: `HashMap<OutstandingKey, (TrackedBhjfFrame, Instant)>` (`media.rs:742,804`) tracks `sent_at` timestamp. Used only for 30s timeout eviction (`media.rs:889-894`), but `now - sent_at` is exact per-viewer RTT.
  - Delivery counters: `total_delivered`, `total_acked`, `total_discarded` (`media.rs:746-748`).
  - Stream diagnostics atomics: `StreamDiagnostics` (`diagnostics.rs:288-326`) and `ScreencastLedger` (`screencast.rs:73-87`) track delivered frames, acks, discards, dropped candidate events, decoded bytes.
- **Timestamps**: `TargetFrameHeader.capture_time_unix_ms` (`protocol.rs:211; screencast.rs:1736`). Client tracks glass-to-glass latency (`presentTimeUnixMs - captureTimeUnixMs`, `stream-controller.ts:627`).
- **Media WS Messages**:
  - Server -> Client: Binary BHJF frame (`media.rs:1198`), Text JSON `ViewerAudioEnvelope` (`media.rs:1235; protocol.rs:341`).
  - Client -> Server: Text JSON `MediaClientControl` (`media.rs:1286; protocol.rs:432`): `frameAck`, `frameDiscarded` (reasons: `ownerChanged|obsolete|replaced|decodeFailed|hidden`), `heartbeat` (`visible: bool`), `pause`.
- **Control WS Messages**:
  - Server -> Client: Text JSON `ServerControlEvent::SessionUpdated { session: BrowserSessionDto }` (`media.rs:1592; protocol.rs:644`).
  - Client -> Server: Text JSON `InputMessage` (`media.rs:1639; input.rs:107`): `PointerDown`, `PointerUp`, `PointerMove`, `PointerCancel`, `Wheel`, `KeyDown`, `KeyUp`, `InsertText`.
- **Client Telemetry Gap**: UI computes presentation timing (`stream-controller.ts:622`), but sends zero telemetry/stats back to server.

## 4. Coordinate Mapping & Stream Scaling
- **Coordinate Flow**:
  1. `input-controller.ts:221-254` (`mapClientToFractions`) maps canvas pointer coordinates to normalized fractions $u, v \in [0.0, 1.0]$ using letterboxed draw bounds (`drawn.drawX`, `drawn.drawY`, `drawn.drawWidth`, `drawn.drawHeight`).
  2. `input.rs:176-196` (`map_fraction_to_css_coords`) calculates CSS coordinates: $x = u \times \text{css\_width}$, $y = v \times \text{css\_height} + \text{offset\_top}$.
  3. `canvas-view.tsx:50-67` and `stream-controller.ts:672-702` aspect-fit frame image into canvas.
- **Impact of Downscaling Stream Resolution**:
  - **Aspect ratio preserved**: $(u, v)$ fractions and CSS $(x, y)$ coordinate mapping remain completely intact and mathematically exact.
  - **Aspect ratio altered**: Causes letterbox mismatch; $(u, v)$ coordinates will skew unless downscaled resolution strictly matches `css_width / css_height`.
  - **Chromium Metadata Trap**: `extract_geometry_from_metadata` (`screencast.rs:1763-1764`) reads `deviceWidth` and `deviceHeight` from screencast frame metadata into `TargetGeometry.css_width/css_height`. If CDP returns scaled pixel dimensions rather than viewport CSS dimensions, input coordinates on server will scale incorrectly.

## 5. Multi-Viewer Semantics
- **Shared Producer**: Exactly 1 `ScreencastProducer` per session (`media.rs:212-250`), shared across all viewers.
- **Shared Zero-Copy Frames**: All viewers receive clones of `TrackedBhjfFrame` referencing the same underlying `Bytes` and `MemoryReservation` (`diagnostics.rs:122,157-172`).
- **Slow Viewer Isolation**: Broadcast `Lagged` error drops frames for lagging viewers without blocking producer or other viewers (`media.rs:1252`).
- **Demand Lifecycle & Heartbeats**: Viewers register demand via `register_viewer_demand` (`screencast.rs:884`). Heartbeat sent every 5s (`stream-controller.ts:10; media.rs:1330`). `check_viewer_expiry` runs every 1s (`screencast.rs:1156`), evicting viewers silent for >15s (`VISIBLE_DEMAND_EXPIRY`, `screencast.rs:43,947`). When `visible_count == 0`, screencast stops (`stop_screencast_due_to_zero_demand`, `screencast.rs:938,956`).
- **Adaptation Challenge**: Downscaling producer resolution affects ALL viewers sharing the session. Quality adaptation must either target controlling lease-holder (`input.rs:271`), minimum capability across active viewers, or transcode/resample per-viewer.

## 6. UI Settings & Quality Selector Surface
- **Toolbar Surface**: `BrowserAddressBar` action group (`packages/ui/src/os/browser/browser-address-bar.tsx:89-119`) contains status badge, audio toggle, and tools button (`browser-tools-toggle-btn`).
- **Tools Popover Panel**: `BrowserTools` (`packages/ui/src/os/browser/browser-tools.tsx:50-135`) already provides Control/Release, Select Element, and diagnostics. A quality selector (`Auto / High / Medium / Low`) fits naturally inside `BrowserTools` or beside `browser-audio-toggle-btn`.
- **Global Settings Store**: `useSettingsStore` (`packages/ui/src/stores/settings.ts:87-127`) manages persisted UI settings; currently lacks any browser-specific preferences. Default streaming quality could be persisted here and surfaced in `SettingsPage.tsx`.

## 7. Performance Smells & Bottlenecks
1. **Unnecessary base64 clone**: `screencast.rs:1735` clones entire `frame_data.data_base64` String (up to 2.7 MiB) into `EncodedCandidate` instead of sharing `Arc<str>` or `Arc<ScreencastFrameData>`.
2. **Lock held across network awaits**: `screencast.rs:699-743` holds `self.geometry.write().await` across CDP calls (`cdp_client.send_command` at line 720, `cdp_client.send_typed` at line 738), blocking frame publishing and input mapping during network round-trips.
3. **Redundant JPEG SOF parsing**: `parse_jpeg_dimensions` is called in `screencast.rs:1833` and then called again inside `pack_bhjf_frame` (`protocol.rs:321`) on identical bytes.
4. **Duplicate server BHJF header unpacking**: `media.rs:789` and `media.rs:824` deserialize and validate the JSON header (allocating 6 Strings) on every frame in `ViewerCreditController`, duplicating work done during packing.
5. **Duplicate client BHJF unpack**: `stream-controller.ts:478` unpacks and validates BHJF frame upon receipt, and then calls `unpackBhjfFrame` a second time in `decodeAndDrawFrame` (`stream-controller.ts:563`).
6. **Five async mutexes per input event**: `input.rs:418,430,441,458,460` acquires 5 separate async mutexes sequentially for each pointer/key message.
7. **Per-frame Blob allocation**: `stream-controller.ts:564-566` allocates `new Blob([jpegPayload])` on every decoded frame for `createImageBitmap`.

## Unresolved questions
1. Should adaptive stream resolution follow the active controller's connection, or the minimum bandwidth across all connected viewers?
2. Does dynamic re-issuance of `Page.startScreencast` with changed `maxWidth`/`maxHeight` cause visible page reflow, iframe reloads, or tearing in Chromium?
3. In `screencast.rs:1763`, what exact values does Chromium populate in `Page.screencastFrame` metadata `deviceWidth`/`deviceHeight` when downscaling occurs?
4. Is network quality best estimated server-side via `ViewerCreditController` ACK latency (`Instant::now() - sent_at`), or client-side via decoded frame rates and sent via media control messages?
5. Would downscaled resolution require dynamic text contrast / sharpen post-filters on the HTML5 canvas to maintain readability of small editor/code text?
