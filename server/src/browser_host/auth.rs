use std::fmt;
use std::net::SocketAddr;
use std::time::Duration;

use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use serde_json::json;
use tracing::warn;

use crate::api::auth::AuthenticatedActor;
use crate::auth::model::UserRole;
use crate::state::AppState;

pub const LIVE_CHECK_INTERVAL: Duration = Duration::from_secs(5);
pub const LIVE_CHECK_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserAdmission {
    pub principal: String,
    pub is_dev: bool,
    pub session_id: Option<String>,
    pub auth_version: Option<i64>,
    pub credential_version: Option<i64>,
    pub effective_deadline: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrowserAuthError {
    Unauthorized(String),
    AdminRequired(String),
    DevBypassDenied(String),
    AccountDisabled(String),
    SessionRevoked(String),
    SessionExpired(String),
    OriginForbidden(String),
    StorageUnavailable(String),
}

impl BrowserAuthError {
    pub fn status_code(&self) -> StatusCode {
        match self {
            Self::Unauthorized(_) | Self::SessionRevoked(_) | Self::SessionExpired(_) => {
                StatusCode::UNAUTHORIZED
            }
            Self::AdminRequired(_) | Self::DevBypassDenied(_) | Self::AccountDisabled(_) | Self::OriginForbidden(_) => {
                StatusCode::FORBIDDEN
            }
            Self::StorageUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::Unauthorized(_) => "unauthorized",
            Self::AdminRequired(_) => "adminRequired",
            Self::DevBypassDenied(_) => "devBypassDenied",
            Self::AccountDisabled(_) => "accountDisabled",
            Self::SessionRevoked(_) => "sessionRevoked",
            Self::SessionExpired(_) => "sessionExpired",
            Self::OriginForbidden(_) => "originForbidden",
            Self::StorageUnavailable(_) => "authUnavailable",
        }
    }
}

impl fmt::Display for BrowserAuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unauthorized(msg) => write!(f, "unauthorized: {msg}"),
            Self::AdminRequired(msg) => write!(f, "admin required: {msg}"),
            Self::DevBypassDenied(msg) => write!(f, "dev bypass denied: {msg}"),
            Self::AccountDisabled(msg) => write!(f, "account disabled: {msg}"),
            Self::SessionRevoked(msg) => write!(f, "session revoked: {msg}"),
            Self::SessionExpired(msg) => write!(f, "session expired: {msg}"),
            Self::OriginForbidden(msg) => write!(f, "origin forbidden: {msg}"),
            Self::StorageUnavailable(msg) => write!(f, "auth storage unavailable: {msg}"),
        }
    }
}
impl std::error::Error for BrowserAuthError {}

impl IntoResponse for BrowserAuthError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let payload = json!({
            "error": self.to_string(),
            "kind": self.kind(),
        });
        (status, axum::Json(payload)).into_response()
    }
}

