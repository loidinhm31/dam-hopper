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

use super::cdp::{CdpClient, CdpError, RequestPolicyEvent, ScreencastFrameData};
use super::diagnostics::{global_memory_controller, global_stream_diagnostics, TrackedBhjfFrame};
use super::network_policy::{NetworkPolicy, RequestKind};
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

/// Hands a browser-wide containment obligation to the owner of the browser process (the
/// manager). Synchronous and non-blocking: the obligation is accepted before the caller can
/// be cancelled, so it does not depend on the lifetime of the producer that raised it.
pub type ContainmentEscalation = Arc<dyn Fn(&str) + Send + Sync>;

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
    /// Central request policy and the containment owner; when set, `ensure_page_session`
    /// installs CDP `Fetch` interception on the Page session before it is handed out for any
    /// navigation.
    request_policy: Option<(Arc<NetworkPolicy>, ContainmentEscalation)>,
    /// Serializes Page-session setup so exactly one session (and one interceptor) exists.
    page_setup: Arc<Mutex<()>>,
    /// Aborts the request-policy interceptor when the last producer handle is dropped.
    interceptor_task: Arc<TaskGuard>,
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
            request_policy: None,
            page_setup: Arc::new(Mutex::new(())),
            interceptor_task: Arc::new(TaskGuard::default()),
        }
    }

    /// Attaches the central request policy installed on the Page session before navigation,
    /// with the owner that contains the browser when a child cannot be policed or stopped.
    pub fn with_request_policy(
        mut self,
        policy: Arc<NetworkPolicy>,
        escalate: ContainmentEscalation,
    ) -> Self {
        self.request_policy = Some((policy, escalate));
        self
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

        // The request policy is live before the session is published, so no caller can
        // navigate this target without redirect/subresource interception.
        if let Some((policy, escalate)) = &self.request_policy {
            if let Err(err) = self
                .install_request_policy(policy, escalate, &session_id)
                .await
            {
                self.interceptor_task.abort();
                return Err(err);
            }
        }

        // Enable Page domain
        self.cdp_client
            .send_typed(EnableParams::default(), Some(&session_id))
            .await?;

        let mut lock = self.page_session_id.write().await;
        *lock = Some(session_id.clone());
        Ok(session_id)
    }

    /// Starts the interceptor, then enables `Fetch` (request stage, all URLs) and flattened
    /// auto-attach (paused until the child is also intercepted) on the Page session.
    async fn install_request_policy(
        &self,
        policy: &Arc<NetworkPolicy>,
        escalate: &ContainmentEscalation,
        session_id: &str,
    ) -> Result<(), CdpError> {
        // Subscribe before enabling so no paused request can precede the receiver.
        let events = self.cdp_client.subscribe_request_events();
        self.interceptor_task
            .replace(tokio::spawn(run_request_interceptor(
                Arc::downgrade(&self.cdp_client),
                policy.clone(),
                events,
                self.target_id.clone(),
                escalate.clone(),
            )));
        enable_request_interception(&self.cdp_client, session_id).await
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
            request_policy: self.request_policy.clone(),
            page_setup: self.page_setup.clone(),
            interceptor_task: self.interceptor_task.clone(),
        })
    }
}

/// Owns the request-policy interceptor task and aborts it when the last producer handle drops.
#[derive(Default)]
struct TaskGuard(std::sync::Mutex<Option<tokio::task::JoinHandle<()>>>);

impl TaskGuard {
    fn replace(&self, handle: tokio::task::JoinHandle<()>) {
        let old = self
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .replace(handle);
        if let Some(old) = old {
            old.abort();
        }
    }

    fn abort(&self) {
        if let Some(handle) = self.0.lock().unwrap_or_else(|e| e.into_inner()).take() {
            handle.abort();
        }
    }
}

impl Drop for TaskGuard {
    fn drop(&mut self) {
        self.abort();
    }
}

