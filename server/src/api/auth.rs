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
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use mongodb::bson::doc;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

use crate::api::auth_mfa::{
    auth_error_response, no_store_json_response, LoginChallengeResponse,
};
use crate::auth::model::{
    bson_to_chrono, chrono_to_bson, AuthChallenge, AuthClaims, AuthDecision, ChallengePurpose,
};
use crate::auth::policy::{
    check_account_throttle, compute_mfa_due_at, AUTH_PROTOCOL_VERSION, CHALLENGE_LIFETIME_SECS,
};
use crate::auth::totp::TotpEngine;
use crate::auth::AuthService;
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
    let max_age = if clear { "; Max-Age=0" } else { "; Max-Age=2592000" };
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

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

/// Identity established by the protected-route middleware.
///
/// This intentionally contains no bearer material. Sensitive routes use it to
/// bind short-lived approvals to the authenticated account that requested them.
#[derive(Clone, Debug)]
pub struct AuthenticatedActor {
    pub subject: String,
    pub exp: Option<usize>,
}

impl AuthenticatedActor {
    pub fn new(subject: impl Into<String>, exp: Option<usize>) -> Self {
        Self {
            subject: subject.into(),
            exp,
        }
    }
}

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

pub fn validate_jwt(provided: &str, secret: &str) -> bool {
    validated_claims(provided, secret).is_some()
}

pub fn authenticate_token(provided: &str, secret: &str) -> Option<AuthenticatedActor> {
    validated_claims(provided, secret).map(|c| AuthenticatedActor {
        subject: c.sub,
        exp: Some(c.exp),
    })
}

fn validated_claims(provided: &str, secret: &str) -> Option<Claims> {
    let mut validation = Validation::default();
    validation.validate_exp = true;
    decode::<Claims>(
        provided,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .ok()
    .map(|token| token.claims)
}

/// Generate JWT token for a given subject (username) with 30-day expiration.
///
/// Returns `Ok(token)` on success, or `Err` if encoding fails.
/// Callers should handle errors appropriately (log and return error response).
fn generate_jwt(subject: &str, secret: &str) -> anyhow::Result<String> {
    let exp = (chrono::Utc::now().timestamp() as usize) + 30 * 24 * 3600;
    let claims = Claims {
        sub: subject.to_string(),
        exp,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| anyhow::anyhow!("JWT encoding failed: {}", e))
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

/// Validates JWT auth on every protected request.
pub async fn require_auth(
    State(state): State<AppState>,
    jar: CookieJar,
    mut request: Request,
    next: Next,
) -> Response {
    // Dev mode has a fixed actor so ticket binding remains identical to production.
    if state.no_auth {
        request.extensions_mut().insert(AuthenticatedActor {
            subject: "dev-user".into(),
            exp: None,
        });
        request
            .extensions_mut()
            .insert(CredentialMechanism::NoAuthDev);
        return next.run(request).await;
    }

    let Some((token, mechanism)) = extract_token_and_mechanism(&request, &jar) else {
        return unauthorized();
    };

    let Some(claims) = validated_claims(&token, &state.jwt_secret) else {
        return unauthorized();
    };

    request.extensions_mut().insert(AuthenticatedActor {
        subject: claims.sub,
        exp: Some(claims.exp),
    });
    request.extensions_mut().insert(mechanism);

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


#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub username: String,
    pub password_hash: String,
    pub is_enabled: bool,
    #[serde(default)]
    pub role: UserRole,
    #[serde(default)]
    pub auth_version: i64,
}

/// Verify an enabled MongoDB user without minting or refreshing a session.
/// The supplied password is wiped before this function returns.
pub async fn verify_enabled_user(
    db: Option<&mongodb::Database>,
    username: &str,
    password: &mut String,
) -> Result<UserRole, CredentialVerificationError> {
    let result = match db {
        None => Err(CredentialVerificationError::AuthenticationUnavailable),
        Some(db) => {
            let collection = db.collection::<User>("users");
            match collection.find_one(doc! { "username": username }).await {
                Ok(Some(user)) if verify(&mut *password, &user.password_hash).unwrap_or(false) => {
                    if user.is_enabled {
                        Ok(user.role)
                    } else {
                        Err(CredentialVerificationError::AccountDisabled)
                    }
                }
                _ => Err(CredentialVerificationError::InvalidCredentials),
            }
        }
    };
    password.zeroize();
    result
}

/// Check a JWT subject is still an enabled account without accepting a password.
/// Sensitive action reads and intent admission call this before using actor data.
pub async fn is_enabled_user(db: Option<&mongodb::Database>, username: &str) -> bool {
    let Some(db) = db else {
        return false;
    };
    db.collection::<User>("users")
        .find_one(doc! { "username": username })
        .await
        .ok()
        .flatten()
        .is_some_and(|user| user.is_enabled)
}

/// Get the enabled user's role from MongoDB.
/// Returns None if MongoDB is unavailable, user does not exist, or account is disabled.
pub async fn get_user_role(db: Option<&mongodb::Database>, username: &str) -> Option<UserRole> {
    let db = db?;
    let collection = db.collection::<User>("users");
    let user = collection
        .find_one(doc! { "username": username })
        .await
        .ok()?
        .filter(|u| u.is_enabled)?;
    Some(user.role)
}

/// Middleware that enforces the MongoDB administrator role on protected routes.
/// Denies --no-auth mode and accounts without the admin role.
pub async fn require_plugin_admin(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    if state.no_auth {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Plugin management operations are strictly denied in --no-auth mode",
                "code": "NoAuthForbidden",
            })),
        )
            .into_response();
    }

    let actor = request.extensions().get::<AuthenticatedActor>();
    let Some(actor) = actor else {
        return unauthorized();
    };

    match get_user_role(state.db.as_ref(), &actor.subject).await {
        Some(UserRole::Admin) => next.run(request).await,
        _ => (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Administrator role required for plugin management operations",
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
    verify_enabled_user(state.db.as_ref(), username, password).await.map(|_| ())
}

/// POST /api/auth/register — registers a user in mongodb
pub async fn register(State(state): State<AppState>, Json(body): Json<LoginBody>) -> Response {
    let Some(db) = &state.db else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorBody {
                error: "MongoDB not configured, cannot register".into(),
            }),
        )
            .into_response();
    };

    let Some(username) = body.username else {
        return unauthorized();
    };
    let Some(password) = body.password else {
        return unauthorized();
    };

    let collection = db.collection::<User>("users");

    if let Ok(Some(_)) = collection.find_one(doc! { "username": &username }).await {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorBody {
                error: "User already exists".into(),
            }),
        )
            .into_response();
    }

    let password_hash = hash(&password, DEFAULT_COST).unwrap_or_default();
    let new_user = User {
        username,
        password_hash,
        is_enabled: false,
        role: UserRole::User,
        auth_version: 0,
    };
    let _ = collection.insert_one(new_user).await;

    Json(serde_json::json!({ "ok": true })).into_response()
}

