# Code Review: Phase 02 — Hot-Path and Client Performance

## Summary
- Date: 2026-11-12
- Review Target: Phase 02 of Browser adaptive stream quality and performance
- Score: 9.3/10
- Status: Approved with non-blocking warnings

## Scope of Review
Reviewed 28 files across Server and UI:
### Server
- `server/src/browser_host/protocol.rs`
- `server/src/browser_host/diagnostics.rs`
- `server/src/browser_host/media.rs`
- `server/src/browser_host/media_writer.rs`
- `server/src/browser_host/screencast.rs`
- `server/src/browser_host/session.rs`
- `server/src/api/browser_host.rs`
- `server/tests/browser_host_media.rs`
- `server/tests/browser_host_input.rs`
- `server/tests/browser_host_bounds.rs`
- `server/tests/browser_host_screencast.rs`

### UI & Client
- `packages/ui/src/browser-host/frame-protocol.ts`
- `packages/ui/src/browser-host/stream-controller.ts`
- `packages/ui/src/browser-host/visibility-demand.ts`
- `packages/ui/src/browser-host/selection-controller.ts`
- `packages/ui/src/browser-host/canvas-view.tsx`
- `packages/ui/src/browser-host/input-controller.ts`
- `packages/ui/src/api/browser-host-client.ts`
- `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx`
- `packages/ui/src/os/apps/BrowserApp.tsx`
- `packages/ui/src/browser-host/frame-protocol.test.ts`
- `packages/ui/src/browser-host/stream-controller.test.ts`
- `packages/ui/src/browser-host/visibility-demand.test.ts`
- `packages/ui/src/browser-host/selection-controller.test.tsx`
- `packages/ui/src/api/browser-host-client.test.ts`
- `packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx`
- `packages/ui/browser-tests/host-browser-decoder.browser.tsx`
- `packages/ui/browser-tests/host-browser-lifecycle.browser.tsx`

---

## Architectural & Design Assessment

### 1. reuse-validated-frames
- **Server**: `pack_validated_bhjf_frame` checks SOF dimensions and header constraints once, returning `ValidatedBhjfFrame`. `TrackedBhjfFrame` carries immutable `Arc<TargetFrameHeader>`. Viewer credit admission and pending flushes reuse `frame.header()` directly without unpack/re-parse.
- **Client**: `handleIncomingMediaMessage` unpacks BHJF once, stores `jpegPayload` and `header` in `pending`. Decode consumes `jpegPayload` subarray directly without second unpack.

### 2. make-client-rendering-truthful
- Missing `createImageBitmap` triggers `"unsupported"` status, clears `lastDrawnRect`/`lastFrameHeader`, sends exact socket `frameDiscarded` (`decodeFailed`), never ACKs.
- Thrown errors during decode or canvas draw set `"error"` status, clear hit geometry, send `frameDiscarded` (`decodeFailed`).
- `frameAck` and trusted hit rects emit only when `drawBitmapToCanvas` succeeds.

### 3. decouple-media-writes
- `spawn_media_writer` extracts an independent bounded writer task communicating via bounded slots (`WriterSlots`: 1 frame in-flight/slot, 1 audio chunk, 1 control msg).
- Decouples blocking WebSocket writes from the reader/control processing loop. ACKs, discards, heartbeats, and auth cancellation deadlines proceed during slow writes.
- Video governor ticker sets `MissedTickBehavior::Skip`, preventing stale burst cascades.
- Audio drops stale chunks and filters by admissibility doc epoch.

### 4. bound-viewport-and-runtime-caps
- `begin_viewport_transaction` detects sanitized no-ops against existing `TargetGeometry` before touching native CDP or incrementing epochs.
- Resize coalescing queues 1 active leader + 1 latest pending follower with 100ms dispatch spacing. Superseded HTTP callers await authoritative completion.
- Effective configured `max_viewers` enforced at `ViewerPermit::try_acquire_with_cap`.
- Encoded screencast bounds respect configured `max_width`/`max_height` clamped independently of CSS viewport.

### 5. bound-client-background-work
- `isDocumentVisible()` / `subscribeDocumentVisibility()` gates demand synchronously. Window blur is correctly ignored as demand loss.
- Background document immediately suspends media/audio/input/selection polling. Foreground reconnect reconciles to exact target.
- `useHostBrowserSelection` runs single-flight polling with `AbortController` cancellation on navigation/hiding/unmount, scheduling next poll only after settlement.
- Parked/inactive tab backing canvases shrink to 1x1, restoring geometry and redrawing on reveal.

### 6. pace-client-input
- Coalescable pointer/wheel events throttled with minimum interval timer (16ms / ~62.5 Hz ceiling), preserving discrete event headroom under server's 100 msg/s ceiling.
- Discrete barriers flush pending coalescable events beforehand to preserve order.

### 7. secure-browser-transport
- `assertValidConnection` and `requestBrowserHostJson` enforce `isSecureOrLoopbackOrigin`. Remote HTTP/WS transport fails visibly before tickets or sockets are minted.

---

## Critical Issues
None.

---

## Warnings

1. **Test Concurrency Flake in `browser_host_media`**:
   `test_viewer_permit_respects_configured_max_viewers` tests against the process-global atomic `ACTIVE_VIEWERS`. Because `cargo test` executes integration tests concurrently within the same binary by default, parallel tests holding viewer permits cause this test to fail with HTTP 429. It passes cleanly under `--test-threads=1`.
2. **Input Sequence Allocation Timing**:
   In `packages/ui/src/browser-host/input-controller.ts`, `seq = ++this.inputSeq` is allocated when enqueuing coalescable events rather than deferring until the live send in `flushCoalescable()`. If coalescable events are discarded on lease drop, sequence gaps could occur.

---

## Suggestions

1. Add synchronization (e.g. `SERIAL_TEST_LOCK` pattern used in `browser_host_input.rs`) around `test_viewer_permit_respects_configured_max_viewers` to guarantee thread-safe isolation.
2. In `input-controller.ts`, allocate `inputSeq` immediately prior to `socket.send` within `flushCoalescable()`.
3. In `ViewerCreditController`, avoid `h.clone()` by borrowing or cloning only necessary fields (`producer_run`, epochs).

---

## Validation Results

| Test Suite / Command | Result | Notes |
|---|---|---|
| `cd server && cargo test --test browser_host_media -- --test-threads=1` | PASS (15 passed) | Decoupled writer, permit caps, validated frame reuse verified |
| `cd server && cargo test --test browser_host_bounds --test browser_host_input --test browser_host_screencast` | PASS (18 passed) | Viewport coalescing, governor ticks, bounds checks verified |
| `cd server && cargo check --tests` | PASS | Zero compiler warnings in browser_host |
| `pnpm --filter @dam-hopper/ui test src/browser-host src/api/browser-host-client.test.ts src/os/BrowserStreamKeepAliveHost.test.tsx` | PASS (8 files, 121 passed) | Frame protocol, stream controller, visibility demand, selection controller |
| `pnpm --filter @dam-hopper/ui build` | PASS | `tsc -p tsconfig.json` compiles with 0 errors |

---

## Unresolved Questions
None.
