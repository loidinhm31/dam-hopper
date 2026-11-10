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
use tokio::sync::{watch, Mutex, RwLock};
use tokio::time::{interval, sleep, timeout};
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::api::auth::AuthenticatedActor;
use crate::api::browser_host::{
    browser_error_response, global_attachment_manager, global_session_registry,
};
use crate::browser_host::attachments::AttachmentPurpose;
use crate::browser_host::auth::{
    validate_request_origin, verify_dev_boundary, verify_live_admission, BrowserAdmission,
};
use crate::browser_host::cdp::{CdpClient, CdpLifecycleEvent};
use crate::browser_host::diagnostics::{global_stream_diagnostics, TrackedBhjfFrame};
use crate::browser_host::input::{InputEvent, InputMessage};
use crate::browser_host::manager::{
    BrowserInstanceHandle, NativeCloseOutcome, NativeControl, NativeControlError,
    NativeCreateError, NativeFaults, NativePumpRequest,
};
use crate::browser_host::protocol::{
    unpack_bhjf_frame, MediaClientControl, ServerControlEvent, TargetGeometry, CONTROL_SUBPROTOCOL,
    MEDIA_SUBPROTOCOL, TICKET_SUBPROTOCOL_PREFIX,
};
use crate::browser_host::screencast::ScreencastProducer;
use crate::browser_host::session::{
    BindOutcome, BrowserSessionDto, CloseAction, CreateParams, CreateReservation,
    CreateSessionRequest, RollbackOutcome, SessionError, SessionSnapshot, SessionStatus,
};
use crate::state::AppState;

/// Upper bound for observing the commit of a session's first managed navigation before the
/// navigation watcher starts (the event normally precedes the `Page.navigate` response).
const INITIAL_NAVIGATION_COMMIT_WAIT: Duration = Duration::from_millis(250);
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

/// Longest a creation/close waits for a session's single-flight gate held by another caller.
const SESSION_GATE_WAIT: Duration = Duration::from_secs(30);

pub async fn get_or_register_producer(session_id: &str, producer: Arc<ScreencastProducer>) {
    let mut map = GLOBAL_PRODUCERS.write().await;
    map.insert(session_id.to_string(), producer);
}

pub async fn get_producer(session_id: &str) -> Option<Arc<ScreencastProducer>> {
    let map = GLOBAL_PRODUCERS.read().await;
    map.get(session_id).cloned()
}

/// Drops a session's producer handle and stops its screencast and navigation watcher. It never
/// closes the native page: that is owned by `close_native_session`, which keeps the producer
/// until the page's absence is proven.
pub async fn remove_producer(session_id: &str) {
    crate::browser_host::selection::stop_session_navigation_watcher(session_id);
    let removed = {
        let mut map = GLOBAL_PRODUCERS.write().await;
        map.remove(session_id)
    };
    if let Some(producer) = removed {
        let _ = producer.stop_screencast().await;
    }
}

/// A cached producer is only usable for the browser incarnation it was built for and while its
/// CDP connection is alive.
fn producer_is_current(producer: &ScreencastProducer, incarnation: &str) -> bool {
    producer.browser_incarnation() == incarnation && !producer.cdp_client.is_closed()
}

/// Why a producer is being materialized; decides whether the initial managed navigation runs.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ProducerOrigin {
    /// REST create: publishes the session after setup and navigates to its URL.
    Rest,
    /// Existing session without a cached producer (re-attach, selection, input).
    Lazy,
    /// Admitted `window.open` popup: already navigating, published after policy install.
    Popup,
}

/// Creates a session through the manager-owned native path: one single-flight creation per
/// idempotency key, one native page, one published producer. A failed native creation is never
/// reported as `Running`; a same-key retry reconciles instead of returning a stale DTO.
/// Returns `(session, created_by_this_call)`.
pub async fn create_native_session(
    state: &AppState,
    admission: &BrowserAdmission,
    handle: &BrowserInstanceHandle,
    request: &CreateSessionRequest,
) -> Result<(BrowserSessionDto, bool), SessionError> {
    ensure_native_pump(state);
    NativeFaults::delay(&state.browser_host.native_faults.delay_before_reserve_ms).await;
    let host = state.browser_host.clone();
    let (principal, is_dev, epoch, incarnation) = (
        admission.principal.clone(),
        admission.is_dev,
        handle.profile_epoch,
        handle.browser_incarnation.clone(),
    );
    let live = move || host.is_instance_live_sync(&principal, is_dev, epoch, &incarnation);
    let allowed = state.browser_host.config().allowed_target_origins.clone();
    let params = CreateParams {
        principal: &admission.principal,
        is_dev: admission.is_dev,
        browser_incarnation: &handle.browser_incarnation,
        profile_epoch: handle.profile_epoch,
        request,
        allowed_origins: &allowed,
        max_targets: state.browser_host.max_targets(),
    };
    match global_session_registry()
        .reserve_creation(&params, &live)
        .await?
    {
        CreateReservation::Existing(dto) => Ok((dto, false)),
        CreateReservation::Pending { session_id } => {
            // The creation runs in a task the client cannot cancel: a dropped connection must
            // never leave a half-built session without its leader.
            let state = state.clone();
            let admission = admission.clone();
            tokio::spawn(async move {
                materialize_producer(
                    &state,
                    &session_id,
                    &admission.principal,
                    admission.is_dev,
                    ProducerOrigin::Rest,
                    Some(&admission),
                )
                .await
                .map(|outcome| match outcome {
                    Materialized::Published(published) => {
                        (published.session, published.published_now)
                    }
                    Materialized::Retired(session) => (session, false),
                })
            })
            .await
            .map_err(|e| SessionError::Internal(format!("session creation task failed: {e}")))?
        }
    }
}

