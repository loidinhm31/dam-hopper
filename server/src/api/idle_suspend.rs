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
        policy::validate_timing_pair,
        protocol::{
            IdleSuspendErrorCode, IdleSuspendTimingPatchRequest, IdleSuspendTimingPatchResponse,
        },
        status::{CoordinatorState, IdleSuspendStatusV1},
        CoordinatorTimingResult, UpdateTimingCommand,
    },
    state::AppState,
};

/// Format error response with standard closed `{ "error": ..., "code": ... }` shape.
pub fn idle_suspend_error_response(
    status: StatusCode,
    code: &'static str,
    error: &str,
) -> Response {
    (
        status,
        Json(json!({
            "error": error,
            "code": code,
        })),
    )
        .into_response()
}

/// Helper to verify same-origin on browser requests that use session cookies.
pub fn same_origin(headers: &HeaderMap) -> bool {
    let Some(origin) = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let Some(host) = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    origin == format!("http://{host}") || origin == format!("https://{host}")
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
        IdleSuspendStatusV1 {
            version: 1,
            status_revision: 0,
            state: CoordinatorState::Disabled,
            enabled: state.idle_suspend_policy.enabled,
            timing_mutable: false,
            timing_mutable_reason: Some("disabled".to_string()),
            capability_code: state.idle_suspend_policy.capability_selection.as_str().to_string(),
            current_epoch: 0,
            quiet_period_seconds: quiet,
            wake_after_seconds: wake,
            min_quiet_period_seconds: crate::config::MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
            max_quiet_period_seconds: crate::config::MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
            min_wake_after_seconds: crate::config::MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
            max_wake_after_seconds: crate::config::MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
            fleet_snapshot: fleet,
            arm_deadline_ms: None,
            last_outcome: None,
            detail: Some("coordinatorNotStarted".to_string()),
            timestamp_ms: IdleSuspendStatusV1::now_ms(),
        }
    };

    let mut response = Json(status).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
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
    let headers = request.headers();

    // 1. Enforce application/json Content-Type
    let is_json = headers
        .get(header::CONTENT_TYPE)
        .and_then(|val| val.to_str().ok())
        .is_some_and(|val| val.starts_with("application/json"));
    if !is_json {
        return idle_suspend_error_response(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            IdleSuspendErrorCode::InvalidContentType.as_code_str(),
            "timing mutation requires application/json",
        );
    }

    // 2. CSRF Origin check if session cookie is present
    let uses_cookie = headers.get(header::COOKIE).is_some();
    if uses_cookie && !same_origin(headers) {
        return idle_suspend_error_response(
            StatusCode::FORBIDDEN,
            IdleSuspendErrorCode::InvalidOrigin.as_code_str(),
            "timing mutation origin is not allowed",
        );
    }

    // 3. Deny under --no-auth
    if state.no_auth {
        return idle_suspend_error_response(
            StatusCode::FORBIDDEN,
            IdleSuspendErrorCode::DisabledNoAuth.as_code_str(),
            "idle suspend timing mutation is disabled in no-auth mode",
        );
    }

    // 4. Require database-backed authentication
    if state.db.is_none() {
        return idle_suspend_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            IdleSuspendErrorCode::AuthenticationUnavailable.as_code_str(),
            "idle suspend timing requires configured authentication",
        );
    }

    // 5. Require authenticated actor
    let Some(Extension(actor)) = actor else {
        return idle_suspend_error_response(
            StatusCode::UNAUTHORIZED,
            IdleSuspendErrorCode::Unauthorized.as_code_str(),
            "authentication is required",
        );
    };

    // 6. Require enabled user account
    if !auth::is_enabled_user(state.db.as_ref(), &actor.subject).await {
        return idle_suspend_error_response(
            StatusCode::FORBIDDEN,
            IdleSuspendErrorCode::ActorDisabled.as_code_str(),
            "idle suspend timing requires an enabled account",
        );
    }

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
    if let Err(err) = validate_timing_pair(
        patch_req.quiet_period_seconds,
        patch_req.wake_after_seconds,
    ) {
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
        } => (
            StatusCode::OK,
            Json(IdleSuspendTimingPatchResponse::new(
                changed,
                status_revision,
                quiet_period_seconds,
                wake_after_seconds,
            )),
        )
            .into_response(),
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
