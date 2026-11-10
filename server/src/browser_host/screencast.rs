use std::collections::HashMap;
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

use super::cdp::{CdpClient, CdpError, ScreencastFrameData};
use super::diagnostics::{global_memory_controller, global_stream_diagnostics, TrackedBhjfFrame};
use super::protocol::{
    pack_bhjf_frame, parse_jpeg_dimensions, TargetFrameHeader, TargetGeometry, MAX_IMAGE_HEIGHT,
    MAX_IMAGE_WIDTH, MAX_JPEG_PAYLOAD_BYTES, MAX_PIXELS,
};

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
    capture_time_unix_ms: u64,
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

pub struct ScreencastProducer {
    browser_session_id: String,
    browser_incarnation: String,
    profile_epoch: u64,
    viewport_epoch: Arc<AtomicU64>,
    frame_seq: Arc<AtomicU64>,
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
        Self {
            browser_session_id,
            browser_incarnation,
            profile_epoch,
            viewport_epoch: Arc::new(AtomicU64::new(viewport_epoch.max(1))),
            frame_seq: Arc::new(AtomicU64::new(0)),
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
            frame_broadcast,
            active_run_cancel: Arc::new(Mutex::new(None)),
            geometry: Arc::new(RwLock::new(initial_geometry)),
            page_setup: Arc::new(Mutex::new(())),
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
                    .quality(65)
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
        Ok(session_id)
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
            .quality(65)
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

        let candidate = EncodedCandidate {
            _frame_session_id: frame_session_id,
            data_base64: frame_data.data_base64.clone(),
            capture_time_unix_ms: chrono::Utc::now().timestamp_millis() as u64,
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
            capture_time_unix_ms: candidate.capture_time_unix_ms,
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
                let tracked = TrackedBhjfFrame::new(packed_bytes, reservation);
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
            .quality(65)
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

        let header = TargetFrameHeader {
            browser_session_id: self.browser_session_id.clone(),
            browser_incarnation: self.browser_incarnation.clone(),
            profile_epoch: self.profile_epoch.to_string(),
            producer_run: producer_run.to_string(),
            viewport_epoch: epoch_after.to_string(),
            frame_seq: next_seq.to_string(),
            width,
            height,
            capture_time_unix_ms: chrono::Utc::now().timestamp_millis() as u64,
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
            let tracked = TrackedBhjfFrame::new(packed_bytes, reservation);
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
            frame_broadcast: self.frame_broadcast.clone(),
            active_run_cancel: self.active_run_cancel.clone(),
            geometry: self.geometry.clone(),
            page_setup: self.page_setup.clone(),
        })
    }
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
}
