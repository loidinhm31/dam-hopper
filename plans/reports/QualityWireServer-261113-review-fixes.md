# Review Fixes Report: Phase 04 Viewer Quality Controls (Server)

Date: 2026-11-13
Agent: QualityWireServer

## Summary of Fixes
1. **Contract Change**: Added 15th field `preference` to `BrowserStreamQuality` and `AdaptiveStreamController::viewer_preference` getter. `audioReason` is always serialized (null when unsuppressed).
2. **W4 (applied-only fidelity)**: In `effective`/`switching` status, `sharedTier`, `producerRun`, `captureVersion`, `jpegQuality`, `scale`, `imageWidth`, `imageHeight` all come strictly from the proven snapshot of the current run (`sharedTier = p.snapshot.tier`). Consistent view verified across pre/post run reads; status `warming` documents numbers as non-applied placeholders. Removed unused `current_run_proven` public getter.
3. **W7 (O(1) dirty comparison)**: Added atomic `quality_revision` to `ScreencastProducer` bumped on run/target/proven/geometry changes; session loop uses `ViewerQualityDigest` value comparison before formatting or serializing; sampled 1s safety net without per-15ms allocations.
4. **W6 (Rust/TS parity)**: Added `deny_unknown_fields` to `BrowserAudioChunk` (rejecting legacy `producerRun`); enforced `MAX_SERVER_MEDIA_TEXT_BYTES = 8192` cap in `ServerMediaEvent::parse_and_validate`; verified strict canonical base64 padding rejection; added negative fixture tests for legacy fields, non-canonical padding, omitted `audioReason`, unknown preference, and oversized messages.
5. **W8 (admission watermark)**: Added `latest_audio_seq` tracking; session loop sets `audio_unmute_watermark` on closed->open gate transitions and drops broadcast backlog with `seq <= watermark`; verified with integration test.

## Shared Negative Fixtures & Bounds for TS Parity
- Maximum server media text message cap: `8,192 bytes` (`MAX_SERVER_MEDIA_TEXT_BYTES`).
- Fixtures: `FIXTURE_AUDIO_LEGACY_PRODUCER_RUN`, `FIXTURE_AUDIO_NON_CANONICAL_PADDING` (`"AAAAAB=="`), `FIXTURE_STREAM_QUALITY_MISSING_AUDIO_REASON`, `FIXTURE_STREAM_QUALITY_UNKNOWN_PREF` (`"ultra"`), `FIXTURE_SERVER_MEDIA_OVERSIZED`.

## Verification Status
- `cargo test --features vendored --lib browser_host`: 101 passed
- 9 `browser_host_*` integration suites: 138 passed (media, screencast, input, bounds, lifecycle, gateway, admission, selection, shutdown)

## Unresolved Questions
- None.
