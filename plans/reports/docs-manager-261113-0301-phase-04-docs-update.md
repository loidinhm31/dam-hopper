# Phase 04 Docs Update Report: Viewer Quality Controls

- **Agent:** Phase04Docs (evc-docs-manager)
- **Date/Stamp:** 261113-0301
- **Phase:** 04 (Viewer quality controls)
- **Plan:** `plans/261112-1205-browser-adaptive-stream-quality-and-performance`
- **Status:** Complete

## Files Changed & Summary of Updates

### 1. `docs/api/browser-host.md` (766 LOC, limit 800)
- **Section 7 (`GET /api/browser/media`):**
  - Documented downstream media messages: binary `BHJF` v1 frames, validated 12-key JSON text `audioChunk` frames (`audioRun` UUID replacing `producerRun`, default audio-suppressed until first `muteState`), and authoritative 15-key JSON status `streamQuality` frames.
  - Documented client control messages table: added `qualityPreference` (`auto`|`high`|`medium`|`low`) and `muteState` (`muted: bool`), bounded to 1024 B (`MAX_MEDIA_CONTROL_BYTES`), coalesced to $\le 4$/s each, with `muted=true` triggering immediate local silence (`PcmPlayer.flush()`).
  - Added deployment warning: Phase 03+04 must deploy as matched backend/UI pair due to `audioRun` wire cutover.
  - Noted that thresholds, legibility, and downscale input trust are Phase 05 qualification gates, not measured results.
- **Section 9 (Viewer Client SDK):**
  - Documented `streamQualityActive` latch and per-run monotonic `appliedCaptureVersionsByRun` map on `BrowserStreamController`.
  - Documented ephemeral in-memory preference store `browser-stream-quality.ts` keyed by `(profileId, generation, windowId, tabId)`.
  - Documented `BrowserTools` accessible controlled selector (`value={qualityPreference}`) and diagnostics.

### 2. `docs/architecture/host-browser-cdp-streaming.md` (759 LOC, limit 800)
- **Section 16 (Binary Media Fanout & Independent Credit Governor):**
  - Documented `producerRun` -> `audioRun` rename in `BrowserAudioChunk` JSON envelope, preserving audio source continuity across video capture-tier restarts while keeping video BHJF/ack `producerRun` unchanged.
  - Documented default audio suppression (`AudioGate::Suppressed(Muted)`) on new media subscriptions until first explicit client `muteState`.
  - Documented source-scoped watermark `AudioWatermark { source_run, watermark }` resetting across audio run changes.
  - Documented $\le 4$/s coalesced preference/mute updates and immediate local WebAudio silence before network acknowledgement.
- **Section 17 (Adaptive Capture Tiers & Stream Control):**
  - Documented per-viewer shared-tier semantics: slowest visible viewer sets shared fidelity (`scale`, `jpegQuality`), while viewer delivery FPS interval (`min_delivery_interval`) and viewer tier are governed independently.
  - Documented server `streamQuality` 15-key event (`kind`, `subscriptionEpoch`, `preference`, `producerRun`, `captureVersion`, `sharedTier`, `viewerTier`, `fps`, `jpegQuality`, `scale`, `imageWidth`, `imageHeight`, `audioSuppressed`, `audioReason`, `status`).
  - Semantics: echoes server-acked preference; `warming`/`unavailable` values are non-applied placeholders; `effective`/`switching` reflects one proven snapshot; `captureVersion` is monotonic decimal u64 per run (`applied_event_version`); `audioReason` distinguishes `muted`, `bandwidth`, `hidden`, and `stalled`.
  - Clarified that thresholds, legibility, and downscale input trust are Phase 05 qualification gates, not measured results.
- **Section 19 (Streaming WebSocket Transports):**
  - Updated `/api/browser/media` transport to reflect client controls `qualityPreference` and `muteState` alongside binary BHJF frames, `audioChunk` (`audioRun`), and 15-key `streamQuality` events.
