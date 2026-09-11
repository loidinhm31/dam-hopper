use axum::{
    extract::{Extension, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

use crate::{
    api::auth::{self, AuthenticatedActor},
    idle_suspend::{
        coordinator::{
            CoordinatorForceSuspendResult, CoordinatorTimingResult, ForceSuspendCommand,
            UpdateTimingCommand,
        },
        policy::validate_timing_pair,
        protocol::{
            validate_suspend_wake_seconds, ForceSuspendAcceptedResponse, ForceSuspendRequest,
            IdleSuspendConflictResponse, IdleSuspendErrorCode, IdleSuspendTimingPatchRequest,
            IdleSuspendTimingPatchResponse,
        },
        status::IdleSuspendStatusV1,
    },
    pty::PtyFleetSnapshot,
    state::AppState,
};

/// Format error response with standard closed `{ "error": ..., "code": ... }` shape.
/// Always sets `Cache-Control: no-store`.
pub fn idle_suspend_error_response(
    status: StatusCode,
    code: &'static str,
    error: &str,
) -> Response {
    let mut resp = (
        status,
        Json(json!({
            "error": error,
            "code": code,
        })),
    )
        .into_response();
    resp.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    resp
}

/// Format conflict response with `{ "error": ..., "code": ..., "activeSessionCount": ..., "fleetSnapshot": ... }`.
/// Always sets `Cache-Control: no-store`.
pub fn idle_suspend_conflict_response(
    code: &'static str,
    error: &str,
    fleet_snapshot: PtyFleetSnapshot,
) -> Response {
    let mut resp = (
        StatusCode::CONFLICT,
        Json(IdleSuspendConflictResponse::new(
            code,
            error,
            fleet_snapshot,
        )),
    )
        .into_response();
    resp.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    resp
}

/// Verify media type and cookie origin guards before body or coordinator admission.
pub fn verify_transport_guards(
    state: &AppState,
    headers: &HeaderMap,
    content_type_msg: &'static str,
    origin_msg: &'static str,
) -> Result<(), Response> {
    let is_json = headers
        .get(header::CONTENT_TYPE)
        .and_then(|val| val.to_str().ok())
        .is_some_and(|val| val.starts_with("application/json"));
    if !is_json {
        return Err(idle_suspend_error_response(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            IdleSuspendErrorCode::InvalidContentType.as_code_str(),
            content_type_msg,
        ));
    }

    let is_bearer = auth::extract_bearer_token(headers).is_some();
    let uses_cookie = !is_bearer && headers.get(header::COOKIE).is_some();
    if uses_cookie && !state.origin_is_allowed(headers) {
        return Err(idle_suspend_error_response(
            StatusCode::FORBIDDEN,
            IdleSuspendErrorCode::InvalidOrigin.as_code_str(),
            origin_msg,
        ));
    }

    Ok(())
}

/// Validate production authentication and enabled actor prerequisites for idle suspend mutations.
///
/// Ensures `--no-auth` is rejected, database auth is configured, an actor is present,
/// and the actor account is still enabled in the database.
pub async fn verify_enabled_actor(
    state: &AppState,
    actor: Option<&AuthenticatedActor>,
    no_auth_code: &'static str,
    no_auth_msg: &'static str,
    db_required_msg: &'static str,
    actor_disabled_msg: &'static str,
) -> Result<AuthenticatedActor, Response> {
    if state.no_auth {
        return Err(idle_suspend_error_response(
            StatusCode::FORBIDDEN,
            no_auth_code,
            no_auth_msg,
        ));
    }

    if state.db.is_none() {
        return Err(idle_suspend_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            IdleSuspendErrorCode::AuthenticationUnavailable.as_code_str(),
            db_required_msg,
        ));
    }

    let Some(actor) = actor else {
        return Err(idle_suspend_error_response(
            StatusCode::UNAUTHORIZED,
            IdleSuspendErrorCode::Unauthorized.as_code_str(),
            "authentication is required",
        ));
    };

    if !auth::is_enabled_user(state.db.as_ref(), &actor.subject).await {
        return Err(idle_suspend_error_response(
            StatusCode::FORBIDDEN,
            IdleSuspendErrorCode::ActorDisabled.as_code_str(),
            actor_disabled_msg,
        ));
    }

    Ok(actor.clone())
}

/// GET /api/system/idle-suspend/v1/status
///
/// Returns the authoritative status snapshot for the idle suspend subsystem.
/// Protected route: Cache-Control is always `no-store`.
pub async fn get_status(
    State(state): State<AppState>,
    _actor: Option<Extension<AuthenticatedActor>>,
) -> Response {
    let status = if let Some(coordinator) = state.get_idle_suspend_coordinator().await {
        coordinator.status()
    } else {
        let (quiet, wake) = {
            let guard = state.idle_suspend_timing.read().await;
            (guard.quiet_period_seconds, guard.wake_after_seconds)
        };
        let fleet = state.pty_manager.fleet_watcher().snapshot();
        IdleSuspendStatusV1::fallback_status(
            &state.idle_suspend_policy,
            quiet,
            wake,
            fleet,
            state.fallback_warning_onset_ms,
        )
    };

    let mut response = Json(status).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// PATCH /api/system/idle-suspend/v1/timing
///
/// Protected, dedicated mutation for updating both quiet and wake timing values.
/// Requires an authenticated enabled actor with database authentication.
/// Denied under `--no-auth`. Enforces origin and JSON body limits.
pub async fn update_timing(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    request: Request,
) -> Response {
    // 1 & 2. Transport guards (Content-Type + cookie origin)
    if let Err(resp) = verify_transport_guards(
        &state,
        request.headers(),
        "timing mutation requires application/json",
        "timing mutation origin is not allowed",
    ) {
        return resp;
    }

    // 3, 4, 5, 6. Production actor gates (--no-auth, DB auth, authenticated, enabled)
    let actor = match verify_enabled_actor(
        &state,
        actor.as_ref().map(|Extension(a)| a),
        IdleSuspendErrorCode::DisabledNoAuth.as_code_str(),
        "idle suspend timing mutation is disabled in no-auth mode",
        "idle suspend timing requires configured authentication",
        "idle suspend timing requires an enabled account",
    )
    .await
    {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    // 7. Parse request body into IdleSuspendTimingPatchRequest
    let body_bytes = match axum::body::to_bytes(request.into_body(), 16 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            return idle_suspend_error_response(
                StatusCode::BAD_REQUEST,
                IdleSuspendErrorCode::InvalidTiming.as_code_str(),
                &format!("invalid request body: {e}"),
            );
        }
    };

    let patch_req: IdleSuspendTimingPatchRequest = match serde_json::from_slice(&body_bytes) {
        Ok(r) => r,
        Err(e) => {
            return idle_suspend_error_response(
                StatusCode::BAD_REQUEST,
                IdleSuspendErrorCode::InvalidTiming.as_code_str(),
                &format!("invalid timing payload: {e}"),
            );
        }
    };

    // 8. Validate timing pair bounds
    if let Err(err) =
        validate_timing_pair(patch_req.quiet_period_seconds, patch_req.wake_after_seconds)
    {
        return idle_suspend_error_response(
            StatusCode::BAD_REQUEST,
            IdleSuspendErrorCode::InvalidTiming.as_code_str(),
            &err,
        );
    }

    // 9. Submit command to coordinator
    let coordinator = match state.get_idle_suspend_coordinator().await {
        Some(c) => c,
        None => {
            return idle_suspend_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                IdleSuspendErrorCode::TimingUnavailable.as_code_str(),
                "idle suspend coordinator is not operational",
            );
        }
    };

    let cmd = UpdateTimingCommand {
        actor: actor.subject,
        quiet_period_seconds: patch_req.quiet_period_seconds,
        wake_after_seconds: patch_req.wake_after_seconds,
    };

    let result = coordinator.update_timing(cmd).await;

    // 10. Map coordinator outcome to HTTP response
    match result {
        CoordinatorTimingResult::Success {
            changed,
            status_revision,
            quiet_period_seconds,
            wake_after_seconds,
        } => {
            let mut resp = (
                StatusCode::OK,
                Json(IdleSuspendTimingPatchResponse::new(
                    changed,
                    status_revision,
                    quiet_period_seconds,
                    wake_after_seconds,
                )),
            )
                .into_response();
            resp.headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            resp
        }
        CoordinatorTimingResult::HandoffInProgress => idle_suspend_error_response(
            StatusCode::CONFLICT,
            IdleSuspendErrorCode::HandoffInProgress.as_code_str(),
            "cannot mutate timing while helper handoff is in progress",
        ),
        CoordinatorTimingResult::Disabled => idle_suspend_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            IdleSuspendErrorCode::TimingUnavailable.as_code_str(),
            "idle suspend coordinator is disabled",
        ),
        CoordinatorTimingResult::AuditFailed(err) => idle_suspend_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            IdleSuspendErrorCode::AuditUnavailable.as_code_str(),
            &format!("timing audit failed: {err}"),
        ),
        CoordinatorTimingResult::PersistenceFailed(err) => idle_suspend_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            IdleSuspendErrorCode::PersistenceUnavailable.as_code_str(),
            &format!("timing persistence failed: {err}"),
        ),
        CoordinatorTimingResult::ValidationFailed(err) => idle_suspend_error_response(
            StatusCode::BAD_REQUEST,
            IdleSuspendErrorCode::InvalidTiming.as_code_str(),
            &err,
        ),
    }
}

