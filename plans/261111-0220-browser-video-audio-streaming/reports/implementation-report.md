# Implementation Report - Phase 01 & Phase 02: Browser Video & Audio Streaming (Cycle 13)

## Phase 01: Backend Video & Audio Streaming (`backend-browser-video-audio-streaming`)

### Modified Files & Remediations
- `server/src/browser_host/config.rs` & `server/src/config/tests.rs`
  - Updated configured production `DEFAULT_MAX_FPS` from `10` to `24` (with `DEFAULT_JPEG_QUALITY = 75`) while preserving legacy `100ms` / `JPEG 65` constructor defaults on `ScreencastProducer::new` and `ViewerCreditController::new`.
- `server/src/browser_host/process.rs`
  - Added `--autoplay-policy=no-user-gesture-required` to `ALLOWED_CHROMIUM_ARGS` and `build_chromium_args` while keeping all security and sandbox invariants intact.
- `server/src/browser_host/stealth.rs`
  - Replaced stacked permissions wrapper with a unified non-stacked `navigator.permissions.query` hook using `PERMISSION_DEFAULTS`, notification bridging, and native fallback.
  - Added privacy-fenced `navigator.mediaDevices.enumerateDevices` wrapper that blanks `label`, `deviceId`, and `groupId` while preserving device count/kind.
  - Added `HTMLMediaElement.prototype.canPlayType` and `MediaSource.isTypeSupported` normalization for H.264/MP4, WebM/VP8/VP9, AAC, MP3, and Opus without advertising unsupported EME/DRM.
  - Added zero-Overhead `AudioNode.prototype.connect` destination tap (`24 kHz` mono PCM16LE, 960-sample / 20ms chunks, bounded ring buffer `RING_LEN = 24000`, `MAX_CHUNKS = 8`) with non-enumerable `Symbol.for('dh.a')` bridge (`start`, `stop`, `stopDoc`, `drainDoc(runToken) -> { docId, subDocGen, chunks }`), tracking `lastStartedToken` across `runToken` rotations on the same document (`subDocGen >= 1`) and incrementing `subDocGen` and clearing pre-transition chunks on same-document `hashchange` / `popstate` / `history.pushState` / `history.replaceState`.
- `server/src/browser_host/protocol.rs`
  - Added `AudioChunk` server variant to `ServerMediaFrame` (`24 kHz`, mono, `pcm_s16le`, `frameSeq`, `data`, `captureTimeUnixMs`) and bounded constants (`AUDIO_SAMPLE_RATE = 24_000`, `MAX_AUDIO_PCM_BYTES = 4800`, `MAX_AUDIO_BASE64_BYTES = 6400`).
- `server/src/browser_host/cdp.rs`
  - Added `CdpNavigationListener` hook registered on `CdpClient`, synchronous pre-enqueue `notify_nav_dispatched(session_id, call_id, method, explicit_epoch, expected_url) -> bool` with `CdpError::Protocol(-32000)` rejection when stale, `send_navigation_command` / `send_navigation_command_with_url` for explicit revision binding, `loaderId` extraction in `CdpLifecycleEvent::FrameNavigated` and `Page.navigate` responses, and `frameId` / `url` / `navigationType` extraction on `CdpLifecycleEvent::NavigatedWithinDocument`.
- `server/src/browser_host/screencast.rs`
  - Added `with_capture_policy(fps, jpeg_quality)` and `MIN_GOVERNOR_INTERVAL = 33ms` while preserving `DEFAULT_GOVERNOR_INTERVAL = 100ms` and `DEFAULT_JPEG_QUALITY_LEGACY = 65` on `ScreencastProducer::new`.
  - Implemented `AudioDocAuthority` & `ProducerNavListener` (with `PendingNoopRestore`, `DispatchedNav`, `unmatched_committed_loaders`) correlated via native `CdpNavigationListener`:
    - `C10-H6`, `C11-H6` & `C12-H6`: Explicit navigation epochs are passed via `dispatch_navigation_for_epoch` / `dispatch_navigation_for_epoch_with_url`, checked synchronously before `command_tx.try_send`, and correlated by `call_id` + native `loaderId` (`Some(lid)` for cross-document, `None` for same-document `Page.navigate`). `NavigatedWithinDocument` validates main-frame `frame_id == target_id`, rejects `navigation_type == "historyApi"` against pending API dispatches, matches `expected_url`, and clears `same_doc_committed` if `on_navigation_response` returns `Some(loaderId)` so cross-document navigations to `#anchor` URLs or cross-document history traversals preceded by old-page `pushState` cannot commit early or un-retire the old document. Late completion of an already-admitted older operation after a newer operation committed fences `AudioDocAuthority` (`committed_doc_id = None`, `committed_epoch = target_epoch < requested_epoch`).
    - `C10-H2`, `C11-H2` & `C12-H2`: `ProducerNavListener` is registered on `CdpClient` in `ScreencastProducer::new` and bound to `page_session_id` inside `ensure_page_session()`, observing initial and zero-demand navigations. Same-document `Page.navigate` (both adding `#frag` and removing `#frag` to a URL without `#`) is classified by native outcome (`loaderId: None` + main-frame `Page.navigatedWithinDocument` matching `expected_url`), restoring the `PendingNoopRestore` snapshot and advancing `committed_sub_doc_gen` rather than stranding the surviving document in `retired_doc_ids`.
- `server/src/browser_host/media.rs` & `server/src/api/browser_host.rs`
  - Updated `MIN_DELIVERY_INTERVAL` to `42ms` (~24 FPS).
  - Bound `request_audio_doc_epoch(rev)` + `dispatch_navigation_for_epoch` / `dispatch_navigation_for_epoch_with_url` synchronously in `build_producer`, `navigate_session`, `history_session` (passing target history entry `url`), and `reload_session`, with `resolve_noop_audio_doc_epoch(rev)` when `history_session` is out-of-bounds.
- `server/src/browser_host/media.rs` & `server/src/api/browser_host.rs`
  - Added `ViewerCreditController::with_min_interval` (`MIN_ALLOWED_DELIVERY_INTERVAL = 33ms`) and `FLUSH_PENDING_CHECK_INTERVAL = 15ms` while preserving `MIN_DELIVERY_INTERVAL = 100ms` on `ViewerCreditController::new`.
## Phase 02: Frontend WebAudio PCM Player & BrowserApp Controls (`frontend-webaudio-pcm-player-and-controls`)

### Created / Modified Files
- `packages/ui/src/browser-host/pcm-player.ts` (199 LOC, `< 200` LOC rule compliant)
- `packages/ui/src/api/browser-host-types.ts`
- `packages/ui/src/browser-host/stream-controller.ts`
- `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx`
- `packages/ui/src/os/apps/BrowserApp.tsx`
- `packages/ui/src/browser-host/pcm-player.test.ts`, `packages/ui/src/browser-host/stream-controller.test.ts`, `packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx`, `packages/ui/src/os/apps/BrowserApp.test.tsx`
  - Strict `BrowserAudioChunk` validation with `docEpoch` fencing and media-before-control `onAudioReset` ordering, root keep-alive ownership, and viewer-local Mute/Unmute / "Unlock Audio" toolbar control.
