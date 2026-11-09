use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use axum::extract::ws::rejection::WebSocketUpgradeRejection;
use axum::extract::ws::{Message as AxumWsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Extension, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::{Mutex, RwLock};
use tokio::time::{interval, sleep, timeout};
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::api::auth::AuthenticatedActor;
use crate::api::browser_host::{
    browser_error_response, global_attachment_manager, global_session_registry,
};
use crate::browser_host::attachments::AttachmentPurpose;
use crate::browser_host::auth::{verify_live_admission, BrowserAdmission};
use crate::browser_host::cdp::CdpClient;
use crate::browser_host::diagnostics::{
    global_stream_diagnostics, TrackedBhjfFrame,
};
use crate::browser_host::input::{InputEvent, InputMessage};
use crate::browser_host::protocol::{
    unpack_bhjf_frame, MediaClientControl, ServerControlEvent, TargetGeometry,
    CONTROL_SUBPROTOCOL, MEDIA_SUBPROTOCOL, TICKET_SUBPROTOCOL_PREFIX,
};
use crate::browser_host::screencast::ScreencastProducer;
use crate::state::AppState;

pub const MAX_OUTSTANDING_PER_VIEWER: usize = 2;
pub const MAX_PENDING_PER_VIEWER: usize = 1;
pub const MIN_DELIVERY_INTERVAL: Duration = Duration::from_millis(100); // Max 10 FPS
pub const OUTSTANDING_TIMEOUT: Duration = Duration::from_secs(30);
pub const WRITE_DEADLINE: Duration = Duration::from_secs(5);

pub const MAX_MEDIA_CONTROL_BYTES: usize = 1024;
pub const MAX_CONTROL_MESSAGE_BYTES: usize = 16 * 1024;
pub const MAX_CONTROL_BURST: usize = 200;
pub const MAX_CONTROL_SUSTAINED_PER_SEC: usize = 100;
pub const MAX_GLOBAL_VIEWERS: usize = 2;

pub static ACTIVE_VIEWERS: LazyLock<AtomicUsize> = LazyLock::new(|| AtomicUsize::new(0));

pub static GLOBAL_PRODUCERS: LazyLock<RwLock<HashMap<String, Arc<ScreencastProducer>>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

pub async fn get_or_register_producer(
    session_id: &str,
    producer: Arc<ScreencastProducer>,
) {
    let mut map = GLOBAL_PRODUCERS.write().await;
    map.insert(session_id.to_string(), producer);
}

pub async fn get_producer(session_id: &str) -> Option<Arc<ScreencastProducer>> {
    let map = GLOBAL_PRODUCERS.read().await;
    map.get(session_id).cloned()
}

pub async fn remove_producer(session_id: &str) {
    let mut map = GLOBAL_PRODUCERS.write().await;
    if let Some(producer) = map.remove(session_id) {
        let _ = producer.stop_screencast().await;
        let _ = producer.close_target().await;
    }
}

/// Lazily creates and registers a ScreencastProducer for a session in production if not present.
pub async fn ensure_producer_for_session(
    state: &AppState,
    session_id: &str,
    principal: &str,
    is_dev: bool,
) -> Option<Arc<ScreencastProducer>> {
    if let Some(existing) = get_producer(session_id).await {
        return Some(existing);
    }

    let handle = state.browser_host.ensure_running(principal, is_dev).await.ok()?;
    let client = CdpClient::connect(&handle.ws_endpoint).await.ok()?;
    let session = global_session_registry().get_session(session_id, principal).await.ok()?;
    let v_epoch = session.viewport_epoch.parse::<u64>().unwrap_or(1);

    // Reconcile real native target via CDP (idempotent, reuse existing if established)
    let native_target_id = match global_session_registry().get_native_target_id(session_id).await {
        Some(tid) => tid,
        None => {
            let target_url = if session.url.is_empty() { "about:blank" } else { &session.url };
            let create_target = chromiumoxide_cdp::cdp::browser_protocol::target::CreateTargetParams::builder()
                .url(target_url)
                .build()
                .ok()?;
            let target_res = client.send_typed(create_target, None).await.ok()?;
            let tid: String = target_res.target_id.into();
            global_session_registry().set_native_target_id(session_id, tid.clone()).await;
            tid
        }
    };
    let producer = Arc::new(ScreencastProducer::new(
        session_id.to_string(),
        handle.browser_incarnation,
        handle.profile_epoch,
        v_epoch,
        client,
        native_target_id,
        session.geometry,
    ));

    get_or_register_producer(session_id, producer.clone()).await;
    Some(producer)
}

/// Outstanding key for a single viewer delivery:
/// `(capturedSocketSubscription, producerRun, viewportEpoch, frameSeq)`
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct OutstandingKey {
    pub subscription_epoch: String,
    pub producer_run: String,
    pub viewport_epoch: String,
    pub frame_seq: String,
}

pub struct ViewerCreditController {
    subscription_epoch: String,
    outstanding: HashMap<OutstandingKey, (TrackedBhjfFrame, Instant)>,
    pending_frame: Option<TrackedBhjfFrame>,
    last_delivery: Instant,
    pub total_delivered: usize,
    pub total_acked: usize,
    pub total_discarded: usize,
}

impl ViewerCreditController {
    pub fn new(subscription_epoch: String) -> Self {
        Self {
            subscription_epoch,
            outstanding: HashMap::with_capacity(MAX_OUTSTANDING_PER_VIEWER),
            pending_frame: None,
            last_delivery: Instant::now() - MIN_DELIVERY_INTERVAL,
            total_delivered: 0,
            total_acked: 0,
            total_discarded: 0,
        }
    }

    pub fn outstanding_count(&self) -> usize {
        self.outstanding.len()
    }

    pub fn has_pending(&self) -> bool {
        self.pending_frame.is_some()
    }

    /// Tries to admit an incoming frame for immediate transmission, or stores it as pending.
    /// Returns `Some(frame_to_send)` if credit and rate governor permit immediate send.
    pub fn on_incoming_frame(&mut self, frame: TrackedBhjfFrame) -> Option<TrackedBhjfFrame> {
        let (header, _) = match unpack_bhjf_frame(frame.data()) {
            Ok(h) => h,
            Err(_) => return None,
        };

        let now = Instant::now();
        if self.outstanding.len() < MAX_OUTSTANDING_PER_VIEWER && now.duration_since(self.last_delivery) >= MIN_DELIVERY_INTERVAL {
            let key = OutstandingKey {
                subscription_epoch: self.subscription_epoch.clone(),
                producer_run: header.producer_run,
                viewport_epoch: header.viewport_epoch,
                frame_seq: header.frame_seq,
            };
            self.outstanding.insert(key, (frame.clone(), now));
            self.last_delivery = now;
            self.total_delivered += 1;
            // Sending a newer frame directly clears any prior pending frame
            self.pending_frame = None;
            Some(frame)
        } else {
            // Buffer latest frame as pending (replacing any prior pending frame)
            self.pending_frame = Some(frame);
            None
        }
    }

    /// Checks if a buffered pending frame can now be delivered (e.g. rate governor interval elapsed).
    pub fn check_flush_pending(&mut self) -> Option<TrackedBhjfFrame> {
        let now = Instant::now();
        if self.outstanding.len() < MAX_OUTSTANDING_PER_VIEWER
            && now.duration_since(self.last_delivery) >= MIN_DELIVERY_INTERVAL
        {
            if let Some(pending) = self.pending_frame.take() {
                if let Ok((header, _)) = unpack_bhjf_frame(pending.data()) {
                    let key = OutstandingKey {
                        subscription_epoch: self.subscription_epoch.clone(),
                        producer_run: header.producer_run,
                        viewport_epoch: header.viewport_epoch,
                        frame_seq: header.frame_seq,
                    };
                    self.outstanding.insert(key, (pending.clone(), now));
                    self.last_delivery = now;
                    self.total_delivered += 1;
                    return Some(pending);
                }
            }
        }
        None
    }

    /// Handles an incoming frameAck or frameDiscarded.
    /// Enforces exact socket admission authority: control subscription must match.
    /// Returns `Some(next_pending_frame)` if freeing credit unblocks transmission of the pending frame.
    pub fn on_credit_return(
        &mut self,
        control_sub: &str,
        producer_run: &str,
        viewport_epoch: &str,
        frame_seq: &str,
        is_discard: bool,
    ) -> Option<TrackedBhjfFrame> {
        // Exact socket subscription authority check
        if control_sub != self.subscription_epoch {
            warn!(
                control_sub,
                socket_sub = %self.subscription_epoch,
                "foreign subscription credit control rejected"
            );
            return None;
        }

        let key = OutstandingKey {
            subscription_epoch: self.subscription_epoch.clone(),
            producer_run: producer_run.to_string(),
            viewport_epoch: viewport_epoch.to_string(),
            frame_seq: frame_seq.to_string(),
        };

        if self.outstanding.remove(&key).is_some() {
            if is_discard {
                self.total_discarded += 1;
                global_stream_diagnostics().discards_received.fetch_add(1, Ordering::Relaxed);
            } else {
                self.total_acked += 1;
                global_stream_diagnostics().acks_received.fetch_add(1, Ordering::Relaxed);
            }

            return self.check_flush_pending();
        }

        None
    }

    /// Returns whether any outstanding frame has exceeded OUTSTANDING_TIMEOUT (> 30s).
    pub fn prune_timeouts(&mut self) -> bool {
        let now = Instant::now();
        self.outstanding
            .values()
            .any(|(_, sent_at)| now.duration_since(*sent_at) > OUTSTANDING_TIMEOUT)
    }
}

/// RAII permit for active global viewer capacity.
struct ViewerPermit;

impl ViewerPermit {
    pub fn try_acquire() -> Result<Self, StatusCode> {
        let current = ACTIVE_VIEWERS.fetch_add(1, Ordering::SeqCst);
        if current >= MAX_GLOBAL_VIEWERS {
            ACTIVE_VIEWERS.fetch_sub(1, Ordering::SeqCst);
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
        Ok(Self)
    }
}

impl Drop for ViewerPermit {
    fn drop(&mut self) {
        ACTIVE_VIEWERS.fetch_sub(1, Ordering::SeqCst);
    }
}

fn validate_browser_origin(origin_hdr: Option<&str>, state: &AppState, is_dev: bool) -> Result<(), Response> {
    let Some(origin_str) = origin_hdr else {
        return Ok(());
    };
    let trimmed = origin_str.trim();
    if trimmed == "null" || trimmed.ends_with('/') || trimmed.contains(',') {
        return Err(browser_error_response(
            StatusCode::FORBIDDEN,
            "forbiddenOrigin",
            "invalid Origin header format",
        ));
    }

    if is_dev && state.no_auth {
        return Ok(());
    }

    let matched = state
        .cors_origins
        .iter()
        .any(|allowed| allowed.as_bytes() == trimmed.as_bytes());

    if !matched {
        return Err(browser_error_response(
            StatusCode::FORBIDDEN,
            "forbiddenOrigin",
            "Origin does not match CORS allowlist",
        ));
    }

    Ok(())
}

/// GET /api/browser/media WebSocket upgrade handler.
pub async fn media_ws_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    _actor: Option<Extension<AuthenticatedActor>>,
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
) -> Response {
    let ws = match ws {
        Ok(w) => w,
        Err(e) => return (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    };

    let subprotocols_str = headers
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let mut raw_ticket: Option<String> = None;
    let mut requested_media_protocol = false;

    for proto in subprotocols_str.split(',') {
        let p = proto.trim();
        if p == MEDIA_SUBPROTOCOL {
            requested_media_protocol = true;
        } else if let Some(ticket) = p.strip_prefix(TICKET_SUBPROTOCOL_PREFIX) {
            raw_ticket = Some(ticket.to_string());
        }
    }

    if !requested_media_protocol {
        return (StatusCode::BAD_REQUEST, "missing media subprotocol").into_response();
    }

    let raw_ticket = match raw_ticket {
        Some(t) => t,
        None => return (StatusCode::UNAUTHORIZED, "missing ticket capability").into_response(),
    };

    let origin = headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok());

    let att_manager = global_attachment_manager();
    let admitted = match att_manager
        .consume_ticket(&raw_ticket, AttachmentPurpose::Media, origin)
        .await
    {
        Ok(a) => a,
        Err(e) => {
            return browser_error_response(
                StatusCode::FORBIDDEN,
                "ticketInvalid",
                &e.to_string(),
            );
        }
    };

    // Origin validation
    if let Err(resp) = validate_browser_origin(origin, &state, admitted.is_dev) {
        return resp;
    }

    // Dev loopback check
    if admitted.is_dev {
        if let Some(Extension(ConnectInfo(addr))) = connect {
            if !addr.ip().is_loopback() {
                return browser_error_response(
                    StatusCode::FORBIDDEN,
                    "forbiddenPeer",
                    "dev access is restricted to loopback peer",
                );
            }
        }
    }

    // Live caller admission recheck
    let adm = BrowserAdmission {
        principal: admitted.principal.clone(),
        is_dev: admitted.is_dev,
        session_id: admitted.auth_session_id.clone(),
        auth_version: admitted.auth_version,
        credential_version: admitted.credential_version,
        effective_deadline: admitted.effective_deadline,
    };

    if let Err(err) = verify_live_admission(&state, &adm).await {
        warn!(principal = %adm.principal, error = %err, "Ticket live auth check failed on media upgrade");
        return browser_error_response(StatusCode::UNAUTHORIZED, "invalidSession", "live authentication validation failed");
    }

    // Capacity check
    let permit = match ViewerPermit::try_acquire() {
        Ok(p) => p,
        Err(status) => {
            return browser_error_response(
                status,
                "browserBusy",
                "global active viewer capacity reached (2)",
            );
        }
    };

    let (conn_id, cancel_token) = match att_manager.register_connection(&admitted).await {
        Ok(c) => c,
        Err(e) => {
            return browser_error_response(
                StatusCode::FORBIDDEN,
                "pairingFailed",
                &e.to_string(),
            );
        }
    };

    let session_id = admitted.browser_session_id.clone().unwrap_or_default();
    let viewer_id = admitted.viewer_id.clone().unwrap_or_default();
    let sub_epoch = admitted.subscription_epoch.clone().unwrap_or_default();
    let effective_deadline = admitted.effective_deadline;

    // Lazily ensure ScreencastProducer exists for this session
    let producer = ensure_producer_for_session(&state, &session_id, &admitted.principal, admitted.is_dev).await;

    // Echo only fixed subprotocol with frame/message bounds
    ws.protocols([MEDIA_SUBPROTOCOL])
        .max_message_size(MAX_MEDIA_CONTROL_BYTES)
        .max_frame_size(MAX_MEDIA_CONTROL_BYTES)
        .on_upgrade(move |socket| {
            run_media_session(
                socket,
                session_id,
                viewer_id,
                sub_epoch,
                producer,
                effective_deadline,
                cancel_token,
                conn_id,
                permit,
            )
        })
}

async fn run_media_session(
    socket: WebSocket,
    _session_id: String,
    viewer_id: String,
    subscription_epoch: String,
    producer: Option<Arc<ScreencastProducer>>,
    effective_deadline: Option<DateTime<Utc>>,
    cancel_token: CancellationToken,
    conn_id: Uuid,
    _permit: ViewerPermit,
) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let controller = Arc::new(Mutex::new(ViewerCreditController::new(subscription_epoch.clone())));

    let mut frame_rx = if let Some(prod) = &producer {
        prod.register_viewer_demand(&viewer_id, &subscription_epoch, true).await;
        // Deliver current valid cached frame on attach if present
        if let Some(cached) = prod.get_cached_frame().await {
            let mut ctrl = controller.lock().await;
            if let Some(to_send) = ctrl.on_incoming_frame(cached) {
                drop(ctrl);
                let _ = write_media_frame(&mut ws_sink, to_send.clone_data(), &cancel_token).await;
            }
        }
        Some(prod.subscribe_frames())
    } else {
        None
    };
    let mut timeout_ticker = interval(Duration::from_secs(1));
    let mut flush_ticker = interval(Duration::from_millis(50));
    let mut media_ctrl_count = 0usize;
    let mut media_rate_window = Instant::now();
    // Absolute auth deadline calculation
    let deadline_sleep = match effective_deadline {
        Some(dl) => {
            let duration = dl.signed_duration_since(Utc::now());
            if duration.num_milliseconds() <= 0 {
                return;
            }
            Some(sleep(Duration::from_millis(duration.num_milliseconds() as u64)))
        }
        None => None,
    };
    tokio::pin!(deadline_sleep);

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                debug!(viewer_id = %viewer_id, "media session cancelled by auth supervisor");
                break;
            }
            _ = async {
                if let Some(ref mut sleep_fut) = deadline_sleep.as_mut().as_pin_mut() {
                    sleep_fut.await;
                } else {
                    futures_util::future::pending::<()>().await;
                }
            } => {
                warn!(viewer_id = %viewer_id, "media session reached absolute auth deadline; closing");
                break;
            }
            _ = timeout_ticker.tick() => {
                let mut ctrl = controller.lock().await;
                if ctrl.prune_timeouts() {
                    warn!(subscription_epoch = %subscription_epoch, "outstanding frame exceeded 30s timeout; tearing down stalled subscription");
                    break;
                }
            }
            _ = flush_ticker.tick() => {
                let mut ctrl = controller.lock().await;
                if let Some(flush_frame) = ctrl.check_flush_pending() {
                    drop(ctrl);
                    if write_media_frame(&mut ws_sink, flush_frame.clone_data(), &cancel_token).await.is_err() {
                        break;
                    }
                }
            }
            // Incoming broadcast frame from screencast producer
            frame_res = async {
                match frame_rx.as_mut() {
                    Some(rx) => rx.recv().await.ok(),
                    None => {
                        sleep(Duration::from_secs(10)).await;
                        None
                    }
                }
            } => {
                if let Some(frame) = frame_res {
                    let mut ctrl = controller.lock().await;
                    if let Some(to_send) = ctrl.on_incoming_frame(frame) {
                        drop(ctrl);
                        if write_media_frame(&mut ws_sink, to_send.clone_data(), &cancel_token).await.is_err() {
                            break;
                        }
                    }
                }
            }
            // Incoming text message from client (frameAck, frameDiscarded, pause, heartbeat)
            msg = ws_stream.next() => {
                let msg = match msg {
                    Some(Ok(m)) => m,
                    Some(Err(e)) => {
                        debug!(error = %e, "media ws stream error");
                        break;
                    }
                    None => break,
                };

                match msg {
                    AxumWsMessage::Text(text) => {
                        let now = Instant::now();
                        if now.duration_since(media_rate_window) >= Duration::from_secs(1) {
                            media_rate_window = now;
                            media_ctrl_count = 0;
                        }
                        media_ctrl_count += 1;
                        if media_ctrl_count > 100 {
                            warn!(subscription_epoch = %subscription_epoch, "media control rate limit exceeded; disconnecting");
                            break;
                        }
                        if text.len() > MAX_MEDIA_CONTROL_BYTES {
                            break;
                        }

                        let ctrl_msg: Result<MediaClientControl, _> = serde_json::from_str(&text);
                        match &ctrl_msg {
                            Ok(MediaClientControl::FrameAck {
                                subscription_epoch: s_epoch,
                                producer_run,
                                viewport_epoch,
                                frame_seq,
                                ..
                            }) => {
                                let mut ctrl = controller.lock().await;
                                if let Some(pending_to_send) = ctrl.on_credit_return(
                                    s_epoch,
                                    producer_run,
                                    viewport_epoch,
                                    frame_seq,
                                    false,
                                ) {
                                    drop(ctrl);
                                    if write_media_frame(&mut ws_sink, pending_to_send.clone_data(), &cancel_token).await.is_err() {
                                        break;
                                    }
                                }
                            }
                            Ok(MediaClientControl::FrameDiscarded {
                                subscription_epoch: s_epoch,
                                producer_run,
                                viewport_epoch,
                                frame_seq,
                                ..
                            }) => {
                                let mut ctrl = controller.lock().await;
                                if let Some(pending_to_send) = ctrl.on_credit_return(
                                    s_epoch,
                                    producer_run,
                                    viewport_epoch,
                                    frame_seq,
                                    true,
                                ) {
                                    drop(ctrl);
                                    if write_media_frame(&mut ws_sink, pending_to_send.clone_data(), &cancel_token).await.is_err() {
                                        break;
                                    }
                                }
                            }
                            Ok(MediaClientControl::Heartbeat { subscription_epoch: s_epoch, visible }) => {
                                if s_epoch == &subscription_epoch {
                                    if let Some(prod) = &producer {
                                        prod.heartbeat(&subscription_epoch, *visible).await;
                                    }
                                }
                            }
                            Ok(MediaClientControl::Pause { subscription_epoch: s_epoch }) => {
                                if s_epoch == &subscription_epoch {
                                    if let Some(prod) = &producer {
                                        prod.remove_viewer_demand(&subscription_epoch).await;
                                    }
                                    break;
                                }
                            }
                            Err(e) => {
                                warn!(error = %e, "invalid media client control JSON; disconnecting");
                                break;
                            }
                        }
                    }
                    AxumWsMessage::Close(_) => break,
                    _ => {}
                }
            }
        }
    }

    // Cleanup viewer demand and attachment connection on session exit
    if let Some(prod) = &producer {
        prod.remove_viewer_demand(&subscription_epoch).await;
    }
    global_attachment_manager().unregister_connection(conn_id).await;
}