/// Lazily ensures the producer of an existing session (re-attach, selection, input).
pub async fn ensure_producer_for_session(
    state: &AppState,
    session_id: &str,
    principal: &str,
    is_dev: bool,
) -> Option<Arc<ScreencastProducer>> {
    ensure_native_pump(state);
    if let Ok(snapshot) = global_session_registry()
        .snapshot(session_id, principal)
        .await
    {
        if snapshot.status == SessionStatus::Running {
            if let Some(existing) = get_producer(session_id).await {
                if producer_is_current(&existing, &snapshot.browser_incarnation) {
                    return Some(existing);
                }
            }
        }
    }
    match materialize_producer(
        state,
        session_id,
        principal,
        is_dev,
        ProducerOrigin::Lazy,
        None,
    )
    .await
    {
        Ok(Materialized::Published(published)) => Some(published.producer),
        Ok(Materialized::Retired(_)) => None,
        Err(err) => {
            warn!(error = %err, "Browser producer unavailable for session");
            None
        }
    }
}

struct PublishedProducer {
    producer: Arc<ScreencastProducer>,
    session: BrowserSessionDto,
    /// True when this call performed the `Initializing -> Running` publication.
    published_now: bool,
}

enum Materialized {
    Published(PublishedProducer),
    /// The session is already `Closing`/`Closed`/`Lost`: an idempotent retry observes it as is.
    Retired(BrowserSessionDto),
}

/// Single publication path for producers. Under the session's gate it (1) acquires or
/// reconciles the session's native page, (2) builds the producer and installs the request
/// policy BEFORE the first navigation, (3) publishes `Running` only if the session, profile
/// epoch, browser incarnation and live admission are still current, and (4) registers the one
/// producer. Any failure after reservation rolls back what is provable and keeps the rest owned.
async fn materialize_producer(
    state: &AppState,
    session_id: &str,
    principal: &str,
    is_dev: bool,
    origin: ProducerOrigin,
    admission: Option<&BrowserAdmission>,
) -> Result<Materialized, SessionError> {
    let registry = global_session_registry();
    let gate = registry.session_gate(session_id, principal).await?;
    let _gate = timeout(SESSION_GATE_WAIT, gate.lock())
        .await
        .map_err(|_| SessionError::Busy("session creation is still in progress".to_string()))?;

    let snapshot = registry.snapshot(session_id, principal).await?;
    let creating = match snapshot.status {
        SessionStatus::Initializing => true,
        SessionStatus::Running => false,
        other => {
            // Closed/Lost/Closing: an idempotent same-key retry observes the retired truth.
            if origin == ProducerOrigin::Rest {
                return Ok(Materialized::Retired(snapshot.dto));
            }
            return Err(SessionError::Conflict(format!("session is {other}")));
        }
    };
    if !creating {
        if let Some(existing) = get_producer(session_id).await {
            if producer_is_current(&existing, &snapshot.browser_incarnation) {
                return Ok(Materialized::Published(PublishedProducer {
                    producer: existing,
                    session: snapshot.dto,
                    published_now: false,
                }));
            }
            remove_producer(session_id).await;
        }
    }

    let control = match state.browser_host.native_control(principal, is_dev).await {
        Ok(control) => control,
        Err(NativeControlError::NotRunning) => {
            return Err(fail_creation(
                state,
                None,
                session_id,
                creating,
                SessionError::Conflict("browser instance is not running".to_string()),
            )
            .await);
        }
        Err(NativeControlError::Unavailable(msg)) => {
            return Err(SessionError::NativeUnavailable(msg));
        }
    };
    if control.browser_incarnation != snapshot.browser_incarnation {
        return Err(fail_creation(
            state,
            Some(&control),
            session_id,
            creating,
            SessionError::Conflict("session belongs to a previous browser incarnation".to_string()),
        )
        .await);
    }

    let (target_id, fresh) = acquire_native_target(&control, session_id, &snapshot).await?;
    let (producer, _page_sid) = match build_producer(
        state,
        &control,
        &snapshot,
        session_id,
        &target_id,
        fresh && origin != ProducerOrigin::Popup,
    )
    .await
    {
        Ok(built) => built,
        Err(err) => {
            return Err(fail_creation(state, Some(&control), session_id, creating, err).await);
        }
    };

    NativeFaults::delay(&state.browser_host.native_faults.delay_before_commit_ms).await;
    let live = {
        let host = state.browser_host.clone();
        let principal = principal.to_string();
        let incarnation = snapshot.browser_incarnation.clone();
        let epoch = snapshot.profile_epoch;
        move || host.is_instance_live_sync(&principal, is_dev, epoch, &incarnation)
    };
    let session = if creating {
        if let Some(admission) = admission {
            if verify_live_admission(state, admission).await.is_err() {
                abort_producer(session_id, &producer).await;
                return Err(fail_creation(
                    state,
                    Some(&control),
                    session_id,
                    true,
                    SessionError::Conflict("live admission was revoked before publication".into()),
                )
                .await);
            }
        }
        match registry.commit_running(session_id, &live).await {
            Ok(dto) => dto,
            Err(err) => {
                abort_producer(session_id, &producer).await;
                return Err(fail_creation(state, Some(&control), session_id, true, err).await);
            }
        }
    } else {
        snapshot.dto.clone()
    };
    get_or_register_producer(session_id, producer.clone()).await;
    // A fence that closed the session before the producer became visible could not remove it.
    let still_live = registry
        .snapshot(session_id, principal)
        .await
        .is_ok_and(|s| s.status == SessionStatus::Running);
    if !still_live {
        remove_producer(session_id).await;
        return Err(SessionError::Conflict(
            "session was closed while it was being published".to_string(),
        ));
    }
    Ok(Materialized::Published(PublishedProducer {
        producer,
        session,
        published_now: creating,
    }))
}