/// POST /api/system/idle-suspend/v1/force-suspend
///
/// Protected, dedicated action for initiating an authenticated manual force sleep.
/// Accepts indefinite sleep (`wakeAfterSeconds: 0`) and bounded RTC auto-wake (`60..=86400`).
/// Requires an authenticated enabled actor with database authentication.
/// Denied under `--no-auth`. Enforces origin and 16 KiB JSON body limits.
pub async fn force_suspend(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    request: Request,
) -> Response {
    // 1 & 2. Transport guards (Content-Type + cookie origin)
    if let Err(resp) = verify_transport_guards(
        &state,
        request.headers(),
        "force suspend requires application/json",
        "force suspend origin is not allowed",
    ) {
        return resp;
    }

    // 3, 4, 5, 6. Production actor gates (--no-auth, DB auth, authenticated, enabled)
    let actor = match verify_enabled_actor(
        &state,
        actor.as_ref().map(|Extension(a)| a),
        IdleSuspendErrorCode::ForceSuspendDisabledNoAuth.as_code_str(),
        "manual force sleep is disabled in no-auth mode",
        "manual force sleep requires configured authentication",
        "manual force sleep requires an enabled account",
    )
    .await
    {
        Ok(a) => a,
        Err(resp) => return resp,
    };

    // 7. Parse request body into ForceSuspendRequest (capped at 16 KiB)
    let body_bytes = match axum::body::to_bytes(request.into_body(), 16 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            return idle_suspend_error_response(
                StatusCode::BAD_REQUEST,
                IdleSuspendErrorCode::InvalidForceSuspendPayload.as_code_str(),
                &format!("invalid request body: {e}"),
            );
        }
    };

    let force_req: ForceSuspendRequest = match serde_json::from_slice(&body_bytes) {
        Ok(r) => r,
        Err(e) => {
            return idle_suspend_error_response(
                StatusCode::BAD_REQUEST,
                IdleSuspendErrorCode::InvalidForceSuspendPayload.as_code_str(),
                &format!("invalid force suspend payload: {e}"),
            );
        }
    };

    // 8. Validate wake duration bounds: exactly 0 (indefinite) or 60..=86400
    if let Err(err) = validate_suspend_wake_seconds(force_req.wake_after_seconds) {
        return idle_suspend_error_response(
            StatusCode::BAD_REQUEST,
            IdleSuspendErrorCode::InvalidForceSuspendPayload.as_code_str(),
            &format!("invalid wake duration: {err}"),
        );
    }

    // 9. Submit command to coordinator
    let coordinator = match state.get_idle_suspend_coordinator().await {
        Some(c) => c,
        None => {
            return idle_suspend_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                IdleSuspendErrorCode::TimingUnavailable.as_code_str(),
                "idle suspend coordinator is not operational",
            );
        }
    };

    let cmd = ForceSuspendCommand {
        actor: actor.subject,
        wake_after_seconds: force_req.wake_after_seconds,
        force: force_req.force,
    };

    let result = coordinator.force_suspend(cmd).await;

    // 10. Map coordinator outcome to HTTP response
    match result {
        CoordinatorForceSuspendResult::Accepted {
            request_id,
            status_revision,
            fleet_snapshot,
        } => {
            let mut resp = (
                StatusCode::ACCEPTED,
                Json(ForceSuspendAcceptedResponse::new(
                    request_id,
                    status_revision,
                    force_req.wake_after_seconds,
                    force_req.force,
                    fleet_snapshot,
                )),
            )
                .into_response();
            resp.headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            resp
        }
        CoordinatorForceSuspendResult::ActiveFleetRequiresConfirmation { fleet_snapshot } => {
            idle_suspend_conflict_response(
                IdleSuspendErrorCode::ActiveFleetConfirmationRequired.as_code_str(),
                "active fleet requires explicit confirmation before force sleep",
                fleet_snapshot,
            )
        }
        CoordinatorForceSuspendResult::GenerationConflict { fleet_snapshot, .. } => {
            idle_suspend_conflict_response(
                IdleSuspendErrorCode::FleetChanged.as_code_str(),
                "fleet state changed during confirmation review",
                fleet_snapshot,
            )
        }
        CoordinatorForceSuspendResult::HandoffInProgress => idle_suspend_error_response(
            StatusCode::CONFLICT,
            IdleSuspendErrorCode::HandoffInProgress.as_code_str(),
            "cannot initiate force sleep while helper handoff is in progress",
        ),
        CoordinatorForceSuspendResult::CapabilityUnavailable(_detail) => {
            // Requirement 48: Sanitized, do not leak internal/helper details
            idle_suspend_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                IdleSuspendErrorCode::CapabilityUnavailable.as_code_str(),
                "host lacks RTC alarm or suspend capability",
            )
        }
        CoordinatorForceSuspendResult::AuditFailed(_err) => idle_suspend_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            IdleSuspendErrorCode::ForceSuspendAuditUnavailable.as_code_str(),
            "failed to record required audit entry before force sleep",
        ),
        CoordinatorForceSuspendResult::ValidationFailed(err) => idle_suspend_error_response(
            StatusCode::BAD_REQUEST,
            IdleSuspendErrorCode::InvalidForceSuspendPayload.as_code_str(),
            &err,
        ),
        CoordinatorForceSuspendResult::Disabled => idle_suspend_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            IdleSuspendErrorCode::CoordinatorDisabled.as_code_str(),
            "idle suspend coordinator is disabled",
        ),
        CoordinatorForceSuspendResult::ShuttingDown => idle_suspend_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            IdleSuspendErrorCode::CoordinatorShuttingDown.as_code_str(),
            "server is shutting down",
        ),
    }
}
