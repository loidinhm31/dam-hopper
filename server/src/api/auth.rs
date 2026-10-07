use axum::extract::Request;
use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use axum_extra::extract::CookieJar;
use bcrypt::{hash, verify, DEFAULT_COST};
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

use crate::api::auth_mfa::{auth_error_response, no_store_json_response, LoginChallengeResponse};
use crate::auth::model::{
    bson_to_chrono, chrono_to_bson, AuthChallenge, AuthClaims, AuthDecision, ChallengePurpose,
    UserRecord,
};
use crate::auth::policy::{
    check_account_throttle, compute_mfa_due_at, AUTH_PROTOCOL_VERSION, CHALLENGE_LIFETIME_SECS,
};
use crate::auth::totp::TotpEngine;
use crate::auth::{AuthService, AuthStore, StoreError};
use crate::state::AppState;

pub const AUTH_COOKIE: &str = "damhopper-auth";

// ---------------------------------------------------------------------------
// Error response
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

pub(crate) fn auth_cookie_header(value: &str, clear: bool) -> String {
    let max_age = if clear {
        "; Max-Age=0"
    } else {
        "; Max-Age=2592000"
    };
    format!("{AUTH_COOKIE}={value}; HttpOnly; SameSite=Strict; Path=/{max_age}")
}

pub(crate) fn unauthorized() -> Response {
    auth_error_response(
        StatusCode::UNAUTHORIZED,
        "AUTH_REQUIRED",
        "Authentication required",
        None,
    )
}
// ---------------------------------------------------------------------------
// Token / JWT helpers
// ---------------------------------------------------------------------------

/// Identity established by the protected-route middleware.
///
/// This intentionally contains no bearer material. Sensitive routes use it to
/// bind short-lived approvals to the authenticated account that requested them.
#[derive(Clone, Debug)]
pub struct AuthenticatedActor {
    pub subject: String,
    pub exp: Option<usize>,
    pub session_id: Option<String>,
    pub auth_version: Option<i64>,
    pub credential_version: Option<i64>,
    pub effective_deadline: Option<chrono::DateTime<chrono::Utc>>,
    pub role: Option<UserRole>,
}

impl AuthenticatedActor {
    pub fn new(subject: impl Into<String>, exp: Option<usize>) -> Self {
        Self {
            subject: subject.into(),
            exp,
            session_id: None,
            auth_version: None,
            credential_version: None,
            effective_deadline: None,
            role: None,
        }
    }

    pub fn with_session(
        subject: impl Into<String>,
        exp: Option<usize>,
        session_id: impl Into<String>,
        auth_version: i64,
        credential_version: i64,
        effective_deadline: chrono::DateTime<chrono::Utc>,
        role: UserRole,
    ) -> Self {
        Self {
            subject: subject.into(),
            exp,
            session_id: Some(session_id.into()),
            auth_version: Some(auth_version),
            credential_version: Some(credential_version),
            effective_deadline: Some(effective_deadline),
            role: Some(role),
        }
    }

    pub fn dev_user() -> Self {
        Self {
            subject: "dev-user".to_string(),
            exp: None,
            session_id: None,
            auth_version: None,
            credential_version: None,
            effective_deadline: None,
            role: Some(UserRole::User),
        }
    }
}
/// Preserves verified full claims from successful JWT authentication.
///
/// Intentionally contains no bearer material or secrets.
#[derive(Clone, Debug)]
pub struct VerifiedAuthClaims(pub AuthClaims);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CredentialMechanism {
    Bearer,
    Cookie,
    NoAuthDev,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum CredentialVerificationError {
    AuthenticationUnavailable,
    InvalidCredentials,
    AccountDisabled,
    ActorMismatch,
    StorageFailure,
}

/// Extract bearer token slice from `Authorization: Bearer <token>` header if present.
pub(crate) fn extract_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|val| val.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
}

