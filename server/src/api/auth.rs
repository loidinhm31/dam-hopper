use axum::extract::Request;
use axum::{
    extract::State,
    http::{header, StatusCode},
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

use crate::state::AppState;

pub const AUTH_COOKIE: &str = "damhopper-auth";

// ---------------------------------------------------------------------------
// Error response
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

fn auth_cookie_header(value: &str, clear: bool) -> String {
    let max_age = if clear { "; Max-Age=0" } else { "" };
    format!("{AUTH_COOKIE}={value}; HttpOnly; SameSite=Strict; Path=/{max_age}")
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorBody {
            error: "Unauthorized".into(),
        }),
    )
        .into_response()
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
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum CredentialVerificationError {
    AuthenticationUnavailable,
    InvalidCredentials,
    AccountDisabled,
    ActorMismatch,
}

/// Extract token from `Authorization: Bearer <token>` header, falling back to cookie.
fn extract_token<'a>(request: &'a Request, jar: &'a CookieJar) -> Option<String> {
    // Prefer Authorization Bearer header when supplied.
    if let Some(val) = request.headers().get(header::AUTHORIZATION) {
        if let Ok(s) = val.to_str() {
            if let Some(token) = s.strip_prefix("Bearer ") {
                return Some(token.to_string());
            }
        }
    }
    // Fall back to httpOnly cookie (same-origin)
    jar.get(AUTH_COOKIE).map(|c| c.value().to_string())
}

pub fn validate_jwt(provided: &str, secret: &str) -> bool {
    validated_claims(provided, secret).is_some()
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
        });
        return next.run(request).await;
    }

    let Some(claims) =
        extract_token(&request, &jar).and_then(|token| validated_claims(&token, &state.jwt_secret))
    else {
        return unauthorized();
    };

    request.extensions_mut().insert(AuthenticatedActor {
        subject: claims.sub,
    });

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

#[derive(Serialize)]
struct LoginResponse {
    ok: bool,
    token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dev_mode: Option<bool>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct User {
    username: String,
    password_hash: String,
    is_enabled: bool,
}

/// Verify an enabled MongoDB user without minting or refreshing a session.
/// The supplied password is wiped before this function returns.
pub async fn verify_enabled_user(
    db: Option<&mongodb::Database>,
    username: &str,
    password: &mut String,
) -> Result<(), CredentialVerificationError> {
    let result = match db {
        None => Err(CredentialVerificationError::AuthenticationUnavailable),
        Some(db) => {
            let collection = db.collection::<User>("users");
            match collection.find_one(doc! { "username": username }).await {
                Ok(Some(user)) if verify(&mut *password, &user.password_hash).unwrap_or(false) => {
                    if user.is_enabled {
                        Ok(())
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
    verify_enabled_user(state.db.as_ref(), username, password).await
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
    };
    let _ = collection.insert_one(new_user).await;

    Json(serde_json::json!({ "ok": true })).into_response()
}

/// POST /api/auth/login — authenticates via mongodb or fallback to token, returns JWT
pub async fn login(State(state): State<AppState>, Json(mut body): Json<LoginBody>) -> Response {
    // Dev mode: return dev token immediately (no credentials check)
    if state.no_auth {
        let jwt_token = match generate_jwt("dev-user", &state.jwt_secret) {
            Ok(token) => token,
            Err(e) => {
                tracing::error!("Dev mode JWT generation failed: {}", e);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorBody {
                        error: "Failed to generate dev token".into(),
                    }),
                )
                    .into_response();
            }
        };

        let cookie_attrs = auth_cookie_header(&jwt_token, false);

        return (
            StatusCode::OK,
            [(header::SET_COOKIE, cookie_attrs)],
            Json(LoginResponse {
                ok: true,
                token: Some(jwt_token),
                dev_mode: Some(true),
            }),
        )
            .into_response();
    }

    let (Some(username), Some(password)) = (body.username.take(), body.password.as_mut()) else {
        return unauthorized();
    };
    let verification = verify_enabled_user(state.db.as_ref(), &username, password).await;
    if let Err(error) = verification {
        let message = if error == CredentialVerificationError::AccountDisabled {
            "Account is pending approval or disabled"
        } else {
            "Invalid credentials"
        };
        return (
            StatusCode::UNAUTHORIZED,
            Json(ErrorBody {
                error: message.into(),
            }),
        )
            .into_response();
    }
    let logged_in_sub = username;

    let jwt_token = match generate_jwt(&logged_in_sub, &state.jwt_secret) {
        Ok(token) => token,
        Err(e) => {
            tracing::error!("JWT generation failed for user {}: {}", logged_in_sub, e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorBody {
                    error: "Failed to generate authentication token".into(),
                }),
            )
                .into_response();
        }
    };

    let cookie_attrs = auth_cookie_header(&jwt_token, false);

    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie_attrs)],
        Json(LoginResponse {
            ok: true,
            token: Some(jwt_token),
            dev_mode: None,
        }),
    )
        .into_response()
}

/// POST /api/auth/logout — revokes the presented media session then clears credentials.
pub async fn logout(State(state): State<AppState>, jar: CookieJar, request: Request) -> Response {
    if let Some(claims) = if state.no_auth {
        Some(Claims {
            sub: "dev-user".into(),
            exp: 0,
        })
    } else {
        extract_token(&request, &jar).and_then(|token| validated_claims(&token, &state.jwt_secret))
    } {
        if let Some(token) = crate::fs::media_session::media_session_from_headers(request.headers())
        {
            state
                .media_tickets
                .revoke_session_for_actor(&claims.sub, &token);
        }
    }
    let clear = auth_cookie_header("", true);
    let mut response = (
        StatusCode::OK,
        [(header::SET_COOKIE, clear)],
        Json(LoginResponse {
            ok: true,
            token: None,
            dev_mode: None,
        }),
    )
        .into_response();
    response.headers_mut().append(
        header::SET_COOKIE,
        crate::api::media_session::clear_cookie_header(),
    );
    response
}

/// GET /api/auth/status — returns 200 if authenticated, 401 otherwise.
pub async fn status(State(state): State<AppState>, jar: CookieJar, request: Request) -> Response {
    // Dev mode: always authenticated
    if state.no_auth {
        return Json(serde_json::json!({
            "authenticated": true,
            "dev_mode": true,
            "user": "dev-user"
        }))
        .into_response();
    }

    let ok = extract_token(&request, &jar)
        .map(|t| validate_jwt(&t, &state.jwt_secret))
        .unwrap_or(false);

    if ok {
        Json(serde_json::json!({ "authenticated": true })).into_response()
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "authenticated": false })),
        )
            .into_response()
    }
}
