# Research Report: Host Browser CDP Stream Protocol & `chromiumoxide` 0.9.1 Fit

- **Date / Context:** 2026-11-08 (`Asia/Saigon`), read-only research for `plans/261108-0237-host-browser-cdp-streaming`
- **Terminal Status:** Complete with explicit compatibility gates
- **External Calls Used:** 5 / 5 (2 `web_search`, 3 `read` URL fetches; local artifact/repo reads excluded)
- **Primary Sources Retrieved (2026-11-08):**
  1. Chromium `149.0.7827.55` `content/browser/devtools/protocol/page_handler.cc`: `https://raw.githubusercontent.com/chromium/chromium/149.0.7827.55/content/browser/devtools/protocol/page_handler.cc`
  2. Chromium `149.0.7827.55` `content/browser/devtools/devtools_video_consumer.cc`: `https://raw.githubusercontent.com/chromium/chromium/149.0.7827.55/content/browser/devtools/devtools_video_consumer.cc`
  3. `chromiumoxide` `0.9.1` `src/browser/config.rs`: `https://docs.rs/chromiumoxide/0.9.1/src/chromiumoxide/browser/config.rs.html`
  4. Supplied baseline: `plans/reports/brainstorm-261108-0138-host-browser-cdp-streaming.md` (observed `Chrome/156.0.8078.79`, CDP 1.3)

---

## 1. Chromium `Page.startScreencast` Producer & ACK Semantics

### Source Evidence (Chromium `149.0.7827.55`)
- **In-flight window & off-by-one:** `kMaxScreencastFramesInFlight = 2` (`page_handler.cc:100`), checked via `frames_in_flight_ <= kMaxScreencastFramesInFlight && !(++frame_counter_ % capture_every_nth_frame_)` (`page_handler.cc:1657-1660`). Because of `<=`, `ShouldCaptureNextScreencastFrame()` permits captures at `frames_in_flight_ ∈ {0, 1, 2}`, allowing **3** unacknowledged frames in flight before dropping at `3`.
- **`sessionId` is a start counter, not a frame ID:** `PageHandler::StartScreencast` increments `++session_id_` and resets `frames_in_flight_ = 0` (`page_handler.cc:1519-1521`). Every `Page.screencastFrame` in that run carries the same `session_id_` (`page_handler.cc:1739-1740`).
- **Unclamped ACK decrement:** `PageHandler::ScreencastFrameAck(int session_id)` executes `if (session_id == session_id_) { --frames_in_flight_; }` (`page_handler.cc:1553-1558`) with no lower-bound clamp at `0`. Over-ACKing makes `frames_in_flight_` negative and inflates credit; restarting `StartScreencast` resets `frames_in_flight_ = 0`.
- **Does ACK delay limit capture vs delivery?**
  - **Evidence:** In `DevToolsVideoConsumer::OnFrameCaptured`, the Viz `mojo::PendingRemote<viz::mojom::FrameSinkVideoConsumerFrameCallbacks>` is attached to `media::VideoFrame::AddDestructionObserver` and invoked synchronously via `callback_.Run(std::move(frame))`. `PageHandler::OnFrameFromVideoConsumer` (`page_handler.cc:1662-1710`) either returns early when `ShouldCaptureNextScreencastFrame()` is false or copies pixels via `DevToolsVideoConsumer::GetSkBitmapFromFrame(frame)` and drops `frame` on return—before thread-pool JPEG encode (`ScreencastFrameCaptured`, `:1712-1729`) or CDP emission (`ScreencastFrameEncoded`, `:1731-1741`). `DevToolsVideoConsumer` sets `kDefaultMinCapturePeriod = base::Milliseconds(10)` (`devtools_video_consumer.cc`, `kDefaultMinCapturePeriod`), and `PageHandler` never calls `SetMinCapturePeriod`.
  - **[INFERENCE]:** Because `VideoFrame` destruction immediately releases the Viz buffer callback, withholding `Page.screencastFrameAck` does **not** stop Viz compositor shared-memory readback on damage (up to 100 Hz); it only skips `SkBitmap` CPU copy, thread-pool JPEG encoding, and CDP base64 transfer. Only `Page.stopScreencast` (`video_consumer_->StopCapture()`, `page_handler.cc:1545-1551`) stops the Viz capturer.