/// Acquires the native page of a session: bound identity first, then marker reconciliation
/// (a lost create response), then exactly one create. Returns `(target_id, never_navigated)`.
async fn acquire_native_target(
    control: &NativeControl,
    session_id: &str,
    snapshot: &SessionSnapshot,
) -> Result<(String, bool), SessionError> {
    let registry = global_session_registry();
    let creating = snapshot.status == SessionStatus::Initializing;
    if let Some(target_id) = &snapshot.native_target_id {
        return Ok((target_id.clone(), creating));
    }
    let incarnation = &snapshot.browser_incarnation;
    if snapshot.native_create_attempted {
        // An earlier attempt may have created a page whose response was lost.
        match control.find_creation_page(session_id).await {
            Ok(Some(target_id)) => {
                return adopt_found_page(control, session_id, incarnation, target_id).await;
            }
            Ok(None) => {}
            Err(err) => {
                let msg = format!("native target reconciliation failed: {err}");
                registry.note_creation_error(session_id, &msg).await;
                return Err(SessionError::NativeUnavailable(msg));
            }
        }
    }
    registry.mark_create_attempted(session_id).await;
    match control.create_page(session_id).await {
        Ok(target_id) => adopt_found_page(control, session_id, incarnation, target_id).await,
        Err(NativeCreateError::Definitive(msg)) => {
            // Chrome refused: no page exists, so the reservation is released (same-key retry
            // starts fresh).
            registry.rollback_creation(session_id).await;
            Err(SessionError::NativeUnavailable(format!(
                "native target creation was refused: {msg}"
            )))
        }
        Err(NativeCreateError::Ambiguous(msg)) => {
            // The page may exist: reconcile once. Otherwise the reservation (and its slot) stays
            // Initializing so a same-key retry reconciles it; the observer also binds the page
            // if it appears late.
            match control.find_creation_page(session_id).await {
                Ok(Some(target_id)) => {
                    adopt_found_page(control, session_id, incarnation, target_id).await
                }
                _ => {
                    let msg = format!("native target creation outcome is unknown: {msg}");
                    registry.note_creation_error(session_id, &msg).await;
                    Err(SessionError::NativeUnavailable(msg))
                }
            }
        }
    }
}

/// Binds a found/created page as the session's identity. A different already-bound page wins
/// and the offered one (a proven surplus of this creation) is closed.
async fn adopt_found_page(
    control: &NativeControl,
    session_id: &str,
    incarnation: &str,
    target_id: String,
) -> Result<(String, bool), SessionError> {
    match global_session_registry()
        .bind_native_target(session_id, incarnation, &target_id)
        .await
    {
        BindOutcome::Bound => Ok((target_id, true)),
        BindOutcome::Surplus { existing } => {
            let _ = control.close_page(&target_id).await;
            Ok((existing, true))
        }
        BindOutcome::NotPending => {
            let _ = control.close_page(&target_id).await;
            Err(SessionError::Conflict(
                "session is no longer awaiting a native target".to_string(),
            ))
        }
    }
}