/// POST /api/auth/login — authenticates via mongodb or fallback to token, returns JWT
pub async fn login(State(state): State<AppState>, Json(mut body): Json<LoginBody>) -> Response {
    // Explicit dev mode (--no-auth): return token immediately without credentials check
    if state.no_auth {
        let user = body.username.as_deref().unwrap_or("dev-user");
        let jwt_token = match generate_jwt(user, &state.jwt_secret) {
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
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        );
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

    let (Some(store), Some(mfa_key)) = (state.auth_service.store(), state.auth_service.mfa_key()) else {
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
                tracing::error!("Failed to encrypt pending MFA secret for {}: {}", username, e);
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
            tracing::error!("Failed to persist enrollment challenge for {}: {}", username, e);
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
            state.plugin_service.revoke_actor(&claims.sub).await;
        } else if let Some(actor) = authenticate_token(&token, &state.jwt_secret) {
            state.plugin_service.revoke_actor(&actor.subject).await;
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
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
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
        resp.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        );
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
        resp.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        );
        return resp;
    };

    let Some(claims) = AuthClaims::decode(&token, &state.jwt_secret) else {
        // Fallback for tests running without DB where store is None:
        if state.auth_service.store().is_none() {
            if let Some(actor) = authenticate_token(&token, &state.jwt_secret) {
                let mut resp = (
                    StatusCode::OK,
                    Json(serde_json::json!({
                        "authenticated": true,
                        "user": actor.subject,
                        "role": UserRole::User,
                        "workbenchProtocol": 2,
                        "authProtocol": AUTH_PROTOCOL_VERSION,
                    })),
                )
                    .into_response();
                resp.headers_mut().insert(
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("no-store"),
                );
                return resp;
            }
        }
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
        resp.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        );
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
            resp.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("no-store"),
            );
            resp
        }
        AuthDecision::MfaRequired { session, mfa_due_at } => {
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
            resp.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("no-store"),
            );
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
            resp.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("no-store"),
            );
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
            resp.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("no-store"),
            );
            resp
        }
    }
}

