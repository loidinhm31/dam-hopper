use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chromiumoxide_cdp::cdp::browser_protocol::page::{
    CaptureScreenshotFormat, CaptureScreenshotParams, EnableParams, GetLayoutMetricsParams,
    StopScreencastParams,
};
use chromiumoxide_cdp::cdp::browser_protocol::target::AttachToTargetParams;
use tokio::sync::{broadcast, Mutex, RwLock, Semaphore};
use parking_lot::Mutex as SyncMutex;
use tokio::time::interval;
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};
use uuid::Uuid;

use super::cdp::{CdpClient, CdpError, CdpNavigationListener, PendingAck, ScreencastFrameData};
use super::adaptive_stream_controller::{
    AdaptiveStreamController, AudioGate, AudioSuppression, AudioWatermark, ViewerDirectives,
    ViewerSample,
};
use super::capture_tier::{
    build_start_params, CaptureCeilings, CaptureTierSnapshot, CaptureTierState, QualityMutation,
    QualityPreference, QualityRevision,
};
use super::diagnostics::{global_memory_controller, global_stream_diagnostics, TrackedBhjfFrame};
use super::protocol::{
    pack_validated_bhjf_frame_with_dims, validate_jpeg_sof, BrowserStreamQuality,
    ProducerAudioChunk, StreamAudioReason, StreamQualityStatus, TargetFrameHeader, TargetGeometry,
    AUDIO_CHANNELS, AUDIO_ENCODING_PCM16LE, AUDIO_SAMPLE_RATE, MAX_AUDIO_BASE64_BYTES,
    MAX_AUDIO_PCM_BYTES, MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH, MAX_JPEG_PAYLOAD_BYTES, MAX_PIXELS,
};

mod fresh_page_session;
mod recovery;
mod recovery_supervisor;
pub use recovery::RecoveryPolicy;
use recovery::{AbortCause, RecoveryState, MAX_ACKS_IN_FLIGHT};

pub const DEFAULT_JPEG_QUALITY_LEGACY: u8 = 65;
pub const AUDIO_DRAIN_INTERVAL: Duration = Duration::from_millis(50);
pub const DEFAULT_CAPTURE_FPS: u32 = 10;
pub const SCREENSHOT_FALLBACK_DELAY: Duration = Duration::from_millis(250);
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);
pub const VISIBLE_DEMAND_EXPIRY: Duration = Duration::from_secs(15);
/// After a failed capture-tier switch no further switch is attempted for this long, so a
/// persistent native failure cannot flap the stream on every controller evaluation.
pub const FAILED_SWITCH_BACKOFF: Duration = Duration::from_secs(15);
pub const MAX_BASE64_BYTES: usize = 2_796_204; // 2 MiB decoded ceiling

pub const TRANSITIONAL_EPOCH_MASK: u64 = 1 << 63;

/// Geometry transitions re-run per native/producer disagreement before giving up.
const MAX_NATIVE_GEOMETRY_REPAIRS: u32 = 3;

/// How long a native/producer disagreement must persist before the producer repairs it.
const NATIVE_GEOMETRY_REPAIR_DEBOUNCE: Duration = Duration::from_millis(400);

/// Constructs the video streaming governor ticker interval with Skip missed-tick behavior.
pub fn create_governor_interval(period: Duration) -> tokio::time::Interval {
    let mut ticker = tokio::time::interval(period);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    ticker
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScreencastState {
    Stopped,
    Starting,
    Streaming,
    Stopping,
}

impl fmt::Display for ScreencastState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Stopped => write!(f, "Stopped"),
            Self::Starting => write!(f, "Starting"),
            Self::Streaming => write!(f, "Streaming"),
            Self::Stopping => write!(f, "Stopping"),
        }
    }
}

#[derive(Debug, Clone)]
struct EncodedCandidate {
    _frame_session_id: i64,
    native_capture_time_unix_ms: Option<u64>,
    server_received_unix_ms: u64,
    received_at: Instant,
    metadata_geometry: Option<TargetGeometry>,
    producer_run: Uuid,
    viewport_epoch: u64,
    /// Shared ingress frame: its base64 payload stays charged to the global budget while the
    /// candidate (or any other holder) keeps it alive; nothing is copied.
    frame: Arc<ScreencastFrameData>,
}
#[derive(Debug, Clone)]
pub struct ViewerDemand {
    pub viewer_id: String,
    pub subscription_epoch: String,
    pub last_heartbeat: Instant,
    pub visible: bool,
}

/// Audio capture source identity, stable across video-only (capture tier) restarts.
/// Source, document, owner or privacy changes still invalidate it.
#[derive(Clone)]
struct AudioSource {
    run: Uuid,
    cancel: CancellationToken,
    /// Chunks admitted for THIS source. Scoped to the source (a restart is a new source with a
    /// fresh counter), so `(run, seq)` can be read as one coherent fresh-audio boundary.
    seq: Arc<AtomicU64>,
}

