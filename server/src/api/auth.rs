use axum::extract::{ConnectInfo, Extension, Path, Request, State};
use axum::{
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use axum_extra::extract::CookieJar;
use bcrypt::verify;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use zeroize::Zeroize;

use crate::api::auth_mfa::{auth_error_response, no_store_json_response, LoginChallengeResponse};
use crate::auth::model::{
    bson_to_chrono, chrono_to_bson, AuthChallenge, AuthClaims, AuthDecision, ChallengePurpose,
};
use crate::auth::policy::{
    check_account_throttle, compute_mfa_due_at, AUTH_PROTOCOL_VERSION, CHALLENGE_LIFETIME_SECS,
};
use crate::auth::totp::TotpEngine;
use crate::auth::{AuthService, AuthStore};
use crate::state::AppState;

pub const AUTH_COOKIE: &str = "damhopper-auth";

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

fn deserialize_opt_u64_or_string<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct OptVisitor;
    impl<'de> serde::de::Visitor<'de> for OptVisitor {
        type Value = Option<u64>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("null, u64 integer, or canonical decimal string")
        }
        fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Self::Value, E> {
            Ok(Some(v))
        }
        fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Self::Value, E> {
            u64::try_from(v)
                .map(Some)
                .map_err(|_| E::custom("negative integer"))
        }
        fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
            v.parse::<u64>()
                .map(Some)
                .map_err(|_| E::custom("invalid u64 string"))
        }
    }
    deserializer.deserialize_any(OptVisitor)
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LogoutRequestBody {
    #[serde(default)]
    browser_reset: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_opt_u64_or_string")]
    expected_profile_epoch: Option<u64>,
    #[serde(default)]
    operation_id: Option<String>,
    #[serde(default)]
    confirmed: Option<bool>,
}

pub(crate) async fn verify_live_admin_for_reset(state: &AppState, principal: &str) -> bool {
    if let Some(store) = state.auth_service.store() {
        return matches!(
            store.get_user(principal).await,
            Ok(Some(user)) if user.is_enabled && user.role == UserRole::Admin
        );
    }
    if let Some(mock) = state.auth_service.mock_user() {
        return mock.username == principal && mock.is_enabled && mock.role == UserRole::Admin;
    }
    false
}

/// Targeted device session revoke wrapper: revokes auth session first and tears down matching Browser attachments/held-input without wiping Browser profile.
pub async fn revoke_device_session_with_browser_cleanup(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthenticatedActor>,
    Extension(mechanism): Extension<CredentialMechanism>,
    Path(id): Path<String>,
) -> Response {
    let resp = super::auth_sessions::revoke(
        State(state.clone()),
        Extension(actor.clone()),
        Extension(mechanism),
        Path(id.clone()),
    )
    .await;
    if resp.status() == StatusCode::NO_CONTENT {
        super::browser_host::revoke_auth_session_browser_resources(&state, &actor.subject, &id)
            .await;
    }
    resp
}