async fn write_media_frame(
    ws_sink: &mut futures_util::stream::SplitSink<WebSocket, AxumWsMessage>,
    data: bytes::Bytes,
    cancel_token: &CancellationToken,
) -> Result<(), &'static str> {
    tokio::select! {
        _ = cancel_token.cancelled() => Err("cancelled"),
        res = timeout(WRITE_DEADLINE, ws_sink.send(AxumWsMessage::Binary(data))) => {
            match res {
                Ok(Ok(())) => Ok(()),
                Ok(Err(_)) => Err("transport_error"),
                Err(_) => Err("timeout"),
            }
        }
    }
}

/// GET /api/browser/control WebSocket upgrade handler.
pub async fn control_ws_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    _actor: Option<Extension<AuthenticatedActor>>,
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
) -> Response {
    let ws = match ws {
        Ok(w) => w,
        Err(e) => return (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    };

    let subprotocols_str = headers
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let mut raw_ticket: Option<String> = None;
    let mut requested_control_protocol = false;

    for proto in subprotocols_str.split(',') {
        let p = proto.trim();
        if p == CONTROL_SUBPROTOCOL {
            requested_control_protocol = true;
        } else if let Some(ticket) = p.strip_prefix(TICKET_SUBPROTOCOL_PREFIX) {
            raw_ticket = Some(ticket.to_string());
        }
    }

    if !requested_control_protocol {
        return (StatusCode::BAD_REQUEST, "missing control subprotocol").into_response();
    }

    let raw_ticket = match raw_ticket {
        Some(t) => t,
        None => return (StatusCode::UNAUTHORIZED, "missing ticket capability").into_response(),
    };

    let origin = headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok());

    let att_manager = global_attachment_manager();
    let admitted = match att_manager
        .consume_ticket(&raw_ticket, AttachmentPurpose::Control, origin)
        .await
    {
        Ok(a) => a,
        Err(e) => {
            return browser_error_response(
                StatusCode::FORBIDDEN,
                "ticketInvalid",
                &e.to_string(),
            );
        }
    };

    // Origin validation
    if let Err(resp) = validate_browser_origin(origin, &state, admitted.is_dev) {
        return resp;
    }

    // Dev loopback check
    if admitted.is_dev {
        if let Some(Extension(ConnectInfo(addr))) = connect {
            if !addr.ip().is_loopback() {
                return browser_error_response(
                    StatusCode::FORBIDDEN,
                    "forbiddenPeer",
                    "dev access is restricted to loopback peer",
                );
            }
        }
    }

    let adm = BrowserAdmission {
        principal: admitted.principal.clone(),
        is_dev: admitted.is_dev,
        session_id: admitted.auth_session_id.clone(),
        auth_version: admitted.auth_version,
        credential_version: admitted.credential_version,
        effective_deadline: admitted.effective_deadline,
    };

    if let Err(err) = verify_live_admission(&state, &adm).await {
        warn!(principal = %adm.principal, error = %err, "Ticket live auth check failed on control upgrade");
        return browser_error_response(StatusCode::UNAUTHORIZED, "invalidSession", "live authentication validation failed");
    }

    let (conn_id, cancel_token) = match att_manager.register_connection(&admitted).await {
        Ok(c) => c,
        Err(e) => {
            return browser_error_response(
                StatusCode::FORBIDDEN,
                "pairingFailed",
                &e.to_string(),
            );
        }
    };

    let session_id = admitted.browser_session_id.clone().unwrap_or_default();
    let viewer_id = admitted.viewer_id.clone().unwrap_or_default();
    let sub_epoch = admitted.subscription_epoch.clone().unwrap_or_default();
    let effective_deadline = admitted.effective_deadline;

    ws.protocols([CONTROL_SUBPROTOCOL])
        .max_message_size(MAX_CONTROL_MESSAGE_BYTES)
        .max_frame_size(MAX_CONTROL_MESSAGE_BYTES)
        .on_upgrade(move |socket| {
            run_control_session(
                socket,
                session_id,
                viewer_id,
                sub_epoch,
                effective_deadline,
                cancel_token,
                conn_id,
            )
        })
}

