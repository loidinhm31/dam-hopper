//! Bounded adaptive decision state for the shared Browser capture.
//!
//! Measured application delivery (ACK service, backlog, decoder cost) — never a claimed internet
//! speed — drives one staged ladder position per viewer. The slowest *eligible* viewer (visible,
//! unexpired, not stalled, past warm-up) sets shared quality/resolution; each viewer's delivery
//! FPS follows its own position. All numerical thresholds are calibration targets.
use std::collections::HashMap;
use std::time::{Duration, Instant};

use uuid::Uuid;

use super::capture_tier::{CaptureCeilings, CaptureTier, Ladder, QualityPreference};
use super::viewer_delivery_estimator::{SampleProvenance, ViewerDeliverySnapshot};
/// Capture-fidelity changes are at least this far apart.
pub const CAPTURE_DWELL: Duration = Duration::from_secs(5);
pub const PRESSURE_WINDOWS: u32 = 2;
pub const BASE_RECOVERY_WINDOWS: u32 = 10;
pub const MAX_RECOVERY_WINDOWS: u32 = 60;
pub const WARMUP_WINDOWS: u32 = 2;
pub const HEADROOM: f64 = 1.25;
pub const STALL_MIN: Duration = Duration::from_secs(5);
pub const STALL_MAX: Duration = Duration::from_secs(15);
/// Viewers silent for longer than this stop voting (matches producer demand expiry).
pub const REPORT_EXPIRY: Duration = Duration::from_secs(15);
const SERVICE_MARGIN_MS: f64 = 100.0;
const PROBE_BACKOFF_WINDOW: Duration = Duration::from_secs(30);
const MAX_OUTSTANDING: usize = 2;

/// Why new audio chunks are withheld from one viewer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioSuppression {
    Muted,
    Hidden,
    Stalled,
    Constrained,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioGate {
    Allowed,
    Suppressed(AudioSuppression),
}

impl AudioGate {
    pub fn is_allowed(self) -> bool {
        self == Self::Allowed
    }
}

/// Source-scoped watermark for audio chunk admission: chunks with sequence `<= seq`
/// under the matching `source_run` were broadcast before the gate opened and are discarded.
/// If `source_run` differs (audio source restarted), the old watermark does not suppress
/// chunks from the new source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct AudioWatermark {
    pub source_run: Option<Uuid>,
    pub seq: u64,
}

impl AudioWatermark {
    pub fn new(source_run: Option<Uuid>, seq: u64) -> Self {
        Self { source_run, seq }
    }

    pub fn suppresses(&self, chunk_run: Option<Uuid>, chunk_seq: u64) -> bool {
        match (self.source_run, chunk_run) {
            (Some(ws), Some(cs)) if ws == cs => chunk_seq <= self.seq,
            (Some(_), _) => false, // Different source run: watermark does not suppress new source
            (None, _) => chunk_seq <= self.seq, // Source-agnostic fallback (e.g. tests)
        }
    }
}

/// Per-viewer runtime directives consumed by the media session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ViewerDirectives {
    pub min_delivery_interval: Duration,
    pub send_suspended: bool,
    pub audio: AudioGate,
    /// Bumped on every audio-suppression transition (including quick mute/unmute) so queued
    /// audio from before the transition can be invalidated.
    pub audio_gen: u64,
    pub admission_watermark: AudioWatermark,
    pub stage: usize,
    pub tier: CaptureTier,
}

/// Shared capture decision: quality/scale from `fidelity_stage`, producer cadence `fps`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TargetDecision {
    pub fidelity_stage: usize,
    pub fps: u32,
}

/// Fields of a delivery snapshot the controller needs; one new sample is one decision window.
#[derive(Debug, Clone, Copy)]
pub struct ViewerSample {
    pub provenance: SampleProvenance,
    pub ack_starved: bool,
    pub service_ewma_ms: Option<f64>,
    pub baseline_ms: Option<f64>,
    pub outstanding_frames: usize,
    pub oldest_age_ms: u64,
    pub has_pending: bool,
    pub decode_ms_ewma: Option<f64>,
    pub frame_bytes_ewma: Option<f64>,
    pub audio_kbps_ewma: f64,
    pub delivered_kbps_ewma: Option<f64>,
    /// Acked + discarded bytes so far: changes only on credit progress.
    pub progress_counter: u64,
    /// Pacing holds + pending replacements so far: grows while demand exceeds what is sent.
    pub motion_counter: u64,
}

impl From<&ViewerDeliverySnapshot> for ViewerSample {
    fn from(s: &ViewerDeliverySnapshot) -> Self {
        Self {
            provenance: s.sample_provenance,
            ack_starved: s.ack_starved_pressure,
            service_ewma_ms: s.service_ewma_ms,
            baseline_ms: s.min_service_baseline_ms,
            outstanding_frames: s.outstanding_frames,
            oldest_age_ms: s.oldest_outstanding_age_ms,
            has_pending: s.has_pending_frame,
            decode_ms_ewma: s.client_corroboration.decode_ms_ewma,
            frame_bytes_ewma: s.frame_bytes_ewma,
            audio_kbps_ewma: s.audio_kbps_ewma,
            delivered_kbps_ewma: s.delivered_kbps_ewma,
            progress_counter: s
                .total_acked_drawn_bytes
                .saturating_add(s.total_discarded_bytes),
            motion_counter: s
                .intentional_pacing_holds
                .saturating_add(s.pending_replacements),
        }
    }
}

struct ViewerState {
    pref: QualityPreference,
    muted: bool,
    visible: bool,
    stage: usize,
    last_report: Instant,
    sample: Option<ViewerSample>,
    sample_seq: u64,
    processed_seq: u64,
    pressure: u32,
    healthy: u32,
    warmup_left: u32,
    recovery_required: u32,
    last_stage_change: Instant,
    last_upgrade: Option<Instant>,
    stalled: bool,
    last_progress: Instant,
    last_progress_counter: u64,
    last_motion_counter: u64,
    /// Local decoder overload pacing cap (independent of the fidelity ladder position).
    fps_cap: Option<u32>,
    gate_gen: u64,
    gate_suppressed: bool,
    admission_watermark: AudioWatermark,
}

fn stall_threshold(baseline_ms: Option<f64>) -> Duration {
    baseline_ms.map_or(STALL_MIN, |b| {
        Duration::from_secs_f64(b * 4.0 / 1000.0).clamp(STALL_MIN, STALL_MAX)
    })
}

