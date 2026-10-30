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
use crate::session_changes::capture::{
    activate_session_baseline, fail_session_capture, prepare_session_capture,
    receive_session_receipt, PrepareOutcome,
};
use crate::session_changes::comparison::run_comparison_scan;
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
}

fn error_response(status: StatusCode, code: ErrorCode, reason: impl Into<String>) -> Response {
    let body = ErrorBody {
        version: 1,
        code,
        retryable: false,
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
        .route("/prepare", post(handle_prepare))
        .route("/activate", post(handle_activate))
        .route("/receipt", post(handle_receipt))
        .route("/fail", post(handle_fail))
        .route("/lookup", post(handle_lookup))
        .route("/settled", post(handle_settled))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BODY_BYTES))
        .with_state(state)
}

async fn handle_prepare(
    State(state): State<ControlRouterState>,
    headers: HeaderMap,
    Json(req): Json<PrepareRequest>,
) -> Response {
    let (terminal_id, incarnation) = match authenticate_request(&headers, &state.runtime) {
        Ok(pair) => pair,
        Err(resp) => return resp,
    };

    let _permit = match CONTROL_CONCURRENCY_SEMAPHORE.try_acquire() {
        Ok(p) => p,
        Err(_) => {
            return error_response(
                StatusCode::TOO_MANY_REQUESTS,
                ErrorCode::Busy,
                "Control concurrency saturated",
            );
        }
    };

    let service = match state.get_service() {
        Some(s) => s,
        None => {
            return error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorCode::TargetUnavailable,
                "Session changes service is unavailable",
            );
        }
    };

    // Determine target project root from bound target (strictly forbid falling back to '.')
    let bound = match service.get_bound_terminal_target(&terminal_id, incarnation) {
        Some(b) => b,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                ErrorCode::TargetUnavailable,
                "Terminal target is not bound or incarnation mismatched",
            );
        }
    };
    let project_root = bound.launch_cwd;

    match prepare_session_capture(
        &service,
        terminal_id,
        incarnation.to_string(),
        &project_root,
        req,
    )
    .await
    {
        Ok(PrepareOutcome::Prepared(receipt)) => success_json(receipt),
        Ok(PrepareOutcome::Existing(existing)) => success_json(existing),
        Err(ErrorCode::Capacity) => error_response(
            StatusCode::TOO_MANY_REQUESTS,
            ErrorCode::Capacity,
            "Capacity limit exceeded",
        ),
        Err(ErrorCode::Busy) => error_response(
            StatusCode::CONFLICT,
            ErrorCode::Busy,
            "Scan in progress",
        ),
        Err(code) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            code,
            "Prepare capture failed",
        ),
    }
}

async fn handle_activate(
    State(state): State<ControlRouterState>,
    headers: HeaderMap,
    Json(req): Json<ActivationRequest>,
) -> Response {
    let (terminal_id, incarnation) = match authenticate_request(&headers, &state.runtime) {
        Ok(pair) => pair,
        Err(resp) => return resp,
    };

    let key = SessionChangesKey {
        terminal_id,
        terminal_incarnation: incarnation.to_string(),
        omp_session_id: req.omp_session_id.clone(),
        root_id: req.root_id.clone(),
    };

    let service = match state.get_service() {
        Some(s) => s,
        None => return error_response(StatusCode::SERVICE_UNAVAILABLE, ErrorCode::TargetUnavailable, "Service unavailable"),
    };
    match activate_session_baseline(&service, &key, &req) {
        Ok(receipt) => success_json(receipt),
        Err(ErrorCode::RegistrationExpired) => error_response(
            StatusCode::GONE,
            ErrorCode::RegistrationExpired,
            "Prepared registration expired",
        ),
        Err(ErrorCode::ServerRestarted) => error_response(
            StatusCode::GONE,
            ErrorCode::ServerRestarted,
            "Server epoch mismatch",
        ),
        Err(code) => error_response(
            StatusCode::BAD_REQUEST,
            code,
            "Activation failed",
        ),
    }
}

async fn handle_receipt(
    State(state): State<ControlRouterState>,
    headers: HeaderMap,
    Json(req): Json<ReceiptRequest>,
) -> Response {
    let (terminal_id, incarnation) = match authenticate_request(&headers, &state.runtime) {
        Ok(pair) => pair,
        Err(resp) => return resp,
    };

    let key = SessionChangesKey {
        terminal_id,
        terminal_incarnation: incarnation.to_string(),
        omp_session_id: req.omp_session_id.clone(),
        root_id: req.root_id.clone(),
    };

    let service = match state.get_service() {
        Some(s) => s,
        None => return error_response(StatusCode::SERVICE_UNAVAILABLE, ErrorCode::TargetUnavailable, "Service unavailable"),
    };
    match receive_session_receipt(&service, &key, &req) {
        Ok(resp) => success_json(resp),
        Err(code) => error_response(StatusCode::BAD_REQUEST, code, "Receipt failed"),
    }
}

