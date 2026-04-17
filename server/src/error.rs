use thiserror::Error;

use crate::fs::FsError;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Config error: {0}")]
    Config(String),

    #[error("Config not found: {0}")]
    ConfigNotFound(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("PTY error: {0}")]
    PtyError(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Persistence error: {0}")]
    PersistenceError(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Git error: {0}")]
    Git(String),

    #[error("Git repository not found: {0}")]
    GitNotFound(String),

    #[error("FS error: {0}")]
    Fs(FsError),
}

pub type Result<T> = std::result::Result<T, AppError>;

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl AppError {
    pub fn status_code(&self) -> u16 {
        match self {
            AppError::ConfigNotFound(_)
            | AppError::NotFound(_)
            | AppError::SessionNotFound(_)
            | AppError::GitNotFound(_) => 404,
            AppError::Config(_) | AppError::InvalidInput(_) => 400,
            AppError::Fs(e) => e.status_code(),
            _ => 500,
        }
    }
}
