use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
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
use crate::browser_host::attachments::{
    AdmittedAttachment, AttachmentError, AttachmentManager, AttachmentPurpose, PairPermit,
    PairRegistration,
};
use crate::browser_host::auth::{
    validate_request_origin, verify_dev_boundary, verify_live_admission, BrowserAdmission,
};
use crate::browser_host::cdp::{CdpClient, CdpError, CdpLifecycleEvent};
use crate::browser_host::control_input::{
    admit_control_text, drain_control_input, input_unavailable_json, ControlInputContext,
    ControlInputOutcome,
};
use crate::browser_host::diagnostics::{global_stream_diagnostics, TrackedBhjfFrame};
use crate::browser_host::input::{InputEvent, SessionInputManager};
use crate::browser_host::manager::{
    BrowserInstanceHandle, NativeCloseOutcome, NativeControl, NativeControlError,
    NativeCreateError, NativeFaults, NativePumpRequest,
};
use crate::browser_host::adaptive_stream_controller::ViewerSample;
use crate::browser_host::media_writer::{
    spawn_media_writer, MediaPacketSink, MediaWriterEvent, MediaWriterHandle, OutboundMediaPacket,
};
use crate::browser_host::protocol::{
    unpack_bhjf_frame, DiscardReason, HeartbeatTelemetry, MediaClientControlWire,
    ServerControlEvent, TargetGeometry, CONTROL_SUBPROTOCOL, MEDIA_SUBPROTOCOL,
    TICKET_SUBPROTOCOL_PREFIX,
};
use crate::browser_host::screencast::ScreencastProducer;
use crate::browser_host::viewer_delivery_estimator::{
    ViewerDeliveryEstimator, ViewerDeliverySnapshot,
};
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
    // A producer that is re-establishing its own lost connection is still the live owner;
    // once recovery gave up it is replaced like any dead one.
    producer.browser_incarnation() == incarnation
        && (!producer.cdp_client.is_closed() || producer.recovery_pending())
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
    if let Ok(mut nav_updates) = registry
        .subscribe_session(
            session_id,
            principal,
            is_dev,
            snapshot.profile_epoch,
            &snapshot.browser_incarnation,
        )
        .await
    {
        let weak_prod = Arc::downgrade(&producer);
        tokio::spawn(async move {
            loop {
                if nav_updates.changed().await.is_err() {
                    break;
                }
                let Some(prod) = weak_prod.upgrade() else {
                    break;
                };
                let nav_rev = match &*nav_updates.borrow_and_update() {
                    ServerControlEvent::SessionUpdated { session } => {
                        crate::browser_host::decimal_counter::parse_canonical_u64(&session.navigation_revision, false)
                    }
                    _ => None,
                };
                if let Some(rev) = nav_rev {
                    prod.request_audio_doc_epoch(rev);
                }
            }
        });
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
    let viewport_epoch = crate::browser_host::decimal_counter::parse_canonical_u64(&snapshot.dto.viewport_epoch, false).unwrap_or(1);
    let (fps, jpeg_quality, max_width, max_height) = {
        let cfg = state.config.read().await;
        let b = &cfg.server.browser.budgets;
        (b.frame_rate_fps, b.jpeg_quality, b.max_width, b.max_height)
    };
    let producer = Arc::new(
        ScreencastProducer::new(
            session_id.to_string(),
            snapshot.browser_incarnation.clone(),
            snapshot.profile_epoch,
            viewport_epoch,
            client,
            target_id.to_string(),
            snapshot.dto.geometry.clone(),
        )
        .with_capture_policy(fps, jpeg_quality)
        .with_image_bounds(max_width, max_height)
        .with_selection_context(state.clone()),
    );
    let initial_nav_rev = crate::browser_host::decimal_counter::parse_canonical_u64(&snapshot.dto.navigation_revision, false).unwrap_or(1);
    producer.init_audio_doc_epoch(initial_nav_rev);
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
    let mut initial_frame_id: Option<String> = None;
    let mut pending_initial_loader_id: Option<String> = None;
    if navigate && !initial_url.is_empty() && initial_url != "about:blank" {
        // First managed navigation: the request policy is already live on this page session.
        // Subscribe before navigating, then wait (bounded) for the commit event BEFORE the
        // navigation watcher starts, so the server-initiated initial load never counts as a
        // renderer navigation (no revision bump).
        let mut events = producer.cdp_client.subscribe_events();
        match producer
            .dispatch_navigation_for_epoch(
                initial_nav_rev,
                "Page.navigate",
                Some(serde_json::json!({ "url": initial_url })),
                &page_sid,
            )
            .await
        {
            Ok(nav_res) => {
                initial_frame_id = nav_res
                    .get("frameId")
                    .and_then(serde_json::Value::as_str)
                    .filter(|id| !id.is_empty())
                    .map(str::to_string);
                let nav_loader_id = nav_res
                    .get("loaderId")
                    .and_then(serde_json::Value::as_str)
                    .filter(|id| !id.is_empty())
                    .map(str::to_string);
                let mut initial_nav_committed = false;
                let _ = tokio::time::timeout(INITIAL_NAVIGATION_COMMIT_WAIT, async {
                    loop {
                        match events.recv().await {
                            Ok(ev) => match &*ev {
                                CdpLifecycleEvent::FrameNavigated {
                                    session_id: event_session_id,
                                    is_main_frame: true,
                                    frame_id,
                                    ..
                                } if event_session_id.as_deref() == Some(page_sid.as_str()) => {
                                    if initial_frame_id.is_none() {
                                        initial_frame_id = frame_id.clone();
                                    }
                                    initial_nav_committed = true;
                                    break;
                                }
                                _ => {}
                            },
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        }
                    }
                })
                .await;
                if !initial_nav_committed {
                    pending_initial_loader_id = nav_loader_id;
                }
            }
            Err(err) => warn!(error = %err, "Initial managed navigation failed"),
        }
        if producer.input_geometry_trusted() {
            let geom = producer.geometry().await;
            let _ = producer
                .cdp_client
                .send_command(
                    "Emulation.setDeviceMetricsOverride",
                    Some(serde_json::json!({
                        "width": geom.css_width.round() as u32,
                        "height": geom.css_height.round() as u32,
                        "deviceScaleFactor": geom.dpr,
                        "mobile": false,
                    })),
                    Some(&page_sid),
                )
                .await;
        }
    }
    crate::browser_host::selection::ensure_session_navigation_watcher_with_initial(
        state,
        session_id,
        &producer.cdp_client,
        &page_sid,
        initial_frame_id.as_deref(),
        pending_initial_loader_id.as_deref(),
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
    pending_frame: Option<(TrackedBhjfFrame, Instant)>,
    min_delivery_interval: Duration,
    last_delivery: Instant,
    send_suspended: bool,
    estimator: ViewerDeliveryEstimator,
    pub total_delivered: usize,
    pub total_acked: usize,
    pub total_discarded: usize,
}

impl ViewerCreditController {
    pub fn new(subscription_epoch: String) -> Self {
        Self::with_min_interval(subscription_epoch, MIN_DELIVERY_INTERVAL)
    }

    pub fn with_min_interval(subscription_epoch: String, min_interval: Duration) -> Self {
        Self::with_min_interval_at(subscription_epoch, min_interval, Instant::now())
    }

    pub fn with_min_interval_at(
        subscription_epoch: String,
        min_interval: Duration,
        now: Instant,
    ) -> Self {
        let effective_interval = if min_interval.is_zero() {
            Duration::from_millis(1)
        } else {
            min_interval
        };
        let last_delivery = now.checked_sub(effective_interval).unwrap_or(now);
        Self {
            estimator: ViewerDeliveryEstimator::new(subscription_epoch.clone(), now),
            subscription_epoch,
            outstanding: HashMap::with_capacity(MAX_OUTSTANDING_PER_VIEWER),
            pending_frame: None,
            min_delivery_interval: effective_interval,
            last_delivery,
            send_suspended: false,
            total_delivered: 0,
            total_acked: 0,
            total_discarded: 0,
        }
    }

    pub fn min_delivery_interval(&self) -> Duration {
        self.min_delivery_interval
    }

    /// Runtime pacing update from the adaptive controller; never below 1ms.
    pub fn set_min_delivery_interval(&mut self, interval: Duration) {
        self.min_delivery_interval = interval.max(Duration::from_millis(1));
    }

    /// A stalled viewer receives no new sends; pending stays replaceable and bounded.
    pub fn set_send_suspended(&mut self, suspended: bool) {
        self.send_suspended = suspended;
    }

    pub fn outstanding_count(&self) -> usize {
        self.outstanding.len()
    }

    pub fn outstanding_bytes(&self) -> usize {
        self.outstanding
            .values()
            .map(|(frame, _)| frame.byte_length())
            .sum()
    }

    pub fn oldest_outstanding_age_at(&self, now: Instant) -> Duration {
        self.outstanding
            .values()
            .map(|(_, sent_at)| now.saturating_duration_since(*sent_at))
            .max()
            .unwrap_or(Duration::ZERO)
    }

    pub fn has_pending(&self) -> bool {
        self.pending_frame.is_some()
    }

    pub fn estimator(&self) -> &ViewerDeliveryEstimator {
        &self.estimator
    }

    pub fn snapshot(&mut self, browser_session_id: &str, viewer_id: &str) -> ViewerDeliverySnapshot {
        self.snapshot_at(browser_session_id, viewer_id, Instant::now())
    }

    pub fn snapshot_at(
        &mut self,
        browser_session_id: &str,
        viewer_id: &str,
        now: Instant,
    ) -> ViewerDeliverySnapshot {
        if let Some((ctrl_bytes, ctrl_dur)) =
            global_stream_diagnostics().take_pending_control_write(&self.subscription_epoch)
        {
            self.record_control_write(ctrl_bytes, ctrl_dur);
        }
        let out_frames = self.outstanding.len();
        let out_bytes = self.outstanding_bytes();
        let oldest = self.oldest_outstanding_age_at(now);
        let has_pending = self.pending_frame.is_some();
        self.estimator.snapshot(
            browser_session_id,
            viewer_id,
            out_frames,
            out_bytes,
            oldest,
            has_pending,
            now,
        )
    }

    pub fn publish_diagnostics(&mut self, browser_session_id: &str, viewer_id: &str) -> ViewerSample {
        let snap = self.snapshot(browser_session_id, viewer_id);
        let sample = ViewerSample::from(&snap);
        global_stream_diagnostics().update_viewer_snapshot(snap);
        sample
    }

    /// Tries to admit an incoming frame for immediate transmission, or stores it as pending.
    /// Returns `Some(frame_to_send)` if credit and rate governor permit immediate send.
    pub fn on_incoming_frame(&mut self, frame: TrackedBhjfFrame) -> Option<TrackedBhjfFrame> {
        self.on_incoming_frame_at(frame, Instant::now())
    }

    pub fn on_incoming_frame_at(
        &mut self,
        frame: TrackedBhjfFrame,
        now: Instant,
    ) -> Option<TrackedBhjfFrame> {
        self.on_incoming_frame_with_writer_state_at(frame, false, now)
    }

    pub fn on_incoming_frame_with_writer_state_at(
        &mut self,
        frame: TrackedBhjfFrame,
        writer_frame_busy: bool,
        now: Instant,
    ) -> Option<TrackedBhjfFrame> {
        let header = match frame.header() {
            Some(h) => h.clone(),
            None => match unpack_bhjf_frame(frame.data()) {
                Ok((h, _)) => h,
                Err(_) => return None,
            },
        };
        self.estimator.on_frame_candidate(
            &header.producer_run,
            header.native_capture_time_unix_ms(),
            frame.server_received_unix_ms(),
            now,
        );

        if !writer_frame_busy
            && !self.send_suspended
            && self.outstanding.len() < MAX_OUTSTANDING_PER_VIEWER
            && now.saturating_duration_since(self.last_delivery) >= self.min_delivery_interval
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
            self.estimator.on_frame_admitted(
                Some(Duration::ZERO),
                self.outstanding.len() >= MAX_OUTSTANDING_PER_VIEWER,
            );
            Some(frame)
        } else {
            let credit_blocked =
                writer_frame_busy || self.send_suspended || self.outstanding.len() >= MAX_OUTSTANDING_PER_VIEWER;
            let replaced_pending = self.pending_frame.is_some();
            if credit_blocked {
                self.estimator.record_credit_pending_hold(replaced_pending);
            } else {
                self.estimator.record_intentional_pacing_hold();
            }
            // Buffer latest frame as pending (replacing any prior pending frame)
            self.pending_frame = Some((frame, now));
            None
        }
    }

    /// Checks if a buffered pending frame can now be delivered (e.g. rate governor interval elapsed).
    pub fn check_flush_pending(&mut self) -> Option<TrackedBhjfFrame> {
        self.check_flush_pending_at(Instant::now())
    }

    pub fn check_flush_pending_at(&mut self, now: Instant) -> Option<TrackedBhjfFrame> {
        self.check_flush_pending_with_writer_state_at(false, now)
    }

    pub fn check_flush_pending_with_writer_state_at(
        &mut self,
        writer_frame_busy: bool,
        now: Instant,
    ) -> Option<TrackedBhjfFrame> {
        if !writer_frame_busy
            && !self.send_suspended
            && self.outstanding.len() < MAX_OUTSTANDING_PER_VIEWER
            && now.saturating_duration_since(self.last_delivery) >= self.min_delivery_interval
        {
            if let Some((pending, queued_at)) = self.pending_frame.take() {
                let header = match pending.header() {
                    Some(h) => Some(h.clone()),
                    None => unpack_bhjf_frame(pending.data()).ok().map(|(h, _)| h),
                };
                if let Some(header) = header {
                    let key = OutstandingKey {
                        subscription_epoch: self.subscription_epoch.clone(),
                        producer_run: header.producer_run,
                        viewport_epoch: header.viewport_epoch,
                        frame_seq: header.frame_seq,
                    };
                    self.outstanding.insert(key, (pending.clone(), now));
                    self.last_delivery = now;
                    self.total_delivered += 1;
                    let queued_dur = now.saturating_duration_since(queued_at);
                    self.estimator.on_frame_admitted(
                        Some(queued_dur),
                        self.outstanding.len() >= MAX_OUTSTANDING_PER_VIEWER,
                    );
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
        self.on_credit_return_with_feedback_at(
            control_sub,
            producer_run,
            viewport_epoch,
            frame_seq,
            is_discard,
            None,
            None,
            Instant::now(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn on_credit_return_with_feedback_at(
        &mut self,
        control_sub: &str,
        producer_run: &str,
        viewport_epoch: &str,
        frame_seq: &str,
        is_discard: bool,
        discard_reason: Option<DiscardReason>,
        decode_ms: Option<f64>,
        now: Instant,
    ) -> Option<TrackedBhjfFrame> {
        self.on_credit_return_with_writer_state_at(
            control_sub,
            producer_run,
            viewport_epoch,
            frame_seq,
            is_discard,
            discard_reason,
            decode_ms,
            false,
            now,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn on_credit_return_with_writer_state_at(
        &mut self,
        control_sub: &str,
        producer_run: &str,
        viewport_epoch: &str,
        frame_seq: &str,
        is_discard: bool,
        discard_reason: Option<DiscardReason>,
        decode_ms: Option<f64>,
        writer_frame_busy: bool,
        now: Instant,
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

        if let Some((frame, admitted_at)) = self.outstanding.remove(&key) {
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

            let service_duration = now.saturating_duration_since(admitted_at);
            self.estimator.on_credit_completed(
                producer_run,
                frame.byte_length(),
                service_duration,
                is_discard,
                discard_reason,
                decode_ms,
            );

            return self.check_flush_pending_with_writer_state_at(writer_frame_busy, now);
        }

        None
    }

    pub fn record_heartbeat_telemetry(&mut self, telemetry: HeartbeatTelemetry) {
        self.estimator.record_heartbeat_telemetry(telemetry);
    }

    pub fn record_broadcast_lag(&mut self, lagged_frames: u64) {
        self.estimator.record_broadcast_lag(lagged_frames);
        global_stream_diagnostics()
            .broadcast_lagged_frames
            .fetch_add(lagged_frames, Ordering::Relaxed);
    }

    pub fn record_frame_write(
        &mut self,
        bytes: usize,
        write_duration: Duration,
        local_send_unix_ms: u64,
    ) {
        self.estimator
            .record_frame_write(bytes, write_duration, local_send_unix_ms);
        global_stream_diagnostics()
            .delivered_frames
            .fetch_add(1, Ordering::Relaxed);
        global_stream_diagnostics()
            .last_local_send_unix_ms
            .store(local_send_unix_ms, Ordering::Relaxed);
    }

    pub fn record_audio_write(&mut self, bytes: usize, write_duration: Duration) {
        self.estimator.record_audio_write(bytes, write_duration);
    }

    pub fn record_control_write(&mut self, bytes: usize, write_duration: Duration) {
        self.estimator.record_control_write(bytes, write_duration);
    }

    /// Returns whether any outstanding frame has exceeded OUTSTANDING_TIMEOUT (> 30s).
    pub fn prune_timeouts(&mut self) -> bool {
        self.prune_timeouts_at(Instant::now())
    }

    pub fn prune_timeouts_at(&mut self, now: Instant) -> bool {
        let oldest = self.oldest_outstanding_age_at(now);
        self.estimator.advance_window_if_due(
            self.outstanding.len(),
            oldest,
            self.pending_frame.is_some(),
            now,
        );
        oldest > OUTSTANDING_TIMEOUT
    }
}

/// RAII permit for active global viewer capacity, honoring effective configured `max_viewers`.
pub struct ViewerPermit(&'static AtomicUsize);

impl ViewerPermit {
    pub fn try_acquire() -> Result<Self, StatusCode> {
        Self::try_acquire_with_cap(MAX_GLOBAL_VIEWERS)
    }

    pub fn try_acquire_with_cap(max_viewers: usize) -> Result<Self, StatusCode> {
        Self::try_acquire_in(&ACTIVE_VIEWERS, max_viewers)
    }

    /// Admission against an explicit counter, so capacity semantics can be exercised without
    /// the process-global `ACTIVE_VIEWERS` shared by concurrently running live handlers.
    pub fn try_acquire_in(
        counter: &'static AtomicUsize,
        max_viewers: usize,
    ) -> Result<Self, StatusCode> {
        let effective_cap = max_viewers.clamp(1, 16);
        let current = counter.fetch_add(1, Ordering::SeqCst);
        if current >= effective_cap {
            counter.fetch_sub(1, Ordering::SeqCst);
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
        Ok(Self(counter))
    }
}

impl Drop for ViewerPermit {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
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

/// Write-time admissibility of a queued audio chunk for one viewer subscription: current document
/// authority, live audio source, an explicitly allowed (never unknown) viewer gate, and no
/// suppression transition since the chunk was admitted (`admitted_gen`), so a quick mute/unmute
/// still drops what was queued before it. An already-started write cannot be recalled.
pub fn audio_chunk_admissible(
    producer: &ScreencastProducer,
    subscription_epoch: &str,
    admitted_gen: u64,
    audio_seq: u64,
    chunk_audio_run: &str,
    doc_epoch: u64,
) -> bool {
    producer.audio_doc_authority().is_admissible(doc_epoch)
        && Uuid::parse_str(chunk_audio_run).is_ok_and(|chunk_run| {
            producer.audio_slot_admissible(subscription_epoch, admitted_gen, chunk_run, audio_seq)
        })
}

/// Effective configured `max_viewers` (clamped like the permit itself).
async fn configured_max_viewers(state: &AppState) -> usize {
    state
        .config
        .read()
        .await
        .server
        .browser
        .budgets
        .max_viewers
        .clamp(1, 16)
}

/// Registers a media/control socket into its viewer pair. The pair owns ONE global viewer
/// permit: the first socket to arrive acquires it, the mate joins under it.
async fn register_pair(
    state: &AppState,
    att_manager: &AttachmentManager,
    admitted: &AdmittedAttachment,
) -> Result<PairRegistration, Response> {
    let max_viewers = configured_max_viewers(state).await;
    att_manager
        .register_pair_connection(admitted, || {
            ViewerPermit::try_acquire_with_cap(max_viewers)
                .map_err(|_| AttachmentError::ViewerCapacityExceeded(max_viewers))
        })
        .await
        .map_err(|err| match err {
            AttachmentError::ViewerCapacityExceeded(max) => browser_error_response(
                StatusCode::TOO_MANY_REQUESTS,
                "browserBusy",
                &format!("global active viewer capacity reached ({max})"),
            ),
            other => browser_error_response(StatusCode::FORBIDDEN, "pairingFailed", &other.to_string()),
        })
}

/// The ticket's exact session identity must still be a live `Running` session.
async fn attachment_session_live(admitted: &AdmittedAttachment) -> Result<(), Response> {
    global_session_registry()
        .verify_attachment_identity(
            admitted.browser_session_id.as_deref().unwrap_or_default(),
            &admitted.principal,
            admitted.is_dev,
            admitted.profile_epoch,
            &admitted.browser_incarnation,
        )
        .await
        .map_err(Response::from)
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

    // Live session identity: a ticket issued before a close can never be consumed after it.
    if let Err(resp) = attachment_session_live(&admitted).await {
        return resp;
    }

    // The pair's one global permit (capacity) is acquired by the first socket of the pair.
    let PairRegistration { connection_id: conn_id, cancel_token, permit } =
        match register_pair(&state, att_manager, &admitted).await {
            Ok(registration) => registration,
            Err(resp) => return resp,
        };
    // A close that began after the check above already revoked the sockets it could see, so
    // re-check now that this socket is visible to it.
    if let Err(resp) = attachment_session_live(&admitted).await {
        att_manager.unregister_connection(conn_id).await;
        return resp;
    }

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

    // Only an attached producer makes the pair ready (and control input available). A failed
    // attach releases the pair's permit now instead of holding capacity behind an inert socket.
    let pair_alive = match &producer {
        Some(_) => att_manager.mark_media_attached(conn_id).await,
        None => att_manager.fail_media_attach(conn_id).await,
    };
    if !pair_alive {
        att_manager.unregister_connection(conn_id).await;
        return browser_error_response(
            StatusCode::UNAUTHORIZED,
            "invalidSession",
            "viewer pair ended during setup",
        );
    }
    // Without a producer this socket only reports "unavailable": it must not keep holding the
    // pair's capacity. (A producer-less pair can no longer be joined by a control socket.)
    let permit = producer.is_some().then_some(permit);

    let configured_fps = state
        .config
        .read()
        .await
        .server
        .browser
        .budgets
        .frame_rate_fps
        .clamp(1, 30);
    let min_delivery_interval = Duration::from_secs_f64(1.0 / (configured_fps as f64));

    let principal = adm.principal.clone();
    // Echo only fixed subprotocol with frame/message bounds
    ws.protocols([MEDIA_SUBPROTOCOL])
        .max_message_size(MAX_MEDIA_CONTROL_BYTES)
        .max_frame_size(MAX_MEDIA_CONTROL_BYTES)
        .on_upgrade(move |socket| {
            run_media_session(
                socket,
                principal,
                session_id,
                viewer_id,
                sub_epoch,
                producer,
                min_delivery_interval,
                effective_deadline,
                cancel_token,
                conn_id,
                permit,
            )
        })
}

struct AxumMediaSink {
    sink: futures_util::stream::SplitSink<WebSocket, AxumWsMessage>,
}

impl MediaPacketSink for AxumMediaSink {
    fn send_packet(
        &mut self,
        packet: OutboundMediaPacket,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), &'static str>> + Send + '_>> {
        Box::pin(async move {
            let msg = match packet {
                OutboundMediaPacket::Binary(data) => AxumWsMessage::Binary(data),
                OutboundMediaPacket::Text(text) => AxumWsMessage::Text(text.into()),
            };
            self.sink.send(msg).await.map_err(|_| "transport_error")
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ViewerQualityDigest {
    quality_rev: u64,
    target_version: u64,
    preference: crate::browser_host::capture_tier::QualityPreference,
    viewer_tier: crate::browser_host::capture_tier::CaptureTier,
    fps: u32,
    audio_suppressed: bool,
    audio_reason: Option<crate::browser_host::protocol::StreamAudioReason>,
    viewer_visible: bool,
    has_producer: bool,
}

fn compute_viewer_quality_digest(
    producer: Option<&Arc<ScreencastProducer>>,
    subscription_epoch: &str,
    viewer_visible: bool,
) -> ViewerQualityDigest {
    match producer {
        Some(p) => {
            let quality_rev = p.quality_revision();
            let target = p.capture_snapshot();
            let target_version = target.version;
            let preference = p
                .viewer_quality_preference(subscription_epoch)
                .unwrap_or(crate::browser_host::capture_tier::QualityPreference::Auto);
            let directives = p.viewer_directives(subscription_epoch);
            let (viewer_tier, fps, audio_suppressed, audio_reason) = match directives {
                Some(d) => {
                    let fps = (1.0 / d.min_delivery_interval.as_secs_f64())
                        .round()
                        .clamp(1.0, 30.0) as u32;
                    let (suppressed, reason) = match d.audio {
                        crate::browser_host::adaptive_stream_controller::AudioGate::Allowed => {
                            (false, None)
                        }
                        crate::browser_host::adaptive_stream_controller::AudioGate::Suppressed(
                            crate::browser_host::adaptive_stream_controller::AudioSuppression::Muted,
                        ) => (true, Some(crate::browser_host::protocol::StreamAudioReason::Muted)),
                        crate::browser_host::adaptive_stream_controller::AudioGate::Suppressed(
                            crate::browser_host::adaptive_stream_controller::AudioSuppression::Constrained,
                        ) => (true, Some(crate::browser_host::protocol::StreamAudioReason::Bandwidth)),
                        crate::browser_host::adaptive_stream_controller::AudioGate::Suppressed(
                            crate::browser_host::adaptive_stream_controller::AudioSuppression::Hidden,
                        ) => (true, Some(crate::browser_host::protocol::StreamAudioReason::Hidden)),
                        crate::browser_host::adaptive_stream_controller::AudioGate::Suppressed(
                            crate::browser_host::adaptive_stream_controller::AudioSuppression::Stalled,
                        ) => (true, Some(crate::browser_host::protocol::StreamAudioReason::Stalled)),
                    };
                    (d.tier, fps, suppressed, reason)
                }
                None => (
                    target.tier,
                    target.fps.clamp(1, 30),
                    true,
                    Some(crate::browser_host::protocol::StreamAudioReason::Muted),
                ),
            };
            ViewerQualityDigest {
                quality_rev,
                target_version,
                preference,
                viewer_tier,
                fps,
                audio_suppressed,
                audio_reason,
                viewer_visible,
                has_producer: true,
            }
        }
        None => ViewerQualityDigest {
            quality_rev: 0,
            target_version: 1,
            preference: crate::browser_host::capture_tier::QualityPreference::Auto,
            viewer_tier: crate::browser_host::capture_tier::CaptureTier::Constrained,
            fps: 1,
            audio_suppressed: true,
            audio_reason: Some(crate::browser_host::protocol::StreamAudioReason::Muted),
            viewer_visible,
            has_producer: false,
        },
    }
}

/// Digest revision of a quality event built from state that never settled: equals no live
/// revision, so the next dirty check rebuilds it.
const UNSETTLED_QUALITY_REVISION: u64 = u64::MAX;

async fn emit_stream_quality_if_changed(
    producer: Option<&Arc<ScreencastProducer>>,
    subscription_epoch: &str,
    writer_handle: &MediaWriterHandle,
    viewer_visible: bool,
    last_digest: &mut Option<ViewerQualityDigest>,
) {
    let mut current_digest = compute_viewer_quality_digest(producer, subscription_epoch, viewer_visible);
    if last_digest.as_ref() != Some(&current_digest) {
        // The memoized digest is bound to the revision the event is provably coherent with, not to
        // whatever the revision is by the time the digest was computed; an unsettled read is never
        // memoized (sentinel), so the next dirty check rebuilds it.
        let quality = match producer {
            Some(p) => {
                let snapshot = p.stream_quality_snapshot(subscription_epoch).await;
                current_digest.quality_rev = snapshot.revision.unwrap_or(UNSETTLED_QUALITY_REVISION);
                snapshot.event
            }
            None => crate::browser_host::protocol::BrowserStreamQuality {
                kind: "streamQuality".to_string(),
                subscription_epoch: subscription_epoch.to_string(),
                preference: crate::browser_host::capture_tier::QualityPreference::Auto,
                producer_run: Uuid::nil().to_string(),
                capture_version: "1".to_string(),
                shared_tier: crate::browser_host::capture_tier::CaptureTier::Constrained,
                viewer_tier: crate::browser_host::capture_tier::CaptureTier::Constrained,
                fps: 1,
                jpeg_quality: 10,
                scale: 1.0,
                image_width: 64,
                image_height: 64,
                audio_suppressed: true,
                audio_reason: Some(crate::browser_host::protocol::StreamAudioReason::Muted),
                status: crate::browser_host::protocol::StreamQualityStatus::Unavailable,
            },
        };

        if let Ok(json) = serde_json::to_string(&quality) {
            writer_handle.enqueue_control_text(json);
            *last_digest = Some(current_digest);
        }
    }
}


#[allow(clippy::too_many_arguments)]
async fn run_media_session(
    socket: WebSocket,
    principal: String,
    session_id: String,
    viewer_id: String,
    subscription_epoch: String,
    producer: Option<Arc<ScreencastProducer>>,
    min_delivery_interval: Duration,
    effective_deadline: Option<DateTime<Utc>>,
    cancel_token: CancellationToken,
    conn_id: Uuid,
    _permit: Option<PairPermit>,
) {
    let (ws_sink, mut ws_stream) = socket.split();
    let controller = Arc::new(Mutex::new(ViewerCreditController::with_min_interval(
        subscription_epoch.clone(),
        min_delivery_interval,
    )));
    {
        let mut ctrl = controller.lock().await;
        let init_snap = ctrl.snapshot(&session_id, &viewer_id);
        global_stream_diagnostics().register_viewer_snapshot_for_owner(&principal, init_snap);
    }
    let mut viewer_visible = true;
    let session_writer_cancel = cancel_token.child_token();
    let doc_auth_rx = producer
        .as_ref()
        .map(|prod| prod.subscribe_audio_doc_authority());
    let prod_for_writer = producer.clone();
    let sub_for_writer = subscription_epoch.clone();
    let (writer_handle, mut writer_events, writer_join) = spawn_media_writer(
        AxumMediaSink { sink: ws_sink },
        session_writer_cancel.clone(),
        doc_auth_rx,
        // Evaluated right before each audio write using the slot's OWN admitted generation & seq.
        move |audio_run, doc_epoch, admitted_gen, audio_seq| {
            prod_for_writer.as_ref().is_none_or(|p| {
                audio_chunk_admissible(
                    p,
                    &sub_for_writer,
                    admitted_gen,
                    audio_seq,
                    audio_run,
                    doc_epoch,
                )
            })
        },
    );

    let mut audio_drain_barrier = producer.as_ref().map(|p| p.audio_drain_barrier());
    let (mut frame_rx, mut audio_rx) = if let Some(prod) = &producer {
        prod.register_viewer_demand(&viewer_id, &subscription_epoch, true)
            .await;
        if let Some(d) = prod.viewer_directives(&subscription_epoch) {
            controller
                .lock()
                .await
                .set_min_delivery_interval(d.min_delivery_interval);
        }
        // Deliver current valid cached frame on attach if present
        if let Some(cached) = prod.get_cached_frame().await {
            let to_send = {
                let mut ctrl = controller.lock().await;
                ctrl.on_incoming_frame_with_writer_state_at(
                    cached,
                    writer_handle.is_frame_busy(),
                    Instant::now(),
                )
            };
            if let Some(to_send) = to_send {
                let _ = writer_handle.enqueue_admitted_frame(to_send);
            }
        }
        (Some(prod.subscribe_frames()), Some(prod.subscribe_audio()))
    } else {
        (None, None)
    };
    let mut timeout_ticker = interval(Duration::from_secs(1));
    let mut flush_ticker = interval(Duration::from_millis(15));
    let mut media_ctrl_count = 0usize;
    // Gate generation last observed; any suppression transition (even a quick mute/unmute)
    // drops audio queued before it, so pre-mute chunks are never replayed after unmute.
    let mut last_audio_gen = producer
        .as_ref()
        .and_then(|p| p.viewer_audio_generation(&subscription_epoch))
        .unwrap_or(0);
    let mut last_pref_apply =
        Instant::now().checked_sub(Duration::from_secs(1)).unwrap_or_else(Instant::now);
    let mut last_mute_apply =
        Instant::now().checked_sub(Duration::from_secs(1)).unwrap_or_else(Instant::now);
    let mut pending_pref: Option<crate::browser_host::capture_tier::QualityPreference> = None;
    let mut pending_unmute: Option<bool> = None;
    let mut last_digest: Option<ViewerQualityDigest> = None;
    let mut media_rate_window = Instant::now();
    let deadline_sleep = match effective_deadline {
        Some(dl) => {
            let duration = dl.signed_duration_since(Utc::now());
            if duration.num_milliseconds() <= 0 {
                session_writer_cancel.cancel();
                let _ = writer_join.await;
                global_stream_diagnostics().remove_viewer_snapshot(&subscription_epoch);
                return;
            }
            Some(sleep(Duration::from_millis(
                duration.num_milliseconds() as u64,
            )))
        }
        None => None,
    };
    tokio::pin!(deadline_sleep);
    emit_stream_quality_if_changed(
        producer.as_ref(),
        &subscription_epoch,
        &writer_handle,
        viewer_visible,
        &mut last_digest,
    )
    .await;


    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                debug!(viewer_id = %viewer_id, "media session cancelled (auth revoke or pair teardown)");
                break;
            }
            _ = async {
                if let Some(sleep_fut) = deadline_sleep.as_mut().as_pin_mut() {
                    sleep_fut.await;
                } else {
                    futures_util::future::pending::<()>().await;
                }
            } => {
                warn!(viewer_id = %viewer_id, "media session reached absolute auth deadline; closing");
                break;
            }
            writer_ev = writer_events.recv() => {
                match writer_ev {
                    Some(MediaWriterEvent::FrameSent { byte_len, write_duration, local_send_unix_ms }) => {
                        let flush_frame = {
                            let mut ctrl = controller.lock().await;
                            ctrl.record_frame_write(byte_len, write_duration, local_send_unix_ms);
                            ctrl.check_flush_pending_with_writer_state_at(
                                writer_handle.is_frame_busy(),
                                Instant::now(),
                            )
                        };
                        if let Some(flush_frame) = flush_frame {
                            let _ = writer_handle.enqueue_admitted_frame(flush_frame);
                        }
                    }
                    Some(MediaWriterEvent::AudioSent { byte_len, write_duration }) => {
                        let mut ctrl = controller.lock().await;
                        ctrl.record_audio_write(byte_len, write_duration);
                    }
                    Some(MediaWriterEvent::ControlSent { byte_len, write_duration }) => {
                        let mut ctrl = controller.lock().await;
                        ctrl.record_control_write(byte_len, write_duration);
                    }
                    Some(MediaWriterEvent::TransportFailed(reason)) => {
                        // "cancelled": the session token already ended the pair; any other reason is a real write failure.
                        if reason == "cancelled" {
                            debug!(viewer_id = %viewer_id, "media writer stopped by session cancellation");
                        } else {
                            warn!(viewer_id = %viewer_id, reason, "media writer transport failed; closing media session");
                        }
                        break;
                    }
                    None => {
                        debug!(viewer_id = %viewer_id, "media writer ended; closing media session");
                        break;
                    }
                }
            }
            _ = timeout_ticker.tick() => {
                let (timed_out, directives) = {
                    let mut ctrl = controller.lock().await;
                    let timed_out = ctrl.prune_timeouts();
                    let sample = ctrl.publish_diagnostics(&session_id, &viewer_id);
                    let directives = producer.as_ref().and_then(|p| {
                        p.adaptive_report(&subscription_epoch, viewer_visible, sample)
                    });
                    if let Some(d) = &directives {
                        ctrl.set_min_delivery_interval(d.min_delivery_interval);
                        ctrl.set_send_suspended(d.send_suspended);
                    }
                    (timed_out, directives)
                };
                if directives.is_some_and(|d| !d.audio.is_allowed()) {
                    writer_handle.clear_audio();
                }
                emit_stream_quality_if_changed(
                    producer.as_ref(),
                    &subscription_epoch,
                    &writer_handle,
                    viewer_visible,
                    &mut last_digest,
                )
                .await;
                if timed_out {
                    warn!(subscription_epoch = %subscription_epoch, "outstanding frame exceeded 30s timeout; tearing down stalled subscription");
                    break;
                }
            }
            _ = flush_ticker.tick() => {
                let now = Instant::now();
                // Deferred (coalesced) preference/unmute applications; status is re-emitted only
                // when one actually applied, not on every 15ms tick.
                let mut applied_pending_control = false;
                if let Some(pref) = pending_pref {
                    if now.duration_since(last_pref_apply) >= Duration::from_millis(250) {
                        last_pref_apply = now;
                        pending_pref = None;
                        applied_pending_control = true;
                        if let Some(prod) = &producer {
                            prod.set_viewer_quality_preference(&subscription_epoch, pref);
                        }
                    }
                }
                if let Some(m) = pending_unmute {
                    if now.duration_since(last_mute_apply) >= Duration::from_millis(250) {
                        last_mute_apply = now;
                        pending_unmute = None;
                        applied_pending_control = true;
                        if let Some(prod) = &producer {
                            prod.set_viewer_muted(&subscription_epoch, m);
                        }
                    }
                }

                if let Some(generation) = producer
                    .as_ref()
                    .and_then(|p| p.viewer_audio_generation(&subscription_epoch))
                {
                    if generation != last_audio_gen {
                        last_audio_gen = generation;
                        writer_handle.clear_audio();
                    }
                }
                let flush_frame = {
                    let mut ctrl = controller.lock().await;
                    ctrl.check_flush_pending_with_writer_state_at(
                        writer_handle.is_frame_busy(),
                        Instant::now(),
                    )
                };
                if let Some(flush_frame) = flush_frame {
                    let _ = writer_handle.enqueue_admitted_frame(flush_frame);
                }
                if applied_pending_control {
                    emit_stream_quality_if_changed(
                        producer.as_ref(),
                        &subscription_epoch,
                        &writer_handle,
                        viewer_visible,
                        &mut last_digest,
                    )
                    .await;
                }
            }
            // Incoming broadcast frame from screencast producer
            frame_res = async {
                match frame_rx.as_mut() {
                    Some(rx) => Some(rx.recv().await),
                    None => {
                        sleep(Duration::from_secs(10)).await;
                        None
                    }
                }
            } => {
                match frame_res {
                    Some(Ok(frame)) => {
                        let to_send = {
                            let mut ctrl = controller.lock().await;
                            ctrl.on_incoming_frame_with_writer_state_at(
                                frame,
                                writer_handle.is_frame_busy(),
                                Instant::now(),
                            )
                        };
                        if let Some(to_send) = to_send {
                            let _ = writer_handle.enqueue_admitted_frame(to_send);
                        }
                        // O(1) dirty comparison: avoid recomputing/allocating unless quality revision changed
                        if producer.as_ref().is_some_and(|p| {
                            last_digest.map_or(true, |d| d.quality_rev != p.quality_revision())
                        }) {
                            emit_stream_quality_if_changed(
                                producer.as_ref(),
                                &subscription_epoch,
                                &writer_handle,
                                viewer_visible,
                                &mut last_digest,
                            )
                            .await;
                        }
                    }
                    Some(Err(tokio::sync::broadcast::error::RecvError::Lagged(n))) => {
                        let mut ctrl = controller.lock().await;
                        ctrl.record_broadcast_lag(n);
                    }
                    Some(Err(tokio::sync::broadcast::error::RecvError::Closed)) => {
                        frame_rx = None;
                    }
                    None => {}
                }
            }
            // Incoming broadcast audio chunk from screencast producer
            audio_res = async {
                let Some(rx) = audio_rx.as_mut() else {
                    return futures_util::future::pending::<Option<Result<crate::browser_host::protocol::ProducerAudioChunk, tokio::sync::broadcast::error::RecvError>>>().await;
                };
                loop {
                    // Test barrier: park before taking anything off the receiver while held, and
                    // re-park if it engages while waiting (recv is cancel-safe: nothing is consumed).
                    if let Some(barrier) = audio_drain_barrier.as_mut() {
                        if barrier.wait_for(|held| !*held).await.is_err() {
                            audio_drain_barrier = None;
                            continue;
                        }
                    }
                    let engaged = async {
                        match audio_drain_barrier.as_mut() {
                            Some(barrier) => {
                                let _ = barrier.wait_for(|held| *held).await;
                            }
                            None => futures_util::future::pending::<()>().await,
                        }
                    };
                    tokio::select! {
                        biased;
                        _ = engaged => continue,
                        received = rx.recv() => break Some(received),
                    }
                }
            } => {
                match audio_res {
                    Some(Ok(chunk)) => {
                        if !viewer_visible {
                            continue;
                        }
                        let (admitted_gen, seq) = if let Some(prod) = &producer {
                            let audio_run = prod.audio_source_run().map(|u| u.to_string());
                            if audio_run.as_deref() != Some(chunk.audio_run.as_str())
                                || !prod.audio_doc_authority().is_admissible(chunk.doc_epoch)
                            {
                                continue;
                            }
                            let Some((gate, admitted_gen, watermark)) =
                                prod.viewer_audio_gate_info(&subscription_epoch)
                            else {
                                continue;
                            };
                            if !gate.is_allowed() {
                                writer_handle.clear_audio();
                                continue;
                            }
                            let seq: u64 = chunk.audio_seq.parse().unwrap_or(0);
                            let chunk_run = Uuid::parse_str(&chunk.audio_run).ok();
                            if watermark.suppresses(chunk_run, seq) {
                                prod.ledger.audio_dropped_by_boundary.fetch_add(1, Ordering::Relaxed);
                                continue;
                            }
                            (admitted_gen, seq)
                        } else {
                            (0, 0)
                        };
                        let _ = writer_handle.enqueue_latest_audio(&subscription_epoch, chunk, admitted_gen, seq);
                    }
                    Some(Err(tokio::sync::broadcast::error::RecvError::Lagged(n))) => {
                        let mut ctrl = controller.lock().await;
                        ctrl.record_broadcast_lag(n);
                    }
                    Some(Err(tokio::sync::broadcast::error::RecvError::Closed)) => {
                        audio_rx = None;
                    }
                    None => {}
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

                        let ctrl_msg = match MediaClientControlWire::parse_and_validate(&text) {
                            Ok(m) => m,
                            Err(e) => {
                                warn!(error = %e, "invalid media client control message; disconnecting");
                                break;
                            }
                        };
                        match &ctrl_msg {
                            MediaClientControlWire::FrameAck {
                                subscription_epoch: s_epoch,
                                producer_run,
                                viewport_epoch,
                                frame_seq,
                                decode_ms,
                                ..
                            } => {
                                let pending_to_send = {
                                    let mut ctrl = controller.lock().await;
                                    ctrl.on_credit_return_with_writer_state_at(
                                        s_epoch,
                                        producer_run,
                                        viewport_epoch,
                                        frame_seq,
                                        false,
                                        None,
                                        *decode_ms,
                                        writer_handle.is_frame_busy(),
                                        Instant::now(),
                                    )
                                };
                                if let Some(pending_to_send) = pending_to_send {
                                    let _ = writer_handle.enqueue_admitted_frame(pending_to_send);
                                }
                            }
                            MediaClientControlWire::FrameDiscarded {
                                subscription_epoch: s_epoch,
                                producer_run,
                                viewport_epoch,
                                frame_seq,
                                reason,
                            } => {
                                let pending_to_send = {
                                    let mut ctrl = controller.lock().await;
                                    ctrl.on_credit_return_with_writer_state_at(
                                        s_epoch,
                                        producer_run,
                                        viewport_epoch,
                                        frame_seq,
                                        true,
                                        *reason,
                                        None,
                                        writer_handle.is_frame_busy(),
                                        Instant::now(),
                                    )
                                };
                                if let Some(pending_to_send) = pending_to_send {
                                    let _ = writer_handle.enqueue_admitted_frame(pending_to_send);
                                }
                            }
                            MediaClientControlWire::Heartbeat {
                                subscription_epoch: s_epoch,
                                visible,
                                telemetry,
                            } => {
                                if s_epoch == &subscription_epoch {
                                    viewer_visible = *visible;
                                    if !viewer_visible {
                                        writer_handle.clear_queued();
                                    }
                                    {
                                        let mut ctrl = controller.lock().await;
                                        if let Some(t) = telemetry {
                                            ctrl.record_heartbeat_telemetry(*t);
                                        }
                                        ctrl.publish_diagnostics(&session_id, &viewer_id);
                                    }
                                    if let Some(prod) = &producer {
                                        prod.heartbeat(&subscription_epoch, *visible).await;
                                    }
                                    emit_stream_quality_if_changed(
                                        producer.as_ref(),
                                        &subscription_epoch,
                                        &writer_handle,
                                        viewer_visible,
                                        &mut last_digest,
                                    )
                                    .await;
                                }
                            }
                            MediaClientControlWire::QualityPreference {
                                subscription_epoch: s_epoch,
                                preference,
                            } => {
                                if s_epoch == &subscription_epoch {
                                    let now = Instant::now();
                                    if now.duration_since(last_pref_apply)
                                        >= Duration::from_millis(250)
                                    {
                                        last_pref_apply = now;
                                        pending_pref = None;
                                        if let Some(prod) = &producer {
                                            prod.set_viewer_quality_preference(
                                                &subscription_epoch,
                                                *preference,
                                            );
                                        }
                                        emit_stream_quality_if_changed(
                                            producer.as_ref(),
                                            &subscription_epoch,
                                            &writer_handle,
                                            viewer_visible,
                                            &mut last_digest,
                                        )
                                        .await;
                                    } else {
                                        pending_pref = Some(*preference);
                                    }
                                }
                            }
                            MediaClientControlWire::MuteState {
                                subscription_epoch: s_epoch,
                                muted,
                            } => {
                                if s_epoch == &subscription_epoch {
                                    let now = Instant::now();
                                    if *muted {
                                        pending_unmute = None;
                                        last_mute_apply = now;
                                        if let Some(prod) = &producer {
                                            prod.set_viewer_muted(&subscription_epoch, true);
                                        }
                                        writer_handle.clear_audio();
                                        emit_stream_quality_if_changed(
                                            producer.as_ref(),
                                            &subscription_epoch,
                                            &writer_handle,
                                            viewer_visible,
                                            &mut last_digest,
                                        )
                                        .await;
                                    } else {
                                        if now.duration_since(last_mute_apply)
                                            >= Duration::from_millis(250)
                                        {
                                            last_mute_apply = now;
                                            pending_unmute = None;
                                            if let Some(prod) = &producer {
                                                prod.set_viewer_muted(
                                                    &subscription_epoch,
                                                    false,
                                                );
                                            }
                                            emit_stream_quality_if_changed(
                                                producer.as_ref(),
                                                &subscription_epoch,
                                                &writer_handle,
                                                viewer_visible,
                                                &mut last_digest,
                                            )
                                            .await;
                                        } else {
                                            pending_unmute = Some(false);
                                        }
                                    }
                                }
                            }
                            MediaClientControlWire::Pause { subscription_epoch: s_epoch } => {
                                if s_epoch == &subscription_epoch {
                                    writer_handle.clear_queued();
                                    if let Some(prod) = &producer {
                                        prod.remove_viewer_demand(&subscription_epoch).await;
                                    }
                                    break;
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

    // Cancel bounded writer and wait for physical write cancellation/completion before exit
    session_writer_cancel.cancel();
    writer_handle.clear_queued();
    let _ = writer_join.await;

    // Cleanup viewer demand, diagnostics snapshot, and attachment connection on session exit
    global_stream_diagnostics().remove_viewer_snapshot(&subscription_epoch);
    if let Some(prod) = &producer {
        prod.remove_viewer_demand(&subscription_epoch).await;
    }
    global_attachment_manager()
        .unregister_connection(conn_id)
        .await;
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

    // Live session identity: a ticket issued before a close can never be consumed after it.
    if let Err(resp) = attachment_session_live(&admitted).await {
        return resp;
    }

    // The control socket joins (or opens) the pair under ONE global permit: it no longer
    // bypasses viewer capacity.
    let PairRegistration { connection_id: conn_id, cancel_token, permit } =
        match register_pair(&state, att_manager, &admitted).await {
            Ok(registration) => registration,
            Err(resp) => return resp,
        };
    let session_id = admitted.browser_session_id.clone().unwrap_or_default();
    let viewer_id = admitted.viewer_id.clone().unwrap_or_default();
    let mut connection_cleanup = ControlSessionCleanup {
        manager: None,
        session_id: session_id.clone(),
        viewer_id: viewer_id.clone(),
        conn_id,
        armed: true,
        fence_holder: false,
    };
    if let Err(resp) = attachment_session_live(&admitted).await {
        att_manager.unregister_connection(conn_id).await;
        connection_cleanup.armed = false;
        return resp;
    }

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
            connection_cleanup.armed = false;
            return browser_error_response(
                StatusCode::NOT_FOUND,
                "sessionNotFound",
                "browser session not found",
            );
        }
    };
    let Some(paired_rx) = att_manager.subscribe_pair(conn_id).await else {
        att_manager.unregister_connection(conn_id).await;
        connection_cleanup.armed = false;
        return browser_error_response(
            StatusCode::FORBIDDEN,
            "pairingFailed",
            "viewer pair ended during setup",
        );
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
                paired_rx,
                permit,
                connection_cleanup,
            )
        })
}

struct ControlSessionCleanup {
    manager: Option<Arc<SessionInputManager>>,
    session_id: String,
    viewer_id: String,
    conn_id: Uuid,
    armed: bool,
    fence_holder: bool,
}

impl Drop for ControlSessionCleanup {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let manager = self.manager.take();
        let session_id = self.session_id.clone();
        let viewer_id = self.viewer_id.clone();
        let conn_id = self.conn_id;
        let fence_holder = self.fence_holder;
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                let manager = match manager {
                    Some(manager) => Some(manager),
                    None => crate::api::browser_host::global_input_managers()
                        .read().await.get(&session_id).cloned(),
                };
                let cleanup = if let Some(manager) = &manager {
                    let cleanup = if fence_holder {
                        manager.fence_control_holder(&viewer_id).await
                    } else {
                        None
                    };
                    manager.discard_queued_from(conn_id).await;
                    cleanup
                } else {
                    None
                };
                global_attachment_manager().unregister_connection(conn_id).await;
                if let Some(cleanup) = cleanup {
                    match cleanup.await {
                        Ok(Ok(_)) => {}
                        Ok(Err(error)) => warn!(%viewer_id, %error, "aborted control cleanup failed"),
                        Err(error) => warn!(%viewer_id, %error, "aborted control cleanup task failed"),
                    }
                }
            });
        }
    }
}

async fn publish_control_snapshot(
    ws_sink: &mut futures_util::stream::SplitSink<WebSocket, AxumWsMessage>,
    updates: &mut watch::Receiver<ServerControlEvent>,
    paired: bool,
    effective_deadline: Option<DateTime<Utc>>,
    cancel_token: &CancellationToken,
    subscription_epoch: &str,
) -> bool {
    // Release the watch borrow before the socket await: producers never wait on
    // a slow viewer and only one latest-state slot is retained per session.
    let Ok((json, retired)) = serialize_control_snapshot(updates, paired) else {
        return false;
    };
    let json_len = json.len();
    let Some(deadline) = control_write_deadline(effective_deadline) else {
        return false;
    };
    let write_started = Instant::now();
    let sent = tokio::select! {
        biased;
        _ = cancel_token.cancelled() => false,
        result = timeout(deadline, ws_sink.send(AxumWsMessage::Text(json.into()))) => {
            matches!(result, Ok(Ok(())))
        }
    };
    if sent {
        let write_dur = Instant::now().saturating_duration_since(write_started);
        global_stream_diagnostics().record_control_write(subscription_epoch, json_len, write_dur);
    }
    sent && !retired
}

async fn handle_control_input_outcome(
    ws_sink: &mut futures_util::stream::SplitSink<WebSocket, AxumWsMessage>,
    outcome: ControlInputOutcome,
) -> bool {
    match outcome {
        ControlInputOutcome::Continue => true,
        ControlInputOutcome::ReleaseFailed(reason) => {
            if let Some(json) = input_unavailable_json(&reason) {
                let _ = timeout(WRITE_DEADLINE, ws_sink.send(AxumWsMessage::Text(json.into()))).await;
            }
            false
        }
        ControlInputOutcome::DispatchFailed => {
            let status = ServerControlEvent::Status {
                input_available: false,
                unavailable_reason: Some("nativeInputDispatchFailed".into()),
            };
            if let Ok(json) = serde_json::to_string(&status) {
                let _ = timeout(WRITE_DEADLINE, ws_sink.send(AxumWsMessage::Text(json.into()))).await;
            }
            false
        }
    }
}

enum ControlSelectTurn<M> {
    Cancelled,
    Deadline,
    PairChanged(Result<(), watch::error::RecvError>),
    Update(Result<(), watch::error::RecvError>),
    InputOutcome(ControlInputOutcome),
    WsMessage(Option<M>),
}

async fn poll_control_select_turn<S, M, F>(
    initial_update: bool,
    prefer_input: bool,
    cancel_token: &CancellationToken,
    mut deadline_sleep: Pin<&mut Option<tokio::time::Sleep>>,
    paired_rx: &mut watch::Receiver<bool>,
    updates: &mut watch::Receiver<ServerControlEvent>,
    active_input: &mut Option<Pin<Box<F>>>,
    ws_stream: &mut S,
) -> ControlSelectTurn<M>
where
    S: futures_util::Stream<Item = M> + Unpin,
    F: Future<Output = ControlInputOutcome> + Send + ?Sized,
{
    let deadline_fut = async {
        if let Some(sleep_fut) = deadline_sleep.as_mut().as_pin_mut() {
            sleep_fut.await;
        } else {
            futures_util::future::pending::<()>().await;
        }
    };
    let update_fut = async {
        if initial_update {
            Ok(())
        } else {
            updates.changed().await
        }
    };
    let has_active_input = active_input.is_some();
    let input_fut = async {
        match active_input.as_mut() {
            Some(future) => future.await,
            None => futures_util::future::pending().await,
        }
    };

    if initial_update || !prefer_input {
        tokio::select! {
            biased;
            _ = cancel_token.cancelled() => ControlSelectTurn::Cancelled,
            _ = deadline_fut => ControlSelectTurn::Deadline,
            changed = paired_rx.changed() => ControlSelectTurn::PairChanged(changed),
            changed = update_fut => ControlSelectTurn::Update(changed),
            outcome = input_fut, if has_active_input => ControlSelectTurn::InputOutcome(outcome),
            msg = ws_stream.next() => ControlSelectTurn::WsMessage(msg),
        }
    } else {
        tokio::select! {
            biased;
            _ = cancel_token.cancelled() => ControlSelectTurn::Cancelled,
            _ = deadline_fut => ControlSelectTurn::Deadline,
            changed = paired_rx.changed() => ControlSelectTurn::PairChanged(changed),
            outcome = input_fut, if has_active_input => ControlSelectTurn::InputOutcome(outcome),
            msg = ws_stream.next() => ControlSelectTurn::WsMessage(msg),
            changed = update_fut => ControlSelectTurn::Update(changed),
        }
    }
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
    mut paired_rx: watch::Receiver<bool>,
    _permit: PairPermit,
    mut connection_cleanup: ControlSessionCleanup,
) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    connection_cleanup.fence_holder = true;
    let input_manager = crate::api::browser_host::get_or_create_input_manager(&session_id).await;
    connection_cleanup.manager = Some(input_manager.clone());
    let drain_context = ControlInputContext {
        input_manager: &input_manager,
        session_id: &session_id,
        viewer_id: &viewer_id,
        subscription_epoch: &subscription_epoch,
        paired: true,
    };
    let mut active_input: Option<Pin<Box<dyn Future<Output = ControlInputOutcome> + Send + '_>>> = None;

    let mut message_count_in_sec = 0usize;
    let mut rate_window_start = Instant::now();
    let mut initial_update = true;
    let mut prefer_input = false;

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
        let turn = poll_control_select_turn(
            initial_update,
            prefer_input,
            &cancel_token,
            deadline_sleep.as_mut(),
            &mut paired_rx,
            &mut updates,
            &mut active_input,
            &mut ws_stream,
        )
        .await;

        match turn {
            ControlSelectTurn::Cancelled => {
                debug!(viewer_id = %viewer_id, "control session cancelled (auth revoke or pair teardown)");
                break;
            }
            ControlSelectTurn::Deadline => {
                warn!(viewer_id = %viewer_id, "control session reached absolute auth deadline; closing");
                break;
            }
            ControlSelectTurn::PairChanged(changed) => {
                // The pair became ready or incomplete: re-publish the snapshot with its input
                // readiness (unpaired control never advertises input).
                if changed.is_err() {
                    break;
                }
                initial_update = true;
            }
            ControlSelectTurn::Update(changed) => {
                initial_update = false;
                if changed.is_err() {
                    break;
                }
                let paired = *paired_rx.borrow();
                if !publish_control_snapshot(
                    &mut ws_sink,
                    &mut updates,
                    paired,
                    effective_deadline,
                    &cancel_token,
                    &subscription_epoch,
                )
                .await
                {
                    break;
                }
                prefer_input = true;
            }
            ControlSelectTurn::InputOutcome(outcome) => {
                active_input = None;
                prefer_input = false;
                if !handle_control_input_outcome(&mut ws_sink, outcome).await {
                    break;
                }
            }
            ControlSelectTurn::WsMessage(msg) => {
                prefer_input = false;
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

                        let paired = *paired_rx.borrow();
                        let context = ControlInputContext {
                            input_manager: &input_manager,
                            session_id: &session_id,
                            viewer_id: &viewer_id,
                            subscription_epoch: &subscription_epoch,
                            paired,
                        };
                        match admit_control_text(&context, &text, Some(conn_id)).await {
                            Ok(true) => {
                                if active_input.is_none() {
                                    active_input = Some(Box::pin(drain_control_input(&drain_context, Some(conn_id))));
                                }
                            }
                            Ok(false) => {}
                            Err(outcome) => {
                                if !handle_control_input_outcome(&mut ws_sink, outcome).await {
                                    break;
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

    // Dropping the persistent dispatch transfers any claimed native command to its
    // cancellation-safe owner. Retire the pair before waiting for native cleanup.
    drop(active_input);
    let cleanup = input_manager.fence_control_holder(&viewer_id).await;
    input_manager.discard_queued_from(conn_id).await;
    global_attachment_manager().unregister_connection(conn_id).await;
    connection_cleanup.armed = false;

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
                    serialize_control_snapshot(&mut updates, false),
                ) {
                    let json_len = json.len();
                    let write_started = Instant::now();
                    if matches!(
                        timeout(
                            deadline,
                            ws_sink.send(AxumWsMessage::Text(json.into())),
                        )
                        .await,
                        Ok(Ok(()))
                    ) {
                        let write_dur = Instant::now().saturating_duration_since(write_started);
                        global_stream_diagnostics()
                            .record_control_write(&subscription_epoch, json_len, write_dur);
                    }
                }
            }
        }
    }
    drop(updates);

    if let Some(cleanup) = cleanup {
        match cleanup.await {
            Ok(Ok(_)) => {}
            Ok(Err(err)) => warn!(viewer_id = %viewer_id, error = %err, "control teardown: native input release failed"),
            Err(err) => warn!(viewer_id = %viewer_id, error = %err, "control teardown: cleanup task failed"),
        }
    }
    global_stream_diagnostics().clear_pending_control_write(&subscription_epoch);
    let _ = timeout(WRITE_DEADLINE, ws_sink.send(AxumWsMessage::Close(None))).await;
}

/// Serializes the latest session snapshot. Until the viewer pair is ready (media producer
/// attached and control connected) the snapshot says input is unavailable.
fn serialize_control_snapshot(
    updates: &mut watch::Receiver<ServerControlEvent>,
    paired: bool,
) -> Result<(String, bool), serde_json::Error> {
    let event = updates.borrow_and_update();
    let retired = matches!(
        &*event,
        ServerControlEvent::SessionUpdated { session }
            if session.status == "closed" || session.status == "lost"
    );
    match &*event {
        ServerControlEvent::SessionUpdated { session } if !paired && session.input_available => {
            let mut gated = session.clone();
            gated.input_available = false;
            serde_json::to_string(&ServerControlEvent::SessionUpdated { session: gated })
        }
        other => serde_json::to_string(other),
    }
    .map(|json| (json, retired))
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

/// Projects image fractions to CDP CSS coordinates; `None` for out-of-range fractions.
fn project_pointer(geom: &TargetGeometry, u: f64, v: f64) -> Option<(f64, f64)> {
    if !(0.0..=1.0).contains(&u) || !(0.0..=1.0).contains(&v) {
        return None;
    }
    let x = (u * geom.css_width).clamp(0.0, geom.css_width);
    let y = (v * geom.css_height + geom.offset_top).clamp(0.0, geom.css_height + geom.offset_top);
    Some((x, y))
}

/// The CDP command one input event becomes; `None` when nothing is dispatched.
fn input_event_command(
    geom: &TargetGeometry,
    event: &InputEvent,
    mouse_ctx: crate::browser_host::input::MouseDispatchContext,
) -> Option<(&'static str, serde_json::Value)> {
    let mouse = |kind: &str, button: Option<&str>, click_count: Option<u32>, u: f64, v: f64, modifiers: u32| {
        let (x, y) = project_pointer(geom, u, v)?;
        let mut params = serde_json::json!({
            "type": kind,
            "x": x,
            "y": y,
            "modifiers": modifiers,
            "buttons": mouse_ctx.buttons,
        });
        if let Some(button) = button {
            params["button"] = serde_json::json!(button);
        }
        if let Some(count) = click_count {
            params["clickCount"] = serde_json::json!(count);
        }
        Some(("Input.dispatchMouseEvent", params))
    };
    match event {
        InputEvent::PointerDown { button, u, v, modifiers } => mouse(
            "mousePressed",
            Some(button.as_cdp_str()),
            Some(mouse_ctx.click_count.max(1)),
            *u,
            *v,
            *modifiers,
        ),
        InputEvent::PointerUp { button, u, v, modifiers } => mouse(
            "mouseReleased",
            Some(button.as_cdp_str()),
            Some(mouse_ctx.click_count.max(1)),
            *u,
            *v,
            *modifiers,
        ),
        InputEvent::PointerMove { u, v, modifiers } => mouse(
            "mouseMoved",
            mouse_ctx.move_button.map(|b| b.as_cdp_str()),
            None,
            *u,
            *v,
            *modifiers,
        ),
        InputEvent::Wheel { u, v, delta_x, delta_y, modifiers } => {
            let (_, mut params) = mouse("mouseWheel", None, None, *u, *v, *modifiers)?;
            params["deltaX"] = serde_json::json!(delta_x);
            params["deltaY"] = serde_json::json!(delta_y);
            Some(("Input.dispatchMouseEvent", params))
        }
        InputEvent::KeyDown { key, code, modifiers } => Some((
            "Input.dispatchKeyEvent",
            keyboard_event_params(key, code, *modifiers, true),
        )),
        InputEvent::KeyUp { key, code, modifiers } => Some((
            "Input.dispatchKeyEvent",
            keyboard_event_params(key, code, *modifiers, false),
        )),
        InputEvent::InsertText { text } => {
            Some(("Input.insertText", serde_json::json!({ "text": text })))
        }
        InputEvent::PointerCancel => None,
    }
}

/// Admit input synchronously so its response owner can survive handler cancellation.
pub(crate) fn enqueue_cancellable_input(
    client: &CdpClient,
    page_session_id: &str,
    geom: &TargetGeometry,
    event: &InputEvent,
    mouse_ctx: crate::browser_host::input::MouseDispatchContext,
    cancellation: crate::browser_host::cdp::InputCommandCancellation,
) -> Result<Option<crate::browser_host::cdp::PendingCommand>, CdpError> {
    let Some((method, params)) = input_event_command(geom, event, mouse_ctx) else {
        return Ok(None);
    };
    client.enqueue_cancellable_input(method, &params, page_session_id, cancellation).map(Some)
}

/// Dispatches one input event on the given native page session with explicit mouse button context.
pub async fn dispatch_input_event_to_cdp_with_mouse(
    client: &CdpClient,
    page_session_id: &str,
    geom: &TargetGeometry,
    event: &InputEvent,
    mouse_ctx: crate::browser_host::input::MouseDispatchContext,
) -> Result<(), CdpError> {
    let Some((method, params)) = input_event_command(geom, event, mouse_ctx) else {
        return Ok(());
    };
    client
        .send_command(method, Some(params), Some(page_session_id))
        .await
        .map(|_| ())
}

/// Dispatches one input event on the given native page session. A CDP failure is returned so
/// release paths can report input unavailable instead of silently succeeding.
pub async fn dispatch_input_event_to_cdp(
    client: &CdpClient,
    page_session_id: &str,
    geom: &TargetGeometry,
    event: &InputEvent,
) -> Result<(), CdpError> {
    dispatch_input_event_to_cdp_with_mouse(
        client,
        page_session_id,
        geom,
        event,
        crate::browser_host::input::MouseDispatchContext::default(),
    )
    .await
}

#[cfg(test)]
#[path = "media_keyboard_tests.rs"]
mod keyboard_tests;

#[cfg(test)]
mod control_arbitration_tests {
    use super::*;

    #[tokio::test]
    async fn control_select_alternates_ready_updates_and_input_under_safety_priority() {
        let cancel_token = CancellationToken::new();
        let (_pair_tx, mut paired_rx) = watch::channel(true);
        let (upd_tx, mut updates) = watch::channel(ServerControlEvent::Status {
            input_available: true,
            unavailable_reason: None,
        });
        let mut ws_stream = futures_util::stream::iter(vec![1u32, 2, 3, 4]);
        let mut active_input: Option<Pin<Box<dyn Future<Output = ControlInputOutcome> + Send>>> =
            Some(Box::pin(futures_util::future::ready(ControlInputOutcome::Continue)));
        let deadline_sleep: Option<tokio::time::Sleep> = None;
        tokio::pin!(deadline_sleep);

        // Keep updates continuously ready on every turn.
        let mark_update_ready = || {
            let _ = upd_tx.send(ServerControlEvent::Status {
                input_available: true,
                unavailable_reason: None,
            });
        };

        // Turn 0: initial_update=true must select Update even with active_input & ws_stream ready.
        mark_update_ready();
        let mut initial_update = true;
        let mut prefer_input = false;
        let t0 = poll_control_select_turn(
            initial_update,
            prefer_input,
            &cancel_token,
            deadline_sleep.as_mut(),
            &mut paired_rx,
            &mut updates,
            &mut active_input,
            &mut ws_stream,
        )
        .await;
        assert!(matches!(t0, ControlSelectTurn::Update(Ok(()))));
        initial_update = false;
        prefer_input = true;

        // Turn 1: both Update and InputOutcome ready -> must select InputOutcome (never 2 updates ahead of ready input).
        mark_update_ready();
        let t1 = poll_control_select_turn(
            initial_update,
            prefer_input,
            &cancel_token,
            deadline_sleep.as_mut(),
            &mut paired_rx,
            &mut updates,
            &mut active_input,
            &mut ws_stream,
        )
        .await;
        assert!(matches!(t1, ControlSelectTurn::InputOutcome(ControlInputOutcome::Continue)));
        active_input = None;
        prefer_input = false;

        // Turn 2: continuous ws_stream input + ready Update -> must select Update (input cannot starve updates).
        mark_update_ready();
        let t2 = poll_control_select_turn(
            initial_update,
            prefer_input,
            &cancel_token,
            deadline_sleep.as_mut(),
            &mut paired_rx,
            &mut updates,
            &mut active_input,
            &mut ws_stream,
        )
        .await;
        assert!(matches!(t2, ControlSelectTurn::Update(Ok(()))));
        prefer_input = true;

        // Turn 3: both Update and WsMessage ready -> must select WsMessage.
        mark_update_ready();
        let t3 = poll_control_select_turn(
            initial_update,
            prefer_input,
            &cancel_token,
            deadline_sleep.as_mut(),
            &mut paired_rx,
            &mut updates,
            &mut active_input,
            &mut ws_stream,
        )
        .await;
        assert!(matches!(t3, ControlSelectTurn::WsMessage(Some(1))));

        // Turn 4: already-ready cancellation wins ahead of both ready Update and ready WsMessage.
        mark_update_ready();
        cancel_token.cancel();
        let t4 = poll_control_select_turn(
            initial_update,
            true,
            &cancel_token,
            deadline_sleep.as_mut(),
            &mut paired_rx,
            &mut updates,
            &mut active_input,
            &mut ws_stream,
        )
        .await;
        assert!(matches!(t4, ControlSelectTurn::Cancelled));

        // Turn 5: already-elapsed deadline wins ahead of both ready Update and ready WsMessage.
        let active_cancel = CancellationToken::new();
        let expired_sleep = Some(sleep(Duration::from_millis(1)));
        tokio::pin!(expired_sleep);
        sleep(Duration::from_millis(15)).await;
        mark_update_ready();
        let t5 = poll_control_select_turn(
            initial_update,
            true,
            &active_cancel,
            expired_sleep.as_mut(),
            &mut paired_rx,
            &mut updates,
            &mut active_input,
            &mut ws_stream,
        )
        .await;
        assert!(matches!(t5, ControlSelectTurn::Deadline));
    }
}