async fn run_control_session(
    socket: WebSocket,
    session_id: String,
    viewer_id: String,
    subscription_epoch: String,
    effective_deadline: Option<DateTime<Utc>>,
    cancel_token: CancellationToken,
    conn_id: Uuid,
) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let input_manager = crate::api::browser_host::get_or_create_input_manager(&session_id).await;

    // Send initial status event
    let status_evt = ServerControlEvent::Status {
        input_available: true,
        unavailable_reason: None,
    };
    if let Ok(json_text) = serde_json::to_string(&status_evt) {
        let _ = ws_sink.send(AxumWsMessage::Text(json_text.into())).await;
    }

    let mut message_count_in_sec = 0usize;
    let mut rate_window_start = Instant::now();

    let deadline_sleep = match effective_deadline {
        Some(dl) => {
            let duration = dl.signed_duration_since(Utc::now());
            if duration.num_milliseconds() <= 0 {
                return;
            }
            Some(sleep(Duration::from_millis(duration.num_milliseconds() as u64)))
        }
        None => None,
    };
    tokio::pin!(deadline_sleep);

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                debug!(viewer_id = %viewer_id, "control session cancelled by auth supervisor");
                break;
            }
            _ = async {
                if let Some(ref mut sleep_fut) = deadline_sleep.as_mut().as_pin_mut() {
                    sleep_fut.await;
                } else {
                    futures_util::future::pending::<()>().await;
                }
            } => {
                warn!(viewer_id = %viewer_id, "control session reached absolute auth deadline; closing");
                break;
            }
            msg = ws_stream.next() => {
                let msg = match msg {
                    Some(Ok(m)) => m,
                    Some(Err(e)) => {
                        debug!(error = %e, "control ws stream error");
                        break;
                    }
                    None => break,
                };

                match msg {
                    AxumWsMessage::Text(text) => {
                        if text.len() > MAX_CONTROL_MESSAGE_BYTES {
                            warn!("control text message exceeds 16KiB limit; disconnecting");
                            break;
                        }

                        // Rate limiting: max 100/s sustained, burst 200
                        let now = Instant::now();
                        if now.duration_since(rate_window_start) >= Duration::from_secs(1) {
                            rate_window_start = now;
                            message_count_in_sec = 0;
                        }
                        message_count_in_sec += 1;
                        if message_count_in_sec > MAX_CONTROL_SUSTAINED_PER_SEC {
                            warn!(viewer_id = %viewer_id, "control message sustained rate limit exceeded (100/s); disconnecting");
                            break;
                        }

                        // Parse input message
                        if let Ok(input_msg) = serde_json::from_str::<InputMessage>(&text) {
                            // Validate subscription epoch matches
                            if input_msg.subscription_epoch != subscription_epoch {
                                warn!("subscription epoch mismatch in input message");
                                continue;
                            }

                            if let Err(e) = input_manager.enqueue_input(input_msg).await {
                                warn!(error = ?e, "enqueue_input rejected");
                            } else {
                                // Dispatch popped input events to target CDP
                                if let Some(producer) = get_producer(&session_id).await {
                                    if let Ok(page_sid) = producer.ensure_page_session().await {
                                        let geom = producer.geometry().await;
                                        while let Some(msg) = input_manager.pop_next_input().await {
                                            dispatch_input_event_to_cdp(&producer.cdp_client, &page_sid, &geom, &msg.event).await;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    AxumWsMessage::Close(_) => break,
                    _ => {}
                }
            }
        }
    }

    // Teardown: revoke lease only if this viewer is the current lease holder
    if input_manager.is_lease_holder(&viewer_id).await {
        let releases = input_manager.revoke_lease().await;
        if !releases.is_empty() {
            if let Some(producer) = get_producer(&session_id).await {
                if let Ok(page_sid) = producer.ensure_page_session().await {
                    let geom = producer.geometry().await;
                    for rel in &releases {
                        dispatch_input_event_to_cdp(&producer.cdp_client, &page_sid, &geom, rel).await;
                    }
                }
            }
        }
    }
    global_attachment_manager().unregister_connection(conn_id).await;
}

pub async fn dispatch_input_event_to_cdp(
    client: &CdpClient,
    page_session_id: &str,
    geom: &TargetGeometry,
    event: &InputEvent,
) {
    match event {
        InputEvent::PointerDown { button, u, v, modifiers } => {
            if *u < 0.0 || *u > 1.0 || *v < 0.0 || *v > 1.0 {
                return;
            }
            let x = (u * geom.css_width).clamp(0.0, geom.css_width);
            let y = (v * geom.css_height + geom.offset_top).clamp(0.0, geom.css_height + geom.offset_top);
            let params = serde_json::json!({
                "type": "mousePressed",
                "x": x,
                "y": y,
                "button": button.as_cdp_str(),
                "clickCount": 1,
                "modifiers": modifiers,
            });
            let _ = client.send_command("Input.dispatchMouseEvent", Some(params), Some(page_session_id)).await;
        }
        InputEvent::PointerUp { button, u, v, modifiers } => {
            if *u < 0.0 || *u > 1.0 || *v < 0.0 || *v > 1.0 {
                return;
            }
            let x = (u * geom.css_width).clamp(0.0, geom.css_width);
            let y = (v * geom.css_height + geom.offset_top).clamp(0.0, geom.css_height + geom.offset_top);
            let params = serde_json::json!({
                "type": "mouseReleased",
                "x": x,
                "y": y,
                "button": button.as_cdp_str(),
                "clickCount": 1,
                "modifiers": modifiers,
            });
            let _ = client.send_command("Input.dispatchMouseEvent", Some(params), Some(page_session_id)).await;
        }
        InputEvent::PointerMove { u, v, modifiers } => {
            if *u < 0.0 || *u > 1.0 || *v < 0.0 || *v > 1.0 {
                return;
            }
            let x = (u * geom.css_width).clamp(0.0, geom.css_width);
            let y = (v * geom.css_height + geom.offset_top).clamp(0.0, geom.css_height + geom.offset_top);
            let params = serde_json::json!({
                "type": "mouseMoved",
                "x": x,
                "y": y,
                "modifiers": modifiers,
            });
            let _ = client.send_command("Input.dispatchMouseEvent", Some(params), Some(page_session_id)).await;
        }
        InputEvent::Wheel { u, v, delta_x, delta_y, modifiers } => {
            if *u < 0.0 || *u > 1.0 || *v < 0.0 || *v > 1.0 {
                return;
            }
            let x = (u * geom.css_width).clamp(0.0, geom.css_width);
            let y = (v * geom.css_height + geom.offset_top).clamp(0.0, geom.css_height + geom.offset_top);
            let params = serde_json::json!({
                "type": "mouseWheel",
                "x": x,
                "y": y,
                "deltaX": delta_x,
                "deltaY": delta_y,
                "modifiers": modifiers,
            });
            let _ = client.send_command("Input.dispatchMouseEvent", Some(params), Some(page_session_id)).await;
        }
        InputEvent::KeyDown { key, code, modifiers } => {
            let params = serde_json::json!({
                "type": "rawKeyDown",
                "key": key,
                "code": code,
                "modifiers": modifiers,
            });
            let _ = client.send_command("Input.dispatchKeyEvent", Some(params), Some(page_session_id)).await;
        }
        InputEvent::KeyUp { key, code, modifiers } => {
            let params = serde_json::json!({
                "type": "keyUp",
                "key": key,
                "code": code,
                "modifiers": modifiers,
            });
            let _ = client.send_command("Input.dispatchKeyEvent", Some(params), Some(page_session_id)).await;
        }
        InputEvent::InsertText { text } => {
            let params = serde_json::json!({
                "text": text,
            });
            let _ = client.send_command("Input.insertText", Some(params), Some(page_session_id)).await;
        }
        InputEvent::PointerCancel => {}
    }
}
