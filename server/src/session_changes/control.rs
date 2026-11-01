use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use std::sync::Arc;
use tokio::sync::Semaphore;

use crate::agent_status::runtime::{AgentStatusRuntime, TokenAuthResult};
use crate::session_changes::capture::{capture_session_paths, register_session};
use crate::session_changes::store::{SessionChangesKey, SessionChangesService};
use crate::session_changes::types::*;

static CONTROL_CONCURRENCY_SEMAPHORE: std::sync::LazyLock<Arc<Semaphore>> =
    std::sync::LazyLock::new(|| Arc::new(Semaphore::new(MAX_CONTROL_IN_FLIGHT)));

#[derive(Clone)]
pub struct ControlRouterState {
    pub runtime: AgentStatusRuntime,
    pub service: Option<Arc<SessionChangesService>>,
}

impl ControlRouterState {
    pub fn get_service(&self) -> Option<Arc<SessionChangesService>> {
        self.service.clone().or_else(|| self.runtime.session_changes())
    }

    pub fn get_enabled_service(&self) -> Result<Arc<SessionChangesService>, Response> {
        let service = self.get_service().ok_or_else(|| {
            error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorCode::TrackingDisabled,
                "Session changes service is unavailable",
            )
        })?;
        if !service.is_enabled() {
            return Err(error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorCode::TrackingDisabled,
                "Session changes service is disabled",
            ));
        }
        Ok(service)
    }
}

fn error_response(status: StatusCode, code: ErrorCode, reason: impl Into<String>) -> Response {
    let body = ErrorBody {
        version: 1,
        code,
        retryable: code == ErrorCode::Busy || code == ErrorCode::Deadline,
        current_revision: None,
        reason: reason.into(),
    };
    (
        status,
        [(header::CACHE_CONTROL, "no-store")],
        Json(body),
    )
        .into_response()
}

fn success_json<T: serde::Serialize>(val: T) -> Response {
    (
        StatusCode::OK,
        [(header::CACHE_CONTROL, "no-store")],
        Json(val),
    )
        .into_response()
}

fn map_error_code(code: ErrorCode, reason: &str) -> Response {
    let status = match code {
        ErrorCode::TrackingDisabled => StatusCode::SERVICE_UNAVAILABLE,
        ErrorCode::TargetUnavailable => StatusCode::NOT_FOUND,
        ErrorCode::BaselineMissing => StatusCode::NOT_FOUND,
        ErrorCode::FileMissing => StatusCode::NOT_FOUND,
        ErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
        ErrorCode::IncarnationMismatch => StatusCode::BAD_REQUEST,
        ErrorCode::SessionMismatch => StatusCode::BAD_REQUEST,
        ErrorCode::RootMismatch => StatusCode::BAD_REQUEST,
        ErrorCode::Unauthorized => StatusCode::UNAUTHORIZED,
        ErrorCode::AcknowledgmentPending => StatusCode::UNAUTHORIZED,
        ErrorCode::TerminalMissing => StatusCode::NOT_FOUND,
        ErrorCode::ServerRestarted => StatusCode::GONE,
        ErrorCode::RegistrationExpired => StatusCode::GONE,
        ErrorCode::OriginalUnavailable => StatusCode::CONFLICT,
        ErrorCode::RefreshRequired => StatusCode::CONFLICT,
        ErrorCode::Busy => StatusCode::CONFLICT,
        ErrorCode::Capacity => StatusCode::TOO_MANY_REQUESTS,
        ErrorCode::Deadline => StatusCode::GATEWAY_TIMEOUT,
        ErrorCode::RegistrationFailed => StatusCode::INTERNAL_SERVER_ERROR,
        ErrorCode::ResponseLimit => StatusCode::INTERNAL_SERVER_ERROR,
    };
    error_response(status, code, reason)
}