/// Enables request-stage `Fetch` interception for all URLs and flattened auto-attach (children
/// start paused so they are intercepted before their first request) on one CDP session.
async fn enable_request_interception(client: &CdpClient, session_id: &str) -> Result<(), CdpError> {
    client
        .send_command(
            "Fetch.enable",
            Some(serde_json::json!({
                "patterns": [{ "urlPattern": "*", "requestStage": "Request" }]
            })),
            Some(session_id),
        )
        .await?;
    client
        .send_command(
            "Target.setAutoAttach",
            Some(serde_json::json!({
                "autoAttach": true,
                "waitForDebuggerOnStart": true,
                "flatten": true
            })),
            Some(session_id),
        )
        .await?;
    Ok(())
}

/// Decides every paused request against the central policy: navigations may reach only target
/// origins, subresources also asset origins, and denied destinations never; redirect hops are
/// separate paused requests, so each is decided on its own URL. A request is never continued
/// without a positive policy decision. Holds only a weak client handle so it cannot keep the
/// CDP connection alive.
async fn run_request_interceptor(
    client: std::sync::Weak<CdpClient>,
    policy: Arc<NetworkPolicy>,
    mut events: broadcast::Receiver<Arc<RequestPolicyEvent>>,
    page_target_id: String,
    escalate: ContainmentEscalation,
) {
    use tokio::sync::broadcast::error::RecvError;
    let mut retired = false;
    loop {
        let event = match events.recv().await {
            Ok(event) => event,
            Err(RecvError::Lagged(skipped)) => {
                warn!(skipped, "Browser request-policy events lagged");
                if let Some(client) = client.upgrade() {
                    retire_page_on_policy_loss(
                        &client,
                        &page_target_id,
                        &mut retired,
                        "request-policy events lagged",
                    )
                    .await;
                }
                continue;
            }
            Err(RecvError::Closed) => return,
        };
        let Some(client) = client.upgrade() else {
            return;
        };
        match &*event {
            RequestPolicyEvent::Paused {
                session_id,
                request_id,
                url,
                is_navigation,
                ..
            } => {
                let kind = if *is_navigation {
                    RequestKind::Navigation
                } else {
                    RequestKind::Subresource
                };
                let verdict = if url.is_empty() {
                    Err(super::network_policy::NetworkPolicyError::MissingHost)
                } else {
                    policy.check_request(url, kind)
                };
                let (method, params) = match verdict {
                    Ok(()) => (
                        "Fetch.continueRequest",
                        serde_json::json!({ "requestId": request_id }),
                    ),
                    Err(err) => {
                        debug!(error = %err, "Browser request denied by network policy");
                        (
                            "Fetch.failRequest",
                            serde_json::json!({ "requestId": request_id, "errorReason": "AccessDenied" }),
                        )
                    }
                };
                if let Err(err) = client
                    .send_command(method, Some(params), session_id.as_deref())
                    .await
                {
                    warn!(error = %err, method, "Browser request-policy decision was not delivered");
                }
            }
            RequestPolicyEvent::Attached {
                session_id,
                target_id,
                target_type,
                waiting_for_debugger,
                ..
            } => {
                // Every child (frame or worker) must be intercepted before it runs. A child
                // whose interception failed is never resumed and is contained (see
                // `contain_unpoliced_child`): it must neither run nor stay half-attached.
                match enable_request_interception(&client, session_id).await {
                    Ok(()) => {
                        if *waiting_for_debugger {
                            let _ = client
                                .send_command(
                                    "Runtime.runIfWaitingForDebugger",
                                    None,
                                    Some(session_id),
                                )
                                .await;
                        }
                    }
                    Err(err) => {
                        warn!(error = %err, target_type, "Browser child target interception failed");
                        contain_unpoliced_child(
                            client.clone(),
                            page_target_id.clone(),
                            &mut retired,
                            ChildTarget {
                                target_id: target_id.clone(),
                                target_type: target_type.clone(),
                            },
                            escalate.clone(),
                        )
                        .await;
                    }
                }
            }
            RequestPolicyEvent::Overflow => {
                retire_page_on_policy_loss(
                    &client,
                    &page_target_id,
                    &mut retired,
                    "request-policy event dropped",
                )
                .await;
            }
        }
    }
}

