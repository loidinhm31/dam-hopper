use thiserror::Error;

use crate::browser_debug::BrowserDebugError;
use crate::fs::FsError;
use crate::tunnel::TunnelError;

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

    #[error("Unavailable: {0}")]
    Unavailable(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("PTY error: {0}")]
    PtyError(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Persistence error: {0}")]
    PersistenceError(String),

    #[error(
        "Configuration persistence is desynchronized; restore the active configuration before retrying"
    )]
    ConfigPersistenceDesynchronized,

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Git error: {0}")]
    Git(String),

    #[error("Git repository not found: {0}")]
    GitNotFound(String),

    #[error("Git is not initialized for this project")]
    GitUnavailable,

    #[error("FS error: {0}")]
    Fs(FsError),

    #[error("Tunnel error: {0}")]
    Tunnel(TunnelError),

    #[error("Browser debug error: {0}")]
    BrowserDebug(#[from] BrowserDebugError),
}

pub type Result<T> = std::result::Result<T, AppError>;

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl From<TunnelError> for AppError {
    fn from(e: TunnelError) -> Self {
        AppError::Tunnel(e)
    }
}

impl AppError {
    pub fn status_code(&self) -> u16 {
        match self {
            AppError::ConfigNotFound(_)
            | AppError::NotFound(_)
            | AppError::SessionNotFound(_)
            | AppError::GitNotFound(_) => 404,
            AppError::GitUnavailable => 409,
            AppError::Config(_) | AppError::InvalidInput(_) => 400,
            AppError::Conflict(_) => 409,
            AppError::Fs(e) => e.status_code(),
            AppError::Unavailable(_) => 503,
            AppError::Tunnel(e) => tunnel_error_status(e),
            AppError::BrowserDebug(e) => e.status_code(),
            _ => 500,
        }
    }

    pub fn api_code(&self) -> Option<&'static str> {
        match self {
            AppError::GitUnavailable => Some("GIT_NOT_INITIALIZED"),
            AppError::ConfigPersistenceDesynchronized => Some("CONFIG_PERSISTENCE_DESYNCHRONIZED"),
            _ => None,
        }
    }
}

fn tunnel_error_status(e: &TunnelError) -> u16 {
    match e {
        TunnelError::NotFound(_) => 404,
        TunnelError::DuplicatePort(_) => 409,
        TunnelError::BinaryMissing | TunnelError::BinaryMissingHint(_) => 503,
        TunnelError::InstallInProgress => 409,
        TunnelError::SpawnFailed(_) | TunnelError::InstallFailed(_) | TunnelError::Io(_) => 500,
    }
}