- **Refused-frame drop & final-frame loss (`[INFERENCE]`):** `OnFrameFromVideoConsumer` has no internal pending-frame buffer (`page_handler.cc:1668-1670`); refused frames are dropped immediately. `[INFERENCE]:` If all 3 producer credits are held when the final paint of a scroll/animation arrives and Viz `FrameSinkVideoCapturer` does not emit further frames on an idle surface (unverified in fetched files; see Gate 2), viewers remain on a stale frame until a settle refresh occurs.
- **Resize & static-page initial frame:**
  - When `view->GetCompositorViewportPixelSize()` changes (`surface_size != last_surface_size_`), `OnFrameFromVideoConsumer` updates `video_consumer_->SetMinAndMaxFrameSize(snapshot_size, snapshot_size)` and **returns early without emitting that frame** (`page_handler.cc:1684-1692`).
  - `DevToolsVideoConsumer::StartCapture()` returns early if `capturer_` already exists (`if (capturer_) return;`) and exposes no `RequestRefreshFrame()` wrapper. Whether Viz emits an immediate frame on first `capturer_->Start(...)` for an undamaged surface is not proved by these two files (compatibility gate).
- **Experimental parameters & version gap:** In `149.0.7827.55`, `StartScreencast` accepts only `(format, quality, max_width, max_height, every_nth_frame)` (`page_handler.cc:1493-1497`). Brainstorm observed `Chrome/156.0.8078.79` and TOT CDP docs list `maxFramesInFlight` / `sendLastFrame`; `156` C++ source was not fetched, so `156` support for those fields is unverified (compatibility gate).

---

## 2. Viewport Metadata, Coordinate Semantics & Geometry Epochs

### Source Evidence (`page_handler.cc:155-204, 1678-1705`)
- `surface_size` is physical compositor pixels (`view->GetCompositorViewportPixelSize()`).
- `DetermineSnapshotSize(surface_size, max_width, max_height)` scales `surface_size` by `min(1.0, max_width / surface_size.width(), max_height / surface_size.height())` (`page_handler.cc:186-204`).
- `BuildScreencastFrameMetadata` divides `surface_size`, `top_controls_visible_height`, and `root_scroll_offset` by `device_scale_factor` (`page_handler.cc:165-170`):
  - `deviceWidth`, `deviceHeight`: compositor content size in **DIP / CSS pixels** (`surface_size / device_scale_factor`).
  - `offsetTop`: top browser controls height in DIP (`0` in standard desktop headless, nonzero only if top controls exist).
  - `scrollOffsetX`, `scrollOffsetY`: root scroll offset in DIP.
  - `pageScaleFactor`: pinch/page zoom factor; `timestamp`: `base::Time::Now().InSecondsFSinceUnixEpoch()`.

### Recommendation: Geometry Epochs & Input Projection
- **Epoch advancing triggers:** Advance monotonic `viewportEpoch` on: (a) UI-initiated viewport/DPR resize command, AND (b) any incoming frame whose `(metadata.deviceWidth, metadata.deviceHeight, metadata.offsetTop, metadata.pageScaleFactor, imageWidth, imageHeight)` differs from the active epoch (catching agent-driven `Emulation.setDeviceMetricsOverride`, zoom, or navigation).
- **Letterboxed CSS -> Target DIP projection:** Given viewer canvas CSS box `(canvasW, canvasH)` rendering fitted image `(drawX, drawY, drawW, drawH)` of decoded dimensions `(imgW, imgH)`:
  1. Reject pointer events outside `[drawX, drawX + drawW) × [drawY, drawY + drawH)` or with `input.viewportEpoch != activeViewportEpoch`.
  2. Normalized image coords: `u = (clientX - drawX) / drawW`, `v = (clientY - drawY) / drawH`.
  3. Target DIP coords for `Input.dispatchMouseEvent`: `x = u * metadata.deviceWidth`, `y = v * metadata.deviceHeight + metadata.offsetTop`. (Non-unit `pageScaleFactor` interaction with `Input.dispatchMouseEvent` is gated below.)

---

## 3. Rate Governor Choices & Producer/Viewer Credit State Machine