- **Section 20 (Viewer Client Decoder & Android-Web Input Subsystem):**
  - Documented WebAudio audio fencing on `audioRun` rather than video `producerRun`.
  - Documented ephemeral in-memory preference store `browser-stream-quality.ts` keyed by `(profileId, generation, windowId, tabId)`, default Auto, surviving placement/reconnect, excluded from persistent storage.
  - Documented `BrowserTools` accessible controlled selector (`Auto`/`High`/`Medium`/`Low`, `value={qualityPreference}`), keyboard navigation (Arrow keys, Escape close), view-only operation without lease, shared effective fidelity, local FPS, warming/switching status, and audio suppression reason (`Muted` vs `Bandwidth constrained`).
  - Documented matched backend/UI pair deployment requirement.
- **Section 22 (Qualification Status & Open Proof Obligations):**
  - Added Phase 04 verification baseline: 104 lib `browser_host` tests, 142 integration tests across 9 suites, 185 UI unit tests, 10 Chromium browser tests; Cycle 3 approved (6/10).
  - Listed open Phase 05 qualification gates and carryovers: C3-W4 (revision dedupe / retry counter transaction), C3-W6 residual (offline unequal-viewer acceptance limitation), deployed Chromium / shaped-link evidence, downscale input-trust oracle, thresholds, and legibility.
- **Section 23 (Source Map):**
  - Added `packages/ui/src/os/browser/browser-stream-quality.ts`.

### 3. `docs/system-architecture.md` (780 LOC, limit 800)
- **Host Browser CDP Streaming Subsystem:**
  - Updated `Adaptive Capture Tiers & Viewer Controls` bullet: documented client media controls `qualityPreference` and `muteState` (coalesced $\le 4$/s; immediate local mute), server 15-key `streamQuality` event (preference ack, non-applied placeholders, proven snapshot, monotonic `captureVersion` per run), `audioChunk` `audioRun` rename, default audio suppression on connect, source-scoped `AudioWatermark`, ephemeral in-memory store `browser-stream-quality.ts` keyed by `(profileId, generation, windowId, tabId)`, `BrowserTools` controls and diagnostics, matched backend/UI pair deployment, and Phase 05 qualification status for thresholds, legibility, and downscale input trust.

### 4. `docs/api-reference.md` (237 LOC, limit 800)
- **Host Browser CDP Streaming:**
  - Added media streaming WebSocket (`GET /api/browser/media`) summary covering binary BHJF v1 frames, `audioChunk` text messages (`audioRun`, default suppression on connect), authoritative `streamQuality` events (15 keys, preference ack, monotonic `captureVersion` per run), client controls (`qualityPreference`, `muteState`, coalesced $\le 4$/s, immediate local silence), and matched backend/UI pair deployment requirement (Phase 03+04).

### 5. `docs/project-roadmap.md` (127 LOC, limit 800)
- **Recently Delivered:**
  - Updated `Browser adaptive stream quality and performance` entry to Phase 04 (Viewer quality controls): Phases 01–04 Complete (13/19 tasks completed; Phase 04 2/2 tasks: `wire-viewer-quality-and-mute`, `expose-browser-quality-tools`). Documented client controls, server event, `audioRun` cutover, ephemeral store, `BrowserTools` UI, test passes, matched deployment requirement, and Phase 05 qualification boundaries.
- **Open Qualification Gates:**
  - Updated `Browser adaptive stream quality and performance qualification gate`: noted Phase 04 automated passes (104 lib, 142 integration, 185 UI unit, 10 Chromium browser tests) and Cycle 3 approval (6/10). Tracked Phase 05 follow-ups: C3-W4, C3-W6 residual, live Chromium downscale oracle, estimator calibration, upstream remediation gates, and test hooks `#[doc(hidden)] hold_audio_drain` / `release_audio_drain`.

### 6. `docs/codebase-summary.md` (457 LOC, limit 800)
- **Component Details:**
  - Updated `Streaming WebSocket Handlers` with client controls (`qualityPreference`, `muteState`), `streamQuality` (15 keys), and `audioChunk` `audioRun` rename.
  - Added `Browser Stream Quality Store & Tools (`browser-stream-quality.ts`, `browser-tools.tsx`)` entry detailing ephemeral tuple-keyed in-memory storage and accessible UI controls.