#[derive(Debug, Default)]
pub struct ScreencastLedger {
    pub events_received: AtomicU64,
    pub events_admitted: AtomicU64,
    pub events_dropped_overwritten: AtomicU64,
    pub events_dropped_old_run: AtomicU64,
    pub acks_enqueued: AtomicU64,
    pub acks_failed: AtomicU64,
    pub base64_decoded: AtomicU64,
    pub frames_published: AtomicU64,
    pub screenshot_fallbacks: AtomicU64,
    pub periodic_screenshot_violations: AtomicU64,
    pub zero_demand_stops: AtomicU64,
    pub demand_starts: AtomicU64,
    /// Audio chunks taken off a viewer's receiver and discarded because they were broadcast
    /// before that viewer's gate (re)opened.
    pub audio_dropped_by_boundary: AtomicU64,
    /// ACK answers received for current-run attempts.
    pub acks_completed: AtomicU64,
    /// ACK attempts whose run ended before the answer arrived (never replayed).
    pub acks_abandoned: AtomicU64,
    /// Ingress `Lagged` events: each one aborted its run.
    pub ingress_lagged: AtomicU64,
    pub runs_aborted: AtomicU64,
    pub recovery_attempts: AtomicU64,
    pub recoveries_succeeded: AtomicU64,
    pub recoveries_exhausted: AtomicU64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DispatchedNav {
    pub call_id: usize,
    pub epoch: u64,
    pub method: &'static str,
    pub expects_loader_id: bool,
    pub expected_url: Option<Arc<str>>,
    pub loader_id: Option<Arc<str>>,
    pub response_ok: bool,
    pub frame_committed: bool,
    pub same_doc_committed: bool,
    pub unclaimed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingNoopRestore {
    pub prev_epoch: u64,
    pub target_epoch: u64,
    pub prev_doc_id: Option<Arc<str>>,
    pub prev_sub_doc_gen: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioDocAuthority {
    pub requested_epoch: u64,
    pub committed_epoch: u64,
    pub committed_doc_id: Option<Arc<str>>,
    pub committed_sub_doc_gen: u64,
    pub retired_doc_ids: Vec<Arc<str>>,
    pub unassigned_requested_epochs: VecDeque<u64>,
    pub dispatched_navs: VecDeque<DispatchedNav>,
    pub unmatched_committed_loaders: VecDeque<Arc<str>>,
    pub unclaimed_dispatch_epochs: usize,
    pub pending_noop_restore: Option<PendingNoopRestore>,
}

impl AudioDocAuthority {
    pub fn is_admissible(&self, epoch: u64) -> bool {
        self.requested_epoch == self.committed_epoch && self.committed_epoch == epoch
    }

    pub fn active_committed_epoch(&self) -> Option<u64> {
        if self.requested_epoch == self.committed_epoch {
            Some(self.committed_epoch)
        } else {
            None
        }
    }

    pub fn for_epoch(epoch: u64) -> Self {
        Self {
            requested_epoch: epoch,
            committed_epoch: epoch,
            committed_doc_id: None,
            committed_sub_doc_gen: 0,
            retired_doc_ids: Vec::new(),
            unassigned_requested_epochs: std::collections::VecDeque::new(),
            dispatched_navs: std::collections::VecDeque::new(),
            unmatched_committed_loaders: std::collections::VecDeque::new(),
            unclaimed_dispatch_epochs: 0,
            pending_noop_restore: None,
        }
    }
}

fn retire_doc_id_in_auth(auth: &mut AudioDocAuthority, doc_id: Arc<str>) {
    if !auth.retired_doc_ids.iter().any(|d| d == &doc_id) {
        if auth.retired_doc_ids.len() >= 16 {
            auth.retired_doc_ids.remove(0);
        }
        auth.retired_doc_ids.push(doc_id);
    }
}

fn commit_epoch_in_auth(
    auth: &mut AudioDocAuthority,
    audio_doc_epoch: &AtomicU64,
    target_epoch: u64,
) {
    if let Some(prev_doc) = auth.committed_doc_id.take() {
        retire_doc_id_in_auth(auth, prev_doc);
    }
    auth.committed_sub_doc_gen = 0;
    auth.pending_noop_restore = None;
    auth.committed_epoch = target_epoch;
    if auth.committed_epoch > auth.requested_epoch {
        auth.requested_epoch = auth.committed_epoch;
    }
    audio_doc_epoch.store(auth.committed_epoch, Ordering::Release);
    auth.dispatched_navs
        .retain(|d| d.epoch != target_epoch && (d.expects_loader_id || d.epoch > target_epoch));
    auth.unassigned_requested_epochs
        .retain(|&e| e > auth.committed_epoch);
}

fn commit_same_doc_dispatch_in_auth(
    auth: &mut AudioDocAuthority,
    audio_doc_epoch: &AtomicU64,
    target_epoch: u64,
) {
    if let Some(restore) = auth.pending_noop_restore.take() {
        if restore.target_epoch == target_epoch {
            if let Some(ref doc) = restore.prev_doc_id {
                auth.retired_doc_ids.retain(|d| d != doc);
            }
            auth.committed_doc_id = restore.prev_doc_id;
            auth.committed_sub_doc_gen = restore.prev_sub_doc_gen.saturating_add(1).max(2);
        }
    } else if auth.committed_doc_id.is_some() {
        auth.committed_sub_doc_gen = auth.committed_sub_doc_gen.saturating_add(1).max(2);
    }
    auth.committed_epoch = target_epoch;
    if auth.committed_epoch > auth.requested_epoch {
        auth.requested_epoch = auth.committed_epoch;
    }
    audio_doc_epoch.store(auth.committed_epoch, Ordering::Release);
    auth.unassigned_requested_epochs
        .retain(|&e| e > auth.committed_epoch);
}

struct ProducerNavListener {
    doc_epoch_tx: Arc<tokio::sync::watch::Sender<AudioDocAuthority>>,
    audio_doc_epoch: Arc<AtomicU64>,
    target_id: String,
    page_session_id: std::sync::RwLock<Option<String>>,
}

impl ProducerNavListener {
    fn set_page_session_id(&self, sid: &str) {
        let mut guard = self.page_session_id.write().unwrap_or_else(|e| e.into_inner());
        *guard = Some(sid.to_string());
    }

    fn matches_session(&self, session_id: Option<&str>) -> bool {
        let Some(sid) = session_id else {
            return false;
        };
        let guard = self.page_session_id.read().unwrap_or_else(|e| e.into_inner());
        match guard.as_deref() {
            Some(bound) => bound == sid,
            None => true,
        }
    }
}

impl CdpNavigationListener for ProducerNavListener {
    fn on_navigation_dispatched(
        &self,
        session_id: Option<&str>,
        call_id: usize,
        method: &str,
        explicit_epoch: Option<u64>,
        expected_url: Option<&str>,
    ) -> bool {
        if !self.matches_session(session_id) {
            return true;
        }
        let mut admitted = true;
        self.doc_epoch_tx.send_if_modified(|auth| {
            if method == "Page.stopLoading" {
                auth.pending_noop_restore = None;
                let changed = !auth.dispatched_navs.is_empty()
                    || !auth.unmatched_committed_loaders.is_empty()
                    || !auth.unassigned_requested_epochs.is_empty();
                auth.dispatched_navs.clear();
                auth.unmatched_committed_loaders.clear();
                auth.unassigned_requested_epochs.clear();
                return changed;
            }
            let static_method: &'static str = match method {
                "Page.navigate" => "Page.navigate",
                "Page.reload" => "Page.reload",
                "Page.navigateToHistoryEntry" => "Page.navigateToHistoryEntry",
                _ => "Page.navigate",
            };
            let expects_loader_id = static_method == "Page.navigate";
            let (ep, unclaimed) = if let Some(exp_ep) = explicit_epoch {
                let is_initial_bootstrap = exp_ep == 1
                    && auth.requested_epoch == 1
                    && auth.committed_epoch == 1
                    && auth.committed_doc_id.is_none()
                    && auth.retired_doc_ids.is_empty()
                    && auth.dispatched_navs.is_empty();
                if !is_initial_bootstrap
                    && (exp_ep <= auth.committed_epoch
                        || auth.dispatched_navs.iter().any(|d| d.epoch > exp_ep))
                {
                    admitted = false;
                    return false;
                }
                auth.unassigned_requested_epochs
                    .retain(|&e| e != exp_ep && e > auth.committed_epoch);
                if exp_ep > auth.requested_epoch {
                    if auth.committed_epoch == auth.requested_epoch && auth.dispatched_navs.is_empty()
                    {
                        auth.pending_noop_restore = Some(PendingNoopRestore {
                            prev_epoch: auth.committed_epoch,
                            target_epoch: exp_ep,
                            prev_doc_id: auth.committed_doc_id.clone(),
                            prev_sub_doc_gen: auth.committed_sub_doc_gen,
                        });
                    } else {
                        auth.pending_noop_restore = None;
                    }
                    if let Some(prev_doc) = auth.committed_doc_id.take() {
                        retire_doc_id_in_auth(auth, prev_doc);
                    }
                    auth.committed_sub_doc_gen = 0;
                    auth.requested_epoch = exp_ep;
                    self.audio_doc_epoch
                        .store(auth.committed_epoch, Ordering::Release);
                } else if is_initial_bootstrap {
                    auth.committed_epoch = 0;
                    self.audio_doc_epoch.store(0, Ordering::Release);
                }
                (exp_ep, false)
            } else if auth.requested_epoch == auth.committed_epoch {
                auth.pending_noop_restore = Some(PendingNoopRestore {
                    prev_epoch: auth.committed_epoch,
                    target_epoch: auth.requested_epoch.saturating_add(1),
                    prev_doc_id: auth.committed_doc_id.clone(),
                    prev_sub_doc_gen: auth.committed_sub_doc_gen,
                });
                if let Some(prev_doc) = auth.committed_doc_id.take() {
                    retire_doc_id_in_auth(auth, prev_doc);
                }
                auth.committed_sub_doc_gen = 0;
                let next_ep = auth.requested_epoch.saturating_add(1);
                auth.requested_epoch = next_ep;
                auth.unclaimed_dispatch_epochs = auth.unclaimed_dispatch_epochs.saturating_add(1);
                self.audio_doc_epoch
                    .store(auth.committed_epoch, Ordering::Release);
                (next_ep, true)
            } else {
                auth.unassigned_requested_epochs.clear();
                (auth.requested_epoch, false)
            };
            let can_preserve_restore = static_method != "Page.reload"
                && auth
                    .pending_noop_restore
                    .as_ref()
                    .is_some_and(|r| r.target_epoch == ep)
                && auth.dispatched_navs.is_empty();
            if !can_preserve_restore {
                auth.pending_noop_restore = None;
            }
            if auth.dispatched_navs.len() >= 16 {
                auth.dispatched_navs.pop_front();
            }
            auth.dispatched_navs.push_back(DispatchedNav {
                call_id,
                epoch: ep,
                method: static_method,
                expects_loader_id,
                expected_url: expected_url.filter(|u| !u.is_empty()).map(Arc::from),
                loader_id: None,
                response_ok: false,
                frame_committed: false,
                same_doc_committed: false,
                unclaimed,
            });
            true
        });
        admitted
    }

    fn on_navigation_response(
        &self,
        session_id: Option<&str>,
        call_id: usize,
        _method: &str,
        loader_id: Option<&str>,
        failed: bool,
    ) {
        if !self.matches_session(session_id) {
            return;
        }
        self.doc_epoch_tx.send_if_modified(|auth| {
            if failed {
                if let Some(pos) = auth.dispatched_navs.iter().position(|d| d.call_id == call_id) {
                    auth.dispatched_navs.remove(pos);
                    return true;
                }
                return false;
            }
            if let Some(lid) = loader_id {
                // A returned loaderId proves this operation initiated a cross-document load,
                // never a same-document transition!
                let already_committed = if let Some(lpos) = auth
                    .unmatched_committed_loaders
                    .iter()
                    .position(|l| l.as_ref() == lid)
                {
                    auth.unmatched_committed_loaders.remove(lpos);
                    true
                } else {
                    false
                };
                if let Some(pos) = auth.dispatched_navs.iter().position(|d| d.call_id == call_id) {
                    let ep = auth.dispatched_navs[pos].epoch;
                    if auth
                        .pending_noop_restore
                        .as_ref()
                        .is_some_and(|r| r.target_epoch == ep)
                    {
                        auth.pending_noop_restore = None;
                    }
                    auth.dispatched_navs[pos].loader_id = Some(Arc::from(lid));
                    auth.dispatched_navs[pos].response_ok = true;
                    auth.dispatched_navs[pos].same_doc_committed = false;
                    if already_committed || auth.dispatched_navs[pos].frame_committed {
                        auth.dispatched_navs.remove(pos);
                        commit_epoch_in_auth(auth, &self.audio_doc_epoch, ep);
                    }
                    return true;
                }
                return false;
            }
            if let Some(pos) = auth.dispatched_navs.iter().position(|d| d.call_id == call_id) {
                auth.dispatched_navs[pos].response_ok = true;
                if auth.dispatched_navs[pos].frame_committed {
                    let ep = auth.dispatched_navs[pos].epoch;
                    auth.dispatched_navs.remove(pos);
                    commit_epoch_in_auth(auth, &self.audio_doc_epoch, ep);
                } else if auth.dispatched_navs[pos].same_doc_committed
                    && auth.dispatched_navs[pos].method != "Page.reload"
                    && auth.dispatched_navs[pos].loader_id.is_none()
                {
                    let ep = auth.dispatched_navs[pos].epoch;
                    auth.dispatched_navs.remove(pos);
                    commit_same_doc_dispatch_in_auth(auth, &self.audio_doc_epoch, ep);
                }
                return true;
            }
            false
        });
    }

    fn on_frame_navigated(
        &self,
        session_id: Option<&str>,
        is_main_frame: bool,
        loader_id: Option<&str>,
    ) {
        if !is_main_frame || !self.matches_session(session_id) {
            return;
        }
        self.doc_epoch_tx.send_if_modified(|auth| {
            if let Some(lid) = loader_id {
                if let Some(pos) = auth
                    .dispatched_navs
                    .iter()
                    .position(|d| d.loader_id.as_deref() == Some(lid))
                {
                    let ep = auth.dispatched_navs[pos].epoch;
                    auth.dispatched_navs.remove(pos);
                    commit_epoch_in_auth(auth, &self.audio_doc_epoch, ep);
                    return true;
                }
                if auth.dispatched_navs.len() == 1
                    && !auth.dispatched_navs[0].expects_loader_id
                    && auth.unassigned_requested_epochs.is_empty()
                {
                    if auth.dispatched_navs[0].response_ok {
                        let ep = auth.dispatched_navs.pop_front().unwrap().epoch;
                        commit_epoch_in_auth(auth, &self.audio_doc_epoch, ep);
                    } else {
                        auth.dispatched_navs[0].frame_committed = true;
                    }
                    return true;
                }
                if !auth.dispatched_navs.is_empty() || auth.requested_epoch > auth.committed_epoch {
                    if !auth
                        .unmatched_committed_loaders
                        .iter()
                        .any(|l| l.as_ref() == lid)
                    {
                        if auth.unmatched_committed_loaders.len() >= 16 {
                            auth.unmatched_committed_loaders.pop_front();
                        }
                        auth.unmatched_committed_loaders.push_back(Arc::from(lid));
                    }
                    return true;
                }
                let next = auth.committed_epoch.saturating_add(1);
                auth.requested_epoch = next;
                commit_epoch_in_auth(auth, &self.audio_doc_epoch, next);
                return true;
            }
            if auth.dispatched_navs.len() == 1
                && !auth.dispatched_navs[0].expects_loader_id
                && auth.unassigned_requested_epochs.is_empty()
            {
                if auth.dispatched_navs[0].response_ok {
                    let ep = auth.dispatched_navs.pop_front().unwrap().epoch;
                    commit_epoch_in_auth(auth, &self.audio_doc_epoch, ep);
                } else {
                    auth.dispatched_navs[0].frame_committed = true;
                }
                return true;
            }
            if auth.dispatched_navs.is_empty() && auth.requested_epoch == auth.committed_epoch {
                let next = auth.committed_epoch.saturating_add(1);
                auth.requested_epoch = next;
                commit_epoch_in_auth(auth, &self.audio_doc_epoch, next);
                return true;
            }
            false
        });
    }

    fn on_navigated_within_document(
        &self,
        session_id: Option<&str>,
        frame_id: Option<&str>,
        url: Option<&str>,
        navigation_type: Option<&str>,
    ) {
        if !self.matches_session(session_id) {
            return;
        }
        if let Some(fid) = frame_id {
            if fid != self.target_id {
                return;
            }
        }
        self.doc_epoch_tx.send_if_modified(|auth| {
            if auth.dispatched_navs.len() == 1 && auth.unassigned_requested_epochs.is_empty() {
                let d = &auth.dispatched_navs[0];
                let method_allows = d.method != "Page.reload" && d.loader_id.is_none();
                let nav_type_allows = navigation_type != Some("historyApi");
                let url_matches = match (d.expected_url.as_deref(), url) {
                    (Some(exp), Some(actual)) => exp == actual,
                    (Some(_), None) => false,
                    (None, _) => true,
                };
                if method_allows && nav_type_allows && url_matches {
                    if auth.dispatched_navs[0].response_ok {
                        let ep = auth.dispatched_navs.pop_front().unwrap().epoch;
                        commit_same_doc_dispatch_in_auth(auth, &self.audio_doc_epoch, ep);
                    } else {
                        auth.dispatched_navs[0].same_doc_committed = true;
                    }
                    return true;
                }
                return false;
            }
            if auth.dispatched_navs.is_empty() && auth.requested_epoch == auth.committed_epoch {
                auth.pending_noop_restore = None;
                if auth.committed_doc_id.is_some() {
                    auth.committed_sub_doc_gen = auth.committed_sub_doc_gen.saturating_add(1).max(2);
                }
                let next = auth.committed_epoch.saturating_add(1);
                auth.requested_epoch = next;
                auth.committed_epoch = next;
                self.audio_doc_epoch.store(next, Ordering::Release);
                return true;
            }
            false
        });
    }
}

/// Attempts (and per-attempt backoff while a mutation is in flight) to read one coherent quality
/// snapshot before falling back to an unstable placeholder.
const QUALITY_SNAPSHOT_ATTEMPTS: usize = 8;
const QUALITY_SNAPSHOT_BACKOFF: Duration = Duration::from_millis(1);

/// A built quality event and the revision it is provably coherent with.
#[derive(Debug, Clone)]
pub struct StreamQualitySnapshot {
    pub event: BrowserStreamQuality,
    /// `Some(v)`: no event-affecting mutation overlapped the read; `v` is the committed revision it
    /// reflects. `None`: state never settled and `event` is a conservative warming placeholder that
    /// must not be memoized (the next dirty check must rebuild it).
    pub revision: Option<u64>,
}

pub struct ScreencastProducer {
    browser_session_id: String,
    browser_incarnation: String,
    profile_epoch: u64,
    viewport_epoch: Arc<AtomicU64>,
    frame_seq: Arc<AtomicU64>,
    audio_doc_epoch: Arc<AtomicU64>,
    doc_epoch_tx: Arc<tokio::sync::watch::Sender<AudioDocAuthority>>,
    nav_listener: Arc<ProducerNavListener>,
    pub cdp_client: Arc<CdpClient>,
    target_id: String,
    page_session_id: Arc<RwLock<Option<String>>>,
    /// An ambiguous Page-session operation prevents reuse until actor closure is confirmed.
    page_session_poisoned: Arc<AtomicBool>,
    current_run: Arc<RwLock<Option<Uuid>>>,
    native_screencast_session_id: Arc<RwLock<Option<i64>>>,
    state: Arc<RwLock<ScreencastState>>,
    /// Serializes native lifecycle operations independently of observable state.
    lifecycle_operation: Arc<Mutex<()>>,
    /// Serializes frame publication against geometry fences: a frame is committed only while its
    /// capture epoch is still current, and a fence cannot slip between that check and the commit.
    publish_gate: Arc<Mutex<()>>,
    /// Bumped by every geometry transition and every external geometry fence (begin and commit).
    /// A rollback restores its snapshot only if no one else bumped it meanwhile.
    fence_generation: Arc<AtomicU64>,
    current_candidate: Arc<Mutex<Option<EncodedCandidate>>>,
    cached_frame: Arc<RwLock<Option<TrackedBhjfFrame>>>,
    cached_header: Arc<RwLock<Option<TargetFrameHeader>>>,
    viewers: Arc<RwLock<HashMap<String, ViewerDemand>>>, // key: subscription_epoch
    pub ledger: Arc<ScreencastLedger>,
    screenshot_taken_in_epoch: Arc<AtomicBool>,
    /// Shared validated capture snapshot + admin ceilings; every handle clone reads the same state.
    capture: Arc<CaptureTierState>,
    adaptive: Arc<SyncMutex<AdaptiveStreamController>>,
    /// Snapshot the live native run was started with (native quality/scale are fixed per run).
    run_snapshot: Arc<SyncMutex<Arc<CaptureTierSnapshot>>>,
    /// Set by a capture switch for its fresh run and by every other start to `None`.
    run_fence: Arc<SyncMutex<Option<SwitchFence>>>,
    audio_source: Arc<SyncMutex<Option<AudioSource>>>,
    switch_backoff_until: Arc<SyncMutex<Option<Instant>>>,
    /// FPS the governor is actually running at (FPS-only updates apply without a native restart).
    applied_fps: Arc<AtomicU32>,
    audio_broadcast: broadcast::Sender<ProducerAudioChunk>,
    frame_broadcast: broadcast::Sender<TrackedBhjfFrame>,
    active_run_cancel: Arc<Mutex<Option<CancellationToken>>>,
    geometry: Arc<RwLock<TargetGeometry>>,
    /// Native evidence gate for pointer projection (see `input_geometry_trusted`).
    geometry_trusted: Arc<AtomicBool>,
    /// Production sessions opt in (`with_native_geometry_repair`); see `schedule_native_geometry_repair`.
    native_geometry_repair_enabled: Arc<AtomicBool>,
    /// A raw CDP agent has changed this target's geometry: native/producer disagreement is then
    /// an agent decision, never engine drift, so it is not repaired (see `schedule_native_geometry_repair`).
    external_geometry_fenced: Arc<AtomicBool>,
    /// Consecutive repairs issued for the current disagreement; reset by a confirming frame.
    native_geometry_repairs: Arc<AtomicU32>,
    native_geometry_repair_in_flight: Arc<AtomicBool>,
    current_run_proven: Arc<SyncMutex<Option<ProvenFrameState>>>,
    applied_event_version: Arc<SyncMutex<(Option<Uuid>, u64)>>,
    quality_revision: Arc<QualityRevision>,
    /// Test barrier: while `true`, media sessions do not take chunks off their audio receiver.
    audio_drain_barrier: Arc<tokio::sync::watch::Sender<bool>>,
    /// Serializes Page-session setup so exactly one session exists.
    page_setup: Arc<Mutex<()>>,
    /// Run abort/recovery supervisor state (single flight, bounded backoff).
    recovery: Arc<RecoveryState>,
    /// Application-owned selection authority used during Page-session replacement.
    selection_context: Option<crate::state::AppState>,
    selection_gap: Arc<Mutex<Option<crate::browser_host::selection::PageObservationGap>>>,
    /// Cancels the previous child-target stealth listener when a Page session is replaced.
    stealth_listener: Arc<SyncMutex<Option<CancellationToken>>>,
}
#[derive(Debug, Clone)]
pub struct ProvenFrameState {
    pub producer_run: Uuid,
    pub snapshot: Arc<CaptureTierSnapshot>,
    pub width: u32,
    pub height: u32,
}

/// The run a capture switch retires: its last native session id and requested image bounds.
#[derive(Debug, Clone, Copy)]
struct ReplacedRun {
    native_session_id: Option<i64>,
    bounds: (u32, u32),
}

/// Fence of a fresh run started by a capture switch. Chromium may deliver a frame of the
/// retired native session right after the fresh `Page.startScreencast`: with the old session id,
/// or with the new id but pixels captured at the old size. Neither is evidence of the requested
/// capture, so neither may establish the run's native session or prove its settings.
#[derive(Debug, Clone, Copy)]
struct SwitchFence {
    replaced: ReplacedRun,
    /// Image bounds this run requested natively.
    bounds: (u32, u32),
}

impl SwitchFence {
    /// An id at or below the replaced session's last id belongs to the retired session.
    fn is_retired_session(&self, native_session_id: i64) -> bool {
        self.replaced.native_session_id.is_some_and(|prev| native_session_id <= prev)
    }

    /// Pixels that fill the replaced run's bounds but not this run's. A size that matches neither
    /// is not evidence of staleness (a viewport the engine did not size is admitted as before).
    fn is_retired_size(&self, width: u32, height: u32) -> bool {
        fills_bounds(width, height, self.replaced.bounds) && !fills_bounds(width, height, self.bounds)
    }
}

/// An aspect-fitted native frame touches its bound on at least one axis and never exceeds it
/// (one pixel of rounding tolerance on both).
fn fills_bounds(width: u32, height: u32, (max_w, max_h): (u32, u32)) -> bool {
    width <= max_w + 1 && height <= max_h + 1 && (width + 1 >= max_w || height + 1 >= max_h)
}

/// Whether a frame's native viewport metadata supports projecting pointer fractions through
/// `basis`: CSS size within one pixel (rounding of the applied override) and no page zoom.
fn native_geometry_agrees(native: &TargetGeometry, basis: &TargetGeometry) -> bool {
    (native.css_width - basis.css_width).abs() <= 1.0
        && (native.css_height - basis.css_height).abs() <= 1.0
        && (native.page_scale - 1.0).abs() <= 1e-3
}

impl ScreencastProducer {
    pub fn new(
        browser_session_id: String,
        browser_incarnation: String,
        profile_epoch: u64,
        viewport_epoch: u64,
        cdp_client: Arc<CdpClient>,
        target_id: String,
        initial_geometry: TargetGeometry,
    ) -> Self {
        let (frame_broadcast, _) = broadcast::channel(2);
        let (audio_broadcast, _) = broadcast::channel(4);
        let (doc_epoch_tx, _) = tokio::sync::watch::channel(AudioDocAuthority {
            requested_epoch: 1,
            committed_epoch: 1,
            committed_doc_id: None,
            committed_sub_doc_gen: 0,
            retired_doc_ids: Vec::new(),
            unassigned_requested_epochs: VecDeque::new(),
            dispatched_navs: VecDeque::new(),
            unmatched_committed_loaders: VecDeque::new(),
            unclaimed_dispatch_epochs: 0,
            pending_noop_restore: None,
        });
        let doc_epoch_tx = Arc::new(doc_epoch_tx);
        let audio_doc_epoch = Arc::new(AtomicU64::new(1));
        let nav_listener = Arc::new(ProducerNavListener {
            doc_epoch_tx: doc_epoch_tx.clone(),
            audio_doc_epoch: audio_doc_epoch.clone(),
            target_id: target_id.clone(),
            page_session_id: std::sync::RwLock::new(None),
        });
        let listener_weak: std::sync::Weak<dyn CdpNavigationListener> =
            Arc::downgrade(&nav_listener) as std::sync::Weak<dyn CdpNavigationListener>;
        cdp_client.register_navigation_listener(listener_weak);
        let default_ceilings = CaptureCeilings::new(
            DEFAULT_CAPTURE_FPS,
            DEFAULT_JPEG_QUALITY_LEGACY,
            MAX_IMAGE_WIDTH,
            MAX_IMAGE_HEIGHT,
        );
        let capture = Arc::new(CaptureTierState::new(default_ceilings));
        Self {
            browser_session_id,
            browser_incarnation,
            profile_epoch,
            viewport_epoch: Arc::new(AtomicU64::new(viewport_epoch.max(1))),
            frame_seq: Arc::new(AtomicU64::new(0)),
            audio_doc_epoch,
            doc_epoch_tx,
            nav_listener,
            cdp_client,
            target_id,
            page_session_id: Arc::new(RwLock::new(None)),
            page_session_poisoned: Arc::new(AtomicBool::new(false)),
            current_run: Arc::new(RwLock::new(None)),
            native_screencast_session_id: Arc::new(RwLock::new(None)),
            state: Arc::new(RwLock::new(ScreencastState::Stopped)),
            lifecycle_operation: Arc::new(Mutex::new(())),
            publish_gate: Arc::new(Mutex::new(())),
            fence_generation: Arc::new(AtomicU64::new(0)),
            current_candidate: Arc::new(Mutex::new(None)),
            cached_frame: Arc::new(RwLock::new(None)),
            cached_header: Arc::new(RwLock::new(None)),
            viewers: Arc::new(RwLock::new(HashMap::new())),
            ledger: Arc::new(ScreencastLedger::default()),
            screenshot_taken_in_epoch: Arc::new(AtomicBool::new(false)),
            adaptive: Arc::new(SyncMutex::new(AdaptiveStreamController::new(default_ceilings))),
            run_snapshot: Arc::new(SyncMutex::new(capture.current())),
            run_fence: Arc::new(SyncMutex::new(None)),
            capture,
            audio_source: Arc::new(SyncMutex::new(None)),
            switch_backoff_until: Arc::new(SyncMutex::new(None)),
            applied_fps: Arc::new(AtomicU32::new(DEFAULT_CAPTURE_FPS)),
            frame_broadcast,
            audio_broadcast,
            active_run_cancel: Arc::new(Mutex::new(None)),
            geometry: Arc::new(RwLock::new(initial_geometry)),
            geometry_trusted: Arc::new(AtomicBool::new(true)),
            native_geometry_repair_enabled: Arc::new(AtomicBool::new(false)),
            external_geometry_fenced: Arc::new(AtomicBool::new(false)),
            native_geometry_repairs: Arc::new(AtomicU32::new(0)),
            native_geometry_repair_in_flight: Arc::new(AtomicBool::new(false)),
            current_run_proven: Arc::new(SyncMutex::new(None)),
            applied_event_version: Arc::new(SyncMutex::new((None, 0))),
            quality_revision: Arc::new(QualityRevision::new()),
            audio_drain_barrier: Arc::new(tokio::sync::watch::channel(false).0),
            page_setup: Arc::new(Mutex::new(())),
            recovery: Arc::new(RecoveryState::new(RecoveryPolicy::default())),
            selection_context: None,
            selection_gap: Arc::new(Mutex::new(None)),
            stealth_listener: Arc::new(SyncMutex::new(None)),
        }
    }

    pub(crate) fn with_selection_context(mut self, state: crate::state::AppState) -> Self {
        self.selection_context = Some(state);
        self
    }

    /// Enables self-repair of an engine viewport that drifted from the producer geometry
    /// (see `schedule_native_geometry_repair`). Off by default so harnesses that script native
    /// frames keep full control of the trust gate.
    pub fn with_native_geometry_repair(self) -> Self {
        self.native_geometry_repair_enabled.store(true, Ordering::Release);
        self
    }

    /// Configures admin ceilings for capture FPS (1..=30) and JPEG quality (10..=100).
    /// Adaptive tiers only ever propose values at or below these ceilings.
    pub fn with_capture_policy(mut self, fps: u32, jpeg_quality: u8) -> Self {
        let c = *self.capture.ceilings();
        self.reconfigure(CaptureCeilings::new(fps, jpeg_quality, c.max_width, c.max_height));
        self
    }

    /// Configures encoded JPEG dimension ceilings (clamped to protocol 64..=1920 x 64..=1080)
    /// independently of the page's CSS viewport.
    pub fn with_image_bounds(mut self, max_width: u32, max_height: u32) -> Self {
        let c = *self.capture.ceilings();
        self.reconfigure(CaptureCeilings::new(c.fps, c.jpeg_quality, max_width, max_height));
        self
    }

    fn reconfigure(&mut self, ceilings: CaptureCeilings) {
        self.capture = Arc::new(CaptureTierState::new(ceilings));
        self.adaptive = Arc::new(SyncMutex::new(AdaptiveStreamController::new(ceilings)));
        *self.run_snapshot.lock() = self.capture.current();
        *self.current_run_proven.lock() = None;
        self.bump_quality_revision();
    }

    pub fn max_image_bounds(&self) -> (u32, u32) {
        let c = self.capture.ceilings();
        (c.max_width, c.max_height)
    }
    pub fn subscribe_audio(&self) -> broadcast::Receiver<ProducerAudioChunk> {
        self.audio_broadcast.subscribe()
    }

    pub fn governor_interval(&self) -> Duration {
        self.capture.current().governor_interval()
    }

    pub fn jpeg_quality(&self) -> u8 {
        self.capture.current().jpeg_quality
    }

    pub fn capture_ceilings(&self) -> CaptureCeilings {
        *self.capture.ceilings()
    }

    /// Latest shared capture snapshot (desired; not necessarily proven by a native frame yet).
    pub fn capture_snapshot(&self) -> Arc<CaptureTierSnapshot> {
        self.capture.current()
    }

    /// Last snapshot proven by a current-run native frame; never an unapplied setting.
    pub fn effective_capture(&self) -> Option<Arc<CaptureTierSnapshot>> {
        self.capture.effective()
    }

    pub fn capture_state(&self) -> &Arc<CaptureTierState> {
        &self.capture
    }

    /// Stable audio source run (not the video `producerRun`); `None` when no source is live.
    pub fn audio_source_run(&self) -> Option<Uuid> {
        self.audio_source
            .lock()
            .as_ref()
            .filter(|s| !s.cancel.is_cancelled())
            .map(|s| s.run)
    }

    /// Coherent fresh-audio boundary: the live audio source and how many of ITS chunks have been
    /// admitted, read under the source lock. Without a live source nothing can be in flight, so the
    /// boundary is `(None, 0)` and a stale count of a retired source can never be recorded.
    fn audio_boundary(&self) -> (Option<Uuid>, u64) {
        self.audio_source
            .lock()
            .as_ref()
            .filter(|s| !s.cancel.is_cancelled())
            .map_or((None, 0), |s| (Some(s.run), s.seq.load(Ordering::SeqCst)))
    }

    /// One feedback sample from an admitted viewer subscription. `None` for unknown/stale subscriptions.
    pub fn adaptive_report(&self, subscription_epoch: &str, visible: bool, sample: ViewerSample) -> Option<ViewerDirectives> {
        let mut adaptive = self.adaptive.lock();
        // The boundary is sampled while holding the adaptive lock: a chunk's sequence is committed
        // (SeqCst) before it is broadcast, so every chunk broadcast before this gate transition
        // has seq <= boundary, and any chunk admitted afterwards is strictly above it.
        let (source_run, seq) = self.audio_boundary();
        adaptive.report_with_seq(subscription_epoch, visible, sample, Instant::now(), source_run, seq)
    }

    pub fn viewer_directives(&self, subscription_epoch: &str) -> Option<ViewerDirectives> {
        self.adaptive.lock().directives(subscription_epoch, Instant::now())
    }

    pub fn viewer_audio_gate(&self, subscription_epoch: &str) -> Option<AudioGate> {
        self.viewer_directives(subscription_epoch).map(|d| d.audio)
    }

    pub fn viewer_audio_generation(&self, subscription_epoch: &str) -> Option<u64> {
        self.adaptive.lock().audio_generation(subscription_epoch)
    }

    pub fn set_viewer_quality_preference(&self, subscription_epoch: &str, pref: QualityPreference) -> bool {
        let mut adaptive = self.adaptive.lock();
        let (source_run, seq) = self.audio_boundary();
        adaptive.set_preference_with_seq(subscription_epoch, pref, Instant::now(), source_run, seq)
    }

    pub fn set_viewer_muted(&self, subscription_epoch: &str, muted: bool) -> bool {
        let mut adaptive = self.adaptive.lock();
        let (source_run, seq) = self.audio_boundary();
        adaptive.set_muted_with_seq(subscription_epoch, muted, Instant::now(), source_run, seq)
    }

    /// Gate, generation and source-scoped watermark as one tuple (admission of a new chunk).
    pub fn viewer_audio_gate_info(&self, subscription_epoch: &str) -> Option<(AudioGate, u64, AudioWatermark)> {
        let mut adaptive = self.adaptive.lock();
        let (source_run, seq) = self.audio_boundary();
        adaptive.audio_gate_info(subscription_epoch, Instant::now(), source_run, seq)
    }

    /// Write-time admission of one queued audio slot, decided from ONE consistent state: the slot's
    /// own admitted generation and sequence against the viewer's current gate, generation and
    /// source-scoped boundary, and the live source identity. Unknown subscriptions fail closed.
    pub fn audio_slot_admissible(
        &self,
        subscription_epoch: &str,
        admitted_gen: u64,
        chunk_run: Uuid,
        chunk_seq: u64,
    ) -> bool {
        let mut adaptive = self.adaptive.lock();
        let (source_run, seq) = self.audio_boundary();
        if source_run != Some(chunk_run) {
            return false;
        }
        adaptive
            .audio_gate_info(subscription_epoch, Instant::now(), source_run, seq)
            .is_some_and(|(gate, generation, watermark)| {
                gate.is_allowed()
                    && generation == admitted_gen
                    && !watermark.suppresses(Some(chunk_run), chunk_seq)
            })
    }

    /// Quality preference accepted for this subscription; `None` if unknown.
    pub fn viewer_quality_preference(&self, subscription_epoch: &str) -> Option<QualityPreference> {
        self.adaptive.lock().viewer_preference(subscription_epoch)
    }

    /// Committed revision of the quality-event inputs (the digest's cheap dirty check).
    pub fn quality_revision(&self) -> u64 {
        self.quality_revision.version()
    }

    fn bump_quality_revision(&self) {
        self.quality_revision.bump();
    }

    /// Marks an event-affecting mutation in flight; the revision advances when the guard drops.
    #[doc(hidden)]
    pub fn begin_quality_mutation(&self) -> QualityMutation<'_> {
        self.quality_revision.begin()
    }

    #[doc(hidden)]
    pub fn hold_audio_drain(&self) {
        self.audio_drain_barrier.send_replace(true);
    }

    #[doc(hidden)]
    pub fn release_audio_drain(&self) {
        self.audio_drain_barrier.send_replace(false);
    }

    #[doc(hidden)]
    pub fn audio_drain_barrier(&self) -> tokio::sync::watch::Receiver<bool> {
        self.audio_drain_barrier.subscribe()
    }


    pub async fn stream_quality_event(&self, subscription_epoch: &str) -> BrowserStreamQuality {
        self.stream_quality_snapshot(subscription_epoch).await.event
    }

    /// Builds the viewer's quality event from one coherent snapshot of the producer state.
    ///
    /// The read is accepted only when no event-affecting mutation was in flight and the revision
    /// did not move while the inputs were read (see [`QualityRevision`]). A writer in flight is
    /// waited out for a short bounded time; if state never settles, a conservative warming
    /// placeholder is returned with `revision: None` so the caller never memoizes it.
    pub async fn stream_quality_snapshot(&self, subscription_epoch: &str) -> StreamQualitySnapshot {
        for _ in 0..QUALITY_SNAPSHOT_ATTEMPTS {
            let Some(version) = self.quality_revision.begin_read() else {
                tokio::time::sleep(QUALITY_SNAPSHOT_BACKOFF).await;
                continue;
            };
            let cur_run = *self.current_run.read().await;
            let target = self.capture.current();
            let proven = self.current_run_proven.lock().clone();
            let directives = self.viewer_directives(subscription_epoch);
            let pref = self
                .viewer_quality_preference(subscription_epoch)
                .unwrap_or(QualityPreference::Auto);
            let geom = self.geometry.read().await.clone();
            let ceilings = *self.capture.ceilings();
            let unavailable = self.recovery.is_unavailable();
            if !self.quality_revision.validate_read(version) {
                continue;
            }
            return StreamQualitySnapshot {
                event: self.build_stream_quality_from_snapshot(
                    subscription_epoch,
                    cur_run,
                    target,
                    proven,
                    directives,
                    pref,
                    geom,
                    ceilings,
                    unavailable,
                ),
                revision: Some(version),
            };
        }

        // State never settled: never claim a proof; the placeholder is not memoizable.
        let cur_run = *self.current_run.read().await;
        let target = self.capture.current();
        let directives = self.viewer_directives(subscription_epoch);
        let pref = self
            .viewer_quality_preference(subscription_epoch)
            .unwrap_or(QualityPreference::Auto);
        let geom = self.geometry.read().await.clone();
        let ceilings = *self.capture.ceilings();
        let unavailable = self.recovery.is_unavailable();
        StreamQualitySnapshot {
            event: self.build_stream_quality_from_snapshot(
                subscription_epoch,
                cur_run,
                target,
                None,
                directives,
                pref,
                geom,
                ceilings,
                unavailable,
            ),
            revision: None,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn build_stream_quality_from_snapshot(
        &self,
        subscription_epoch: &str,
        cur_run: Option<Uuid>,
        target: Arc<CaptureTierSnapshot>,
        proven: Option<ProvenFrameState>,
        directives: Option<ViewerDirectives>,
        pref: QualityPreference,
        geom: TargetGeometry,
        ceilings: CaptureCeilings,
        unavailable: bool,
    ) -> BrowserStreamQuality {
        let (viewer_tier, fps, audio_suppressed, audio_reason) = match directives {
            Some(d) => {
                let fps = (1.0 / d.min_delivery_interval.as_secs_f64())
                    .round()
                    .clamp(1.0, 30.0) as u32;
                let (suppressed, reason) = match d.audio {
                    AudioGate::Allowed => (false, None),
                    AudioGate::Suppressed(AudioSuppression::Muted) => {
                        (true, Some(StreamAudioReason::Muted))
                    }
                    AudioGate::Suppressed(AudioSuppression::Constrained) => {
                        (true, Some(StreamAudioReason::Bandwidth))
                    }
                    AudioGate::Suppressed(AudioSuppression::Hidden) => {
                        (true, Some(StreamAudioReason::Hidden))
                    }
                    AudioGate::Suppressed(AudioSuppression::Stalled) => {
                        (true, Some(StreamAudioReason::Stalled))
                    }
                };
                (d.tier, fps, suppressed, reason)
            }
            None => (
                target.tier,
                target.fps.clamp(1, 30),
                true,
                Some(StreamAudioReason::Muted),
            ),
        };

        let (
            shared_tier,
            producer_run,
            capture_version,
            jpeg_quality,
            scale,
            image_width,
            image_height,
            status,
        ) = match (cur_run, proven) {
            (Some(run), Some(p)) if p.producer_run == run => {
                // Effective when native snapshot matches or governor-only FPS change has applied.
                let is_effective = p.snapshot.version == target.version
                    || (p.snapshot.native_key() == target.native_key() && p.snapshot.fps == target.fps);
                let status = if is_effective {
                    StreamQualityStatus::Effective
                } else {
                    StreamQualityStatus::Switching
                };
                let mut applied_lock = self.applied_event_version.lock();
                if applied_lock.0 != Some(run) {
                    *applied_lock = (Some(run), p.snapshot.version);
                }
                if is_effective {
                    applied_lock.1 = applied_lock.1.max(p.snapshot.version.max(target.version));
                } else {
                    applied_lock.1 = applied_lock.1.max(p.snapshot.version);
                }
                let capture_version = applied_lock.1.to_string();
                drop(applied_lock);
                let scale = (f64::from(p.snapshot.scale_permille) / 1000.0).clamp(0.001, 1.0);
                (
                    p.snapshot.tier,
                    p.producer_run.to_string(),
                    capture_version,
                    p.snapshot.jpeg_quality.clamp(1, 100),
                    scale,
                    p.width.clamp(1, MAX_IMAGE_WIDTH),
                    p.height.clamp(1, MAX_IMAGE_HEIGHT),
                    status,
                )
            }
            (Some(run), _) => {
                // Status warming indicates no proven frame in the current run yet;
                // numbers are non-applied target placeholders.
                let (w, h) = target.image_bounds(&ceilings, geom.css_width, geom.css_height);
                let scale = (f64::from(target.scale_permille) / 1000.0).clamp(0.001, 1.0);
                (
                    target.tier,
                    run.to_string(),
                    target.version.to_string(),
                    target.jpeg_quality.clamp(1, 100),
                    scale,
                    w.clamp(1, MAX_IMAGE_WIDTH),
                    h.clamp(1, MAX_IMAGE_HEIGHT),
                    StreamQualityStatus::Warming,
                )
            }
            (None, _) => {
                // No active run: warming while a start or recovery is pending, `unavailable`
                // once recovery gave up on demand that still exists.
                let (w, h) = target.image_bounds(&ceilings, geom.css_width, geom.css_height);
                let scale = (f64::from(target.scale_permille) / 1000.0).clamp(0.001, 1.0);
                (
                    target.tier,
                    Uuid::nil().to_string(),
                    target.version.to_string(),
                    target.jpeg_quality.clamp(1, 100),
                    scale,
                    w.clamp(1, MAX_IMAGE_WIDTH),
                    h.clamp(1, MAX_IMAGE_HEIGHT),
                    if unavailable {
                        StreamQualityStatus::Unavailable
                    } else {
                        StreamQualityStatus::Warming
                    },
                )
            }
        };

        BrowserStreamQuality {
            kind: "streamQuality".to_string(),
            subscription_epoch: subscription_epoch.to_string(),
            preference: pref,
            producer_run,
            capture_version,
            shared_tier,
            viewer_tier,
            fps,
            jpeg_quality,
            scale,
            image_width,
            image_height,
            audio_suppressed,
            audio_reason,
            status,
        }
    }

    fn run_adaptive_evaluation(&self) {
        let mut adaptive = self.adaptive.lock();
        let (source_run, seq) = self.audio_boundary();
        let decision = adaptive.evaluate_with_seq(Instant::now(), source_run, seq);
        if let Some(d) = decision {
            let mutation = self.begin_quality_mutation();
            if self.capture.publish(d.fidelity_stage, d.fps).is_some() {
                drop(mutation);
            } else {
                mutation.discard();
            }
        }
    }


    fn ensure_audio_source(&self, producer_run: Uuid) -> (Uuid, CancellationToken, bool) {
        let mut src = self.audio_source.lock();
        if let Some(cur) = src.as_ref().filter(|s| !s.cancel.is_cancelled()) {
            return (cur.run, cur.cancel.clone(), false);
        }
        // `producer_run` is a fresh UUID per run, so a restarted source never reuses an identity.
        let fresh = AudioSource {
            run: producer_run,
            cancel: CancellationToken::new(),
            seq: Arc::new(AtomicU64::new(0)),
        };
        let out = (fresh.run, fresh.cancel.clone(), true);
        *src = Some(fresh);
        out
    }

    fn teardown_audio_source(&self) {
        if let Some(src) = self.audio_source.lock().take() {
            src.cancel.cancel();
        }
    }

    pub fn subscribe_frames(&self) -> broadcast::Receiver<TrackedBhjfFrame> {
        self.frame_broadcast.subscribe()
    }

    pub async fn get_cached_frame(&self) -> Option<TrackedBhjfFrame> {
        self.cached_frame.read().await.clone()
    }

    pub async fn get_cached_header(&self) -> Option<TargetFrameHeader> {
        self.cached_header.read().await.clone()
    }

    pub async fn state(&self) -> ScreencastState {
        *self.state.read().await
    }

    pub fn viewport_epoch(&self) -> u64 {
        self.viewport_epoch.load(Ordering::Relaxed) & !TRANSITIONAL_EPOCH_MASK
    }

    pub fn frame_seq(&self) -> u64 {
        self.frame_seq.load(Ordering::Relaxed)
    }

    pub async fn current_run(&self) -> Option<Uuid> {
        *self.current_run.read().await
    }

    pub async fn geometry(&self) -> TargetGeometry {
        self.geometry.read().await.clone()
    }

    /// Browser incarnation this producer was built for.
    pub fn browser_incarnation(&self) -> &str {
        &self.browser_incarnation
    }

    pub fn target_id(&self) -> &str {
        &self.target_id
    }

    /// Advancing viewport epoch (e.g. on client resize or viewport change).
    /// Contract: viewportEpoch advances BEFORE commands and publishing.
    pub async fn retire_producer_on_fatal_error(&self) {
        self.recovery.cancel();
        let _operation = self.lifecycle_operation.lock().await;
        let mut state = self.state.write().await;
        self.retire_locked(&mut state).await;
    }

    async fn retire_locked(&self, state: &mut ScreencastState) {
        *state = ScreencastState::Stopped;
        {
            let _mutation = self.begin_quality_mutation();
            *self.current_run.write().await = None;
            *self.current_run_proven.lock() = None;
        }
        let mut cancel_lock = self.active_run_cancel.lock().await;
        if let Some(token) = cancel_lock.take() {
            token.cancel();
        }
        drop(cancel_lock);
        self.teardown_audio_source();
        *self.native_screencast_session_id.write().await = None;
        *self.cached_frame.write().await = None;
        *self.cached_header.write().await = None;
        *self.current_candidate.lock().await = None;
    }

    /// Whether pointer projection against `geometry()` is currently backed by native evidence.
    /// False while an external (raw CDP) mutation is unreconciled or when a native frame's
    /// viewport metadata diverged from the producer geometry; never guessed back to true.
    pub fn input_geometry_trusted(&self) -> bool {
        self.geometry_trusted.load(Ordering::Acquire)
    }

    /// Monotonically advances the unmasked viewport epoch to `target`, clearing any transition
    /// fence. Returns false (stale, dropped) when a newer epoch was already committed.
    fn commit_epoch_monotonic(&self, target: u64) -> bool {
        let target = target & !TRANSITIONAL_EPOCH_MASK;
        let mut current = self.viewport_epoch.load(Ordering::SeqCst);
        loop {
            if (current & !TRANSITIONAL_EPOCH_MASK) > target {
                return false;
            }
            match self.viewport_epoch.compare_exchange(
                current,
                target,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => return true,
                Err(actual) => current = actual,
            }
        }
    }

    /// Synchronously fences frames and trusted input before an external geometry mutation
    /// reaches the browser: frame publication halts, old-geometry caches are dropped and pointer
    /// projection is untrusted. No CDP is issued and no lock is held across an await.
    pub async fn begin_external_geometry_fence(&self) {
        self.external_geometry_fenced.store(true, Ordering::Release);
        let input = crate::api::browser_host::get_or_create_input_manager(&self.browser_session_id).await;
        // Same lock order as `update_geometry` (publish gate, then the input fence gate), and the
        // publication gate is held through the cache clears: a publisher that already passed its
        // epoch check cannot repopulate the caches after the fence.
        let publish = self.publish_gate.lock().await;
        self.fence_generation.fetch_add(1, Ordering::SeqCst);
        let gate = input.begin_geometry_fence().await;
        let current = self.viewport_epoch.load(Ordering::SeqCst);
        self.viewport_epoch
            .store(current | TRANSITIONAL_EPOCH_MASK, Ordering::SeqCst);
        self.geometry_trusted.store(false, Ordering::Release);
        drop(gate);
        self.screenshot_taken_in_epoch.store(false, Ordering::SeqCst);
        *self.current_candidate.lock().await = None;
        *self.cached_frame.write().await = None;
        *self.cached_header.write().await = None;
        drop(publish);
    }

    /// Restores the pre-transition authority of `update_geometry` iff this transition still owns the
    /// viewport: no fence began or committed since `generation` was taken and the epoch is still
    /// `expected_epoch` (compare-exchanged to `old_epoch`). Runs under the publication gate (an
    /// external fence begins under it) and the geometry lock (its commit writes under it), so a
    /// fence is either wholly before this restore (it is skipped, nothing is touched) or wholly
    /// after it (the fence overwrites the restored state). Returns whether anything was restored.
    #[allow(clippy::too_many_arguments)]
    async fn restore_authority_if_owner(
        &self,
        generation: u64,
        expected_epoch: u64,
        old_epoch: u64,
        geometry: Option<&TargetGeometry>,
        trusted: bool,
        candidate: Option<EncodedCandidate>,
        frame: Option<TrackedBhjfFrame>,
        header: Option<TargetFrameHeader>,
    ) -> bool {
        let _publish = self.publish_gate.lock().await;
        let mutation = self.begin_quality_mutation();
        let mut current = self.geometry.write().await;
        if self.fence_generation.load(Ordering::SeqCst) != generation
            || self
                .viewport_epoch
                .compare_exchange(expected_epoch, old_epoch, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
        {
            drop(current);
            mutation.discard();
            return false;
        }
        match geometry {
            Some(geometry) if *current != *geometry => {
                *current = geometry.clone();
                drop(current);
                drop(mutation);
            }
            _ => {
                drop(current);
                mutation.discard();
            }
        }
        self.geometry_trusted.store(trusted, Ordering::Release);
        *self.cached_frame.write().await = frame;
        *self.cached_header.write().await = header;
        *self.current_candidate.lock().await = candidate;
        true
    }

    /// Commits the registry-assigned epoch of an external geometry mutation. Reported geometry
    /// is adopted as the pointer-projection basis but stays untrusted until a native frame's
    /// viewport metadata confirms it; without usable metrics the old geometry stays untrusted.
    pub async fn commit_external_geometry_fence(&self, epoch: u64, reported: Option<TargetGeometry>) {
        // A rejected (stale) commit changes nothing and must not bump the generation: that would
        // make a concurrent resize refuse to restore and strand the producer fenced. An accepted
        // commit bumps it after the epoch changed (a restore's epoch compare-exchange already
        // fails from that moment on).
        if !self.commit_epoch_monotonic(epoch) {
            return;
        }
        self.fence_generation.fetch_add(1, Ordering::SeqCst);
        if let Some(geometry) = reported.filter(|g| g.validate().is_ok()) {
            let mutation = self.begin_quality_mutation();
            let mut current = self.geometry.write().await;
            if *current == geometry {
                drop(current);
                mutation.discard();
            } else {
                *current = geometry;
                drop(current);
                drop(mutation);
            }
        }
        // Stays false: only a confirming native frame (`publish_governed_candidate`) re-trusts.
        self.geometry_trusted.store(false, Ordering::Release);
    }

    /// The engine can drop its emulated viewport behind the producer's back (observed after a
    /// document navigation: frames revert to the default window size). Disagreement revokes input
    /// trust, and a static page emits no further frame that could re-establish it, so the producer
    /// re-runs its own geometry transition (override + forced screencast restart) at the
    /// unchanged geometry and epoch. Skipped once a raw agent has fenced the geometry (that disagreement is
    /// the agent's intent), and bounded per disagreement.
    fn schedule_native_geometry_repair(&self) {
        if !self.native_geometry_repair_enabled.load(Ordering::Acquire)
            || self.external_geometry_fenced.load(Ordering::Acquire)
            || self.native_geometry_repairs.load(Ordering::Relaxed) >= MAX_NATIVE_GEOMETRY_REPAIRS
            || self.native_geometry_repair_in_flight.swap(true, Ordering::AcqRel)
        {
            return;
        }
        let this = self.clone_handle();
        tokio::spawn(async move {
            // Debounce: a confirming native frame inside the window restores trust by evidence
            // and cancels the repair; only a disagreement that persists is repaired.
            tokio::time::sleep(NATIVE_GEOMETRY_REPAIR_DEBOUNCE).await;
            if !this.input_geometry_trusted() && !this.external_geometry_fenced.load(Ordering::Acquire) {
                this.native_geometry_repairs.fetch_add(1, Ordering::Relaxed);
                if let Err(e) = this.repair_native_viewport().await {
                    warn!(error = %e, "native geometry repair failed");
                }
            }
            this.native_geometry_repair_in_flight.store(false, Ordering::Release);
        });
    }

    /// Applies a requested viewport at the registry-assigned `target_epoch`.
    ///
    /// Lifecycle operations serialize before state and page setup; geometry/cache locks are
    /// taken for short sections. The operation gate keeps the Page session stable through commit.
    pub async fn update_geometry(
        &self,
        new_geometry: TargetGeometry,
        target_epoch: u64,
    ) -> Result<(), String> {
        self.run_geometry_transition(new_geometry, target_epoch, false).await
    }

    /// Re-establishes the native viewport at unchanged geometry/epoch, restarting the screencast
    /// even though no dimension changed (see `schedule_native_geometry_repair`).
    async fn repair_native_viewport(&self) -> Result<(), String> {
        let geometry = self.geometry.read().await.clone();
        self.run_geometry_transition(geometry, self.viewport_epoch(), true).await
    }

    async fn run_geometry_transition(
        &self,
        new_geometry: TargetGeometry,
        target_epoch: u64,
        force_restart: bool,
    ) -> Result<(), String> {
        // Owned by its own task: a caller that goes away mid-transition (e.g. a dropped REST
        // request) must not strand the transitional epoch or a half-restarted screencast.
        let this = self.clone_handle();
        tokio::spawn(async move {
            this.update_geometry_serialized(new_geometry, target_epoch, force_restart).await
        })
        .await
        .map_err(|e| format!("geometry transition task failed: {e}"))?
    }

    async fn update_geometry_serialized(
        &self,
        new_geometry: TargetGeometry,
        target_epoch: u64,
        force_restart: bool,
    ) -> Result<(), String> {
        new_geometry
            .validate()
            .map_err(|e| format!("invalid geometry: {e}"))?;
        let _operation = self.lifecycle_operation.lock().await;
        let mut state = self.state.write().await;
        let setup = self.page_setup.lock().await;
        let old_geom = self.geometry.read().await.clone();
        let old_epoch = self.viewport_epoch() & !TRANSITIONAL_EPOCH_MASK;
        if old_geom == new_geometry
            && old_epoch == (target_epoch & !TRANSITIONAL_EPOCH_MASK)
            && self.input_geometry_trusted()
        {
            return Ok(());
        }

        // Save COMPLETE pre-transition state (including None)
        // Frame publication is fenced against this transition: no frame can be committed with the
        // old epoch after the caches below are taken, nor carry the transitional marker.
        let publish = self.publish_gate.lock().await;
        let my_gen = self.fence_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let prev_candidate = self.current_candidate.lock().await.take();
        let prev_cached_frame = self.cached_frame.write().await.take();
        let prev_cached_header = self.cached_header.write().await.take();
        let prev_trusted = self.input_geometry_trusted();

        // (a) Fence frame publication and trusted input geometry for the whole transition
        let input = crate::api::browser_host::get_or_create_input_manager(&self.browser_session_id).await;
        let gate = input.begin_geometry_fence().await;
        self.viewport_epoch
            .store(old_epoch | TRANSITIONAL_EPOCH_MASK, Ordering::SeqCst);
        self.geometry_trusted.store(false, Ordering::Release);
        drop(gate);
        self.screenshot_taken_in_epoch
            .store(false, Ordering::SeqCst);
        drop(publish);

        let page_sid_opt = self.page_session_id.read().await.clone();
        if let Some(page_sid) = page_sid_opt.as_ref() {
            let emu_params = serde_json::json!({
                "width": new_geometry.css_width.round() as u32,
                "height": new_geometry.css_height.round() as u32,
                "deviceScaleFactor": new_geometry.dpr,
                "mobile": false,
            });
            if let Err(e) = self
                .cdp_client
                .send_command(
                    "Emulation.setDeviceMetricsOverride",
                    Some(emu_params),
                    Some(page_sid),
                )
                .await
            {
                // Override failed before modifying native state. Restore complete cache state.
                // Nothing changed natively. Restore the snapshot unless a newer fence took over.
                let _ = self
                    .restore_authority_if_owner(
                        my_gen,
                        old_epoch | TRANSITIONAL_EPOCH_MASK,
                        old_epoch,
                        None,
                        prev_trusted,
                        prev_candidate,
                        prev_cached_frame,
                        prev_cached_header,
                    )
                    .await;
                return Err(format!("Emulation.setDeviceMetricsOverride failed: {e}"));
            }
        }

        let dims_changed = old_geom.css_width != new_geometry.css_width
            || old_geom.css_height != new_geometry.css_height;

        // A running screencast cannot be reconfigured in place: Chromium refuses a second
        // `Page.startScreencast` while one is active ("Screencast is already active") and numbers
        // native sessions per start. A dimension change therefore restarts it as a fresh run
        // (stop -> start), exactly like a capture-tier switch. Stop first: a failed stop leaves
        // the live run untouched, so only the native metrics override has to be rolled back.
        let restart_run = (dims_changed || force_restart)
            && *state == ScreencastState::Streaming
            && page_sid_opt.is_some();
        if restart_run {
            let page_sid = page_sid_opt.as_deref().unwrap_or_default();
            if let Err(e) = self.stop_and_retire_run_locked(&mut state, page_sid).await {
                // The live run is untouched (stop failed), so only the native override and the
                // epoch/trust/caches have to be rolled back, and only while a newer fence (raw
                // CDP) has not taken over the viewport.
                if self.fence_generation.load(Ordering::SeqCst) != my_gen {
                    return Err(format!(
                        "Page.stopScreencast before restart failed ({e}); a newer geometry fence owns the viewport"
                    ));
                }
                let rollback_res = self
                    .cdp_client
                    .send_command(
                        "Emulation.setDeviceMetricsOverride",
                        Some(serde_json::json!({
                            "width": old_geom.css_width.round() as u32,
                            "height": old_geom.css_height.round() as u32,
                            "deviceScaleFactor": old_geom.dpr,
                            "mobile": false,
                        })),
                        Some(page_sid),
                    )
                    .await;
                if rollback_res.is_err() {
                    self.retire_locked(&mut state).await;
                    return Err(format!(
                        "Page.stopScreencast before restart failed ({e}) and native rollback command failed; producer retired"
                    ));
                }
                let restored = self
                    .restore_authority_if_owner(
                        my_gen,
                        old_epoch | TRANSITIONAL_EPOCH_MASK,
                        old_epoch,
                        None,
                        prev_trusted,
                        prev_candidate,
                        prev_cached_frame,
                        prev_cached_header,
                    )
                    .await;
                if !restored {
                    return Err(format!(
                        "Page.stopScreencast before restart failed ({e}); a newer geometry fence owns the viewport"
                    ));
                }
                return Err(format!("Page.stopScreencast before restart failed: {e}"));
            }
        }

        // Transition succeeded! Commit new geometry and the registry-assigned epoch. A newer
        // epoch (a raw-CDP fence that raced this command) wins: the stale commit is dropped.
        let owns_epoch = self.commit_epoch_monotonic(target_epoch);
        if owns_epoch {
            let mutation = self.begin_quality_mutation();
            let mut current = self.geometry.write().await;
            if *current == new_geometry {
                drop(current);
                mutation.discard();
            } else {
                *current = new_geometry.clone();
                drop(current);
                drop(mutation);
            }
            // The override just succeeded natively; the next native frame's metadata re-verifies.
            self.geometry_trusted.store(true, Ordering::Release);
        }
        // Otherwise a newer epoch won: its commit already overwrote this transition's marker, and
        // whatever epoch encoding is current (e.g. a successor fence's transitional bit) belongs to
        // the winner and is left untouched.
        if restart_run {
            // Geometry and epoch are committed: start the fresh run at the new size. Session setup
            // is released first; starting a run takes it again.
            drop(setup);
            if let Err(e) = self.start_run_locked(&mut state).await {
                // Roll back to the proven geometry only while this transition still owns the
                // viewport. A newer fence's authority is never overwritten: then just restart at
                // its geometry. Ownership is re-verified atomically with the restore itself.
                let mut owned = owns_epoch && self.fence_generation.load(Ordering::SeqCst) == my_gen;
                let mut rollback_ok = true;
                if owned {
                    let page_sid = page_sid_opt.as_deref().unwrap_or_default();
                    rollback_ok = self
                        .cdp_client
                        .send_command(
                            "Emulation.setDeviceMetricsOverride",
                            Some(serde_json::json!({
                                "width": old_geom.css_width.round() as u32,
                                "height": old_geom.css_height.round() as u32,
                                "deviceScaleFactor": old_geom.dpr,
                                "mobile": false,
                            })),
                            Some(page_sid),
                        )
                        .await
                        .is_ok();
                    owned = self
                        .restore_authority_if_owner(
                            my_gen,
                            target_epoch,
                            old_epoch,
                            Some(&old_geom),
                            prev_trusted,
                            prev_candidate,
                            prev_cached_frame,
                            prev_cached_header,
                        )
                        .await;
                }
                if !owned {
                    if self.start_run_locked(&mut state).await.is_err() {
                        self.retire_locked(&mut state).await;
                    }
                    return Err(format!(
                        "Page.startScreencast restart failed ({e}); a newer geometry fence owns the viewport"
                    ));
                }
                let restarted = rollback_ok && self.start_run_locked(&mut state).await.is_ok();
                if !restarted {
                    self.retire_locked(&mut state).await;
                    return Err(format!(
                        "screencast restart failed ({e}) and native rollback command failed; producer retired"
                    ));
                }
                return Err(format!("Page.startScreencast restart failed: {e}"));
            }
        }
        if !dims_changed {
            *self.cached_frame.write().await = prev_cached_frame;
            *self.cached_header.write().await = prev_cached_header;
        }
        Ok(())
    }



    /// Attach a dedicated flattened Page session for this target if not already attached.
    pub async fn ensure_page_session(&self) -> Result<String, CdpError> {
        let _setup = self.page_setup.lock().await;
        if self.selection_gap.lock().await.is_some() {
            return Err(CdpError::ConnectionClosed);
        }
        if self.page_session_poisoned.load(Ordering::Acquire) {
            return Err(CdpError::ConnectionClosed);
        }
        if let Some(session_id) = self.page_session_id.read().await.clone() {
            return Ok(session_id);
        }
        self.page_session_poisoned.store(true, Ordering::Release);
        match self.attach_page_session_locked().await {
            Ok(session_id) => {
                self.page_session_poisoned.store(false, Ordering::Release);
                Ok(session_id)
            }
            Err(error) => {
                self.close_ambiguous_page_actor().await?;
                Err(error)
            }
        }
    }

    /// Session to start a run on: a lost actor is re-established first (the same path recovery
    /// takes), otherwise the existing dedicated Page session is reused.
    async fn session_for_start(&self) -> Result<String, CdpError> {
        let gap_pending = self.selection_gap.lock().await.is_some();
        if self.cdp_client.is_closed()
            || self.page_session_poisoned.load(Ordering::Acquire)
            || gap_pending
        {
            return self.open_fresh_page_session_locked().await;
        }
        self.ensure_page_session().await
    }

    /// Attaches the dedicated Page session. Caller holds `page_setup`.
    async fn attach_page_session_locked(&self) -> Result<String, CdpError> {
        let attach_params = AttachToTargetParams::builder()
            .target_id(self.target_id.clone())
            .flatten(true)
            .build()
            .map_err(|e| CdpError::Protocol {
                code: -1,
                message: format!("failed to build AttachToTargetParams: {e}"),
            })?;

        let res = self.cdp_client.send_typed(attach_params, None).await?;
        let session_id: String = res.session_id.into();

        // Enable Page domain
        self.cdp_client
            .send_typed(EnableParams::default(), Some(&session_id))
            .await?;

        // Input fractions are expanded using this CSS viewport. Install it before exposing
        // the Page session; otherwise Chrome's default window size is captured while input
        // is dispatched against the requested (but never applied) dimensions.
        // Snapshot under the data lock, then drop it: no geometry lock spans the CDP await.
        let geometry = self.geometry.read().await.clone();
        self.cdp_client
            .send_command(
                "Emulation.setDeviceMetricsOverride",
                Some(serde_json::json!({
                    "width": geometry.css_width.round() as u32,
                    "height": geometry.css_height.round() as u32,
                    "deviceScaleFactor": geometry.dpr,
                    "mobile": false,
                })),
                Some(&session_id),
            )
            .await?;

        let mut lock = self.page_session_id.write().await;
        *lock = Some(session_id.clone());
        self.nav_listener.set_page_session_id(&session_id);
        Ok(session_id)
    }

    /// Applies Chrome identity, focus emulation, document-start anti-detection preload, and
    /// cross-origin OOPIF (`iframe`) stealth propagation before the first managed navigation.
    pub async fn apply_stealth_and_focus(&self, session_id: &str) -> Result<(), CdpError> {
        use super::cdp::CdpTargetEvent;
        use super::stealth::ChromeIdentity;

        let version_raw = self
            .cdp_client
            .send_command("Browser.getVersion", None, None)
            .await
            .ok()
            .and_then(|v| {
                v.get("userAgent")
                    .or_else(|| v.get("product"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            });
        let identity = ChromeIdentity::from_version_str(version_raw.as_deref());
        let ua_params = identity.user_agent_override_params();
        apply_stealth_to_session(&self.cdp_client, session_id, &ua_params).await?;

        let mut target_events = self.cdp_client.subscribe_target_events();
        self.cdp_client
            .send_command(
                "Target.setAutoAttach",
                Some(serde_json::json!({
                    "autoAttach": true,
                    "waitForDebuggerOnStart": false,
                    "flatten": true,
                    "filter": [{ "type": "iframe" }, { "exclude": true }],
                })),
                Some(session_id),
            )
            .await?;
        let weak_client = Arc::downgrade(&self.cdp_client);
        // One listener per producer: a replacement Page session retires the previous listener.
        let listener_cancel = CancellationToken::new();
        if let Some(previous) = self.stealth_listener.lock().replace(listener_cancel.clone()) {
            previous.cancel();
        }
        tokio::spawn(async move {
            loop {
                let received = tokio::select! {
                    _ = listener_cancel.cancelled() => break,
                    received = target_events.recv() => received,
                };
                match received {
                    Ok(ev) => {
                        if let CdpTargetEvent::ChildAttached {
                            session_id: child_sid,
                            info,
                            waiting_for_debugger,
                            ..
                        } = &*ev
                        {
                            let Some(client) = weak_client.upgrade() else {
                                break;
                            };
                            if info.target_type == "iframe" {
                                let _ = client
                                    .send_command("Page.enable", None, Some(child_sid))
                                    .await;
                                let _ = apply_stealth_to_session(&client, child_sid, &ua_params).await;
                                let _ = client
                                    .send_command(
                                        "Target.setAutoAttach",
                                        Some(serde_json::json!({
                                            "autoAttach": true,
                                            "waitForDebuggerOnStart": false,
                                            "flatten": true,
                                            "filter": [{ "type": "iframe" }, { "exclude": true }],
                                        })),
                                        Some(child_sid),
                                    )
                                    .await;
                            }
                            if *waiting_for_debugger {
                                let _ = client
                                    .send_command(
                                        "Runtime.runIfWaitingForDebugger",
                                        None,
                                        Some(child_sid),
                                    )
                                    .await;
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        Ok(())
    }

    /// Register or update viewer demand for a subscription epoch.
    pub async fn register_viewer_demand(
        &self,
        viewer_id: &str,
        subscription_epoch: &str,
        visible: bool,
    ) {
        let mut viewers = self.viewers.write().await;
        let entry = viewers
            .entry(subscription_epoch.to_string())
            .or_insert_with(|| ViewerDemand {
                viewer_id: viewer_id.to_string(),
                subscription_epoch: subscription_epoch.to_string(),
                last_heartbeat: Instant::now(),
                visible,
            });
        entry.last_heartbeat = Instant::now();
        entry.visible = visible;
        {
            let mut adaptive = self.adaptive.lock();
            let (source_run, seq) = self.audio_boundary();
            adaptive.register_with_seq(subscription_epoch, Instant::now(), source_run, seq);
        }
        let visible_count = viewers.values().filter(|v| v.visible).count();
        drop(viewers);

        if visible_count > 0 {
            // A native start/stop holds the state lock for as long as Chromium takes to answer, so
            // the "is it stopped?" decision is made on its own task: a viewer attaching during a slow
            // start must not wait on it (up to the 10s command timeout).
            let this = self.clone_handle();
            let epoch = self.recovery.epoch.load(Ordering::SeqCst);
            tokio::spawn(async move {
                if *this.state.read().await != ScreencastState::Stopped {
                    return;
                }
                this.ledger.demand_starts.fetch_add(1, Ordering::Relaxed);
                let _operation = this.lifecycle_operation.lock().await;
                if this.recovery.epoch.load(Ordering::SeqCst) != epoch
                    || this.visible_viewer_count().await == 0
                {
                    return;
                }
                if let Err(e) = this.start_with_operation().await {
                    warn!(error = %e, "failed to start screencast on demand");
                }
            });
        }
    }

    /// Record heartbeat from viewer.
    pub async fn heartbeat(&self, subscription_epoch: &str, visible: bool) {
        let mut viewers = self.viewers.write().await;
        if let Some(demand) = viewers.get_mut(subscription_epoch) {
            demand.last_heartbeat = Instant::now();
            demand.visible = visible;
        }
    }

    /// Remove viewer demand (on disconnect or pause).
    pub async fn remove_viewer_demand(&self, subscription_epoch: &str) {
        let mut viewers = self.viewers.write().await;
        viewers.remove(subscription_epoch);
        self.adaptive.lock().remove(subscription_epoch);
        let visible_count = viewers.values().filter(|v| v.visible).count();
        drop(viewers);

        if visible_count == 0 {
            let this = self.clone_handle();
            tokio::spawn(async move {
                this.stop_screencast_due_to_zero_demand().await;
            });
        }
    }

    /// Checks if any viewers have expired (> 15s without heartbeat) and stops screencast if zero visible demand remains.
    pub async fn check_viewer_expiry(&self) {
        let now = Instant::now();
        let mut viewers = self.viewers.write().await;
        let expired: Vec<String> = viewers
            .iter()
            .filter(|(_, v)| now.duration_since(v.last_heartbeat) > VISIBLE_DEMAND_EXPIRY)
            .map(|(k, _)| k.clone())
            .collect();
        viewers.retain(|_, v| now.duration_since(v.last_heartbeat) <= VISIBLE_DEMAND_EXPIRY);
        if !expired.is_empty() {
            let mut adaptive = self.adaptive.lock();
            for sub in &expired {
                adaptive.remove(sub);
            }
        }
        let visible_count = viewers.values().filter(|v| v.visible).count();
        drop(viewers);

        if visible_count == 0 {
            let state = *self.state.read().await;
            if state == ScreencastState::Streaming || state == ScreencastState::Starting {
                let this = self.clone_handle();
                tokio::spawn(async move {
                    this.stop_screencast_due_to_zero_demand().await;
                });
            }
        }
    }

    pub async fn visible_viewer_count(&self) -> usize {
        let viewers = self.viewers.read().await;
        viewers.values().filter(|v| v.visible).count()
    }

    /// Start screencast run.
    /// Serialized by the lifecycle operation gate. Generates a fresh `producerRun` UUID,
    /// subscribes to the broadcast stream, issues `Page.startScreencast` with
    /// the latest shared capture snapshot, spawns drain and governor tasks.
    pub async fn start_screencast_run(&self) -> Result<Uuid, CdpError> {
        // Owned by its own task: a caller that goes away mid-start must not leave `Starting` and
        // a run id behind without drain/ACK tasks. The transition runs to completion or fails.
        // The recovery epoch is captured HERE, before the spawn: a stop that completes before the
        // child first runs must still cancel this start.
        let epoch = self.recovery.epoch.load(Ordering::SeqCst);
        let this = self.clone_handle();
        tokio::spawn(async move { this.start_screencast_run_serialized(epoch).await })
            .await
            .map_err(|_| CdpError::ConnectionClosed)?
    }

    async fn start_screencast_run_serialized(&self, epoch: u64) -> Result<Uuid, CdpError> {
        let _operation = self.lifecycle_operation.lock().await;
        if self.recovery.epoch.load(Ordering::SeqCst) != epoch {
            return Err(CdpError::ConnectionClosed);
        }
        self.start_with_operation().await
    }

    async fn start_with_operation(&self) -> Result<Uuid, CdpError> {
        let mut state_lock = self.state.write().await;
        let run = self.start_run_locked(&mut state_lock).await?;
        let input = crate::api::browser_host::global_input_managers()
            .read()
            .await
            .get(&self.browser_session_id)
            .cloned();
        if let Some(input) = input {
            input.resume_after_recovery().await;
        }
        Ok(run)
    }

    /// Caller holds both the lifecycle operation gate and the state write lock.
    async fn start_run_locked(&self, state_lock: &mut ScreencastState) -> Result<Uuid, CdpError> {
        self.start_run_replacing_locked(state_lock, None).await
    }

    /// `replaced` is the run a capture switch just retired (fences its stale first frames).
    async fn start_run_replacing_locked(
        &self,
        state_lock: &mut ScreencastState,
        replaced: Option<ReplacedRun>,
    ) -> Result<Uuid, CdpError> {
        if *state_lock == ScreencastState::Streaming || *state_lock == ScreencastState::Starting {
            if let Some(run_id) = *self.current_run.read().await {
                return Ok(run_id);
            }
        }

        *state_lock = ScreencastState::Starting;
        let producer_run = Uuid::new_v4();
        {
            let _mutation = self.begin_quality_mutation();
            *self.current_run.write().await = Some(producer_run);
            *self.current_run_proven.lock() = None;
        }
        *self.native_screencast_session_id.write().await = None;

        let page_session_id = match self.session_for_start().await {
            Ok(sid) => sid,
            Err(e) => {
                *state_lock = ScreencastState::Stopped;
                let _mutation = self.begin_quality_mutation();
                *self.current_run.write().await = None;
                return Err(e);
            }
        };

        // Cancel prior run task if any
        let cancel_token = {
            let mut cancel_lock = self.active_run_cancel.lock().await;
            if let Some(old_cancel) = cancel_lock.take() {
                old_cancel.cancel();
            }
            let token = CancellationToken::new();
            *cancel_lock = Some(token.clone());
            token
        };

        // Subscribe to broadcast receiver BEFORE startScreencast command
        let screencast_rx = self.cdp_client.subscribe_screencast();

        // One snapshot read drives both native parameters and the run's recorded policy.
        let snap = self.capture.current();
        let geom = self.geometry.read().await.clone();
        let screencast_params =
            build_start_params(&snap, self.capture.ceilings(), geom.css_width, geom.css_height);
        // Armed before the native start: a frame can follow it within a millisecond.
        *self.run_fence.lock() = replaced.map(|replaced| SwitchFence {
            replaced,
            bounds: snap.image_bounds(self.capture.ceilings(), geom.css_width, geom.css_height),
        });
        // The audio source exists as soon as the run does (same identity as the first video run).
        let (audio_run, audio_cancel, new_audio_source) = self.ensure_audio_source(producer_run);

        if let Err(e) = self
            .cdp_client
            .send_typed(screencast_params, Some(&page_session_id))
            .await
        {
            *self.run_fence.lock() = None;
            *state_lock = ScreencastState::Stopped;
            {
                let _mutation = self.begin_quality_mutation();
                *self.current_run.write().await = None;
            }
            if new_audio_source {
                self.teardown_audio_source();
            }
            return Err(e);
        }

        self.applied_fps.store(snap.fps, Ordering::Release);
        *self.run_snapshot.lock() = snap;
        *state_lock = ScreencastState::Streaming;
        self.note_run_started(producer_run);

        // Spawn drain & governor tasks for this run
        let this = self.clone_handle();
        let video_sid = page_session_id.clone();
        tokio::spawn(async move {
            this.run_producer_tasks(video_sid, producer_run, screencast_rx, cancel_token)
                .await;
        });
        // Audio drain is independent of video-only restarts; only a new source spawns it.
        if new_audio_source {
            let this = self.clone_handle();
            tokio::spawn(async move {
                this.run_audio_drain_loop(page_session_id, audio_run, audio_cancel)
                    .await;
            });
        }

        Ok(producer_run)
    }

    /// Stops screencast explicitly or due to zero demand.
    /// Retains the final cached frame and does not withhold ACKs.
    pub async fn stop_screencast(&self) -> Result<(), CdpError> {
        // An explicit stop supersedes any recovery still pending for demand that no longer counts.
        self.recovery.cancel();
        if *self.state.read().await == ScreencastState::Stopped
            && (!self.page_session_poisoned.load(Ordering::Acquire) || self.recovery_pending())
        {
            return Ok(());
        }
        let _operation = self.lifecycle_operation.lock().await;
        let mut state_lock = self.state.write().await;
        self.stop_run_locked(&mut state_lock).await
    }

    /// Caller holds the state write lock (the single lifecycle owner).
    async fn stop_run_locked(&self, state_lock: &mut ScreencastState) -> Result<(), CdpError> {
        if *state_lock == ScreencastState::Stopped || *state_lock == ScreencastState::Stopping {
            if self.page_session_poisoned.load(Ordering::Acquire) {
                self.close_ambiguous_page_actor().await?;
            }
            *state_lock = ScreencastState::Stopped;
            return Ok(());
        }

        // The native outcome is ambiguous from here on: poison BEFORE the first await so a caller
        // dropped at any point leaves the Page session poisoned (closed by the next stop/start)
        // instead of a half-stopped run.
        let was_poisoned = self.page_session_poisoned.swap(true, Ordering::AcqRel);
        *state_lock = ScreencastState::Stopping;
        let page_session_id = self.page_session_id.read().await.clone();

        // Retire the run identity before cancelling so ending tasks see a planned stop.
        {
            let _mutation = self.begin_quality_mutation();
            *self.current_run.write().await = None;
            *self.current_run_proven.lock() = None;
        }
        {
            let mut cancel_lock = self.active_run_cancel.lock().await;
            if let Some(token) = cancel_lock.take() {
                token.cancel();
            }
        }
        // Silence immediately even if Chromium never answers the native stop.
        self.teardown_audio_source();

        let stop_result = if let Some(sid) = page_session_id {
            let result = self.cdp_client
                .send_typed(StopScreencastParams::default(), Some(&sid))
                .await;
            if result.is_ok() {
                self.page_session_poisoned.store(false, Ordering::Release);
            }
            result.map(|_| ())
        } else {
            self.page_session_poisoned.store(was_poisoned, Ordering::Release);
            Ok(())
        };

        *state_lock = ScreencastState::Stopped;
        *self.native_screencast_session_id.write().await = None;
        stop_result
    }

    /// Native stop followed by retirement of the run identity, cached pixels and native session
    /// id. A failed stop leaves the live run untouched (nothing is retired, no start is reissued).
    /// Caller holds the lifecycle operation gate and the state write lock.
    async fn stop_and_retire_run_locked(
        &self,
        state_lock: &mut ScreencastState,
        sid: &str,
    ) -> Result<(), CdpError> {
        if let Err(e) = self
            .cdp_client
            .send_typed(StopScreencastParams::default(), Some(sid))
            .await
        {
            // Only an outcome that PROVES the stop did not execute (a browser rejection, or an
            // error raised before anything was sent) leaves the run untouched. A timeout, lost
            // transport or unreadable answer may mean the stop executed: abort the run into
            // recovery instead of assuming it is still running.
            if e.outcome_is_ambiguous() {
                if let Some(run) = *self.current_run.read().await {
                    self.fail_run(run, AbortCause::NativeStopAmbiguous);
                }
            }
            return Err(e);
        }
        {
            let _mutation = self.begin_quality_mutation();
            *self.current_run.write().await = None;
            *self.current_run_proven.lock() = None;
        }
        if let Some(token) = self.active_run_cancel.lock().await.take() {
            token.cancel();
        }
        *self.native_screencast_session_id.write().await = None;
        // Fence old-run work; prior pixels stay client-side display-only until a fresh native frame.
        *self.current_candidate.lock().await = None;
        *self.cached_frame.write().await = None;
        *self.cached_header.write().await = None;
        self.screenshot_taken_in_epoch.store(false, Ordering::SeqCst);
        *state_lock = ScreencastState::Stopped;
        Ok(())
    }

    /// Applies the latest capture snapshot with a fresh native run when JPEG quality or scale
    /// changed. Runs under the state lock (stop -> fresh-run start); the CSS viewport, DPR and
    /// `viewportEpoch` are never touched and audio source authority is preserved.
    /// Returns `Ok(true)` only when a new run actually started.
    pub async fn apply_capture_snapshot(&self) -> Result<bool, CdpError> {
        let _operation = self.lifecycle_operation.lock().await;
        let mut state_lock = self.state.write().await;
        if *state_lock != ScreencastState::Streaming {
            return Ok(false); // the next start reads the latest snapshot
        }
        let target = self.capture.current();
        if target.native_key() == self.run_snapshot.lock().native_key() {
            return Ok(false);
        }
        if self.switch_backoff_until.lock().is_some_and(|t| Instant::now() < t) {
            return Ok(false); // recent failed switch: keep the proven run
        }
        let Some(sid) = self.page_session_id.read().await.clone() else {
            return Ok(false);
        };
        let replaced = {
            let geom = self.geometry.read().await;
            ReplacedRun {
                native_session_id: *self.native_screencast_session_id.read().await,
                bounds: self.run_snapshot.lock().image_bounds(
                    self.capture.ceilings(),
                    geom.css_width,
                    geom.css_height,
                ),
            }
        };
        // Stop first: a failed stop leaves the live run untouched (no active-start reissue).
        if let Err(e) = self.stop_and_retire_run_locked(&mut state_lock, &sid).await {
            *self.switch_backoff_until.lock() = Some(Instant::now() + FAILED_SWITCH_BACKOFF);
            return Err(e);
        }

        match self.start_run_replacing_locked(&mut state_lock, Some(replaced)).await {
            Ok(_) => Ok(true),
            Err(e) => {
                *self.switch_backoff_until.lock() = Some(Instant::now() + FAILED_SWITCH_BACKOFF);
                // Never advertise unapplied settings: fall back to the last proven parameters once.
                {
                    let _mutation = self.begin_quality_mutation();
                    self.capture.revert_to_effective();
                }
                if self.start_run_locked(&mut state_lock).await.is_err() {
                    self.retire_locked(&mut state_lock).await;
                }
                Err(e)
            }
        }
    }

    async fn stop_screencast_due_to_zero_demand(&self) {
        let _operation = self.lifecycle_operation.lock().await;
        let mut state_lock = self.state.write().await;
        if !matches!(*state_lock, ScreencastState::Streaming | ScreencastState::Starting) {
            return;
        }
        // Demand is re-verified under the lifecycle lock: a viewer that attached after this stop
        // was decided (e.g. the run's first heartbeat tick racing attach) must keep the run.
        if self.visible_viewer_count().await > 0 {
            return;
        }
        self.ledger
            .zero_demand_stops
            .fetch_add(1, Ordering::Relaxed);
        if let Err(e) = self.stop_run_locked(&mut state_lock).await {
            warn!(error = %e, "error during zero demand screencast stop");
        }
    }

    /// Background execution of event drain, governor publication, and fallback screenshot check.
    async fn run_producer_tasks(
        self: Arc<Self>,
        page_session_id: String,
        producer_run: Uuid,
        mut screencast_rx: broadcast::Receiver<Arc<ScreencastFrameData>>,
        cancel_token: CancellationToken,
    ) {
        let mut policy_rx = self.capture.subscribe();
        let mut policy_open = true;
        // Ticker and applied cadence come from the same captured snapshot.
        let initial_policy = policy_rx.borrow_and_update().clone();
        self.applied_fps.store(initial_policy.fps, Ordering::Release);
        let mut governor_ticker = create_governor_interval(initial_policy.governor_interval());
        let mut heartbeat_ticker = interval(Duration::from_secs(1));
        let start_time = Instant::now();

        // A snapshot published between run start and this subscription is applied once now.
        if policy_rx.borrow().native_key() != self.run_snapshot.lock().native_key() {
            self.spawn_capture_restart();
        }

        let nav_this = self.clone_handle();
        let nav_cancel = cancel_token.clone();
        let nav_handle = tokio::spawn(async move {
            let mut lifecycle_rx = nav_this.cdp_client.subscribe_events();
            loop {
                tokio::select! {
                    _ = nav_cancel.cancelled() => break,
                    ev = lifecycle_rx.recv() => {
                        match ev {
                            Ok(ev) => {
                                if matches!(&*ev, super::cdp::CdpLifecycleEvent::Overflow) {
                                    nav_this.fence_audio_doc_epoch_on_gap();
                                }
                            }
                            Err(broadcast::error::RecvError::Lagged(_)) => {
                                nav_this.fence_audio_doc_epoch_on_gap();
                            }
                            Err(broadcast::error::RecvError::Closed) => {
                                nav_this.fence_audio_doc_epoch_on_gap();
                                break;
                            }
                        }
                    }
                }
            }
        });

        // Unanswered ACKs of this run are bounded; the ingress receiver itself is bounded by the
        // CDP client's broadcast capacity.
        let acks = Arc::new(Semaphore::new(MAX_ACKS_IN_FLIGHT));
        let mut ingress_gate = self.recovery.ingress_barrier();
        let mut actor_closed = std::pin::pin!(self.cdp_client.closed());
        let mut abort: Option<AbortCause> = None;
        loop {
            tokio::select! {
                _ = cancel_token.cancelled() => {
                    debug!(producer_run = %producer_run, "producer tasks cancelled");
                    break;
                }
                _ = &mut actor_closed => {
                    warn!(producer_run = %producer_run, "CDP actor lost; aborting run");
                    abort = Some(AbortCause::ActorLost);
                    break;
                }
                _ = heartbeat_ticker.tick() => {
                    self.check_viewer_expiry().await;
                    self.run_adaptive_evaluation();
                    // Lost or deferred triggers (e.g. after a failed-switch backoff) converge here.
                    if self.capture.current().native_key() != self.run_snapshot.lock().native_key() {
                        self.spawn_capture_restart();
                    }
                }
                res = async {
                    // Test barrier: parked here, ingress overflows exactly like a stalled consumer.
                    let _ = ingress_gate.wait_for(|held| !*held).await;
                    screencast_rx.recv().await
                } => {
                    match res {
                        Ok(frame_data) => {
                            if let Some(cause) = self.handle_incoming_frame(
                                &page_session_id,
                                producer_run,
                                frame_data,
                                &acks,
                                &cancel_token,
                            ).await {
                                abort = Some(cause);
                                break;
                            }
                        }
                        // Dropped frames took their native ACK obligations with them: the run is
                        // ambiguous, not merely behind.
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            warn!(lagged = n, "screencast ingress lagged; aborting run");
                            abort = Some(AbortCause::IngressLagged(n));
                            break;
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            warn!("screencast ingress closed; aborting run");
                            abort = Some(AbortCause::IngressClosed);
                            break;
                        }
                    }
                }
                changed = policy_rx.changed(), if policy_open => {
                    if changed.is_err() {
                        policy_open = false;
                    } else {
                        let snap = policy_rx.borrow_and_update().clone();
                        // Rebuild the governor (Skip catch-up) on every policy notification.
                        governor_ticker = create_governor_interval(snap.governor_interval());
                        self.applied_fps.store(snap.fps, Ordering::Release);
                        if snap.native_key() == self.run_snapshot.lock().native_key() {
                            if let Some(run) = *self.current_run.read().await {
                                let mutation = self.begin_quality_mutation();
                                let mut applied_lock = self.applied_event_version.lock();
                                if applied_lock.0 == Some(run) && snap.version > applied_lock.1 {
                                    applied_lock.1 = snap.version;
                                    drop(applied_lock);
                                    drop(mutation);
                                } else {
                                    drop(applied_lock);
                                    mutation.discard();
                                }
                            }
                        }
                        if snap.native_key() != self.run_snapshot.lock().native_key() {
                            self.spawn_capture_restart();
                        }
                    }
                }
                _ = governor_ticker.tick() => {
                    // 1. Publish candidate if available
                    self.publish_governed_candidate(producer_run).await;

                    // 2. Check 250ms screenshot fallback
                    if start_time.elapsed() >= SCREENSHOT_FALLBACK_DELAY && self.cached_frame.read().await.is_none() {
                        self.attempt_screenshot_fallback(&page_session_id, producer_run).await;
                    }
                }
            }
        }

        cancel_token.cancel();
        let _ = nav_handle.await;
        if let Some(cause) = abort {
            // The lifecycle owner retires this exact run (if it is still current) and recovers.
            self.fail_run(producer_run, cause);
        } else if *self.current_run.read().await == Some(producer_run) {
            // Unplanned end (neither stopped nor replaced by the lifecycle owner): audio ends with it.
            self.teardown_audio_source();
        }
    }

    /// Coalesced by latest snapshot: `apply_capture_snapshot` rechecks under the state lock.
    fn spawn_capture_restart(&self) {
        let this = self.clone_handle();
        tokio::spawn(async move {
            if let Err(e) = this.apply_capture_snapshot().await {
                warn!(error = %e, "capture tier switch failed");
            }
        });
    }

    /// Single-flight cancellable in-page PCM16 audio drain worker.
    /// Runs independently of the video event drain so slow page evaluations never block ACKs.
    async fn run_audio_drain_loop(
        self: Arc<Self>,
        page_session_id: String,
        producer_run: Uuid,
        cancel_token: CancellationToken,
    ) {
        let mut ticker = interval(AUDIO_DRAIN_INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut doc_auth_rx = self.subscribe_audio_doc_authority();
        let mut doc_watch_open = true;
        let mut last_active_doc = doc_auth_rx.borrow_and_update().committed_epoch;

        loop {
            tokio::select! {
                _ = cancel_token.cancelled() => break,
                changed = doc_auth_rx.changed(), if doc_watch_open => {
                    if changed.is_err() {
                        doc_watch_open = false;
                    } else {
                        let cur_auth = doc_auth_rx.borrow_and_update().clone();
                        if cur_auth.active_committed_epoch() != Some(last_active_doc) {
                            let prev_token = format!("{producer_run}:{last_active_doc}");
                            if let Some(active) = cur_auth.active_committed_epoch() {
                                last_active_doc = active;
                            }
                            let stop_expr = format!(
                                "(() => {{ const f = EventTarget.prototype[Symbol.for('dh.a')]; if (typeof f === 'function') f('stop', '{prev_token}'); }})()"
                            );
                            let _ = self.cdp_client.send_command(
                                "Runtime.evaluate",
                                Some(serde_json::json!({
                                    "expression": stop_expr,
                                    "returnByValue": true,
                                })),
                                Some(&page_session_id),
                            ).await;
                        }
                    }
                }
                _ = ticker.tick() => {
                    if cancel_token.is_cancelled()
                        || self.audio_source_run() != Some(producer_run)
                        || self.cdp_client.is_closed()
                    {
                        break;
                    }
                    if self.visible_viewer_count().await == 0 {
                        continue;
                    }
                    let Some(doc_epoch) = doc_auth_rx.borrow_and_update().active_committed_epoch() else {
                        continue;
                    };
                    last_active_doc = doc_epoch;
                    let run_token = format!("{producer_run}:{doc_epoch}");
                    let drain_expr = format!(
                        "(() => {{ const f = EventTarget.prototype[Symbol.for('dh.a')]; return typeof f === 'function' ? f('drainDoc', '{run_token}') : null; }})()"
                    );
                    let eval_fut = self.cdp_client.send_command(
                        "Runtime.evaluate",
                        Some(serde_json::json!({
                            "expression": drain_expr,
                            "returnByValue": true,
                        })),
                        Some(&page_session_id),
                    );
                    tokio::pin!(eval_fut);
                    let mut nav_aborted = false;
                    let eval_res = loop {
                        tokio::select! {
                            _ = cancel_token.cancelled() => break Err(CdpError::ConnectionClosed),
                            changed = doc_auth_rx.changed(), if doc_watch_open => {
                                if changed.is_err() {
                                    doc_watch_open = false;
                                } else {
                                    nav_aborted = true;
                                    break Err(CdpError::ConnectionClosed);
                                }
                            }
                            res = &mut eval_fut => break res,
                        }
                    };
                    if nav_aborted || !self.audio_doc_authority().is_admissible(doc_epoch) {
                        continue;
                    }
                    let Ok(val) = eval_res else {
                        continue;
                    };
                    if val.get("exceptionDetails").is_some() {
                        continue;
                    }
                    let Some(res_val) = val.pointer("/result/value") else {
                        continue;
                    };
                    let Some(items) = self.parse_and_verify_drain_doc_value(doc_epoch, res_val) else {
                        continue;
                    };
                    for item in items.iter() {
                        if !self.audio_doc_authority().is_admissible(doc_epoch) {
                            break;
                        }
                        let Some(b64) = item.as_str() else {
                            continue;
                        };
                        let _ = self
                            .admit_and_broadcast_audio_chunk(producer_run, doc_epoch, b64)
                            .await;
                    }
                }
            }
        }

        if !self.cdp_client.is_closed() {
            let doc_epoch = self.audio_doc_epoch.load(Ordering::Acquire);
            let run_token = format!("{producer_run}:{doc_epoch}");
            let stop_expr = format!(
                "(() => {{ const f = EventTarget.prototype[Symbol.for('dh.a')]; if (typeof f === 'function') f('stop', '{run_token}'); }})()"
            );
            let _ = tokio::time::timeout(
                Duration::from_millis(200),
                self.cdp_client.send_command(
                    "Runtime.evaluate",
                    Some(serde_json::json!({
                        "expression": stop_expr,
                        "returnByValue": true,
                    })),
                    Some(&page_session_id),
                ),
            )
            .await;
        }
    }

    pub fn audio_doc_authority(&self) -> AudioDocAuthority {
        self.doc_epoch_tx.borrow().clone()
    }

    pub fn audio_doc_epoch(&self) -> u64 {
        self.doc_epoch_tx.borrow().committed_epoch
    }

    pub async fn dispatch_navigation_for_epoch(
        &self,
        epoch: u64,
        method: &str,
        params: Option<serde_json::Value>,
        page_session_id: &str,
    ) -> Result<serde_json::Value, CdpError> {
        self.cdp_client
            .send_navigation_command(method, params, Some(page_session_id), Some(epoch), None)
            .await
    }

    pub async fn dispatch_navigation_for_epoch_with_url(
        &self,
        epoch: u64,
        method: &str,
        params: Option<serde_json::Value>,
        page_session_id: &str,
        expected_url: Option<&str>,
    ) -> Result<serde_json::Value, CdpError> {
        self.cdp_client
            .send_navigation_command(
                method,
                params,
                Some(page_session_id),
                Some(epoch),
                expected_url,
            )
            .await
    }
    pub fn init_audio_doc_epoch(&self, initial_epoch: u64) {
        let ep = initial_epoch.max(1);
        self.doc_epoch_tx.send_if_modified(|auth| {
            if auth.requested_epoch != ep
                || auth.committed_epoch != ep
                || auth.committed_doc_id.is_some()
                || auth.committed_sub_doc_gen != 0
                || !auth.retired_doc_ids.is_empty()
                || !auth.unassigned_requested_epochs.is_empty()
                || !auth.dispatched_navs.is_empty()
                || !auth.unmatched_committed_loaders.is_empty()
                || auth.unclaimed_dispatch_epochs != 0
                || auth.pending_noop_restore.is_some()
            {
                auth.requested_epoch = ep;
                auth.committed_epoch = ep;
                auth.committed_doc_id = None;
                auth.committed_sub_doc_gen = 0;
                auth.retired_doc_ids.clear();
                auth.unassigned_requested_epochs.clear();
                auth.dispatched_navs.clear();
                auth.unmatched_committed_loaders.clear();
                auth.unclaimed_dispatch_epochs = 0;
                auth.pending_noop_restore = None;
                self.audio_doc_epoch.store(ep, Ordering::Release);
                true
            } else {
                false
            }
        });
    }

    pub fn request_audio_doc_epoch(&self, requested_rev: u64) {
        self.doc_epoch_tx.send_if_modified(|auth| {
            if auth.unclaimed_dispatch_epochs > 0 {
                auth.unclaimed_dispatch_epochs -= 1;
                if let Some(unclaimed_nav) = auth.dispatched_navs.iter_mut().find(|d| d.unclaimed) {
                    unclaimed_nav.unclaimed = false;
                    if requested_rev > unclaimed_nav.epoch {
                        unclaimed_nav.epoch = requested_rev;
                    }
                } else if requested_rev > auth.requested_epoch
                    && auth.committed_epoch == auth.requested_epoch
                {
                    auth.requested_epoch = requested_rev;
                    auth.committed_epoch = requested_rev;
                    self.audio_doc_epoch.store(requested_rev, Ordering::Release);
                    return true;
                }
                if requested_rev <= auth.requested_epoch {
                    return true;
                }
            }
            if requested_rev > auth.requested_epoch {
                if auth.committed_epoch == auth.requested_epoch && auth.dispatched_navs.is_empty() {
                    auth.pending_noop_restore = Some(PendingNoopRestore {
                        prev_epoch: auth.committed_epoch,
                        target_epoch: requested_rev,
                        prev_doc_id: auth.committed_doc_id.clone(),
                        prev_sub_doc_gen: auth.committed_sub_doc_gen,
                    });
                } else {
                    auth.pending_noop_restore = None;
                }
                if let Some(prev_doc) = auth.committed_doc_id.take() {
                    retire_doc_id_in_auth(auth, prev_doc);
                }
                auth.committed_sub_doc_gen = 0;
                auth.requested_epoch = requested_rev;
                if auth.unassigned_requested_epochs.len() >= 16 {
                    auth.unassigned_requested_epochs.pop_front();
                }
                auth.unassigned_requested_epochs.push_back(requested_rev);
                self.audio_doc_epoch
                    .store(auth.committed_epoch, Ordering::Release);
                true
            } else {
                false
            }
        });
    }

    /// Resolves an out-of-bounds history action (`target_idx < 0` or `>= entries.len()`) where
    /// `SessionRegistry::history` published `rev` without dispatching a native navigation, even
    /// if the asynchronous session watcher already called `request_audio_doc_epoch(rev)`.
    pub fn resolve_noop_audio_doc_epoch(&self, rev: u64) {
        self.doc_epoch_tx.send_if_modified(|auth| {
            if !auth.dispatched_navs.is_empty() {
                return false;
            }
            if rev > auth.requested_epoch && auth.committed_epoch == auth.requested_epoch {
                auth.requested_epoch = rev;
                auth.committed_epoch = rev;
                self.audio_doc_epoch.store(rev, Ordering::Release);
                return true;
            }
            if auth.requested_epoch == rev && auth.committed_epoch < rev {
                if let Some(restore) = auth.pending_noop_restore.take() {
                    if restore.target_epoch == rev && auth.committed_epoch == restore.prev_epoch {
                        if let Some(pos) = auth
                            .unassigned_requested_epochs
                            .iter()
                            .position(|&e| e == rev)
                        {
                            auth.unassigned_requested_epochs.remove(pos);
                        }
                        if let Some(ref doc) = restore.prev_doc_id {
                            auth.retired_doc_ids.retain(|d| d != doc);
                        }
                        auth.committed_doc_id = restore.prev_doc_id;
                        auth.committed_sub_doc_gen = restore.prev_sub_doc_gen;
                        auth.committed_epoch = rev;
                        self.audio_doc_epoch.store(rev, Ordering::Release);
                        return true;
                    }
                }
            }
            false
        });
    }

    pub fn fence_audio_doc_epoch_on_gap(&self) {
        self.doc_epoch_tx.send_if_modified(|auth| {
            auth.pending_noop_restore = None;
            let next_req = auth
                .requested_epoch
                .max(auth.committed_epoch)
                .saturating_add(1);
            if next_req != auth.requested_epoch {
                if let Some(prev_doc) = auth.committed_doc_id.take() {
                    retire_doc_id_in_auth(auth, prev_doc);
                }
                auth.committed_sub_doc_gen = 0;
                auth.requested_epoch = next_req;
                true
            } else {
                false
            }
        });
    }

    pub fn advance_audio_doc_epoch(&self) -> u64 {
        let prev = self.audio_doc_epoch.load(Ordering::Acquire);
        self.nav_listener
            .on_frame_navigated(Some(&self.target_id), true, None);
        prev
    }

    pub fn commit_same_document_audio_epoch(&self) -> u64 {
        let prev = self.audio_doc_epoch.load(Ordering::Acquire);
        self.nav_listener.on_navigated_within_document(
            Some(&self.target_id),
            Some(&self.target_id),
            None,
            Some("historyApi"),
        );
        prev
    }

    /// Verifies that a document drained via `drainDoc` was not already retired and satisfies
    /// the active document and same-document capture generation authority.
    pub fn verify_drained_document(
        &self,
        expected_epoch: u64,
        doc_id: &str,
        sub_doc_gen: u64,
    ) -> bool {
        if doc_id.is_empty() || doc_id.len() > 128 || sub_doc_gen == 0 {
            return false;
        }
        let mut ok = false;
        self.doc_epoch_tx.send_if_modified(|auth| {
            if !auth.is_admissible(expected_epoch) {
                return false;
            }
            if auth.retired_doc_ids.iter().any(|d| d.as_ref() == doc_id) {
                return false;
            }
            if let Some(ref cur_doc) = auth.committed_doc_id {
                if cur_doc.as_ref() != doc_id {
                    let old = cur_doc.clone();
                    retire_doc_id_in_auth(auth, old);
                    auth.committed_doc_id = Some(Arc::<str>::from(doc_id));
                    auth.committed_sub_doc_gen = sub_doc_gen;
                    ok = true;
                    return true;
                }
                if sub_doc_gen < auth.committed_sub_doc_gen {
                    return false;
                }
                if sub_doc_gen > auth.committed_sub_doc_gen {
                    auth.committed_sub_doc_gen = sub_doc_gen;
                    ok = true;
                    return true;
                }
                ok = true;
                return false;
            }
            auth.committed_doc_id = Some(Arc::<str>::from(doc_id));
            auth.committed_sub_doc_gen = sub_doc_gen;
            ok = true;
            true
        });
        ok
    }

    pub fn parse_and_verify_drain_doc_value<'a>(
        &self,
        doc_epoch: u64,
        res_val: &'a serde_json::Value,
    ) -> Option<&'a Vec<serde_json::Value>> {
        let obj = res_val.as_object()?;
        let doc_id = obj.get("docId").and_then(serde_json::Value::as_str)?;
        let sub_doc_gen = obj.get("subDocGen").and_then(serde_json::Value::as_u64)?;
        let items = obj.get("chunks").and_then(serde_json::Value::as_array)?;
        if items.len() > 2 {
            return None;
        }
        if !self.verify_drained_document(doc_epoch, doc_id, sub_doc_gen) {
            return None;
        }
        Some(items)
    }
    pub fn subscribe_audio_doc_authority(&self) -> tokio::sync::watch::Receiver<AudioDocAuthority> {
        self.doc_epoch_tx.subscribe()
    }

    /// Validates a single base64-encoded 24 kHz mono PCM16LE chunk against the caller's
    /// captured `(producer_run, expected_doc_epoch)` and publishes it to current-run subscribers.
    pub async fn admit_and_broadcast_audio_chunk(
        &self,
        audio_run: Uuid,
        expected_doc_epoch: u64,
        b64: &str,
    ) -> Option<ProducerAudioChunk> {
        if b64.is_empty() || b64.len() > MAX_AUDIO_BASE64_BYTES {
            return None;
        }
        if !self.audio_doc_authority().is_admissible(expected_doc_epoch)
            || self.visible_viewer_count().await == 0
        {
            return None;
        }
        // Chunks are counted by the live source they belong to; a stale/foreign run is rejected here.
        let source_seq = self
            .audio_source
            .lock()
            .as_ref()
            .filter(|s| s.run == audio_run && !s.cancel.is_cancelled())
            .map(|s| s.seq.clone())?;
        let reservation = global_memory_controller()
            .try_reserve(b64.len() + 256)
            .ok()?;
        let decoded = BASE64_STANDARD.decode(b64).ok()?;
        if decoded.is_empty() || decoded.len() % 2 != 0 || decoded.len() > MAX_AUDIO_PCM_BYTES {
            return None;
        }
        if !self.audio_doc_authority().is_admissible(expected_doc_epoch) {
            return None;
        }
        let prev_seq = source_seq
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_add(1))
            .ok()?;
        let seq = prev_seq + 1;
        let chunk = ProducerAudioChunk {
            browser_session_id: self.browser_session_id.clone(),
            browser_incarnation: self.browser_incarnation.clone(),
            profile_epoch: self.profile_epoch.to_string(),
            audio_run: audio_run.to_string(),
            doc_epoch: expected_doc_epoch,
            audio_seq: seq.to_string(),
            sample_rate: AUDIO_SAMPLE_RATE,
            channels: AUDIO_CHANNELS,
            encoding: AUDIO_ENCODING_PCM16LE.to_string(),
            data: Arc::<str>::from(b64),
            reservation: Some(Arc::new(reservation)),
        };
        let _ = self.audio_broadcast.send(chunk.clone());
        Some(chunk)
    }
    /// Process a single incoming screencast frame:
    /// - Validate length / bounds first.
    /// - Check session / run.
    /// - Enqueue ACK immediately (even if replaced / dropped).
    /// - Atomically replace candidate.
    async fn handle_incoming_frame(
        &self,
        expected_page_session: &str,
        expected_producer_run: Uuid,
        frame_data: Arc<ScreencastFrameData>,
        acks: &Arc<Semaphore>,
        run_cancel: &CancellationToken,
    ) -> Option<AbortCause> {
        self.ledger.events_received.fetch_add(1, Ordering::Relaxed);
        global_stream_diagnostics()
            .events_received
            .fetch_add(1, Ordering::Relaxed);

        // Verify that this event belongs to our Page session
        if frame_data.session_id != expected_page_session {
            self.ledger
                .events_dropped_old_run
                .fetch_add(1, Ordering::Relaxed);
            return None;
        }

        // Check if current run matches
        let cur_run = *self.current_run.read().await;
        if cur_run != Some(expected_producer_run) {
            self.ledger
                .events_dropped_old_run
                .fetch_add(1, Ordering::Relaxed);
            return None;
        }

        // A frame that cannot be admitted leaves its native credit stranded: fatal for the run.
        if frame_data.data_base64.len() > MAX_BASE64_BYTES {
            warn!(
                len = frame_data.data_base64.len(),
                "screencast base64 frame exceeded maximum size"
            );
            return Some(AbortCause::OversizeFrame);
        }

        // Establish or verify native sessionId
        let frame_session_id = frame_data.frame_session_id;
        let mut retired_session = false;
        {
            let mut native_sess = self.native_screencast_session_id.write().await;
            if let Some(expected_native) = *native_sess {
                if frame_session_id < expected_native {
                    // A frame of an earlier native session (stale after a restart): Chromium no
                    // longer tracks credit for it, so dropping it strands nothing.
                    debug!(
                        expected = expected_native,
                        got = frame_session_id,
                        "stale native session frame on current run; dropping event"
                    );
                    return None;
                }
                if frame_session_id > expected_native {
                    // A newer native session on this run can only come from an unplanned native
                    // restart: its ACK obligations are unaccounted for. Fail the run (recover with
                    // a fresh run/session) instead of dropping frames silently forever.
                    warn!(
                        expected = expected_native,
                        got = frame_session_id,
                        "native screencast session changed under the current run; aborting run"
                    );
                    return Some(AbortCause::NativeSessionChanged);
                }
            } else if self
                .run_fence
                .lock()
                .is_some_and(|fence| fence.is_retired_session(frame_session_id))
            {
                // First frame of a fresh switch run, but of the retired native session: it must
                // not become this run's native session (the real frames would then look like an
                // unplanned native restart). Dropped below, after its ACK.
                retired_session = true;
            } else {
                *native_sess = Some(frame_session_id);
            }
        }

        // Exactly one ACK attempt per accepted current-run event, queued right now: neither the
        // answer to an earlier ACK nor any viewer credit participates. The queue and the number
        // of unanswered ACKs are bounded; hitting either bound is fatal, never deferred.
        let Ok(permit) = acks.clone().try_acquire_owned() else {
            self.ledger.acks_failed.fetch_add(1, Ordering::Relaxed);
            return Some(AbortCause::AckBacklog);
        };
        match self
            .cdp_client
            .enqueue_screencast_ack(expected_page_session, frame_session_id)
        {
            Ok(pending) => {
                self.ledger.acks_enqueued.fetch_add(1, Ordering::Relaxed);
                global_stream_diagnostics()
                    .acks_enqueued
                    .fetch_add(1, Ordering::Relaxed);
                self.watch_ack(expected_producer_run, pending, permit, run_cancel.clone());
            }
            Err(e) => {
                self.ledger.acks_failed.fetch_add(1, Ordering::Relaxed);
                global_stream_diagnostics()
                    .acks_failed
                    .fetch_add(1, Ordering::Relaxed);
                warn!(error = %e, frame_session_id, "failed to enqueue screencast frame ACK");
                return Some(AbortCause::AckEnqueue(e));
            }
        }
        if retired_session {
            self.ledger
                .events_dropped_old_run
                .fetch_add(1, Ordering::Relaxed);
            debug!(got = frame_session_id, "retired native session frame on a fresh switch run; dropping event");
            return None;
        }
        // Over the payload budget: the ACK above keeps native credit flowing; the frame is dropped.
        if !frame_data.memory_admitted {
            global_stream_diagnostics()
                .events_dropped
                .fetch_add(1, Ordering::Relaxed);
            debug!("dropping screencast frame: payload memory budget exhausted at ingress");
            return None;
        }
        // Extract metadata geometry if present and valid
        let metadata_geometry = self.extract_geometry_from_metadata(&frame_data.metadata);
        let diag = global_stream_diagnostics();
        diag.last_server_receipt_unix_ms
            .store(frame_data.server_received_unix_ms, Ordering::Relaxed);
        if let Some(native_ms) = frame_data.native_capture_time_unix_ms {
            diag.last_native_capture_unix_ms
                .store(native_ms, Ordering::Relaxed);
            diag.native_capture_timestamps_valid
                .fetch_add(1, Ordering::Relaxed);
        } else {
            diag.native_capture_timestamps_unavailable
                .fetch_add(1, Ordering::Relaxed);
        }

        let candidate = EncodedCandidate {
            _frame_session_id: frame_session_id,
            native_capture_time_unix_ms: frame_data.native_capture_time_unix_ms,
            server_received_unix_ms: frame_data.server_received_unix_ms,
            received_at: frame_data.received_at,
            metadata_geometry,
            producer_run: expected_producer_run,
            viewport_epoch: self.viewport_epoch.load(Ordering::Relaxed),
            frame: frame_data,
        };
        // Replace candidate atomically
        let mut cand_lock = self.current_candidate.lock().await;
        if cand_lock.is_some() {
            self.ledger
                .events_dropped_overwritten
                .fetch_add(1, Ordering::Relaxed);
            global_stream_diagnostics()
                .events_dropped
                .fetch_add(1, Ordering::Relaxed);
        }
        *cand_lock = Some(candidate);
        self.ledger.events_admitted.fetch_add(1, Ordering::Relaxed);
        global_stream_diagnostics()
            .events_admitted
            .fetch_add(1, Ordering::Relaxed);
        None
    }

    fn extract_geometry_from_metadata(&self, meta: &serde_json::Value) -> Option<TargetGeometry> {
        let obj = meta.as_object()?;
        let offset_top = obj.get("offsetTop")?.as_f64()?;
        let page_scale = obj.get("pageScaleFactor")?.as_f64()?;
        let css_width = obj.get("deviceWidth")?.as_f64()?;
        let css_height = obj.get("deviceHeight")?.as_f64()?;
        let scroll_x = obj.get("scrollOffsetX")?.as_f64()?;
        let scroll_y = obj.get("scrollOffsetY")?.as_f64()?;

        let geom = TargetGeometry {
            css_width,
            css_height,
            offset_top,
            scroll_x,
            scroll_y,
            page_scale,
            visual_offset_x: 0.0,
            visual_offset_y: 0.0,
            dpr: 1.0,
        };
        if geom.validate().is_ok() {
            Some(geom)
        } else {
            None
        }
    }

    /// Governor tick: if an encoded candidate is waiting, decode it once, construct BHJF frame, and publish.
    async fn publish_governed_candidate(&self, producer_run: Uuid) {
        let candidate = {
            let mut cand_lock = self.current_candidate.lock().await;
            cand_lock.take()
        };
        let Some(candidate) = candidate else {
            return;
        };

        let v_epoch = self.viewport_epoch.load(Ordering::Relaxed);
        if (v_epoch & TRANSITIONAL_EPOCH_MASK) != 0 {
            debug!("dropping candidate: viewport transition in progress");
            return;
        }
        if candidate.producer_run != producer_run || candidate.viewport_epoch != v_epoch {
            debug!("dropping candidate from older run or epoch");
            return;
        }
        if *self.current_run.read().await != Some(producer_run) {
            debug!("dropping candidate: producer run retired");
            return;
        }
        let run_snap = self.run_snapshot.lock().clone();

        // The base64 text is already charged (ingress reservation held through `candidate`).
        // Pre-reserve the decoded JPEG (alive until this function returns) and the packed frame
        // (adjusted down to its exact size) BEFORE either buffer is allocated.
        let decoded_estimate = candidate.frame.data_base64.len() / 4 * 3 + 3;
        let _decoded_guard = match global_memory_controller().try_reserve(decoded_estimate) {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "dropping candidate: memory ceiling reached before decode");
                return;
            }
        };
        let mut reservation = match global_memory_controller().try_reserve(decoded_estimate + 1024 + 16) {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "dropping candidate: memory ceiling reached before packing");
                return;
            }
        };

        // Decode base64 only once
        let jpeg_bytes = match BASE64_STANDARD.decode(&candidate.frame.data_base64) {
            Ok(b) => b,
            Err(e) => {
                warn!(error = %e, "failed to decode screencast candidate base64");
                return;
            }
        };
        self.ledger.base64_decoded.fetch_add(1, Ordering::Relaxed);
        global_stream_diagnostics()
            .base64_decoded_bytes
            .fetch_add(jpeg_bytes.len() as u64, Ordering::Relaxed);
        if jpeg_bytes.is_empty() || jpeg_bytes.len() > MAX_JPEG_PAYLOAD_BYTES {
            warn!(
                len = jpeg_bytes.len(),
                "candidate JPEG payload size invalid"
            );
            return;
        }

        // Parse JPEG SOF checked dimensions
        let validated_dims = match validate_jpeg_sof(&jpeg_bytes) {
            Ok(dims) => dims,
            Err(e) => {
                warn!(error = %e, "candidate JPEG SOF marker parse failed");
                return;
            }
        };
        let (width, height) = validated_dims.dimensions();

        let (eff_max_w, eff_max_h) = self.max_image_bounds();
        if width == 0 || width > eff_max_w || height == 0 || height > eff_max_h {
            warn!(
                width,
                height,
                eff_max_w,
                eff_max_h,
                "candidate JPEG dimensions out of configured bounds"
            );
            return;
        }
        let pixels = (width as u64) * (height as u64);
        if pixels > MAX_PIXELS {
            warn!(pixels, "candidate JPEG pixel ceiling exceeded");
            return;
        }
        // Pixels still captured at the replaced run's size are not the requested capture: they
        // neither publish nor prove the run's settings (its ACK was sent at ingress).
        if self.current_run_proven.lock().is_none()
            && self
                .run_fence
                .lock()
                .is_some_and(|fence| fence.is_retired_size(width, height))
        {
            debug!(width, height, "dropping candidate captured at the replaced run's size");
            return;
        }

        // Native evidence for the pointer-projection basis: when the run is not downscaled, the
        // frame's viewport metadata must agree with the producer geometry (size and no zoom).
        // Disagreement revokes trust (no guessed projection); agreement after an external
        // mutation re-establishes it. Downscaled runs carry no CSS metadata and keep the gate.
        let producer_geometry = self.geometry.read().await.clone();
        let (geom, native_agrees) = match candidate.metadata_geometry {
            Some(meta) if run_snap.scale_permille >= 1000 => {
                // The header reports what the engine saw so a divergence is visible to clients.
                let agrees = native_geometry_agrees(&meta, &producer_geometry);
                (meta, Some(agrees))
            }
            Some(mut meta) => {
                // CSS geometry must stay invariant under downscale; never trust scaled metadata.
                meta.css_width = producer_geometry.css_width;
                meta.css_height = producer_geometry.css_height;
                (meta, None)
            }
            None => (producer_geometry, None),
        };
        if let Some(agrees) = native_agrees {
            // Only a frame from the current epoch may confirm or revoke trust.
            if self.viewport_epoch.load(Ordering::SeqCst) == candidate.viewport_epoch {
                self.geometry_trusted.store(agrees, Ordering::Release);
                if agrees {
                    self.native_geometry_repairs.store(0, Ordering::Relaxed);
                } else {
                    self.schedule_native_geometry_repair();
                }
            }
        }

        let next_seq = self.frame_seq.fetch_add(1, Ordering::SeqCst) + 1;
        // The capture epoch, never a re-read: a fence that landed meanwhile must not relabel old
        // pixels with the new epoch (or leak the transitional marker into a header).
        let v_epoch = candidate.viewport_epoch;

        let header = TargetFrameHeader {
            browser_session_id: self.browser_session_id.clone(),
            browser_incarnation: self.browser_incarnation.clone(),
            profile_epoch: self.profile_epoch.to_string(),
            producer_run: producer_run.to_string(),
            viewport_epoch: v_epoch.to_string(),
            frame_seq: next_seq.to_string(),
            width,
            height,
            capture_time_unix_ms: candidate.native_capture_time_unix_ms.unwrap_or(0),
            geometry: geom,
            input_trusted: self.capture.input_trusted_for(&run_snap) && self.input_geometry_trusted(),
        };

        match pack_validated_bhjf_frame_with_dims(header.clone(), &jpeg_bytes, validated_dims) {
            Ok(validated) => {
                if let Err(e) = reservation.adjust(validated.data().len()) {
                    warn!(error = %e, "dropping BHJF frame: memory reservation ceiling exceeded on adjust");
                    return;
                }
                global_stream_diagnostics()
                    .jpeg_bytes_total
                    .fetch_add(jpeg_bytes.len() as u64, Ordering::Relaxed);
                // Hold the current-run guard across cache + broadcast: retirement (capture switch,
                // stop) needs the write lock, so a commit is atomic relative to it and the caches
                // are cleared strictly after any in-flight publication.
                // Commit only while the capture epoch is still current; geometry fences take the
                // same gate, so none can land between this check and the broadcast below.
                let _publish = self.publish_gate.lock().await;
                if self.viewport_epoch.load(Ordering::SeqCst) != candidate.viewport_epoch {
                    debug!("dropping frame: viewport epoch changed before publication");
                    return;
                }
                let run_guard = self.current_run.read().await;
                if *run_guard != Some(producer_run) {
                    debug!("dropping frame: producer run retired before publication");
                    return;
                }
                let tracked = TrackedBhjfFrame::from_validated(validated, reservation)
                    .with_receipt_time(candidate.server_received_unix_ms, candidate.received_at);
                {
                    let mut frame_cache = self.cached_frame.write().await;
                    *frame_cache = Some(tracked.clone());
                }
                {
                    let mut hdr_cache = self.cached_header.write().await;
                    *hdr_cache = Some(header.clone());
                }

                // Broadcast
                let _ = self.frame_broadcast.send(tracked);
                // Proven settings: this run's native quality/scale plus the cadence the governor
                // actually applies (FPS-only updates never restart the run).
                let applied_fps = self.applied_fps.load(Ordering::Acquire);
                self.capture.mark_effective_applied(&run_snap, applied_fps);
                let eff = self.capture.effective().unwrap_or_else(|| run_snap.clone());
                let mutation = self.begin_quality_mutation();
                let mut proven_lock = self.current_run_proven.lock();
                let mut proven_changed = false;
                match proven_lock.as_ref() {
                    Some(old) => {
                        if old.producer_run != producer_run
                            || old.snapshot.version != eff.version
                            || old.snapshot.fps != eff.fps
                            || old.snapshot.jpeg_quality != eff.jpeg_quality
                            || old.snapshot.scale_permille != eff.scale_permille
                            || old.width != header.width
                            || old.height != header.height
                        {
                            *proven_lock = Some(ProvenFrameState {
                                producer_run,
                                snapshot: eff,
                                width: header.width,
                                height: header.height,
                            });
                            proven_changed = true;
                        }
                    }
                    None => {
                        *proven_lock = Some(ProvenFrameState {
                            producer_run,
                            snapshot: eff,
                            width: header.width,
                            height: header.height,
                        });
                        proven_changed = true;
                    }
                }
                drop(proven_lock);
                if proven_changed {
                    drop(mutation);
                } else {
                    mutation.discard();
                }
                self.ledger.frames_published.fetch_add(1, Ordering::Relaxed);
                drop(run_guard);
            }
            Err(e) => {
                warn!(error = %e, "failed to pack BHJF frame for publishing");
            }
        }
    }

    /// Single fallback screenshot logic:
    /// Contract: At attach/resize/restart, use current cached frame if valid;
    /// after 250ms without native frame allow one captureScreenshot bracketed by layout metrics and epoch checks.
    /// Uncertain snapshot is display-only. NO post-input/static periodic screenshot.
    async fn attempt_screenshot_fallback(&self, page_session_id: &str, producer_run: Uuid) {
        // Enforce strictly once per epoch
        if self.screenshot_taken_in_epoch.swap(true, Ordering::SeqCst) {
            // Already taken for this epoch; no periodic screenshot allowed!
            return;
        }

        self.ledger
            .screenshot_fallbacks
            .fetch_add(1, Ordering::Relaxed);
        let epoch_before = self.viewport_epoch.load(Ordering::Relaxed);

        // 1. Bracket layout metrics before
        let _metrics_before = self
            .cdp_client
            .send_typed(GetLayoutMetricsParams::default(), Some(page_session_id))
            .await;

        // 2. Capture screenshot
        let shot_params = CaptureScreenshotParams::builder()
            .format(CaptureScreenshotFormat::Jpeg)
            .quality(i64::from(self.capture.current().jpeg_quality))
            .build();

        let shot_res = match self
            .cdp_client
            .send_typed(shot_params, Some(page_session_id))
            .await
        {
            Ok(res) => res,
            Err(e) => {
                warn!(error = %e, "fallback screenshot capture failed");
                return;
            }
        };

        // The response text is already resident: charge it NOW, before the next await, then
        // pre-reserve the decoded JPEG (alive until return) and the packed frame before either is
        // allocated. (The transient copy inside the CDP actor is bounded by the WS message cap.)
        let text_len = AsRef::<[u8]>::as_ref(&shot_res.data).len();
        let decoded_estimate = text_len / 4 * 3 + 3;
        let _text_guard = match global_memory_controller().try_reserve(text_len + 1024) {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "dropping fallback screenshot: memory ceiling reached");
                return;
            }
        };
        let _decoded_guard = match global_memory_controller().try_reserve(decoded_estimate) {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "dropping fallback screenshot: memory ceiling reached before decode");
                return;
            }
        };
        let mut reservation = match global_memory_controller().try_reserve(decoded_estimate + 1024 + 16) {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "dropping fallback screenshot: memory ceiling reached before packing");
                return;
            }
        };

        // 3. Bracket layout metrics after
        let _metrics_after = self
            .cdp_client
            .send_typed(GetLayoutMetricsParams::default(), Some(page_session_id))
            .await;

        // 4. Recheck epoch
        let epoch_after = self.viewport_epoch.load(Ordering::Relaxed);
        if (epoch_after & TRANSITIONAL_EPOCH_MASK) != 0 || epoch_before != epoch_after {
            warn!("epoch changed or transition in progress during fallback screenshot; discarding snapshot");
            return;
        }

        let jpeg_bytes = match BASE64_STANDARD.decode(&shot_res.data) {
            Ok(b) => b,
            Err(e) => {
                warn!(error = %e, "failed to decode screenshot base64");
                return;
            }
        };

        let validated_dims = match validate_jpeg_sof(&jpeg_bytes) {
            Ok(dims) => dims,
            Err(e) => {
                warn!(error = %e, "fallback screenshot JPEG parse failed");
                return;
            }
        };
        let (width, height) = validated_dims.dimensions();

        let (eff_max_w, eff_max_h) = self.max_image_bounds();
        if width > eff_max_w || height > eff_max_h {
            warn!(width, height, eff_max_w, eff_max_h, "dropping fallback screenshot: exceeds configured image bounds");
            return;
        }
        let geom = self.geometry.read().await.clone();
        let next_seq = self.frame_seq.fetch_add(1, Ordering::SeqCst) + 1;
        let fallback_received_at = Instant::now();
        let fallback_receipt_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
        let diag = global_stream_diagnostics();
        diag.last_server_receipt_unix_ms
            .store(fallback_receipt_ms, Ordering::Relaxed);
        diag.native_capture_timestamps_unavailable
            .fetch_add(1, Ordering::Relaxed);
        let header = TargetFrameHeader {
            browser_session_id: self.browser_session_id.clone(),
            browser_incarnation: self.browser_incarnation.clone(),
            profile_epoch: self.profile_epoch.to_string(),
            producer_run: producer_run.to_string(),
            viewport_epoch: epoch_after.to_string(),
            frame_seq: next_seq.to_string(),
            width,
            height,
            capture_time_unix_ms: 0,
            geometry: geom,
            // Uncertain snapshot is display-only; inputTrusted = false
            input_trusted: false,
        };
        if let Ok(validated) = pack_validated_bhjf_frame_with_dims(header.clone(), &jpeg_bytes, validated_dims) {
            if let Err(e) = reservation.adjust(validated.data().len()) {
                warn!(error = %e, "dropping fallback screenshot: memory ceiling exceeded on adjust");
                return;
            }
            global_stream_diagnostics()
                .screenshot_count
                .fetch_add(1, Ordering::Relaxed);
            let _publish = self.publish_gate.lock().await;
            if self.viewport_epoch.load(Ordering::SeqCst) != epoch_after {
                debug!("dropping fallback screenshot: viewport epoch changed before publication");
                return;
            }
            let run_guard = self.current_run.read().await;
            if *run_guard != Some(producer_run) {
                debug!("dropping fallback screenshot: producer run retired before publication");
                return;
            }
            let tracked = TrackedBhjfFrame::from_validated(validated, reservation)
                .with_receipt_time(fallback_receipt_ms, fallback_received_at);
            {
                let mut frame_cache = self.cached_frame.write().await;
                *frame_cache = Some(tracked.clone());
            }
            {
                let mut hdr_cache = self.cached_header.write().await;
                *hdr_cache = Some(header);
            }
            let _ = self.frame_broadcast.send(tracked);
            self.ledger.frames_published.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn clone_handle(&self) -> Arc<Self> {
        Arc::new(Self {
            browser_session_id: self.browser_session_id.clone(),
            browser_incarnation: self.browser_incarnation.clone(),
            profile_epoch: self.profile_epoch,
            viewport_epoch: self.viewport_epoch.clone(),
            frame_seq: self.frame_seq.clone(),
            audio_doc_epoch: self.audio_doc_epoch.clone(),
            doc_epoch_tx: self.doc_epoch_tx.clone(),
            nav_listener: self.nav_listener.clone(),
            cdp_client: self.cdp_client.clone(),
            target_id: self.target_id.clone(),
            page_session_id: self.page_session_id.clone(),
            current_run: self.current_run.clone(),
            native_screencast_session_id: self.native_screencast_session_id.clone(),
            state: self.state.clone(),
            lifecycle_operation: self.lifecycle_operation.clone(),
            publish_gate: self.publish_gate.clone(),
            fence_generation: self.fence_generation.clone(),
            current_candidate: self.current_candidate.clone(),
            cached_frame: self.cached_frame.clone(),
            cached_header: self.cached_header.clone(),
            viewers: self.viewers.clone(),
            ledger: self.ledger.clone(),
            screenshot_taken_in_epoch: self.screenshot_taken_in_epoch.clone(),
            capture: self.capture.clone(),
            adaptive: self.adaptive.clone(),
            run_snapshot: self.run_snapshot.clone(),
            run_fence: self.run_fence.clone(),
            audio_source: self.audio_source.clone(),
            switch_backoff_until: self.switch_backoff_until.clone(),
            applied_fps: self.applied_fps.clone(),
            frame_broadcast: self.frame_broadcast.clone(),
            audio_broadcast: self.audio_broadcast.clone(),
            active_run_cancel: self.active_run_cancel.clone(),
            geometry: self.geometry.clone(),
            geometry_trusted: self.geometry_trusted.clone(),
            native_geometry_repair_enabled: self.native_geometry_repair_enabled.clone(),
            external_geometry_fenced: self.external_geometry_fenced.clone(),
            native_geometry_repairs: self.native_geometry_repairs.clone(),
            native_geometry_repair_in_flight: self.native_geometry_repair_in_flight.clone(),
            current_run_proven: self.current_run_proven.clone(),
            applied_event_version: self.applied_event_version.clone(),
            quality_revision: self.quality_revision.clone(),
            audio_drain_barrier: self.audio_drain_barrier.clone(),
            page_setup: self.page_setup.clone(),
            page_session_poisoned: self.page_session_poisoned.clone(),
            recovery: self.recovery.clone(),
            stealth_listener: self.stealth_listener.clone(),
            selection_context: self.selection_context.clone(),
            selection_gap: self.selection_gap.clone(),
        })
    }
}

async fn apply_stealth_to_session(
    client: &CdpClient,
    session_id: &str,
    ua_params: &serde_json::Value,
) -> Result<(), CdpError> {
    use super::stealth::ANTI_DETECTION_SCRIPT;
    client
        .send_command(
            "Emulation.setFocusEmulationEnabled",
            Some(serde_json::json!({ "enabled": true })),
            Some(session_id),
        )
        .await?;
    client
        .send_command(
            "Emulation.setUserAgentOverride",
            Some(ua_params.clone()),
            Some(session_id),
        )
        .await?;
    client
        .send_command(
            "Page.addScriptToEvaluateOnNewDocument",
            Some(serde_json::json!({ "source": ANTI_DETECTION_SCRIPT })),
            Some(session_id),
        )
        .await?;
    client
        .send_command(
            "Runtime.evaluate",
            Some(serde_json::json!({ "expression": ANTI_DETECTION_SCRIPT })),
            Some(session_id),
        )
        .await?;
    Ok(())
}

#[cfg(test)]
mod request_policy_tests {
    use super::*;
    use crate::browser_host::config::BrowserHostConfig;
    use crate::browser_host::network_policy::NetworkPolicy;
    use futures_util::{SinkExt, StreamExt};
    use serde_json::{json, Value};
    use tokio::sync::mpsc;
    use tokio::time::timeout;
    use tokio_tungstenite::tungstenite::Message;

    struct MockBrowser {
        client: Arc<CdpClient>,
        commands: mpsc::UnboundedReceiver<Value>,
        push: mpsc::UnboundedSender<Value>,
    }

    async fn mock_browser(fail_fetch_enable: bool) -> MockBrowser {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (commands_tx, commands) = mpsc::unbounded_channel::<Value>();
        let (push, mut push_rx) = mpsc::unbounded_channel::<Value>();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            loop {
                tokio::select! {
                    pushed = push_rx.recv() => {
                        let Some(event) = pushed else { break };
                        if ws.send(Message::Text(event.to_string().into())).await.is_err() { break; }
                    }
                    incoming = ws.next() => {
                        let Some(Ok(Message::Text(text))) = incoming else { break };
                        let cmd: Value = serde_json::from_str(&text).unwrap();
                        let reply = if fail_fetch_enable && cmd["method"] == "Fetch.enable" {
                            json!({"id": cmd["id"], "error": {"code": -32601, "message": "Fetch.enable not found"}})
                        } else if cmd["method"] == "Target.attachToTarget" {
                            json!({"id": cmd["id"], "result": {"sessionId": cmd["params"]["targetId"]}})
                        } else {
                            json!({"id": cmd["id"], "result": {}})
                        };
                        let policy_decision = cmd["id"].as_i64().is_some_and(|id| id < 0);
                        let _ = commands_tx.send(cmd);
                        // Withhold policy acknowledgements: request bursts must not wait
                        // on individual RTTs or consume the ordinary RPC slots.
                        if !policy_decision && ws.send(Message::Text(reply.to_string().into())).await.is_err() { break; }
                    }
                }
            }
        });
        let client = CdpClient::connect(&format!("ws://{addr}")).await.unwrap();
        MockBrowser { client, commands, push }
    }

