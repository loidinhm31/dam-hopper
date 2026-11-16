//! Versioned shared capture-tier snapshot, staged quality ladder and CDP parameter builder.
//!
//! One validated `CaptureTierSnapshot` is shared (via `Arc` + `watch`) by every producer handle.
//! Tier values are calibration targets, never measured network classes; the admin
//! `CaptureCeilings` remain a hard upper bound on every proposal.
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chromiumoxide_cdp::cdp::browser_protocol::page::{
    StartScreencastFormat, StartScreencastParams,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use super::protocol::{MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH};

/// Internal image-fidelity tiers, best to worst.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptureTier {
    High,
    Medium,
    Low,
    Constrained,
}

/// Viewer-selected cap on requested fidelity. Never disables congestion safety or admin caps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QualityPreference {
    Auto,
    High,
    Medium,
    Low,
}

/// Admin ceilings: no stage, measurement or preference may exceed them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaptureCeilings {
    pub fps: u32,
    pub jpeg_quality: u8,
    pub max_width: u32,
    pub max_height: u32,
}

impl CaptureCeilings {
    pub fn new(fps: u32, jpeg_quality: u8, max_width: u32, max_height: u32) -> Self {
        Self {
            fps: fps.clamp(1, 30),
            jpeg_quality: jpeg_quality.clamp(10, 100),
            max_width: max_width.clamp(64, MAX_IMAGE_WIDTH),
            max_height: max_height.clamp(64, MAX_IMAGE_HEIGHT),
        }
    }
}

/// One rung of the degradation ladder; FPS is reduced first, then quality, then resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stage {
    pub fps: u32,
    pub jpeg_quality: u8,
    pub scale_permille: u16,
}

/// (fps, jpeg quality, scale) — initial calibration targets.
const STAGE_TABLE: [(u32, u8, u16); 9] = [
    (20, 80, 1000),
    (10, 80, 1000),
    (10, 65, 1000),
    (6, 65, 1000),
    (6, 60, 1000),
    (6, 60, 750),
    (2, 60, 750),
    (2, 55, 750),
    (2, 55, 500),
];
/// Table index of each tier's anchor stage: High, Medium, Low, Constrained.
const ANCHOR_IDX: [usize; 4] = [0, 2, 5, 8];
const TIERS: [CaptureTier; 4] = [
    CaptureTier::High,
    CaptureTier::Medium,
    CaptureTier::Low,
    CaptureTier::Constrained,
];

/// Stage table clamped to admin ceilings with no-op neighbours merged.
#[derive(Debug, Clone)]
pub struct Ladder {
    stages: Vec<Stage>,
    anchors: [usize; 4],
}