/// POST /api/auth/logout — clears auth credentials and revokes active session first, then runs confirmed live-Admin Browser reset when explicitly authorized.
pub async fn logout(State(state): State<AppState>, jar: CookieJar, request: Request) -> Response {
    let now = state.auth_service.clock().now();
    let headers = request.headers().clone();
    let peer_addr = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0);

    let has_auth_hdr = headers.contains_key(header::AUTHORIZATION);
    let bearer_tok = extract_bearer_token(&headers).map(str::to_string);
    let cookie_tok = jar.get(AUTH_COOKIE).map(|c| c.value().to_string());
    let has_bearer_auth = bearer_tok.is_some();
    // Strict credential isolation: malformed Authorization header cannot fall back to cookie
    let admission_token = if has_auth_hdr {
        bearer_tok.clone()
    } else {
        cookie_tok.clone()
    };
    let revoke_token = bearer_tok.or(cookie_tok);

    let (parsed_req, body_malformed) =
        match axum::body::to_bytes(request.into_body(), 16 * 1024).await {
            Ok(bytes) => {
                if bytes.trim_ascii().is_empty() {
                    (Some(LogoutRequestBody::default()), false)
                } else {
                    match serde_json::from_slice::<LogoutRequestBody>(&bytes) {
                        Ok(req) => (Some(req), false),
                        Err(_) => (None, true),
                    }
                }
            }
            Err(_) => (None, true),
        };

    // 1. Capture pre-revocation live Admin admission receipt BEFORE revoking this session
    let mut live_admission = None;
    let mut auth_backend_unavailable = false;
    if !state.no_auth {
        if let Some(tok) = &admission_token {
            if let Some(claims) = AuthClaims::decode(tok, &state.jwt_secret) {
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
                        if let Ok(adm) = crate::browser_host::auth::evaluate_browser_admission(
                            &state,
                            &headers,
                            peer_addr,
                            Some(&actor),
                        )
                        .await
                        {
                            live_admission = Some(adm);
                        }
                    }
                    AuthDecision::Unavailable { .. } => {
                        auth_backend_unavailable = true;
                    }
                    AuthDecision::MfaRequired { .. } | AuthDecision::FullLoginRequired { .. } => {}
                }
            }
        }
    }

    // 2. ALWAYS preserve idempotent session revocation, media-ticket revocation, and cookie clearing FIRST
    let mut credential_identified = false;
    let mut credential_revoked = false;
    let mut session_revoke_failed = false;
    if let Some(tok) = &revoke_token {
        if let Some(claims) = AuthClaims::decode(tok, &state.jwt_secret) {
            credential_identified = true;
            if let Some(store) = state.auth_service.store() {
                match store.revoke_session(&claims.sid, now).await {
                    Ok(_) => credential_revoked = true,
                    Err(err) => {
                        tracing::error!(error = %err, "Failed to revoke auth session during logout");
                        session_revoke_failed = true;
                    }
                }
            }
            state
                .media_tickets
                .revoke_by_actor_or_session(&claims.sub, Some(&claims.sid));
            super::browser_host::revoke_auth_session_browser_resources(
                &state,
                &claims.sub,
                &claims.sid,
            )
            .await;
        }
    }

    let revocation_uncertain =
        session_revoke_failed || (revoke_token.is_some() && auth_backend_unavailable);
    // `sessionRevoked` is true only when the credential carried by THIS request was identified
    // and its session revoked. An anonymous/uncredentialed (or cookie-only) logout reports
    // false: it cannot confirm revocation of a different, unsent saved Bearer token.
    let session_revoked = credential_revoked && !revocation_uncertain;

    // 3. Evaluate Browser reset / credential status strictly after session revocation
    let mut payload = serde_json::json!({
        "ok": true,
        "token": null,
        "role": null,
        "sessionRevoked": session_revoked,
        "sessionIdentified": credential_identified,
        "revocationUncertain": revocation_uncertain,
        "browserResetState": "unknown",
        "browserCredentialsRetained": true,
        "resetRequired": true,
    });
    if revocation_uncertain {
        payload["revocationError"] =
            serde_json::json!("server session revocation failed or backend unavailable");
    }
    if !state.no_auth {
        if let Some(adm) = live_admission {
            let has_creds = state
                .browser_host
                .has_browser_credentials_or_tombstone(&adm.principal, adm.is_dev)
                .await;
            let has_tombstone = state
                .browser_host
                .has_active_tombstone(&adm.principal, adm.is_dev)
                .await;
            let has_persisted = state
                .browser_host
                .has_persisted_profile_state(&adm.principal, adm.is_dev);

            let requested_reset = parsed_req
                .as_ref()
                .and_then(|r| r.browser_reset)
                .unwrap_or(false);

            if body_malformed || !requested_reset {
                if body_malformed {
                    payload["browserResetState"] = serde_json::json!(if has_tombstone {
                        "cleanupPending"
                    } else {
                        "retained"
                    });
                    payload["browserCredentialsRetained"] = serde_json::json!(true);
                    payload["resetRequired"] = serde_json::json!(true);
                } else if !has_creds {
                    payload["browserResetState"] = serde_json::json!("cleared");
                    payload["browserCredentialsRetained"] = serde_json::json!(false);
                    payload["resetRequired"] = serde_json::json!(false);
                } else if has_tombstone {
                    payload["browserResetState"] = serde_json::json!("cleanupPending");
                    payload["browserCredentialsRetained"] = serde_json::json!(true);
                    payload["resetRequired"] = serde_json::json!(true);
                } else {
                    payload["browserResetState"] = serde_json::json!("retained");
                    payload["browserCredentialsRetained"] = serde_json::json!(true);
                    payload["resetRequired"] = serde_json::json!(true);
                }
            } else {
                // Confirmed reset branch
                let req = parsed_req.as_ref().expect("checked non-malformed");
                let csrf_ok = super::browser_host::validate_destructive_browser_csrf(
                    &state,
                    &headers,
                    has_bearer_auth,
                );
                let valid_op = req
                    .operation_id
                    .as_deref()
                    .filter(|s| super::browser_host::is_valid_reset_operation_id(s))
                    .map(str::trim);
                let confirmed = req.confirmed == Some(true);
                let expected_epoch = req.expected_profile_epoch;
                let role_still_ok = if !session_revoke_failed && !auth_backend_unavailable {
                    verify_live_admin_for_reset(&state, &adm.principal).await
                } else {
                    false
                };

                if !csrf_ok
                    || !confirmed
                    || !role_still_ok
                    || valid_op.is_none()
                    || expected_epoch.is_none()
                {
                    payload["browserResetState"] = serde_json::json!(if has_tombstone {
                        "cleanupPending"
                    } else {
                        "retained"
                    });
                    payload["browserCredentialsRetained"] = serde_json::json!(true);
                    payload["resetRequired"] = serde_json::json!(true);
                } else {
                    let op_id = valid_op.unwrap();
                    let epoch = expected_epoch.unwrap();
                    if !has_persisted {
                        if epoch == 1 && verify_live_admin_for_reset(&state, &adm.principal).await {
                            match super::browser_host::revoke_principal_browser_resources(
                                &state,
                                &adm.principal,
                            )
                            .await
                            {
                                Ok(()) => {
                                    payload["browserResetState"] = serde_json::json!("cleared");
                                    payload["browserCredentialsRetained"] =
                                        serde_json::json!(false);
                                    payload["resetRequired"] = serde_json::json!(false);
                                }
                                Err(err) => {
                                    // Private artifact files remain: never claim a completed purge.
                                    tracing::error!(error = %err, "Browser artifact purge incomplete during logout");
                                    payload["browserResetState"] =
                                        serde_json::json!("cleanupPending");
                                    payload["browserCredentialsRetained"] = serde_json::json!(true);
                                    payload["resetRequired"] = serde_json::json!(true);
                                    payload["operationId"] = serde_json::json!(op_id);
                                    payload["reason"] =
                                        serde_json::json!("browser artifact purge incomplete");
                                }
                            }
                        } else {
                            payload["browserResetState"] = serde_json::json!("retained");
                            payload["browserCredentialsRetained"] = serde_json::json!(true);
                            payload["resetRequired"] = serde_json::json!(true);
                        }
                    } else {
                        let recheck_state = state.clone();
                        let recheck_principal = adm.principal.clone();
                        let recheck_admin: crate::browser_host::manager::AdminRecheckCallback =
                            std::sync::Arc::new(move || {
                                let state = recheck_state.clone();
                                let principal = recheck_principal.clone();
                                Box::pin(async move {
                                    verify_live_admin_for_reset(&state, &principal).await
                                })
                            });
                        let hooks = super::browser_host::make_reset_fence_hooks(
                            state.clone(),
                            adm.principal.clone(),
                            Some(recheck_admin),
                        );
                        match state
                            .browser_host
                            .reset_profile_with_hooks(
                                &adm.principal,
                                adm.is_dev,
                                op_id,
                                epoch,
                                hooks,
                            )
                            .await
                        {
                            Ok(crate::browser_host::manager::ResetOutcome::Completed {
                                operation_id,
                                new_profile_epoch,
                            }) => {
                                payload["browserResetState"] = serde_json::json!("cleared");
                                payload["browserCredentialsRetained"] = serde_json::json!(false);
                                payload["resetRequired"] = serde_json::json!(false);
                                payload["operationId"] = serde_json::json!(operation_id);
                                payload["profileEpoch"] = serde_json::json!(new_profile_epoch);
                            }
                            Ok(crate::browser_host::manager::ResetOutcome::CleanupPending {
                                operation_id,
                                profile_epoch,
                                reason,
                            }) => {
                                payload["browserResetState"] = serde_json::json!("cleanupPending");
                                payload["browserCredentialsRetained"] = serde_json::json!(true);
                                payload["resetRequired"] = serde_json::json!(true);
                                payload["operationId"] = serde_json::json!(operation_id);
                                payload["profileEpoch"] = serde_json::json!(profile_epoch);
                                payload["reason"] = serde_json::json!(reason);
                            }
                            Err(crate::browser_host::manager::ManagerError::CleanupPending(
                                reason,
                            )) => {
                                payload["browserResetState"] = serde_json::json!("cleanupPending");
                                payload["browserCredentialsRetained"] = serde_json::json!(true);
                                payload["resetRequired"] = serde_json::json!(true);
                                payload["operationId"] = serde_json::json!(op_id);
                                payload["reason"] = serde_json::json!(reason);
                            }
                            Err(_) => {
                                payload["browserResetState"] = serde_json::json!("retained");
                                payload["browserCredentialsRetained"] = serde_json::json!(true);
                                payload["resetRequired"] = serde_json::json!(true);
                            }
                        }
                    }
                }
            }
        }
    }

    let clear = auth_cookie_header("", true);
    let mut resp = (StatusCode::OK, [(header::SET_COOKIE, clear)], Json(payload)).into_response();
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
