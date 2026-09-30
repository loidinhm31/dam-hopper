use std::{
    collections::HashMap,
    convert::Infallible,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    task::{Context, Poll},
    time::{Duration, Instant},
};
use parking_lot::Mutex;

use axum::{
    body::{Body, Bytes},
    extract::{Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use futures_util::Stream;
use tokio::sync::{mpsc, OwnedSemaphorePermit, Semaphore};
use tokio_stream::wrappers::ReceiverStream;
use tokio_util::sync::CancellationToken;

use crate::{
    api::{
        auth::{AuthenticatedActor, CredentialMechanism, VerifiedAuthClaims},
        auth_mfa::auth_error_response,
    },
    auth::model::bson_to_chrono,
    auth::policy::compute_mfa_due_at,
    state::AppState,
    system::{
        encode_error_control, encode_status_control, encode_status_control_for_frame,
        ControlFrameError, FrameTooLarge, HostResourceMonitor, HostResourcePublisher,
    },
};

pub const MAX_GLOBAL_SSE_STREAMS: usize = 32;
pub const MAX_SUBJECT_SSE_STREAMS: usize = 4;

/// A clone-safe wrapper around a single `OwnedSemaphorePermit`.
///
/// Allows insertion into `http::Extensions` (which requires `Clone + Send + Sync + 'static`).
/// The permit can only be claimed once via `take()`. Any unconsumed permit is dropped when
/// the wrapper drops.
#[derive(Clone)]
pub struct AdmissionPermit(pub Arc<Mutex<Option<OwnedSemaphorePermit>>>);

impl AdmissionPermit {
    pub fn new(permit: OwnedSemaphorePermit) -> Self {
        Self(Arc::new(Mutex::new(Some(permit))))
    }

    pub fn take(&self) -> Option<OwnedSemaphorePermit> {
        self.0.lock().take()
    }
}

/// A per-subject guard that decrements the active stream count on drop.
pub struct SubjectGuard {
    pub subject: String,
    pub subject_counts: Arc<Mutex<HashMap<String, usize>>>,
}

impl Drop for SubjectGuard {
    fn drop(&mut self) {
        let mut counts = self.subject_counts.lock();
        if let Some(val) = counts.get_mut(&self.subject) {
            *val = val.saturating_sub(1);
            if *val == 0 {
                counts.remove(&self.subject);
            }
        }
    }
}

/// A clone-safe wrapper around `SubjectGuard` for request extensions.
#[derive(Clone)]
pub struct SubjectPermit(pub Arc<Mutex<Option<SubjectGuard>>>);

impl SubjectPermit {
    pub fn new(guard: SubjectGuard) -> Self {
        Self(Arc::new(Mutex::new(Some(guard))))
    }

    pub fn take(&self) -> Option<SubjectGuard> {
        self.0.lock().take()
    }
}

/// Combines the global semaphore permit and the per-subject lease.
///
/// Held by the response body stream for its entire lifetime.
pub struct BodyLease {
    pub _global_permit: OwnedSemaphorePermit,
    pub _subject_guard: SubjectGuard,
}

/// Admission control tracking global (32) and per-subject (4) stream limits.
pub struct HostResourceAdmission {
    pub semaphore: Arc<Semaphore>,
    pub subject_counts: Arc<Mutex<HashMap<String, usize>>>,
}

impl HostResourceAdmission {
    pub fn new() -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(MAX_GLOBAL_SSE_STREAMS)),
            subject_counts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn try_acquire_global(&self) -> Result<OwnedSemaphorePermit, ()> {
        self.semaphore.clone().try_acquire_owned().map_err(|_| ())
    }

    pub fn try_acquire_subject(&self, subject: &str) -> Result<SubjectGuard, ()> {
        let mut counts = self.subject_counts.lock();
        let count = counts.entry(subject.to_string()).or_insert(0);
        if *count >= MAX_SUBJECT_SSE_STREAMS {
            return Err(());
        }
        *count += 1;
        Ok(SubjectGuard {
            subject: subject.to_string(),
            subject_counts: Arc::clone(&self.subject_counts),
        })
    }

    pub fn active_global_permits(&self) -> usize {
        MAX_GLOBAL_SSE_STREAMS.saturating_sub(self.semaphore.available_permits())
    }

    pub fn active_subject_count(&self, subject: &str) -> usize {
        self.subject_counts
            .lock()
            .get(subject)
            .copied()
            .unwrap_or(0)
    }
}

impl Default for HostResourceAdmission {
    fn default() -> Self {
        Self::new()
    }
}

/// Feature runtime managing the publisher, admission control, and pre-drain shutdown.
pub struct HostResourceEvents {
    publisher: HostResourcePublisher,
    admission: Arc<HostResourceAdmission>,
    revoked: Arc<AtomicBool>,
    cancellation: CancellationToken,
    tracked_tasks: Arc<Mutex<Vec<tokio::task::JoinHandle<()>>>>,
}

impl HostResourceEvents {
    pub fn new(monitor: HostResourceMonitor) -> Self {
        Self {
            publisher: HostResourcePublisher::new(monitor),
            admission: Arc::new(HostResourceAdmission::new()),
            revoked: Arc::new(AtomicBool::new(false)),
            cancellation: CancellationToken::new(),
            tracked_tasks: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn start(&self) {
        self.publisher.start();
    }

    pub fn revoke_emission(&self) {
        self.revoked.store(true, Ordering::Release);
        self.cancellation.cancel();
    }

    pub async fn shutdown(&self) {
        self.revoke_emission();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);

        // Cancel publisher within the shared 2s deadline
        let publisher_remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let _ = tokio::time::timeout(publisher_remaining, self.publisher.shutdown()).await;

        let mut tasks = {
            let mut guard = self.tracked_tasks.lock();
            std::mem::take(&mut *guard)
        };

        for task in &mut tasks {
            let now = tokio::time::Instant::now();
            if now < deadline {
                let remaining = deadline - now;
                if tokio::time::timeout(remaining, &mut *task).await.is_err() {
                    task.abort();
                }
            } else {
                task.abort();
            }
        }
    }

    pub fn publisher(&self) -> &HostResourcePublisher {
        &self.publisher
    }

    pub fn admission(&self) -> &Arc<HostResourceAdmission> {
        &self.admission
    }

    pub fn is_revoked(&self) -> bool {
        self.revoked.load(Ordering::Acquire)
    }

    pub fn cancellation(&self) -> CancellationToken {
        self.cancellation.clone()
    }

    pub(crate) fn track_task(&self, handle: tokio::task::JoinHandle<()>) {
        let mut tasks = self.tracked_tasks.lock();
        tasks.retain(|t| !t.is_finished());
        tasks.push(handle);
    }
}

/// A wrapper stream holding the body lease until the stream drops.
pub struct LeaseStream<S> {
    stream: S,
    _lease: BodyLease,
}

impl<S: Stream + Unpin> Stream for LeaseStream<S> {
    type Item = S::Item;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        Pin::new(&mut self.stream).poll_next(cx)
    }
}

#[derive(Clone, Debug)]
pub struct RevocationReason {
    pub code: &'static str,
    pub error: &'static str,
}

pub struct RevocationState {
    revoked: AtomicBool,
    reason: Mutex<Option<RevocationReason>>,
    notify: tokio::sync::Notify,
}

impl RevocationState {
    pub fn new() -> Self {
        Self {
            revoked: AtomicBool::new(false),
            reason: Mutex::new(None),
            notify: tokio::sync::Notify::new(),
        }
    }

    pub fn revoke(&self, reason: RevocationReason) {
        // On revocation set no-emit state first, best-effort error/close later
        self.revoked.store(true, Ordering::Release);
        let mut guard = self.reason.lock();
        if guard.is_none() {
            *guard = Some(reason);
        }
        self.notify.notify_waiters();
    }

    pub fn is_revoked(&self) -> bool {
        self.revoked.load(Ordering::Acquire)
    }

    pub fn take_reason(&self) -> Option<RevocationReason> {
        self.reason.lock().take()
    }
}

impl Default for RevocationState {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Route middleware layers (applied in reverse order)
// ---------------------------------------------------------------------------

/// Outermost layer: global 32-stream capacity check.
pub async fn global_admission_layer(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    if request.method() != axum::http::Method::GET {
        return next.run(request).await;
    }

    if state.host_resource_events.is_revoked() {
        return auth_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "AUTH_UNAVAILABLE",
            "Server shutdown initiated",
            None,
        );
    }

    let permit = match state.host_resource_events.admission().try_acquire_global() {
        Ok(permit) => permit,
        Err(()) => {
            return auth_error_response(
                StatusCode::TOO_MANY_REQUESTS,
                "HOST_RESOURCE_STREAM_LIMIT",
                "Global host resource stream limit reached",
                Some(30),
            );
        }
    };

    request
        .extensions_mut()
        .insert(AdmissionPermit::new(permit));
    next.run(request).await
}

/// Second layer: explicit Origin admission check when Origin header is present.
pub async fn origin_admission_layer(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    if request.method() != axum::http::Method::GET {
        return next.run(request).await;
    }

    if request.headers().contains_key(header::ORIGIN) && !state.origin_is_allowed(request.headers()) {
        return auth_error_response(
            StatusCode::FORBIDDEN,
            "ORIGIN_NOT_ALLOWED",
            "Origin not allowed",
            None,
        );
    }
    next.run(request).await
}

/// Fourth layer: enforces Bearer credentials unless in dev mode (--no-auth).
pub async fn bearer_required_layer(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    if request.method() != axum::http::Method::GET {
        return next.run(request).await;
    }

    if !state.no_auth {
        let mechanism = request.extensions().get::<CredentialMechanism>().copied();
        if mechanism != Some(CredentialMechanism::Bearer) {
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "AUTH_REQUIRED",
                "Bearer token required for host resource stream; cookie credentials are not permitted",
                None,
            );
        }
    }
    next.run(request).await
}