    fn policy() -> Arc<NetworkPolicy> {
        Arc::new(NetworkPolicy::from_config(&BrowserHostConfig {
            allowed_target_origins: vec!["http://localhost:5173".into()],
            allowed_asset_origins: vec!["http://localhost:5174".into()],
            ..BrowserHostConfig::default()
        }, true).unwrap())
    }

    async fn install(browser: &MockBrowser) -> Arc<std::sync::atomic::AtomicUsize> {
        let escalations = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = escalations.clone();
        browser.client.install_browser_request_policy(policy(), Arc::new(move |_| {
            count.fetch_add(1, Ordering::SeqCst);
        })).await.unwrap();
        escalations
    }

    fn paused(id: &str, url: &str, resource_type: &str) -> Value {
        json!({"method": "Fetch.requestPaused", "params": {
            "requestId": id, "request": {"url": url}, "resourceType": resource_type,
        }})
    }

    async fn next_command(browser: &mut MockBrowser) -> Value {
        timeout(Duration::from_secs(2), browser.commands.recv()).await.unwrap().unwrap()
    }

    #[tokio::test]
    async fn initial_viewport_and_resize_use_css_pixels_for_pointer_dispatch() {
        use crate::browser_host::input::{InputEvent, MouseButton};
        use crate::browser_host::media::dispatch_input_event_to_cdp;

        for dpr in [1.0, 1.5, 2.0] {
            let mut browser = mock_browser(false).await;
            let geometry = TargetGeometry {
                css_width: 1280.0,
                css_height: 900.0,
                offset_top: 0.0,
                scroll_x: 0.0,
                scroll_y: 0.0,
                page_scale: 1.0,
                visual_offset_x: 0.0,
                visual_offset_y: 0.0,
                dpr,
            };
            let producer = ScreencastProducer::new(
                Uuid::new_v4().to_string(),
                Uuid::new_v4().to_string(),
                1,
                1,
                browser.client.clone(),
                "PAGE-TARGET".to_string(),
                geometry.clone(),
            );
            let page_session = producer.ensure_page_session().await.unwrap();
            // The native viewport must be installed before callers can navigate or stream.
            for method in ["Target.attachToTarget", "Page.enable", "Emulation.setDeviceMetricsOverride"] {
                let command = timeout(Duration::from_secs(1), browser.commands.recv())
                    .await.unwrap().unwrap();
                assert_eq!(command["method"], method);
                if method == "Emulation.setDeviceMetricsOverride" {
                    assert_eq!(command["sessionId"], page_session);
                    assert_eq!(command["params"], json!({
                        "width": 1280, "height": 900,
                        "deviceScaleFactor": dpr, "mobile": false,
                    }));
                }
            }
            assert_eq!(producer.viewport_epoch(), 1);
            assert_eq!(producer.ensure_page_session().await.unwrap(), page_session);

            for (width, height, expected_epoch) in [(1280.0, 900.0, 1), (800.0, 600.0, 2)] {
                if expected_epoch == 2 {
                    producer.update_geometry(TargetGeometry {
                        css_width: width, css_height: height, ..geometry.clone()
                    }, expected_epoch).await.unwrap();
                    let command = timeout(Duration::from_secs(1), browser.commands.recv())
                        .await.unwrap().unwrap();
                    assert_eq!(command["method"], "Emulation.setDeviceMetricsOverride");
                    assert_eq!(command["params"]["width"], width);
                    assert_eq!(command["params"]["height"], height);
                    assert_eq!(command["params"]["deviceScaleFactor"], dpr);
                }
                assert_eq!(producer.viewport_epoch(), expected_epoch);
                let current = producer.geometry().await;
                for (event, kind, u, v) in [
                    (InputEvent::PointerDown { button: MouseButton::Left, u: 0.75, v: 0.25, modifiers: 0 }, "mousePressed", 0.75, 0.25),
                    (InputEvent::PointerUp { button: MouseButton::Left, u: 0.75, v: 0.25, modifiers: 0 }, "mouseReleased", 0.75, 0.25),
                    (InputEvent::PointerMove { u: 0.0, v: 1.0, modifiers: 0 }, "mouseMoved", 0.0, 1.0),
                    (InputEvent::Wheel { u: 1.0, v: 0.0, delta_x: 0.0, delta_y: 120.0, modifiers: 0 }, "mouseWheel", 1.0, 0.0),
                ] {
                    dispatch_input_event_to_cdp(&browser.client, &page_session, &current, &event).await;
                    let command = timeout(Duration::from_secs(1), browser.commands.recv())
                        .await.unwrap().unwrap();
                    assert_eq!(command["method"], "Input.dispatchMouseEvent");
                    assert_eq!(command["sessionId"], page_session);
                    assert_eq!(command["params"]["type"], kind);
                    assert_eq!(command["params"]["x"], u * width);
                    assert_eq!(command["params"]["y"], v * height);
                }
            }
            browser.client.close().await;
        }
    }