impl ViewerState {
    fn eligible(&self, now: Instant) -> bool {
        self.visible
            && !self.stalled
            && self.warmup_left == 0
            && now.saturating_duration_since(self.last_report) <= REPORT_EXPIRY
    }

    /// Effective delivery FPS: ladder rung capped by decoder pacing.
    fn fps(&self, ladder: &Ladder) -> u32 {
        let rung = ladder.stage(self.stage).fps;
        self.fps_cap.map_or(rung, |c| c.min(rung))
    }

    fn audio_gate(&self, ladder: &Ladder, now: Instant) -> AudioGate {
        let stale = now.saturating_duration_since(self.last_report) > REPORT_EXPIRY;
        if self.muted {
            AudioGate::Suppressed(AudioSuppression::Muted)
        } else if !self.visible || stale {
            AudioGate::Suppressed(AudioSuppression::Hidden)
        } else if self.stalled {
            AudioGate::Suppressed(AudioSuppression::Stalled)
        } else if ladder.tier_of(self.stage) == CaptureTier::Constrained {
            AudioGate::Suppressed(AudioSuppression::Constrained)
        } else {
            AudioGate::Allowed
        }
    }

    /// Bump the gate generation on each suppression transition.
    /// On closed->open transition, record the latest broadcast audio sequence number as the watermark.
    fn sync_gate(
        &mut self,
        ladder: &Ladder,
        now: Instant,
        source_run: Option<Uuid>,
        latest_audio_seq: u64,
    ) {
        let suppressed = !self.audio_gate(ladder, now).is_allowed();
        if suppressed != self.gate_suppressed {
            self.gate_suppressed = suppressed;
            self.gate_gen = self.gate_gen.wrapping_add(1);
            if !suppressed {
                self.admission_watermark = AudioWatermark::new(source_run, latest_audio_seq);
            }
        }
    }

    fn update_stall(&mut self, now: Instant) {
        let Some(s) = self.sample else { return };
        if s.progress_counter != self.last_progress_counter || s.outstanding_frames == 0 {
            self.last_progress_counter = s.progress_counter;
            self.last_progress = now;
            if self.stalled {
                // Valid progress resumes sending; voting resumes only after a conservative warm-up.
                (self.stalled, self.warmup_left, self.pressure, self.healthy) =
                    (false, WARMUP_WINDOWS, 0, 0);
            }
        } else if now.saturating_duration_since(self.last_progress)
            >= stall_threshold(s.baseline_ms)
        {
            self.stalled = true;
        }
    }

    fn set_stage(&mut self, stage: usize, now: Instant) {
        self.stage = stage;
        self.last_stage_change = now;
        (self.pressure, self.healthy) = (0, 0);
    }

    /// Consume at most one new sample as one decision window.
    fn step(&mut self, ladder: &Ladder, now: Instant) {
        let Some(s) = self.sample else { return };
        if self.processed_seq == self.sample_seq {
            return;
        }
        self.processed_seq = self.sample_seq;
        let motion = s.motion_counter > self.last_motion_counter;
        self.last_motion_counter = s.motion_counter;
        if self.stalled || !self.visible {
            (self.pressure, self.healthy) = (0, 0);
            return;
        }
        if self.warmup_left > 0 {
            self.warmup_left -= 1;
            return;
        }

        let frame_ms = 1000.0 / f64::from(self.fps(ladder));
        let backlog = s.has_pending || s.outstanding_frames >= MAX_OUTSTANDING;
        // ACK service includes client decode time: subtract it so decoder overload is not mistaken
        // for link congestion (the FPS-only decoder branch handles it).
        let decode = s.decode_ms_ewma.unwrap_or(0.0);
        let rising = matches!((s.service_ewma_ms, s.baseline_ms), (Some(svc), Some(b)) if (svc - decode).max(0.0) > b + (0.5 * b).max(SERVICE_MARGIN_MS));
        // Ack starvation counts only when older than a normal service for this link, so a fixed
        // (even multi-second) RTT never degrades fidelity by itself.
        let starved = s.ack_starved
            && s.oldest_age_ms as f64 > s.baseline_ms.map_or(3000.0, |b| 2.0 * b + 500.0) + decode;
        let network = (backlog && rising) || starved;
        let decoder = !network && s.decode_ms_ewma.is_some_and(|d| d > frame_ms);
        let severe =
            network && s.oldest_age_ms as f64 > (8.0 * s.baseline_ms.unwrap_or(250.0)).max(2000.0);
        let frozen = matches!(
            s.provenance,
            SampleProvenance::Idle | SampleProvenance::Warming
        ) || (s.provenance == SampleProvenance::ApplicationLimited && !motion);

        if frozen {
            self.pressure = 0; // idle / application-limited samples freeze capacity inference
        } else if network || decoder {
            self.healthy = 0;
            self.pressure += 1;
            self.try_down(ladder, now, network, severe);
        } else {
            self.pressure = 0;
            self.healthy += 1;
            self.try_up(ladder, &s, now);
        }
    }

    fn try_down(&mut self, ladder: &Ladder, now: Instant, network: bool, severe: bool) {
        let next = self.stage + 1;
        let fps_only = next < ladder.len() && ladder.fps_only_step(self.stage, next);
        if !network {
            // Local decoder overload only ever lowers FPS (next FPS-only rung, else a pacing cap);
            // it is not reported link speed.
            if self.pressure < PRESSURE_WINDOWS {
                return;
            }
            if fps_only {
                self.note_downshift(now);
                self.set_stage(next, now);
            } else if let Some(lower) = ladder.lower_fps(self.fps(ladder)) {
                self.note_downshift(now);
                self.fps_cap = Some(lower);
                (self.pressure, self.healthy) = (0, 0);
            }
            return;
        }
        if next >= ladder.len() {
            return;
        }
        let dwell_ok = now.saturating_duration_since(self.last_stage_change) >= CAPTURE_DWELL;
        if self.pressure < PRESSURE_WINDOWS && !(severe && fps_only) {
            return;
        }
        if !dwell_ok && !(severe && fps_only) {
            return;
        }
        self.note_downshift(now);
        self.set_stage(next, now);
    }

    /// A downshift soon after a recovery probe failed the probe: back off the next recovery.
    fn note_downshift(&mut self, now: Instant) {
        if self
            .last_upgrade
            .is_some_and(|t| now.saturating_duration_since(t) <= PROBE_BACKOFF_WINDOW)
        {
            self.recovery_required = (self.recovery_required * 2).min(MAX_RECOVERY_WINDOWS);
        }
    }