/// Extract token and credential mechanism from `Authorization: Bearer <token>` header, falling back to cookie.
pub(crate) fn extract_token_and_mechanism<'a>(
    request: &'a Request,
    jar: &'a CookieJar,
) -> Option<(String, CredentialMechanism)> {
    // Prefer Authorization Bearer header when supplied.
    if let Some(token) = extract_bearer_token(request.headers()) {
        return Some((token.to_string(), CredentialMechanism::Bearer));
    }
    // Fall back to httpOnly cookie (same-origin)
    jar.get(AUTH_COOKIE)
        .map(|c| (c.value().to_string(), CredentialMechanism::Cookie))
}

fn extract_token<'a>(request: &'a Request, jar: &'a CookieJar) -> Option<String> {
    extract_token_and_mechanism(request, jar).map(|(token, _)| token)
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

/// Validates authentication and evaluates auth policy for an incoming request.
///
/// Returns the request with `AuthenticatedActor`, `CredentialMechanism`, and (for signed auth)
/// `VerifiedAuthClaims` inserted into extensions, or an error `Response`.
pub(crate) async fn authenticate_request(
    state: &AppState,
    jar: &CookieJar,
    mut request: Request,
) -> Result<Request, Response> {
    // Dev mode has a fixed actor so ticket binding remains identical to production.
    if state.no_auth {
        request
            .extensions_mut()
            .insert(AuthenticatedActor::dev_user());
        request
            .extensions_mut()
            .insert(CredentialMechanism::NoAuthDev);
        return Ok(request);
    }

    let Some((token, mechanism)) = extract_token_and_mechanism(&request, jar) else {
        return Err(unauthorized());
    };

    let Some(claims) = AuthClaims::decode(&token, &state.jwt_secret) else {
        return Err(unauthorized());
    };

    match state.auth_service.evaluate_claims(&claims).await {
        AuthDecision::Authenticated { session, user } => {
            let expires_at = bson_to_chrono(session.expires_at);
            let mfa_verified_at = bson_to_chrono(session.mfa_verified_at);
            let effective_deadline = compute_mfa_due_at(mfa_verified_at, expires_at);
            let actor = AuthenticatedActor::with_session(
                user.username.clone(),
                Some(expires_at.timestamp() as usize),
                session.id.clone(),
                session.auth_version,
                session.credential_version,
                effective_deadline,
                user.role,
            );
            request.extensions_mut().insert(actor);
            request.extensions_mut().insert(mechanism);
            request.extensions_mut().insert(VerifiedAuthClaims(claims));
            Ok(request)
        }
        AuthDecision::MfaRequired { .. } => Err(auth_error_response(
            StatusCode::UNAUTHORIZED,
            "MFA_REQUIRED",
            "MFA verification required",
            None,
        )),
        AuthDecision::FullLoginRequired { reason } => {
            let code = if reason.contains("expired") {
                "SESSION_EXPIRED"
            } else if reason.contains("revoked")
                || reason.contains("superseded")
                || reason.contains("version")
            {
                "SESSION_REVOKED"
            } else if reason.contains("disabled") {
                "ACCOUNT_DISABLED"
            } else {
                "AUTH_REQUIRED"
            };
            Err(auth_error_response(
                StatusCode::UNAUTHORIZED,
                code,
                reason,
                None,
            ))
        }
        AuthDecision::Unavailable { reason } => Err(auth_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "AUTH_UNAVAILABLE",
            format!("Authentication backend unavailable: {reason}"),
            None,
        )),
    }
}

/// Validates JWT auth on every protected request.
pub async fn require_auth(
    State(state): State<AppState>,
    jar: CookieJar,
    request: Request,
    next: Next,
) -> Response {
    match authenticate_request(&state, &jar, request).await {
        Ok(request) => next.run(request).await,
        Err(response) => response,
    }
}

/// Feature-local authentication middleware for the host resource SSE stream.
///
/// Bounded to a strict 2-second timeout around the auth/policy evaluation future ONLY.
/// `Next.run` runs outside the timeout so downstream first-frame/serializer delays
/// are never mislabeled as AUTH_UNAVAILABLE.
pub async fn authenticate_stream_request(
    State(state): State<AppState>,
    jar: CookieJar,
    request: Request,
    next: Next,
) -> Response {
    if request.method() != axum::http::Method::GET {
        return next.run(request).await;
    }

    let auth_result = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        authenticate_request(&state, &jar, request),
    )
    .await;

    let request = match auth_result {
        Ok(Ok(request)) => request,
        Ok(Err(response)) => return response,
        Err(_timeout) => {
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Authentication backend unavailable",
                None,
            );
        }
    };

    next.run(request).await
}