impl Ladder {
    pub fn new(c: &CaptureCeilings) -> Self {
        let mut stages: Vec<Stage> = Vec::with_capacity(STAGE_TABLE.len());
        let mut map = [0usize; STAGE_TABLE.len()];
        for (i, &(fps, q, scale)) in STAGE_TABLE.iter().enumerate() {
            let s = Stage {
                fps: fps.min(c.fps).max(1),
                jpeg_quality: q.min(c.jpeg_quality).max(10),
                scale_permille: scale,
            };
            if stages.last() != Some(&s) {
                stages.push(s);
            }
            map[i] = stages.len() - 1;
        }
        Self {
            stages,
            anchors: ANCHOR_IDX.map(|a| map[a]),
        }
    }
    pub fn len(&self) -> usize {
        self.stages.len()
    }
    pub fn is_empty(&self) -> bool {
        self.stages.is_empty()
    }
    pub fn stage(&self, i: usize) -> Stage {
        self.stages[i.min(self.stages.len() - 1)]
    }
    pub fn anchor(&self, tier: CaptureTier) -> usize {
        self.anchors[tier as usize]
    }
    pub fn is_anchor(&self, i: usize) -> bool {
        self.anchors.contains(&i)
    }
    /// Tier a stage is heading toward (best tier whose anchor is at or below the stage).
    pub fn tier_of(&self, i: usize) -> CaptureTier {
        TIERS
            .iter()
            .zip(self.anchors)
            .find(|(_, a)| *a >= i)
            .map_or(CaptureTier::Constrained, |(t, _)| *t)
    }
    /// Best stage a preference may request. Low still permits Constrained under congestion.
    pub fn floor_stage(&self, pref: QualityPreference) -> usize {
        match pref {
            QualityPreference::Auto | QualityPreference::High => self.anchor(CaptureTier::High),
            QualityPreference::Medium => self.anchor(CaptureTier::Medium),
            QualityPreference::Low => self.anchor(CaptureTier::Low),
        }
    }
    /// Stage a viewer starts at: Auto warms at Medium until measured.
    pub fn initial_stage(&self, pref: QualityPreference) -> usize {
        match pref {
            QualityPreference::Auto => self.anchor(CaptureTier::Medium),
            p => self.floor_stage(p),
        }
    }
    pub fn same_fidelity(&self, a: usize, b: usize) -> bool {
        let (a, b) = (self.stage(a), self.stage(b));
        a.jpeg_quality == b.jpeg_quality && a.scale_permille == b.scale_permille
    }
    /// Step moves FPS only (no native image change).
    pub fn fps_only_step(&self, a: usize, b: usize) -> bool {
        self.same_fidelity(a, b)
    }
    /// Highest ladder FPS candidate strictly below `fps` (decoder pacing floor is the ladder minimum).
    pub fn lower_fps(&self, fps: u32) -> Option<u32> {
        self.stages.iter().map(|s| s.fps).filter(|f| *f < fps).max()
    }
    /// Lowest ladder FPS candidate strictly above `fps`.
    pub fn higher_fps(&self, fps: u32) -> Option<u32> {
        self.stages.iter().map(|s| s.fps).filter(|f| *f > fps).min()
    }
    /// Next stop from `from` toward `to`: the first stage whose quality/scale differs or `to`.
    pub fn next_fidelity_toward(&self, from: usize, to: usize) -> usize {
        if from == to {
            return from;
        }
        let mut i = from;
        while i != to {
            i = if to > i { i + 1 } else { i - 1 };
            if i == to || !self.same_fidelity(i, from) {
                break;
            }
        }
        i
    }
}

/// Validated, versioned capture parameters shared by every producer handle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureTierSnapshot {
    pub version: u64,
    pub tier: CaptureTier,
    /// True while moving between tier anchors (one knob at a time).
    pub transitioning: bool,
    pub fps: u32,
    pub jpeg_quality: u8,
    pub scale_permille: u16,
}

impl CaptureTierSnapshot {
    pub fn governor_interval(&self) -> Duration {
        Duration::from_secs_f64(1.0 / f64::from(self.fps.max(1)))
    }
    /// Native Page.startScreencast knobs (FPS is governor-only).
    pub fn native_key(&self) -> (u8, u16) {
        (self.jpeg_quality, self.scale_permille)
    }
    pub fn validate(&self, c: &CaptureCeilings) -> Result<(), String> {
        if self.fps == 0 || self.fps > c.fps {
            return Err(format!("fps {} outside 1..={}", self.fps, c.fps));
        }
        if self.jpeg_quality < 10 || self.jpeg_quality > c.jpeg_quality {
            return Err(format!(
                "jpeg quality {} outside 10..={}",
                self.jpeg_quality, c.jpeg_quality
            ));
        }
        if !(500..=1000).contains(&self.scale_permille) {
            return Err(format!("scale {} outside 500..=1000", self.scale_permille));
        }
        Ok(())
    }
    /// Aspect-preserving image bounds: CSS size (or admin bound) scaled by the tier; never upscaled.
    pub fn image_bounds(&self, c: &CaptureCeilings, css_w: f64, css_h: f64) -> (u32, u32) {
        let axis = |css: f64, cap: u32| {
            let base = (css.round() as u32).clamp(64, cap);
            ((u64::from(base) * u64::from(self.scale_permille) + 500) / 1000)
                .clamp(64, u64::from(base)) as u32
        };
        (
            axis(css_w, c.max_width.min(MAX_IMAGE_WIDTH)),
            axis(css_h, c.max_height.min(MAX_IMAGE_HEIGHT)),
        )
    }
}