    fn try_up(&mut self, ladder: &Ladder, s: &ViewerSample, now: Instant) {
        if let Some(cap) = self.fps_cap {
            // Restore decoder-capped pacing one candidate at a time before any fidelity upgrade.
            if self.healthy >= self.recovery_required {
                let rung = ladder.stage(self.stage).fps;
                self.fps_cap = ladder.higher_fps(cap).filter(|f| *f < rung);
                self.healthy = 0;
                self.last_upgrade = Some(now);
            }
            return;
        }
        if self.stage <= ladder.floor_stage(self.pref) {
            return;
        }
        if self.healthy < self.recovery_required
            || now.saturating_duration_since(self.last_stage_change) < CAPTURE_DWELL
        {
            return;
        }
        let cand = self.stage - 1;
        if !self.fits(ladder, s, cand) {
            return;
        }
        self.set_stage(cand, now);
        self.last_upgrade = Some(now);
    }

    /// Next demand must fit with >=25% headroom of the measured busy goodput; unknown estimates probe.
    fn fits(&self, ladder: &Ladder, s: &ViewerSample, cand: usize) -> bool {
        let (cur, next) = (ladder.stage(self.stage), ladder.stage(cand));
        let (Some(bytes), Some(cap)) = (s.frame_bytes_ewma, s.delivered_kbps_ewma) else {
            return true;
        };
        let scale = f64::from(next.scale_permille) / f64::from(cur.scale_permille);
        let bytes =
            bytes * scale * scale * (f64::from(next.jpeg_quality) / f64::from(cur.jpeg_quality));
        let projected = 8.0 * bytes * f64::from(next.fps) / 1000.0 + s.audio_kbps_ewma;
        projected * HEADROOM <= cap
            || (s.provenance != SampleProvenance::Busy
                && self.healthy >= 2 * self.recovery_required)
    }
}

pub struct AdaptiveStreamController {
    ladder: Ladder,
    viewers: HashMap<String, ViewerState>,
    published_stage: usize,
    published_at: Instant,
}

impl AdaptiveStreamController {
    pub fn new(ceilings: CaptureCeilings) -> Self {
        Self::new_at(ceilings, Instant::now())
    }

    pub fn new_at(ceilings: CaptureCeilings, now: Instant) -> Self {
        let ladder = Ladder::new(&ceilings);
        let published_stage = ladder.anchor(CaptureTier::Medium);
        Self {
            ladder,
            viewers: HashMap::new(),
            published_stage,
            published_at: now.checked_sub(CAPTURE_DWELL).unwrap_or(now),
        }
    }

    pub fn ladder(&self) -> &Ladder {
        &self.ladder
    }
    pub fn published_stage(&self) -> usize {
        self.published_stage
    }
    pub fn viewer_stage(&self, sub: &str) -> Option<usize> {
        self.viewers.get(sub).map(|v| v.stage)
    }
    pub fn is_stalled(&self, sub: &str) -> bool {
        self.viewers.get(sub).is_some_and(|v| v.stalled)
    }
    /// Audio gate generation; `None` for unknown (removed/expired) subscriptions.
    pub fn audio_generation(&self, sub: &str) -> Option<u64> {
        self.viewers.get(sub).map(|v| v.gate_gen)
    }
    /// Quality preference accepted for this subscription; `None` if unknown.
    pub fn viewer_preference(&self, sub: &str) -> Option<QualityPreference> {
        self.viewers.get(sub).map(|v| v.pref)
    }

    pub fn audio_gate_info(
        &mut self,
        sub: &str,
        now: Instant,
        source_run: Option<Uuid>,
        latest_audio_seq: u64,
    ) -> Option<(AudioGate, u64, AudioWatermark)> {
        let ladder = &self.ladder;
        let v = self.viewers.get_mut(sub)?;
        v.sync_gate(ladder, now, source_run, latest_audio_seq);
        Some((v.audio_gate(ladder, now), v.gate_gen, v.admission_watermark))
    }

    pub fn audio_gate_info_readonly(&self, sub: &str, now: Instant) -> Option<(AudioGate, u64, AudioWatermark)> {
        let v = self.viewers.get(sub)?;
        Some((v.audio_gate(&self.ladder, now), v.gate_gen, v.admission_watermark))
    }

    /// Register a subscription (idempotent): Auto, muted default, warming at Medium.
    pub fn register(&mut self, sub: &str, now: Instant) {
        self.register_with_seq(sub, now, None, 0);
    }

    pub fn register_with_seq(
        &mut self,
        sub: &str,
        now: Instant,
        source_run: Option<Uuid>,
        latest_audio_seq: u64,
    ) {
        let stage = self.ladder.initial_stage(QualityPreference::Auto);
        let warmup_left = if self.viewers.values().any(|v| v.eligible(now)) {
            WARMUP_WINDOWS
        } else {
            0
        };
        self.viewers
            .entry(sub.to_string())
            .or_insert_with(|| ViewerState {
                pref: QualityPreference::Auto,
                muted: true,
                visible: true,
                stage,
                last_report: now,
                sample: None,
                sample_seq: 0,
                processed_seq: 0,
                pressure: 0,
                healthy: 0,
                warmup_left,
                recovery_required: BASE_RECOVERY_WINDOWS,
                last_stage_change: now.checked_sub(CAPTURE_DWELL).unwrap_or(now),
                last_upgrade: None,
                stalled: false,
                last_progress: now,
                last_progress_counter: 0,
                last_motion_counter: 0,
                fps_cap: None,
                gate_gen: 0,
                gate_suppressed: true,
                admission_watermark: AudioWatermark::new(source_run, latest_audio_seq),
            });
    }

    pub fn remove(&mut self, sub: &str) {
        self.viewers.remove(sub);
    }

    /// Manual preference caps requested fidelity only; congestion safety and admin caps remain.
    pub fn set_preference(&mut self, sub: &str, pref: QualityPreference, now: Instant) -> bool {
        self.set_preference_with_seq(sub, pref, now, None, 0)
    }

    pub fn set_preference_with_seq(
        &mut self,
        sub: &str,
        pref: QualityPreference,
        now: Instant,
        source_run: Option<Uuid>,
        latest_audio_seq: u64,
    ) -> bool {
        let floor = self.ladder.floor_stage(pref);
        let Some(v) = self.viewers.get_mut(sub) else {
            return false;
        };
        v.pref = pref;
        if v.stage < floor {
            v.set_stage(floor, now);
        }
        v.sync_gate(&self.ladder, now, source_run, latest_audio_seq);
        true
    }