- **Chronological Checkpoints:**
  - Added `Browser Adaptive Stream Quality Phase 04 Checkpoint (2026-11-13)` documenting Phase 04 delivery, verification, and matched deployment requirement.

### 7. `docs/CHANGELOG.md` (714 LOC, limit 800)
- **# Unreleased:**
  - Added entry for `feat(host-browser): Browser adaptive stream quality and performance — Phase 04: Viewer quality controls`.
  - Detailed deployment warning (matched backend/UI cutover), client controls, server 15-key event, `audioRun` rename, default mute suppression, source-scoped watermark, ephemeral store, BrowserTools UI, automated verification, and Phase 05 follow-up tracking.

## Docs Needing Phase 05 Follow-Up

The following documentation items require updates during Phase 05 ("Calibration, qualification and docs"):
1. **`docs/architecture/host-browser-cdp-streaming.md` & `docs/system-architecture.md`:**
   - **Downscale Input-Trust Oracle Execution:** Scaled frames (`scale < 1.0`, Low 0.75x and Constrained 0.5x) are currently documented as `input_trusted = false` pending live-Chromium execution of `evaluate_downscale_oracle`. Phase 05 must document the empirical test results and mark whether scaled frames achieve input trust.
   - **Threshold Calibration & Measured Results:** Transition 9-stage ladder thresholds, ACK service rise boundaries ($\max(100\text{ ms}, 0.5 \times \text{baseline})$), stall suspension clamps (`clamp(4x baseline, 5s, 15s)`), and legibility targets from "untuned calibration targets" to measured qualification results based on shaped-link and deployed Chromium test evidence.
   - **C3-W4 Transactional Revision Synchronization:** Update screencast and media documentation if `quality_revision` is refactored into a coherent transaction covering geometry-only warming changes and failed-start run disappearance.
   - **C3-W6 Residual Qualification Evidence:** Document two-viewer shared-fidelity vs independent local FPS/audio acceptance once executed in a deployed environment with shaped links.
   - **Test Hook Visibility:** Document or remove `#[doc(hidden)] hold_audio_drain` / `release_audio_drain` test hooks on `ScreencastProducer`.
   - **Upstream Remediation Gates:** Reconcile status of the 8 external gates (`unify-geometry-counters`, `enforce-paired-input-lifecycle`, `recover-screencast-runs`, `bound-browser-payloads`, `repair-browser-portals`, `reconcile-browser-ownership`, `fence-client-input-decoding`, `wire-browser-interaction`) once addressed upstream.
2. **`docs/api/browser-host.md`:**
   - Add empirical bandwidth, latency, and decode duration benchmarks measured across network profiles once Phase 05 qualification testing concludes.
3. **`docs/project-roadmap.md` & `docs/codebase-summary.md`:**
   - Mark Phase 05 complete and update delivery statistics upon phase signoff.

## Verification
- `wc -l` confirms all 7 updated files are strictly below `docs.maxLoc 800`:
  - `docs/architecture/host-browser-cdp-streaming.md`: 759 LOC
  - `docs/api/browser-host.md`: 766 LOC
  - `docs/system-architecture.md`: 780 LOC
  - `docs/api-reference.md`: 237 LOC
  - `docs/project-roadmap.md`: 127 LOC
  - `docs/codebase-summary.md`: 457 LOC
  - `docs/CHANGELOG.md`: 714 LOC
- `node ~/.omp/agent/evcrate/scripts/validate-docs.cjs docs/`: 411 internal links working, zero broken links.
- No new markdown files created outside `docs/` or `plans/`.

## Unresolved Questions
- None blocking Phase 04 documentation. Follow-up items identified in code review (C3-W4 revision dedupe transaction, C3-W6 two-viewer live shaped-link acceptance, downscale input-trust oracle execution, upstream remediation gates) are recorded as Phase 05 follow-ups.