/// Single `Page.startScreencast` parameter builder (explicit JPEG, `everyNthFrame=1`).
pub fn build_start_params(
    snap: &CaptureTierSnapshot,
    c: &CaptureCeilings,
    css_w: f64,
    css_h: f64,
) -> StartScreencastParams {
    let (w, h) = snap.image_bounds(c, css_w, css_h);
    StartScreencastParams::builder()
        .format(StartScreencastFormat::Jpeg)
        .quality(i64::from(snap.jpeg_quality))
        .max_width(w)
        .max_height(h)
        .every_nth_frame(1)
        .build()
}

/// Shared state: ceilings, ladder, latest snapshot, last snapshot proven by a native frame.
pub struct CaptureTierState {
    ceilings: CaptureCeilings,
    ladder: Ladder,
    tx: watch::Sender<Arc<CaptureTierSnapshot>>,
    effective: Mutex<Option<Arc<CaptureTierSnapshot>>>,
    effective_version: AtomicU64,
    effective_fps: AtomicU32,
    downscale_input_qualified: AtomicBool,
}

impl CaptureTierState {
    pub fn new(ceilings: CaptureCeilings) -> Self {
        let ladder = Ladder::new(&ceilings);
        let (tier, st) = (
            ladder.tier_of(ladder.anchor(CaptureTier::Medium)),
            ladder.stage(ladder.anchor(CaptureTier::Medium)),
        );
        let first = Arc::new(CaptureTierSnapshot {
            version: 1,
            tier,
            transitioning: false,
            fps: st.fps,
            jpeg_quality: st.jpeg_quality,
            scale_permille: st.scale_permille,
        });
        let (tx, _) = watch::channel(first);
        Self {
            ceilings,
            ladder,
            tx,
            effective: Mutex::new(None),
            effective_version: AtomicU64::new(0),
            effective_fps: AtomicU32::new(0),
            downscale_input_qualified: AtomicBool::new(false),
        }
    }
    pub fn ceilings(&self) -> &CaptureCeilings {
        &self.ceilings
    }
    pub fn ladder(&self) -> &Ladder {
        &self.ladder
    }
    pub fn current(&self) -> Arc<CaptureTierSnapshot> {
        self.tx.borrow().clone()
    }
    pub fn subscribe(&self) -> watch::Receiver<Arc<CaptureTierSnapshot>> {
        self.tx.subscribe()
    }

    /// Publish a snapshot for `stage` quality/scale at `fps`. Returns the new snapshot only when
    /// something changed; versions are monotonic and never wrap.
    pub fn publish(&self, stage: usize, fps: u32) -> Option<Arc<CaptureTierSnapshot>> {
        let stage = stage.min(self.ladder.len() - 1);
        let st = self.ladder.stage(stage);
        self.publish_params(
            self.ladder.tier_of(stage),
            !self.ladder.is_anchor(stage),
            fps,
            st.jpeg_quality,
            st.scale_permille,
        )
    }

    fn publish_params(
        &self,
        tier: CaptureTier,
        transitioning: bool,
        fps: u32,
        q: u8,
        scale: u16,
    ) -> Option<Arc<CaptureTierSnapshot>> {
        let fps = fps.clamp(1, self.ceilings.fps);
        let mut published = None;
        self.tx.send_if_modified(|cur| {
            if (
                cur.tier,
                cur.transitioning,
                cur.fps,
                cur.jpeg_quality,
                cur.scale_permille,
            ) == (tier, transitioning, fps, q, scale)
            {
                return false;
            }
            let Some(version) = cur.version.checked_add(1) else {
                return false;
            };
            let next = Arc::new(CaptureTierSnapshot {
                version,
                tier,
                transitioning,
                fps,
                jpeg_quality: q,
                scale_permille: scale,
            });
            if next.validate(&self.ceilings).is_err() {
                return false;
            }
            published = Some(next.clone());
            *cur = next;
            true
        });
        published
    }