/// A request-policy event was lost, so some request may stay paused forever or some child may
/// run unpoliced. The page is closed (never resumed without a decision): its paused requests
/// die with it and the native observer retires the session on the destroy event. Returns
/// whether the page is retired (its close was accepted).
async fn retire_page_on_policy_loss(
    client: &CdpClient,
    page_target_id: &str,
    retired: &mut bool,
    reason: &str,
) -> bool {
    if *retired {
        return true;
    }
    warn!(
        reason,
        "Browser request policy cannot be enforced; closing the page"
    );
    match client
        .send_command(
            "Target.closeTarget",
            Some(serde_json::json!({ "targetId": page_target_id })),
            None,
        )
        .await
    {
        Ok(_) => *retired = true,
        Err(err) => warn!(error = %err, "closing the page after request-policy loss failed"),
    }
    *retired
}

/// Upper bound for proving a closed worker target absent from `Target.getTargets`.
const WORKER_TERMINATION_PROOF: Duration = Duration::from_secs(2);
const WORKER_TERMINATION_POLL: Duration = Duration::from_millis(50);

/// A flattened auto-attached child whose request interception could not be established.
struct ChildTarget {
    target_id: String,
    target_type: String,
}

/// Frames and dedicated workers die with the page that owns them; every other target type
/// (service workers, shared workers) outlives its documents.
fn dies_with_page(target_type: &str) -> bool {
    matches!(target_type, "page" | "iframe" | "worker")
}

/// Never lets a child without a request policy keep running or stay parked.
///
/// A child is never resumed without a policy, so a paused one would hang its page forever:
/// it is contained like a running one.
///
/// * A page-owned child is retired with its page.
/// * A service/shared worker is terminated through its own target id (`Target.closeTarget`) and
///   its absence is proven from `Target.getTargets`: closing the page does **not** stop an
///   event-driven service worker.
///
/// When retirement or termination cannot be proven, the obligation moves to the owner of the
/// browser process (`escalate`). The whole sequence runs on its own task: the interceptor is
/// aborted when its page is destroyed (which removes the last producer), and that must
/// neither cancel the termination proof nor lose the escalation.
async fn contain_unpoliced_child(
    client: Arc<CdpClient>,
    page_target_id: String,
    retired: &mut bool,
    child: ChildTarget,
    escalate: ContainmentEscalation,
) {
    let page_retired = *retired;
    let work = tokio::spawn(async move {
        let mut retired = page_retired;
        let contained = if dies_with_page(&child.target_type) {
            retire_page_on_policy_loss(
                &client,
                &page_target_id,
                &mut retired,
                "child could not be intercepted",
            )
            .await
        } else {
            terminate_target(&client, &child.target_id).await
        };
        if !contained {
            escalate("a child without request interception could not be retired or terminated");
        }
        retired
    });
    if let Ok(now_retired) = work.await {
        *retired = now_retired;
    }
}

/// Closes `target_id` and returns whether it is proven absent from the browser's target list
/// within `WORKER_TERMINATION_PROOF`. A failed close or inventory is never taken as absence.
async fn terminate_target(client: &CdpClient, target_id: &str) -> bool {
    if let Err(err) = client
        .send_command(
            "Target.closeTarget",
            Some(serde_json::json!({ "targetId": target_id })),
            None,
        )
        .await
    {
        warn!(error = %err, "closing a worker target failed");
    }
    let deadline = Instant::now() + WORKER_TERMINATION_PROOF;
    loop {
        let present = client
            .send_command("Target.getTargets", None, None)
            .await
            .ok()
            .and_then(|value| {
                value
                    .get("targetInfos")
                    .and_then(serde_json::Value::as_array)
                    .map(|infos| infos.iter().any(|info| info["targetId"] == target_id))
            });
        if present == Some(false) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(WORKER_TERMINATION_POLL).await;
    }
}

#[cfg(test)]
mod request_policy_tests {
    use super::*;
    use crate::browser_host::config::BrowserHostConfig;
    use futures_util::{SinkExt, StreamExt};
    use serde_json::{json, Value};
    use tokio::sync::mpsc;
    use tokio_tungstenite::tungstenite::Message;

    struct MockBrowser {
        client: Arc<CdpClient>,
        commands: mpsc::UnboundedReceiver<Value>,
        push: mpsc::UnboundedSender<Value>,
    }

