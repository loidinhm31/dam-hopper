use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AdvisorError {
    #[error("ADVISOR_DISABLED")]
    Disabled,

    #[error("History root must be a real directory; symlink rejected")]
    SymlinkRootRejected,

    #[error("History root is not available: {0}")]
    Unavailable(String),

    #[error("Snapshot not found or expired: {0}")]
    SnapshotNotFound(String),

    #[error("Snapshot owned by another user")]
    SnapshotUserMismatch,

    #[error("Record ref not found in snapshot: {0}")]
    RecordNotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Cursor verification failed: {0}")]
    CursorInvalid(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl IntoResponse for AdvisorError {
    fn into_response(self) -> Response {
        match self {
            AdvisorError::Disabled => (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({
                    "error": "ADVISOR_DISABLED",
                    "code": "AdvisorDisabled",
                })),
            )
                .into_response(),

            AdvisorError::SnapshotUserMismatch => (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({
                    "error": "Snapshot belongs to another authenticated session",
                    "code": "Forbidden",
                })),
            )
                .into_response(),

            AdvisorError::SnapshotNotFound(id) => (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({
                    "error": format!("Snapshot not found or expired: {id}"),
                    "code": "SnapshotNotFound",
                })),
            )
                .into_response(),

            AdvisorError::RecordNotFound(ref_id) => (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({
                    "error": format!("Record reference not found: {ref_id}"),
                    "code": "RecordNotFound",
                })),
            )
                .into_response(),

            AdvisorError::InvalidInput(msg) | AdvisorError::CursorInvalid(msg) => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": msg,
                    "code": "InvalidInput",
                })),
            )
                .into_response(),

            AdvisorError::SymlinkRootRejected => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "History root must be a real directory; symlink rejected",
                    "code": "SymlinkRootRejected",
                })),
            )
                .into_response(),

            AdvisorError::Unavailable(msg) => (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": msg,
                    "code": "AdvisorUnavailable",
                })),
            )
                .into_response(),

            AdvisorError::Io(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": err.to_string(),
                    "code": "IoError",
                })),
            )
                .into_response(),

            AdvisorError::Json(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": err.to_string(),
                    "code": "JsonError",
                })),
            )
                .into_response(),

            AdvisorError::Internal(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": msg,
                    "code": "InternalError",
                })),
            )
                .into_response(),
        }
    }
}
