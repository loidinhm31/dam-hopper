# Review Cycle 2 Fixes Report: Phase 04 Viewer Quality Controls (Server)

Date: 2026-11-13
Agent: QualityWireServer

## Summary of Fixes
1. **C2-W2 (`quality_revision` steady-state deduplication)**:
   - In `ScreencastProducer::publish_governed_candidate`, compares new proven state (`producer_run`, version, fps, jpeg_quality, scale, width, height) to existing proven state before setting and bumping `quality_revision`.
   - Identical frames produce zero revision bumps, zero event builds, and zero outgoing `streamQuality` messages. Added regression `steady_identical_frames_do_not_bump_quality_revision` asserting revision is unchanged across identical frames.
2. **C2-W3 (Atomic admission watermark at gate-generation transition)**:
   - Moved admission watermark tracking directly into `AdaptiveStreamController::sync_gate`, recorded atomically with `gate_gen` on closed->open transitions (unmute, tier recovery, unstall, visible).
   - `ScreencastProducer::viewer_audio_gate_info` returns `(gate, generation, watermark)` in a single read; `media.rs` admission rejects chunks with `audio_seq <= watermark`. Removed session-local boolean edge detection.
   - Added unit test `gate_transition_records_admission_watermark` and integration test with deliberately held broadcast backlog + Allowed->Suppressed->Allowed controller recovery and wire muteState ack boundary.
3. **C2-W4 (FPS-only convergence, coherent snapshot, warming placeholder)**:
   - Defined applied status convergence: `is_effective = p.snapshot.version == target.version || (p.snapshot.native_key() == target.native_key() && p.snapshot.fps == target.fps)`. Governor-only FPS changes converge to `Effective` with `capture_version = target.version`, never stuck in `Switching`.
   - Event builder samples `quality_revision` before and after reading state with up to 3 bounded retries, falling back to warming placeholder if flapping.
   - In warming, `captureVersion` is target version placeholder. Added regressions `fps_only_change_converges_to_effective_status` and `target_advances_before_first_frame_proof_still_emitted_coherently`.

## Verification Status
- `cargo test --features vendored --lib browser_host`: 102 passed
- 9 `browser_host_*` integration suites: 141 passed (media, screencast, input, bounds, lifecycle, gateway, admission, selection, shutdown)

## Unresolved Questions
- None.
