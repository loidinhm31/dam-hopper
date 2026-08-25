use std::net::SocketAddr;

use axum::{
    extract::{ConnectInfo, Extension, Path, Query, Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use zeroize::Zeroize;

use crate::{
    api::auth::{self, AuthenticatedActor},
    host_actions::{ActionIntentRequest, ApproveIntentRequest, ExecutionRequest, HostActionError},
    state::AppState,
};

/// Mutation requests using a cookie must prove they originated from this host.
/// Bearer callers are not browser-CSRF capable, but still require a one-shot approval.
pub async fn require_action_request(request: Request, next: Next) -> Response {
    let headers = request.headers();
    let json = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("application/json"));
    if !json {
        return action_response(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "invalidContentType",
            "action requests require application/json",
        );
    }
    let uses_cookie = headers.get(header::COOKIE).is_some();
    if uses_cookie && !same_origin(headers) {
        return action_response(
            StatusCode::FORBIDDEN,
            "invalidOrigin",
            "action request origin is not allowed",
        );
    }
    next.run(request).await
}

pub async fn capabilities(State(state): State<AppState>) -> impl IntoResponse {
    Json(
        state
            .host_actions
            .capabilities(state.no_auth, state.db.is_some()),
    )
}

pub async fn create_intent(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    Json(request): Json<ActionIntentRequest>,
) -> Response {
    let actor = match enabled_actor(&state, actor).await {
        Ok(actor) => actor,
        Err(response) => return *response,
    };
    if let Err(response) = helper_available(&state) {
        return *response;
    }
    match state
        .host_actions
        .create_intent(
            &actor.subject,
            request,
            state.host_resource_monitor.snapshot().await,
        )
        .await
    {
        Ok(challenge) => (StatusCode::CREATED, Json(challenge)).into_response(),
        Err(error) => action_error(error),
    }
}

pub async fn approve_intent(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    Path(intent_id): Path<String>,
    Json(mut request): Json<ApproveIntentRequest>,
) -> Response {
    let actor = match enabled_actor(&state, actor).await {
        Ok(actor) => actor,
        Err(response) => {
            request.password.zeroize();
            return *response;
        }
    };
    if let Err(response) = helper_available(&state) {
        request.password.zeroize();
        return *response;
    }
    let ip = connect
        .as_ref()
        .map(|Extension(item)| item.0.ip().to_string());
    if let Err(error) = state
        .host_actions
        .check_reauth_allowed(&actor.subject, ip.as_deref())
        .await
    {
        request.password.zeroize();
        return action_error(error);
    }
    if auth::verify_actor_credentials(&state, &actor, &request.username, &mut request.password)
        .await
        .is_err()
    {
        state
            .host_actions
            .record_reauth_failure(&actor.subject, ip.as_deref())
            .await;
        return action_response(
            StatusCode::UNAUTHORIZED,
            "reauthFailed",
            "re-authentication failed",
        );
    }
    match state
        .host_actions
        .approve(&actor.subject, &intent_id, &request.challenge_nonce)
        .await
    {
        Ok((approval_token, expires_at)) => (
            StatusCode::OK,
            Json(serde_json::json!({"approvalToken": approval_token, "expiresAt": expires_at})),
        )
            .into_response(),
        Err(error) => action_error(error),
    }
}

pub async fn create_execution(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    Json(request): Json<ExecutionRequest>,
) -> Response {
    let actor = match enabled_actor(&state, actor).await {
        Ok(actor) => actor,
        Err(response) => return *response,
    };
    if let Err(response) = helper_available(&state) {
        return *response;
    }
    match state
        .host_actions
        .submit(&actor.subject, &request.intent_id, &request.approval_token)
        .await
    {
        Ok(execution) => (StatusCode::ACCEPTED, Json(execution)).into_response(),
        Err(error) => action_error(error),
    }
}

pub async fn get_execution(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    Path(execution_id): Path<String>,
) -> Response {
    let actor = match enabled_actor(&state, actor).await {
        Ok(actor) => actor,
        Err(response) => return *response,
    };
    match state
        .host_actions
        .execution_for_actor(&actor.subject, &execution_id)
        .await
    {
        Some(execution) => Json(execution).into_response(),
        None => Json(serde_json::json!({
            "executionId": execution_id,
            "state": "unknown",
            "code": "executionLostOrUnknown",
        }))
        .into_response(),
    }
}

#[derive(Deserialize)]
pub struct AuditQuery {
    pub cursor: Option<String>,
    pub limit: Option<usize>,
}

pub async fn get_audit(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    Query(query): Query<AuditQuery>,
) -> Response {
    let actor = match enabled_actor(&state, actor).await {
        Ok(actor) => actor,
        Err(response) => return *response,
    };
    match state
        .host_actions
        .audit_for_actor(actor.subject, query.cursor, query.limit.unwrap_or(50))
        .await
    {
        Ok(page) => Json(page).into_response(),
        Err(_) => action_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "auditUnavailable",
            "host action audit storage is unavailable",
        ),
    }
}

async fn enabled_actor(
    state: &AppState,
    actor: Option<Extension<AuthenticatedActor>>,
) -> Result<AuthenticatedActor, Box<Response>> {
    if state.no_auth {
        return Err(Box::new(action_response(
            StatusCode::FORBIDDEN,
            "actionsDisabledNoAuth",
            "host actions are disabled in no-auth mode",
        )));
    }
    if state.db.is_none() {
        return Err(Box::new(action_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "reauthUnavailable",
            "host actions require configured authentication",
        )));
    }
    let actor = actor.map(|Extension(actor)| actor).ok_or_else(|| {
        Box::new(action_response(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "authentication is required",
        ))
    })?;
    if !auth::is_enabled_user(state.db.as_ref(), &actor.subject).await {
        return Err(Box::new(action_response(
            StatusCode::FORBIDDEN,
            "actorDisabled",
            "host actions require an enabled account",
        )));
    }
    Ok(actor)
}

fn helper_available(state: &AppState) -> Result<(), Box<Response>> {
    if state
        .host_actions
        .capabilities(state.no_auth, state.db.is_some())
        .available
    {
        Ok(())
    } else {
        Err(Box::new(action_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "helperNotEnrolled",
            "host action helper is not enrolled",
        )))
    }
}

fn same_origin(headers: &axum::http::HeaderMap) -> bool {
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

fn action_error(error: HostActionError) -> Response {
    let (status, code) = match error {
        HostActionError::InvalidIntent => (StatusCode::BAD_REQUEST, "invalidIntent"),
        HostActionError::StaleTarget => (StatusCode::CONFLICT, "staleTarget"),
        HostActionError::CapabilityUnavailable => {
            (StatusCode::SERVICE_UNAVAILABLE, "capabilityUnavailable")
        }
        HostActionError::IntentLimit | HostActionError::QueueFull => {
            (StatusCode::TOO_MANY_REQUESTS, "queueFull")
        }
        HostActionError::Cooldown => (StatusCode::TOO_MANY_REQUESTS, "cacheCooldown"),
        HostActionError::IntentExpired | HostActionError::InvalidApproval => {
            (StatusCode::CONFLICT, "invalidApproval")
        }
        HostActionError::AuditUnavailable | HostActionError::Unavailable => {
            (StatusCode::SERVICE_UNAVAILABLE, "helperUnavailable")
        }
        HostActionError::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "reauthRateLimited"),
    };
    action_response(status, code, &error.to_string())
}

fn action_response(status: StatusCode, code: &'static str, error: &str) -> Response {
    (
        status,
        Json(serde_json::json!({"error": error, "code": code})),
    )
        .into_response()
}
