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
use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey};
use mongodb::bson::doc;
use bcrypt::{hash, verify, DEFAULT_COST};

use crate::state::AppState;

pub const AUTH_COOKIE: &str = "damhopper-auth";

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
// Token / JWT helpers
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

/// Extract token from `Authorization: Bearer <token>` header, falling back to cookie.
fn extract_token<'a>(request: &'a Request, jar: &'a CookieJar) -> Option<String> {
    // Prefer Authorization header (cross-origin Bearer)
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
    let mut validation = Validation::default();
    validation.validate_exp = true;
    decode::<Claims>(provided, &DecodingKey::from_secret(secret.as_bytes()), &validation).is_ok()
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

/// Validates JWT auth on every protected request.
pub async fn require_auth(
    State(state): State<AppState>,
    jar: CookieJar,
    request: Request,
    next: Next,
) -> Response {
    let ok = extract_token(&request, &jar)
        .map(|t| validate_jwt(&t, &state.jwt_secret))
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
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Serialize)]
struct LoginResponse {
    ok: bool,
    token: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct User {
    username: String,
    password_hash: String,
    is_enabled: bool,
}

/// POST /api/auth/register — registers a user in mongodb
pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Response {
    let Some(db) = &state.db else {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorBody { error: "MongoDB not configured, cannot register".into() })).into_response();
    };

    let Some(username) = body.username else { return unauthorized(); };
    let Some(password) = body.password else { return unauthorized(); };

    let collection = db.collection::<User>("users");
    
    if let Ok(Some(_)) = collection.find_one(doc! { "username": &username }).await {
        return (StatusCode::BAD_REQUEST, Json(ErrorBody { error: "User already exists".into() })).into_response();
    }
    
    let password_hash = hash(&password, DEFAULT_COST).unwrap_or_default();
    let new_user = User { username, password_hash, is_enabled: false };
    let _ = collection.insert_one(new_user).await;

    Json(serde_json::json!({ "ok": true })).into_response()
}

/// POST /api/auth/login — authenticates via mongodb or fallback to token, returns JWT
pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Response {
    let mut is_authenticated = false;
    let mut logged_in_sub = "unknown".to_string();

    if let (Some(username), Some(password), Some(db)) = (&body.username, &body.password, &state.db) {
        let collection = db.collection::<User>("users");
        if let Ok(Some(user)) = collection.find_one(doc! { "username": username }).await {
            is_authenticated = verify(password, &user.password_hash).unwrap_or(false);
            if is_authenticated && !user.is_enabled {
                return (StatusCode::UNAUTHORIZED, Json(ErrorBody { error: "Account is pending approval or disabled".into() })).into_response();
            }
            if is_authenticated {
                logged_in_sub = username.clone();
            }
        }
    }

    if !is_authenticated {
        return (StatusCode::UNAUTHORIZED, Json(ErrorBody { error: "Invalid credentials".into() })).into_response();
    }

    let exp = (chrono::Utc::now().timestamp() as usize) + 30 * 24 * 3600;

    let claims = Claims { sub: logged_in_sub, exp };
    let jwt_token = encode(&Header::default(), &claims, &EncodingKey::from_secret(state.jwt_secret.as_bytes())).unwrap_or_default();

    let cookie_attrs = format!("{AUTH_COOKIE}={}; HttpOnly; Secure; Path=/; SameSite=Strict", jwt_token);

    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie_attrs)],
        Json(LoginResponse { ok: true, token: Some(jwt_token) }),
    )
        .into_response()
}

/// POST /api/auth/logout — clears the cookie.
pub async fn logout() -> Response {
    let clear = format!("{AUTH_COOKIE}=; HttpOnly; Path=/; Max-Age=0");
    (
        StatusCode::OK,
        [(header::SET_COOKIE, clear)],
        Json(LoginResponse { ok: true, token: None }),
    )
        .into_response()
}

/// GET /api/auth/status — returns 200 if authenticated, 401 otherwise.
pub async fn status(
    State(state): State<AppState>,
    jar: CookieJar,
    request: Request,
) -> Response {
    let ok = extract_token(&request, &jar)
        .map(|t| validate_jwt(&t, &state.jwt_secret))
        .unwrap_or(false);

    if ok {
        Json(serde_json::json!({ "authenticated": true })).into_response()
    } else {
        (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "authenticated": false }))).into_response()
    }
}