    pub fn set_muted(&mut self, sub: &str, muted: bool, now: Instant) -> bool {
        self.set_muted_with_seq(sub, muted, now, None, 0)
    }

    pub fn set_muted_with_seq(
        &mut self,
        sub: &str,
        muted: bool,
        now: Instant,
        source_run: Option<Uuid>,
        latest_audio_seq: u64,
    ) -> bool {
        let ladder = &self.ladder;
        let Some(v) = self.viewers.get_mut(sub) else {
            return false;
        };
        v.muted = muted;
        v.sync_gate(ladder, now, source_run, latest_audio_seq);
        true
    }

    /// Accept one feedback sample. Unknown/removed subscriptions return `None` and change nothing.
    pub fn report(
        &mut self,
        sub: &str,
        visible: bool,
        sample: ViewerSample,
        now: Instant,
    ) -> Option<ViewerDirectives> {
        self.report_with_seq(sub, visible, sample, now, None, 0)
    }

    pub fn report_with_seq(
        &mut self,
        sub: &str,
        visible: bool,
        sample: ViewerSample,
        now: Instant,
        source_run: Option<Uuid>,
        latest_audio_seq: u64,
    ) -> Option<ViewerDirectives> {
        let v = self.viewers.get_mut(sub)?;
        // Critical: Synchronize time-derived gate transitions (such as read-time expiry)
        // BEFORE updating last_report so that expiry transitions to Suppressed first,
        // and subsequent update to last_report transitions back to Allowed on recovery,
        // bumping gate_gen and recording the watermark.
        v.sync_gate(&self.ladder, now, source_run, latest_audio_seq);
        v.visible = visible;
        v.last_report = now;
        v.sample = Some(sample);
        v.sample_seq = v.sample_seq.wrapping_add(1);
        v.update_stall(now);
        v.sync_gate(&self.ladder, now, source_run, latest_audio_seq);
        self.directives_for(sub, now)
    }

    pub fn directives(&self, sub: &str, now: Instant) -> Option<ViewerDirectives> {
        self.directives_for(sub, now)
    }

    fn directives_for(&self, sub: &str, now: Instant) -> Option<ViewerDirectives> {
        let v = self.viewers.get(sub)?;
        let tier = self.ladder.tier_of(v.stage);
        Some(ViewerDirectives {
            min_delivery_interval: Duration::from_secs_f64(1.0 / f64::from(v.fps(&self.ladder))),
            send_suspended: v.stalled,
            audio: v.audio_gate(&self.ladder, now),
            audio_gen: v.gate_gen,
            admission_watermark: v.admission_watermark,
            stage: v.stage,
            tier,
        })
    }

    /// Advance every viewer's window and compute the shared decision. Fidelity moves at most one
    /// knob per `CAPTURE_DWELL` toward the slowest eligible viewer, in either direction.
    pub fn evaluate(&mut self, now: Instant) -> Option<TargetDecision> {
        self.evaluate_with_seq(now, None, 0)
    }

