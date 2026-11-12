use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chromiumoxide_cdp::cdp::browser_protocol::page::{
    CaptureScreenshotFormat, CaptureScreenshotParams, EnableParams, GetLayoutMetricsParams,
    StartScreencastFormat, StartScreencastParams, StopScreencastParams,
};
use chromiumoxide_cdp::cdp::browser_protocol::target::AttachToTargetParams;
use tokio::sync::{broadcast, Mutex, RwLock};
use tokio::time::interval;
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};
use uuid::Uuid;

use super::cdp::{CdpClient, CdpError, CdpNavigationListener, ScreencastFrameData};
use super::diagnostics::{global_memory_controller, global_stream_diagnostics, TrackedBhjfFrame};
use super::protocol::{
    pack_bhjf_frame, parse_jpeg_dimensions, ProducerAudioChunk, TargetFrameHeader, TargetGeometry,
    AUDIO_CHANNELS, AUDIO_ENCODING_PCM16LE, AUDIO_SAMPLE_RATE, MAX_AUDIO_BASE64_BYTES,
    MAX_AUDIO_PCM_BYTES, MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH, MAX_JPEG_PAYLOAD_BYTES, MAX_PIXELS,
};

pub const DEFAULT_JPEG_QUALITY_LEGACY: u8 = 65;
pub const AUDIO_DRAIN_INTERVAL: Duration = Duration::from_millis(50);
pub const DEFAULT_GOVERNOR_INTERVAL: Duration = Duration::from_millis(100); // 10 FPS
pub const SCREENSHOT_FALLBACK_DELAY: Duration = Duration::from_millis(250);
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);
pub const VISIBLE_DEMAND_EXPIRY: Duration = Duration::from_secs(15);
pub const MAX_BASE64_BYTES: usize = 2_796_204; // 2 MiB decoded ceiling

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
    data_base64: String,
    native_capture_time_unix_ms: Option<u64>,
    server_received_unix_ms: u64,
    received_at: Instant,
    metadata_geometry: Option<TargetGeometry>,
    producer_run: Uuid,
    viewport_epoch: u64,
}
#[derive(Debug, Clone)]
pub struct ViewerDemand {
    pub viewer_id: String,
    pub subscription_epoch: String,
    pub last_heartbeat: Instant,
    pub visible: bool,
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

pub struct ScreencastProducer {
    browser_session_id: String,
    browser_incarnation: String,
    profile_epoch: u64,
    viewport_epoch: Arc<AtomicU64>,
    frame_seq: Arc<AtomicU64>,
    audio_seq: Arc<AtomicU64>,
    audio_doc_epoch: Arc<AtomicU64>,
    doc_epoch_tx: Arc<tokio::sync::watch::Sender<AudioDocAuthority>>,
    nav_listener: Arc<ProducerNavListener>,
    pub cdp_client: Arc<CdpClient>,
    target_id: String,
    page_session_id: Arc<RwLock<Option<String>>>,
    current_run: Arc<RwLock<Option<Uuid>>>,
    native_screencast_session_id: Arc<RwLock<Option<i64>>>,
    state: Arc<RwLock<ScreencastState>>,
    current_candidate: Arc<Mutex<Option<EncodedCandidate>>>,
    cached_frame: Arc<RwLock<Option<TrackedBhjfFrame>>>,
    cached_header: Arc<RwLock<Option<TargetFrameHeader>>>,
    viewers: Arc<RwLock<HashMap<String, ViewerDemand>>>, // key: subscription_epoch
    pub ledger: Arc<ScreencastLedger>,
    screenshot_taken_in_epoch: Arc<AtomicBool>,
    governor_interval: Duration,
    jpeg_quality: u8,
    audio_broadcast: broadcast::Sender<ProducerAudioChunk>,
    frame_broadcast: broadcast::Sender<TrackedBhjfFrame>,
    active_run_cancel: Arc<Mutex<Option<CancellationToken>>>,
    geometry: Arc<RwLock<TargetGeometry>>,
    /// Serializes Page-session setup so exactly one session exists.
    page_setup: Arc<Mutex<()>>,
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
        Self {
            browser_session_id,
            browser_incarnation,
            profile_epoch,
            viewport_epoch: Arc::new(AtomicU64::new(viewport_epoch.max(1))),
            frame_seq: Arc::new(AtomicU64::new(0)),
            audio_seq: Arc::new(AtomicU64::new(0)),
            audio_doc_epoch,
            doc_epoch_tx,
            nav_listener,
            cdp_client,
            target_id,
            page_session_id: Arc::new(RwLock::new(None)),
            current_run: Arc::new(RwLock::new(None)),
            native_screencast_session_id: Arc::new(RwLock::new(None)),
            state: Arc::new(RwLock::new(ScreencastState::Stopped)),
            current_candidate: Arc::new(Mutex::new(None)),
            cached_frame: Arc::new(RwLock::new(None)),
            cached_header: Arc::new(RwLock::new(None)),
            viewers: Arc::new(RwLock::new(HashMap::new())),
            ledger: Arc::new(ScreencastLedger::default()),
            screenshot_taken_in_epoch: Arc::new(AtomicBool::new(false)),
            governor_interval: DEFAULT_GOVERNOR_INTERVAL,
            jpeg_quality: DEFAULT_JPEG_QUALITY_LEGACY,
            frame_broadcast,
            audio_broadcast,
            active_run_cancel: Arc::new(Mutex::new(None)),
            geometry: Arc::new(RwLock::new(initial_geometry)),
            page_setup: Arc::new(Mutex::new(())),
        }
    }