/// Middleware that enforces bearer token authentication for protected management operations
/// in authenticated environments, while permitting access in dev mode (--no-auth).
pub async fn require_bearer_auth(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    if state.no_auth {
        return next.run(request).await;
    }

    let mechanism = request.extensions().get::<CredentialMechanism>().copied();
    if mechanism != Some(CredentialMechanism::Bearer) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Bearer token required for plugin management operations; cookie credentials are not permitted",
                "code": "BearerRequired",
            })),
        )
            .into_response();
    }

    next.run(request).await
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct LoginBody {
    pub username: Option<String>,
    pub password: Option<String>,
}

pub use crate::auth::model::UserRole;

/// Verify an enabled user through the selected store without minting or
/// refreshing a session. The supplied password is wiped before this returns.
pub async fn verify_enabled_user(
    store: Option<&AuthStore>,
    username: &str,
    password: &mut String,
) -> Result<UserRole, CredentialVerificationError> {
    let result = match store {
        None => Err(CredentialVerificationError::AuthenticationUnavailable),
        Some(store) => match store.get_user(username).await {
            Ok(Some(user)) if verify(&mut *password, &user.password_hash).unwrap_or(false) => {
                if user.is_enabled {
                    Ok(user.role)
                } else {
                    Err(CredentialVerificationError::AccountDisabled)
                }
            }
            Ok(Some(_)) | Ok(None) => Err(CredentialVerificationError::InvalidCredentials),
            Err(e) => {
                tracing::error!(error = %e, username = %username, "Failed to retrieve user from auth store");
                Err(CredentialVerificationError::StorageFailure)
            }
        },
    };
    password.zeroize();
    result
}

/// Check a JWT subject is still an enabled account without accepting a password.
/// Sensitive action reads and intent admission call this before using actor data.
pub async fn is_enabled_user(store: Option<&AuthStore>, username: &str) -> bool {
    let Some(store) = store else {
        return false;
    };
    store
        .get_user(username)
        .await
        .ok()
        .flatten()
        .is_some_and(|user| user.is_enabled)
}

/// Get the enabled user's role from the selected store.
/// Returns None if the store is unavailable, the user does not exist, or the account is disabled.
pub async fn get_user_role(store: Option<&AuthStore>, username: &str) -> Option<UserRole> {
    let user = store?.get_user(username).await.ok()??;
    user.is_enabled.then_some(user.role)
}

/// Middleware that enforces the administrator role on protected routes.
/// Denies --no-auth mode and accounts without the admin role.
pub async fn require_admin(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    if state.no_auth {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Admin operations are strictly denied in --no-auth mode",
                "code": "NoAuthForbidden",
            })),
        )
            .into_response();
    }

    let actor = request.extensions().get::<AuthenticatedActor>();
    let Some(actor) = actor else {
        return unauthorized();
    };

    // A configured store is the sole authority: a missing account or storage
    // error denies and never falls through to an explicit test mock.
    let role = match state.auth_service.store() {
        Some(store) => get_user_role(Some(store), &actor.subject).await,
        None => state
            .auth_service
            .mock_user()
            .filter(|u| u.username == actor.subject && u.is_enabled)
            .map(|u| u.role),
    };

    match role {
        Some(UserRole::Admin) => next.run(request).await,
        _ => (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Administrator role required",
                "code": "AdminRoleRequired",
            })),
        )
            .into_response(),
    }
}
/// Re-authentication accepts credentials only for the same JWT subject.
pub async fn verify_actor_credentials(
    state: &AppState,
    actor: &AuthenticatedActor,
    username: &str,
    password: &mut String,
) -> Result<(), CredentialVerificationError> {
    if username != actor.subject {
        password.zeroize();
        return Err(CredentialVerificationError::ActorMismatch);
    }
    verify_enabled_user(state.auth_service.store(), username, password)
        .await
        .map(|_| ())
}