    pub fn evaluate_with_seq(
        &mut self,
        now: Instant,
        source_run: Option<Uuid>,
        latest_audio_seq: u64,
    ) -> Option<TargetDecision> {
        let ladder = &self.ladder;
        for v in self.viewers.values_mut() {
            v.update_stall(now);
            v.step(ladder, now);
            v.sync_gate(ladder, now, source_run, latest_audio_seq);
        }
        let (mut cand, mut fps, mut any) = (0usize, 0u32, false);
        for v in self.viewers.values().filter(|v| v.eligible(now)) {
            any = true;
            cand = cand.max(v.stage);
            fps = fps.max(v.fps(ladder));
        }
        if !any {
            return None;
        }
        if cand != self.published_stage {
            let next = ladder.next_fidelity_toward(self.published_stage, cand);
            if ladder.same_fidelity(next, self.published_stage) {
                self.published_stage = next; // FPS-only: no native change, no dwell
            } else if now.saturating_duration_since(self.published_at) >= CAPTURE_DWELL {
                self.published_stage = next;
                self.published_at = now;
            }
        }
        Some(TargetDecision {
            fidelity_stage: self.published_stage,
            fps,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ceilings() -> CaptureCeilings {
        CaptureCeilings::new(24, 75, 1920, 1080)
    }

    fn ok_sample(progress: u64) -> ViewerSample {
        ViewerSample {
            provenance: SampleProvenance::Busy,
            ack_starved: false,
            service_ewma_ms: Some(60.0),
            baseline_ms: Some(50.0),
            outstanding_frames: 1,
            oldest_age_ms: 60,
            has_pending: false,
            decode_ms_ewma: Some(5.0),
            frame_bytes_ewma: Some(30_000.0),
            audio_kbps_ewma: 0.0,
            delivered_kbps_ewma: Some(20_000.0),
            progress_counter: progress,
            motion_counter: progress,
        }
    }
    fn pressured(progress: u64) -> ViewerSample {
        ViewerSample {
            service_ewma_ms: Some(700.0),
            has_pending: true,
            outstanding_frames: 2,
            oldest_age_ms: 700,
            ..ok_sample(progress)
        }
    }

    struct Sim {
        ctrl: AdaptiveStreamController,
        now: Instant,
        progress: u64,
    }
    impl Sim {
        fn new() -> Self {
            let now = Instant::now();
            Self {
                ctrl: AdaptiveStreamController::new_at(ceilings(), now),
                now,
                progress: 0,
            }
        }
        /// One second: every `(sub, visible, sample-kind)` reports, then evaluate.
        fn second(
            &mut self,
            feeds: &[(&str, bool, fn(u64) -> ViewerSample)],
        ) -> Option<TargetDecision> {
            self.now += Duration::from_secs(1);
            self.progress += 1000;
            for (sub, vis, f) in feeds {
                self.ctrl.report(sub, *vis, f(self.progress), self.now);
            }
            self.ctrl.evaluate(self.now)
        }
        fn run(
            &mut self,
            secs: u32,
            feeds: &[(&str, bool, fn(u64) -> ViewerSample)],
        ) -> Option<TargetDecision> {
            let mut last = None;
            for _ in 0..secs {
                last = self.second(feeds);
            }
            last
        }
    }

    #[test]
    fn new_viewer_warms_at_medium() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        let medium = sim.ctrl.ladder().anchor(CaptureTier::Medium);
        assert_eq!(sim.ctrl.viewer_stage("a"), Some(medium));
        let d = sim.ctrl.directives("a", sim.now).unwrap();
        assert_eq!(d.tier, CaptureTier::Medium);
        assert_eq!(d.min_delivery_interval, Duration::from_millis(100));
        assert_eq!(d.audio, AudioGate::Suppressed(AudioSuppression::Muted));
        assert!(sim.ctrl.set_muted("a", false, sim.now));
        let d = sim.ctrl.directives("a", sim.now).unwrap();
        assert!(d.audio.is_allowed());
    }

    #[test]
    fn unequal_viewers_share_minimum_fidelity_with_independent_pacing() {
        let mut sim = Sim::new();
        sim.ctrl.register("fast", sim.now);
        sim.ctrl.register("slow", sim.now);
        let feeds: [(&str, bool, fn(u64) -> ViewerSample); 2] =
            [("fast", true, ok_sample), ("slow", true, pressured)];
        let d = sim.run(40, &feeds).unwrap();
        let (fast, slow) = (
            sim.ctrl.viewer_stage("fast").unwrap(),
            sim.ctrl.viewer_stage("slow").unwrap(),
        );
        assert!(slow > fast, "slow viewer degrades further");
        assert_eq!(d.fidelity_stage, sim.ctrl.published_stage());
        assert!(
            sim.ctrl.published_stage() >= slow.saturating_sub(1)
                && sim.ctrl.published_stage() > fast
        );
        let (df, ds) = (
            sim.ctrl.directives("fast", sim.now).unwrap(),
            sim.ctrl.directives("slow", sim.now).unwrap(),
        );
        assert!(
            df.min_delivery_interval < ds.min_delivery_interval,
            "fast viewer keeps its own cadence"
        );
        assert_eq!(
            d.fps,
            sim.ctrl.ladder().stage(fast).fps,
            "producer cadence follows the fastest eligible viewer"
        );
    }

    #[test]
    fn single_pressured_window_does_not_downshift_and_two_do() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        let medium = sim.ctrl.ladder().anchor(CaptureTier::Medium);
        sim.second(&[("a", true, pressured)]);
        assert_eq!(sim.ctrl.viewer_stage("a"), Some(medium));
        sim.second(&[("a", true, ok_sample)]);
        sim.second(&[("a", true, pressured)]);
        assert_eq!(
            sim.ctrl.viewer_stage("a"),
            Some(medium),
            "non-consecutive pressure resets"
        );
        sim.second(&[("a", true, pressured)]);
        assert_eq!(sim.ctrl.viewer_stage("a"), Some(medium + 1));
    }

    #[test]
    fn idle_and_fixed_rtt_never_reduce_fidelity() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        let medium = sim.ctrl.ladder().anchor(CaptureTier::Medium);
        let idle: fn(u64) -> ViewerSample = |p| ViewerSample {
            provenance: SampleProvenance::Idle,
            ..pressured(p)
        };
        let limited: fn(u64) -> ViewerSample = |p| ViewerSample {
            provenance: SampleProvenance::ApplicationLimited,
            motion_counter: 0,
            ..pressured(p)
        };
        let fixed_rtt: fn(u64) -> ViewerSample = |p| ViewerSample {
            service_ewma_ms: Some(900.0),
            baseline_ms: Some(900.0),
            has_pending: true,
            outstanding_frames: 2,
            ..ok_sample(p)
        };
        for f in [idle, limited] {
            sim.run(30, &[("a", true, f)]);
            assert_eq!(
                sim.ctrl.viewer_stage("a"),
                Some(medium),
                "frozen sample must not infer capacity"
            );
        }
        sim.run(30, &[("a", true, fixed_rtt)]);
        assert!(
            sim.ctrl.viewer_stage("a").unwrap() <= medium,
            "fixed high RTT alone never reduces fidelity"
        );
    }