fn authenticate_request(
    headers: &HeaderMap,
    runtime: &AgentStatusRuntime,
) -> Result<(String, u64), Response> {
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| {
            error_response(
                StatusCode::UNAUTHORIZED,
                ErrorCode::Unauthorized,
                "Missing authorization header",
            )
        })?;

    let token = auth_header.strip_prefix("Bearer ").ok_or_else(|| {
        error_response(
            StatusCode::UNAUTHORIZED,
            ErrorCode::Unauthorized,
            "Invalid authorization scheme",
        )
    })?;

    match runtime.authenticate_bearer(token) {
        TokenAuthResult::Active {
            terminal_id,
            incarnation,
        } => Ok((terminal_id, incarnation)),
        TokenAuthResult::Pending => Err(error_response(
            StatusCode::UNAUTHORIZED,
            ErrorCode::AcknowledgmentPending,
            "Credential is pending publication",
        )),
        TokenAuthResult::InvalidOrRevoked => Err(error_response(
            StatusCode::UNAUTHORIZED,
            ErrorCode::Unauthorized,
            "Invalid or revoked bearer token",
        )),
    }
}

pub fn private_session_changes_router(
    runtime: AgentStatusRuntime,
    service: Option<Arc<SessionChangesService>>,
) -> Router {
    let state = ControlRouterState { runtime, service };
    Router::new()
        .route("/register", post(handle_register))
        .route("/capture", post(handle_capture))
        .route("/lookup", post(handle_lookup))
        .route("/settled", post(handle_settled))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BODY_BYTES))
        .with_state(state)
}

async fn handle_register(
    State(state): State<ControlRouterState>,
    headers: HeaderMap,
    Json(req): Json<RegisterRequest>,
) -> Response {
    let (terminal_id, incarnation) = match authenticate_request(&headers, &state.runtime) {
        Ok(pair) => pair,
        Err(resp) => return resp,
    };

    let service = match state.get_enabled_service() {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    let bound_target = match service.get_bound_terminal_target(&terminal_id, incarnation) {
        Some(t) => t,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                ErrorCode::TargetUnavailable,
                "Terminal target is not bound or incarnation mismatched",
            );
        }
    };

    let _permit = match CONTROL_CONCURRENCY_SEMAPHORE.try_acquire() {
        Ok(p) => p,
        Err(_) => {
            return error_response(
                StatusCode::CONFLICT,
                ErrorCode::Busy,
                "Control plane request limit exceeded",
            );
        }
    };

    match register_session(
        &service,
        terminal_id,
        incarnation.to_string(),
        &bound_target.launch_cwd,
        req,
    )
    .await
    {
        Ok(resp) => success_json(resp),
        Err(code) => map_error_code(code, "Registration failed"),
    }
}