fn register_error(status: StatusCode, message: &str) -> Response {
    (
        status,
        Json(ErrorBody {
            error: message.into(),
        }),
    )
        .into_response()
}

/// POST /api/auth/register — registers a disabled `user` account in the selected store.
///
/// Approval and role assignment stay an operator action; success is reported
/// only after the store has actually inserted the account.
pub async fn register(State(state): State<AppState>, Json(body): Json<LoginBody>) -> Response {
    let Some(store) = state.auth_service.store() else {
        return register_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Authentication storage not configured, cannot register",
        );
    };

    let Some(username) = body.username else {
        return unauthorized();
    };
    let Some(password) = body.password else {
        return unauthorized();
    };
    let password = zeroize::Zeroizing::new(password);

    let password_hash = match hash(password.as_str(), DEFAULT_COST) {
        Ok(hash) => hash,
        Err(error) => {
            tracing::error!(%error, "Registration password hashing failed");
            return register_error(StatusCode::INTERNAL_SERVER_ERROR, "Registration failed");
        }
    };
    let new_user = UserRecord {
        id: None,
        username,
        password_hash,
        is_enabled: false,
        role: UserRole::User,
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    match store.create_user(new_user).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(StoreError::DuplicateUsername(_)) => {
            register_error(StatusCode::BAD_REQUEST, "User already exists")
        }
        Err(error) => {
            tracing::error!(%error, "Registration storage failure");
            register_error(StatusCode::INTERNAL_SERVER_ERROR, "Registration failed")
        }
    }
}