/// Evaluates Browser host admission for an incoming HTTP or WebSocket upgrade request.
///
/// In production:
/// - Requires an authenticated actor.
/// - Validates live in the database that the user account is enabled and has the Admin role.
/// - Validates that the session is active, not revoked, and auth/credential versions match.
///
/// In development (`state.no_auth == true`):
/// - Requires state.no_auth.
/// - Requires peer IP address to be loopback (127.0.0.1 or ::1).
/// - If `Origin` header is present, it must match an exact configured web origin.
/// - Forwarded headers (`X-Forwarded-For`, etc.) are explicitly ignored.
/// - Origin-less requests are allowed only for loopback peers (native tools/agents).
pub async fn evaluate_browser_admission(
    state: &AppState,
    headers: &HeaderMap,
    peer_addr: Option<SocketAddr>,
    actor: Option<&AuthenticatedActor>,
) -> Result<BrowserAdmission, BrowserAuthError> {
    if state.no_auth {
        // Dev bypass validation
        let Some(addr) = peer_addr else {
            warn!("Browser dev bypass rejected: missing peer address");
            return Err(BrowserAuthError::DevBypassDenied(
                "peer address information is missing".to_string(),
            ));
        };

        if !addr.ip().is_loopback() {
            warn!(peer = %addr, "Browser dev bypass rejected: non-loopback peer");
            return Err(BrowserAuthError::DevBypassDenied(
                "peer address must be loopback for dev bypass".to_string(),
            ));
        }

        // Validate Origin header if present (single header only)
        if headers.get_all(header::ORIGIN).iter().count() > 1 {
            return Err(BrowserAuthError::OriginForbidden("multiple Origin headers not allowed".to_string()));
        }
        if let Some(origin_val) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
            if origin_val == "null" || origin_val.ends_with('/') || origin_val.contains(',') {
                warn!(origin = origin_val, "Browser dev bypass rejected: malformed Origin");
                return Err(BrowserAuthError::DevBypassDenied("malformed Origin header".to_string()));
            }

            let matched = state.cors_origins.iter().any(|allowed| allowed == origin_val);
            let allowed_fallback = state.cors_origins.is_empty()
                && (origin_val == "http://127.0.0.1:5173" || origin_val == "http://localhost:5173");

            if !matched && !allowed_fallback {
                warn!(origin = origin_val, "Browser dev bypass rejected: unapproved Origin");
                return Err(BrowserAuthError::DevBypassDenied(format!(
                    "Origin '{origin_val}' does not match configured web origin"
                )));
            }
        }

        return Ok(BrowserAdmission {
            principal: "dev-user".to_string(),
            is_dev: true,
            session_id: None,
            auth_version: None,
            credential_version: None,
            effective_deadline: None,
        });
    }

    // Production mode validation (single header only)
    if headers.get_all(header::ORIGIN).iter().count() > 1 {
        return Err(BrowserAuthError::OriginForbidden("multiple Origin headers not allowed".to_string()));
    }
    if let Some(origin_val) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        if origin_val == "null" || origin_val.ends_with('/') || origin_val.contains(',') {
            return Err(BrowserAuthError::OriginForbidden("malformed Origin header".to_string()));
        }
        let matched = state.cors_origins.iter().any(|allowed| allowed == origin_val);
        if !matched && !state.cors_origins.is_empty() {
            warn!(origin = origin_val, "Browser admission rejected: unapproved Origin");
            return Err(BrowserAuthError::OriginForbidden(format!(
                "Origin '{origin_val}' does not match configured web origin"
            )));
        }
    }

    let Some(actor) = actor else {
        return Err(BrowserAuthError::Unauthorized(
            "authentication is required to access browser host".to_string(),
        ));
    };

    let now = state.auth_service.clock().now();
    if let Some(deadline) = actor.effective_deadline {
        if now >= deadline {
            return Err(BrowserAuthError::SessionExpired(
                "session deadline has passed".to_string(),
            ));
        }
    }

    // Check store or mock user
    if let Some(store) = state.auth_service.store() {
        let user = match store.get_user(&actor.subject).await {
            Ok(Some(u)) => u,
            Ok(None) => {
                return Err(BrowserAuthError::Unauthorized("user not found".to_string()));
            }
            Err(e) => {
                return Err(BrowserAuthError::StorageUnavailable(format!(
                    "database error looking up user: {e}"
                )));
            }
        };

        if !user.is_enabled {
            return Err(BrowserAuthError::AccountDisabled(
                "user account is disabled".to_string(),
            ));
        }

        if user.role != UserRole::Admin {
            return Err(BrowserAuthError::AdminRequired(
                "browser host requires enabled Admin role".to_string(),
            ));
        }

        if let Some(sid) = &actor.session_id {
            let session = match store.get_session(sid).await {
                Ok(Some(s)) => s,
                Ok(None) => {
                    return Err(BrowserAuthError::Unauthorized("session not found".to_string()));
                }
                Err(e) => {
                    return Err(BrowserAuthError::StorageUnavailable(format!(
                        "database error looking up session: {e}"
                    )));
                }
            };

            if session.revoked_at.is_some() {
                return Err(BrowserAuthError::SessionRevoked(
                    "session has been revoked".to_string(),
                ));
            }

            if session.auth_version != user.auth_version {
                return Err(BrowserAuthError::SessionRevoked(
                    "auth version mismatch".to_string(),
                ));
            }

            if let Some(req_av) = actor.auth_version {
                if session.auth_version != req_av {
                    return Err(BrowserAuthError::SessionRevoked(
                        "auth version mismatch against actor token".to_string(),
                    ));
                }
            }

            if let Some(req_cv) = actor.credential_version {
                if session.credential_version != req_cv {
                    return Err(BrowserAuthError::SessionRevoked(
                        "credential version mismatch against actor token".to_string(),
                    ));
                }
            }
        }
    } else if let Some(mock) = state.auth_service.mock_user() {
        if mock.username != actor.subject {
            return Err(BrowserAuthError::Unauthorized("user not found".to_string()));
        }
        if !mock.is_enabled {
            return Err(BrowserAuthError::AccountDisabled(
                "user account is disabled".to_string(),
            ));
        }
        if mock.role != UserRole::Admin {
            return Err(BrowserAuthError::AdminRequired(
                "browser host requires enabled Admin role".to_string(),
            ));
        }
    } else {
        return Err(BrowserAuthError::StorageUnavailable(
            "authentication backend is not configured".to_string(),
        ));
    }

    Ok(BrowserAdmission {
        principal: actor.subject.clone(),
        is_dev: false,
        session_id: actor.session_id.clone(),
        auth_version: actor.auth_version,
        credential_version: actor.credential_version,
        effective_deadline: actor.effective_deadline,
    })
}

