use axum::{
    Json,
    extract::State,
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use axum::extract::Request;
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;

use crate::state::AppState;

pub const AUTH_COOKIE: &str = "devhub-auth";

// ---------------------------------------------------------------------------
// Error response
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorBody { error: "Unauthorized".into() }),
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

/// Validates `devhub-auth` cookie on every protected request.
/// Constant-time comparison prevents timing side-channels.
pub async fn require_auth(
    State(state): State<AppState>,
    jar: CookieJar,
    request: Request,
    next: Next,
) -> Response {
    let token_bytes = state.auth_token.as_bytes();

    let provided = jar
        .get(AUTH_COOKIE)
        .map(|c| c.value().as_bytes().ct_eq(token_bytes).into())
        .unwrap_or(false);

    if !provided {
        return unauthorized();
    }

    next.run(request).await
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct LoginBody {
    pub token: String,
}

#[derive(Serialize)]
struct LoginResponse {
    ok: bool,
}

/// POST /api/auth/login — validates token, sets httpOnly cookie.
pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Response {
    let expected = state.auth_token.as_bytes();
    let ok: bool = body.token.as_bytes().ct_eq(expected).into();

    if !ok {
        return (StatusCode::UNAUTHORIZED, Json(ErrorBody { error: "Invalid token".into() })).into_response();
    }

    // Secure is set unconditionally — harmless on plain HTTP, required for HTTPS reverse proxy.
    let cookie_attrs = format!("{AUTH_COOKIE}={}; HttpOnly; Secure; Path=/; SameSite=Strict", body.token);

    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie_attrs)],
        Json(LoginResponse { ok: true }),
    )
        .into_response()
}

/// POST /api/auth/logout — clears the cookie.
pub async fn logout() -> Response {
    let clear = format!("{AUTH_COOKIE}=; HttpOnly; Path=/; Max-Age=0");
    (
        StatusCode::OK,
        [(header::SET_COOKIE, clear)],
        Json(LoginResponse { ok: true }),
    )
        .into_response()
}

/// GET /api/auth/status — returns 200 if cookie is valid, 401 otherwise.
/// Used by web app to check auth state on load (this endpoint is unprotected;
/// the middleware handles the actual check inside protected routes).
pub async fn status(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Response {
    let token_bytes = state.auth_token.as_bytes();
    let ok: bool = jar
        .get(AUTH_COOKIE)
        .map(|c| c.value().as_bytes().ct_eq(token_bytes).into())
        .unwrap_or(false);

    if ok {
        Json(serde_json::json!({ "authenticated": true })).into_response()
    } else {
        (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "authenticated": false }))).into_response()
    }
}