/// POST /api/auth/login — password login against the selected `AuthStore` (MongoDB or SQLite);
/// `--no-auth` returns a development token without credentials.
pub async fn login(State(state): State<AppState>, Json(mut body): Json<LoginBody>) -> Response {
    // Explicit dev mode (--no-auth): return token immediately without credentials check
    if state.no_auth {
        let user = body.username.as_deref().unwrap_or("dev-user");
        let now = chrono::Utc::now().timestamp() as usize;
        let exp = now + 30 * 24 * 3600;
        let claims = AuthClaims {
            v: AUTH_PROTOCOL_VERSION,
            sub: user.to_string(),
            sid: "dev-session".to_string(),
            auth_version: 0,
            credential_version: 0,
            iat: now,
            exp,
        };
        let jwt_token = match claims.encode(&state.jwt_secret) {
            Ok(token) => token,
            Err(e) => {
                tracing::error!("Dev mode JWT generation failed: {}", e);
                return auth_error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL_ERROR",
                    "Failed to generate dev token",
                    None,
                );
            }
        };
        let cookie_attrs = auth_cookie_header(&jwt_token, false);
        let mut response = (
            StatusCode::OK,
            [(header::SET_COOKIE, cookie_attrs)],
            Json(serde_json::json!({
                "ok": true,
                "token": jwt_token,
                "dev_mode": true,
                "devMode": true,
                "role": UserRole::User,
                "workbenchProtocol": 2,
                "authProtocol": AUTH_PROTOCOL_VERSION,
            })),
        )
            .into_response();
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        return response;
    }

    let (Some(username), Some(raw_password)) = (body.username.take(), body.password.take()) else {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "INVALID_CREDENTIALS",
            "Invalid credentials",
            None,
        );
    };
    let mut password = zeroize::Zeroizing::new(raw_password);

    let (Some(store), Some(mfa_key)) = (state.auth_service.store(), state.auth_service.mfa_key())
    else {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "INVALID_CREDENTIALS",
            "Invalid credentials",
            None,
        );
    };

    let now = state.auth_service.clock().now();
    let user = match store.get_user(&username).await {
        Ok(Some(u)) => u,
        Ok(None) => {
            return auth_error_response(
                StatusCode::UNAUTHORIZED,
                "INVALID_CREDENTIALS",
                "Invalid credentials",
                None,
            );
        }
        Err(e) => {
            tracing::error!("Error reading user {}: {}", username, e);
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Database error retrieving user",
                None,
            );
        }
    };

    let (is_throttled, retry_after) = check_account_throttle(&user, now);
    if is_throttled {
        return auth_error_response(
            StatusCode::TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "Too many failed attempts. Please wait before retrying.",
            retry_after,
        );
    }

    if !user.is_enabled {
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "ACCOUNT_DISABLED",
            "Account is pending approval or disabled",
            None,
        );
    }

    let password_valid = verify(&password, &user.password_hash).unwrap_or(false);
    password.zeroize();

    if !password_valid {
        let _ = store.record_failed_attempt(&username, now).await;
        return auth_error_response(
            StatusCode::UNAUTHORIZED,
            "INVALID_CREDENTIALS",
            "Invalid credentials",
            None,
        );
    }

    let challenge_expires_at = now + chrono::Duration::seconds(CHALLENGE_LIFETIME_SECS);
    let (token_hex, digest) = AuthService::generate_challenge_token();

    if user.mfa.is_none() {
        let secret = TotpEngine::generate_secret();
        let (ciphertext, nonce) = match mfa_key.encrypt(&username, "enrollment-pending", &secret) {
            Ok(enc) => enc,
            Err(e) => {
                tracing::error!(
                    "Failed to encrypt pending MFA secret for {}: {}",
                    username,
                    e
                );
                return auth_error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL_ERROR",
                    "Failed to generate enrollment challenge",
                    None,
                );
            }
        };

        let challenge = AuthChallenge {
            id: digest,
            username: user.username,
            auth_version: user.auth_version,
            purpose: ChallengePurpose::Enroll,
            created_at: chrono_to_bson(now),
            expires_at: chrono_to_bson(challenge_expires_at),
            attempts: 0,
            consumed_at: None,
            pending_secret_ciphertext: Some(ciphertext),
            pending_secret_nonce: Some(nonce),
            pending_secret_key_id: Some(mfa_key.key_id().to_string()),
            session_id: None,
            credential_version: None,
        };

        if let Err(e) = store.create_challenge(challenge).await {
            tracing::error!(
                "Failed to persist enrollment challenge for {}: {}",
                username,
                e
            );
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Failed to persist enrollment challenge",
                None,
            );
        }

        no_store_json_response(
            StatusCode::OK,
            LoginChallengeResponse {
                state: "enrollmentRequired".to_string(),
                challenge_token: token_hex,
                challenge_expires_at: challenge_expires_at.to_rfc3339(),
                auth_protocol: AUTH_PROTOCOL_VERSION,
            },
        )
    } else {
        let challenge = AuthChallenge {
            id: digest,
            username: user.username,
            auth_version: user.auth_version,
            purpose: ChallengePurpose::LoginMfa,
            created_at: chrono_to_bson(now),
            expires_at: chrono_to_bson(challenge_expires_at),
            attempts: 0,
            consumed_at: None,
            pending_secret_ciphertext: None,
            pending_secret_nonce: None,
            pending_secret_key_id: None,
            session_id: None,
            credential_version: None,
        };

        if let Err(e) = store.create_challenge(challenge).await {
            tracing::error!("Failed to persist login challenge for {}: {}", username, e);
            return auth_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "AUTH_UNAVAILABLE",
                "Failed to persist login challenge",
                None,
            );
        }

        no_store_json_response(
            StatusCode::OK,
            LoginChallengeResponse {
                state: "mfaRequired".to_string(),
                challenge_token: token_hex,
                challenge_expires_at: challenge_expires_at.to_rfc3339(),
                auth_protocol: AUTH_PROTOCOL_VERSION,
            },
        )
    }
}

/// POST /api/auth/logout — clears auth credentials and revokes active session.
pub async fn logout(State(state): State<AppState>, jar: CookieJar, request: Request) -> Response {
    let now = state.auth_service.clock().now();
    if let Some(token) = extract_token(&request, &jar) {
        if let Some(claims) = AuthClaims::decode(&token, &state.jwt_secret) {
            if let Some(store) = state.auth_service.store() {
                let _ = store.revoke_session(&claims.sid, now).await;
            }
            state
                .media_tickets
                .revoke_by_actor_or_session(&claims.sub, Some(&claims.sid));
        }
    }
    let clear = auth_cookie_header("", true);
    let mut resp = (
        StatusCode::OK,
        [(header::SET_COOKIE, clear)],
        Json(serde_json::json!({
            "ok": true,
            "token": null,
            "role": null
        })),
    )
        .into_response();
    resp.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    resp
}

