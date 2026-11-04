use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::Serialize;

use crate::error::AppError;

// ---------------------------------------------------------------------------
// ApiError — converts AppError to HTTP responses
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum ApiError {
    App(AppError),
    Custom {
        status: StatusCode,
        code: &'static str,
        message: String,
    },
}

impl ApiError {
    pub fn from_app(e: AppError) -> Self {
        Self::App(e)
    }

    pub fn custom(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self::Custom {
            status,
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::App(e) => write!(f, "{}", e),
            Self::Custom { message, .. } => write!(f, "{}", message),
        }
    }
}
impl From<AppError> for ApiError {
    fn from(e: AppError) -> Self {
        Self::App(e)
    }
}
impl From<crate::workflow::error::WorkflowError> for ApiError {
    fn from(error: crate::workflow::error::WorkflowError) -> Self {
        Self::App(crate::error::AppError::Workflow(error))
    }
}
impl From<crate::agent_status::IntegrationError> for ApiError {
    fn from(error: crate::agent_status::IntegrationError) -> Self {
        Self::App(crate::error::AppError::AgentStatusIntegration(error))
    }
}
impl From<crate::plans::PlansError> for ApiError {
    fn from(error: crate::plans::PlansError) -> Self {
        Self::App(crate::error::AppError::Plans(error))
    }
}

impl From<crate::error::GitBlameError> for ApiError {
    fn from(error: crate::error::GitBlameError) -> Self {
        Self::App(crate::error::AppError::GitBlame(error))
    }
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::Custom {
                status,
                code,
                message,
            } => (
                status,
                Json(ErrorBody {
                    error: message,
                    code: Some(code),
                }),
            )
                .into_response(),
            Self::App(app_err) => {
                let status = match &app_err {
                    AppError::Fs(fs_err) => match fs_err.status_code() {
                        400 => StatusCode::BAD_REQUEST,
                        403 => StatusCode::FORBIDDEN,
                        404 => StatusCode::NOT_FOUND,
                        409 => StatusCode::CONFLICT,
                        413 => StatusCode::PAYLOAD_TOO_LARGE,
                        415 => StatusCode::UNSUPPORTED_MEDIA_TYPE,
                        428 => StatusCode::PRECONDITION_REQUIRED,
                        503 => StatusCode::SERVICE_UNAVAILABLE,
                        _ => StatusCode::INTERNAL_SERVER_ERROR,
                    },
                    _ => match app_err.status_code() {
                        400 => StatusCode::BAD_REQUEST,
                        403 => StatusCode::FORBIDDEN,
                        404 => StatusCode::NOT_FOUND,
                        409 => StatusCode::CONFLICT,
                        413 => StatusCode::PAYLOAD_TOO_LARGE,
                        415 => StatusCode::UNSUPPORTED_MEDIA_TYPE,
                        428 => StatusCode::PRECONDITION_REQUIRED,
                        503 => StatusCode::SERVICE_UNAVAILABLE,
                        _ => StatusCode::INTERNAL_SERVER_ERROR,
                    },
                };
                let code = match &app_err {
                    AppError::Fs(fs_err) => fs_err.api_code().or_else(|| app_err.api_code()),
                    _ => app_err.api_code(),
                };
                (
                    status,
                    Json(ErrorBody {
                        error: app_err.to_string(),
                        code,
                    }),
                )
                    .into_response()
            }
        }
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