    /// Record `snap` as proven effective (a current-run native frame matched it).
    pub fn mark_effective(&self, snap: &Arc<CaptureTierSnapshot>) {
        self.mark_effective_applied(snap, snap.fps);
    }

    /// Record `native` (the live run's quality/scale) combined with the cadence `fps` the governor
    /// actually applies; FPS-only updates therefore become effective without a native restart.
    pub fn mark_effective_applied(&self, native: &Arc<CaptureTierSnapshot>, fps: u32) {
        let fps = fps.clamp(1, self.ceilings.fps);
        let known = self.effective_version.load(Ordering::Acquire);
        if native.version < known
            || (native.version == known && self.effective_fps.load(Ordering::Acquire) == fps)
        {
            return;
        }
        let mut e = self.effective.lock();
        let newer = |x: &Arc<CaptureTierSnapshot>| {
            x.version < native.version || (x.version == native.version && x.fps != fps)
        };
        if e.as_ref().is_none_or(newer) {
            let applied = if native.fps == fps {
                native.clone()
            } else {
                Arc::new(CaptureTierSnapshot {
                    fps,
                    ..(**native).clone()
                })
            };
            self.effective_version
                .store(applied.version, Ordering::Release);
            self.effective_fps.store(applied.fps, Ordering::Release);
            *e = Some(applied);
        }
    }
    pub fn effective(&self) -> Option<Arc<CaptureTierSnapshot>> {
        self.effective.lock().clone()
    }

    /// Re-publish the last proven parameters after a failed switch; never advertises unapplied settings.
    pub fn revert_to_effective(&self) -> Option<Arc<CaptureTierSnapshot>> {
        let eff = self.effective()?;
        self.publish_params(
            eff.tier,
            eff.transitioning,
            eff.fps,
            eff.jpeg_quality,
            eff.scale_permille,
        )
        .or_else(|| Some(self.current()))
    }

    /// Downscaled frames stay input-untrusted until the deployed-engine oracle passes.
    pub fn input_trusted_for(&self, snap: &CaptureTierSnapshot) -> bool {
        snap.scale_permille >= 1000 || self.downscale_input_qualified.load(Ordering::Acquire)
    }
    pub fn downscale_input_qualified(&self) -> bool {
        self.downscale_input_qualified.load(Ordering::Acquire)
    }
    /// Evaluate runtime observations; qualification is set only if every invariant holds.
    pub fn qualify_downscale(
        &self,
        css_w: f64,
        css_h: f64,
        dpr: f64,
        obs: &[DownscaleObservation],
    ) -> Result<(), String> {
        let res = evaluate_downscale_oracle(css_w, css_h, dpr, obs);
        self.downscale_input_qualified
            .store(res.is_ok(), Ordering::Release);
        res
    }
}

/// One live observation at a given capture scale (DOM, metadata, JPEG SOF, normalized click marker).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DownscaleObservation {
    pub scale_permille: u16,
    pub dom_inner: (f64, f64),
    pub dom_dpr: f64,
    pub meta_css: (f64, f64),
    pub jpeg: (u32, u32),
    pub click_expected_uv: (f64, f64),
    pub click_observed_uv: (f64, f64),
}