    #[tokio::test]
    async fn browser_policy_denies_redirects_and_frame_navigation_to_asset_origins() {
        let mut browser = mock_browser(false).await;
        let escalations = install(&browser).await;
        let enable = next_command(&mut browser).await;
        assert_eq!(enable["method"], "Fetch.enable");
        assert!(enable.get("sessionId").is_none(), "Fetch must wrap every worker factory");
        for (id, url, kind, expected) in [
            ("page", "http://localhost:5173/", "Document", "Fetch.continueRequest"),
            ("worker", "http://localhost:5174/worker.js", "Script", "Fetch.continueRequest"),
            ("nested", "http://localhost:5174/nested.js", "Script", "Fetch.continueRequest"),
            ("frame", "http://localhost:5174/frame", "Document", "Fetch.failRequest"),
            ("redirect", "http://localhost:5175/denied", "Fetch", "Fetch.failRequest"),
            ("metadata", "http://169.254.169.254/latest", "Fetch", "Fetch.failRequest"),
            ("credentials", "http://user:secret@localhost:5173/", "Fetch", "Fetch.failRequest"),
            ("file", "file:///etc/passwd", "Other", "Fetch.failRequest"),
        ] {
            browser.push.send(paused(id, url, kind)).unwrap();
            let decision = next_command(&mut browser).await;
            assert_eq!(decision["method"], expected, "{id}");
            assert_eq!(decision["params"]["requestId"], id);
            assert!(decision.get("sessionId").is_none());
            if expected == "Fetch.failRequest" {
                assert_eq!(decision["params"]["errorReason"], "AccessDenied");
            }
        }
        assert_eq!(escalations.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn request_burst_does_not_need_acknowledgements_or_broadcast_capacity() {
        let mut browser = mock_browser(false).await;
        let escalations = install(&browser).await;
        next_command(&mut browser).await;
        for index in 0..144 {
            browser.push.send(paused(&format!("request-{index}"), "http://localhost:5173/asset", "Script")).unwrap();
        }
        for index in 0..144 {
            let decision = next_command(&mut browser).await;
            assert_eq!(decision["method"], "Fetch.continueRequest");
            assert_eq!(decision["params"]["requestId"], format!("request-{index}"));
            assert_eq!(decision["id"], -(index + 1));
        }
        browser.client.send_command("Runtime.evaluate", Some(json!({"expression": "1"})), Some("PAGE")).await.unwrap();
        assert_eq!(next_command(&mut browser).await["method"], "Runtime.evaluate");
        assert_eq!(escalations.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn isolated_producers_do_not_own_or_remove_browser_policy() {
        let mut owner = mock_browser(false).await;
        install(&owner).await;
        assert_eq!(next_command(&mut owner).await["method"], "Fetch.enable");
        // Repeated installation is a no-op on the manager's one policy connection.
        install(&owner).await;
        for target in ["FIRST", "SECOND"] {
            let mut browser = mock_browser(false).await;
            let producer = ScreencastProducer::new(
                Uuid::new_v4().to_string(), Uuid::new_v4().to_string(), 1, 1,
                browser.client.clone(), target.to_string(), TargetGeometry {
                    css_width: 800.0, css_height: 600.0, dpr: 1.0, offset_top: 0.0,
                    scroll_x: 0.0, scroll_y: 0.0, page_scale: 1.0,
                    visual_offset_x: 0.0, visual_offset_y: 0.0,
                },
            );
            producer.ensure_page_session().await.unwrap();
            for expected in ["Target.attachToTarget", "Page.enable", "Emulation.setDeviceMetricsOverride"] {
                assert_eq!(next_command(&mut browser).await["method"], expected);
            }
            drop(producer);
            browser.client.close().await;
            owner.push.send(paused(target, "http://localhost:5175/denied", "Fetch")).unwrap();
            let decision = next_command(&mut owner).await;
            assert_eq!(decision["method"], "Fetch.failRequest");
            assert_eq!(decision["params"]["requestId"], target);
        }
    }

    #[tokio::test]
    async fn session_scoped_quarantine_is_not_continued_by_browser_policy() {
        let mut browser = mock_browser(false).await;
        install(&browser).await;
        next_command(&mut browser).await;
        let mut quarantined = paused("refused", "http://localhost:5173/", "Document");
        quarantined["sessionId"] = json!("MANAGER-QUARANTINE");
        browser.push.send(quarantined).unwrap();
        browser.push.send(paused("owned", "http://localhost:5173/", "Document")).unwrap();
        let command = next_command(&mut browser).await;
        assert_eq!(command["params"]["requestId"], "owned");
    }

    #[tokio::test]
    async fn canceled_loader_acknowledgement_does_not_retire_another_page() {
        let mut browser = mock_browser(false).await;
        let escalations = install(&browser).await;
        next_command(&mut browser).await;
        browser.push.send(paused("canceled", "http://localhost:5173/", "Document")).unwrap();
        let decision = next_command(&mut browser).await;
        browser.push.send(json!({"id":decision["id"],"error":{
            "code":-32602,"message":"Invalid InterceptionId."
        }})).unwrap();
        browser.push.send(paused("next-page", "http://localhost:5173/next", "Document")).unwrap();
        assert_eq!(next_command(&mut browser).await["params"]["requestId"], "next-page");
        assert_eq!(escalations.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn unsupported_policy_decision_transfers_browser_containment() {
        let mut browser = mock_browser(false).await;
        let escalations = install(&browser).await;
        next_command(&mut browser).await;
        browser.push.send(paused("request", "http://localhost:5173/", "Document")).unwrap();
        let decision = next_command(&mut browser).await;
        browser.push.send(json!({"id":decision["id"],"error":{
            "code":-32601,"message":"Fetch.continueRequest not found"
        }})).unwrap();
        timeout(Duration::from_secs(2), async {
            while !browser.client.is_closed() { tokio::task::yield_now().await; }
        }).await.unwrap();
        assert_eq!(escalations.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn malformed_browser_policy_event_transfers_containment_before_disconnect() {
        let mut browser = mock_browser(false).await;
        let escalations = install(&browser).await;
        next_command(&mut browser).await;
        browser.push.send(json!({"method":"Fetch.requestPaused","params":{}})).unwrap();
        timeout(Duration::from_secs(2), async {
            while escalations.load(Ordering::SeqCst) == 0 {
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
        assert!(browser.client.is_closed());
    }

    #[tokio::test]
    async fn failed_browser_policy_installation_is_reported_and_contained() {
        let mut browser = mock_browser(true).await;
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let recorded = count.clone();
        let result = browser.client.install_browser_request_policy(policy(), Arc::new(move |_| {
            recorded.fetch_add(1, Ordering::SeqCst);
        })).await;
        assert!(matches!(result, Err(CdpError::Protocol { code: -32601, .. })));
        assert_eq!(next_command(&mut browser).await["method"], "Fetch.enable");
        assert!(count.load(Ordering::SeqCst) > 0);
    }

    #[tokio::test]
    async fn one_browser_incarnation_cannot_install_conflicting_origin_policies() {
        let mut browser = mock_browser(false).await;
        install(&browser).await;
        next_command(&mut browser).await;
        let different = Arc::new(NetworkPolicy::from_config(&BrowserHostConfig::default(), false).unwrap());
        assert!(matches!(
            browser.client.install_browser_request_policy(different, Arc::new(|_| {})).await,
            Err(CdpError::Protocol { .. })
        ));
        browser.push.send(paused("still-denied", "http://localhost:5175/denied", "Fetch")).unwrap();
        assert_eq!(next_command(&mut browser).await["method"], "Fetch.failRequest");
    }

    #[tokio::test]
    async fn stealth_setup_applies_to_page_and_attached_oopif_and_sanitizes_worker_headers() {
        let mut browser = mock_browser(false).await;
        install(&browser).await;
        assert_eq!(next_command(&mut browser).await["method"], "Fetch.enable");

        let producer = ScreencastProducer::new(
            Uuid::new_v4().to_string(),
            Uuid::new_v4().to_string(),
            1,
            1,
            browser.client.clone(),
            "PAGE-TARGET".to_string(),
            TargetGeometry {
                css_width: 1280.0,
                css_height: 900.0,
                dpr: 1.0,
                offset_top: 0.0,
                scroll_x: 0.0,
                scroll_y: 0.0,
                page_scale: 1.0,
                visual_offset_x: 0.0,
                visual_offset_y: 0.0,
            },
        );
        let page_sid = producer.ensure_page_session().await.unwrap();
        for expected in [
            "Target.attachToTarget",
            "Page.enable",
            "Emulation.setDeviceMetricsOverride",
        ] {
            assert_eq!(next_command(&mut browser).await["method"], expected);
        }
        producer.apply_stealth_and_focus(&page_sid).await.unwrap();
        for expected in [
            "Browser.getVersion",
            "Emulation.setFocusEmulationEnabled",
            "Emulation.setUserAgentOverride",
            "Page.addScriptToEvaluateOnNewDocument",
            "Runtime.evaluate",
            "Target.setAutoAttach",
        ] {
            let cmd = next_command(&mut browser).await;
            assert_eq!(cmd["method"], expected);
            if expected != "Browser.getVersion" {
                assert_eq!(cmd["sessionId"], page_sid);
            }
        }

        // Simulate cross-origin Cloudflare Turnstile OOPIF attachment
        browser
            .push
            .send(json!({
                "method": "Target.attachedToTarget",
                "sessionId": page_sid,
                "params": {
                    "sessionId": "OOPIF-SESSION-1",
                    "waitingForDebugger": true,
                    "targetInfo": {
                        "targetId": "OOPIF-TARGET-1",
                        "type": "iframe",
                        "url": "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile"
                    }
                }
            }))
            .unwrap();
        for expected in [
            "Page.enable",
            "Emulation.setFocusEmulationEnabled",
            "Emulation.setUserAgentOverride",
            "Page.addScriptToEvaluateOnNewDocument",
            "Runtime.evaluate",
            "Target.setAutoAttach",
            "Runtime.runIfWaitingForDebugger",
        ] {
            let cmd = next_command(&mut browser).await;
            assert_eq!(cmd["method"], expected);
            assert_eq!(cmd["sessionId"], "OOPIF-SESSION-1");
        }

        // Worker/subresource request carrying HeadlessChrome headers gets sanitized in Fetch.continueRequest
        browser
            .push
            .send(json!({
                "method": "Fetch.requestPaused",
                "params": {
                    "requestId": "worker-req-1",
                    "request": {
                        "url": "http://localhost:5173/worker-check",
                        "headers": {
                            "User-Agent": "Mozilla/5.0 HeadlessChrome/140.0.1.2 Safari/537.36",
                            "sec-ch-ua": "\"HeadlessChrome\";v=\"140\""
                        }
                    },
                    "resourceType": "Script"
                }
            }))
            .unwrap();
        let decision = next_command(&mut browser).await;
        assert_eq!(decision["method"], "Fetch.continueRequest");
        assert_eq!(decision["params"]["requestId"], "worker-req-1");
        let headers = decision["params"]["headers"].as_array().expect("rewritten headers");
        assert!(headers.iter().any(|h| h["name"] == "User-Agent" && h["value"].as_str().unwrap().contains("Chrome/140.0.0.0")));
        assert!(headers.iter().any(|h| h["name"] == "sec-ch-ua" && h["value"].as_str().unwrap().contains("Google Chrome")));

        // Oversized header override exceeding MAX_COMMAND_BYTES fails closed and triggers containment
        let huge = "A".repeat(12_000);
        browser
            .push
            .send(json!({
                "method": "Fetch.requestPaused",
                "params": {
                    "requestId": "worker-req-oversized",
                    "request": {
                        "url": "http://localhost:5173/huge",
                        "headers": {
                            "User-Agent": format!("HeadlessChrome/140.0.0.0 {huge}")
                        }
                    },
                    "resourceType": "Script"
                }
            }))
            .unwrap();
        timeout(Duration::from_secs(2), async {
            while !browser.client.is_closed() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(
            producer.apply_stealth_and_focus(&page_sid).await.is_err(),
            "stealth setup must return error when CDP session is closed/rejected"
        );
    }

    #[tokio::test]
    async fn capture_policy_and_audio_chunk_admission_enforce_bounds_and_run_fencing() {
        let mut browser = mock_browser(false).await;
        let session_uuid = Uuid::new_v4().to_string();
        let incarnation_uuid = Uuid::new_v4().to_string();
        let producer = ScreencastProducer::new(
            session_uuid.clone(),
            incarnation_uuid.clone(),
            2,
            1,
            browser.client.clone(),
            "PAGE-AUDIO".to_string(),
            TargetGeometry {
                css_width: 1280.0,
                css_height: 720.0,
                dpr: 1.0,
                offset_top: 0.0,
                scroll_x: 0.0,
                scroll_y: 0.0,
                page_scale: 1.0,
                visual_offset_x: 0.0,
                visual_offset_y: 0.0,
            },
        )
        .with_capture_policy(24, 75);
        // Admin values are hard ceilings; Auto warms at the Medium tier (10fps, q65) until measured.
        assert_eq!(producer.capture_ceilings().jpeg_quality, 75);
        assert_eq!(producer.capture_ceilings().fps, 24);
        assert_eq!(producer.jpeg_quality(), 65);
        assert_eq!(producer.governor_interval(), Duration::from_millis(100));

        let mut audio_rx = producer.subscribe_audio();
        let sub_epoch = Uuid::new_v4().to_string();
        producer.register_viewer_demand("v1", &sub_epoch, true).await;

        // Drain attach + enable + deviceMetrics + startScreencast commands
        let mut saw_start = false;
        for _ in 0..4 {
            let cmd = next_command(&mut browser).await;
            if cmd["method"] == "Page.startScreencast" {
                assert_eq!(cmd["params"]["quality"], 65);
                saw_start = true;
            }
        }
        assert!(saw_start, "Page.startScreencast must use the Auto warm-start Medium quality 65");

        let active_run = producer.current_run().await.expect("active producer run");
        let valid_pcm_b64 = BASE64_STANDARD.encode([0x12u8, 0x34, 0x56, 0x78]);

        // Valid chunk admitted and broadcast with monotonic audioSeq
        let doc_epoch = producer.audio_doc_epoch();
        let c1 = producer
            .admit_and_broadcast_audio_chunk(active_run, doc_epoch, &valid_pcm_b64)
            .await
            .expect("admit valid chunk 1");
        assert_eq!(c1.audio_seq, "1");
        assert_eq!(c1.doc_epoch, doc_epoch);
        assert_eq!(c1.sample_rate, 24_000);
        assert_eq!(c1.channels, 1);
        assert_eq!(c1.encoding, "pcm16le");

        let received = timeout(Duration::from_secs(1), audio_rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(received, c1);

        // Stale captured doc_epoch rejected after navigation advances epoch even with 0 prior watch receivers (C5-M1)
        producer.advance_audio_doc_epoch();
        let late_watch_rx = producer.subscribe_audio_doc_authority();
        assert_eq!(late_watch_rx.borrow().committed_epoch, 2, "watch value must retain update even when advanced with 0 receivers");
        assert!(producer
            .admit_and_broadcast_audio_chunk(active_run, doc_epoch, &valid_pcm_b64)
            .await
            .is_none());
        let new_doc_epoch = late_watch_rx.borrow().committed_epoch;
        let c2 = producer
            .admit_and_broadcast_audio_chunk(active_run, new_doc_epoch, &valid_pcm_b64)
            .await
            .expect("admit valid chunk 2 on updated doc_epoch");
        assert_eq!(c2.doc_epoch, 2);
        assert_eq!(c2.audio_seq, "2");

        // C6-H6, C7-H6, C8-H6, C9-H6, C10-H6, C10-H2:
        // 1. Out-of-bounds no-op history resolution AFTER session watcher already fenced epoch 3:
        assert!(producer.verify_drained_document(2, "doc-initial", 1));
        producer.request_audio_doc_epoch(3);
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), None);
        producer.resolve_noop_audio_doc_epoch(3);
        assert_eq!(
            producer.audio_doc_authority().active_committed_epoch(),
            Some(3),
            "no-op history resolution must restore settled authority and un-retire doc-initial (C10-H2)"
        );
        assert!(
            producer.verify_drained_document(3, "doc-initial", 1),
            "doc-initial must remain valid after out-of-bounds no-op history resolution"
        );

        // 2. C10-H6: API A requests epoch 4, yields before dispatch while API B supersedes with epoch 5;
        //    API A then dispatches with explicit_epoch=Some(4) and commits loader "L-A4" (commit before RPC response!).
        producer.request_audio_doc_epoch(4);
        producer.request_audio_doc_epoch(5);
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), None);
        // Unmatched loader commit when no response matches must fail closed:
        producer
            .nav_listener
            .on_frame_navigated(Some("PAGE-AUDIO"), true, Some("L-UNRELATED"));
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), None);
        // API A dispatches late with its own captured explicit_epoch = Some(4):
        assert!(producer.nav_listener.on_navigation_dispatched(
            Some("PAGE-AUDIO"),
            101,
            "Page.navigate",
            Some(4),
            Some("http://127.0.0.1/page-a"),
        ));
        // API B dispatches with its own captured explicit_epoch = Some(5) before either response arrives:
        assert!(producer.nav_listener.on_navigation_dispatched(
            Some("PAGE-AUDIO"),
            102,
            "Page.navigate",
            Some(5),
            Some("http://127.0.0.1/page-b"),
        ));
        producer
            .nav_listener
            .on_frame_navigated(Some("PAGE-AUDIO"), true, Some("L-A4"));
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), None);
        producer.nav_listener.on_navigation_response(
            Some("PAGE-AUDIO"),
            101,
            "Page.navigate",
            Some("L-A4"),
            false,
        );
        assert_eq!(
            producer.audio_doc_authority().committed_epoch,
            4,
            "API A commit must only advance committed_epoch to 4, never 5"
        );
        assert_eq!(
            producer.audio_doc_authority().active_committed_epoch(),
            None,
            "API A delayed dispatch/commit must NOT authorize superseding API B epoch 5"
        );
        assert!(!producer.verify_drained_document(5, "doc-a1-delayed", 1));
        // Now API B's RPC response ("L-B5") and FrameNavigated ("L-B5") arrive -> establishes epoch 5!
        producer.nav_listener.on_navigation_response(
            Some("PAGE-AUDIO"),
            102,
            "Page.navigate",
            Some("L-B5"),
            false,
        );
        producer
            .nav_listener
            .on_frame_navigated(Some("PAGE-AUDIO"), true, Some("L-B5"));
        assert!(producer.verify_drained_document(5, "doc-a2-fresh", 1));
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), Some(5));
        // C11-H6 Subcase 1: Stale explicit dispatch with epoch <= committed_epoch (4 <= 5) is rejected BEFORE queue exposure!
        assert!(
            !producer.nav_listener.on_navigation_dispatched(
                Some("PAGE-AUDIO"),
                199,
                "Page.navigate",
                Some(4),
                Some("http://127.0.0.1/page-a"),
            ),
            "stale explicit dispatch (epoch 4 <= committed 5) must be rejected before queue exposure (C11-H6)"
        );
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), Some(5));
        assert_eq!(
            producer.audio_doc_authority().committed_doc_id.as_deref(),
            Some("doc-a2-fresh"),
            "rejected stale dispatch must leave doc-a2-fresh active at epoch 5"
        );
        // Stale drain from a retired docId ("doc-initial") is rejected WITHOUT demoting the active valid epoch 5!
        assert!(!producer.verify_drained_document(5, "doc-initial", 1));
        assert_eq!(
            producer.audio_doc_authority().active_committed_epoch(),
            Some(5),
            "stale drain from retired document must not demote an already verified active document"
        );
        // Same-document transition (history.pushState / replaceState) preserves "doc-a2-fresh", advances subDocGen, and rejects pre-pushState subDocGen
        producer.commit_same_document_audio_epoch();
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), Some(6));
        assert!(
            !producer.verify_drained_document(6, "doc-a2-fresh", 1),
            "pre-pushState subDocGen=1 must be rejected after same-document transition"
        );
        assert!(
            producer.verify_drained_document(6, "doc-a2-fresh", 2),
            "same-document transition must keep doc-a2-fresh valid once subDocGen advances to 2"
        );
        let new_doc_epoch = producer.audio_doc_epoch();
        assert_eq!(new_doc_epoch, 6);
        let c3 = producer
            .admit_and_broadcast_audio_chunk(active_run, new_doc_epoch, &valid_pcm_b64)
            .await
            .expect("admit valid chunk after matching native commit");
        assert_eq!(c3.doc_epoch, 6);
        assert_eq!(c3.audio_seq, "3");
        // C9-H1: Legacy raw array responses and malformed drainDoc envelopes are rejected before chunk admission
        let raw_arr = json!([valid_pcm_b64.clone()]);
        assert!(
            producer.parse_and_verify_drain_doc_value(6, &raw_arr).is_none(),
            "legacy raw array response must be rejected (C9-H1)"
        );
        let missing_doc_id = json!({ "subDocGen": 2, "chunks": [valid_pcm_b64.clone()] });
        assert!(producer.parse_and_verify_drain_doc_value(6, &missing_doc_id).is_none());
        let missing_sub_gen = json!({ "docId": "doc-a2-fresh", "chunks": [valid_pcm_b64.clone()] });
        assert!(producer.parse_and_verify_drain_doc_value(6, &missing_sub_gen).is_none());
        let retired_env = json!({ "docId": "doc-initial", "subDocGen": 2, "chunks": [valid_pcm_b64.clone()] });
        assert!(producer.parse_and_verify_drain_doc_value(6, &retired_env).is_none());
        let valid_env = json!({ "docId": "doc-a2-fresh", "subDocGen": 2, "chunks": [valid_pcm_b64.clone()] });
        assert_eq!(
            producer.parse_and_verify_drain_doc_value(6, &valid_env).map(Vec::len),
            Some(1)
        );
        // 3. C10-H6: Page.reload (expects_loader_id = false) single in-flight transition:
        producer.request_audio_doc_epoch(7);
        // C11-H2: Same-document event from old page while cross-document Page.reload is pending must NOT consume or authorize epoch 7!
        assert!(producer.nav_listener.on_navigation_dispatched(
            Some("PAGE-AUDIO"),
            103,
            "Page.reload",
            Some(7),
            None,
        ));
        producer.nav_listener.on_navigated_within_document(
            Some("PAGE-AUDIO"),
            Some("PAGE-AUDIO"),
            Some("http://127.0.0.1/old#hash"),
            Some("fragment"),
        );
        assert_eq!(
            producer.audio_doc_authority().active_committed_epoch(),
            None,
            "old-page same-document event must not consume or authorize pending cross-document operation (C11-H2)"
        );
        producer
            .nav_listener
            .on_frame_navigated(Some("PAGE-AUDIO"), true, Some("L-RELOAD-7"));
        assert_eq!(
            producer.audio_doc_authority().active_committed_epoch(),
            None,
            "Page.reload must wait for both FrameNavigated and RPC response_ok before committing"
        );
        producer.nav_listener.on_navigation_response(
            Some("PAGE-AUDIO"),
            103,
            "Page.reload",
            None,
            false,
        );
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), Some(7));
        assert!(producer.verify_drained_document(7, "doc-reloaded-7", 1));

        // 4. C11-H2 & C12-H2: API-initiated same-document fragment addition (`#frag`) AND fragment removal (`/page#frag` -> `/page`)
        //    with real same-document `Page.navigate` response (`loader_id = None`) restore `"doc-reloaded-7"` and fence old `subDocGen`!
        producer.request_audio_doc_epoch(8);
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), None);
        assert!(producer.nav_listener.on_navigation_dispatched(
            Some("PAGE-AUDIO"),
            104,
            "Page.navigate",
            Some(8),
            Some("http://127.0.0.1/page#frag"),
        ));
        // Event-before-response ordering with `loader_id = None`:
        producer.nav_listener.on_navigated_within_document(
            Some("PAGE-AUDIO"),
            Some("PAGE-AUDIO"),
            Some("http://127.0.0.1/page#frag"),
            Some("fragment"),
        );
        producer.nav_listener.on_navigation_response(
            Some("PAGE-AUDIO"),
            104,
            "Page.navigate",
            None,
            false,
        );
        assert_eq!(
            producer.audio_doc_authority().active_committed_epoch(),
            Some(8),
            "API fragment addition with loader_id=None must commit epoch 8 via NavigatedWithinDocument"
        );
        assert!(
            !producer.verify_drained_document(8, "doc-reloaded-7", 1),
            "pre-fragment subDocGen=1 must be rejected after API fragment navigation"
        );
        assert!(
            producer.verify_drained_document(8, "doc-reloaded-7", 2),
            "surviving document doc-reloaded-7 must be restored/un-retired with subDocGen=2 after API fragment navigation (C11-H2)"
        );

        // C12-H2: Fragment removal (`/page#frag` -> `/page`, no `#` in target URL!) in response-before-event ordering:
        producer.request_audio_doc_epoch(9);
        assert!(producer.nav_listener.on_navigation_dispatched(
            Some("PAGE-AUDIO"),
            105,
            "Page.navigate",
            Some(9),
            Some("http://127.0.0.1/page"),
        ));
        producer.nav_listener.on_navigation_response(
            Some("PAGE-AUDIO"),
            105,
            "Page.navigate",
            None,
            false,
        );
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), None);
        producer.nav_listener.on_navigated_within_document(
            Some("PAGE-AUDIO"),
            Some("PAGE-AUDIO"),
            Some("http://127.0.0.1/page"),
            Some("fragment"),
        );
        assert_eq!(
            producer.audio_doc_authority().active_committed_epoch(),
            Some(9),
            "API fragment removal (/page#frag -> /page) must restore surviving document at epoch 9 (C12-H2)"
        );
        assert!(!producer.verify_drained_document(9, "doc-reloaded-7", 2));
        assert!(producer.verify_drained_document(9, "doc-reloaded-7", 3));

        // 5. C12-H6: Cross-document `Page.navigate` to `/other#anchor` (and cross-document history) where old page
        //    fires `pushState`/same-document event before response, and response returns a new `loaderId = Some("L-CROSS-10")`!
        producer.request_audio_doc_epoch(10);
        assert!(producer.nav_listener.on_navigation_dispatched(
            Some("PAGE-AUDIO"),
            106,
            "Page.navigate",
            Some(10),
            Some("http://127.0.0.1/other#anchor"),
        ));
        // Old page fires pushState AND even a spoofed same-URL fragment event before response:
        producer.nav_listener.on_navigated_within_document(
            Some("PAGE-AUDIO"),
            Some("PAGE-AUDIO"),
            Some("http://127.0.0.1/page-pushed"),
            Some("historyApi"),
        );
        producer.nav_listener.on_navigated_within_document(
            Some("PAGE-AUDIO"),
            Some("PAGE-AUDIO"),
            Some("http://127.0.0.1/other#anchor"),
            Some("fragment"),
        );
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), None);
        // Actual Page.navigate response supplies new loaderId ("L-CROSS-10"): MUST clear same_doc_committed/restore and stay pending!
        producer.nav_listener.on_navigation_response(
            Some("PAGE-AUDIO"),
            106,
            "Page.navigate",
            Some("L-CROSS-10"),
            false,
        );
        assert_eq!(
            producer.audio_doc_authority().active_committed_epoch(),
            None,
            "cross-document Page.navigate with loaderId must NOT be committed by old-page same-document event (C12-H6)"
        );
        assert!(!producer.verify_drained_document(10, "doc-reloaded-7", 4));
        // Only when the matching cross-document FrameNavigated("L-CROSS-10") arrives does epoch 10 commit, and old doc-reloaded-7 stays retired:
        producer
            .nav_listener
            .on_frame_navigated(Some("PAGE-AUDIO"), true, Some("L-CROSS-10"));
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), Some(10));
        assert!(
            !producer.verify_drained_document(10, "doc-reloaded-7", 4),
            "old document must remain retired after cross-document /other#anchor commit (C12-H6)"
        );
        assert!(producer.verify_drained_document(10, "doc-other-10", 1));

        // 6. C11-H6 Subcase 2: Already-admitted old operation (epoch 11) completing AFTER newer operation (epoch 12) already committed!
        producer.request_audio_doc_epoch(11);
        assert!(producer.nav_listener.on_navigation_dispatched(
            Some("PAGE-AUDIO"),
            107,
            "Page.navigate",
            Some(11),
            Some("http://127.0.0.1/slow-11"),
        ));
        producer.request_audio_doc_epoch(12);
        assert!(producer.nav_listener.on_navigation_dispatched(
            Some("PAGE-AUDIO"),
            108,
            "Page.navigate",
            Some(12),
            Some("http://127.0.0.1/fast-12"),
        ));
        // Newer operation (108, epoch 12) commits FIRST and binds "doc-b12":
        producer.nav_listener.on_navigation_response(
            Some("PAGE-AUDIO"),
            108,
            "Page.navigate",
            Some("L-B12"),
            false,
        );
        producer
            .nav_listener
            .on_frame_navigated(Some("PAGE-AUDIO"), true, Some("L-B12"));
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), Some(12));
        assert!(producer.verify_drained_document(12, "doc-b12", 1));
        // Now already-admitted older operation (107, epoch 11) completes late and replaces native document:
        producer.nav_listener.on_navigation_response(
            Some("PAGE-AUDIO"),
            107,
            "Page.navigate",
            Some("L-A11-LATE"),
            false,
        );
        producer
            .nav_listener
            .on_frame_navigated(Some("PAGE-AUDIO"), true, Some("L-A11-LATE"));
        assert_eq!(
            producer.audio_doc_authority().active_committed_epoch(),
            None,
            "late completion of already-admitted older operation must fence authority rather than leaving epoch 12 open (C11-H6)"
        );
        assert!(
            !producer.verify_drained_document(12, "doc-a11-late", 1),
            "stale late page must NOT be accepted under newer epoch 12"
        );
        assert!(!producer.verify_drained_document(11, "doc-a11-late", 1));
        // Recover cleanly on epoch 13:
        producer.request_audio_doc_epoch(13);
        assert!(producer.nav_listener.on_navigation_dispatched(
            Some("PAGE-AUDIO"),
            109,
            "Page.navigate",
            Some(13),
            Some("http://127.0.0.1/recover-13"),
        ));
        producer.nav_listener.on_navigation_response(
            Some("PAGE-AUDIO"),
            109,
            "Page.navigate",
            Some("L-13"),
            false,
        );
        producer
            .nav_listener
            .on_frame_navigated(Some("PAGE-AUDIO"), true, Some("L-13"));
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), Some(13));
        assert!(producer.verify_drained_document(13, "doc-recover-13", 1));

        // Cross-document Page.navigateToHistoryEntry with old-page pushState injection before FrameNavigated:
        producer.request_audio_doc_epoch(14);
        assert!(producer.nav_listener.on_navigation_dispatched(
            Some("PAGE-AUDIO"),
            110,
            "Page.navigateToHistoryEntry",
            Some(14),
            Some("http://127.0.0.1/page#frag"),
        ));
        producer.nav_listener.on_navigated_within_document(
            Some("PAGE-AUDIO"),
            Some("PAGE-AUDIO"),
            Some("http://127.0.0.1/other-pushed"),
            Some("historyApi"),
        );
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), None);
        producer.nav_listener.on_navigation_response(
            Some("PAGE-AUDIO"),
            110,
            "Page.navigateToHistoryEntry",
            None,
            false,
        );
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), None);
        producer
            .nav_listener
            .on_frame_navigated(Some("PAGE-AUDIO"), true, Some("L-HIST-14"));
        assert_eq!(producer.audio_doc_authority().active_committed_epoch(), Some(14));
        assert!(!producer.verify_drained_document(14, "doc-recover-13", 1));
        assert!(producer.verify_drained_document(14, "doc-hist-14", 1));
        let new_doc_epoch = producer.audio_doc_epoch();
        assert_eq!(new_doc_epoch, 14);
        // Odd byte count (3 bytes) rejected
        let odd_b64 = BASE64_STANDARD.encode([1u8, 2, 3]);
        assert!(producer
            .admit_and_broadcast_audio_chunk(active_run, new_doc_epoch, &odd_b64)
            .await
            .is_none());

        // Stale run rejected
        let stale_run = Uuid::new_v4();
        assert!(producer
            .admit_and_broadcast_audio_chunk(stale_run, new_doc_epoch, &valid_pcm_b64)
            .await
            .is_none());

        // u64::MAX sequence boundary never wraps to 0 or emits sequence 1
        let source_seq = producer.audio_source.lock().as_ref().unwrap().seq.clone();
        source_seq.store(u64::MAX, Ordering::SeqCst);
        assert!(producer
            .admit_and_broadcast_audio_chunk(active_run, new_doc_epoch, &valid_pcm_b64)
            .await
            .is_none());
        assert_eq!(source_seq.load(Ordering::SeqCst), u64::MAX);

        // Zero visible viewers rejects audio admission
        source_seq.store(1, Ordering::SeqCst);
        producer.remove_viewer_demand(&sub_epoch).await;
        assert!(producer
            .admit_and_broadcast_audio_chunk(active_run, new_doc_epoch, &valid_pcm_b64)
            .await
            .is_none());

        let _ = producer.stop_screencast().await;
        browser.client.close().await;
    }
}
