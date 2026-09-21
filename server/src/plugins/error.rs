use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PluginErrorCode {
    Unauthorized,
    Forbidden,
    Incompatible,
    RunnerUnavailable,
    RuntimeUnavailable,
    SourceNotConfigured,
    SourceMissing,
    SourcePermissionDenied,
    InvalidInput,
    Overloaded,
    DeadlineExceeded,
    Cancelled,
    WorkerFailed,
    ContextRevoked,
    SnapshotExpired,
    DetailChangedOrMissing,
}

#[derive(Debug, Clone, Error, Serialize, Deserialize, PartialEq)]
#[error("{code:?}: {message}")]
pub struct PluginError {
    pub code: PluginErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub retryable: bool,
}

impl PluginError {
    pub fn new(code: PluginErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
            retryable: false,
        }
    }

    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn with_retryable(mut self, retryable: bool) -> Self {
        self.retryable = retryable;
        self
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new(PluginErrorCode::InvalidInput, message)
    }

    pub fn overloaded(message: impl Into<String>) -> Self {
        Self::new(PluginErrorCode::Overloaded, message)
    }

    pub fn cancelled(message: impl Into<String>) -> Self {
        Self::new(PluginErrorCode::Cancelled, message)
    }

    pub fn incompatible(message: impl Into<String>) -> Self {
        Self::new(PluginErrorCode::Incompatible, message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(PluginErrorCode::Forbidden, message)
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(PluginErrorCode::Unauthorized, message)
    }

    pub fn runner_unavailable(message: impl Into<String>) -> Self {
        Self::new(PluginErrorCode::RunnerUnavailable, message)
    }

    pub fn deadline_exceeded(message: impl Into<String>) -> Self {
        Self::new(PluginErrorCode::DeadlineExceeded, message)
    }

    pub fn worker_failed(message: impl Into<String>) -> Self {
        Self::new(PluginErrorCode::WorkerFailed, message)
    }

    pub fn context_revoked(message: impl Into<String>) -> Self {
        Self::new(PluginErrorCode::ContextRevoked, message)
    }

    pub fn snapshot_expired(message: impl Into<String>) -> Self {
        Self::new(PluginErrorCode::SnapshotExpired, message)
    }

    pub fn runtime_unavailable(message: impl Into<String>) -> Self {
        Self::new(PluginErrorCode::RuntimeUnavailable, message)
    }
}