    /// Configures capture FPS (1..=30) and JPEG quality (10..=100) for production streaming.
    pub fn with_capture_policy(mut self, fps: u32, jpeg_quality: u8) -> Self {
        let clamped_fps = fps.clamp(1, 30);
        self.governor_interval = Duration::from_secs_f64(1.0 / (clamped_fps as f64));
        self.jpeg_quality = jpeg_quality.clamp(10, 100);
        self
    }

    pub fn subscribe_audio(&self) -> broadcast::Receiver<ProducerAudioChunk> {
        self.audio_broadcast.subscribe()
    }

    pub fn governor_interval(&self) -> Duration {
        self.governor_interval
    }

    pub fn jpeg_quality(&self) -> u8 {
        self.jpeg_quality
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
        self.viewport_epoch.load(Ordering::Relaxed)
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

    /// Advancing viewport epoch (e.g. on client resize or viewport change).
    /// Contract: viewportEpoch advances BEFORE commands and publishing.
    pub async fn update_geometry(&self, new_geometry: TargetGeometry) -> Result<(), &'static str> {
        if new_geometry.validate().is_err() {
            return Err("invalid geometry");
        }
        let mut geom = self.geometry.write().await;
        let dims_changed =
            geom.css_width != new_geometry.css_width || geom.css_height != new_geometry.css_height;
        *geom = new_geometry.clone();
        self.viewport_epoch.fetch_add(1, Ordering::SeqCst);
        self.screenshot_taken_in_epoch
            .store(false, Ordering::SeqCst);
        // Clear candidate so pre-resize candidate cannot be published in new epoch
        *self.current_candidate.lock().await = None;
        if dims_changed {
            *self.cached_frame.write().await = None;
            *self.cached_header.write().await = None;
        }
        if let Some(page_sid) = self.page_session_id.read().await.clone() {
            let emu_params = serde_json::json!({
                "width": new_geometry.css_width.round() as u32,
                "height": new_geometry.css_height.round() as u32,
                "deviceScaleFactor": new_geometry.dpr,
                "mobile": false,
            });
            let _ = self
                .cdp_client
                .send_command(
                    "Emulation.setDeviceMetricsOverride",
                    Some(emu_params),
                    Some(&page_sid),
                )
                .await;
            if dims_changed && *self.state.read().await == ScreencastState::Streaming {
                let max_w = (new_geometry.css_width.round() as u32).clamp(64, MAX_IMAGE_WIDTH);
                let max_h = (new_geometry.css_height.round() as u32).clamp(64, MAX_IMAGE_HEIGHT);
                let screencast_params = StartScreencastParams::builder()
                    .format(StartScreencastFormat::Jpeg)
                    .quality(i64::from(self.jpeg_quality))
                    .max_width(max_w)
                    .max_height(max_h)
                    .every_nth_frame(1)
                    .build();
                let _ = self
                    .cdp_client
                    .send_typed(screencast_params, Some(&page_sid))
                    .await;
            }
        }
        Ok(())
    }