    #[test]
    fn decoder_overload_reaches_the_pacing_floor_without_touching_fidelity_and_recovers() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        let slow_decode: fn(u64) -> ViewerSample = |p| ViewerSample {
            decode_ms_ewma: Some(5000.0),
            ..ok_sample(p)
        };
        sim.run(120, &[("a", true, slow_decode)]);
        let l = sim.ctrl.ladder().clone();
        let stage = sim.ctrl.viewer_stage("a").unwrap();
        let medium = l.anchor(CaptureTier::Medium);
        assert!(
            l.same_fidelity(stage, medium),
            "decoder pressure must not lower quality or resolution"
        );
        let d = sim.ctrl.directives("a", sim.now).unwrap();
        assert_eq!(
            d.min_delivery_interval,
            Duration::from_millis(500),
            "sustained decoder overload reaches the ladder's lowest pacing"
        );
        // Healthy decode restores pacing one candidate at a time, before any fidelity upgrade.
        sim.run(200, &[("a", true, ok_sample)]);
        let d = sim.ctrl.directives("a", sim.now).unwrap();
        assert!(
            d.min_delivery_interval <= Duration::from_millis(167),
            "pacing cap lifted"
        );
    }

    #[test]
    fn recovery_needs_healthy_seconds_and_dwell_and_reverses_order() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        let last = sim.ctrl.ladder().len() - 1;
        sim.run(120, &[("a", true, pressured)]);
        assert_eq!(
            sim.ctrl.viewer_stage("a"),
            Some(last),
            "bounded at the lowest rung"
        );
        sim.run(9, &[("a", true, ok_sample)]);
        assert_eq!(
            sim.ctrl.viewer_stage("a"),
            Some(last),
            "fewer than 10 healthy seconds"
        );
        // Backoff from nothing (no recent upgrade): first recovery after 10 healthy windows.
        sim.run(2, &[("a", true, ok_sample)]);
        let s1 = sim.ctrl.viewer_stage("a").unwrap();
        assert_eq!(s1, last - 1);
        let (a, b) = (sim.ctrl.ladder().stage(last), sim.ctrl.ladder().stage(s1));
        assert!(
            b.scale_permille > a.scale_permille,
            "resolution recovers first"
        );
        sim.run(60, &[("a", true, ok_sample)]);
        assert!(sim.ctrl.viewer_stage("a").unwrap() < s1);
    }

    #[test]
    fn failed_probe_backs_off_recovery() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        sim.run(60, &[("a", true, pressured)]);
        sim.run(12, &[("a", true, ok_sample)]);
        let before = sim.ctrl.viewers["a"].recovery_required;
        sim.run(3, &[("a", true, pressured)]);
        assert!(
            sim.ctrl.viewers["a"].recovery_required > before,
            "pressure soon after an upgrade doubles the healthy requirement"
        );
        assert!(sim.ctrl.viewers["a"].recovery_required <= MAX_RECOVERY_WINDOWS);
    }

    #[test]
    fn headroom_blocks_unaffordable_upgrade() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        sim.run(60, &[("a", true, pressured)]);
        let last = sim.ctrl.viewer_stage("a").unwrap();
        // Busy, healthy, but measured goodput leaves no 25% headroom for the next demand.
        let tight: fn(u64) -> ViewerSample = |p| ViewerSample {
            delivered_kbps_ewma: Some(1.0),
            ..ok_sample(p)
        };
        sim.run(40, &[("a", true, tight)]);
        assert_eq!(sim.ctrl.viewer_stage("a"), Some(last));
    }

    #[test]
    fn hidden_viewer_stops_voting_and_returns_through_normal_windows() {
        let mut sim = Sim::new();
        sim.ctrl.register("fast", sim.now);
        sim.ctrl.register("slow", sim.now);
        sim.run(40, &[("fast", true, ok_sample), ("slow", true, pressured)]);
        let depressed = sim.ctrl.published_stage();
        assert!(depressed > sim.ctrl.viewer_stage("fast").unwrap());
        sim.ctrl.report("slow", false, pressured(1), sim.now);
        assert!(!sim
            .ctrl
            .directives("slow", sim.now)
            .unwrap()
            .audio
            .is_allowed());
        sim.run(60, &[("fast", true, ok_sample), ("slow", false, pressured)]);
        let fast = sim.ctrl.viewer_stage("fast").unwrap();
        assert_eq!(
            sim.ctrl.published_stage(),
            fast,
            "hidden viewer no longer pins the minimum"
        );
    }

    #[test]
    fn removal_recovers_shared_fidelity_one_knob_per_dwell() {
        let mut sim = Sim::new();
        sim.ctrl.register("fast", sim.now);
        sim.ctrl.register("slow", sim.now);
        sim.run(60, &[("fast", true, ok_sample), ("slow", true, pressured)]);
        let before = sim.ctrl.published_stage();
        sim.ctrl.remove("slow");
        let target = sim.ctrl.viewer_stage("fast").unwrap();
        assert!(before > target);
        sim.second(&[("fast", true, ok_sample)]);
        let after_one = sim.ctrl.published_stage();
        assert!(
            after_one >= before.saturating_sub(1),
            "no instant jump back to the healthy viewer's fidelity"
        );
        sim.run(60, &[("fast", true, ok_sample)]);
        assert_eq!(
            sim.ctrl.published_stage(),
            sim.ctrl.viewer_stage("fast").unwrap()
        );
    }

    #[test]
    fn stalled_viewer_is_excluded_suspended_and_resumes_after_warmup() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        sim.ctrl.register("b", sim.now);
        assert!(sim.ctrl.set_muted("b", false, sim.now));
        let frozen_progress: fn(u64) -> ViewerSample = |_| ViewerSample {
            progress_counter: 1,
            outstanding_frames: 2,
            has_pending: true,
            ..ok_sample(0)
        };
        sim.run(2, &[("a", true, ok_sample), ("b", true, frozen_progress)]);
        assert!(!sim.ctrl.is_stalled("b"));
        sim.run(6, &[("a", true, ok_sample), ("b", true, frozen_progress)]);
        assert!(
            sim.ctrl.is_stalled("b"),
            "no credit progress for the stall threshold"
        );
        let d = sim.ctrl.directives("b", sim.now).unwrap();
        assert!(d.send_suspended);
        assert_eq!(d.audio, AudioGate::Suppressed(AudioSuppression::Stalled));
        let dec = sim.ctrl.evaluate(sim.now).unwrap();
        assert!(
            dec.fidelity_stage
                <= sim
                    .ctrl
                    .viewer_stage("a")
                    .unwrap()
                    .max(sim.ctrl.published_stage())
        );
        // Progress resumes: not stalled, but warming (non-voting) for WARMUP_WINDOWS windows.
        sim.second(&[("a", true, ok_sample), ("b", true, ok_sample)]);
        assert!(!sim.ctrl.is_stalled("b"));
        assert!(!sim.ctrl.viewers["b"].eligible(sim.now));
        sim.run(
            WARMUP_WINDOWS,
            &[("a", true, ok_sample), ("b", true, ok_sample)],
        );
        assert!(sim.ctrl.viewers["b"].eligible(sim.now));
    }

    #[test]
    fn expired_viewer_stops_voting() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        sim.ctrl.register("gone", sim.now);
        sim.run(40, &[("a", true, ok_sample), ("gone", true, pressured)]);
        let slow = sim.ctrl.viewer_stage("gone").unwrap();
        assert!(slow > sim.ctrl.viewer_stage("a").unwrap());
        sim.run(
            (REPORT_EXPIRY.as_secs() + 2) as u32,
            &[("a", true, ok_sample)],
        );
        assert!(!sim.ctrl.viewers["gone"].eligible(sim.now));
    }

    #[test]
    fn stale_subscription_feedback_is_ignored() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        sim.ctrl.remove("a");
        assert!(sim.ctrl.report("a", true, pressured(1), sim.now).is_none());
        assert!(sim.ctrl.viewer_stage("a").is_none());
        assert!(!sim.ctrl.set_muted("a", true, sim.now));
        assert!(!sim
            .ctrl
            .set_preference("a", QualityPreference::Low, sim.now));
    }

    #[test]
    fn preferences_cap_requested_fidelity_but_congestion_still_applies() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        assert!(sim.ctrl.set_muted("a", false, sim.now));
        let l = sim.ctrl.ladder().clone();
        assert!(sim
            .ctrl
            .set_preference("a", QualityPreference::Low, sim.now));
        assert_eq!(sim.ctrl.viewer_stage("a"), Some(l.anchor(CaptureTier::Low)));
        sim.run(120, &[("a", true, ok_sample)]);
        assert_eq!(
            sim.ctrl.viewer_stage("a"),
            Some(l.anchor(CaptureTier::Low)),
            "Low never recovers above its cap"
        );
        sim.run(120, &[("a", true, pressured)]);
        assert_eq!(
            sim.ctrl.viewer_stage("a"),
            Some(l.len() - 1),
            "Low still permits Constrained under congestion"
        );
        assert_eq!(
            sim.ctrl.directives("a", sim.now).unwrap().audio,
            AudioGate::Suppressed(AudioSuppression::Constrained)
        );
    }

    #[test]
    fn mute_gates_audio_without_touching_fidelity() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        let stage = sim.ctrl.viewer_stage("a");
        assert_eq!(
            sim.ctrl.directives("a", sim.now).unwrap().audio,
            AudioGate::Suppressed(AudioSuppression::Muted)
        );
        assert_eq!(sim.ctrl.viewer_stage("a"), stage);
        assert!(sim.ctrl.set_muted("a", false, sim.now));
        assert!(sim
            .ctrl
            .directives("a", sim.now)
            .unwrap()
            .audio
            .is_allowed());
        assert!(sim.ctrl.set_muted("a", true, sim.now));
        assert_eq!(
            sim.ctrl.directives("a", sim.now).unwrap().audio,
            AudioGate::Suppressed(AudioSuppression::Muted)
        );
    }

    #[test]
    fn admin_ceilings_bound_every_directive() {
        let now = Instant::now();
        let mut c = AdaptiveStreamController::new_at(CaptureCeilings::new(5, 40, 1920, 1080), now);
        c.register("a", now);
        for i in 0..c.ladder().len() {
            assert!(c.ladder().stage(i).fps <= 5 && c.ladder().stage(i).jpeg_quality <= 40);
        }
        assert!(
            c.directives("a", now).unwrap().min_delivery_interval >= Duration::from_millis(200)
        );
    }

    #[test]
    fn severe_backlog_lowers_fps_without_waiting_for_dwell() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        let severe: fn(u64) -> ViewerSample = |p| ViewerSample {
            oldest_age_ms: 9000,
            ack_starved: false,
            ..pressured(p)
        };
        let medium = sim.ctrl.ladder().anchor(CaptureTier::Medium);
        sim.second(&[("a", true, severe)]);
        let s = sim.ctrl.viewer_stage("a").unwrap();
        assert_eq!(
            s,
            medium + 1,
            "FPS-only step bypasses the dwell on severe growth"
        );
        assert!(sim.ctrl.ladder().fps_only_step(medium, s));
        sim.second(&[("a", true, severe)]);
        assert_eq!(
            sim.ctrl.viewer_stage("a"),
            Some(s),
            "quality/scale steps still wait for dwell"
        );
    }

    #[test]
    fn newcomer_does_not_vote_on_an_established_stream_while_warming() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        sim.run(40, &[("a", true, ok_sample)]);
        assert_eq!(
            sim.ctrl.viewer_stage("a"),
            Some(0),
            "established viewer reached the top rung"
        );
        assert_eq!(sim.ctrl.published_stage(), 0);

        sim.ctrl.register("n", sim.now);
        assert!(
            !sim.ctrl.viewers["n"].eligible(sim.now),
            "newcomer is warming"
        );
        let d = sim
            .second(&[("a", true, ok_sample), ("n", true, ok_sample)])
            .unwrap();
        assert_eq!(
            d.fidelity_stage, 0,
            "an unmeasured newcomer cannot lower the established stream"
        );
        let d = sim
            .second(&[("a", true, ok_sample), ("n", true, ok_sample)])
            .unwrap();
        assert!(sim.ctrl.viewers["n"].eligible(sim.now));
        assert!(
            d.fidelity_stage > 0,
            "after warm-up the newcomer's Medium position votes"
        );
    }

    #[test]
    fn fixed_multi_second_rtt_ack_starvation_never_reduces_fidelity_but_real_starvation_does() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        let medium = sim.ctrl.ladder().anchor(CaptureTier::Medium);
        let fixed_rtt: fn(u64) -> ViewerSample = |p| ViewerSample {
            provenance: SampleProvenance::AckStarved,
            ack_starved: true,
            service_ewma_ms: Some(2000.0),
            baseline_ms: Some(2000.0),
            oldest_age_ms: 2100,
            outstanding_frames: 2,
            has_pending: true,
            ..ok_sample(p)
        };
        sim.run(40, &[("a", true, fixed_rtt)]);
        assert!(sim.ctrl.viewer_stage("a").unwrap() <= medium);

        let real: fn(u64) -> ViewerSample = |p| ViewerSample {
            provenance: SampleProvenance::AckStarved,
            ack_starved: true,
            baseline_ms: Some(50.0),
            service_ewma_ms: Some(50.0),
            oldest_age_ms: 9000,
            outstanding_frames: 2,
            has_pending: true,
            ..ok_sample(p)
        };
        sim.run(20, &[("a", true, real)]);
        assert!(
            sim.ctrl.viewer_stage("a").unwrap() > medium,
            "starvation far beyond a normal service degrades"
        );
    }

    #[test]
    fn quick_mute_unmute_bumps_the_gate_generation_and_unknown_subscriptions_have_none() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        let g0 = sim.ctrl.audio_generation("a").unwrap();
        assert!(sim.ctrl.set_muted("a", false, sim.now));
        assert!(sim.ctrl.set_muted("a", true, sim.now));
        let d = sim.ctrl.directives("a", sim.now).unwrap();
        assert_eq!(
            d.audio,
            AudioGate::Suppressed(AudioSuppression::Muted),
            "back to muted"
        );
        assert_eq!(
            d.audio_gen,
            g0 + 2,
            "both transitions are visible to queued-audio invalidation"
        );
        assert!(sim.ctrl.set_muted("a", true, sim.now));
        assert_eq!(
            sim.ctrl.audio_generation("a"),
            Some(g0 + 2),
            "no transition, no bump"
        );
        sim.ctrl.remove("a");
        assert_eq!(sim.ctrl.audio_generation("a"), None);
        assert!(sim.ctrl.directives("a", sim.now).is_none());
    }

    #[test]
    fn decode_inflated_ack_service_is_decoder_pressure_not_link_congestion() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        let medium = sim.ctrl.ladder().anchor(CaptureTier::Medium);
        // Realistic trace: the client needs 3s to decode, and ACK service includes that time.
        let slow_client: fn(u64) -> ViewerSample = |p| ViewerSample {
            service_ewma_ms: Some(3060.0),
            decode_ms_ewma: Some(3000.0),
            has_pending: true,
            outstanding_frames: 2,
            oldest_age_ms: 3100,
            ..ok_sample(p)
        };
        sim.run(120, &[("a", true, slow_client)]);
        let stage = sim.ctrl.viewer_stage("a").unwrap();
        assert!(
            sim.ctrl.ladder().same_fidelity(stage, medium),
            "decode-inflated service must not lower JPEG quality or resolution"
        );
        assert!(
            sim.ctrl
                .directives("a", sim.now)
                .unwrap()
                .min_delivery_interval
                > Duration::from_millis(100),
            "decoder overload paces FPS down instead"
        );
    }

    #[test]
    fn completion_free_windows_caused_by_a_slow_decoder_are_not_ack_starvation() {
        let mut sim = Sim::new();
        sim.ctrl.register("a", sim.now);
        let medium = sim.ctrl.ladder().anchor(CaptureTier::Medium);
        // Estimator view of a 3s decoder: whole windows without a completion (ack_starved) whose
        // oldest outstanding age exceeds the bare-link threshold but not link + decode time.
        let slow_decoder_gap: fn(u64) -> ViewerSample = |p| ViewerSample {
            provenance: SampleProvenance::AckStarved,
            ack_starved: true,
            baseline_ms: Some(50.0),
            service_ewma_ms: Some(50.0),
            decode_ms_ewma: Some(3000.0),
            oldest_age_ms: 3100,
            outstanding_frames: 2,
            has_pending: true,
            ..ok_sample(p)
        };
        sim.run(120, &[("a", true, slow_decoder_gap)]);
        let stage = sim.ctrl.viewer_stage("a").unwrap();
        assert!(
            sim.ctrl.ladder().same_fidelity(stage, medium),
            "decoder-caused completion gaps must not lower JPEG quality or resolution"
        );
    }

    #[test]
    fn gate_transition_records_admission_watermark() {
        let now = Instant::now();
        let mut ctrl = AdaptiveStreamController::new_at(ceilings(), now);
        ctrl.register_with_seq("a", now, None, 10);
        let info0 = ctrl.audio_gate_info("a", now, None, 10).unwrap();
        assert_eq!(info0.0, AudioGate::Suppressed(AudioSuppression::Muted));
        assert_eq!(info0.1, 0); // gen 0
        assert_eq!(info0.2.seq, 10); // initial watermark 10

        // Unmute at audio sequence 42 -> closed->open transition: watermark set to 42, gen 1
        assert!(ctrl.set_muted_with_seq("a", false, now, None, 42));
        let info1 = ctrl.audio_gate_info("a", now, None, 42).unwrap();
        assert_eq!(info1.0, AudioGate::Allowed);
        assert_eq!(info1.1, 1);
        assert_eq!(info1.2.seq, 42);

        // Mute at audio sequence 50 -> open->closed transition: gen 2, watermark stays 42
        assert!(ctrl.set_muted_with_seq("a", true, now, None, 50));
        let info2 = ctrl.audio_gate_info("a", now, None, 50).unwrap();
        assert_eq!(info2.0, AudioGate::Suppressed(AudioSuppression::Muted));
        assert_eq!(info2.1, 2);
        assert_eq!(info2.2.seq, 42);

        // Reopen at audio sequence 99 -> closed->open transition: watermark updated to 99, gen 3
        assert!(ctrl.set_muted_with_seq("a", false, now, None, 99));
        let info3 = ctrl.audio_gate_info("a", now, None, 99).unwrap();
        assert_eq!(info3.0, AudioGate::Allowed);
        assert_eq!(info3.1, 3);
        assert_eq!(info3.2.seq, 99);
    }

    #[test]
    fn expiry_recovery_bumps_generation_and_records_watermark() {
        let now = Instant::now();
        let mut ctrl = AdaptiveStreamController::new_at(ceilings(), now);
        ctrl.register_with_seq("a", now, None, 10);
        // Step 1: Reach allowed gen 3 with watermark 99
        assert!(ctrl.set_muted_with_seq("a", false, now, None, 42)); // gen 1
        assert!(ctrl.set_muted_with_seq("a", true, now, None, 50));  // gen 2
        assert!(ctrl.set_muted_with_seq("a", false, now, None, 99)); // gen 3, wm 99
        let info = ctrl.audio_gate_info("a", now, None, 99).unwrap();
        assert_eq!(info.0, AudioGate::Allowed);
        assert_eq!(info.1, 3);
        assert_eq!(info.2.seq, 99);

        // Step 2: Time advances past REPORT_EXPIRY -> read-time expiry returns Hidden
        let expired_time = now + REPORT_EXPIRY + Duration::from_secs(1);
        let gate_expired = ctrl.audio_gate_info_readonly("a", expired_time).unwrap();
        assert_eq!(gate_expired.0, AudioGate::Suppressed(AudioSuppression::Hidden));

        // Step 3: Report with latest audio seq 200 recovering from expiry
        let s = ok_sample(100);
        let directives = ctrl
            .report_with_seq("a", true, s, expired_time, None, 200)
            .expect("report");
        assert_eq!(directives.audio, AudioGate::Allowed);
        // Expiry suppressed the gate (bumping gen to 4), and recovery reopened it (bumping gen to 5)
        assert!(
            directives.audio_gen > 3,
            "gate_gen must bump past 3 on recovery from expiry, got {}",
            directives.audio_gen
        );
        assert_eq!(
            directives.admission_watermark.seq, 200,
            "watermark must be updated to latest audio seq 200"
        );
    }

    #[test]
    fn source_scoped_watermark_ignores_different_source_run() {
        let run_a = Uuid::new_v4();
        let run_b = Uuid::new_v4();
        let wm = AudioWatermark::new(Some(run_a), 500);

        // Same run: chunks <= 500 are suppressed, > 500 are admitted
        assert!(wm.suppresses(Some(run_a), 1));
        assert!(wm.suppresses(Some(run_a), 500));
        assert!(!wm.suppresses(Some(run_a), 501));

        // Different run: source restarted, chunks <= 500 are NOT suppressed
        assert!(!wm.suppresses(Some(run_b), 1));
        assert!(!wm.suppresses(Some(run_b), 500));
        assert!(!wm.suppresses(Some(run_b), 501));

        // Source-agnostic watermark (source_run: None) suppresses any matching seq
        let wm_none = AudioWatermark::new(None, 500);
        assert!(wm_none.suppresses(Some(run_a), 100));
        assert!(!wm_none.suppresses(Some(run_a), 501));
    }
}