### Rate Governor Options
| Option | Mechanism | Tradeoff / Verdict |
| --- | --- | --- |
| **A. Paced CDP `screencastFrameAck` + Settle Refresh** | Hold 3rd CDP credit until target budget (`100 ms` / 10 FPS) elapses; if credit was held when damage stops, fire a `150 ms` settle refresh (`captureScreenshot` or credit release) | **Lower producer CPU/CDP bytes:** bounds Chromium `SkBitmap` copy + JPEG encode + CDP base64 transfer to ~10 Hz during motion, matching the brainstorm's producer-budget goal, but requires settle-refresh logic if the final frame was dropped while credit-starved. |
| **B. Prompt CDP ACK + Server Mailbox Governor** | ACK CDP immediately after base64 decode into server `LatestFrame` slot; govern viewer fan-out at `<= 10 FPS` (`100 ms`) per viewer credit | **Simpler final-frame capture, higher producer CPU:** preserves final static paint without settle-refresh timers, but lets Chromium JPEG-encode and base64-transfer at compositor cadence (up to 60–100 Hz) during motion unless `everyNthFrame` (`>1`) is set. Qualify CPU/bytes vs Option A in Gate 6. |
| **C. `stopScreencast` on Zero Viewers + `everyNthFrame`** | Issue `Page.stopScreencast` when `active_viewers == 0`; tune `everyNthFrame` (`1..=3`) under sustained motion | **Mandatory complement to A or B:** `stopScreencast` is the only call that halts Viz capture when no visible viewers exist. |

### Concrete Producer & Viewer Credit State Machine (Recommendation)
- **Producer State (per watched target, 1 dedicated CDP screencast session):**
  - `Stopped`: `active_viewers == 0`. `Page.stopScreencast` issued.
  - `Starting(sessionGen)`: first viewer attaches or resize occurs -> issue `Page.startScreencast(format="jpeg", quality=65, maxWidth, maxHeight, everyNthFrame=1)` and arm `250 ms` initial/resize fallback timer. If timer fires with 0 screencast frames for current `viewportEpoch`, run one bounded `Page.captureScreenshot` paired with `Page.getLayoutMetrics` (to populate DIP `deviceWidth`/`deviceHeight` and `pageScaleFactor` for `viewportEpoch`, or mark frame display-only until the first `screencastFrame`).
  - `Streaming(cdpSessionId, inFlightToServer <= 3)`: on `Page.screencastFrame(data, metadata, sessionId)`:
    1. If `sessionId != current_cdp_session_id`, ignore (do not ACK).
    2. Decode base64 once into `Arc<[u8]>`, parse JPEG SOF header `(imgW, imgH)`, bump `viewportEpoch` if `(deviceWidth, deviceHeight, offsetTop, pageScaleFactor, imgW, imgH)` changed, and store in `LatestFrame { seq, viewportEpoch, metadata, jpeg: Arc<[u8]> }`.
    3. Release producer credit via **exactly one** `Page.screencastFrameAck(sessionId)` (never synthesize extra ACKs): either immediately (Option B) or on the `100 ms` producer token bucket with a `150 ms` post-motion settle refresh (Option A).
- **Viewer State (per connected WS viewer, decoupled from producer):**
  - State: `outstanding_seqs: SmallVec<[u64; 2]>` (max 2 in-flight frames), `pending_slot: Option<LatestFrame>` (depth 1, overwrite-oldest), `last_sent_at: Instant`, `min_interval: 100ms` (10 FPS cap).
  - **Send transition:** Eligible when `pending_slot.is_some() && outstanding_seqs.len() < 2 && now - last_sent_at >= min_interval`. Pop `pending_slot`, push `frame.seq` into `outstanding_seqs`, send binary frame over dedicated media WS.
  - **Viewer ACK transition:** Client sends `ViewerFrameAck { seq, viewportEpoch }` **after** `createImageBitmap` + canvas draw. Server removes matching `seq` from `outstanding_seqs` (ignoring unknown/duplicate `seq`s so a client can never over-ACK to inflate credit; epoch mismatch clears stale pre-epoch `seq`s) and triggers send check if `pending_slot.is_some()`.
  - **Pause / Reap:** Window minimize/Cognito/hidden sends `ViewerPause` -> remove from `active_viewers`; if `outstanding_seqs.len() == 2` with no valid ACK for `30s`, mark viewer stalled, drop its subscription, and if `active_viewers == 0`, transition producer to `Stopped`.

---

## 4. `chromiumoxide` `0.9.1` Fit, Limitations & Agent Gateway Expectations