async fn handle_capture(
    State(state): State<ControlRouterState>,
    headers: HeaderMap,
    Json(req): Json<CaptureRequest>,
) -> Response {
    let (terminal_id, incarnation) = match authenticate_request(&headers, &state.runtime) {
        Ok(pair) => pair,
        Err(resp) => return resp,
    };
    if req.version != 1 {
        return error_response(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidRequest,
            "Invalid version",
        );
    }
    if req.terminal_incarnation != incarnation.to_string() {
        return error_response(
            StatusCode::BAD_REQUEST,
            ErrorCode::IncarnationMismatch,
            "terminalIncarnation mismatch",
        );
    }

    let service = match state.get_enabled_service() {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    let _permit = match CONTROL_CONCURRENCY_SEMAPHORE.try_acquire() {
        Ok(p) => p,
        Err(_) => {
            return error_response(
                StatusCode::CONFLICT,
                ErrorCode::Busy,
                "Control plane request limit exceeded",
            );
        }
    };

    match capture_session_paths(&service, terminal_id, incarnation.to_string(), req).await {
        Ok(resp) => success_json(resp),
        Err(code) => map_error_code(code, "Capture failed"),
    }
}

async fn handle_lookup(
    State(state): State<ControlRouterState>,
    headers: HeaderMap,
    Json(req): Json<LookupRequest>,
) -> Response {
    let (terminal_id, incarnation) = match authenticate_request(&headers, &state.runtime) {
        Ok(pair) => pair,
        Err(resp) => return resp,
    };

    if req.version != 1 {
        return error_response(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidRequest,
            "Invalid version",
        );
    }

    let service = match state.get_enabled_service() {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    if let Some(known_epoch) = &req.known_server_epoch {
        if known_epoch != &service.server_epoch {
            return error_response(
                StatusCode::GONE,
                ErrorCode::ServerRestarted,
                "Server epoch mismatch",
            );
        }
    }

    let _permit = match CONTROL_CONCURRENCY_SEMAPHORE.try_acquire() {
        Ok(p) => p,
        Err(_) => {
            return error_response(
                StatusCode::CONFLICT,
                ErrorCode::Busy,
                "Control plane request limit exceeded",
            );
        }
    };

    let key = SessionChangesKey {
        terminal_id,
        terminal_incarnation: incarnation.to_string(),
        omp_session_id: req.omp_session_id.clone(),
        root_id: req.root_id.clone(),
    };

    let has_record = {
        let records = service.records.lock();
        records.contains_key(&key)
    };

    if has_record {
        let status = service.build_status(&key);
        success_json(LookupResult::Active {
            version: 1,
            status,
        })
    } else {
        success_json(LookupResult::Missing {
            version: 1,
            server_epoch: service.server_epoch.clone(),
            terminal_incarnation: incarnation.to_string(),
            omp_session_id: req.omp_session_id,
            root_id: req.root_id,
            reason: ErrorCode::BaselineMissing,
        })
    }
}

async fn handle_settled(
    State(state): State<ControlRouterState>,
    headers: HeaderMap,
    Json(req): Json<SettledRequest>,
) -> Response {
    let (terminal_id, incarnation) = match authenticate_request(&headers, &state.runtime) {
        Ok(pair) => pair,
        Err(resp) => return resp,
    };

    let service = match state.get_enabled_service() {
        Ok(s) => s,
        Err(resp) => return resp,
    };

    if req.version != 1 {
        return error_response(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidRequest,
            "Invalid version",
        );
    }
    if req.server_epoch != service.server_epoch {
        return error_response(
            StatusCode::GONE,
            ErrorCode::ServerRestarted,
            "Server epoch mismatch",
        );
    }

    if let Some(inc_str) = &req.terminal_incarnation {
        if inc_str != &incarnation.to_string() {
            return error_response(
                StatusCode::BAD_REQUEST,
                ErrorCode::IncarnationMismatch,
                "terminalIncarnation mismatch",
            );
        }
    }

    let _permit = match CONTROL_CONCURRENCY_SEMAPHORE.try_acquire() {
        Ok(p) => p,
        Err(_) => {
            return error_response(
                StatusCode::CONFLICT,
                ErrorCode::Busy,
                "Control plane request limit exceeded",
            );
        }
    };

    let key = SessionChangesKey {
        terminal_id,
        terminal_incarnation: incarnation.to_string(),
        omp_session_id: req.omp_session_id,
        root_id: req.root_id,
    };

    let mut records = service.records.lock();
    let rec = match records.get_mut(&key) {
        Some(r) => r,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                ErrorCode::BaselineMissing,
                "Baseline record missing",
            );
        }
    };

    if rec.baseline_id != req.baseline_id {
        return error_response(
            StatusCode::CONFLICT,
            ErrorCode::RefreshRequired,
            "Baseline ID mismatch",
        );
    }

    let duplicate = rec.recent_turn_ids.contains(&req.turn_id);
    rec.recent_turn_ids.insert(req.turn_id.clone());
    if rec.recent_turn_ids.len() > 64 {
        let oldest = rec.recent_turn_ids.iter().next().cloned();
        if let Some(o) = oldest {
            rec.recent_turn_ids.remove(&o);
        }
    }
    rec.last_settled_turn_id = Some(req.turn_id);
    rec.dirty_settled_hint = true;

    // Zero background diffing or file reading on settled!
    success_json(SettledResponse {
        version: 1,
        accepted: true,
        duplicate,
    })
}