/// Attaches an isolated producer transport after the manager installed browser-wide policy,
/// runs the first managed navigation, and starts the navigation watcher.
async fn build_producer(
    state: &AppState,
    control: &NativeControl,
    snapshot: &SessionSnapshot,
    session_id: &str,
    target_id: &str,
    navigate: bool,
) -> Result<(Arc<ScreencastProducer>, String), SessionError> {
    // Keep page events and screencast credits isolated from the manager's observer session
    // and from other producers. Browser Fetch still wraps these pages' loader factories.
    let client = CdpClient::connect(&control.ws_endpoint)
        .await
        .map_err(|err| SessionError::NativeUnavailable(format!("CDP connect failed: {err}")))?;
    let viewport_epoch = snapshot.dto.viewport_epoch.parse::<u64>().unwrap_or(1);
    let producer = Arc::new(
        ScreencastProducer::new(
            session_id.to_string(),
            snapshot.browser_incarnation.clone(),
            snapshot.profile_epoch,
            viewport_epoch,
            client,
            target_id.to_string(),
            snapshot.dto.geometry.clone(),
        ),
    );
    let page_sid = producer.ensure_page_session().await.map_err(|err| {
        SessionError::NativeUnavailable(format!("browser page session setup failed: {err}"))
    })?;
    producer
        .apply_stealth_and_focus(&page_sid)
        .await
        .map_err(|err| {
            SessionError::NativeUnavailable(format!("browser stealth session setup failed: {err}"))
        })?;
    let initial_url = snapshot.dto.url.trim();
    if navigate && !initial_url.is_empty() && initial_url != "about:blank" {
        // First managed navigation: the request policy is already live on this page session.
        // Subscribe before navigating, then wait (bounded) for the commit event BEFORE the
        // navigation watcher starts, so the server-initiated initial load never counts as a
        // renderer navigation (no revision bump).
        let mut events = producer.cdp_client.subscribe_events();
        match producer
            .cdp_client
            .send_command(
                "Page.navigate",
                Some(serde_json::json!({ "url": initial_url })),
                Some(&page_sid),
            )
            .await
        {
            Ok(_) => {
                let _ = tokio::time::timeout(INITIAL_NAVIGATION_COMMIT_WAIT, async {
                    loop {
                        match events.recv().await {
                            Ok(ev)
                                if matches!(
                                    &*ev,
                                    CdpLifecycleEvent::FrameNavigated {
                                        session_id: event_session_id,
                                        is_main_frame: true,
                                        ..
                                    } if event_session_id.as_deref() == Some(page_sid.as_str())
                                ) =>
                            {
                                break
                            }
                            Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        }
                    }
                })
                .await;
            }
            Err(err) => warn!(error = %err, "Initial managed navigation failed"),
        }
    }
    crate::browser_host::selection::ensure_session_navigation_watcher(
        state,
        session_id,
        &producer.cdp_client,
        &page_sid,
    )
    .await;
    Ok((producer, page_sid))
}

/// Drops an unpublished producer's watcher and screencast (it was never registered).
async fn abort_producer(session_id: &str, producer: &Arc<ScreencastProducer>) {
    crate::browser_host::selection::stop_session_navigation_watcher(session_id);
    let _ = producer.stop_screencast().await;
}

/// Rolls back a failed creation as far as the native outcome is provable. Without native
/// identity the pending session disappears (a same-key retry restarts); with one it becomes
/// `Closing` and the page is closed, keeping slot and identity until absence is proven.
async fn fail_creation(
    _state: &AppState,
    control: Option<&NativeControl>,
    session_id: &str,
    creating: bool,
    error: SessionError,
) -> SessionError {
    if !creating {
        return error;
    }
    let registry = global_session_registry();
    if let RollbackOutcome::Closing { target_id } = registry.rollback_creation(session_id).await {
        if let Some(control) = control {
            if control.close_page(&target_id).await == NativeCloseOutcome::Absent {
                registry.finish_close(session_id, true).await;
            }
        }
    }
    error
}

/// Closes a session and its native page. The session becomes `Closing` and keeps its identity,
/// producer and capacity until the page's absence is PROVEN (inventory/destroyed); a failed or
/// ambiguous close is reported and a repeated call resumes the same cleanup.
pub async fn close_native_session(
    state: &AppState,
    session_id: &str,
    principal: &str,
) -> Result<(), SessionError> {
    let registry = global_session_registry();
    // Wait out an in-flight creation so close and publication cannot interleave.
    let gate = registry.session_gate(session_id, principal).await;
    let _gate = match &gate {
        Ok(gate) => timeout(SESSION_GATE_WAIT, gate.lock()).await.ok(),
        Err(_) => None,
    };
    let action = match registry.begin_close(session_id, principal).await {
        Ok(action) => action,
        Err(SessionError::NotFound) => {
            // Idempotent delete of an absent (reaped) session; foreign sessions stay hidden.
            return if registry
                .session_exists_for_other(session_id, principal)
                .await
            {
                Err(SessionError::NotFound)
            } else {
                Ok(())
            };
        }
        Err(err) => return Err(err),
    };
    // Viewers, leases and selection state end immediately; the producer stays until absence.
    crate::browser_host::selection::cleanup_session(state, session_id).await;
    crate::api::browser_host::release_session_viewers(session_id).await;
    if let Some(producer) = get_producer(session_id).await {
        let _ = producer.stop_screencast().await;
    }
    let proven_absent = match action {
        CloseAction::Retired => true,
        CloseAction::Native {
            target_id,
            browser_incarnation,
            is_dev,
        } => match state.browser_host.native_control(principal, is_dev).await {
            // No live process, or a newer incarnation: the page is proven gone.
            Err(NativeControlError::NotRunning) => true,
            Err(NativeControlError::Unavailable(msg)) => {
                return Err(SessionError::NativeUnavailable(format!(
                    "native close could not be attempted: {msg}"
                )));
            }
            Ok(control) if control.browser_incarnation != browser_incarnation => true,
            Ok(control) => {
                let target = match target_id {
                    Some(target) => Some(target),
                    None => match control.find_creation_page(session_id).await {
                        Ok(found) => found,
                        Err(err) => {
                            return Err(SessionError::NativeUnavailable(format!(
                                "native target lookup failed: {err}"
                            )));
                        }
                    },
                };
                match target {
                    None => true,
                    Some(target) => match control.close_page(&target).await {
                        NativeCloseOutcome::Absent => true,
                        NativeCloseOutcome::Unconfirmed(msg) => {
                            return Err(SessionError::NativeUnavailable(format!(
                                "native close is unconfirmed: {msg}"
                            )));
                        }
                    },
                }
            }
        },
    };
    if proven_absent {
        registry.finish_close(session_id, false).await;
        remove_producer(session_id).await;
    }
    Ok(())
}