/// Rechecks live admission status during long-running streaming and attachment connections.
///
/// Returns Ok(()) if the account is still enabled, has the Admin role, and the session is not revoked.
pub async fn verify_live_admission(
    state: &AppState,
    admission: &BrowserAdmission,
) -> Result<(), BrowserAuthError> {
    if admission.is_dev {
        if !state.no_auth {
            return Err(BrowserAuthError::DevBypassDenied(
                "dev bypass is no longer enabled on server".to_string(),
            ));
        }
        return Ok(());
    }

    let now = state.auth_service.clock().now();
    if let Some(deadline) = admission.effective_deadline {
        if now >= deadline {
            return Err(BrowserAuthError::SessionExpired(
                "session deadline has passed".to_string(),
            ));
        }
    }

    if let Some(store) = state.auth_service.store() {
        let check_res = tokio::time::timeout(LIVE_CHECK_TIMEOUT, async {
            let user = store.get_user(&admission.principal).await?;
            let session = match &admission.session_id {
                Some(sid) => store.get_session(sid).await?,
                None => None,
            };
            Ok::<_, crate::auth::store::StoreError>((user, session))
        })
        .await;

        match check_res {
            Ok(Ok((Some(user), session_opt))) => {
                if !user.is_enabled {
                    return Err(BrowserAuthError::AccountDisabled(
                        "user account was disabled".to_string(),
                    ));
                }
                if user.role != UserRole::Admin {
                    return Err(BrowserAuthError::AdminRequired(
                        "user was demoted from Admin role".to_string(),
                    ));
                }
                if let Some(session) = session_opt {
                    if session.revoked_at.is_some() {
                        return Err(BrowserAuthError::SessionRevoked(
                            "session was revoked".to_string(),
                        ));
                    }
                    if let Some(av) = admission.auth_version {
                        if session.auth_version != av || user.auth_version != av {
                            return Err(BrowserAuthError::SessionRevoked(
                                "auth version incremented".to_string(),
                            ));
                        }
                    }
                    if let Some(cv) = admission.credential_version {
                        if session.credential_version != cv {
                            return Err(BrowserAuthError::SessionRevoked(
                                "credential version incremented".to_string(),
                            ));
                        }
                    }
                } else if admission.session_id.is_some() {
                    return Err(BrowserAuthError::SessionRevoked(
                        "session was deleted from store".to_string(),
                    ));
                }
            }
            Ok(Ok((None, _))) => {
                return Err(BrowserAuthError::Unauthorized("user was deleted".to_string()));
            }
            Ok(Err(e)) => {
                return Err(BrowserAuthError::StorageUnavailable(format!(
                    "database live check failed: {e}"
                )));
            }
            Err(_) => {
                return Err(BrowserAuthError::StorageUnavailable(
                    "database live check timed out after 2s".to_string(),
                ));
            }
        }
    } else if let Some(mock) = state.auth_service.mock_user() {
        if mock.username != admission.principal {
            return Err(BrowserAuthError::Unauthorized("user not found".to_string()));
        }
        if !mock.is_enabled {
            return Err(BrowserAuthError::AccountDisabled(
                "user account is disabled".to_string(),
            ));
        }
        if mock.role != UserRole::Admin {
            return Err(BrowserAuthError::AdminRequired(
                "user was demoted from Admin role".to_string(),
            ));
        }
    } else {
        return Err(BrowserAuthError::StorageUnavailable(
            "no auth store or mock backend available for live validation".to_string(),
        ));
    }

    Ok(())
}
