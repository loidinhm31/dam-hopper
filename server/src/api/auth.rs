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
// Token extraction helpers
// ---------------------------------------------------------------------------

/// Extract token from `Authorization: Bearer <token>` header, falling back to cookie.
/// Accepts both to allow same-origin cookie auth and cross-origin Bearer auth.
fn extract_token<'a>(request: &'a Request, jar: &'a CookieJar) -> Option<&'a str> {
    // Prefer Authorization header (cross-origin Bearer)
    if let Some(val) = request.headers().get(header::AUTHORIZATION) {
        if let Ok(s) = val.to_str() {
            if let Some(token) = s.strip_prefix("Bearer ") {
                return Some(token);
            }
        }
    }
    // Fall back to httpOnly cookie (same-origin)
    jar.get(AUTH_COOKIE).map(|c| c.value())
}

fn token_matches(provided: &str, expected: &[u8]) -> bool {
    provided.as_bytes().ct_eq(expected).into()
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

/// Validates auth on every protected request.
/// Accepts `Authorization: Bearer <token>` header (cross-origin) or `devhub-auth` cookie (same-origin).
/// Constant-time comparison prevents timing side-channels.
pub async fn require_auth(
    State(state): State<AppState>,
    jar: CookieJar,
    request: Request,
    next: Next,
) -> Response {
    let token_bytes = state.auth_token.as_bytes();

    let ok = extract_token(&request, &jar)
        .map(|t| token_matches(t, token_bytes))
        .unwrap_or(false);

    if !ok {
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

/// GET /api/auth/status — returns 200 if authenticated, 401 otherwise.
/// Accepts Bearer header (cross-origin) or cookie (same-origin).
/// Unprotected endpoint — auth middleware not applied here.
pub async fn status(
    State(state): State<AppState>,
    jar: CookieJar,
    request: Request,
) -> Response {
    let token_bytes = state.auth_token.as_bytes();
    let ok = extract_token(&request, &jar)
        .map(|t| token_matches(t, token_bytes))
        .unwrap_or(false);

    if ok {
        Json(serde_json::json!({ "authenticated": true })).into_response()
    } else {
        (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "authenticated": false }))).into_response()
    }
}