### Source Evidence (`chromiumoxide` `0.9.1` `src/browser/config.rs`)
- **Unsafe defaults to override (`config.rs:137-163, 389-455`):**
  - `headless` defaults to `HeadlessMode::True` (plain `--headless`, whose mapping to old vs new headless on the target engine is unverified); call `.new_headless_mode()` explicitly for `--headless=new` (`:181-184, 441-447`). Both modes append `--hide-scrollbars` and `--mute-audio`.
  - `ignore_https_errors` defaults to `true` (`:151`); MUST call `.respect_https_errors()` (`:196-198`).
  - `user_data_dir: None` falls back to shared `/tmp/chromiumoxide-runner` (`:418-421`); MUST pass explicit per-admin profile directory via `.user_data_dir(...)`.
  - `executable: None` auto-detects system Chrome via `detection::default_executable` (`:357-361`); MUST pre-validate admin binary and pass `.chrome_executable(path)`.
  - `viewport` defaults to `Some(800x600)` emulation (`:154, 223-231`); pass `.viewport(None)` so DamHopper owns viewport sizing.
  - `port` defaults to `0` (`--remote-debugging-port=0`, `:143, 398-400`); verify loopback-only bind on target OS/Chromium (`--remote-debugging-address=127.0.0.1` may be ignored on newer non-old-headless builds, though loopback is default).
  - `DEFAULT_ARGS` (`:460-488`) includes `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`, `--disable-dev-shm-usage`, `--disable-popup-blocking`, `--enable-automation`, and `--password-store=basic` + `--use-mock-keychain` (plaintext basic store in persistent profile dir requires `0700` host filesystem permissions).

### Agent Gateway Compatibility & Session Isolation
- **Per-session `PageHandler` isolation (`[INFERENCE]` from `page_handler.cc:531-533, 559-562, 698-703`):** `PageHandler::ForAgentHost` returns a `std::vector<PageHandler*>` via `host->HandlersByName<PageHandler>(...)`, and each `PageHandler` constructor allocates its own `DevToolsVideoConsumer`. `[INFERENCE]:` Attaching an agent on a separate `DevToolsSession` isolates DamHopper's producer from agent `Page.disable` / `Page.stopScreencast` (verify in Gate 4), whereas agent `Emulation.setDeviceMetricsOverride`, zoom, or navigation still mutates the shared `RenderWidgetHostViewBase` and triggers a `viewportEpoch` transition.
- **Gateway Architecture Recommendation:** Do **not** multiplex external agent JSON-RPC through `chromiumoxide`'s internal `Handler` connection. Have DamHopper's authenticated CDP gateway proxy (`tokio-tungstenite`) open a dedicated loopback CDP session to Chromium per authorized agent connection (filtering `Target.*` discovery/attachment to the admin's owned target(s)).

---

## 5. Unresolved Questions & Explicit Compatibility Gates

1. **Pinned Engine Version (`149` source vs observed `156`):** Verify on target deployment Chromium whether `kMaxScreencastFramesInFlight` remains `2` (`<= 2` -> 3 frames), whether `--headless` vs `--headless=new` behavior differs, and whether optional `maxFramesInFlight` / `sendLastFrame` are supported; omit optional fields by default.
2. **Static First-Frame, Post-Resize & Idle Settle Behavior:** Verify on target headless Chromium whether Viz `FrameSinkVideoCapturer` emits an initial frame on `Start`, emits after post-resize `SetMinAndMaxFrameSize`, or drops the final frame permanently when credit-starved on transition to static (determining necessity of the `250 ms` `captureScreenshot` + `getLayoutMetrics` fallback).
3. **`chromiumoxide` `0.9.1` Internal `Handler`, Port Discovery & Schema (`handler/mod.rs`, `page.rs` not fetched under 5-call cap):** Verify during crate qualification: (a) how `Browser::launch` parses the ephemeral `port: 0` WS URL, (b) `Handler` internal event channel capacity under bursty `EventScreencastFrame` traffic, (c) `chromiumoxide_cdp` `0.9.1` generated struct fields for `StartScreencastParams` / `EventScreencastFrame`, and (d) child-process tree cleanup across Linux systemd and Windows.
4. **Multi-Session Isolation & Agent Discovery Contract:** Verify empirically that an agent session calling `Page.disable` / `Page.stopScreencast` does not interrupt the producer session on the same target, and whether target agent clients (`Playwright.connectOverCDP` vs direct page WS) require `/json/version` + filtered browser-level WS proxy.
5. **Pinch Zoom (`pageScaleFactor != 1.0`) Input Mapping:** Verify whether `Input.dispatchMouseEvent` expects layout viewport or visual viewport DIP coordinates when `pageScaleFactor != 1.0`.
6. **Rate Governor CPU/Bytes Benchmark (Option A vs Option B):** Measure host Chromium CPU%, server RSS, and CDP loopback bytes/s during 60 Hz page animation under Option A (ACK-paced at 10 Hz + settle refresh) vs Option B (prompt ACK + `everyNthFrame`).
