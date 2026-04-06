use axum::{Json, http::StatusCode, response::IntoResponse};
use serde::Serialize;

use crate::error::AppError;

// ---------------------------------------------------------------------------
// ApiError — converts AppError to HTTP responses
// ---------------------------------------------------------------------------

pub struct ApiError(pub AppError);

impl ApiError {
    pub fn from_app(e: AppError) -> Self {
        Self(e)
    }
}

impl From<AppError> for ApiError {
    fn from(e: AppError) -> Self {
        Self(e)
    }
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let status = match self.0.status_code() {
            404 => StatusCode::NOT_FOUND,
            400 => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(ErrorBody { error: self.0.to_string() })).into_response()
    }
}

// ---------------------------------------------------------------------------
// AppJson — wrapper that serializes T as JSON (avoids re-importing Json everywhere)
// ---------------------------------------------------------------------------

pub struct AppJson<T>(pub T);

impl<T: serde::Serialize> IntoResponse for AppJson<T> {
    fn into_response(self) -> axum::response::Response {
        Json(self.0).into_response()
    }
}