/// Fifth layer: per-subject limit check (max 4 per verified subject).
pub async fn subject_admission_layer(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    if request.method() != axum::http::Method::GET {
        return next.run(request).await;
    }

    let subject = request
        .extensions()
        .get::<AuthenticatedActor>()
        .map(|a| a.subject.clone())
        .unwrap_or_else(|| "dev-user".to_string());

    let guard = match state
        .host_resource_events
        .admission()
        .try_acquire_subject(&subject)
    {
        Ok(guard) => guard,
        Err(()) => {
            return auth_error_response(
                StatusCode::TOO_MANY_REQUESTS,
                "HOST_RESOURCE_STREAM_LIMIT",
                "Per-subject host resource stream limit reached",
                Some(30),
            );
        }
    };

    request
        .extensions_mut()
        .insert(SubjectPermit::new(guard));
    next.run(request).await
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub async fn events_handler(State(state): State<AppState>, request: Request) -> Response {
    let global_permit = request
        .extensions()
        .get::<AdmissionPermit>()
        .and_then(|p| p.take());
    let subject_guard = request
        .extensions()
        .get::<SubjectPermit>()
        .and_then(|p| p.take());

    let (Some(global_permit), Some(subject_guard)) = (global_permit, subject_guard) else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to claim admission lease",
        )
            .into_response();
    };

    let lease = BodyLease {
        _global_permit: global_permit,
        _subject_guard: subject_guard,
    };

    let mut sub = state.host_resource_events.publisher().subscribe();
    let initial_frame = sub.latest().await;
    let initial_frame = match initial_frame {
        Ok(frame) => frame,
        Err(FrameTooLarge { .. }) => {
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "FRAME_TOO_LARGE",
                "Host resource frame exceeds maximum size",
                None,
            );
        }
    };

    let basis = state
        .host_resource_events
        .publisher()
        .current_status_basis()
        .await;
    let initial_status = match encode_status_control(&basis, Instant::now()) {
        Ok(bytes) => bytes,
        Err(ControlFrameError::FrameTooLarge) => {
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "FRAME_TOO_LARGE",
                "Host resource status exceeds maximum size",
                None,
            );
        }
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to encode status control",
            )
                .into_response();
        }
    };

    let revocation = Arc::new(RevocationState::new());
    let stream_cancel = CancellationToken::new();

    // Start supervisor if authenticated with signed claims
    if let Some(verified_claims) = request.extensions().get::<VerifiedAuthClaims>() {
        if let Some(actor) = request.extensions().get::<AuthenticatedActor>().cloned() {
            spawn_supervisor(
                &state,
                verified_claims.0.clone(),
                actor,
                Arc::clone(&revocation),
                stream_cancel.clone(),
            );
        }
    }

    let publisher = state.host_resource_events.publisher().clone();
    let global_cancel = state.host_resource_events.cancellation();
    let (tx, rx) = mpsc::channel::<Result<Bytes, Infallible>>(16);

    let producer_revocation = Arc::clone(&revocation);
    let producer_task = tokio::spawn(async move {
        let _guard = stream_cancel.drop_guard();

        // 1. Send initial status control immediately after headers
        if tx.send(Ok(initial_status)).await.is_err() {
            return;
        }

        // 2. Send initial full pair
        if tx.send(Ok(initial_frame.bytes.clone())).await.is_err() {
            return;
        }

        let mut periodic_timer = tokio::time::interval_at(
            tokio::time::Instant::now() + Duration::from_secs(15),
            Duration::from_secs(15),
        );
        periodic_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                _ = tx.closed() => {
                    break;
                }
                _ = producer_revocation.notify.notified() => {
                    if producer_revocation.is_revoked() {
                        if let Some(reason) = producer_revocation.take_reason() {
                            if let Ok(err_bytes) = encode_error_control(reason.code, reason.error) {
                                let _ = tx.send(Ok(err_bytes)).await;
                            }
                        }
                        break;
                    }
                }
                _ = global_cancel.cancelled() => {
                    if let Ok(err_bytes) = encode_error_control("AUTH_UNAVAILABLE", "Server shutdown initiated") {
                        let _ = tx.send(Ok(err_bytes)).await;
                    }
                    break;
                }
                _ = periodic_timer.tick() => {
                    if producer_revocation.is_revoked() {
                        if let Some(reason) = producer_revocation.take_reason() {
                            if let Ok(err_bytes) = encode_error_control(reason.code, reason.error) {
                                let _ = tx.send(Ok(err_bytes)).await;
                            }
                        }
                        break;
                    }
                    if global_cancel.is_cancelled() {
                        break;
                    }
                    let basis = publisher.current_status_basis().await;
                    if producer_revocation.is_revoked() || global_cancel.is_cancelled() {
                        break;
                    }
                    match encode_status_control(&basis, Instant::now()) {
                        Ok(status_bytes) => {
                            if tx.send(Ok(status_bytes)).await.is_err() {
                                break;
                            }
                        }
                        Err(ControlFrameError::FrameTooLarge) => {
                            if let Ok(err_bytes) = encode_error_control("FRAME_TOO_LARGE", "Host resource status exceeds maximum size") {
                                let _ = tx.send(Ok(err_bytes)).await;
                            }
                            break;
                        }
                        Err(_) => break,
                    }
                }
                changed_res = sub.changed() => {
                    if producer_revocation.is_revoked() {
                        if let Some(reason) = producer_revocation.take_reason() {
                            if let Ok(err_bytes) = encode_error_control(reason.code, reason.error) {
                                let _ = tx.send(Ok(err_bytes)).await;
                            }
                        }
                        break;
                    }
                    if global_cancel.is_cancelled() {
                        break;
                    }
                    match changed_res {
                        Err(FrameTooLarge { .. }) => {
                            if let Ok(err_bytes) = encode_error_control("FRAME_TOO_LARGE", "Host resource frame exceeds maximum size") {
                                let _ = tx.send(Ok(err_bytes)).await;
                            }
                            break;
                        }
                        Ok(frame) => {
                            // Pre-data matching status for this frame
                            match encode_status_control_for_frame(&frame, Instant::now()) {
                                Ok(status_bytes) => {
                                    if tx.send(Ok(status_bytes)).await.is_err() {
                                        break;
                                    }
                                }
                                Err(ControlFrameError::FrameTooLarge) => {
                                    if let Ok(err_bytes) = encode_error_control("FRAME_TOO_LARGE", "Host resource status exceeds maximum size") {
                                        let _ = tx.send(Ok(err_bytes)).await;
                                    }
                                    break;
                                }
                                Err(_) => break,
                            }
                            if producer_revocation.is_revoked() || global_cancel.is_cancelled() {
                                break;
                            }
                            if tx.send(Ok(frame.bytes.clone())).await.is_err() {
                                break;
                            }
                        }
                    }
                }
            }
        }
    });

    state.host_resource_events.track_task(producer_task);

    let stream = LeaseStream {
        stream: ReceiverStream::new(rx),
        _lease: lease,
    };

    let mut response = Body::from_stream(stream).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream; charset=utf-8"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store, no-transform"),
    );
    headers.insert(
        header::HeaderName::from_static("x-accel-buffering"),
        HeaderValue::from_static("no"),
    );

    response
}