/// GET /api/auth/status — returns 200 if authenticated, 401 otherwise.
pub async fn status(State(state): State<AppState>, jar: CookieJar, request: Request) -> Response {
    // Dev mode: always authenticated
    if state.no_auth {
        let mut resp = Json(serde_json::json!({
            "authenticated": true,
            "dev_mode": true,
            "devMode": true,
            "user": "dev-user",
            "role": "user",
            "workbenchProtocol": 2,
            "authProtocol": AUTH_PROTOCOL_VERSION,
        }))
        .into_response();
        resp.headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        return resp;
    }

    let Some(token) = extract_token(&request, &jar) else {
        let mut resp = (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "authenticated": false,
                "code": "AUTH_REQUIRED",
                "error": "Authentication required",
                "workbenchProtocol": 2,
                "authProtocol": AUTH_PROTOCOL_VERSION,
            })),
        )
            .into_response();
        resp.headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        return resp;
    };

    let Some(claims) = AuthClaims::decode(&token, &state.jwt_secret) else {
        let mut resp = (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "authenticated": false,
                "code": "AUTH_REQUIRED",
                "error": "Session token invalid or legacy format",
                "workbenchProtocol": 2,
                "authProtocol": AUTH_PROTOCOL_VERSION,
            })),
        )
            .into_response();
        resp.headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        return resp;
    };

    match state.auth_service.evaluate_claims(&claims).await {
        AuthDecision::Authenticated { session, user } => {
            let expires_at = bson_to_chrono(session.expires_at);
            let mfa_verified_at = bson_to_chrono(session.mfa_verified_at);
            let mfa_due_at = compute_mfa_due_at(mfa_verified_at, expires_at);
            let issued_at = bson_to_chrono(session.issued_at);

            let mut resp = (
                StatusCode::OK,
                Json(serde_json::json!({
                    "authenticated": true,
                    "user": user.username,
                    "role": user.role,
                    "workbenchProtocol": 2,
                    "authProtocol": AUTH_PROTOCOL_VERSION,
                    "issuedAt": issued_at.to_rfc3339(),
                    "expiresAt": expires_at.to_rfc3339(),
                    "mfaDueAt": mfa_due_at.to_rfc3339(),
                })),
            )
                .into_response();
            resp.headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            resp
        }
        AuthDecision::MfaRequired {
            session,
            mfa_due_at,
        } => {
            let expires_at = bson_to_chrono(session.expires_at);
            let mut resp = (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({
                    "authenticated": false,
                    "code": "MFA_REQUIRED",
                    "error": "MFA verification required",
                    "user": session.username,
                    "expiresAt": expires_at.to_rfc3339(),
                    "mfaDueAt": mfa_due_at.to_rfc3339(),
                    "workbenchProtocol": 2,
                    "authProtocol": AUTH_PROTOCOL_VERSION,
                })),
            )
                .into_response();
            resp.headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            resp
        }
        AuthDecision::FullLoginRequired { reason } => {
            let code = if reason.contains("expired") {
                "SESSION_EXPIRED"
            } else if reason.contains("revoked")
                || reason.contains("superseded")
                || reason.contains("version")
            {
                "SESSION_REVOKED"
            } else if reason.contains("disabled") {
                "ACCOUNT_DISABLED"
            } else {
                "AUTH_REQUIRED"
            };
            let mut resp = (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({
                    "authenticated": false,
                    "code": code,
                    "error": reason,
                    "workbenchProtocol": 2,
                    "authProtocol": AUTH_PROTOCOL_VERSION,
                })),
            )
                .into_response();
            resp.headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            resp
        }
        AuthDecision::Unavailable { reason } => {
            let mut resp = (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "authenticated": false,
                    "code": "AUTH_UNAVAILABLE",
                    "error": reason,
                    "workbenchProtocol": 2,
                    "authProtocol": AUTH_PROTOCOL_VERSION,
                })),
            )
                .into_response();
            resp.headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            resp
        }
    }
}
