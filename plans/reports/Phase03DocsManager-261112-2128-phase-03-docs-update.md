# Phase 03 Docs Update Report: Server Adaptive Capture Tiers

- **Agent:** Phase03DocsManager
- **Date/Stamp:** 261112-2128
- **Phase:** 03 (Server adaptive capture tiers)
- **Status:** Complete

## Files Changed & Sections

### 1. `docs/architecture/host-browser-cdp-streaming.md` (758 LOC, limit 800)
- **Header Status:** Updated to include Phase 03 approved baseline.
- **Section 15 (Native Screencast Producer & Bounded Ingress):** Documented capture policy migration to shared `Arc<CaptureTierState>`, admin `CaptureCeilings`, Auto warm-start at Medium (10fps/q65/scale 1.0) clamped to ceilings, and zero-demand stop re-verification under lifecycle write lock.
- **Section 16 (Binary Media Fanout & Independent Credit Governor):** Documented runtime per-viewer pacing via `set_min_delivery_interval`, stall send suspension (`send_suspended`), and per-viewer audio gating with generation counter (`audio_gen`) and write-time admissibility checks.
- **NEW Section 17 (Adaptive Capture Tiers & Stream Control):**
  - 9-stage ladder table (stages 0–8, anchors High/Medium/Low/Constrained; stage values explicit as calibration targets).
  - Reverse-order recovery rule (scale -> quality -> FPS, one knob per step).
  - Admin ceilings clamping and Auto warm-start at Medium behavior change.
  - Viewer eligibility rules (visible, unexpired 15s, not stalled, warm-up 2 windows), newcomer warm-up, and slowest eligible consensus.
  - Shared fidelity vs. independent per-viewer pacing.
  - Pressure detection (ACK service rise + backlog, or ACK starvation) and decoder overload independent pacing cap.
  - Hysteresis recovery (10 healthy windows, 5s dwell, >=25% headroom, exponential probe backoff to 60 windows).
  - Stall suspension clamp(4x baseline, 5s, 15s).
  - Stop-before-start switch under state write lock with single revert to effective params (`revert_to_effective()`) and 15s backoff.
  - `producerRun` rotation vs. invariant CSS/DPR/viewportEpoch.
  - Effective vs. desired snapshot distinction.
  - Decoupled `AudioSource` surviving video capture restarts.
  - Per-viewer `AudioGate` generation tracking and write-time checks.
  - Downscaled input-trust oracle rule (`evaluate_downscale_oracle`), noting scaled frames remain input-untrusted pending Phase 05 live-Chromium run.
- **Sections 18–22:** Renumbered from 17–21.
- **Section 22 (Qualification Status & Open Proof Obligations):** Updated Screencast and Media gate rows; added Phase 03 verification summary (95/95 lib tests, 128 integration tests; Cycle 3 approved 7/10).
- **Section 23 (Source Map):** Added `capture_tier.rs` and `adaptive_stream_controller.rs`; consolidated test suite and UI component rows to preserve headroom under 800 LOC.

### 2. `docs/configuration/server-runtime-settings.md` (206 LOC, limit 800)
- **Host Browser Configuration (`[server.browser.budgets]`):** Updated `frame_rate_fps`, `jpeg_quality`, `max_width`, `max_height` documentation to establish their role as hard admin ceilings (`CaptureCeilings`) for adaptive tiers.
- **Validation, Streaming Policy & Operational Constraints:** Added detailed breakdown of ceiling bounds, Auto warm-start at Medium (10fps/q65/scale 1.0), and High tier clamping (`min(20fps, ceiling)`, quality 75–80 clamped).

### 3. `docs/system-architecture.md` (780 LOC, limit 800)
- **Host Browser CDP Streaming Subsystem:**
  - Added `Adaptive Capture Tiers & Stream Control (`capture_tier.rs`, `adaptive_stream_controller.rs`)` bullet detailing 9-stage ladder, slowest-eligible consensus, dwell/headroom recovery, downscale oracle, and decoupled audio gate generation.
  - Updated `Native Screencast Producer & Bounded Fanout` bullet with updated responsibilities for `screencast.rs` (shared `Arc<CaptureTierState>`, stop-before-start switch, failure handling, invariant geometry, zero-demand re-verification), `media.rs` (runtime pacing, stall suspension), and `media_writer.rs` (bounded slots, audio gate checks).

### 4. `docs/codebase-summary.md` (455 LOC, limit 800)
- **Domain Directory Summary:** Updated `browser_host/` row to 25 files, 27,322 LOC, indexing `capture_tier.rs` and `adaptive_stream_controller.rs`.
- **Component Details:** Added dedicated entries for `capture_tier.rs` and `adaptive_stream_controller.rs`; updated responsibilities for `screencast.rs`, `media.rs`, and `media_writer.rs`.
- **Chronological Checkpoints:** Added `Browser Adaptive Stream Quality Phase 03 Checkpoint (2026-11-12)`.

### 5. `docs/CHANGELOG.md` (702 LOC, limit 800)
- **# Unreleased:** Added entry for `feat(host-browser): Browser adaptive stream quality and performance — Phase 03: Server adaptive capture tiers`.
- **Deployment Warning:** Explicitly flagged that client drops audio whose `producerRun != current video run` after capture-only restarts until Phase 04 client cutover; Phase 03 must not be deployed alone.
- **Added / Changed:** Documented new modules, ladder, controller, write-time audio gating, and verification status.

### 6. `docs/api-reference.md` (237 LOC, unchanged)
- Checked: Does not document `ViewerDeliverySnapshot` or diagnostics fields directly (references external `./api/browser-host.md`). Left unchanged per specification.

## Doc / Code Mismatches Found
- None. Code implementations in `capture_tier.rs`, `adaptive_stream_controller.rs`, `screencast.rs`, `media.rs`, `media_writer.rs`, and `viewer_delivery_estimator.rs` strictly match documented contracts.

## Unresolved Questions
- None blocking documentation. Follow-up items tracked in code review records (Phase 04 client audio run matching, Phase 05 live-Chromium downscale oracle execution, baseline estimator EWMA recalibration, upstream remediation gates) are recorded in docs as known boundaries.