fn spawn_supervisor(
    state: &AppState,
    claims: crate::auth::model::AuthClaims,
    actor: AuthenticatedActor,
    revocation: Arc<RevocationState>,
    stream_cancel: CancellationToken,
) {
    let auth_service = Arc::clone(&state.auth_service);
    let global_cancel = state.host_resource_events.cancellation();

    let handle = tokio::spawn(async move {
        let clock = auth_service.clock();
        let now_dt = clock.now();
        let mut nearest_deadline = actor.effective_deadline;
        if let Some(exp_dt) = chrono::DateTime::from_timestamp(claims.exp as i64, 0) {
            nearest_deadline = match nearest_deadline {
                Some(d) => Some(d.min(exp_dt)),
                None => Some(exp_dt),
            };
        }

        let deadline_sleep = match nearest_deadline {
            Some(dl) => {
                let dur = dl
                    .signed_duration_since(now_dt)
                    .to_std()
                    .unwrap_or(Duration::ZERO);
                tokio::time::sleep(dur)
            }
            None => tokio::time::sleep(Duration::from_secs(365 * 24 * 3600)),
        };
        tokio::pin!(deadline_sleep);

        let mut interval = tokio::time::interval_at(
            tokio::time::Instant::now() + Duration::from_secs(5),
            Duration::from_secs(5),
        );
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                _ = stream_cancel.cancelled() => break,
                _ = global_cancel.cancelled() => {
                    revocation.revoke(RevocationReason {
                        code: "AUTH_UNAVAILABLE",
                        error: "Server shutdown initiated",
                    });
                    break;
                }
                _ = &mut deadline_sleep => {
                    revocation.revoke(RevocationReason {
                        code: "AUTH_REQUIRED",
                        error: "Authentication session expired",
                    });
                    break;
                }
                _ = interval.tick() => {
                    let eval_result = tokio::time::timeout(
                        Duration::from_secs(2),
                        auth_service.evaluate_claims(&claims),
                    )
                    .await;

                    match eval_result {
                        Err(_) => {
                            revocation.revoke(RevocationReason {
                                code: "AUTH_UNAVAILABLE",
                                error: "Authentication backend unavailable",
                            });
                            break;
                        }
                        Ok(crate::auth::model::AuthDecision::Authenticated { session, user }) => {
                            if session.auth_version != claims.auth_version
                                || session.credential_version != claims.credential_version
                                || Some(user.role) != actor.role
                            {
                                revocation.revoke(RevocationReason {
                                    code: "AUTH_REQUIRED",
                                    error: "Session version or credentials changed",
                                });
                                break;
                            }
                            let expires_at = bson_to_chrono(session.expires_at);
                            let mfa_verified_at = bson_to_chrono(session.mfa_verified_at);
                            let effective_dl = compute_mfa_due_at(mfa_verified_at, expires_at);
                            if effective_dl <= clock.now() {
                                revocation.revoke(RevocationReason {
                                    code: "MFA_REQUIRED",
                                    error: "MFA verification required",
                                });
                                break;
                            }
                        }
                        Ok(crate::auth::model::AuthDecision::MfaRequired { .. }) => {
                            revocation.revoke(RevocationReason {
                                code: "MFA_REQUIRED",
                                error: "MFA verification required",
                            });
                            break;
                        }
                        Ok(crate::auth::model::AuthDecision::FullLoginRequired { .. }) => {
                            revocation.revoke(RevocationReason {
                                code: "AUTH_REQUIRED",
                                error: "Session expired or revoked",
                            });
                            break;
                        }
                        Ok(crate::auth::model::AuthDecision::Unavailable { .. }) => {
                            revocation.revoke(RevocationReason {
                                code: "AUTH_UNAVAILABLE",
                                error: "Authentication backend unavailable",
                            });
                            break;
                        }
                    }
                }
            }
        }
    });

    state.host_resource_events.track_task(handle);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn test_admission_permit_take_once() {
        let sem = Arc::new(Semaphore::new(1));
        let permit = sem.clone().try_acquire_owned().expect("acquire permit");
        let admission_permit = AdmissionPermit::new(permit);

        // Cloned copies point to same inner option
        let clone1 = admission_permit.clone();
        let clone2 = admission_permit.clone();

        assert_eq!(sem.available_permits(), 0);

        let taken = clone1.take();
        assert!(taken.is_some(), "first take should succeed");

        assert!(clone2.take().is_none(), "second take should return None");
        assert!(admission_permit.take().is_none(), "third take should return None");

        // When taken permit drops, semaphore permit is restored
        drop(taken);
        assert_eq!(sem.available_permits(), 1);
    }

    #[test]
    fn test_admission_permit_drop_without_take() {
        let sem = Arc::new(Semaphore::new(1));
        let permit = sem.clone().try_acquire_owned().expect("acquire permit");
        let admission_permit = AdmissionPermit::new(permit);
        let clone = admission_permit.clone();

        assert_eq!(sem.available_permits(), 0);
        drop(admission_permit);
        assert_eq!(sem.available_permits(), 0, "one clone still alive");
        drop(clone);
        assert_eq!(sem.available_permits(), 1, "all clones dropped without take restores permit");
    }

    #[test]
    fn test_subject_guard_limit_and_cleanup() {
        let admission = HostResourceAdmission::new();

        let g1 = admission.try_acquire_subject("user1").expect("user1 #1");
        let g2 = admission.try_acquire_subject("user1").expect("user1 #2");
        let g3 = admission.try_acquire_subject("user1").expect("user1 #3");
        let g4 = admission.try_acquire_subject("user1").expect("user1 #4");

        assert_eq!(admission.active_subject_count("user1"), 4);

        // 5th attempt must fail
        assert!(admission.try_acquire_subject("user1").is_err());

        // Different subject succeeds
        let u2_g1 = admission.try_acquire_subject("user2").expect("user2 #1");
        assert_eq!(admission.active_subject_count("user2"), 1);

        drop(g1);
        assert_eq!(admission.active_subject_count("user1"), 3);

        drop(g2);
        drop(g3);
        drop(g4);
        assert_eq!(admission.active_subject_count("user1"), 0);
        assert!(!admission.subject_counts.lock().contains_key("user1"));

        drop(u2_g1);
        assert!(!admission.subject_counts.lock().contains_key("user2"));
    }

    #[test]
    fn test_global_limit_32() {
        let admission = HostResourceAdmission::new();
        let mut permits = Vec::new();

        for i in 0..32 {
            let p = admission.try_acquire_global().unwrap_or_else(|_| panic!("permit {i}"));
            permits.push(p);
        }

        assert_eq!(admission.active_global_permits(), 32);
        assert!(admission.try_acquire_global().is_err(), "33rd must fail");

        permits.pop();
        assert_eq!(admission.active_global_permits(), 31);
        assert!(admission.try_acquire_global().is_ok(), "re-acquire after drop");
    }

    #[test]
    fn test_revocation_state() {
        let state = RevocationState::new();
        assert!(!state.is_revoked());

        state.revoke(RevocationReason {
            code: "AUTH_REQUIRED",
            error: "Session expired",
        });

        assert!(state.is_revoked());
        let reason = state.take_reason().expect("reason exists");
        assert_eq!(reason.code, "AUTH_REQUIRED");
        assert_eq!(reason.error, "Session expired");

        // Second take returns None
        assert!(state.take_reason().is_none());
        assert!(state.is_revoked());
    }
}