/// Starts (once per manager) the task that serves the observer's requests that need
/// application state: popup adoption (policy install before resume) and cleanup of retired
/// sessions' selection state.
pub fn ensure_native_pump(state: &AppState) {
    if let Some(mut requests) = state.browser_host.claim_native_pump() {
        let state = state.clone();
        tokio::spawn(async move {
            while let Some(request) = requests.recv().await {
                match request {
                    NativePumpRequest::AdoptPopup(adoption) => {
                        let result = materialize_producer(
                            &state,
                            &adoption.session_id,
                            &adoption.principal,
                            adoption.is_dev,
                            ProducerOrigin::Popup,
                            None,
                        )
                        .await
                        .and_then(|outcome| match outcome {
                            Materialized::Published(published) => Ok(published.session),
                            Materialized::Retired(session) => Err(SessionError::Conflict(format!(
                                "popup session is {}",
                                session.status
                            ))),
                        })
                        .map_err(|err| err.to_string());
                        let _ = adoption.reply.send(result);
                    }
                    NativePumpRequest::SessionsRetired(session_ids) => {
                        for session_id in session_ids {
                            crate::browser_host::selection::cleanup_session(&state, &session_id)
                                .await;
                        }
                    }
                }
            }
        });
    }
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
        if self.outstanding.len() < MAX_OUTSTANDING_PER_VIEWER
            && now.duration_since(self.last_delivery) >= MIN_DELIVERY_INTERVAL
        {
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
                global_stream_diagnostics()
                    .discards_received
                    .fetch_add(1, Ordering::Relaxed);
            } else {
                self.total_acked += 1;
                global_stream_diagnostics()
                    .acks_received
                    .fetch_add(1, Ordering::Relaxed);
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

/// Exact approved-origin check for media/control upgrades; Origin-less requests defer to the
/// ticket's bound Origin (checked at consume time).
fn unapproved_origin_response(state: &AppState, headers: &HeaderMap) -> Option<Response> {
    validate_request_origin(state, headers).err().map(|err| {
        browser_error_response(StatusCode::FORBIDDEN, "forbiddenOrigin", &err.to_string())
    })
}

/// Development tickets require the real bound listener and the peer to be loopback.
fn dev_boundary_violation_response(
    state: &AppState,
    is_dev: bool,
    connect: Option<&Extension<ConnectInfo<SocketAddr>>>,
) -> Option<Response> {
    if !is_dev {
        return None;
    }
    let peer = connect.map(|Extension(ConnectInfo(addr))| *addr);
    verify_dev_boundary(state, peer)
        .err()
        .map(|err| browser_error_response(StatusCode::FORBIDDEN, "forbiddenPeer", &err.to_string()))
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

    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());

    let att_manager = global_attachment_manager();
    let admitted = match att_manager
        .consume_ticket(&raw_ticket, AttachmentPurpose::Media, origin)
        .await
    {
        Ok(a) => a,
        Err(e) => {
            return browser_error_response(StatusCode::FORBIDDEN, "ticketInvalid", &e.to_string());
        }
    };

    // Origin validation (shared exact approved-origin policy)
    if let Some(resp) = unapproved_origin_response(&state, &headers) {
        return resp;
    }

    // Dev boundary: actual bound listener AND peer must be loopback
    if let Some(resp) = dev_boundary_violation_response(&state, admitted.is_dev, connect.as_ref()) {
        return resp;
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
        return browser_error_response(
            StatusCode::UNAUTHORIZED,
            "invalidSession",
            "live authentication validation failed",
        );
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
            return browser_error_response(StatusCode::FORBIDDEN, "pairingFailed", &e.to_string());
        }
    };

    let session_id = admitted.browser_session_id.clone().unwrap_or_default();
    let viewer_id = admitted.viewer_id.clone().unwrap_or_default();
    let sub_epoch = admitted.subscription_epoch.clone().unwrap_or_default();
    let effective_deadline = admitted.effective_deadline;

    // Lazily ensure ScreencastProducer exists for this session. Setup can take long (browser
    // launch, target creation), so it is raced against the supervisor's cancellation and live
    // authority is re-verified afterwards; a revoked viewer never proceeds to the upgrade.
    let producer = tokio::select! {
        _ = cancel_token.cancelled() => {
            att_manager.unregister_connection(conn_id).await;
            return browser_error_response(
                StatusCode::UNAUTHORIZED,
                "invalidSession",
                "attachment cancelled during setup",
            );
        }
        producer = ensure_producer_for_session(&state, &session_id, &admitted.principal, admitted.is_dev) => producer,
    };
    if cancel_token.is_cancelled() || verify_live_admission(&state, &adm).await.is_err() {
        att_manager.unregister_connection(conn_id).await;
        return browser_error_response(
            StatusCode::UNAUTHORIZED,
            "invalidSession",
            "live authentication validation failed",
        );
    }

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
    let controller = Arc::new(Mutex::new(ViewerCreditController::new(
        subscription_epoch.clone(),
    )));

    let mut frame_rx = if let Some(prod) = &producer {
        prod.register_viewer_demand(&viewer_id, &subscription_epoch, true)
            .await;
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
            Some(sleep(Duration::from_millis(
                duration.num_milliseconds() as u64
            )))
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
    global_attachment_manager()
        .unregister_connection(conn_id)
        .await;
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

    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());

    let att_manager = global_attachment_manager();
    let admitted = match att_manager
        .consume_ticket(&raw_ticket, AttachmentPurpose::Control, origin)
        .await
    {
        Ok(a) => a,
        Err(e) => {
            return browser_error_response(StatusCode::FORBIDDEN, "ticketInvalid", &e.to_string());
        }
    };

    // Origin validation (shared exact approved-origin policy)
    if let Some(resp) = unapproved_origin_response(&state, &headers) {
        return resp;
    }

    // Dev boundary: actual bound listener AND peer must be loopback
    if let Some(resp) = dev_boundary_violation_response(&state, admitted.is_dev, connect.as_ref()) {
        return resp;
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
        return browser_error_response(
            StatusCode::UNAUTHORIZED,
            "invalidSession",
            "live authentication validation failed",
        );
    }

    let (conn_id, cancel_token) = match att_manager.register_connection(&admitted).await {
        Ok(c) => c,
        Err(e) => {
            return browser_error_response(StatusCode::FORBIDDEN, "pairingFailed", &e.to_string());
        }
    };

    let session_id = admitted.browser_session_id.clone().unwrap_or_default();
    let viewer_id = admitted.viewer_id.clone().unwrap_or_default();
    let sub_epoch = admitted.subscription_epoch.clone().unwrap_or_default();
    let effective_deadline = admitted.effective_deadline;
    let updates = match global_session_registry()
        .subscribe_session(
            &session_id,
            &admitted.principal,
            admitted.is_dev,
            admitted.profile_epoch,
            &admitted.browser_incarnation,
        )
        .await
    {
        Ok(updates) => updates,
        Err(_) => {
            att_manager.unregister_connection(conn_id).await;
            return browser_error_response(
                StatusCode::NOT_FOUND,
                "sessionNotFound",
                "browser session not found",
            );
        }
    };

    ws.protocols([CONTROL_SUBPROTOCOL])
        .max_message_size(MAX_CONTROL_MESSAGE_BYTES)
        .max_frame_size(MAX_CONTROL_MESSAGE_BYTES)
        .on_upgrade(move |socket| {
            run_control_session(
                socket,
                state,
                adm,
                updates,
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
    state: AppState,
    admission: BrowserAdmission,
    mut updates: watch::Receiver<ServerControlEvent>,
    session_id: String,
    viewer_id: String,
    subscription_epoch: String,
    effective_deadline: Option<DateTime<Utc>>,
    cancel_token: CancellationToken,
    conn_id: Uuid,
) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let input_manager = crate::api::browser_host::get_or_create_input_manager(&session_id).await;

    let mut message_count_in_sec = 0usize;
    let mut rate_window_start = Instant::now();
    let mut initial_update = true;

    let deadline_sleep = match effective_deadline {
        Some(dl) => {
            let duration = dl.signed_duration_since(Utc::now());
            let duration = duration.to_std().unwrap_or(Duration::ZERO);
            Some(sleep(duration))
        }
        None => None,
    };
    tokio::pin!(deadline_sleep);

    loop {
        tokio::select! {
            biased;
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
            changed = async {
                if initial_update {
                    Ok(())
                } else {
                    updates.changed().await
                }
            } => {
                initial_update = false;
                if changed.is_err() {
                    break;
                }
                // Release the watch borrow before the socket await: producers never wait on
                // a slow viewer and only one latest-state slot is retained per session.
                let Ok((json, retired)) = serialize_control_snapshot(&mut updates) else {
                    break;
                };
                let Some(deadline) = control_write_deadline(effective_deadline) else {
                    break;
                };
                let sent = tokio::select! {
                    biased;
                    _ = cancel_token.cancelled() => false,
                    result = timeout(deadline, ws_sink.send(AxumWsMessage::Text(json.into()))) => {
                        matches!(result, Ok(Ok(())))
                    }
                };
                if !sent || retired {
                    break;
                }
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
                                            let event_kind = match &msg.event {
                                                crate::browser_host::input::InputEvent::PointerDown { .. } => "pointerDown",
                                                crate::browser_host::input::InputEvent::PointerUp { .. } => "pointerUp",
                                                crate::browser_host::input::InputEvent::PointerMove { .. } => "pointerMove",
                                                crate::browser_host::input::InputEvent::PointerCancel => "pointerCancel",
                                                crate::browser_host::input::InputEvent::Wheel { .. } => "wheel",
                                                crate::browser_host::input::InputEvent::KeyDown { .. } => "keyDown",
                                                crate::browser_host::input::InputEvent::KeyUp { .. } => "keyUp",
                                                crate::browser_host::input::InputEvent::InsertText { .. } => "insertText",
                                            };
                                            debug!(session_id = %session_id, event_kind, "Dispatching CDP input event");
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

    // Native retirement can publish and revoke attachments in the same scheduler turn.
    // Best-effort final truth must not bypass auth revocation: recheck live admission,
    // bounded by the existing write/auth deadline, before writing on a cancelled pair.
    let non_running = matches!(
        &*updates.borrow(),
        ServerControlEvent::SessionUpdated { session } if session.status != "running"
    );
    if cancel_token.is_cancelled() && non_running {
        if let Some(deadline) = control_write_deadline(effective_deadline) {
            if matches!(
                timeout(deadline, verify_live_admission(&state, &admission)).await,
                Ok(Ok(()))
            ) {
                if let (Some(deadline), Ok((json, _))) = (
                    control_write_deadline(effective_deadline),
                    serialize_control_snapshot(&mut updates),
                ) {
                    let _ = timeout(
                        deadline,
                        ws_sink.send(AxumWsMessage::Text(json.into())),
                    )
                    .await;
                }
            }
        }
    }
    drop(updates);

    // Teardown: revoke lease only if this viewer is the current lease holder
    if input_manager.is_lease_holder(&viewer_id).await {
        let releases = input_manager.revoke_lease().await;
        if !releases.is_empty() {
            if let Some(producer) = get_producer(&session_id).await {
                if let Ok(page_sid) = producer.ensure_page_session().await {
                    let geom = producer.geometry().await;
                    for rel in &releases {
                        dispatch_input_event_to_cdp(&producer.cdp_client, &page_sid, &geom, rel)
                            .await;
                    }
                }
            }
        }
    }
    global_attachment_manager()
        .unregister_connection(conn_id)
        .await;
    let _ = timeout(WRITE_DEADLINE, ws_sink.send(AxumWsMessage::Close(None))).await;
}

fn serialize_control_snapshot(
    updates: &mut watch::Receiver<ServerControlEvent>,
) -> Result<(String, bool), serde_json::Error> {
    let event = updates.borrow_and_update();
    let retired = matches!(
        &*event,
        ServerControlEvent::SessionUpdated { session }
            if session.status == "closed" || session.status == "lost"
    );
    serde_json::to_string(&*event).map(|json| (json, retired))
}

fn control_write_deadline(effective_deadline: Option<DateTime<Utc>>) -> Option<Duration> {
    match effective_deadline {
        Some(deadline) => deadline
            .signed_duration_since(Utc::now())
            .to_std()
            .ok()
            .filter(|remaining| !remaining.is_zero())
            .map(|remaining| remaining.min(WRITE_DEADLINE)),
        None => Some(WRITE_DEADLINE),
    }
}

/// Chromium does not derive its Windows virtual key code from DOM `key`/`code`.
/// Editing bindings and accelerators use this platform-independent value even on Linux;
/// `nativeVirtualKeyCode` is deliberately omitted because it is host-platform specific.
fn keyboard_virtual_key_code(key: &str, code: &str) -> u32 {
    match key {
        "Backspace" => return 8,
        "Tab" => return 9,
        "Enter" => return 13,
        "Shift" => return 16,
        "Control" => return 17,
        "Alt" => return 18,
        "Escape" => return 27,
        " " => return 32,
        "PageUp" => return 33,
        "PageDown" => return 34,
        "End" => return 35,
        "Home" => return 36,
        "ArrowLeft" => return 37,
        "ArrowUp" => return 38,
        "ArrowRight" => return 39,
        "ArrowDown" => return 40,
        "Insert" => return 45,
        "Delete" => return 46,
        "Dead" | "Process" | "Unidentified" => return 0,
        _ => {}
    }
    // Prefer the layout-resolved letter for shortcuts (e.g. Ctrl+A on AZERTY).
    if let [letter] = key.as_bytes() {
        if letter.is_ascii_alphabetic() {
            return u32::from(letter.to_ascii_uppercase());
        }
    }
    match code.as_bytes() {
        [b'K', b'e', b'y', letter @ b'A'..=b'Z'] => u32::from(*letter),
        [b'D', b'i', b'g', b'i', b't', digit @ b'0'..=b'9'] => u32::from(*digit),
        _ => match code {
            "ShiftLeft" | "ShiftRight" => 16,
            "ControlLeft" | "ControlRight" => 17,
            "AltLeft" | "AltRight" => 18,
            "MetaLeft" => 91,
            "MetaRight" => 92,
            "Space" => 32,
            "Semicolon" => 186,
            "Equal" => 187,
            "Comma" => 188,
            "Minus" => 189,
            "Period" => 190,
            "Slash" => 191,
            "Backquote" => 192,
            "BracketLeft" => 219,
            "Backslash" => 220,
            "BracketRight" => 221,
            "Quote" => 222,
            _ => 0,
        },
    }
}

fn keyboard_event_params(key: &str, code: &str, modifiers: u32, down: bool) -> serde_json::Value {
    // Enter needs Chromium's character phase for newline insertion/form submission.
    // All printable/IME text still arrives exclusively through Input.insertText.
    let enter_text = down && key == "Enter" && modifiers & (1 | 2 | 4) == 0;
    let mut params = serde_json::json!({
        "type": if !down { "keyUp" } else if enter_text { "keyDown" } else { "rawKeyDown" },
        "key": key,
        "code": code,
        "modifiers": modifiers,
        "windowsVirtualKeyCode": keyboard_virtual_key_code(key, code),
    });
    if enter_text {
        params["text"] = serde_json::json!("\r");
        params["unmodifiedText"] = serde_json::json!("\r");
    }
    if code.starts_with("Numpad") {
        params["isKeypad"] = serde_json::json!(true);
        params["location"] = serde_json::json!(3);
    } else if code.ends_with("Left") && matches!(key, "Shift" | "Control" | "Alt" | "Meta") {
        params["location"] = serde_json::json!(1);
    } else if code.ends_with("Right") && matches!(key, "Shift" | "Control" | "Alt" | "Meta") {
        params["location"] = serde_json::json!(2);
    }
    params
}

pub async fn dispatch_input_event_to_cdp(
    client: &CdpClient,
    page_session_id: &str,
    geom: &TargetGeometry,
    event: &InputEvent,
) {
    match event {
        InputEvent::PointerDown {
            button,
            u,
            v,
            modifiers,
        } => {
            if *u < 0.0 || *u > 1.0 || *v < 0.0 || *v > 1.0 {
                return;
            }
            let x = (u * geom.css_width).clamp(0.0, geom.css_width);
            let y = (v * geom.css_height + geom.offset_top)
                .clamp(0.0, geom.css_height + geom.offset_top);
            let params = serde_json::json!({
                "type": "mousePressed",
                "x": x,
                "y": y,
                "button": button.as_cdp_str(),
                "clickCount": 1,
                "modifiers": modifiers,
            });
            let _ = client
                .send_command(
                    "Input.dispatchMouseEvent",
                    Some(params),
                    Some(page_session_id),
                )
                .await;
        }
        InputEvent::PointerUp {
            button,
            u,
            v,
            modifiers,
        } => {
            if *u < 0.0 || *u > 1.0 || *v < 0.0 || *v > 1.0 {
                return;
            }
            let x = (u * geom.css_width).clamp(0.0, geom.css_width);
            let y = (v * geom.css_height + geom.offset_top)
                .clamp(0.0, geom.css_height + geom.offset_top);
            let params = serde_json::json!({
                "type": "mouseReleased",
                "x": x,
                "y": y,
                "button": button.as_cdp_str(),
                "clickCount": 1,
                "modifiers": modifiers,
            });
            let _ = client
                .send_command(
                    "Input.dispatchMouseEvent",
                    Some(params),
                    Some(page_session_id),
                )
                .await;
        }
        InputEvent::PointerMove { u, v, modifiers } => {
            if *u < 0.0 || *u > 1.0 || *v < 0.0 || *v > 1.0 {
                return;
            }
            let x = (u * geom.css_width).clamp(0.0, geom.css_width);
            let y = (v * geom.css_height + geom.offset_top)
                .clamp(0.0, geom.css_height + geom.offset_top);
            let params = serde_json::json!({
                "type": "mouseMoved",
                "x": x,
                "y": y,
                "modifiers": modifiers,
            });
            let _ = client
                .send_command(
                    "Input.dispatchMouseEvent",
                    Some(params),
                    Some(page_session_id),
                )
                .await;
        }
        InputEvent::Wheel {
            u,
            v,
            delta_x,
            delta_y,
            modifiers,
        } => {
            if *u < 0.0 || *u > 1.0 || *v < 0.0 || *v > 1.0 {
                return;
            }
            let x = (u * geom.css_width).clamp(0.0, geom.css_width);
            let y = (v * geom.css_height + geom.offset_top)
                .clamp(0.0, geom.css_height + geom.offset_top);
            let params = serde_json::json!({
                "type": "mouseWheel",
                "x": x,
                "y": y,
                "deltaX": delta_x,
                "deltaY": delta_y,
                "modifiers": modifiers,
            });
            let _ = client
                .send_command(
                    "Input.dispatchMouseEvent",
                    Some(params),
                    Some(page_session_id),
                )
                .await;
        }
        InputEvent::KeyDown {
            key,
            code,
            modifiers,
        } => {
            let params = keyboard_event_params(key, code, *modifiers, true);
            let _ = client
                .send_command(
                    "Input.dispatchKeyEvent",
                    Some(params),
                    Some(page_session_id),
                )
                .await;
        }
        InputEvent::KeyUp {
            key,
            code,
            modifiers,
        } => {
            let params = keyboard_event_params(key, code, *modifiers, false);
            let _ = client
                .send_command(
                    "Input.dispatchKeyEvent",
                    Some(params),
                    Some(page_session_id),
                )
                .await;
        }
        InputEvent::InsertText { text } => {
            let params = serde_json::json!({
                "text": text,
            });
            let _ = client
                .send_command("Input.insertText", Some(params), Some(page_session_id))
                .await;
        }
        InputEvent::PointerCancel => {}
    }
}

#[cfg(test)]
#[path = "media_keyboard_tests.rs"]
mod keyboard_tests;
