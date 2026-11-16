# Phase 04 Report: wire-viewer-quality-and-mute (Server)

Date: 2026-11-13
Agent: QualityWireServer
Status: completed

## Files Modified
- `server/src/browser_host/protocol.rs`: Add QualityPreference/MuteState client controls, BrowserStreamQuality server event, ServerMediaEvent tagged discrimination, cut over ProducerAudioChunk/BrowserAudioChunk from producer_run to audio_run, bounds validation tests.
- `server/src/browser_host/adaptive_stream_controller.rs`: Set new subscriptions to default-muted (muted=true, gate_suppressed=true), adjust unit tests.
- `server/src/browser_host/screencast.rs`: Track proven frame state on ScreencastProducer, add stream_quality_event builder, preserve audio_source_run across capture-only restarts.
- `server/src/browser_host/media.rs`: Handle qualityPreference and muteState controls with <=4/s rate coalescing (mute=true immediate + writer_handle.clear_audio()), ignore cross-subscription controls, emit streamQuality on attach and change only, emit unavailable for producer-less sessions.
- `server/src/browser_host/media_writer.rs`: Rename producer_run to audio_run on QueuedAudioSlot and audio admissibility check.
- `server/tests/browser_host_screencast.rs`: Add tests for stream_quality_event warming/effective/switching lifecycle, independent viewer gates, audio_run persistence across video restart.
- `server/tests/browser_host_media.rs`: Update audio tests to audio_run, add cross-subscription ignore test, producer-less unavailable test, malformed control disconnect test.

## Key Decisions
- Subscription audio starts suppressed (reason muted, gate generation 0) until explicit muteState arrives.
- Mute=true applies immediately and purges pending audio + queued writer chunk; unmute and preference updates coalesce latest-wins at <=4 updates/s on existing 15ms flush ticker without auxiliary tasks.
- StreamQuality emitted on attach (warming), change of tier/fps/gate/applied snapshot, and unavailable (once for producer-less sessions) via writer control slot (single latest-wins slot).
- Audio clean cutover from producerRun to audioRun across Rust DTOs and envelopes; video BHJF headers retain producerRun.

## Test Results
- `cargo test --features vendored --test browser_host_media --test browser_host_screencast`: 36 passed (2 suites, 3.61s)
- `cargo test --features vendored --lib browser_host`: 100 passed (1 suite, 2.99s)
- Max serialized client control size tested <= 1024 bytes.
- Malformed/oversized/extra-field client controls tested rejected.

## Open Issues
- None.