    /// Attach a dedicated flattened Page session for this target if not already attached.
    pub async fn ensure_page_session(&self) -> Result<String, CdpError> {
        if let Some(session_id) = self.page_session_id.read().await.clone() {
            return Ok(session_id);
        }
        let _setup = self.page_setup.lock().await;
        if let Some(session_id) = self.page_session_id.read().await.clone() {
            return Ok(session_id);
        }

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
        let geometry = self.geometry.read().await;
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
        drop(geometry);

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
        tokio::spawn(async move {
            loop {
                match target_events.recv().await {
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

        let visible_count = viewers.values().filter(|v| v.visible).count();
        drop(viewers);

        if visible_count > 0 {
            let state = *self.state.read().await;
            if state == ScreencastState::Stopped {
                self.ledger.demand_starts.fetch_add(1, Ordering::Relaxed);
                let this = self.clone_handle();
                tokio::spawn(async move {
                    if let Err(e) = this.start_screencast_run().await {
                        warn!(error = %e, "failed to start screencast on demand");
                    }
                });
            }
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
        viewers.retain(|_, v| now.duration_since(v.last_heartbeat) <= VISIBLE_DEMAND_EXPIRY);
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
    /// Strictly serial: acquires state write lock, generates fresh `producerRun` UUID,
    /// subscribes to broadcast stream, issues `Page.startScreencast`, spawns drain and governor tasks.
    pub async fn start_screencast_run(&self) -> Result<Uuid, CdpError> {
        let mut state_lock = self.state.write().await;
        if *state_lock == ScreencastState::Streaming || *state_lock == ScreencastState::Starting {
            if let Some(run_id) = *self.current_run.read().await {
                return Ok(run_id);
            }
        }

        *state_lock = ScreencastState::Starting;
        let producer_run = Uuid::new_v4();
        {
            let mut run_lock = self.current_run.write().await;
            *run_lock = Some(producer_run);
        }
        self.audio_seq.store(0, Ordering::SeqCst);
        {
            let mut native_sess = self.native_screencast_session_id.write().await;
            *native_sess = None;
        }

        let page_session_id = match self.ensure_page_session().await {
            Ok(sid) => sid,
            Err(e) => {
                *state_lock = ScreencastState::Stopped;
                return Err(e);
            }
        };

        // Cancel prior run task if any
        {
            let mut cancel_lock = self.active_run_cancel.lock().await;
            if let Some(old_cancel) = cancel_lock.take() {
                old_cancel.cancel();
            }
            *cancel_lock = Some(CancellationToken::new());
        }
        let cancel_token = self
            .active_run_cancel
            .lock()
            .await
            .as_ref()
            .unwrap()
            .clone();

        // Subscribe to broadcast receiver BEFORE startScreencast command
        let screencast_rx = self.cdp_client.subscribe_screencast();

        // Build start screencast parameters
        let geom = self.geometry.read().await.clone();
        let max_w = (geom.css_width.round() as u32).clamp(64, MAX_IMAGE_WIDTH);
        let max_h = (geom.css_height.round() as u32).clamp(64, MAX_IMAGE_HEIGHT);

        let screencast_params = StartScreencastParams::builder()
            .format(StartScreencastFormat::Jpeg)
            .quality(i64::from(self.jpeg_quality))
            .max_width(max_w)
            .max_height(max_h)
            .every_nth_frame(1)
            .build();

        if let Err(e) = self
            .cdp_client
            .send_typed(screencast_params, Some(&page_session_id))
            .await
        {
            *state_lock = ScreencastState::Stopped;
            return Err(e);
        }

        *state_lock = ScreencastState::Streaming;
        drop(state_lock);

        // Spawn drain & governor tasks for this run
        let this = self.clone_handle();
        tokio::spawn(async move {
            this.run_producer_tasks(page_session_id, producer_run, screencast_rx, cancel_token)
                .await;
        });

        Ok(producer_run)
    }

    /// Stops screencast explicitly or due to zero demand.
    /// Retains the final cached frame and does not withhold ACKs.
    pub async fn stop_screencast(&self) -> Result<(), CdpError> {
        let mut state_lock = self.state.write().await;
        if *state_lock == ScreencastState::Stopped || *state_lock == ScreencastState::Stopping {
            return Ok(());
        }

        *state_lock = ScreencastState::Stopping;
        let page_session_id = self.page_session_id.read().await.clone();

        // Cancel background loop
        {
            let mut cancel_lock = self.active_run_cancel.lock().await;
            if let Some(token) = cancel_lock.take() {
                token.cancel();
            }
        }

        if let Some(sid) = page_session_id {
            let _ = self
                .cdp_client
                .send_typed(StopScreencastParams::default(), Some(&sid))
                .await;
        }

        *state_lock = ScreencastState::Stopped;
        {
            let mut run_lock = self.current_run.write().await;
            *run_lock = None;
        }
        {
            let mut native_sess = self.native_screencast_session_id.write().await;
            *native_sess = None;
        }
        Ok(())
    }

    async fn stop_screencast_due_to_zero_demand(&self) {
        let state = *self.state.read().await;
        if state == ScreencastState::Streaming || state == ScreencastState::Starting {
            self.ledger
                .zero_demand_stops
                .fetch_add(1, Ordering::Relaxed);
            if let Err(e) = self.stop_screencast().await {
                warn!(error = %e, "error during zero demand screencast stop");
            }
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
        let mut governor_ticker = interval(self.governor_interval);
        let mut heartbeat_ticker = interval(Duration::from_secs(1));
        let start_time = Instant::now();

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

        let audio_this = self.clone_handle();
        let audio_sid = page_session_id.clone();
        let audio_cancel = cancel_token.clone();
        let audio_handle = tokio::spawn(async move {
            audio_this
                .run_audio_drain_loop(audio_sid, producer_run, audio_cancel)
                .await;
        });
        loop {
            tokio::select! {
                _ = cancel_token.cancelled() => {
                    debug!(producer_run = %producer_run, "producer tasks cancelled");
                    break;
                }
                _ = heartbeat_ticker.tick() => {
                    self.check_viewer_expiry().await;
                }
                res = screencast_rx.recv() => {
                    match res {
                        Ok(frame_data) => {
                            self.handle_incoming_frame(
                                &page_session_id,
                                producer_run,
                                frame_data,
                            ).await;
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            warn!(lagged = n, "screencast receiver lagged; proceeding without crash");
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            warn!("screencast broadcast channel closed");
                            break;
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
        let _ = audio_handle.await;
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
                        || *self.current_run.read().await != Some(producer_run)
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
        producer_run: Uuid,
        expected_doc_epoch: u64,
        b64: &str,
    ) -> Option<ProducerAudioChunk> {
        if b64.is_empty() || b64.len() > MAX_AUDIO_BASE64_BYTES {
            return None;
        }
        if !self.audio_doc_authority().is_admissible(expected_doc_epoch)
            || *self.current_run.read().await != Some(producer_run)
            || self.visible_viewer_count().await == 0
        {
            return None;
        }
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
        let prev_seq = self
            .audio_seq
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_add(1))
            .ok()?;
        let seq = prev_seq + 1;
        let chunk = ProducerAudioChunk {
            browser_session_id: self.browser_session_id.clone(),
            browser_incarnation: self.browser_incarnation.clone(),
            profile_epoch: self.profile_epoch.to_string(),
            producer_run: producer_run.to_string(),
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
    ) {
        self.ledger.events_received.fetch_add(1, Ordering::Relaxed);
        global_stream_diagnostics()
            .events_received
            .fetch_add(1, Ordering::Relaxed);

        // Verify that this event belongs to our Page session
        if frame_data.session_id != expected_page_session {
            self.ledger
                .events_dropped_old_run
                .fetch_add(1, Ordering::Relaxed);
            return;
        }

        // Check if current run matches
        let cur_run = *self.current_run.read().await;
        if cur_run != Some(expected_producer_run) {
            self.ledger
                .events_dropped_old_run
                .fetch_add(1, Ordering::Relaxed);
            return;
        }

        // Enforce base64 byte bounds
        if frame_data.data_base64.len() > MAX_BASE64_BYTES {
            warn!(
                len = frame_data.data_base64.len(),
                "screencast base64 frame exceeded maximum size"
            );
            self.ledger
                .events_dropped_old_run
                .fetch_add(1, Ordering::Relaxed);
            return;
        }

        // Establish or verify native sessionId
        let frame_session_id = frame_data.frame_session_id;
        {
            let mut native_sess = self.native_screencast_session_id.write().await;
            if let Some(expected_native) = *native_sess {
                if expected_native != frame_session_id {
                    warn!(
                        expected = expected_native,
                        got = frame_session_id,
                        "native session id mismatch on current run; dropping event"
                    );
                    return;
                }
            } else {
                *native_sess = Some(frame_session_id);
            }
        }

        // Enqueue exactly one ACK for each received current-run event
        let ack_res = self
            .cdp_client
            .ack_screencast_frame(expected_page_session, frame_session_id)
            .await;

        match ack_res {
            Ok(()) => {
                self.ledger.acks_enqueued.fetch_add(1, Ordering::Relaxed);
                global_stream_diagnostics()
                    .acks_enqueued
                    .fetch_add(1, Ordering::Relaxed);
            }
            Err(e) => {
                self.ledger.acks_failed.fetch_add(1, Ordering::Relaxed);
                global_stream_diagnostics()
                    .acks_failed
                    .fetch_add(1, Ordering::Relaxed);
                warn!(error = %e, frame_session_id, "failed to enqueue screencast frame ACK; connection failure aborts run");
                *self.state.write().await = ScreencastState::Stopped;
                let cancel_lock = self.active_run_cancel.lock().await;
                if let Some(token) = cancel_lock.as_ref() {
                    token.cancel();
                }
                return;
            }
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
            data_base64: frame_data.data_base64.clone(),
            native_capture_time_unix_ms: frame_data.native_capture_time_unix_ms,
            server_received_unix_ms: frame_data.server_received_unix_ms,
            received_at: frame_data.received_at,
            metadata_geometry,
            producer_run: expected_producer_run,
            viewport_epoch: self.viewport_epoch.load(Ordering::Relaxed),
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
        if candidate.producer_run != producer_run || candidate.viewport_epoch != v_epoch {
            debug!("dropping candidate from older run or epoch");
            return;
        }

        // Pre-reserve memory BEFORE base64 decoding and packing
        let est_bytes = candidate.data_base64.len() + 1024 + 16;
        let mut reservation = match global_memory_controller().try_reserve(est_bytes) {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "dropping candidate: memory ceiling reached before decode");
                return;
            }
        };

        // Decode base64 only once
        let jpeg_bytes = match BASE64_STANDARD.decode(&candidate.data_base64) {
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
        let (width, height) = match parse_jpeg_dimensions(&jpeg_bytes) {
            Ok(dims) => dims,
            Err(e) => {
                warn!(error = %e, "candidate JPEG SOF marker parse failed");
                return;
            }
        };

        if width == 0 || width > MAX_IMAGE_WIDTH || height == 0 || height > MAX_IMAGE_HEIGHT {
            warn!(width, height, "candidate JPEG dimensions out of bounds");
            return;
        }
        let pixels = (width as u64) * (height as u64);
        if pixels > MAX_PIXELS {
            warn!(pixels, "candidate JPEG pixel ceiling exceeded");
            return;
        }

        let geom = if let Some(meta_geom) = candidate.metadata_geometry {
            meta_geom
        } else {
            self.geometry.read().await.clone()
        };

        let next_seq = self.frame_seq.fetch_add(1, Ordering::SeqCst) + 1;
        let v_epoch = self.viewport_epoch.load(Ordering::Relaxed);

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
            input_trusted: true,
        };

        match pack_bhjf_frame(&header, &jpeg_bytes) {
            Ok(packed_bytes) => {
                if let Err(e) = reservation.adjust(packed_bytes.len()) {
                    warn!(error = %e, "dropping BHJF frame: memory reservation ceiling exceeded on adjust");
                    return;
                }
                global_stream_diagnostics()
                    .jpeg_bytes_total
                    .fetch_add(jpeg_bytes.len() as u64, Ordering::Relaxed);
                let tracked = TrackedBhjfFrame::new(packed_bytes, reservation)
                    .with_receipt_time(candidate.server_received_unix_ms, candidate.received_at);
                {
                    let mut frame_cache = self.cached_frame.write().await;
                    *frame_cache = Some(tracked.clone());
                }
                {
                    let mut hdr_cache = self.cached_header.write().await;
                    *hdr_cache = Some(header);
                }

                // Broadcast
                let _ = self.frame_broadcast.send(tracked);
                self.ledger.frames_published.fetch_add(1, Ordering::Relaxed);
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
            .quality(i64::from(self.jpeg_quality))
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

        // 3. Bracket layout metrics after
        let _metrics_after = self
            .cdp_client
            .send_typed(GetLayoutMetricsParams::default(), Some(page_session_id))
            .await;

        // 4. Recheck epoch
        let epoch_after = self.viewport_epoch.load(Ordering::Relaxed);
        if epoch_before != epoch_after {
            warn!("epoch changed during fallback screenshot; discarding snapshot");
            return;
        }

        // Pre-reserve memory BEFORE decode
        let est_bytes = AsRef::<[u8]>::as_ref(&shot_res.data).len() + 1024 + 16;
        let mut reservation = match global_memory_controller().try_reserve(est_bytes) {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "dropping fallback screenshot: memory ceiling reached");
                return;
            }
        };

        let jpeg_bytes = match BASE64_STANDARD.decode(&shot_res.data) {
            Ok(b) => b,
            Err(e) => {
                warn!(error = %e, "failed to decode screenshot base64");
                return;
            }
        };

        let (width, height) = match parse_jpeg_dimensions(&jpeg_bytes) {
            Ok(dims) => dims,
            Err(e) => {
                warn!(error = %e, "fallback screenshot JPEG parse failed");
                return;
            }
        };

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
        if let Ok(packed_bytes) = pack_bhjf_frame(&header, &jpeg_bytes) {
            if let Err(e) = reservation.adjust(packed_bytes.len()) {
                warn!(error = %e, "dropping fallback screenshot: memory ceiling exceeded on adjust");
                return;
            }
            global_stream_diagnostics()
                .screenshot_count
                .fetch_add(1, Ordering::Relaxed);
            let tracked = TrackedBhjfFrame::new(packed_bytes, reservation)
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
            audio_seq: self.audio_seq.clone(),
            audio_doc_epoch: self.audio_doc_epoch.clone(),
            doc_epoch_tx: self.doc_epoch_tx.clone(),
            nav_listener: self.nav_listener.clone(),
            cdp_client: self.cdp_client.clone(),
            target_id: self.target_id.clone(),
            page_session_id: self.page_session_id.clone(),
            current_run: self.current_run.clone(),
            native_screencast_session_id: self.native_screencast_session_id.clone(),
            state: self.state.clone(),
            current_candidate: self.current_candidate.clone(),
            cached_frame: self.cached_frame.clone(),
            cached_header: self.cached_header.clone(),
            viewers: self.viewers.clone(),
            ledger: self.ledger.clone(),
            screenshot_taken_in_epoch: self.screenshot_taken_in_epoch.clone(),
            governor_interval: self.governor_interval,
            jpeg_quality: self.jpeg_quality,
            frame_broadcast: self.frame_broadcast.clone(),
            audio_broadcast: self.audio_broadcast.clone(),
            active_run_cancel: self.active_run_cancel.clone(),
            geometry: self.geometry.clone(),
            page_setup: self.page_setup.clone(),
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
                    }).await.unwrap();
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
        assert_eq!(producer.jpeg_quality(), 75);
        assert_eq!(producer.governor_interval(), Duration::from_secs_f64(1.0 / 24.0));

        let mut audio_rx = producer.subscribe_audio();
        let sub_epoch = Uuid::new_v4().to_string();
        producer.register_viewer_demand("v1", &sub_epoch, true).await;

        // Drain attach + enable + deviceMetrics + startScreencast commands
        let mut saw_start = false;
        for _ in 0..4 {
            let cmd = next_command(&mut browser).await;
            if cmd["method"] == "Page.startScreencast" {
                assert_eq!(cmd["params"]["quality"], 75);
                saw_start = true;
            }
        }
        assert!(saw_start, "Page.startScreencast must use configured quality 75");

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
        producer.audio_seq.store(u64::MAX, Ordering::SeqCst);
        assert!(producer
            .admit_and_broadcast_audio_chunk(active_run, new_doc_epoch, &valid_pcm_b64)
            .await
            .is_none());
        assert_eq!(producer.audio_seq.load(Ordering::SeqCst), u64::MAX);

        // Zero visible viewers rejects audio admission
        producer.audio_seq.store(1, Ordering::SeqCst);
        producer.remove_viewer_demand(&sub_epoch).await;
        assert!(producer
            .admit_and_broadcast_audio_chunk(active_run, new_doc_epoch, &valid_pcm_b64)
            .await
            .is_none());

        let _ = producer.stop_screencast().await;
        browser.client.close().await;
    }
}