async fn handle_fail(
    State(state): State<ControlRouterState>,
    headers: HeaderMap,
    Json(req): Json<FailureRequest>,
) -> Response {
    let (terminal_id, incarnation) = match authenticate_request(&headers, &state.runtime) {
        Ok(pair) => pair,
        Err(resp) => return resp,
    };

    let key = SessionChangesKey {
        terminal_id,
        terminal_incarnation: incarnation.to_string(),
        omp_session_id: req.omp_session_id.clone(),
        root_id: ".".into(),
    };

    let service = match state.get_service() {
        Some(s) => s,
        None => return error_response(StatusCode::SERVICE_UNAVAILABLE, ErrorCode::TargetUnavailable, "Service unavailable"),
    };
    match fail_session_capture(&service, &key, &req) {
        Ok(resp) => success_json(resp),
        Err(code) => error_response(StatusCode::BAD_REQUEST, code, "Fail notification rejected"),
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

    let key = SessionChangesKey {
        terminal_id,
        terminal_incarnation: incarnation.to_string(),
        omp_session_id: req.omp_session_id.clone(),
        root_id: req.root_id.clone(),
    };

    let service = match state.get_service() {
        Some(s) => s,
        None => return error_response(StatusCode::SERVICE_UNAVAILABLE, ErrorCode::TargetUnavailable, "Service unavailable"),
    };
    let records = service.records.lock();
    if let Some(rec) = records.get(&key) {
        if rec.active_from_now.is_some() || rec.state == StatusState::Ready || rec.state == StatusState::Incomplete {
            drop(records);
            let status = service.build_status(&key);
            return success_json(LookupResult::Active {
                version: 1,
                status,
            });
        }
        if rec.original_failed {
            return success_json(LookupResult::Unavailable {
                version: 1,
                server_epoch: service.server_epoch.clone(),
                terminal_incarnation: incarnation.to_string(),
                omp_session_id: req.omp_session_id,
                root_id: req.root_id,
                reason: ErrorCode::OriginalUnavailable,
            });
        }
        success_json(LookupResult::Unavailable {
            version: 1,
            server_epoch: service.server_epoch.clone(),
            terminal_incarnation: incarnation.to_string(),
            omp_session_id: req.omp_session_id,
            root_id: req.root_id,
            reason: ErrorCode::AcknowledgmentPending,
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

    let key = SessionChangesKey {
        terminal_id,
        terminal_incarnation: incarnation.to_string(),
        omp_session_id: req.omp_session_id.clone(),
        root_id: req.root_id.clone(),
    };

    let service = match state.get_service() {
        Some(s) => s,
        None => {
            return error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorCode::TargetUnavailable,
                "Service unavailable",
            );
        }
    };

    let mut is_duplicate = false;
    {
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

        if req.server_epoch != service.server_epoch {
            return error_response(
                StatusCode::GONE,
                ErrorCode::ServerRestarted,
                "Server epoch mismatch",
            );
        }
        if rec.baseline_id.as_deref() != Some(&req.baseline_id) {
            return error_response(
                StatusCode::BAD_REQUEST,
                ErrorCode::BaselineMissing,
                "Baseline ID mismatch on settled turn",
            );
        }
        if rec.recent_turn_ids.contains(&req.turn_id) {
            is_duplicate = true;
        } else {
            rec.recent_turn_ids.insert(req.turn_id.clone());
            if rec.recent_turn_ids.len() > 64 {
                let first = rec.recent_turn_ids.iter().next().cloned();
                if let Some(f) = first {
                    rec.recent_turn_ids.remove(&f);
                }
            }
        }
    }

    if !is_duplicate {
        let service_clone = Arc::clone(&service);
        let key_clone = key.clone();
        let turn_id = req.turn_id.clone();
        tokio::spawn(async move {
            let _ = run_comparison_scan(&service_clone, &key_clone, Some(turn_id)).await;
        });
    }

    success_json(SettledResponse {
        version: 1,
        accepted: true,
        duplicate: is_duplicate,
    })
}