    /// A scripted CDP endpoint: records every command and answers it; `Fetch.enable` fails
    /// with a protocol error when `fail_fetch_enable` is set.
    async fn mock_browser(fail_fetch_enable: bool) -> MockBrowser {
        mock_browser_with_targets(fail_fetch_enable, &[], true).await
    }

    /// Like [`mock_browser`], plus a browser-level target inventory: `Target.getTargets` lists
    /// `listed`; `Target.closeTarget` removes the id from it only when `close_removes_target`
    /// (a worker that refuses to terminate otherwise).
    async fn mock_browser_with_targets(
        fail_fetch_enable: bool,
        listed: &[&str],
        close_removes_target: bool,
    ) -> MockBrowser {
        mock_browser_scripted(fail_fetch_enable, listed, close_removes_target, false).await
    }

    /// Full script; `fail_close_target` answers every `Target.closeTarget` with a protocol
    /// error (the page cannot be retired).
    async fn mock_browser_scripted(
        fail_fetch_enable: bool,
        listed: &[&str],
        close_removes_target: bool,
        fail_close_target: bool,
    ) -> MockBrowser {
        let mut listed: Vec<String> = listed.iter().map(|id| id.to_string()).collect();
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
                        if ws.send(Message::Text(event.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    incoming = ws.next() => {
                        let Some(Ok(Message::Text(text))) = incoming else { break };
                        let cmd: Value = serde_json::from_str(&text).unwrap();
                        if cmd["method"] == "Target.closeTarget" && close_removes_target {
                            listed.retain(|id| cmd["params"]["targetId"] != *id);
                        }
                        let reply = if fail_close_target && cmd["method"] == "Target.closeTarget" {
                            json!({"id": cmd["id"], "error": {"code": -32000, "message": "close refused"}})
                        } else if fail_fetch_enable && cmd["method"] == "Fetch.enable" {
                            json!({"id": cmd["id"], "error": {"code": -32000, "message": "Fetch is not supported here"}})
                        } else if cmd["method"] == "Target.getTargets" {
                            let infos: Vec<Value> = listed
                                .iter()
                                .map(|id| json!({"targetId": id, "type": "service_worker"}))
                                .collect();
                            json!({"id": cmd["id"], "result": {"targetInfos": infos}})
                        } else {
                            json!({"id": cmd["id"], "result": {}})
                        };
                        let _ = commands_tx.send(cmd);
                        if ws.send(Message::Text(reply.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                }
            }
        });
        let client = CdpClient::connect(&format!("ws://{addr}")).await.unwrap();
        MockBrowser {
            client,
            commands,
            push,
        }
    }

    /// Records every escalation the interceptor hands to the containment owner.
    type Escalations = Arc<std::sync::Mutex<Vec<String>>>;

    fn spawn_interceptor_with(browser: &MockBrowser) -> (tokio::task::JoinHandle<()>, Escalations) {
        let policy =
            Arc::new(NetworkPolicy::from_config(&BrowserHostConfig::default(), false).unwrap());
        let escalations = Escalations::default();
        let recorded = escalations.clone();
        let escalate: ContainmentEscalation =
            Arc::new(move |reason: &str| recorded.lock().unwrap().push(reason.to_string()));
        let task = tokio::spawn(run_request_interceptor(
            Arc::downgrade(&browser.client),
            policy,
            browser.client.subscribe_request_events(),
            "PAGE-TARGET".to_string(),
            escalate,
        ));
        (task, escalations)
    }

    fn spawn_interceptor(browser: &MockBrowser) -> tokio::task::JoinHandle<()> {
        spawn_interceptor_with(browser).0
    }

    fn attach(session: &str, waiting: bool) -> Value {
        json!({
            "method": "Target.attachedToTarget",
            "params": {
                "sessionId": session,
                "targetInfo": { "targetId": format!("T-{session}"), "type": "worker" },
                "waitingForDebugger": waiting,
            }
        })
    }

    /// Every command the mock receives within `window`.
    async fn collect(browser: &mut MockBrowser, window: Duration) -> Vec<Value> {
        let mut seen = Vec::new();
        let deadline = tokio::time::Instant::now() + window;
        while let Ok(Some(cmd)) = tokio::time::timeout_at(deadline, browser.commands.recv()).await {
            seen.push(cmd);
        }
        seen
    }

    fn methods(seen: &[Value]) -> Vec<&str> {
        seen.iter().filter_map(|c| c["method"].as_str()).collect()
    }

    #[tokio::test]
    async fn paused_child_with_failed_interception_is_never_resumed_and_retires_the_page() {
        let mut browser = mock_browser(true).await;
        let (task, escalations) = spawn_interceptor_with(&browser);
        browser.push.send(attach("W1", true)).unwrap();

        let seen = collect(&mut browser, Duration::from_millis(600)).await;
        let methods = methods(&seen);
        assert!(methods.contains(&"Fetch.enable"), "{methods:?}");
        assert!(
            !methods.contains(&"Runtime.runIfWaitingForDebugger"),
            "a worker without request interception must stay paused: {methods:?}"
        );
        assert_eq!(
            close_target_ids(&seen),
            ["PAGE-TARGET"],
            "a denied paused child is retired with its page, not parked forever: {methods:?}"
        );
        assert!(escalations.lock().unwrap().is_empty());
        task.abort();
    }

    #[tokio::test]
    async fn child_whose_page_cannot_be_retired_is_escalated_to_the_containment_owner() {
        let mut browser = mock_browser_scripted(true, &[], true, true).await;
        let (task, escalations) = spawn_interceptor_with(&browser);
        browser.push.send(attach("W7", true)).unwrap();

        let seen = collect(&mut browser, Duration::from_millis(600)).await;
        assert_eq!(close_target_ids(&seen), ["PAGE-TARGET"]);
        assert_eq!(
            escalations.lock().unwrap().len(),
            1,
            "a failed page retirement must leave a containment owner: {:?}",
            methods(&seen)
        );
        task.abort();
    }

    #[tokio::test]
    async fn running_child_without_interception_retires_the_page() {
        let mut browser = mock_browser(true).await;
        let task = spawn_interceptor(&browser);
        browser.push.send(attach("W2", false)).unwrap();

        let seen = collect(&mut browser, Duration::from_millis(600)).await;
        let close = seen
            .iter()
            .find(|c| c["method"] == "Target.closeTarget")
            .unwrap_or_else(|| panic!("page was not retired: {:?}", methods(&seen)));
        assert_eq!(close["params"]["targetId"], "PAGE-TARGET");
        task.abort();
    }

    #[tokio::test]
    async fn dropped_policy_event_retires_the_page_instead_of_leaving_requests_paused() {
        let mut browser = mock_browser(false).await;
        let task = spawn_interceptor(&browser);
        // No `sessionId` in the attach params: the event cannot be projected (`Overflow`).
        browser
            .push
            .send(json!({
                "method": "Target.attachedToTarget",
                "params": { "targetInfo": { "targetId": "X", "type": "worker" } }
            }))
            .unwrap();

        let seen = collect(&mut browser, Duration::from_millis(600)).await;
        let close = seen
            .iter()
            .find(|c| c["method"] == "Target.closeTarget")
            .unwrap_or_else(|| panic!("page was not retired: {:?}", methods(&seen)));
        assert_eq!(close["params"]["targetId"], "PAGE-TARGET");
        task.abort();
    }

    #[tokio::test]
    async fn worker_with_established_interception_is_resumed() {
        let mut browser = mock_browser(false).await;
        let task = spawn_interceptor(&browser);
        browser.push.send(attach("W3", true)).unwrap();

        let seen = collect(&mut browser, Duration::from_millis(600)).await;
        let methods = methods(&seen);
        let enable = methods.iter().position(|m| *m == "Fetch.enable").unwrap();
        let resume = methods
            .iter()
            .position(|m| *m == "Runtime.runIfWaitingForDebugger")
            .expect("intercepted worker is resumed");
        assert!(enable < resume, "interception precedes resume: {methods:?}");
        task.abort();
    }

    fn attach_service_worker(session: &str, waiting: bool) -> Value {
        json!({
            "method": "Target.attachedToTarget",
            "params": {
                "sessionId": session,
                "targetInfo": { "targetId": format!("T-{session}"), "type": "service_worker" },
                "waitingForDebugger": waiting,
            }
        })
    }

    fn close_target_ids(seen: &[Value]) -> Vec<&str> {
        seen.iter()
            .filter(|c| c["method"] == "Target.closeTarget")
            .filter_map(|c| c["params"]["targetId"].as_str())
            .collect()
    }

    #[tokio::test]
    async fn running_service_worker_without_interception_is_terminated_and_proven_gone() {
        let mut browser = mock_browser_with_targets(true, &["T-SW1"], true).await;
        let (task, escalations) = spawn_interceptor_with(&browser);
        browser
            .push
            .send(attach_service_worker("SW1", false))
            .unwrap();

        let seen = collect(&mut browser, Duration::from_millis(800)).await;
        let methods = methods(&seen);
        assert_eq!(
            close_target_ids(&seen),
            ["T-SW1"],
            "the worker itself is closed, not the page: {methods:?}"
        );
        let close = methods.iter().position(|m| *m == "Target.closeTarget");
        let inventory = methods.iter().rposition(|m| *m == "Target.getTargets");
        assert!(
            close < inventory,
            "absence is proven after the close: {methods:?}"
        );
        assert!(
            escalations.lock().unwrap().is_empty(),
            "a proven-terminated worker does not escalate: {methods:?}"
        );
        assert!(
            !methods.contains(&"Runtime.runIfWaitingForDebugger"),
            "{methods:?}"
        );
        task.abort();
    }

    #[tokio::test]
    async fn running_service_worker_that_survives_close_is_escalated_to_the_containment_owner() {
        let mut browser = mock_browser_with_targets(true, &["T-SW2"], false).await;
        let (task, escalations) = spawn_interceptor_with(&browser);
        browser
            .push
            .send(attach_service_worker("SW2", false))
            .unwrap();

        let seen = collect(
            &mut browser,
            WORKER_TERMINATION_PROOF + Duration::from_millis(1500),
        )
        .await;
        let methods = methods(&seen);
        assert_eq!(
            close_target_ids(&seen),
            ["T-SW2"],
            "only the worker is closed; the browser-wide fate belongs to the owner: {methods:?}"
        );
        assert!(
            !methods.contains(&"Browser.close"),
            "the interceptor never owns browser shutdown: {methods:?}"
        );
        assert_eq!(
            escalations.lock().unwrap().len(),
            1,
            "an unpoliced worker that cannot be stopped must reach the containment owner: {methods:?}"
        );
        task.abort();
    }

    /// The interceptor dies with its page (the last producer is removed) while the worker's
    /// termination proof is still running: the escalation must still reach the owner.
    #[tokio::test]
    async fn escalation_survives_the_interceptor_being_aborted_mid_proof() {
        let mut browser = mock_browser_with_targets(true, &["T-SW5"], false).await;
        let (task, escalations) = spawn_interceptor_with(&browser);
        browser
            .push
            .send(attach_service_worker("SW5", false))
            .unwrap();

        // Wait until the proof is running, then destroy the interceptor.
        loop {
            let cmd = tokio::time::timeout(Duration::from_secs(3), browser.commands.recv())
                .await
                .expect("proof never started")
                .expect("mock closed");
            if cmd["method"] == "Target.getTargets" {
                break;
            }
        }
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(escalations.lock().unwrap().is_empty(), "proof not over yet");

        tokio::time::sleep(WORKER_TERMINATION_PROOF + Duration::from_millis(500)).await;
        assert_eq!(
            escalations.lock().unwrap().len(),
            1,
            "aborting the interceptor must not cancel the containment obligation"
        );
    }

    #[tokio::test]
    async fn paused_service_worker_without_interception_is_closed_never_resumed() {
        let mut browser = mock_browser_with_targets(true, &["T-SW3"], true).await;
        let (task, escalations) = spawn_interceptor_with(&browser);
        browser
            .push
            .send(attach_service_worker("SW3", true))
            .unwrap();

        let seen = collect(&mut browser, Duration::from_millis(800)).await;
        let methods = methods(&seen);
        assert_eq!(close_target_ids(&seen), ["T-SW3"], "{methods:?}");
        assert!(
            !methods.contains(&"Runtime.runIfWaitingForDebugger"),
            "{methods:?}"
        );
        assert!(escalations.lock().unwrap().is_empty(), "{methods:?}");
        task.abort();
    }

    #[tokio::test]
    async fn paused_service_worker_that_resists_close_is_escalated_not_parked() {
        let mut browser = mock_browser_with_targets(true, &["T-SW4"], false).await;
        let (task, escalations) = spawn_interceptor_with(&browser);
        browser
            .push
            .send(attach_service_worker("SW4", true))
            .unwrap();

        let seen = collect(
            &mut browser,
            WORKER_TERMINATION_PROOF + Duration::from_millis(1000),
        )
        .await;
        let methods = methods(&seen);
        assert_eq!(close_target_ids(&seen), ["T-SW4"], "{methods:?}");
        assert!(
            !methods.contains(&"Runtime.runIfWaitingForDebugger"),
            "a paused worker without a policy is never resumed: {methods:?}"
        );
        assert_eq!(
            escalations.lock().unwrap().len(),
            1,
            "a denied paused worker that resists closure needs a tracked owner: {methods:?}"
        );
        task.abort();
    }

    // ---- Real Chromium: a running service worker whose interception fails -----------------

    /// Local HTTP origin: `/` registers `/sw.js`, which fetches `/tick` every 300 ms. Counts
    /// the worker's requests.
    async fn spawn_service_worker_origin() -> (u16, Arc<std::sync::atomic::AtomicUsize>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let ticks = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let counter = ticks.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    return;
                };
                let counter = counter.clone();
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let head = String::from_utf8_lossy(&buf[..n]);
                    let path = head.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let (content_type, body) = match path.as_str() {
                        "/" => (
                            "text/html",
                            "<html><body><script>navigator.serviceWorker.register('/sw.js')</script></body></html>",
                        ),
                        "/sw.js" => (
                            "text/javascript",
                            "self.addEventListener('install',e=>self.skipWaiting());\
                             self.addEventListener('activate',e=>e.waitUntil(clients.claim()));\
                             setInterval(()=>fetch('/tick'),300);",
                        ),
                        _ => {
                            if path.starts_with("/tick") {
                                counter.fetch_add(1, Ordering::SeqCst);
                            }
                            ("text/plain", "ok")
                        }
                    };
                    let response = format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                });
            }
        });
        (port, ticks)
    }

    /// A CDP relay in front of the real browser that refuses `Fetch.enable` on every
    /// service-worker session (identified from the browser's own `attachedToTarget` events),
    /// which is exactly "interception of a running worker failed". Everything else passes.
    async fn spawn_worker_interception_denier(browser_ws: String) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (client_stream, _) = listener.accept().await.unwrap();
            let mut client = tokio_tungstenite::accept_async(client_stream)
                .await
                .unwrap();
            let (mut upstream, _) = tokio_tungstenite::connect_async(browser_ws).await.unwrap();
            let mut worker_sessions = std::collections::HashSet::<String>::new();
            loop {
                tokio::select! {
                    from_client = client.next() => {
                        let Some(Ok(Message::Text(text))) = from_client else { break };
                        let cmd: Value = serde_json::from_str(&text).unwrap();
                        let denied = cmd["method"] == "Fetch.enable"
                            && cmd["sessionId"].as_str().is_some_and(|s| worker_sessions.contains(s));
                        if denied {
                            let reply = json!({
                                "id": cmd["id"], "sessionId": cmd["sessionId"],
                                "error": {"code": -32000, "message": "Fetch.enable refused for the worker"}
                            });
                            if client.send(Message::Text(reply.to_string().into())).await.is_err() {
                                break;
                            }
                        } else if upstream.send(Message::Text(text)).await.is_err() {
                            break;
                        }
                    }
                    from_browser = upstream.next() => {
                        let Some(Ok(Message::Text(text))) = from_browser else { break };
                        let event: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                        if event["method"] == "Target.attachedToTarget"
                            && event["params"]["targetInfo"]["type"] == "service_worker"
                        {
                            if let Some(sid) = event["params"]["sessionId"].as_str() {
                                worker_sessions.insert(sid.to_string());
                            }
                        }
                        if client.send(Message::Text(text)).await.is_err() {
                            break;
                        }
                    }
                }
            }
        });
        format!("ws://{addr}")
    }

    async fn service_worker_target_ids(client: &CdpClient, origin_port: u16) -> Vec<String> {
        let marker = format!("127.0.0.1:{origin_port}/sw.js");
        let value = client
            .send_command("Target.getTargets", None, None)
            .await
            .unwrap();
        value["targetInfos"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|info| {
                info["type"] == "service_worker"
                    && info["url"].as_str().is_some_and(|u| u.contains(&marker))
            })
            .map(|info| info["targetId"].as_str().unwrap().to_string())
            .collect()
    }

    #[tokio::test]
    async fn real_running_service_worker_without_interception_stops_making_requests() {
        use crate::browser_host::process::{find_browser_executable, BrowserLaunchConfig};
        let Ok(exec) = find_browser_executable(None) else {
            eprintln!("skipping: no browser executable configured");
            return;
        };
        let tmp = tempfile::tempdir().unwrap();
        let mut config = BrowserLaunchConfig::new(tmp.path().join("sw-profile"));
        config.executable_path = Some(exec);
        let mut process = crate::browser_host::process::BrowserProcess::launch(config)
            .await
            .expect("launch browser");
        let (port, ticks) = spawn_service_worker_origin().await;
        let relay = spawn_worker_interception_denier(process.ws_endpoint().to_string()).await;
        let client = CdpClient::connect(&relay).await.unwrap();

        let result: Result<(), String> = async {
            let page = client
                .send_command(
                    "Target.createTarget",
                    Some(json!({"url": "about:blank"})),
                    None,
                )
                .await
                .map_err(|e| e.to_string())?["targetId"]
                .as_str()
                .unwrap()
                .to_string();
            let session = client
                .send_command(
                    "Target.attachToTarget",
                    Some(json!({"targetId": page, "flatten": true})),
                    None,
                )
                .await
                .map_err(|e| e.to_string())?["sessionId"]
                .as_str()
                .unwrap()
                .to_string();
            client
                .send_command(
                    "Page.navigate",
                    Some(json!({"url": format!("http://127.0.0.1:{port}/")})),
                    Some(&session),
                )
                .await
                .map_err(|e| e.to_string())?;

            // The worker is registered, running and issuing requests before the policy exists.
            let started = Instant::now();
            while ticks.load(Ordering::SeqCst) < 2 {
                if started.elapsed() > Duration::from_secs(15) {
                    return Err("the service worker never started ticking".to_string());
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            let worker_ids = service_worker_target_ids(&client, port).await;
            if worker_ids.len() != 1 {
                return Err(format!("expected one running worker, got {worker_ids:?}"));
            }

            // The real interceptor attaches to the already-running worker (not paused), the
            // relay refuses its `Fetch.enable`, so the worker has to be terminated.
            let policy =
                Arc::new(NetworkPolicy::from_config(&BrowserHostConfig::default(), false).unwrap());
            let escalated = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let counted = escalated.clone();
            let task = tokio::spawn(run_request_interceptor(
                Arc::downgrade(&client),
                policy,
                client.subscribe_request_events(),
                page.clone(),
                Arc::new(move |_: &str| {
                    counted.fetch_add(1, Ordering::SeqCst);
                }),
            ));
            enable_request_interception(&client, &session)
                .await
                .map_err(|e| e.to_string())?;

            let started = Instant::now();
            loop {
                if service_worker_target_ids(&client, port).await.is_empty() {
                    break;
                }
                if started.elapsed() > Duration::from_secs(8) {
                    task.abort();
                    return Err("the unpoliced service worker was never terminated".to_string());
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            let settled = ticks.load(Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(1500)).await;
            task.abort();
            if ticks.load(Ordering::SeqCst) != settled {
                return Err("the terminated worker kept making unpoliced requests".to_string());
            }
            if escalated.load(Ordering::SeqCst) != 0 {
                return Err("a terminated worker must not escalate to browser containment".into());
            }
            Ok(())
        }
        .await;

        drop(client);
        process.terminate().await.expect("terminate browser");
        result.unwrap();
    }
}