/// Pure oracle: CSS geometry, DPR and normalized input mapping must stay invariant across 1x/0.75x/0.5x.
pub fn evaluate_downscale_oracle(
    css_w: f64,
    css_h: f64,
    dpr: f64,
    obs: &[DownscaleObservation],
) -> Result<(), String> {
    for want in [1000u16, 750, 500] {
        let o = obs
            .iter()
            .find(|o| o.scale_permille == want)
            .ok_or_else(|| format!("missing observation for scale {want}"))?;
        let s = f64::from(want) / 1000.0;
        let close = |a: f64, b: f64, tol: f64| (a - b).abs() <= tol;
        if !close(o.dom_inner.0, css_w, 0.5) || !close(o.dom_inner.1, css_h, 0.5) {
            return Err(format!("scale {want}: DOM inner size changed"));
        }
        if !close(o.dom_dpr, dpr, 0.01) {
            return Err(format!("scale {want}: devicePixelRatio changed"));
        }
        if !close(o.meta_css.0, css_w, 0.5) || !close(o.meta_css.1, css_h, 0.5) {
            return Err(format!("scale {want}: metadata CSS size not invariant"));
        }
        if !close(f64::from(o.jpeg.0), css_w * s, 1.5)
            || !close(f64::from(o.jpeg.1), css_h * s, 1.5)
        {
            return Err(format!("scale {want}: JPEG size not scaled"));
        }
        if !close(o.click_observed_uv.0, o.click_expected_uv.0, 0.005)
            || !close(o.click_observed_uv.1, o.click_expected_uv.1, 0.005)
        {
            return Err(format!("scale {want}: normalized click mapping drifted"));
        }
    }
    Ok(())
}

/// Version protocol for everything a viewer-visible quality event is built from (current run,
/// proven frame, shared target, geometry, ceilings).
///
/// Every event-affecting mutation holds a [`QualityMutation`] around its commit: the guard marks a
/// writer in flight and, when dropped, publishes the next version. A reader accepts a snapshot only
/// if no writer was in flight and the version was identical before and after reading, so a torn
/// view (some inputs old, some new) can never be mistaken for a coherent one, and a mutation that
/// commits without a version bump is impossible by construction. Both halves live in one atomic.
#[derive(Debug)]
pub struct QualityRevision {
    /// `version << WRITER_BITS | writers_in_flight`.
    state: AtomicU64,
}

const WRITER_BITS: u32 = 16;
const WRITER_MASK: u64 = (1 << WRITER_BITS) - 1;

impl Default for QualityRevision {
    fn default() -> Self {
        Self::new()
    }
}

impl QualityRevision {
    pub const fn new() -> Self {
        Self {
            state: AtomicU64::new(1 << WRITER_BITS),
        }
    }

    /// Marks a mutation in flight; the version advances when the guard is dropped.
    pub fn begin(&self) -> QualityMutation<'_> {
        self.state.fetch_add(1, Ordering::AcqRel);
        QualityMutation {
            revision: self,
            publish: true,
        }
    }

    /// Advances the version for a mutation that has already fully committed.
    pub fn bump(&self) {
        drop(self.begin());
    }

    /// Current committed version (in-flight writers are not reflected until they finish).
    pub fn version(&self) -> u64 {
        self.state.load(Ordering::Acquire) >> WRITER_BITS
    }

    /// Version to read a snapshot under: `None` while a mutation is in flight.
    pub fn begin_read(&self) -> Option<u64> {
        let state = self.state.load(Ordering::Acquire);
        (state & WRITER_MASK == 0).then_some(state >> WRITER_BITS)
    }

    /// True when no mutation started or finished since `begin_read` returned `version`.
    pub fn validate_read(&self, version: u64) -> bool {
        self.state.load(Ordering::Acquire) == version << WRITER_BITS
    }
}

/// RAII marker for one in-flight event-affecting mutation (see [`QualityRevision`]).
#[derive(Debug)]
pub struct QualityMutation<'a> {
    revision: &'a QualityRevision,
    publish: bool,
}

impl QualityMutation<'_> {
    /// Ends the mutation without advancing the version: it turned out to change nothing.
    pub fn discard(mut self) {
        self.publish = false;
    }
}

