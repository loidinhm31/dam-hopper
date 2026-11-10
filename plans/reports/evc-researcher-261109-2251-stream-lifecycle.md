# Research Report: Stream Lifecycle, ACK Backpressure, `ImageBitmap` Lifetime & Input/Geometry Fencing

- **Date:** 2026-11-09 (`Asia/Saigon`) | **Target:** `plans/261108-0237-host-browser-cdp-streaming/plan.md` (Phases 01–09 review)
- **External Calls / Sources:** 2 / 3 external fetches (`read` URL), 2 / 3 primary sources used (preserves project <=5 source cap)
- **Primary Sources:**
  1. Chromium `149.0.7827.55` `content/browser/devtools/protocol/page_handler.cc` — [https://raw.githubusercontent.com/chromium/chromium/149.0.7827.55/content/browser/devtools/protocol/page_handler.cc](https://raw.githubusercontent.com/chromium/chromium/149.0.7827.55/content/browser/devtools/protocol/page_handler.cc)
  2. MDN Web Docs `ImageBitmap.close()` — [https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap/close](https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap/close)

---

## 1. Authoritative Mechanics vs Repository Contracts

### A. `Page.screencastFrame` ACK & Backpressure
- **Authoritative Source Fact (`page_handler.cc:100, 539-568, 704-709, 1499-1564, 1663-1747`):**
  - `kMaxScreencastFramesInFlight = 2` (`:100`), gated by `frames_in_flight_ <= kMaxScreencastFramesInFlight && !(++frame_counter_ % capture_every_nth_frame_)` (`:1663-1666`). `<=` permits **3** unacknowledged frames in flight (`0, 1, 2`) before dropping at `3`.
  - `StartScreencast` increments `++session_id_` and resets `frames_in_flight_ = 0` (`:1525-1527`). Every emitted `ScreencastFrame` in that run carries run counter `session_id_`, not a per-frame ID (`:1745-1746`).
  - `ScreencastFrameAck(int session_id)` runs `if (session_id == session_id_) { --frames_in_flight_; }` (`:1559-1564`) with **no clamp at 0**. Duplicate/replayed ACKs underflow `frames_in_flight_` negative and inflate producer credit window.
  - On surface resize (`surface_size != last_surface_size_`), `OnFrameFromVideoConsumer` calls `SetMinAndMaxFrameSize` and returns early without emitting that frame (`:1690-1698`).
  - Each `DevToolsSession` constructs its own `PageHandler` and `DevToolsVideoConsumer` (`:539-541, 565-568`); `PageHandler::Disable()` calls `StopScreencast()` only on its own instance (`:704-709`).
- **Repository Contract Fact (`architecture-contracts.md` §§2, 6, 7; `phase-05-producer-fanout.md`):**
  - Dedicated flattened Page session per watched target/run; prompt exactly-once `Page.screencastFrameAck(nativeSessionId)` enqueued per accepted current-run event after bounded candidate admission or explicit drop.
  - Mismatched/old-run `sessionId` drops without ACK; malformed `Page.screencastFrame` or failed ACK reservation/write aborts run/actor (`MalformedResponse`) rather than retrying an ambiguous ACK.
  - `Page.stopScreencast` required at zero visible viewers (explicit `pause` or `15s` heartbeat expiry; `5s` heartbeat cadence).
- **Unverified / `[INFERENCE]`:**
  - `[INFERENCE]` Withholding `screencastFrameAck` skips `SkBitmap` copy + thread-pool JPEG encode (`:1714-1735`) but does not stop Viz damage readback; only `StopScreencast()` halts capture (`:1551-1556`).
  - Deployment Chromium binary parity with `149.0.7827.55` (`Chrome/156.0.8078.79` observed in brainstorm) and static initial/final-settled frame behavior under `everyNthFrame=2` remain runtime qualification gates (`plan.md:44,52`).

### B. Browser Canvas `ImageBitmap` Decode Lifetime
- **Authoritative Source Fact (MDN `ImageBitmap/close`):**
  - `ImageBitmap.close()` explicitly disposes graphical/GPU backing resources (`width`/`height` become `0`). Relying on GC alone under 10 FPS streaming causes transient GPU/RAM retention spikes.
- **Repository Contract Fact (`architecture-contracts.md` §7; `phase-06-viewer-client.md`):**
  - Viewer maintains `<= 1` active `createImageBitmap` decode and `<= 1` replaceable compressed pending buffer; replacing pending emits `frameDiscarded(replaced)` for its exact outstanding key.
  - Active decode cannot be cancelled mid-flight; completion must recheck captured `{profileId,generation}`, originating media socket `subscriptionEpoch`, `viewportEpoch`, and privacy/visibility synchronously before canvas draw, always calling `bitmap.close()` in `finally` across draw, discard, error, privacy, and unmount paths.
  - `frameAck` is sent only after draw on the captured originating media socket; if that socket closed, send nothing (server socket teardown reclaims its credits).

### C. Input, Navigation & Geometry Fencing
- **Authoritative Source Fact (`page_handler.cc:155-204, 570-593, 1684-1715`):**
  - `BuildScreencastFrameMetadata` divides physical compositor `surface_size`, `top_controls_visible_height`, and `root_scroll_offset` by `device_scale_factor` (`:165-170`), emitting DIP `deviceWidth`/`deviceHeight`, `offsetTop`, `scrollOffsetX`/`Y`, and `pageScaleFactor`.
  - Cross-process navigation swaps `RenderFrameHostImpl` in `PageHandler::SetRenderer` (`:570-593`), rebinding `FrameSinkId`.
- **Repository Contract Fact (`architecture-contracts.md` §§6, 8; `phase-03`, `phase-06`, `phase-07`):**
  - Target geometry changes advance `viewportEpoch` **before** publishing new-epoch frames or accepting input.
  - Letterbox aspect-fit fractions `u=(clientX-drawX)/drawWidth`, `v=(clientY-drawY)/drawHeight` reject out-of-image clicks and map to `x = u * cssWidth`, `y = v * cssHeight + offsetTop` (`cssWidth <= 1920`, `cssHeight <= 1080`); `scrollX`/`scrollY` and `dpr` are never added/multiplied again.
  - `navigationRevision` is tracked separately from `viewportEpoch` and invalidates selection/DOM handles even when viewport dimensions are unchanged.
  - Control input requires holder `leaseToken`, current `viewportEpoch`, and contiguous decimal `inputSeq`; adjacent `pointerMove`/`wheel` coalesce only between key/button/text/resize/lease barriers; queue overflow (`>128` records or `>256 KiB`), gap, blur, modal, privacy, or disconnect releases original target keys/buttons and revokes lease.

---

## 2. Concrete Implementation Review Checklist (Phases 01–09)

### Check Group 1: Bounded Memory & Zero-Copy Fanout
- [ ] **BM-1 (Ingress & Base64 Bounds):** CDP WS enforces `<= 4 MiB` frame/message cap before serde allocation; `screencastFrame` base64 validated `<= 2,796,204 B` (`<= 2 MiB` decoded JPEG) before decoding (`architecture-contracts.md` §3).
- [ ] **BM-2 (Single Encoded Candidate):** Producer retains at most 1 replaceable base64 candidate per target; decodes base64 once only when selected at governor boundary; verifies JPEG SOF dimensions (`1..=1920 x 1..=1080`, pixels `<= 2,073,600`).
- [ ] **BM-3 (Shared BHJF `Bytes` & Last-Clone Accounting):** Prefix (`16 B` `BHJF` v1) + target-only JSON header (`<= 1024 B`) + JPEG (`<= 2,097,152 B`) serialized once into one immutable `Bytes` (`<= 2,098,192 B`); cloned per viewer without JPEG copy. Unique complete buffer stays charged against the `128 MiB` global ceiling until the **last** cache, pending, outstanding, or stalled-writer clone drops—even after subscription close (`plan.md:44` Phase 05 carryover).
- [ ] **BM-4 (Actor Command RAII):** Internal CDP actor enforces 32-message writer channel, `<= 64` queued+in-flight commands, and `2 MiB` RAII logical serialized command budget (`<= 64 KiB`/command) with `5s` write deadline.

### Check Group 2: Independent Viewer Credits & Socket Binding
- [ ] **VC-1 (No Per-Viewer Header Fields):** Binary `BHJF` header omits `viewerId`, `subscriptionEpoch`, ticket, or login; subscription authority is fixed immutably on the admitted media socket at WS upgrade (`architecture-contracts.md` §§5–7).
- [ ] **VC-2 (Per-Viewer `2` Outstanding + `1` Pending):** Fanout tracks `(capturedSocketSubscription, producerRun, viewportEpoch, frameSeq)` with `<= 2` outstanding (reserved before WS send), `<= 1` overwrite-oldest pending slot, `>= 100ms` delivery spacing (`10 FPS`), `5s` send deadline, and `30s` ACK timeout reap.
- [ ] **VC-3 (Cross-Socket Credit Isolation):** Server verifies `frameAck`/`frameDiscarded` `subscriptionEpoch` equals the receiving media socket's admitted subscription before removing only that exact outstanding key; duplicate/future/foreign/stale ACKs never add credit or clear a replacement socket's credits.
- [ ] **VC-4 (Fresh Pair on Resume/Rebind):** `pause` detaches demand/credits immediately; resume/rebind requires a fresh one-use ticket, new `subscriptionEpoch` UUID, new media socket, and newly paired control socket—never retagging an existing socket (`plan.md:46` Phase 06 W8).

### Check Group 3: Stale Decode, Navigation & Input Fencing
- [ ] **DF-1 (`1` Active Decode + `1` Pending + `finally` `close()`):** Client `stream-controller.ts` enforces `<= 1` active `createImageBitmap` and `<= 1` pending `ArrayBuffer`; calls `bitmap.close()` in `finally` on every path; emits `frameDiscarded` with captured originating subscription when replacing pending or aborting post-decode (`plan.md:46` Phase 06 W4).
- [ ] **DF-2 (Synchronous Pre-Draw & Privacy Fence):** Immediately before `ctx.drawImage`, controller synchronously rechecks `{profileId,generation}`, captured socket `subscriptionEpoch`, `viewportEpoch`, and privacy/visibility. Cognito/PIN lock synchronously clears/blacks canvas and invalidates decode token before async pause (`plan.md:46,48` Phase 06 C1, Phase 07 W3).
- [ ] **IF-1 (Epoch, `inputTrusted` & Coordinate Projection):** Input rejected when `inputTrusted: false`, geometry out of range, pointer outside aspect-fit box, or `input.viewportEpoch != activeViewportEpoch`. Decimal `u64` counters (`viewportEpoch`, `navigationRevision`, `frameSeq`, `inputSeq`) validated as canonical strings `[1-9][0-9]{0,19}` via `BigInt`/`u64`, never `Number` (`plan.md:46,48` Phase 06 W1–W2, Phase 07 W1).
- [ ] **IF-2 (Navigation Revision & Original-Target Release):** `navigationRevision` increments on navigation and invalidates selection/DOM handles (`plan.md:48` Phase 07 W1). Coalescing applies only to adjacent `pointerMove`/`wheel` within barriers; overflow, gap, blur, modal, lease expiry, or disconnect flushes/releases held keys/buttons on the **original captured target** before teardown (`plan.md:46,48` Phase 06 C3, W3, Phase 07 W4–W5).

### Check Group 4: Producer ACK Safety & Zero-Demand Lifecycle
- [ ] **AS-1 (Prompt 1:1 Current-Run ACK):** Producer learns `nativeSessionId` from first event of active `producerRun`; enqueues at most one `Page.screencastFrameAck(nativeSessionId)` per accepted current-run event (including overwritten candidates) independent of viewer ACKs; drops old-run events without ACK.
- [ ] **AS-2 (No Ambiguous ACK Retry):** On ACK reservation/write error or malformed frame envelope, producer aborts run and opens a fresh flattened CDP Page session rather than replaying an ACK that could underflow Chromium's unclamped `frames_in_flight_`.
- [ ] **AS-3 (Zero-Demand Stop & Single Recovery Screenshot):** `Page.stopScreencast` executes within `<= 2s` of explicit pause or `<= 15s` of missing viewer heartbeat while raw CDP agents remain live. At attach/resize/restart, at most **one** `captureScreenshot` (bracketed by `getLayoutMetrics` + epoch recheck) runs after `250ms` without a native frame; zero periodic screenshots on static pages.

---

## 3. Unresolved Questions & Review Blockers
1. **Unresolved Phase 05–09 Carryovers in `plan.md`:** `plan.md:44-52` explicitly records unresolved technical carryovers behind `DONE` labels: unified `128 MiB` memory ceiling across raw relays/transient buffers (Phase 05), `C1`/`C3`/`W1–W8` owner/cache boundaries, release ordering, `inputTrusted` gating, `u64` string/number wire mismatch, IME single-commit, and decode/draw error discard (Phases 06–07), plus Phase 09 `W2` same-target frozen-stream/epoch fencing. Code review must verify whether `HEAD cdfa9c6b` actually resolved these in code or left them open.
2. **Engine Version & Zoom Qualification:** `architecture-contracts.md` §§1, 8 mark native browser zoom (`< 100%`, `inputTrusted: false`) and `everyNthFrame=2` final-settled-frame capture as unqualified without runtime engine proof on the target Chromium binary.
