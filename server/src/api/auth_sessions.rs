//! Account-scoped login inventory. Authentication is supplied by the existing middleware.
use axum::{
    extract::{rejection::QueryRejection, Path, Query, Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Extension,
};
use serde::{Deserialize, Serialize};

use super::auth::{AuthenticatedActor, CredentialMechanism};
use super::auth_mfa::{auth_error_response, no_store_json_response};
use crate::auth::model::{bson_to_chrono, AuthSession};
use crate::auth::session_inventory::{SessionCursor, SESSION_PAGE_SIZE};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct ListQuery {
    cursor: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfo {
    id: String,
    user_agent: Option<String>,
    issued_at: String,
    expires_at: String,
    mfa_verified_at: String,
    current: bool,
}

impl SessionInfo {
    fn new(session: AuthSession, current_id: Option<&str>) -> Self {
        Self {
            current: current_id == Some(session.id.as_str()),
            id: session.id,
            user_agent: session.user_agent,
            issued_at: bson_to_chrono(session.issued_at).to_rfc3339(),
            expires_at: bson_to_chrono(session.expires_at).to_rfc3339(),
            mfa_verified_at: bson_to_chrono(session.mfa_verified_at).to_rfc3339(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionPage {
    sessions: Vec<SessionInfo>,
    next_cursor: Option<String>,
}

fn unavailable() -> Response {
    auth_error_response(StatusCode::CONFLICT, "DEVICE_SESSIONS_UNAVAILABLE",
        "Login devices are unavailable in development bypass mode", None)
}

fn storage_failure() -> Response {
    auth_error_response(StatusCode::SERVICE_UNAVAILABLE, "AUTH_UNAVAILABLE",
        "Authentication storage unavailable", None)
}

/// Wraps authentication too: rejection and extractor errors must never be cached.
pub async fn no_store(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

pub async fn list(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Response {
    if state.no_auth {
        return unavailable();
    }
    let cursor = match query {
        Ok(Query(query)) => match query.cursor.as_deref().map(SessionCursor::decode).transpose() {
            Ok(cursor) => cursor,
            Err(_) => return auth_error_response(StatusCode::BAD_REQUEST, "INVALID_CURSOR", "Invalid session cursor", None),
        },
        Err(_) => return auth_error_response(StatusCode::BAD_REQUEST, "INVALID_CURSOR", "Invalid session cursor", None),
    };
    let (Some(store), Some(auth_version)) = (state.auth_service.store(), actor.auth_version) else {
        return storage_failure();
    };
    let Ok(mut sessions) = store.list_active_sessions(
        &actor.subject, auth_version, state.auth_service.clock().now(), cursor.as_ref(),
    ).await else {
        return storage_failure();
    };
    let next_cursor = if sessions.len() > SESSION_PAGE_SIZE {
        sessions.truncate(SESSION_PAGE_SIZE);
        sessions.last().map(|session| SessionCursor::from_session(session).encode())
    } else {
        None
    };
    no_store_json_response(StatusCode::OK, SessionPage {
        sessions: sessions.into_iter().map(|session| SessionInfo::new(session, actor.session_id.as_deref())).collect(),
        next_cursor,
    })
}

pub async fn revoke(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    Extension(mechanism): Extension<CredentialMechanism>,
    Path(id): Path<String>,
) -> Response {
    if state.no_auth {
        return unavailable();
    }
    // A malformed Authorization header may authenticate via a cookie, but only
    // the explicit bearer credential validated by require_auth can revoke sessions.
    if mechanism != CredentialMechanism::Bearer {
        return auth_error_response(StatusCode::FORBIDDEN, "BearerRequired",
            "Bearer token required to revoke login sessions; cookie credentials are not permitted", None);
    }
    let Some(store) = state.auth_service.store() else {
        return storage_failure();
    };
    match store.revoke_owned_session(&actor.subject, &id, state.auth_service.clock().now()).await {
        Err(_) => storage_failure(),
        Ok(false) => auth_error_response(StatusCode::NOT_FOUND, "SESSION_NOT_FOUND", "Session not found", None),
        Ok(true) => {
            state.media_tickets.revoke_by_actor_or_session(&actor.subject, Some(&id));
            StatusCode::NO_CONTENT.into_response()
        }
    }
}