impl Drop for QualityMutation<'_> {
    fn drop(&mut self) {
        let end = if self.publish {
            (1u64 << WRITER_BITS) - 1 // version + 1, writers - 1
        } else {
            u64::MAX // writers - 1 (wrapping add of -1)
        };
        self.revision.state.fetch_add(end, Ordering::AcqRel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ceilings() -> CaptureCeilings {
        CaptureCeilings::new(24, 75, 1920, 1080)
    }

    #[test]
    fn ladder_clamps_to_ceilings_and_merges_noops() {
        let l = Ladder::new(&ceilings());
        assert_eq!(
            l.stage(0),
            Stage {
                fps: 20,
                jpeg_quality: 75,
                scale_permille: 1000
            }
        );
        // stage 1 (10fps q80->75) differs from 0 by fps only; quality 80->75 merges stage 0/1 quality.
        assert!(l.len() <= STAGE_TABLE.len());
        for i in 0..l.len() {
            assert!(l.stage(i).jpeg_quality <= 75 && l.stage(i).fps <= 24);
        }
        let tiny = Ladder::new(&CaptureCeilings::new(2, 55, 64, 64));
        assert_eq!(
            tiny.len(),
            3,
            "only scale steps remain at the floor ceilings"
        );
        assert_eq!(tiny.anchor(CaptureTier::High), 0);
    }

    #[test]
    fn quality_revision_reads_are_coherent_only_without_overlapping_mutations() {
        let rev = QualityRevision::new();
        let v0 = rev.begin_read().expect("quiescent");
        assert!(rev.validate_read(v0));

        let m = rev.begin();
        assert_eq!(rev.begin_read(), None, "a mutation in flight forbids a coherent read");
        assert!(!rev.validate_read(v0), "a read started before the mutation is torn");
        assert_eq!(rev.version(), v0, "the version advances only when the mutation commits");
        drop(m);
        assert_eq!(rev.version(), v0 + 1);
        assert!(!rev.validate_read(v0), "a read that overlapped the mutation must be retried");
        let v1 = rev.begin_read().expect("quiescent again");
        assert_eq!(v1, v0 + 1);
        assert!(rev.validate_read(v1));
    }

    #[test]
    fn quality_revision_discarded_mutation_keeps_the_version_but_still_blocks_reads_while_in_flight() {
        let rev = QualityRevision::new();
        let v0 = rev.begin_read().unwrap();
        rev.begin().discard();
        assert_eq!(rev.version(), v0, "a no-op mutation must not bump (steady state stays quiet)");
        assert!(rev.validate_read(v0), "nothing changed, so a read of nothing is still valid");
        let (a, b) = (rev.begin(), rev.begin());
        assert_eq!(rev.begin_read(), None);
        drop(a);
        assert_eq!(rev.begin_read(), None, "still one writer in flight");
        b.discard();
        assert_eq!(rev.begin_read(), Some(v0 + 1));
        rev.bump();
        assert_eq!(rev.version(), v0 + 2);
    }

    #[test]
    fn staged_steps_change_one_knob() {
        let l = Ladder::new(&ceilings());
        for i in 1..l.len() {
            let (a, b) = (l.stage(i - 1), l.stage(i));
            let changed = u8::from(a.fps != b.fps)
                + u8::from(a.jpeg_quality != b.jpeg_quality)
                + u8::from(a.scale_permille != b.scale_permille);
            assert_eq!(changed, 1, "stage {i} must change exactly one knob");
            assert!(
                b.fps <= a.fps
                    && b.jpeg_quality <= a.jpeg_quality
                    && b.scale_permille <= a.scale_permille
            );
        }
    }

    #[test]
    fn next_fidelity_skips_fps_only_hops_and_stops_at_target() {
        let l = Ladder::new(&CaptureCeilings::new(30, 80, 1920, 1080));
        let medium = l.anchor(CaptureTier::Medium);
        let nxt = l.next_fidelity_toward(medium, l.anchor(CaptureTier::Constrained));
        assert!(!l.same_fidelity(medium, nxt) || nxt == l.anchor(CaptureTier::Constrained));
        assert_eq!(l.next_fidelity_toward(3, 3), 3);
    }

    #[test]
    fn publish_is_monotonic_validated_and_idempotent() {
        let st = CaptureTierState::new(ceilings());
        let v0 = st.current().version;
        assert!(
            st.publish(st.ladder().anchor(CaptureTier::Medium), 10)
                .is_none(),
            "unchanged content must not bump version"
        );
        let s1 = st.publish(st.ladder().len() - 1, 2).expect("changed");
        assert_eq!(s1.version, v0 + 1);
        assert_eq!(s1.tier, CaptureTier::Constrained);
        assert!(s1.validate(&ceilings()).is_ok());
        let over = CaptureTierSnapshot {
            fps: 25,
            ..(*s1).clone()
        };
        assert!(
            over.validate(&ceilings()).is_err(),
            "fps above admin ceiling rejected"
        );
        assert_eq!(
            st.publish(0, 999).unwrap().fps,
            24,
            "fps requests clamp to the admin ceiling"
        );
    }

    #[test]
    fn effective_only_advances_and_revert_restores_proven_params() {
        let st = CaptureTierState::new(ceilings());
        let proven = st.current();
        st.mark_effective(&proven);
        let degraded = st.publish(st.ladder().len() - 1, 2).unwrap();
        assert_eq!(
            st.effective().unwrap().version,
            proven.version,
            "unproven snapshot is never effective"
        );
        let rev = st.revert_to_effective().unwrap();
        assert_eq!(rev.native_key(), proven.native_key());
        assert!(rev.version > degraded.version);
    }

    #[test]
    fn bounds_scale_without_upscaling_and_keep_aspect() {
        let c = ceilings();
        let snap = |scale| CaptureTierSnapshot {
            version: 1,
            tier: CaptureTier::Low,
            transitioning: false,
            fps: 6,
            jpeg_quality: 60,
            scale_permille: scale,
        };
        assert_eq!(snap(1000).image_bounds(&c, 1280.0, 720.0), (1280, 720));
        assert_eq!(snap(750).image_bounds(&c, 1280.0, 720.0), (960, 540));
        assert_eq!(snap(500).image_bounds(&c, 1280.0, 720.0), (640, 360));
        assert_eq!(
            snap(1000).image_bounds(&CaptureCeilings::new(24, 75, 800, 600), 1280.0, 720.0),
            (800, 600),
            "admin bounds clamp"
        );
    }

    #[test]
    fn downscale_stays_input_untrusted_until_oracle_passes() {
        let st = CaptureTierState::new(ceilings());
        let low = st.publish(5, 6).unwrap();
        assert!(!st.input_trusted_for(&low));
        let obs = |s: u16, jw: u32, jh: u32| DownscaleObservation {
            scale_permille: s,
            dom_inner: (1280.0, 720.0),
            dom_dpr: 1.0,
            meta_css: (1280.0, 720.0),
            jpeg: (jw, jh),
            click_expected_uv: (0.25, 0.5),
            click_observed_uv: (0.25, 0.5),
        };
        let good = [obs(1000, 1280, 720), obs(750, 960, 540), obs(500, 640, 360)];
        let mut bad = good;
        bad[2].meta_css = (640.0, 360.0);
        assert!(st.qualify_downscale(1280.0, 720.0, 1.0, &bad).is_err());
        assert!(!st.input_trusted_for(&low));
        assert!(
            st.qualify_downscale(1280.0, 720.0, 1.0, &good[..2])
                .is_err(),
            "missing scale observation fails"
        );
        assert!(st.qualify_downscale(1280.0, 720.0, 1.0, &good).is_ok());
        assert!(st.input_trusted_for(&low));
    }

    #[test]
    fn effective_cadence_updates_without_a_native_restart_or_version_bump() {
        let st = CaptureTierState::new(ceilings());
        let native = st.current();
        st.mark_effective_applied(&native, native.fps);
        assert_eq!(st.effective().unwrap().fps, native.fps);
        st.mark_effective_applied(&native, 6);
        let eff = st.effective().unwrap();
        assert_eq!(
            (eff.version, eff.fps, eff.native_key()),
            (native.version, 6, native.native_key())
        );
        st.mark_effective_applied(&native, 6);
        assert_eq!(st.effective().unwrap().fps, 6, "idempotent");
        assert_eq!(st.current().fps, native.fps, "desired snapshot untouched");
        st.mark_effective_applied(&native, 999);
        assert_eq!(
            st.effective().unwrap().fps,
            24,
            "clamped to the admin ceiling"
        );
    }
}
